import { randomUUID } from 'crypto';
import type { WorkerProfile } from './config';
import { buildMiniMaxH3Workflow, frameLengthFor } from './workflows/minimax-h3';
import { getCatalogEntry, type CatalogJobParams } from './catalog';
import type { MusicStyleParams } from '@/lib/music-style';
import { isAcceptedAudioSource, readAudioSource, readFrameSource } from './frame-input';
import { PROGRESS_PATH } from './provision';
import {
  cacheSchema,
  clearSchema,
  getCachedSchema,
  validateGraph,
  type ComfyGraph,
  type ComfyObjectInfo,
} from './comfy-validate';
import { applyWorkflowVars, buildJobGraph, schemaSubset, templateClasses } from './workflow-build';
import type { EffectiveWorkflow } from './workflow-overrides';
import { NodeRefusedError, parseNodeRefusal } from './community-dispatch';
import { RejectedOutputError, communityOutputBudget, oversizeReason } from './community-plausibility';

export { applyWorkflowVars };

/**
 * HTTP client for the inference server running inside a rented container.
 *
 * Two dialects are supported:
 *  - `comfyui` — the ComfyUI API (`/prompt`, `/history/{id}`, `/view`), which is
 *    what MiniMax H3 ships day-0 support for.
 *  - `simple`  — a minimal submit/poll contract for custom images.
 *
 * Everything here talks to a Cloudflare tunnel URL that disappears the moment
 * the worker is terminated, so result assets MUST be copied to durable storage
 * before the worker is reaped.
 */

export interface WorkerJobParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  seed: number;
  inputImage?: string;
  extra?: Record<string, unknown>;
  /**
   * An admin placed the order. An override still in 'admin' rollout
   * (workflow-overrides.ts) renders only these jobs.
   */
  adminRun?: boolean;
}

export interface SubmitResult {
  externalJobId: string;
  /** The graph ComfyUI accepted, after validation — for /admin/workflows. */
  graph?: ComfyGraph;
  /** Non-fatal adjustments and admin overrides that did not land. */
  warnings?: string[];
  /** Rendered from an admin's custom graph. */
  custom?: boolean;
  /**
   * Why the admin's custom graph was not used on this machine (it failed
   * validation here), when the catalogue's graph was sent in its place.
   */
  fellBack?: string;
  /** The part of this worker's schema the model's workflow needs — for dry runs. */
  schema?: ComfyObjectInfo;
}

/** A graph ready to validate, and what the admin page should know about it. */
interface Built {
  graph: unknown;
  warnings: string[];
  custom: boolean;
}

/** Frame stills uploaded into the worker's ComfyUI input dir, by filename. */
interface StagedFrames {
  first?: string;
  last?: string;
  /** Reference song for a cover, by its name in the worker's input dir. */
  audio?: string;
}

export type PollOutcome =
  | { state: 'pending' }
  /**
   * `renderSeconds`: how long ComfyUI says the prompt executed (its own
   * execution_start → execution_success timestamps), when it says. A community
   * node's word, so it is only ever used to doubt a render, never to pay one.
   */
  | { state: 'completed'; assetUrls: string[]; renderSeconds?: number }
  | { state: 'failed'; error: string }
  /** The server no longer knows about this job — the container likely restarted. */
  | { state: 'lost'; error: string };

/**
 * What the worker's proxy has heard from ComfyUI about the prompt it is
 * executing. Counts are of graph nodes; `value`/`max` are the latest progress
 * event (a sampler's step N of M), reset whenever a new node starts.
 */
export interface WorkerProgress {
  promptId: string | null;
  /** The proxy is connected to ComfyUI's websocket right now. */
  listening: boolean;
  /** Seconds since ComfyUI started executing this prompt. */
  elapsed: number;
  value: number;
  max: number;
  /** `value`/`max` came from a sampler, not a decoder or loader. */
  progressIsSampler: boolean;
  nodesTotal: number;
  nodesDone: number;
  samplersTotal: number;
  samplersDone: number;
  /** Seconds since the last sampler finished; null while none has. */
  sinceSampling: number | null;
  done: boolean;
  failed: boolean;
}

const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 20_000;
/** Progress is read while a customer waits on the page — never make them wait on it. */
const PROGRESS_TIMEOUT_MS = 4_000;
/** How long a render download may go without a single byte before it is dead. */
const DOWNLOAD_STALL_MS = 60_000;
/**
 * And the longest it may take even while bytes keep arriving. At the slowest
 * tunnel worth waiting for (~50 KB/s) this still carries 45 MB, which is more
 * than the longest song this catalogue can produce.
 */
const DOWNLOAD_CEILING_MS = 15 * 60_000;
/**
 * How long a community node's `/object_info` is trusted. Its owner can add,
 * rename or delete checkpoints at any time; a rented container cannot.
 */
export const COMMUNITY_SCHEMA_TTL_MS = 10 * 60_000;
/** Each of the two purge calls. A node that cannot answer in this is asked again later. */
const PURGE_TIMEOUT_MS = 10_000;

