import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';
import { getKieEntry, type KieEntry, type KieOrder, type KieTask } from './kie-catalog';
import { composeMusicTags, sanitizeMusicParams } from '@/lib/music-style';
import { sanitizeSunoParams, sunoStemLabels, sunoVocalGender } from './kie-suno';
import { sunoTrackLyrics } from '@/lib/output-lyrics';

/**
 * KIE.ai — one key for most vendors' image, video, music and lip-sync models.
 *
 * Every model is the same async job: `POST /api/v1/jobs/createTask` with
 * `{model, input}` answers a task id, `GET /api/v1/jobs/recordInfo` is polled
 * until `state` is `success` (files in `resultJson`) or `fail`. Which model
 * and which `input` come from the catalogue (kie-catalog.ts).
 *
 * Errors come back as HTTP 200 with a `code` other than 200, so the body is
 * always read. Failed tasks are not charged by KIE (docs: "Get Task Details").
 *
 * Inputs must be URLs KIE can fetch. Our own R2 URLs go as they are; a
 * picture the studio sent as a data: URI goes through KIE's base64 upload
 * first (kept 24 h on their side, free).
 */

const API = 'https://api.kie.ai';
const UPLOAD = 'https://kieai.redpandaai.co/api/file-base64-upload';
/** KIE's own unit: 1 credit = $0.005. */
const USD_PER_KIE_CREDIT = 0.005;
/** Attempts at createTask while KIE answers 429 (20 creates per 10 s per account). */
const CREATE_ATTEMPTS = 3;

/**
 * Codes that are the order's problem, not the key's: a refused prompt or
 * picture, a model KIE switched off, a render that failed, KIE down for
 * maintenance. Counted against the key they would disable the one account
 * every KIE model shares after five customers' bad prompts.
 */
const ORDER_FAULT_CODES = new Set([400, 404, 413, 422, 433, 455, 500, 501, 505]);
/** Status-read answers that mean "ask again", not "the task is gone". */
const RETRY_CODES = new Set([429, 455, 500, 502, 503, 504]);
/**
 * createTask refusals that are KIE's or the account's, not the order's: no
 * credit, key refused, rate limit after the retries, maintenance or an
 * outage, the model switched off. Nothing was queued, so another provider may
 * take the order (`retryElsewhere`). A refused prompt (400, 422) is not here.
 */
const ELSEWHERE_CODES = new Set([401, 402, 403, 429, 455, 500, 502, 503, 504, 505]);

type Created = { ok: true; taskId: string } | { ok: false; response: ProviderResponse };

