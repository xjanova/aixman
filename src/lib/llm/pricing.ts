/**
 * Prices for the LLM API, and the arithmetic that turns tokens into credits.
 *
 * A model sold through /api/v1 is an ordinary `ai_models` row with category
 * `text`; what it costs lives in that row's `defaultParams` as `LlmModelConfig`.
 * Credits are whole numbers and a short request costs a fraction of one, so
 * everything here is counted in millicredits (thousandths) and only whole
 * credits ever leave the balance — the rest carries on the key
 * (`ai_api_keys.carry_millicredits`).
 *
 * Pure: no database, so the tests can pin every rounding rule.
 */

export const LLM_CATEGORY = 'text';

/** Where a model runs. `upstream`: another company's API through the account pool. `gpu`: our rented machines. */
export type LlmBackend = 'upstream' | 'gpu';

export interface LlmModelConfig {
  backend: LlmBackend;
  /** The id sent to the upstream API (DeepSeek renames its models; this is the admin's to change). */
  upstreamModel: string;
  /** What the customer pays, in credits per million tokens. */
  inputCreditsPerMTok: number;
  outputCreditsPerMTok: number;
  /** What it costs us, in USD per million tokens — for the margin on the admin page. */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  contextLength: number;
  /** The most a request may ask for; also what is reserved when it asks for nothing. */
  maxOutputTokens: number;
}

export const DEFAULT_LLM_CONFIG: LlmModelConfig = {
  backend: 'upstream',
  upstreamModel: '',
  inputCreditsPerMTok: 0,
  outputCreditsPerMTok: 0,
  inputUsdPerMTok: 0,
  outputUsdPerMTok: 0,
  contextLength: 131_072,
  maxOutputTokens: 8192,
};

function num(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/** Read a row's `defaultParams`, falling back field by field. Never throws. */
export function parseLlmConfig(raw: unknown): LlmModelConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_LLM_CONFIG;
  return {
    backend: o.backend === 'gpu' ? 'gpu' : 'upstream',
    upstreamModel: typeof o.upstreamModel === 'string' ? o.upstreamModel.trim().slice(0, 200) : d.upstreamModel,
    inputCreditsPerMTok: num(o.inputCreditsPerMTok, d.inputCreditsPerMTok, 1e9),
    outputCreditsPerMTok: num(o.outputCreditsPerMTok, d.outputCreditsPerMTok, 1e9),
    inputUsdPerMTok: num(o.inputUsdPerMTok, d.inputUsdPerMTok, 1e6),
    outputUsdPerMTok: num(o.outputUsdPerMTok, d.outputUsdPerMTok, 1e6),
    contextLength: Math.round(num(o.contextLength, d.contextLength, 10_000_000)) || d.contextLength,
    maxOutputTokens: Math.max(1, Math.round(num(o.maxOutputTokens, d.maxOutputTokens, 1_000_000))),
  };
}

/** Whether a model can be sold: it has a price, and an upstream model when it needs one. */
export function isSellable(cfg: LlmModelConfig): boolean {
  if (cfg.inputCreditsPerMTok <= 0 && cfg.outputCreditsPerMTok <= 0) return false;
  return cfg.backend === 'gpu' || cfg.upstreamModel !== '';
}

/** What a request costs the customer, in millicredits. Rounded up: a token is never free. */
export function millicreditsFor(promptTokens: number, completionTokens: number, cfg: LlmModelConfig): number {
  const p = Math.max(0, Math.round(promptTokens));
  const c = Math.max(0, Math.round(completionTokens));
  // credits/MTok × tokens × 1000 millicredits / 1e6 tokens = credits/MTok × tokens / 1000.
  return Math.ceil((p * cfg.inputCreditsPerMTok + c * cfg.outputCreditsPerMTok) / 1000);
}

/** What a request costs us, in USD. */
export function costUsdFor(promptTokens: number, completionTokens: number, cfg: LlmModelConfig): number {
  return (promptTokens * cfg.inputUsdPerMTok + completionTokens * cfg.outputUsdPerMTok) / 1e6;
}

/**
 * Tokens a prompt can be at most, without a tokenizer. A token is never
 * shorter than one byte of UTF-8 in any tokenizer these models use, so the
 * byte count is a ceiling (Thai: 3 bytes a character, ~1 token each — a
 * generous reserve, returned at settlement).
 */
export function promptTokenCeiling(text: string): number {
  return Buffer.byteLength(text, 'utf8') + 16;
}

/** The output budget a request gets: what it asked for, within the model's limit. */
export function outputBudget(requested: unknown, cfg: LlmModelConfig): number {
  const n = Math.round(Number(requested));
  return Number.isFinite(n) && n > 0 ? Math.min(n, cfg.maxOutputTokens) : cfg.maxOutputTokens;
}

/** Whole credits to hold before a request runs: its worst case, at least one. */
export function reserveCredits(promptCeiling: number, maxOutput: number, cfg: LlmModelConfig): number {
  return Math.max(1, Math.ceil(millicreditsFor(promptCeiling, maxOutput, cfg) / 1000));
}

export interface Settlement {
  /** Whole credits that become a usage charge. */
  charge: number;
  /** Millicredits left on the key for next time (0–999). */
  carry: number;
  /** Credits to give back from the reserve (negative: more is owed than was held). */
  refund: number;
}

/**
 * Close a request: its cost joins the key's carry, whole credits are charged,
 * and whatever the reserve held beyond that goes back.
 */
export function settle(reserved: number, carry: number, millicredits: number): Settlement {
  const total = Math.max(0, carry) + Math.max(0, millicredits);
  const charge = Math.floor(total / 1000);
  return { charge, carry: total - charge * 1000, refund: reserved - charge };
}
