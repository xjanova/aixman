import type { ProviderResponse } from '@/types';
import { KIE_FALLBACKS, getKieEntry } from './kie-catalog';
import { referenceCaps } from '@/lib/reference-caps';
import { apiVideoLipsyncRule, checkClip, checkVoice, lipsyncCredits, type ClipFacts } from '@/lib/lipsync-rules';
import { creditsUsd, type KieBasis } from './kie-pricing';

/**
 * KIE is the primary provider; the account pool is its fallback.
 *
 * An order on a KIE model always goes to KIE first. It moves to an equivalent
 * row of another provider (KIE_FALLBACKS, or the admin's map on /admin/kie)
 * only when KIE cannot take it: no usable key (switched off, cooling down,
 * errored out), or a createTask KIE refused for its own reasons — no credit
 * (402), key refused, rate limit, maintenance, an outage
 * (`ProviderResponse.retryElsewhere`). A refused prompt, a failed render, a
 * timeout after KIE accepted the task: the order's, refunded, never moved —
 * KIE may still be rendering it.
 *
 * The customer pays what they were quoted for the KIE model whichever route
 * serves it; GenerationService charges once, settles once, and records the
 * route on the order (`params.route`) and on the usage log. A row that would
 * cost us more than that is not used (`fallbackLoss`): refunding beats
 * delivering at a loss.
 *
 * Everything here is pure except `routeKieOrder`, which only calls what it
 * is given — the tests run it against a mocked fetch.
 */

export const FALLBACK_ENABLED_KEY = 'kie_fallback_enabled';
export const FALLBACK_MAP_KEY = 'kie_fallback_map';
/** Most rows one KIE model may fall back to. */
export const MAX_FALLBACKS = 5;

/** Providers whose rows are never a fallback: KIE itself, rented GPUs, home PCs. */
const NEVER_FALLBACK = new Set(['kie', 'simplepod', 'gpuxmine']);

/**
 * Subcategories that are a different job, not a different look: a fallback
 * must do the same one. Any of the others (general, premium, fast, design…)
 * stands in for any other.
 */
const SHAPED = new Set([
  'lipsync', 'lipsync-portrait', 'motion', 'video-upscale', 'speech', 'music',
  'upscale', 'background', 'instruct', 'inpaint', 'outpaint',
]);

export interface FallbackRef {
  provider: string;
  modelId: string;
}

/** `fal:fal-ai/flux/dev` → `{provider: 'fal', modelId: 'fal-ai/flux/dev'}`; null when malformed or never a fallback. */
export function parseFallbackRef(ref: unknown): FallbackRef | null {
  if (typeof ref !== 'string') return null;
  const m = /^([a-z0-9][a-z0-9-]{0,49}):(\S{1,255})$/.exec(ref.trim());
  if (!m || NEVER_FALLBACK.has(m[1])) return null;
  return { provider: m[1], modelId: m[2] };
}

export const fallbackRef = (r: FallbackRef) => `${r.provider}:${r.modelId}`;

/** On unless the admin switched it off. */
export function readFallbackEnabled(value: string | null | undefined): boolean {
  return value?.trim() !== 'false';
}

/**
 * The admin's map from `ai_settings`, kept only where it names a catalogue
 * model and refs that parse. An entry present — even an empty list — replaces
 * the catalogue's for that model.
 */
export function readFallbackMap(raw: string | null | undefined): Record<string, string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!getKieEntry(key) || !Array.isArray(list)) continue;
    out[key] = cleanRefs(list);
  }
  return out;
}

/** Valid, distinct refs, at most MAX_FALLBACKS. */
export function cleanRefs(list: unknown[]): string[] {
  const refs = list.map(parseFallbackRef).filter((r): r is FallbackRef => r !== null).map(fallbackRef);
  return [...new Set(refs)].slice(0, MAX_FALLBACKS);
}

/** The rows a KIE model falls back to, in order: the admin's, else the catalogue's. */
export function fallbackRefsFor(kieKey: string, overrides: Record<string, string[]>): string[] {
  if (Object.hasOwn(overrides, kieKey)) return overrides[kieKey];
  return Object.hasOwn(KIE_FALLBACKS, kieKey) ? KIE_FALLBACKS[kieKey] : [];
}

/** What a fallback row must be able to do: the order as it was priced. */
export interface FallbackOrder {
  kieKey: string;
  /** Pictures the order composes from (an image) or edits (1). */
  references: number;
  /** A video order opening, or ending, on a picture. */
  firstFrame: boolean;
  lastFrame: boolean;
  /** The seconds priced: the length ordered, the voice spoken, or the clip. */
  seconds: number | null;
  clip: ClipFacts | null;
  voice: { seconds: number; bytes: number } | null;
}

