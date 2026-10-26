import prisma from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { AccountPoolManager } from '@/lib/services/account-pool';
import { holdCredits, settleRequest, type RequestOutcome } from './billing';
import { hashApiKey, readApiKey } from './keys';
import {
  LLM_CATEGORY,
  costUsdFor,
  isSellable,
  millicreditsFor,
  outputBudget,
  parseLlmConfig,
  promptTokenCeiling,
  reserveCredits,
  type LlmModelConfig,
  type Usage,
} from './pricing';
import { SseRelay, readUsage, tokensFromChars } from './sse';
import { breachedLimit, spentByKey } from './key-limits';
import { noteBackendResult, noteNoAccount } from './alerts';

/**
 * The OpenAI-compatible gateway behind /api/v1.
 *
 * A customer's key is checked, the model is looked up among the `text` rows,
 * its backend is picked — an upstream API through the account pool (DeepSeek
 * and any other OpenAI-compatible provider), or one of our rented machines
 * running vLLM (gpu-target.ts) — then the request's worst case is held from
 * their credits. The answer is relayed as it arrives and the hold is settled
 * on what it actually cost.
 */

/** Requests per minute per key, unless `ai_settings.llm_api_rate_per_minute` says otherwise. */
const DEFAULT_RATE_PER_MINUTE = 60;
/** Waiting for the upstream to start answering. */
const FIRST_BYTE_TIMEOUT_MS = 120_000;
/** A whole non-streamed answer. Long reasoning runs take minutes. */
const TOTAL_TIMEOUT_MS = 15 * 60_000;
/** A stream that sends nothing for this long is dead: end it and settle the hold. */
const STREAM_IDLE_TIMEOUT_MS = 5 * 60_000;
/** The largest request body we forward (a long codebase pasted in is fine; a dump is not). */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Where an upstream provider's OpenAI-compatible API lives when neither its row nor the key names a root. */
const DEFAULT_ROOTS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com/v1',
  minimax: 'https://api.minimax.io/v1',
  byteplus: 'https://ark.ap-southeast.bytepluses.com/api/v3',
};

/** Fields passed on to the model. Anything else is dropped: the upstream bill must match what we price. */
const FORWARDED = [
  'messages', 'temperature', 'top_p', 'stop', 'presence_penalty', 'frequency_penalty', 'tools', 'tool_choice',
  'parallel_tool_calls', 'response_format', 'seed', 'logprobs', 'top_logprobs', 'reasoning_effort', 'thinking',
] as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = 'invalid_request_error',
    readonly code: string | null = null,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
  }

  toResponse(): Response {
    return Response.json(
      { error: { message: this.message, type: this.type, code: this.code } },
      { status: this.status, headers: this.headers }
    );
  }
}

export interface ApiCaller {
  apiKeyId: number;
  userId: number;
}

/** Who is calling, from their key. Throws ApiError(401) for anything else. */
export async function authenticate(headers: Headers): Promise<ApiCaller> {
  const key = readApiKey(headers);
  if (!key) throw new ApiError(401, 'Missing or malformed API key. Send `Authorization: Bearer axm-…`.', 'authentication_error', 'invalid_api_key');
  const row = await prisma.aiApiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!row || row.revokedAt) throw new ApiError(401, 'Invalid API key.', 'authentication_error', 'invalid_api_key');
  // xmanstudio owns the users table and may disable an account; its keys die with it.
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { isActive: true } });
  if (!user?.isActive) throw new ApiError(401, 'This account is disabled.', 'authentication_error', 'account_disabled');
  return { apiKeyId: row.id, userId: row.userId };
}

async function ratePerMinute(): Promise<number> {
  const row = await prisma.aiSetting.findUnique({ where: { key: 'llm_api_rate_per_minute' } }).catch(() => null);
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? Math.min(10_000, Math.round(n)) : DEFAULT_RATE_PER_MINUTE;
}