/**
 * The most of a community node's answer that is read, by what the answer is.
 * A modified node can answer any call with a body that never ends, and every
 * answer is held in memory until it is parsed — so each is read up to a
 * ceiling far above an honest one, and only for as long as the call may take.
 * Rented workers are ours and keep reading as they always did.
 */
export const COMMUNITY_BODY_LIMITS = {
  /** An error or refusal: only its first words are ever used. */
  error: 64 * 1024,
  /** /prompt, /upload, /history/{id}, /queue, progress. */
  json: 8 * 1_048_576,
  /** /object_info: several MB on a node with many custom nodes. */
  schema: 64 * 1_048_576,
} as const;

/**
 * Read a response body up to `maxBytes`, and for no longer than `timeoutMs`.
 * `overflow` says there was more; the rest is never read (the stream is
 * cancelled). Throws when the body does not finish in time.
 */
export async function readCapped(
  res: Response,
  maxBytes: number,
  timeoutMs: number
): Promise<{ text: string; overflow: boolean }> {
  if (!res.body) return { text: '', overflow: false };
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let overflow = false;
  let finished = false;
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`the node's answer did not finish within ${Math.round(timeoutMs / 1000)} s`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`the node's answer did not finish within ${Math.round(timeoutMs / 1000)} s`)),
            left
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (done) {
        finished = true;
        break;
      }
      if (!value) continue;
      if (bytes + value.byteLength > maxBytes) {
        chunks.push(Buffer.from(value.subarray(0, maxBytes - bytes)));
        bytes = maxBytes;
        overflow = true;
        break;
      }
      chunks.push(Buffer.from(value));
      bytes += value.byteLength;
    }
  } finally {
    // Stop the rest arriving: a stream left open keeps the node's bytes coming.
    if (!finished) void reader.cancel().catch(() => {});
  }
  return { text: Buffer.concat(chunks, bytes).toString('utf8'), overflow };
}

export interface PurgeOutcome {
  /** Nothing is left worth asking again for. */
  done: boolean;
  /**
   * `/aixman/purge`: `purged`; `unsupported` (a node build without it);
   * `refused` (a permanent no — asking again changes nothing); `failed`
   * (offline, paused, no answer — ask again).
   */
  files: 'purged' | 'unsupported' | 'refused' | 'failed';
  /** `POST /history {delete}`, with the same meanings. */
  history: 'deleted' | 'refused' | 'failed';
  /** For the log when anything was not simply done. */
  detail?: string;
}

type PurgeCall = { status: number; body: string } | { error: string };

/** A 4xx that is the same answer however often it is asked (a malformed id, a path the relay's allowlist refuses). */
function permanentRefusal(call: { status: number; body: string }): boolean {
  if (call.status === 403) return call.body.includes('path-not-allowed');
  return [400, 404, 405, 409, 413, 422, 501].includes(call.status);
}

/**
 * What the two purge answers add up to. Only an answer that may change is
 * asked again: a node without `/aixman/purge` (404/405/501) or an id the
 * relay refuses is settled as it is, so a node cannot keep one job in the
 * retry sweep for a day by answering nonsense. Offline, paused (503), a
 * refused token (401/403) or silence is asked again.
 */
export function readPurgeOutcome(files: PurgeCall, history: PurgeCall): PurgeOutcome {
  const filesState: PurgeOutcome['files'] =
    'error' in files
      ? 'failed'
      : files.status >= 200 && files.status < 300
        ? 'purged'
        : [404, 405, 501].includes(files.status)
          ? 'unsupported'
          : permanentRefusal(files)
            ? 'refused'
            : 'failed';
  const historyState: PurgeOutcome['history'] =
    'error' in history
      ? 'failed'
      : history.status >= 200 && history.status < 300
        ? 'deleted'
        : permanentRefusal(history)
          ? 'refused'
          : 'failed';
  const done = filesState !== 'failed' && historyState !== 'failed';
  const clean = filesState !== 'refused' && historyState === 'deleted';
  const describe = (call: PurgeCall) => ('error' in call ? call.error : `HTTP ${call.status}`);
  return {
    done,
    files: filesState,
    history: historyState,
    ...(done && clean ? {} : { detail: `purge: ${describe(files)} · history: ${describe(history)}`.slice(0, 300) }),
  };
}

/**
 * Ask a community node to forget a job it ran: its output files, the inputs
 * it staged, and its ComfyUI history entry, which holds the customer's prompt
 * (contract C5). Called once the render is safely in R2.
 *
 * `/aixman/purge` goes first: the node finds the job's files through its
 * history, so deleting the history first would leave it nothing to go on.
 * `POST /history {delete}` follows either way — it is stock ComfyUI, so a
 * node too old to have `/aixman/purge` still loses the prompt text.
 *
 * Never throws; see readPurgeOutcome for what `done` means.
 */