export interface FallbackRow {
  providerSlug: string;
  providerActive: boolean;
  modelId: string;
  category: string;
  subcategory: string | null;
  isActive: boolean;
  readiness: string;
  maxDuration: number | null;
  /** The row's list cost in USD, what the books record for one of its orders. */
  costPerUnit: number;
  defaultParams?: unknown;
}

/** Why this row cannot take this order, in Thai; null when it can. */
export function whyNotFallback(order: FallbackOrder, row: FallbackRow): string | null {
  const entry = getKieEntry(order.kieKey);
  if (!entry) return 'ไม่ใช่โมเดลในแคตตาล็อก KIE';
  if (NEVER_FALLBACK.has(row.providerSlug)) return 'เป็นโมเดลของ KIE หรือเครื่องเช่า';
  if (!row.providerActive) return 'ผู้ให้บริการถูกปิด';
  if (!row.isActive) return 'โมเดลถูกปิด';
  if (row.readiness !== 'ready') return 'ยังไม่ผ่านการทดสอบ';
  if (row.category !== entry.category) return 'คนละประเภทงาน';
  const shaped = SHAPED.has(entry.subcategory);
  const rowSub = row.subcategory ?? '';
  if (shaped ? rowSub !== entry.subcategory : SHAPED.has(rowSub)) return 'ทำงานคนละแบบ';

  const caps = referenceCaps({
    providerSlug: row.providerSlug,
    modelId: row.modelId,
    category: row.category,
    defaultParams: row.defaultParams,
  });
  // An edit's picture is its input, not a reference; every edit row takes one.
  if (entry.category === 'image' && order.references > caps.images) {
    return caps.images === 0 ? 'ไม่รับภาพอ้างอิง' : `รับภาพอ้างอิงได้ ${caps.images} ภาพ`;
  }
  if (order.firstFrame && !caps.firstFrame) return 'ไม่รับภาพเฟรมแรก';
  if (order.lastFrame && !caps.lastFrame) return 'ไม่รับภาพเฟรมสุดท้าย';
  if (order.seconds && row.maxDuration && order.seconds > row.maxDuration) return `ยาวได้ไม่เกิน ${row.maxDuration} วินาที`;

  const lipsync = apiVideoLipsyncRule(row.modelId);
  if (lipsync) {
    if (!order.clip || !order.voice) return 'ไม่มีข้อมูลคลิปและเสียงของออร์เดอร์';
    const clip = checkClip(lipsync.clip, order.clip);
    if (!clip.ok) return clip.message;
    const voice = checkVoice(lipsync.voice, order.voice, order.clip.seconds);
    if (!voice.ok) return voice.message;
  }
  return null;
}

/**
 * The seconds a pool video row's list cost is for: the studio's default
 * order (GenerationService bounds a length it is not given to 5).
 */
const POOL_VIDEO_SECONDS = 5;

/**
 * What running this order on the row costs us, in USD, from the row's list
 * cost: one output; a re-dub row by its own billing blocks of the clip; a
 * video row pro rata past the 5 seconds its list cost is for — the fallback
 * renders the length the customer ordered.
 */
export function fallbackCostUsd(
  row: Pick<FallbackRow, 'modelId' | 'category' | 'costPerUnit'>,
  order: Pick<FallbackOrder, 'seconds' | 'clip'>
): number {
  const cost = Number.isFinite(row.costPerUnit) && row.costPerUnit > 0 ? row.costPerUnit : 0;
  const lipsync = apiVideoLipsyncRule(row.modelId);
  if (lipsync) return order.clip ? lipsyncCredits(lipsync.billing, cost, order.clip.seconds) : cost;
  if (row.category === 'video' && order.seconds && order.seconds > POOL_VIDEO_SECONDS) {
    return cost * (order.seconds / POOL_VIDEO_SECONDS);
  }
  return cost;
}

/**
 * Why the row would serve this order at a loss, in Thai; null when what the
 * customer paid (`paidCredits` at the cheapest rate a credit sells for)
 * covers its cost.
 */