export function checkRate(caller: ApiCaller, perMinute: number): void {
  const r = rateLimit(`llm-api:${caller.apiKeyId}`, perMinute, 60_000);
  if (!r.ok) {
    throw new ApiError(429, `Rate limit: ${perMinute} requests per minute per key.`, 'rate_limit_error', 'rate_limited', {
      'Retry-After': String(r.retryAfter),
    });
  }
}

/** Every model a key may call, OpenAI's list format plus our prices. */
export async function listModels() {
  const rows = await prisma.aiModel.findMany({
    where: { category: LLM_CATEGORY, isActive: true, readiness: 'ready', provider: { isActive: true } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { provider: { select: { slug: true } } },
  });
  return rows
    .map((m) => ({ row: m, cfg: parseLlmConfig(m.defaultParams) }))
    .filter(({ cfg }) => isSellable(cfg))
    .map(({ row, cfg }) => ({
      id: row.modelId,
      object: 'model' as const,
      created: Math.floor(row.createdAt.getTime() / 1000),
      owned_by: 'aixman',
      name: row.name,
      description: row.description,
      context_length: cfg.contextLength,
      max_output_tokens: cfg.maxOutputTokens,
      pricing: {
        credits_per_million_input_tokens: cfg.inputCreditsPerMTok,
        credits_per_million_output_tokens: cfg.outputCreditsPerMTok,
        credits_per_million_cached_input_tokens: cfg.cachedInputCreditsPerMTok ?? cfg.inputCreditsPerMTok,
        ...(cfg.offPeakStartUtc && cfg.offPeakEndUtc && cfg.offPeakPriceFactor < 1
          ? { off_peak: { start_utc: cfg.offPeakStartUtc, end_utc: cfg.offPeakEndUtc, price_factor: cfg.offPeakPriceFactor } }
          : {}),
      },
    }));
}

interface ResolvedModel {
  id: number;
  modelId: string;
  name: string;
  providerId: number;
  providerSlug: string;
  providerBaseUrl: string | null;
  cfg: LlmModelConfig;
}

async function resolveModel(modelId: unknown): Promise<ResolvedModel> {
  if (typeof modelId !== 'string' || !modelId.trim()) throw new ApiError(400, '`model` is required.', 'invalid_request_error', 'model_required');
  const row = await prisma.aiModel.findFirst({
    where: { modelId: modelId.trim(), category: LLM_CATEGORY, isActive: true, provider: { isActive: true } },
    include: { provider: { select: { slug: true, baseUrl: true } } },
  });
  const cfg = row ? parseLlmConfig(row.defaultParams) : null;
  if (!row || !cfg || !isSellable(cfg) || row.readiness !== 'ready') {
    throw new ApiError(404, `The model \`${modelId}\` does not exist or is not available. GET /api/v1/models lists them.`, 'invalid_request_error', 'model_not_found');
  }
  return {
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    providerId: row.providerId,
    providerSlug: row.provider.slug,
    providerBaseUrl: row.provider.baseUrl,
    cfg,
  };
}

/** The chat-completions URL for an upstream provider. */
export function upstreamChatUrl(slug: string, providerBaseUrl?: string | null, accountEndpoint?: string | null): string {
  const root = (accountEndpoint?.trim() || providerBaseUrl?.trim() || DEFAULT_ROOTS[slug] || '').replace(/\/+$/, '');
  if (!root) throw new ApiError(503, 'This model has no upstream endpoint configured.', 'api_error', 'backend_unconfigured');
  return root.endsWith('/chat/completions') ? root : `${root}/chat/completions`;
}

/**
 * Sampling controls vLLM takes beyond OpenAI's, which the model cards ask for
 * (Qwen's thinking switch lives in `chat_template_kwargs`). Only our own
 * machines get them: another company's API may refuse what it does not know.
 */
const VLLM_EXTRA = ['top_k', 'min_p', 'repetition_penalty', 'chat_template_kwargs'] as const;

/** The body the upstream gets: whitelisted fields, its own model id, one choice, a bounded output. */
export function upstreamBody(
  body: Record<string, unknown>,
  cfg: LlmModelConfig,
  maxTokens: number,
  stream: boolean,
  extraFields: readonly string[] = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of [...FORWARDED, ...extraFields]) if (body[field] !== undefined) out[field] = body[field];
  out.model = cfg.upstreamModel;
  out.max_tokens = maxTokens;
  out.stream = stream;
  if (stream) out.stream_options = { include_usage: true };
  return out;
}

