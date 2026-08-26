import { BaseProvider } from './base';
import type { ProviderGenerateParams, ProviderResponse, ProviderSlug } from '@/types';

/**
 * MiniMax (Hailuo) Provider — MiniMax H3 video generation.
 *
 * This is the *hosted API*, not the self-hosted weights in `src/lib/gpu`. The
 * two are deliberately separate routes to the same model family:
 *
 *  - Hosted API (this file): runs the full stack — H3-Context-IR (the prompt
 *    interpreter MiniMax never open-sourced) → H3-Base → H3-Regenerate-2K. It
 *    understands Thai prompts and speaks Thai in the generated audio, and it
 *    is the only route that can produce 2K.
 *  - Self-host (`src/lib/gpu`): H3-Base only, quantised, 768p ceiling, and
 *    bound by the MiniMax H3 Community License (which excludes the EU, UK,
 *    South Korea and the USA — *including for the outputs*). Cheaper per clip,
 *    but only once the queue is full enough to keep a rented GPU busy.
 *
 * Auth is a plain bearer token, so this provider slots into the normal account
 * pool rotation — unlike the GPU route, which meters by uptime.
 */

const DEFAULT_BASE_URL = 'https://api.minimax.io';

/** Only the v2 endpoint speaks H3. Older Hailuo models use a different v1 body. */
const H3_MODEL_PREFIX = 'MiniMax-H3';

/** `ratio` values the v2 endpoint accepts. Anything else is rejected upstream. */
const ALLOWED_RATIOS = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

/** H3 clips are 4–15 seconds. */
const MIN_DURATION = 4;
const MAX_DURATION = 15;

/**
 * A 15-second 2K render can sit in MiniMax's queue for several minutes, and
 * the docs ask for a 10-second polling interval. 120 × 10s = 20 minutes, which
 * has to outlast the slowest legal job — a poller that gives up early tells the
 * user a healthy generation failed while the credits stay spent.
 */
const POLL_ATTEMPTS = 120;
const POLL_INTERVAL_MS = 10_000;

interface MiniMaxBaseResp {
  base_resp?: { status_code?: number; status_msg?: string };
}

export class MiniMaxProvider extends BaseProvider {
  readonly slug: ProviderSlug = 'minimax';

  /**
   * MiniMax's image endpoints are not wired up here — this provider exists for
   * H3 video. Failing loudly beats sending a video body to an image route.
   */
  async generateImage(): Promise<ProviderResponse> {
    return { success: false, error: 'MiniMax adapter supports video only' };
  }