export class KieProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'kie';

  /** Between status reads. A field so a test can poll without waiting. */
  protected pollIntervalMs = 4000;
  /** Between createTask attempts after a 429. A field for the same reason. */
  protected retryDelayMs = 4000;

  async generateImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.run(params);
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.run(params);
  }

  async editImage(params: ProviderGenerateParams): Promise<ProviderResponse> {
    if (!params.inputImage) return { success: false, error: 'No input image provided for edit', orderFault: true };
    return this.run(params);
  }

  async generateAudio(params: ProviderGenerateParams): Promise<ProviderResponse> {
    return this.run(params);
  }

  /** Account balance in KIE credits, for the admin's "test key" button. */
  async credits(apiKey: string): Promise<{ ok: true; credits: number } | { ok: false; error: string }> {
    try {
      const res = await this.request(`${API}/api/v1/chat/credit`, { headers: auth(apiKey), timeout: 20000 });
      const body = (await res.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: unknown } | null;
      const code = Number(body?.code);
      if (!res.ok || code !== 200) {
        return { ok: false, error: `KIE ${code || res.status}: ${describe(body?.msg) || 'ตรวจคีย์ไม่ผ่าน'}` };
      }
      const credits = Number(body?.data);
      return Number.isFinite(credits) ? { ok: true, credits } : { ok: false, error: 'KIE ตอบยอดเครดิตในรูปแบบที่ไม่รู้จัก' };
    } catch (error) {
      return { ok: false, error: `KIE request failed: ${(error as Error).message}` };
    }
  }

  private async run(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const entry = getKieEntry(params.modelId);
    if (!entry) return { success: false, error: `KIE model not in the catalogue: ${params.modelId}`, orderFault: true };
    const started = Date.now();
    let order: KieOrder;
    try {
      order = await this.prepare(entry, params);
    } catch (error) {
      // A picture or voice KIE cannot take is the order's problem, not the key's.
      return { success: false, error: `KIE input refused: ${(error as Error).message}`, orderFault: true };
    }
    let task: KieTask;
    try {
      task = entry.build(order);
    } catch (error) {
      return { success: false, error: `KIE order not built: ${(error as Error).message}`, orderFault: true };
    }
    let created: Created;
    try {
      created = await this.createTask(params.apiKey, task);
    } catch (error) {
      // KIE could not be reached to take the order. (A create that timed out
      // after KIE accepted it may still render — the known, accepted case.)
      return { success: false, error: `KIE request failed: ${(error as Error).message}`, retryElsewhere: true };
    }
    if (!created.ok) return created.response;
    const taskId = created.taskId;
    try {
      await params.onTaskCreated?.(taskId);
    } catch (error) {
      // Only the restart recovery needs it; the wait below goes on regardless.
      console.error(`[kie] task ${taskId} not recorded on its order:`, (error as Error).message);
    }
    try {
      const result = await this.pollForResult(
        () => this.readTask(params.apiKey, taskId, started, entry.suno === 'stems', params.onState),
        pollAttempts(params.maxWaitSeconds ?? entry.maxWaitSeconds, this.pollIntervalMs),
        this.pollIntervalMs
      );
      // Out of patience is not the key's fault either.
      if (!result.success && /^Polling timeout/.test(result.error ?? '')) {
        return { success: false, error: `KIE task ${taskId} timed out`, orderFault: true };
      }
      return result;
    } catch (error) {
      return { success: false, error: `KIE request failed: ${(error as Error).message}` };
    }
  }

  /** The order an entry builds from, with every input turned into a URL KIE can fetch. */
  private async prepare(entry: KieEntry, params: ProviderGenerateParams): Promise<KieOrder> {
    const extra = params.extraParams ?? {};
    const tier = entry.tiers.find((t) => t.id === extra.kieTier) ?? entry.tiers.find((t) => t.isDefault) ?? entry.tiers[0];
    const wanted = Number(params.duration);
    const seconds = entry.perSecond
      ? Number.isFinite(wanted) && wanted > 0 ? wanted : null
      : entry.durations
        ? entry.durations.includes(wanted) ? wanted : entry.durations[0]
        : null;

    const picture = entry.category === 'image';
    const refs = picture
      ? [...new Set(params.referenceImages ?? (params.inputImage ? [params.inputImage] : []))].slice(0, entry.references ?? 0)
      : [];
    const images = await Promise.all(refs.map((u) => this.fetchable(u, params.apiKey)));
    const image = !picture && params.inputImage ? await this.fetchable(params.inputImage, params.apiKey) : undefined;
    const lastFrame =
      entry.lastFrame && image && params.inputImageEnd ? await this.fetchable(params.inputImageEnd, params.apiKey) : undefined;

    const music = entry.music ? sanitizeMusicParams(extra.music) : undefined;
    // GenerationService stored these sanitised (and an extension's start fixed); sanitised again here all the same.
    const suno = entry.suno ? sanitizeSunoParams(extra.suno) : undefined;
    // Only one of the entry's own voices reaches KIE; anything else is its default.
    const voice = entry.speech ? (entry.speech.voices.find((v) => v.id === extra.voice) ?? entry.speech.voices[0]).id : undefined;
    const style = entry.speech?.style && typeof extra.speechStyle === 'string' ? extra.speechStyle.trim().slice(0, 300) : '';
    return {
      prompt: params.prompt ?? '',
      negativePrompt: params.negativePrompt,
      aspectRatio: params.aspectRatio,
      tier: tier.id,
      seconds,
      images,
      image,
      lastFrame,
      audio: params.inputAudio ? await this.fetchable(params.inputAudio, params.apiKey) : undefined,
      video: params.inputVideo ? await this.fetchable(params.inputVideo, params.apiKey) : undefined,
      seed: typeof params.seed === 'number' && Number.isInteger(params.seed) && params.seed >= 0 ? params.seed : undefined,
      lyrics: typeof extra.lyrics === 'string' ? extra.lyrics : undefined,
      musicTags: entry.music ? composeMusicTags(params.prompt ?? '', music) : undefined,
      instrumental: music?.instrumental === true,
      vocalGender: entry.music && music?.instrumental !== true ? sunoVocalGender(music?.vocal) : undefined,
      suno,
      voice,
      speechStyle: style || undefined,
    };
  }

  /** An https URL as it is; a data: URI uploaded to KIE's file store first. */
  private async fetchable(source: string, apiKey: string): Promise<string> {
    if (source.startsWith('data:')) return this.upload(source, apiKey);
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new Error('input is neither a URL nor a data: URI');
    }
    if (url.protocol !== 'https:') throw new Error('KIE fetches inputs over https only');
    return source;
  }

  private async upload(dataUri: string, apiKey: string): Promise<string> {
    const mime = /^data:([\w.+-]+\/[\w.+-]+)[;,]/.exec(dataUri)?.[1] ?? 'application/octet-stream';
    const res = await this.request(UPLOAD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(apiKey) },
      body: JSON.stringify({
        base64Data: dataUri,
        uploadPath: 'aixman/inputs',
        fileName: `aixman-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extOf(mime)}`,
      }),
      timeout: 60000,
    });
    const body = (await res.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: { downloadUrl?: unknown } } | null;
    const url = body?.data?.downloadUrl;
    if (!res.ok || Number(body?.code) !== 200 || typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error(`KIE upload failed (${Number(body?.code) || res.status}): ${describe(body?.msg)}`);
    }
    return url;
  }

  private async createTask(apiKey: string, task: KieTask): Promise<Created> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.request(`${API}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(apiKey) },
        body: JSON.stringify(task),
      });
      const body = (await res.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: { taskId?: unknown } } | null;
      const code = Number(body?.code) || res.status;
      if (code === 200 && res.ok && typeof body?.data?.taskId === 'string' && body.data.taskId) {
        return { ok: true, taskId: body.data.taskId };
      }
      // A rejected create is not queued by KIE; wait out the burst and try again.
      if (code === 429 && attempt < CREATE_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
        continue;
      }
      const refused = failure(code, describe(body?.msg));
      return { ok: false, response: ELSEWHERE_CODES.has(code) ? { ...refused, retryElsewhere: true } : refused };
    }
  }

  /**
   * One status read of a task this process is no longer waiting on — an order
   * whose wait a deploy or crash cut off (ApiOrderSweep). `done: false` while
   * KIE is still rendering it.
   */
  async taskStatus(
    apiKey: string,
    modelId: string,
    taskId: string,
    started: number
  ): Promise<{ done: boolean; result?: ProviderResponse }> {
    return this.readTask(apiKey, taskId, started, getKieEntry(modelId)?.suno === 'stems');
  }

  private async readTask(
    apiKey: string,
    taskId: string,
    started: number,
    stems = false,
    onState?: (state: string) => void
  ): Promise<{ done: boolean; result?: ProviderResponse }> {
    let res: Response;
    try {
      res = await this.request(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
        headers: auth(apiKey),
        timeout: 30000,
      });
    } catch {
      // A dropped or slow status read is asked again; the order's wait still bounds it.
      return { done: false };
    }
    // A blip on the status read is not the task failing — KIE is still
    // rendering it, and billing us for it.
    if (res.status === 429 || res.status >= 500) return { done: false };
    const body = (await res.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: TaskRecord } | null;
    const code = Number(body?.code) || res.status;
    if (code !== 200 || !res.ok) {
      if (RETRY_CODES.has(code)) return { done: false };
      return { done: true, result: failure(code, describe(body?.msg)) };
    }
    const data = body?.data ?? {};
    if (typeof data.state === 'string') onState?.(data.state);
    if (data.state === 'success') {
      const urls = outputUrls(data);
      if (urls.length === 0) {
        // "Success" with nothing to deliver must refund, not store an empty order.
        return { done: true, result: { success: false, error: 'KIE returned no output', orderFault: true } };
      }
      const consumed = Number(data.creditsConsumed);
      return {
        done: true,
        result: {
          success: true,
          resultUrl: urls[0],
          resultUrls: urls,
          // Which stem each file is, read from KIE's names before R2 renames them.
          resultLabels: stems ? sunoStemLabels(parseJson(data.resultJson), urls) : undefined,
          // What each song sings — Suno's own words when the lyrics box was left empty.
          resultLyrics: stems ? undefined : sunoTrackLyrics([parseJson(data.resultJson), data.response], urls),
          jobId: taskId,
          processingMs: Date.now() - started,
          costUsd: Number.isFinite(consumed) && consumed > 0 ? round6(consumed * USD_PER_KIE_CREDIT) : undefined,
        },
      };
    }
    if (data.state === 'fail') {
      const why = [describe(data.failCode), describe(data.failMsg)].filter(Boolean).join(': ');
      return { done: true, result: { success: false, error: `KIE generation failed${why ? ` (${why})` : ''}`, orderFault: true } };
    }
    return { done: false };
  }
}

interface TaskRecord {
  state?: unknown;
  resultJson?: unknown;
  response?: unknown;
  failCode?: unknown;
  failMsg?: unknown;
  creditsConsumed?: unknown;
}

function auth(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

/** A refused request, worded so GenerationService and the pool read it right. */
function failure(code: number, message: string): ProviderResponse {
  const detail = message ? `: ${message}` : '';
  if (code === 401 || code === 403) return { success: false, error: `KIE ${code} API key refused${detail}` };
  if (code === 402) return { success: false, error: `KIE 402 insufficient credits${detail}` };
  // isRateLimitError reads "429": the key cools down instead of counting errors.
  if (code === 429) return { success: false, error: `KIE 429 rate limit${detail}` };
  return { success: false, error: `KIE error ${code}${detail}`, orderFault: ORDER_FAULT_CODES.has(code) };
}

/** Status reads before giving up: the order's own wait, else ten minutes. */
function pollAttempts(maxWaitSeconds: number | undefined, intervalMs: number): number {
  const seconds = maxWaitSeconds && maxWaitSeconds > 0 ? maxWaitSeconds : 600;
  return Math.max(1, Math.ceil((seconds * 1000) / Math.max(intervalMs, 1000)));
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function httpsUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') ? value : null;
}

function httpsList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(httpsUrl).filter((u): u is string => u !== null) : [];
}

/**
 * The files a finished task produced. `{resultUrls}` for most models; Veo at
 * 1080p puts the upscaled file in `data.result_urls` (the 720p one stays in
 * `resultUrls`); Suno lists its tracks as objects with `audio_url`.
 */
export function outputUrls(record: { resultJson?: unknown; response?: unknown }): string[] {
  for (const source of [parseJson(record.resultJson), record.response]) {
    const urls = collect(source, 0);
    if (urls.length > 0) return [...new Set(urls)];
  }
  return [];
}

function collect(node: unknown, depth: number): string[] {
  if (!node || depth > 4) return [];
  if (Array.isArray(node)) return node.flatMap((n) => collect(n, depth + 1));
  if (typeof node !== 'object') return [];
  const o = node as Record<string, unknown>;
  const nested = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? (o.data as Record<string, unknown>) : null;
  for (const list of [nested?.result_urls, o.result_urls, o.resultUrls]) {
    const urls = httpsList(list);
    if (urls.length > 0) return urls;
  }
  const audio = httpsUrl(o.audio_url) ?? httpsUrl(o.audioUrl);
  if (audio) return [audio];
  for (const key of ['data', 'response', 'sunoData', 'result']) {
    const urls = collect(o[key], depth + 1);
    if (urls.length > 0) return urls;
  }
  return [];
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, 300);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value).slice(0, 300);
}

function extOf(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
  };
  return map[mime] ?? 'bin';
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