function validate(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'The body must be a JSON object.');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) throw new ApiError(400, '`messages` must be a non-empty array.');
  if (b.n !== undefined && Number(b.n) !== 1) throw new ApiError(400, 'Only `n: 1` is supported.');
  return b;
}

const ENCODER = new TextEncoder();

/** Credits held by each key's requests still running (instances: 1, like rate-limit.ts). */
const keyHolds = new Map<number, number>();

/** Refuse a request its key's own cap cannot cover. */
async function checkKeyLimits(caller: ApiCaller, worstCase: number): Promise<void> {
  const limits = await prisma.aiApiKey.findUnique({
    where: { id: caller.apiKeyId },
    select: { dailyLimitCredits: true, monthlyLimitCredits: true },
  });
  if (!limits || (limits.dailyLimitCredits === null && limits.monthlyLimitCredits === null)) return;
  const spent = await spentByKey(caller.apiKeyId, Date.now());
  const breach = breachedLimit(limits, spent, keyHolds.get(caller.apiKeyId) ?? 0, worstCase);
  if (breach) {
    throw new ApiError(
      402,
      `This key's ${breach.period === 'day' ? 'daily' : 'monthly'} limit of ${breach.limit} credits would be passed ` +
        `(${breach.spent.toFixed(2)} used, this request can cost up to ${worstCase}). Raise it on /developer or lower max_tokens.`,
      'insufficient_quota',
      'key_limit_reached'
    );
  }
}

/** Where one request goes, and what its outcome means for that backend. */
interface Target {
  url: string;
  headers: Record<string, string>;
  backend: string;
  extraFields: readonly string[];
  /** Give the slot back (a machine's in-flight count). Safe to call twice. */
  release(): void;
  onSuccess(costUsd: number): Promise<void>;
  onFailure(status: number | null, detail: string): Promise<void>;
}

/** Retry-After for a model whose machine is booting: weights take 20–40 min on a fresh host. */
const WARMING_RETRY_SECONDS = 120;