  async generateVideo(params: ProviderGenerateParams): Promise<ProviderResponse> {
    const startTime = Date.now();
    const baseUrl = (params.apiEndpoint || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = params.modelId || 'MiniMax-H3';

    // Guard rather than guess: the v1 body for Hailuo 2.3/02 has different
    // fields entirely, and silently posting an H3 body would fail in a way
    // that reads like an outage instead of a misconfigured model row.
    if (!model.startsWith(H3_MODEL_PREFIX)) {
      return {
        success: false,
        error: `MiniMax adapter supports ${H3_MODEL_PREFIX}* models only, got "${model}"`,
      };
    }

    try {
      const body = {
        model,
        content: this.buildContent(params),
        resolution: this.resolutionFor(params),
        duration: this.durationFor(params),
        ratio: this.ratioFor(params),
      };

      const response = await this.request(`${baseUrl}/v2/video_generation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `MiniMax error: ${error}` };
      }

      const data = (await response.json()) as MiniMaxBaseResp & { task_id?: string };

      // MiniMax reports application errors inside a 200 response, so the HTTP
      // status alone is not proof the task was accepted.
      const respError = this.baseRespError(data);
      if (respError) return { success: false, error: respError };

      const taskId = data.task_id;
      if (!taskId) return { success: false, error: 'No task ID returned' };

      return await this.pollTask(taskId, params.apiKey, baseUrl, startTime);
    } catch (error) {
      return { success: false, error: `MiniMax video failed: ${(error as Error).message}` };
    }
  }

  /**
   * Single status read, for callers that resume a job instead of holding a
   * connection open for it.
   */
  async checkJobStatus(
    jobId: string,
    apiKey: string,
    apiEndpoint?: string
  ): Promise<ProviderResponse> {
    const baseUrl = (apiEndpoint || DEFAULT_BASE_URL).replace(/\/+$/, '');
    try {
      const { done, result } = await this.readTask(jobId, apiKey, baseUrl, Date.now());
      if (done && result) return result;
      return { success: false, jobId, error: 'Job still processing' };
    } catch (error) {
      return { success: false, jobId, error: `MiniMax status check failed: ${(error as Error).message}` };
    }
  }

  // -------------------------------------------------------------------------
  // Request building
  // -------------------------------------------------------------------------

  /**
   * The v2 endpoint takes an ordered `content` array rather than flat fields.
   * The text item is mandatory and carries the whole prompt — Thai included,
   * up to 7000 characters, which is why no transliteration step is needed.
   *
   * `negativePrompt` is deliberately dropped: v2 has no negative-prompt field,
   * and folding it into the text would make the model generate the thing the
   * user asked to avoid.
   *
   * Extension point: omni-reference (character consistency across shots) uses
   * this same array with `role: 'reference_image' | 'reference_video' |
   * 'reference_audio'` (≤9 / ≤3 / ≤3). Not wired up until the UI can supply it.
   */
  private buildContent(params: ProviderGenerateParams): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: params.prompt }];

    if (params.inputImage) {
      // Accepts a public URL, `mm_file://{file_id}`, or a base64 data URI —
      // the same forms the rest of the app already passes around.
      content.push({
        type: 'image_url',
        image_url: { url: params.inputImage },
        role: 'first_frame',
      });
    }

    return content;
  }

  /** H3 offers 768P and 2K. Self-host can never reach 2K — only this route can. */
  private resolutionFor(params: ProviderGenerateParams): string {
    const explicit = String(params.extraParams?.resolution ?? '').toUpperCase();
    if (explicit === '2K' || explicit === '768P') return explicit;
    return (params.height ?? 768) > 768 ? '2K' : '768P';
  }

  /**
   * MiniMax bills per output second but the app charges a flat credit price per
   * generation, so an unbounded duration is spend we never collect: a 15s 2K
   * clip costs $1.95 against a row priced for 6s. The model row's `maxDuration`
   * is therefore a hard ceiling here, not just a default.
   */
  private durationFor(params: ProviderGenerateParams): number {
    const raw = Math.round(params.duration ?? MIN_DURATION);
    const ceiling = Math.min(
      MAX_DURATION,
      Number.isFinite(params.maxDuration) && (params.maxDuration ?? 0) >= MIN_DURATION
        ? (params.maxDuration as number)
        : MAX_DURATION
    );
    if (!Number.isFinite(raw)) return MIN_DURATION;
    return Math.min(ceiling, Math.max(MIN_DURATION, raw));
  }

  private ratioFor(params: ProviderGenerateParams): string {
    if (params.aspectRatio && ALLOWED_RATIOS.has(params.aspectRatio)) return params.aspectRatio;
    // With a first frame, let the model follow the source rather than crop it.
    if (params.inputImage) return 'adaptive';
    return '16:9';
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  private async pollTask(
    taskId: string,
    apiKey: string,
    baseUrl: string,
    startTime: number
  ): Promise<ProviderResponse> {
    return await this.pollForResult(
      () => this.readTask(taskId, apiKey, baseUrl, startTime),
      POLL_ATTEMPTS,
      POLL_INTERVAL_MS
    );
  }

  /** Statuses: Preparing → Queueing → Processing → Success | Fail. */
  private async readTask(
    taskId: string,
    apiKey: string,
    baseUrl: string,
    startTime: number
  ): Promise<{ done: boolean; result?: ProviderResponse }> {
    const res = await this.request(`${baseUrl}/v2/query/video_generation/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const data = (await res.json()) as MiniMaxBaseResp & {
      status?: string;
      content?: { url?: string };
      file?: { download_url?: string };
    };

    const status = data.status ?? '';

    if (status === 'Success') {
      // On success the task response carries the URL directly; the file_id
      // exchange is only needed for callers that skipped this endpoint.
      const url = data.content?.url ?? data.file?.download_url;
      if (!url) {
        // Echo the payload rather than a generic message: if MiniMax ever
        // moves this field, the first failed run says exactly where it went.
        return {
          done: true,
          result: {
            success: false,
            jobId: taskId,
            error: `MiniMax reported Success with no video URL: ${JSON.stringify(data).slice(0, 500)}`,
          },
        };
      }
      return {
        done: true,
        result: {
          success: true,
          resultUrl: url,
          resultUrls: [url],
          jobId: taskId,
          processingMs: Date.now() - startTime,
        },
      };
    }

    if (status === 'Fail') {
      return {
        done: true,
        result: {
          success: false,
          jobId: taskId,
          error: this.baseRespError(data) ?? 'MiniMax reported the task as failed',
        },
      };
    }

    // A base_resp error on the query itself (bad key, unknown task) is
    // terminal — retrying it for 20 minutes would just burn the wait.
    const respError = this.baseRespError(data);
    if (respError) {
      return { done: true, result: { success: false, jobId: taskId, error: respError } };
    }

    return { done: false };
  }

  /** MiniMax signals application errors with a non-zero `base_resp.status_code`. */
  private baseRespError(data: MiniMaxBaseResp): string | null {
    const code = data.base_resp?.status_code;
    if (code == null || code === 0) return null;
    return `MiniMax error ${code}: ${data.base_resp?.status_msg ?? 'unknown error'}`;
  }
}
