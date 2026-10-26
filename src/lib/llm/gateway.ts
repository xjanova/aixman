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
} from './pricing';
import { SseRelay, readUsage, tokensFromChars } from './sse';

/**
 * The OpenAI-compatible gateway behind /api/v1.
 *
 * A customer's key is checked, the model is looked up among the `text` rows,
 * the request's worst case is held from their credits, and the call goes to the
 * model's backend: an upstream API through the account pool (DeepSeek and any
 * other OpenAI-compatible provider), or — once phase 2 lands — one of our
 * rented machines. The answer is relayed as it arrives and the hold is settled
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
      pricing: { credits_per_million_input_tokens: cfg.inputCreditsPerMTok, credits_per_million_output_tokens: cfg.outputCreditsPerMTok },
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

/** The body the upstream gets: whitelisted fields, its own model id, one choice, a bounded output. */
export function upstreamBody(body: Record<string, unknown>, cfg: LlmModelConfig, maxTokens: number, stream: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of FORWARDED) if (body[field] !== undefined) out[field] = body[field];
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

/**
 * One chat completion, streamed or not. Every path that took credits settles
 * them exactly once.
 */
export async function chatCompletion(caller: ApiCaller, rawBody: unknown, signal: AbortSignal): Promise<Response> {
  checkRate(caller, await ratePerMinute());
  const body = validate(rawBody);
  const model = await resolveModel(body.model);
  if (model.cfg.backend === 'gpu') {
    throw new ApiError(503, 'Self-hosted models are not available yet.', 'api_error', 'backend_unavailable');
  }

  const stream = body.stream === true;
  const maxTokens = outputBudget(body.max_tokens ?? body.max_completion_tokens, model.cfg);
  const promptCeiling = promptTokenCeiling(JSON.stringify(body.messages) + (body.tools ? JSON.stringify(body.tools) : ''));
  if (promptCeiling > model.cfg.contextLength * 4) {
    throw new ApiError(400, `The prompt is longer than this model's ${model.cfg.contextLength}-token context.`, 'invalid_request_error', 'context_length_exceeded');
  }
  const held = reserveCredits(promptCeiling, maxTokens, model.cfg);
  if (!(await holdCredits(caller.userId, held))) {
    throw new ApiError(402, `Not enough credits: this request can cost up to ${held}. Lower max_tokens or top up.`, 'insufficient_quota', 'insufficient_credits');
  }

  const started = Date.now();
  const outcome = (o: Partial<RequestOutcome>): RequestOutcome => ({
    userId: caller.userId,
    apiKeyId: caller.apiKeyId,
    model: model.modelId,
    modelName: model.name,
    backend: model.providerSlug,
    held,
    promptTokens: 0,
    completionTokens: 0,
    millicredits: 0,
    costUsd: 0,
    status: 'ok',
    latencyMs: Date.now() - started,
    ...o,
  });

  const account = await AccountPoolManager.selectAccount(model.providerId).catch(() => null);
  if (!account) {
    await settleRequest(outcome({ status: 'error', error: 'no upstream account' }));
    throw new ApiError(503, 'The model is busy. Try again shortly.', 'api_error', 'backend_unavailable');
  }

  const upstream = new AbortController();
  const onAbort = () => upstream.abort();
  signal.addEventListener('abort', onAbort);
  const firstByte = setTimeout(() => upstream.abort(), FIRST_BYTE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(upstreamChatUrl(model.providerSlug, model.providerBaseUrl, account.apiEndpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.apiKey}` },
      body: JSON.stringify(upstreamBody(body, model.cfg, maxTokens, stream)),
      signal: upstream.signal,
    });
  } catch (error) {
    clearTimeout(firstByte);
    signal.removeEventListener('abort', onAbort);
    const aborted = signal.aborted;
    await settleRequest(outcome({ status: aborted ? 'aborted' : 'error', error: String(error) }));
    if (!aborted) await AccountPoolManager.recordError(account.id, `api gateway: ${String(error)}`).catch(() => {});
    throw new ApiError(502, 'The model did not answer. Nothing was charged.', 'api_error', 'upstream_unreachable');
  }
  // Headers are in; from here only the total timeout (non-streamed) applies.
  clearTimeout(firstByte);

  if (!res.ok) {
    signal.removeEventListener('abort', onAbort);
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    await settleRequest(outcome({ status: 'error', error: `upstream ${res.status}: ${detail}` }));
    // A client mistake (bad tool schema, …) is theirs to see; an account
    // problem is ours, and the key gets a cooldown.
    if (res.status === 400 || res.status === 422) {
      throw new ApiError(400, `The model rejected the request: ${detail || res.statusText}`, 'invalid_request_error', 'upstream_rejected');
    }
    await AccountPoolManager.recordError(account.id, `api gateway ${res.status}: ${detail}`, res.status === 429).catch(() => {});
    throw new ApiError(res.status === 429 ? 429 : 502, 'The model is busy or failed. Nothing was charged; try again.', 'api_error', 'upstream_error');
  }

  const bill = async (promptTokens: number, completionTokens: number, status: RequestOutcome['status'], error?: string) => {
    const millicredits = millicreditsFor(promptTokens, completionTokens, model.cfg);
    const costUsd = costUsdFor(promptTokens, completionTokens, model.cfg);
    await settleRequest(outcome({ promptTokens, completionTokens, millicredits, costUsd, status, error, latencyMs: Date.now() - started }));
    if (status === 'ok') await AccountPoolManager.recordSuccess(account.id, costUsd).catch(() => {});
  };

  if (!stream) {
    const total = setTimeout(() => upstream.abort(), TOTAL_TIMEOUT_MS);
    try {
      const json = (await res.json()) as Record<string, unknown>;
      const usage = readUsage(json.usage);
      const text = JSON.stringify(json.choices ?? '');
      const promptTokens = usage?.promptTokens ?? tokensFromChars(promptCeiling);
      const completionTokens = usage?.completionTokens ?? tokensFromChars(text.length);
      await bill(promptTokens, completionTokens, 'ok');
      json.model = model.modelId;
      return Response.json(json);
    } catch (error) {
      await bill(0, 0, signal.aborted ? 'aborted' : 'error', String(error));
      throw new ApiError(502, 'The model answer could not be read. Nothing was charged.', 'api_error', 'upstream_error');
    } finally {
      clearTimeout(total);
      signal.removeEventListener('abort', onAbort);
    }
  }

  const relay = new SseRelay(model.modelId);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let settled = false;
  const finish = async (status: RequestOutcome['status'], error?: string) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', onAbort);
    const u = relay.usage;
    await bill(
      u?.promptTokens ?? tokensFromChars(promptCeiling),
      u?.completionTokens ?? tokensFromChars(relay.streamedChars),
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