async function openTarget(model: ResolvedModel): Promise<Target> {
  if (model.cfg.backend === 'gpu') {
    const { pickGpuTarget } = await import('./gpu-target');
    const pick = await pickGpuTarget(model.cfg.upstreamModel);
    if (pick.kind === 'off') {
      throw new ApiError(503, 'This model is not running right now.', 'api_error', 'model_offline');
    }
    if (pick.kind !== 'ready') {
      throw new ApiError(
        503,
        pick.kind === 'warming'
          ? 'The model is starting up on a GPU (a fresh machine takes 20–40 minutes). Retry later; nothing was charged.'
          : 'No GPU is running this model; one is being started (20–40 minutes). Retry later; nothing was charged.',
        'api_error',
        'model_warming',
        { 'Retry-After': String(WARMING_RETRY_SECONDS) }
      );
    }
    const t = pick.target;
    return {
      url: t.url,
      headers: { 'Content-Type': 'application/json', ...(t.token ? { Authorization: `Bearer ${t.token}` } : {}) },
      backend: 'gpu',
      extraFields: VLLM_EXTRA,
      release: t.release,
      onSuccess: async () => noteBackendResult(`gpu:${model.cfg.upstreamModel}`, model.name, true),
      // The machine's own health is the reconcile pass's to judge; a run of
      // failures is still worth a message.
      onFailure: async (status, detail) => {
        console.error(`[llm] worker #${t.workerId} answered ${status ?? 'nothing'}: ${detail.slice(0, 200)}`);
        noteBackendResult(`gpu:${model.cfg.upstreamModel}`, model.name, false, `เครื่อง #${t.workerId} ตอบ ${status ?? 'ไม่ได้'}: ${detail}`);
      },
    };
  }

  const account = await AccountPoolManager.selectAccount(model.providerId).catch(() => null);
  if (!account) {
    noteNoAccount(model.providerSlug, model.name);
    throw new ApiError(503, 'The model is busy. Try again shortly.', 'api_error', 'backend_unavailable');
  }
  return {
    url: upstreamChatUrl(model.providerSlug, model.providerBaseUrl, account.apiEndpoint),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.apiKey}` },
    backend: model.providerSlug,
    extraFields: [],
    release: () => {},
    onSuccess: async (costUsd) => {
      noteBackendResult(model.providerSlug, model.name, true);
      await AccountPoolManager.recordSuccess(account.id, costUsd).catch(() => {});
    },
    onFailure: async (status, detail) => {
      noteBackendResult(model.providerSlug, model.name, false, `${account.label}: ${status ?? 'ติดต่อไม่ได้'} ${detail}`);
      await AccountPoolManager.recordError(account.id, `api gateway ${status ?? 'unreachable'}: ${detail}`, status === 429).catch(() => {});
    },
  };
}

/**
 * One chat completion, streamed or not. Every path that took credits settles
 * them exactly once.
 */
export async function chatCompletion(caller: ApiCaller, rawBody: unknown, signal: AbortSignal): Promise<Response> {
  checkRate(caller, await ratePerMinute());
  const body = validate(rawBody);
  const model = await resolveModel(body.model);

  const stream = body.stream === true;
  const maxTokens = outputBudget(body.max_tokens ?? body.max_completion_tokens, model.cfg);
  const promptCeiling = promptTokenCeiling(JSON.stringify(body.messages) + (body.tools ? JSON.stringify(body.tools) : ''));
  if (promptCeiling > model.cfg.contextLength * 4) {
    throw new ApiError(400, `The prompt is longer than this model's ${model.cfg.contextLength}-token context.`, 'invalid_request_error', 'context_length_exceeded');
  }

  // Where it runs is settled before any credit moves: a machine still booting
  // or an empty account pool costs the customer nothing.
  const held = reserveCredits(promptCeiling, maxTokens, model.cfg);
  await checkKeyLimits(caller, held);
  const target = await openTarget(model);
  if (!(await holdCredits(caller.userId, held))) {
    target.release();
    throw new ApiError(402, `Not enough credits: this request can cost up to ${held}. Lower max_tokens or top up.`, 'insufficient_quota', 'insufficient_credits');
  }
  keyHolds.set(caller.apiKeyId, (keyHolds.get(caller.apiKeyId) ?? 0) + held);
  let settled = false;
  /** Every path that held credits ends here, once. */
  const settle = async (o: RequestOutcome) => {
    if (settled) return;
    settled = true;
    keyHolds.set(caller.apiKeyId, Math.max(0, (keyHolds.get(caller.apiKeyId) ?? 0) - held));
    await settleRequest(o);
  };

  const started = Date.now();
  const outcome = (o: Partial<RequestOutcome>): RequestOutcome => ({
    userId: caller.userId,
    apiKeyId: caller.apiKeyId,
    model: model.modelId,
    modelName: model.name,
    backend: target.backend,
    held,
    promptTokens: 0,
    completionTokens: 0,
    millicredits: 0,
    costUsd: 0,
    status: 'ok',
    latencyMs: Date.now() - started,
    ...o,
  });

  const upstream = new AbortController();
  const onAbort = () => upstream.abort();
  signal.addEventListener('abort', onAbort);
  const firstByte = setTimeout(() => upstream.abort(), FIRST_BYTE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify(upstreamBody(body, model.cfg, maxTokens, stream, target.extraFields)),
      signal: upstream.signal,
    });
  } catch (error) {
    clearTimeout(firstByte);
    signal.removeEventListener('abort', onAbort);
    target.release();
    const aborted = signal.aborted;
    await settle(outcome({ status: aborted ? 'aborted' : 'error', error: String(error) }));
    if (!aborted) await target.onFailure(null, String(error));
    throw new ApiError(502, 'The model did not answer. Nothing was charged.', 'api_error', 'upstream_unreachable');
  }
  // Headers are in; from here only the total timeout (non-streamed) applies.
  clearTimeout(firstByte);

  if (!res.ok) {
    signal.removeEventListener('abort', onAbort);
    target.release();
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    await settle(outcome({ status: 'error', error: `upstream ${res.status}: ${detail}` }));
    // A client mistake (bad tool schema, …) is theirs to see; an account
    // problem is ours, and the key gets a cooldown.
    if (res.status === 400 || res.status === 422) {
      throw new ApiError(400, `The model rejected the request: ${detail || res.statusText}`, 'invalid_request_error', 'upstream_rejected');
    }
    await target.onFailure(res.status, detail);
    throw new ApiError(res.status === 429 ? 429 : 502, 'The model is busy or failed. Nothing was charged; try again.', 'api_error', 'upstream_error');
  }

  const bill = async (usage: Usage, status: RequestOutcome['status'], error?: string) => {
    // Priced at when the request started: an answer that runs past the end of
    // an off-peak window was still bought inside it.
    const at = new Date(started);
    const millicredits = millicreditsFor(usage, model.cfg, at);
    const costUsd = costUsdFor(usage, model.cfg, at);
    target.release();
    await settle(
      outcome({
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens ?? 0,
        millicredits,
        costUsd,
        status,
        error,
        latencyMs: Date.now() - started,
      })
    );
    if (status === 'ok') await target.onSuccess(costUsd);
  };

  if (!stream) {
    const total = setTimeout(() => upstream.abort(), TOTAL_TIMEOUT_MS);
    try {
      const json = (await res.json()) as Record<string, unknown>;
      const usage = readUsage(json.usage);
      const text = JSON.stringify(json.choices ?? '');
      await bill(usage ?? { promptTokens: tokensFromChars(promptCeiling), completionTokens: tokensFromChars(text.length) }, 'ok');
      json.model = model.modelId;
      return Response.json(json);
    } catch (error) {
      await bill({ promptTokens: 0, completionTokens: 0 }, signal.aborted ? 'aborted' : 'error', String(error));
      throw new ApiError(502, 'The model answer could not be read. Nothing was charged.', 'api_error', 'upstream_error');
    } finally {
      clearTimeout(total);
      signal.removeEventListener('abort', onAbort);
    }
  }

  const relay = new SseRelay(model.modelId);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let finished = false;
  const finish = async (status: RequestOutcome['status'], error?: string) => {
    if (finished) return;
    finished = true;
    signal.removeEventListener('abort', onAbort);
    const u = relay.usage;
    await bill(
      u ?? { promptTokens: tokensFromChars(promptCeiling), completionTokens: tokensFromChars(relay.streamedChars) },
      u ? status : status === 'ok' ? 'aborted' : status,
      error
    );
  };

  let idle: ReturnType<typeof setTimeout> | undefined;
  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      clearTimeout(idle);
      idle = setTimeout(() => upstream.abort(), STREAM_IDLE_TIMEOUT_MS);
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(idle);
          const rest = relay.push(decoder.decode()) + relay.flush();
          if (rest) controller.enqueue(ENCODER.encode(rest));
          controller.close();
          await finish('ok');
          return;
        }
        const text = relay.push(decoder.decode(value, { stream: true }));
        if (text) controller.enqueue(ENCODER.encode(text));
      } catch (error) {
        clearTimeout(idle);
        controller.error(error);
        await finish(signal.aborted ? 'aborted' : 'error', String(error));
      }
    },
    async cancel() {
      clearTimeout(idle);
      upstream.abort();
      await finish('aborted', 'client closed the stream');
    },
  });

  return new Response(out, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