export function fallbackLoss(
  row: Pick<FallbackRow, 'modelId' | 'category' | 'costPerUnit'>,
  order: Pick<FallbackOrder, 'seconds' | 'clip'>,
  paidCredits: number,
  basis: KieBasis
): string | null {
  const cost = fallbackCostUsd(row, order);
  const paid = creditsUsd(paidCredits, basis);
  // A hair of float noise is not a loss.
  if (cost <= paid + 1e-9) return null;
  return `ขาดทุน: ต้นทุน $${cost.toFixed(2)} มากกว่าที่ลูกค้าจ่าย $${paid.toFixed(2)}`;
}

/**
 * The order's params as another provider should see them — what a studio
 * order on that row would carry. KIE's own keys go: its tier ids in
 * `quality`/`resolution` mean nothing elsewhere, and the fal adapter copies
 * every param into the request body.
 */
export function fallbackParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const out = { ...(params ?? {}) };
  for (const key of [
    'kieTier', 'quality', 'resolution', 'voice', 'speechStyle', 'music', 'route',
    'inputAudio', 'inputVideo', 'inputImageEnd', 'referenceImages',
  ]) {
    delete out[key];
  }
  out.numOutputs = 1;
  return out;
}

/** Why KIE could not take an order, from its refusal — short Thai for the admin page and the alert. */
export function kieRefusalReason(result: Pick<ProviderResponse, 'error'>): string {
  const error = result.error ?? '';
  const code = Number(/^KIE (?:error )?(\d{3})\b/.exec(error)?.[1]);
  if (code === 402) return 'เครดิต KIE หมด (402)';
  if (code === 401 || code === 403) return `KIE ไม่รับคีย์ (${code})`;
  if (code === 429) return 'KIE จำกัดจำนวนคำสั่ง (429)';
  if (code === 455) return 'KIE ปิดปรับปรุงระบบ (455)';
  if (code === 505) return 'KIE ปิดโมเดลนี้ชั่วคราว (505)';
  if (code >= 500) return `KIE ขัดข้อง (${code})`;
  if (/^KIE request failed/.test(error)) return 'ติดต่อ KIE ไม่ได้';
  return 'KIE รับงานไม่ได้';
}

/** Why no KIE key can take an order right now (AccountPoolManager's blocks), short Thai. */
export function kieUnavailableReason(blocks: (string | null)[]): string {
  if (blocks.length === 0) return 'ยังไม่มีคีย์ KIE';
  if (blocks.includes('cooldown')) return 'คีย์ KIE พักชั่วคราวหลังข้อผิดพลาด';
  if (blocks.includes('errors')) return 'คีย์ KIE ผิดพลาดติดกันจนถูกพัก';
  if (blocks.includes('quota')) return 'คีย์ KIE ครบโควตา';
  return 'คีย์ KIE ถูกปิดอยู่';
}

export type KieRouteOutcome<T> =
  /** KIE delivered, or failed in a way that stays with KIE (refunded as before). */
  | { via: 'kie'; result: ProviderResponse; skipped?: 'off' | 'none' }
  /** KIE could not take it; `target` ran it. `kie` is null when KIE was not even asked (no usable key). */
  | { via: 'fallback'; result: ProviderResponse; kie: ProviderResponse | null; target: T; reason: string };

/**
 * Run one order: on KIE, and on the first fallback that can take it when
 * KIE cannot. Returns one result to settle — the caller charges and settles
 * exactly once, whichever way it went.
 */
export async function routeKieOrder<T>(deps: {
  /** The order on KIE; null when KIE has no usable key. */
  kie: (() => Promise<ProviderResponse>) | null;
  /** Why `kie` is null (kieUnavailableReason). */
  unavailable?: string;
  enabled: boolean;
  /** The first fallback row with a usable account, or null. */
  pick: () => Promise<{ target: T; run: () => Promise<ProviderResponse> } | null>;
}): Promise<KieRouteOutcome<T>> {
  let first: ProviderResponse | null = null;
  if (deps.kie) {
    first = await deps.kie();
    if (first.success || first.retryElsewhere !== true) return { via: 'kie', result: first };
  }
  const refused: ProviderResponse = first ?? {
    success: false,
    error: `KIE unavailable: ${deps.unavailable ?? 'no usable key'}`,
    retryElsewhere: true,
  };
  if (!deps.enabled) return { via: 'kie', result: refused, skipped: 'off' };
  const picked = await deps.pick();
  if (!picked) return { via: 'kie', result: refused, skipped: 'none' };
  const result = await picked.run();
  return {
    via: 'fallback',
    result,
    kie: first,
    target: picked.target,
    reason: first ? kieRefusalReason(first) : deps.unavailable ?? 'ยังไม่มีคีย์ KIE',
  };
}