export async function purgeCommunityJob(endpoint: string, authToken: string | undefined, promptId: string): Promise<PurgeOutcome> {
  const post = async (path: string, body: unknown): Promise<PurgeCall> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PURGE_TIMEOUT_MS);
    try {
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const answer = await readCapped(res, COMMUNITY_BODY_LIMITS.error, PURGE_TIMEOUT_MS).catch(() => ({ text: '' }));
      return { status: res.status, body: answer.text.slice(0, 500) };
    } catch (error) {
      return { error: (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
  };

  const files = await post('/aixman/purge', { prompt_id: promptId });
  const history = await post('/history', { delete: [promptId] });
  return readPurgeOutcome(files, history);
}

export interface WorkerClientOptions {
  /**
   * The worker is a GPUxMINE home machine. Its "not now" answers (503 with a
   * stage, 409 busy — contract C5; an older client's 502 `local runtime
   * unreachable`, read as `paused`), and the relay's own pushback in front of
   * it (503 relay-busy, 429 — C4), become NodeRefusedError so the queue can
   * requeue the job without spending an attempt, and its schema is re-read
   * every COMMUNITY_SCHEMA_TTL_MS.
   */
  community?: boolean;
}

/**
 * Checkpoint files this worker reports on disk.
 *
 * ComfyUI publishes a loader's file list as the first entry of its input's
 * combo choices, which is the same place `comfy-validate` reads to decide
 * whether a name is dispatchable. Reading it from there means the catalogue
 * and the validator can never disagree about what the machine has.
 */
function checkpointsOf(objectInfo: ComfyObjectInfo): string[] {
  const slot = objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  const choices = Array.isArray(slot) ? slot[0] : undefined;
  return Array.isArray(choices) ? choices.filter((c): c is string => typeof c === 'string') : [];
}

export class WorkerClient {
  constructor(
    private readonly endpoint: string,
    private readonly profile: WorkerProfile,
    /**
     * Bearer token the container is expected to require. The rented port is
     * published on a public tunnel and ComfyUI has no auth of its own, so
     * without a gate in the image anyone who finds the URL can run workflows
     * on the GPU we are paying for.
     */
    private readonly authToken?: string,
    /**
     * Which catalogue entry this worker serves. Without it the client cannot
     * tell which official template to convert, and falls back to the built-in
     * MiniMax H3 graph.
     */
    private readonly modelKey?: string,
    /**
     * The admin's override as it applies to this job (tunables, node inputs,
     * prompt affixes, custom graph), resolved by the queue. Null or absent: the
     * catalogue as shipped. Only submission reads it; polling needs none.
     */
    private readonly workflow?: EffectiveWorkflow | null,
    private readonly options: WorkerClientOptions = {}
  ) {}

  /**
   * A community node saying "not now" rather than failing. Only community
   * machines speak this dialect; a rented worker's errors keep their old text.
   */
  private refusal(status: number, text: string, what: string): NodeRefusedError | null {
    if (!this.options.community) return null;
    const refusal = parseNodeRefusal(status, text);
    return refusal ? new NodeRefusedError(refusal, what) : null;
  }

  /**
   * A successful answer's body. From a community node it is read up to
   * `limit` and within `timeoutMs`, and more than that is an error: nothing
   * an honest node sends comes close.
   */
  private async body(res: Response, limit: number, timeoutMs: number = POLL_TIMEOUT_MS): Promise<string> {
    if (!this.options.community) return res.text();
    const { text, overflow } = await readCapped(res, limit, timeoutMs);
    if (overflow) throw new Error(`The node's answer was larger than ${Math.round(limit / 1_048_576)} MB`);
    return text;
  }

  /** A failed answer's body, for its error message or refusal — never more than its first words from a community node. */
  private async errorBody(res: Response): Promise<string> {
    if (!this.options.community) return res.text().catch(() => '');
    return (await readCapped(res, COMMUNITY_BODY_LIMITS.error, POLL_TIMEOUT_MS).catch(() => ({ text: '' }))).text;
  }

  private url(path: string): string {
    return `${this.endpoint.replace(/\/+$/, '')}${path}`;
  }

  private async request(path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeout ?? POLL_TIMEOUT_MS);
    try {
      return await fetch(this.url(path), {
        ...init,
        headers: {
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          ...(init.headers || {}),
        },
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Asset URLs point at the worker's own tunnel and inherit its auth, so they
   * must be downloaded through this client rather than handed to a generic
   * fetcher. Returns the bytes for durable storage.
   *
   * `maxBytes`: the most this file may be. More is a RejectedOutputError,
   * raised on the Content-Length before the first byte, or on the chunk that
   * crosses the line — never after the whole stream is in memory. A community
   * node always has one (its model's MAX_COMMUNITY_OUTPUT_BYTES when the
   * caller gives none); a rented worker has none unless asked.
   */
  async download(assetUrl: string, opts: { maxBytes?: number } = {}): Promise<{ buffer: Buffer; contentType: string }> {
    const maxBytes =
      opts.maxBytes ??
      (this.options.community
        ? communityOutputBudget(this.modelKey ? getCatalogEntry(this.modelKey)?.outputKind : undefined)
        : undefined);
    const controller = new AbortController();
    // A *stall* timeout, not a total one. The old fixed 120 s cap was a
    // bandwidth test dressed up as a health check: a 5-minute song is a 33 MB
    // FLAC, so finishing inside it required 273 KB/s sustained out of a rented
    // host's Cloudflare quick tunnel. Job #100 drew a slower machine, aborted
    // at the 120 s mark with the render already sitting there finished, and
    // did it twice — the customer was refunded for a song that existed.
    //
    // What actually says "this tunnel is dead" is silence, so that is what is
    // measured: the clock restarts on every chunk that arrives. A stopped
    // transfer still fails in 60 s; a slow one finishes.
    let timer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
    const keepalive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
    };
    // The backstop, in case bytes keep trickling forever: the worker is being
    // paid for by the second while this runs.
    const ceiling = setTimeout(() => controller.abort(), DOWNLOAD_CEILING_MS);
    const startedAt = Date.now();
    try {
      const res = await fetch(assetUrl, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        // A home node that dropped off the relay after finishing still has
        // the file; the queue waits for it to come back instead of paying
        // for the render again somewhere else.
        const refused = this.refusal(res.status, await this.errorBody(res), 'the download');
        if (refused) throw refused;
        throw new Error(`Failed to download render (HTTP ${res.status})`);
      }

      // Refused before a byte is read when the node says up front that it is
      // sending more than the file may be.
      const declared = Number(res.headers.get('content-length'));
      if (maxBytes !== undefined && Number.isFinite(declared) && declared > maxBytes) {
        controller.abort();
        throw new RejectedOutputError(oversizeReason(maxBytes, declared));
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            if (maxBytes !== undefined && bytes + value.byteLength > maxBytes) {
              // Stop the stream where it crossed the line: the chunks so far
              // are dropped with this frame, and nothing more is fetched.
              void reader.cancel().catch(() => {});
              controller.abort();
              throw new RejectedOutputError(oversizeReason(maxBytes));
            }
            chunks.push(Buffer.from(value));
            bytes += value.byteLength;
            keepalive();
          }
        }
      } else {
        // No streaming body (a mocked fetch in tests, or a runtime that does
        // not expose one) — the stall timer cannot help, the ceiling still can.
        const whole = Buffer.from(await res.arrayBuffer());
        if (maxBytes !== undefined && whole.byteLength > maxBytes) throw new RejectedOutputError(oversizeReason(maxBytes));
        chunks.push(whole);
        bytes = whole.byteLength;
      }

      // Rendered bytes and the speed they arrived at. Without this the only
      // evidence of a slow tunnel was a job that failed for no stated reason.
      const seconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      console.log(
        `[gpu] downloaded render: ${(bytes / 1_048_576).toFixed(1)} MB in ${seconds.toFixed(1)}s ` +
          `(${(bytes / 1024 / seconds).toFixed(0)} KB/s)`
      );

      return {
        buffer: Buffer.concat(chunks, bytes),
        contentType: res.headers.get('content-type') || 'video/mp4',
      };
    } finally {
      clearTimeout(timer);
      clearTimeout(ceiling);
    }
  }

  async submit(params: WorkerJobParams): Promise<SubmitResult> {
    return this.profile.apiKind === 'comfyui' ? this.submitComfy(params) : this.submitSimple(params);
  }

  async poll(externalJobId: string): Promise<PollOutcome> {
    return this.profile.apiKind === 'comfyui'
      ? this.pollComfy(externalJobId)
      : this.pollSimple(externalJobId);
  }

  /**
   * How far the running render is, or null when the worker cannot say: the
   * `simple` dialect has no such report, and a machine booted before the proxy
   * learned to listen answers 404. Callers fall back to a time-based figure,
   * so every failure here is quiet.
   */
  async progress(): Promise<WorkerProgress | null> {
    if (this.profile.apiKind !== 'comfyui') return null;
    try {
      const res = await this.request(PROGRESS_PATH, { timeout: PROGRESS_TIMEOUT_MS });
      if (!res.ok) return null;
      const raw = JSON.parse(await this.body(res, COMMUNITY_BODY_LIMITS.json, PROGRESS_TIMEOUT_MS)) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return {
        promptId: typeof raw.prompt_id === 'string' ? raw.prompt_id : null,
        listening: raw.listening === true,
        elapsed: num(raw.elapsed),
        value: num(raw.value),
        max: num(raw.max),
        progressIsSampler: raw.progress_is_sampler === true,
        nodesTotal: num(raw.nodes_total),
        nodesDone: num(raw.nodes_done),
        samplersTotal: num(raw.samplers_total),
        samplersDone: num(raw.samplers_done),
        sinceSampling: typeof raw.since_sampling === 'number' ? raw.since_sampling : null,
        done: raw.done === true,
        failed: raw.failed === true,
      };
    } catch {
      return null;
    }
  }

  /**
   * The worker's node schema. Several megabytes, so it is fetched once per
   * endpoint and reused — the set of installed nodes cannot change while a
   * container is running. A community PC's can (its owner manages the
   * checkpoints), so there it is re-read after COMMUNITY_SCHEMA_TTL_MS.
   */
  private async objectInfo(): Promise<ComfyObjectInfo> {
    const key = this.endpoint.replace(/\/+$/, '');
    const cached = getCachedSchema(key, this.options.community ? COMMUNITY_SCHEMA_TTL_MS : undefined);
    if (cached) return cached;

    const res = await this.request('/object_info', { timeout: 60_000 });
    if (!res.ok) {
      const refused = this.refusal(res.status, await this.errorBody(res), 'the node schema request');
      if (refused) throw refused;
      throw new Error(`Could not read the worker's node schema (HTTP ${res.status})`);
    }
    const info = JSON.parse(await this.body(res, COMMUNITY_BODY_LIMITS.schema, 60_000)) as ComfyObjectInfo;
    cacheSchema(key, info);
    return info;
  }

  /** Drop the cached schema — call when the worker is released. */
  forgetSchema(): void {
    clearSchema(this.endpoint.replace(/\/+$/, ''));
  }

  /**
   * Upload a job's first/last-frame stills into the worker, for catalogue
   * models that take them. The pasted-workflow and fallback paths keep their
   * old behaviour of receiving the raw value.
   *
   * Runs per submission, so a job retried on another machine re-uploads there.
   */
  private async stageFrames(params: WorkerJobParams, objectInfo: ComfyObjectInfo): Promise<StagedFrames> {
    const entry = this.modelKey ? getCatalogEntry(this.modelKey) : undefined;
    if (this.profile.workflow || !entry) return {};
    if (!entry.video && !entry.needs?.audio) return {};

    const lastSource = typeof params.extra?.inputImageEnd === 'string' ? params.extra.inputImageEnd : undefined;
    const frames: StagedFrames = {};
    if (entry.video?.firstFrame && params.inputImage) frames.first = await this.uploadImage(params.inputImage, 'first');
    if (entry.video?.lastFrame && lastSource) frames.last = await this.uploadImage(lastSource, 'last');

    // LoadImage's schema lists the input dir as it was when /object_info was
    // cached, and validateGraph checks combo values against that list — so a
    // file uploaded a moment ago would read as "not available on the worker".
    if (frames.first || frames.last) await this.refreshNodeSpec(objectInfo, 'LoadImage');

    if (entry.needs?.audio) {
      const source = params.extra?.inputAudio;
      // A cover with no song to cover would otherwise render the template's
      // demo track and charge for it, exactly like an unbound parameter.
      if (!isAcceptedAudioSource(source)) {
        throw new Error(`"${entry.key}" needs a reference song, and this job has none`);
      }
      frames.audio = await this.uploadAudio(source);
      await this.refreshNodeSpec(objectInfo, 'LoadAudio');
    }
    return frames;
  }

  /**
   * Put the customer's song in the worker's input dir for LoadAudio.
   *
   * ComfyUI takes every input file on `/upload/image`, whatever the media type
   * — the field name is part of that route's contract, not a claim about the
   * bytes.
   */
  private async uploadAudio(source: string): Promise<string> {
    const { bytes, contentType, ext } = await readAudioSource(source);
    const filename = `aixman-source-${randomUUID()}.${ext}`;
    const boundary = `----aixman${randomUUID().replace(/-/g, '')}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`
      ),
      bytes,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`
      ),
    ]);

    const res = await this.request('/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
      timeout: SUBMIT_TIMEOUT_MS,
    });
    const text = res.ok ? await this.body(res, COMMUNITY_BODY_LIMITS.json, SUBMIT_TIMEOUT_MS) : await this.errorBody(res);
    if (!res.ok) {
      const refused = this.refusal(res.status, text, 'the reference song');
      if (refused) throw refused;
      throw new Error(`Worker refused the reference song (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text) as { name?: string; subfolder?: string };
    if (!data.name) throw new Error('Worker returned no name for the reference song');
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
  }

  /**
   * POST one still to ComfyUI's `/upload/image` and return the name to put in a
   * LoadImage node.
   *
   * The multipart body is built by hand as one buffer: the container's proxy
   * forwards exactly `Content-Length` bytes, and a streamed FormData body could
   * go out chunked with no length at all.
   */
  private async uploadImage(source: string, role: 'first' | 'last'): Promise<string> {
    const { bytes, contentType, ext } = await readFrameSource(source);
    const filename = `aixman-${role}-${randomUUID()}.${ext}`;
    const boundary = `----aixman${randomUUID().replace(/-/g, '')}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`
      ),
      bytes,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`
      ),
    ]);

    const res = await this.request('/upload/image', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
      timeout: SUBMIT_TIMEOUT_MS,
    });
    const text = res.ok ? await this.body(res, COMMUNITY_BODY_LIMITS.json, SUBMIT_TIMEOUT_MS) : await this.errorBody(res);
    if (!res.ok) {
      const refused = this.refusal(res.status, text, `the ${role} frame`);
      if (refused) throw refused;
      throw new Error(`Worker refused the ${role} frame (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const data = JSON.parse(text) as { name?: string; subfolder?: string };
    if (!data.name) throw new Error(`Worker returned no name for the ${role} frame`);
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
  }

  /** Re-read one node class's schema into the cached `/object_info`. */
  private async refreshNodeSpec(objectInfo: ComfyObjectInfo, classType: string): Promise<void> {
    const res = await this.request(`/object_info/${encodeURIComponent(classType)}`, { timeout: 30_000 });
    if (!res.ok) {
      const refused = this.refusal(res.status, await this.errorBody(res), `the ${classType} schema request`);
      if (refused) throw refused;
      throw new Error(`Could not refresh the worker's ${classType} schema (HTTP ${res.status})`);
    }
    const fresh = JSON.parse(await this.body(res, COMMUNITY_BODY_LIMITS.json, 30_000)) as ComfyObjectInfo;
    if (fresh[classType]) objectInfo[classType] = fresh[classType];
  }

  // ----------------------------------------------------------------
  // ComfyUI
  // ----------------------------------------------------------------

  /**
   * Produce the graph to submit, in order of preference:
   *
   *  1. An API-format graph an admin pasted into the profile — an explicit
   *     override always wins.
   *  2. The model's catalogue entry: its vendored official template, converted
   *     to API format against this worker's live schema, then bound to the
   *     job's parameters. This is the normal path.
   *  3. The hand-transcribed MiniMax H3 graph, kept as a fallback for a worker
   *     whose model key predates the catalogue.
   */
  private async buildGraph(
    params: WorkerJobParams,
    objectInfo: ComfyObjectInfo,
    frames: StagedFrames = {},
    options: { ignoreCustom?: boolean } = {}
  ): Promise<Built> {
    if (this.profile.workflow) {
      const graph = applyWorkflowVars(this.profile.workflow, {
        prompt: params.prompt,
        negative_prompt: params.negativePrompt ?? '',
        width: params.width,
        height: params.height,
        duration: params.duration,
        fps: params.fps,
        seed: params.seed,
        length: frameLengthFor(params.duration, params.fps),
        input_image: params.inputImage ?? '',
        ...(params.extra || {}),
      });
      return { graph, warnings: [], custom: true };
    }

    const entry = this.modelKey ? getCatalogEntry(this.modelKey) : undefined;
    if (entry) {
      const jobParams: Omit<CatalogJobParams, 'tuning'> = {
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        width: params.width,
        height: params.height,
        durationSeconds: params.duration,
        fps: params.fps,
        seed: params.seed,
        steps: typeof params.extra?.steps === 'number' ? params.extra.steps : undefined,
        // Names in the worker's input dir, uploaded by `stageFrames` — never the
        // raw URL or data URL the customer sent.
        imageFilename: frames.first,
        lastImageFilename: frames.last,
        // The staged name, never the URL the customer uploaded to.
        audioFilename: frames.audio,
        lyrics: typeof params.extra?.lyrics === 'string' ? params.extra.lyrics : undefined,
        // The song controls the customer picked. Stored on the generation and
        // carried here untouched — the catalogue entry is what turns them into
        // the model's `[Tags]` line, so every client composes the same prompt.
        music:
          params.extra?.music && typeof params.extra.music === 'object'
            ? (params.extra.music as MusicStyleParams)
            : undefined,
        resolution: typeof params.extra?.resolution === 'string' ? params.extra.resolution : undefined,
        // Priced by GenerationService, which only stores a mode this customer
        // may use — so it is rendered as stored.
        quality: typeof params.extra?.quality === 'string' ? params.extra.quality : undefined,
        // What this worker actually has, not what the catalogue wishes it had.
        // Community nodes bring their own weights.
        checkpoints: checkpointsOf(objectInfo),
      };
      const workflow = options.ignoreCustom && this.workflow ? { ...this.workflow, customGraph: null } : this.workflow;
      return buildJobGraph(entry, objectInfo, jobParams, workflow ?? null, frames);
    }

    const graph = buildMiniMaxH3Workflow({
      prompt: params.prompt,
      width: params.width,
      height: params.height,
      duration: params.duration,
      fps: params.fps,
      seed: params.seed,
      steps: typeof params.extra?.steps === 'number' ? params.extra.steps : undefined,
    });
    return { graph, warnings: [], custom: false };
  }

  private async submitComfy(params: WorkerJobParams): Promise<SubmitResult> {
    const objectInfo = await this.objectInfo();

    // Check the graph against what this worker actually provides before
    // spending render time on it. Also catches half-downloaded weights.
    let graph: ComfyGraph;
    let built: Built;
    let fellBack: string | undefined;
    const warnings: string[] = [];
    try {
      const frames = await this.stageFrames(params, objectInfo);
      built = await this.buildGraph(params, objectInfo, frames);
      let validated;
      try {
        validated = validateGraph(built.graph as ComfyGraph, objectInfo);
      } catch (error) {
        // An admin's custom graph that this machine cannot run must not cost
        // the customer their render: send the catalogue's graph instead and
        // let the queue tell the admin. Only a custom graph from the override
        // store falls back — a profile graph has no catalogue path behind it.
        if (!built.custom || !this.workflow?.customGraph) throw error;
        fellBack = (error as Error).message;
        built = await this.buildGraph(params, objectInfo, frames, { ignoreCustom: true });
        validated = validateGraph(built.graph as ComfyGraph, objectInfo);
      }
      graph = validated.graph;
      warnings.push(...built.warnings, ...validated.warnings);
      for (const warning of warnings) {
        console.warn(`[gpu] workflow adjusted — ${warning}`);
      }
    } catch (error) {
      // The cached schema lists the files that were on disk when it was read.
      // If one was missing then, a retry must see the disk as it is now.
      this.forgetSchema();
      throw error;
    }

    const res = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
      timeout: SUBMIT_TIMEOUT_MS,
    });

    const text = res.ok ? await this.body(res, COMMUNITY_BODY_LIMITS.json, SUBMIT_TIMEOUT_MS) : await this.errorBody(res);
    if (!res.ok) {
      // A paused or busy home node refuses /prompt with a stage (503, or 409
      // while its previous prompt runs) — not the graph's fault.
      const refused = this.refusal(res.status, text, 'the prompt');
      if (refused) throw refused;
      throw new Error(`ComfyUI rejected the workflow (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }

    const data = JSON.parse(text) as {
      prompt_id?: string;
      node_errors?: Record<string, unknown>;
    };

    // ComfyUI answers 200 with a populated node_errors map for a graph it cannot
    // run — treating that as success would hang the job until it timed out.
    if (data.node_errors && Object.keys(data.node_errors).length > 0) {
      throw new Error(`ComfyUI workflow has invalid nodes: ${JSON.stringify(data.node_errors).slice(0, 500)}`);
    }
    if (!data.prompt_id) throw new Error('ComfyUI returned no prompt_id');

    // What an admin needs to replay this offline: the classes the template
    // converts through (including helpers the prune removed) and the ones sent.
    const entry = this.modelKey ? getCatalogEntry(this.modelKey) : undefined;
    const classes = new Set(Object.values(graph).map((n) => n.class_type));
    if (entry) for (const cls of templateClasses(entry)) classes.add(cls);

    return {
      externalJobId: data.prompt_id,
      graph,
      warnings,
      custom: built.custom && !fellBack,
      fellBack,
      schema: schemaSubset(objectInfo, classes),
    };
  }

  private async pollComfy(promptId: string): Promise<PollOutcome> {
    const res = await this.request(`/history/${encodeURIComponent(promptId)}`);
    if (!res.ok) return { state: 'pending' };

    let raw: string;
    try {
      raw = await this.body(res, COMMUNITY_BODY_LIMITS.json);
    } catch (error) {
      // One prompt's history is a few KB. A node answering with megabytes
      // (or never finishing) is not reporting a render: the job moves on.
      if (this.options.community) return { state: 'failed', error: `Unreadable history from the node: ${(error as Error).message}` };
      throw error;
    }
    const history = JSON.parse(raw) as Record<
      string,
      {
        status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
        outputs?: Record<string, Record<string, unknown>>;
      }
    >;

    const entry = history?.[promptId];
    if (!entry) {
      // Absent from history: either still queued, or the container restarted and
      // dropped it. The queue distinguishes these by elapsed time.
      return (await this.isQueued(promptId)) ? { state: 'pending' } : { state: 'lost', error: 'Job not found on worker' };
    }

    const statusStr = entry.status?.status_str;
    if (statusStr === 'error') {
      return { state: 'failed', error: summariseComfyMessages(entry.status?.messages) };
    }
    if (entry.status?.completed !== true && statusStr !== 'success') {
      return { state: 'pending' };
    }

    const assetUrls = this.collectComfyOutputs(entry.outputs);
    if (assetUrls.length === 0) {
      return { state: 'failed', error: 'Workflow completed but produced no video output' };
    }
    const renderSeconds = comfyExecutionSeconds(entry.status?.messages);
    return renderSeconds === null ? { state: 'completed', assetUrls } : { state: 'completed', assetUrls, renderSeconds };
  }

  private async isQueued(promptId: string): Promise<boolean> {
    try {
      const res = await this.request('/queue');
      if (!res.ok) return true; // can't tell — assume still pending
      const body = await this.body(res, COMMUNITY_BODY_LIMITS.json);
      return body.includes(promptId);
    } catch {
      return true;
    }
  }

  private collectComfyOutputs(outputs?: Record<string, Record<string, unknown>>): string[] {
    if (!outputs) return [];

    const nodes = this.profile.outputNodeId
      ? [outputs[this.profile.outputNodeId]].filter(Boolean)
      : Object.values(outputs);

    const found: { url: string; filename: string }[] = [];
    for (const node of nodes) {
      if (!node) continue;
      // Video nodes vary by extension pack: gifs/videos/images all appear.
      // Core SaveVideo reports its file under `images` with `animated: true`.
      for (const bucket of ['videos', 'gifs', 'images', 'audio'] as const) {
        const items = node[bucket];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const file = item as { filename?: string; subfolder?: string; type?: string };
          if (!file?.filename) continue;
          // `temp` files are previews a template shows along the way, not the
          // result — storing one as the deliverable would hand back a still.
          if (file.type === 'temp') continue;
          const qs = new URLSearchParams({
            filename: file.filename,
            subfolder: file.subfolder || '',
            type: file.type || 'output',
          });
          found.push({ url: this.url(`/view?${qs.toString()}`), filename: file.filename });
        }
      }
    }

    // The first URL becomes the generation's result, so the file matching what
    // this model produces goes first.
    const wanted = this.modelKey ? getCatalogEntry(this.modelKey)?.outputKind : 'video';
    const rank = (filename: string) => (wanted && mediaKindOf(filename) === wanted ? 0 : 1);
    return found.sort((a, b) => rank(a.filename) - rank(b.filename)).map((f) => f.url);
  }

  // ----------------------------------------------------------------
  // Simple submit/poll contract
  // ----------------------------------------------------------------

  private async submitSimple(params: WorkerJobParams): Promise<SubmitResult> {
    const res = await this.request('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        width: params.width,
        height: params.height,
        duration: params.duration,
        fps: params.fps,
        seed: params.seed,
        image: params.inputImage,
        ...(params.extra || {}),
      }),
      timeout: SUBMIT_TIMEOUT_MS,
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`Worker rejected the job (HTTP ${res.status}): ${text.slice(0, 500)}`);

    const data = JSON.parse(text) as { job_id?: string; id?: string; task_id?: string };
    const id = data.job_id || data.id || data.task_id;
    if (!id) throw new Error('Worker returned no job id');
    return { externalJobId: id };
  }

  private async pollSimple(jobId: string): Promise<PollOutcome> {
    const res = await this.request(`/jobs/${encodeURIComponent(jobId)}`);
    if (res.status === 404) return { state: 'lost', error: 'Job not found on worker' };
    if (!res.ok) return { state: 'pending' };

    const data = (await res.json()) as {
      status?: string;
      error?: string;
      output?: string | string[];
      output_url?: string;
      urls?: string[];
    };

    const status = (data.status || '').toLowerCase();
    if (['failed', 'error', 'cancelled'].includes(status)) {
      return { state: 'failed', error: data.error || 'Worker reported failure' };
    }
    if (!['completed', 'succeeded', 'success', 'done'].includes(status)) {
      return { state: 'pending' };
    }

    const raw = data.urls ?? data.output ?? data.output_url;
    const assetUrls = (Array.isArray(raw) ? raw : [raw])
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((u) => (/^https?:\/\//i.test(u) ? u : this.url(u.startsWith('/') ? u : `/${u}`)));

    if (assetUrls.length === 0) return { state: 'failed', error: 'Worker completed but returned no output' };
    return { state: 'completed', assetUrls };
  }
}

function mediaKindOf(filename: string): 'video' | 'image' | 'audio' | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'mkv', 'gif'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (['flac', 'mp3', 'wav', 'ogg', 'opus', 'm4a'].includes(ext)) return 'audio';
  return undefined;
}

/**
 * Seconds between ComfyUI's execution_start and execution_success for a
 * prompt, from the `messages` of its /history entry; null when either is
 * missing or the two make no sense.
 */
export function comfyExecutionSeconds(messages: unknown): number | null {
  if (!Array.isArray(messages)) return null;
  let start: number | null = null;
  let end: number | null = null;
  for (const msg of messages) {
    if (!Array.isArray(msg) || msg.length < 2) continue;
    const [kind, detail] = msg as [unknown, { timestamp?: unknown } | null];
    const at = typeof detail?.timestamp === 'number' && Number.isFinite(detail.timestamp) ? detail.timestamp : null;
    if (at === null) continue;
    if (kind === 'execution_start') start = at;
    else if (kind === 'execution_success') end = at;
  }
  if (start === null || end === null || end < start) return null;
  return (end - start) / 1000;
}

function summariseComfyMessages(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages)) return 'Workflow execution failed';
  for (const msg of messages) {
    if (!Array.isArray(msg) || msg.length < 2) continue;
    const [kind, detail] = msg as [string, Record<string, unknown>];
    if (kind === 'execution_error') {
      const type = detail?.exception_type ?? '';
      const text = detail?.exception_message ?? '';
      return `${type} ${text}`.trim().slice(0, 500) || 'Workflow execution failed';
    }
  }
  return 'Workflow execution failed';
}
