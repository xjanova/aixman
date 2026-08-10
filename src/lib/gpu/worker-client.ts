import { randomUUID } from 'crypto';
import type { WorkerProfile } from './config';
import { buildMiniMaxH3Workflow, frameLengthFor } from './workflows/minimax-h3';
import { getCatalogEntry, type CatalogJobParams } from './catalog';
import {
  bindParameters,
  convertUiWorkflowToApi,
  describeUnmatched,
  injectNodes,
  pruneByClass,
} from './comfy-convert';
import {
  cacheSchema,
  clearSchema,
  getCachedSchema,
  validateGraph,
  type ComfyGraph,
  type ComfyObjectInfo,
} from './comfy-validate';

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
}

export interface SubmitResult {
  externalJobId: string;
}

export type PollOutcome =
  | { state: 'pending' }
  | { state: 'completed'; assetUrls: string[] }
  | { state: 'failed'; error: string }
  /** The server no longer knows about this job — the container likely restarted. */
  | { state: 'lost'; error: string };

const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 20_000;

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
    private readonly modelKey?: string
  ) {}

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
   */
  async download(assetUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(assetUrl, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Failed to download render (HTTP ${res.status})`);
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') || 'video/mp4',
      };
    } finally {
      clearTimeout(timer);
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
   * The worker's node schema. Several megabytes, so it is fetched once per
   * endpoint and reused — the set of installed nodes cannot change while a
   * container is running.
   */
  private async objectInfo(): Promise<ComfyObjectInfo> {
    const key = this.endpoint.replace(/\/+$/, '');
    const cached = getCachedSchema(key);
    if (cached) return cached;

    const res = await this.request('/object_info', { timeout: 60_000 });
    if (!res.ok) {
      throw new Error(`Could not read the worker's node schema (HTTP ${res.status})`);
    }
    const info = (await res.json()) as ComfyObjectInfo;
    cacheSchema(key, info);
    return info;
  }

  /** Drop the cached schema — call when the worker is released. */
  forgetSchema(): void {
    clearSchema(this.endpoint.replace(/\/+$/, ''));
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
    objectInfo: ComfyObjectInfo
  ): Promise<unknown> {
    if (this.profile.workflow) {
      return applyWorkflowVars(this.profile.workflow, {
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
    }

    const entry = this.modelKey ? getCatalogEntry(this.modelKey) : undefined;
    if (entry) {
      const jobParams: CatalogJobParams = {
        prompt: params.prompt,
        negativePrompt: params.negativePrompt,
        width: params.width,
        height: params.height,
        durationSeconds: params.duration,
        fps: params.fps,
        seed: params.seed,
        steps: typeof params.extra?.steps === 'number' ? params.extra.steps : undefined,
        imageFilename: params.inputImage,
        audioFilename: typeof params.extra?.audioFilename === 'string' ? params.extra.audioFilename : undefined,
      };

      let graph = convertUiWorkflowToApi(entry.template, objectInfo);
      if (entry.inject) graph = injectNodes(graph, entry.inject(jobParams));
      // Bind before pruning: pruning cascades through dependants, so redirecting
      // a path first is what stops the cascade from eating it.
      const bound = bindParameters(graph, entry.bind(jobParams));

      // A binding that misses leaves the *template's demo value* in place — the
      // customer would be charged for a render of the sample prompt. Fail loudly
      // instead; the job refunds and the model drops back to 'tuning'.
      if (bound.unmatched.length > 0) {
        throw new Error(
          `Workflow for "${entry.key}" does not accept: ${describeUnmatched(bound.unmatched)}. ` +
            'The template or the node signatures have changed — the catalogue binding needs updating. ' +
            'Refusing to render with the template default values.'
        );
      }

      graph = bound.graph;
      if (entry.prune?.length) graph = pruneByClass(graph, entry.prune);
      return graph;
    }

    return buildMiniMaxH3Workflow({
      prompt: params.prompt,
      width: params.width,
      height: params.height,
      duration: params.duration,
      fps: params.fps,
      seed: params.seed,
      steps: typeof params.extra?.steps === 'number' ? params.extra.steps : undefined,
    });
  }

  private async submitComfy(params: WorkerJobParams): Promise<SubmitResult> {
    const objectInfo = await this.objectInfo();
    const rawGraph = await this.buildGraph(params, objectInfo);

    // Check the graph against what this worker actually provides before
    // spending render time on it. Also catches half-downloaded weights.
    const { graph, warnings } = validateGraph(rawGraph as ComfyGraph, objectInfo);
    for (const warning of warnings) {
      console.warn(`[gpu] workflow adjusted — ${warning}`);
    }

    const res = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
      timeout: SUBMIT_TIMEOUT_MS,
    });

    const text = await res.text();
    if (!res.ok) {
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

    return { externalJobId: data.prompt_id };
  }

  private async pollComfy(promptId: string): Promise<PollOutcome> {
    const res = await this.request(`/history/${encodeURIComponent(promptId)}`);
    if (!res.ok) return { state: 'pending' };

    const history = (await res.json()) as Record<
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
    return { state: 'completed', assetUrls };
  }

  private async isQueued(promptId: string): Promise<boolean> {
    try {
      const res = await this.request('/queue');
      if (!res.ok) return true; // can't tell — assume still pending
      const body = await res.text();
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

    const urls: string[] = [];
    for (const node of nodes) {
      if (!node) continue;
      // Video nodes vary by extension pack: gifs/videos/images all appear.
      for (const bucket of ['videos', 'gifs', 'images', 'audio'] as const) {
        const items = node[bucket];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const file = item as { filename?: string; subfolder?: string; type?: string };
          if (!file?.filename) continue;
          const qs = new URLSearchParams({
            filename: file.filename,
            subfolder: file.subfolder || '',
            type: file.type || 'output',
          });
          urls.push(this.url(`/view?${qs.toString()}`));
        }
      }
    }
    return urls;
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

// --------------------------------------------------------------------
// Workflow templating
// --------------------------------------------------------------------

/**
 * Substitute `{{name}}` placeholders throughout a ComfyUI graph.
 *
 * A string that is *exactly* a placeholder adopts the value's real type, so
 * `"width": "{{width}}"` becomes the number 768 rather than the string "768" —
 * ComfyUI rejects string-typed numeric inputs.
 */
export function applyWorkflowVars(graph: unknown, vars: Record<string, unknown>): unknown {
  const exact = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const match = node.match(exact);
      if (match) {
        return Object.prototype.hasOwnProperty.call(vars, match[1]) ? vars[match[1]] : node;
      }
      return node.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key: string) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
      );
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  return walk(graph);
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
