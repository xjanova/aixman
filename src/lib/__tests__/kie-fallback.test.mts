/**
 * KIE first, the account pool second: the routing decision against KIE's and
 * fal's documented answers, and the rules that say which row may stand in.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/kie-fallback.test.mts)
 *
 * `globalThis.fetch` is stubbed: KIE's createTask answers `{code, msg, data}`
 * (errors too as HTTP 200), fal's queue answers the finished file at once.
 * Nothing reaches the network and no credit is spent.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { KieProvider } from '@/lib/providers/kie';
import { FalProvider } from '@/lib/providers/fal';
import { KIE_CATALOG, KIE_FALLBACKS, getKieEntry } from '@/lib/providers/kie-catalog';
import {
  cleanRefs,
  fallbackCostUsd,
  fallbackLoss,
  fallbackParams,
  fallbackRefsFor,
  kieRefusalReason,
  kieUnavailableReason,
  parseFallbackRef,
  readFallbackEnabled,
  readFallbackMap,
  routeKieOrder,
  whyNotFallback,
  type FallbackOrder,
  type FallbackRow,
} from '@/lib/providers/kie-fallback';
import { creditsUsd, type KieBasis } from '@/lib/providers/kie-pricing';
import type { ProviderGenerateParams, ProviderResponse } from '@/types';

class FastKie extends KieProvider {
  protected pollIntervalMs = 0;
  protected retryDelayMs = 0;
}
class FastFal extends FalProvider {
  protected pollIntervalMs = 0;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer by URL (first match wins; a list plays in order, its last answer repeating); record every URL. */
function stubFetch(routes: [RegExp, (() => Response) | (() => Response)[]][]): string[] {
  const calls: string[] = [];
  const queues = routes.map(([, a]) => (Array.isArray(a) ? [...a] : null));
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [i, [pattern, answer]] of routes.entries()) {
      if (!pattern.test(url)) continue;
      const queue = queues[i];
      if (queue) return (queue.length > 1 ? queue.shift()! : queue[0])();
      return (answer as () => Response)();
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CREATE = /api\.kie\.ai\/api\/v1\/jobs\/createTask$/;
const RECORD = /api\.kie\.ai\/api\/v1\/jobs\/recordInfo\?taskId=task-1$/;
const FAL = /queue\.fal\.run\/fal-ai\/flux-pro\/v1\.1$/;

const kieRefuses = (code: number, msg: string) => () => json({ code, msg, data: null });
const kieCreated = () => json({ code: 200, msg: 'success', data: { taskId: 'task-1' } });
const kieDone = () =>
  json({
    code: 200,
    msg: 'success',
    data: { taskId: 'task-1', state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.kie.test/a.png'] }), creditsConsumed: 8 },
  });
const kieFailed = () =>
  json({ code: 200, msg: 'success', data: { taskId: 'task-1', state: 'fail', failCode: '400', failMsg: 'prompt refused' } });
const falDelivers = () => json({ images: [{ url: 'https://fal.media/files/b.png' }] });

const order: ProviderGenerateParams = {
  modelId: 'kie/flux-2-pro',
  prompt: 'a lighthouse at dawn',
  aspectRatio: '1:1',
  apiKey: 'kie-key',
  extraParams: { kieTier: '1K', resolution: '1K', duration: undefined },
};

/** One studio order through the router: KIE, then fal's FLUX Pro as its fallback. */
async function route(opts: { enabled?: boolean; fallback?: boolean } = {}) {
  let picked = 0;
  const outcome = await routeKieOrder<string>({
    kie: () => new FastKie().generateImage(order),
    enabled: opts.enabled ?? true,
    pick: async () => {
      picked++;
      if (opts.fallback === false) return null;
      return {
        target: 'fal:fal-ai/flux-pro/v1.1',
        run: () =>
          new FastFal().generateImage({
            ...order,
            modelId: 'fal-ai/flux-pro/v1.1',
            apiKey: 'fal-key',
            extraParams: fallbackParams(order.extraParams),
          }),
      };
    },
  });
  return { outcome, picked };
}

test('KIE delivers: the order stays on KIE and no fallback is looked up', async () => {
  const calls = stubFetch([[CREATE, kieCreated], [RECORD, kieDone], [FAL, falDelivers]]);
  const { outcome, picked } = await route();
  assert.equal(outcome.via, 'kie');
  assert.equal(outcome.result.success, true);
  assert.equal(outcome.result.resultUrl, 'https://tempfile.kie.test/a.png');
  assert.equal(picked, 0);
  assert.ok(!calls.some((u) => FAL.test(u)), 'fal never called');
});

test('KIE 402: the order moves to the fallback, which delivers it', async () => {
  const calls = stubFetch([[CREATE, kieRefuses(402, 'Credits insufficient')], [FAL, falDelivers]]);
  const { outcome, picked } = await route();
  assert.equal(outcome.via, 'fallback');
  assert.equal(picked, 1);
  assert.equal(outcome.result.success, true);
  assert.equal(outcome.result.resultUrl, 'https://fal.media/files/b.png');
  if (outcome.via !== 'fallback') return;
  assert.equal(outcome.target, 'fal:fal-ai/flux-pro/v1.1');
  assert.equal(outcome.reason, 'เครดิต KIE หมด (402)');
  // KIE's refusal is kept for the key's record: a 402 counts against it.
  assert.match(outcome.kie?.error ?? '', /^KIE 402\b/);
  assert.notEqual(outcome.kie?.orderFault, true);
  // KIE never queued it: no status read.
  assert.ok(!calls.some((u) => RECORD.test(u)));
});

test('a refused prompt is the order\'s: refunded on KIE, never moved', async () => {
  const calls = stubFetch([[CREATE, kieRefuses(422, 'prompt violates content policy')], [FAL, falDelivers]]);
  const { outcome, picked } = await route();
  assert.equal(outcome.via, 'kie');
  assert.equal(outcome.result.success, false);
  assert.equal(outcome.result.orderFault, true);
  assert.notEqual(outcome.result.retryElsewhere, true);
  assert.equal(picked, 0);
  assert.ok(!calls.some((u) => FAL.test(u)));
});

test('a render that failed after KIE took it stays with KIE (it may still bill)', async () => {
  stubFetch([[CREATE, kieCreated], [RECORD, kieFailed], [FAL, falDelivers]]);
  const { outcome, picked } = await route();
  assert.equal(outcome.via, 'kie');
  assert.equal(outcome.result.success, false);
  assert.equal(outcome.result.orderFault, true);
  assert.equal(picked, 0);
});

test('fallback switched off: a 402 is refunded on KIE, nothing else is tried', async () => {
  const calls = stubFetch([[CREATE, kieRefuses(402, 'Credits insufficient')], [FAL, falDelivers]]);
  const { outcome, picked } = await route({ enabled: false });
  assert.equal(outcome.via, 'kie');
  assert.equal(outcome.via === 'kie' && outcome.skipped, 'off');
  assert.equal(outcome.result.success, false);
  assert.equal(picked, 0);
  assert.ok(!calls.some((u) => FAL.test(u)));
});

test('no fallback row can take it: refunded on KIE', async () => {
  stubFetch([[CREATE, kieRefuses(402, 'Credits insufficient')]]);
  const { outcome, picked } = await route({ fallback: false });
  assert.equal(outcome.via, 'kie');
  assert.equal(outcome.via === 'kie' && outcome.skipped, 'none');
  assert.equal(picked, 1);
  assert.equal(outcome.result.success, false);
});

test('rate limit after its retries, maintenance, an outage, a refused key: all move', async () => {
  for (const [code, reason] of [
    [429, 'KIE จำกัดจำนวนคำสั่ง (429)'],
    [455, 'KIE ปิดปรับปรุงระบบ (455)'],
    [500, 'KIE ขัดข้อง (500)'],
    [401, 'KIE ไม่รับคีย์ (401)'],
  ] as const) {
    const calls = stubFetch([[CREATE, kieRefuses(code, 'no')], [FAL, falDelivers]]);
    const { outcome } = await route();
    assert.equal(outcome.via, 'fallback', `code ${code}`);
    assert.equal(outcome.via === 'fallback' && outcome.reason, reason);
    if (code === 429) assert.equal(calls.filter((u) => CREATE.test(u)).length, 3, 'createTask tried three times first');
  }
});

test('KIE unreachable at createTask: moves', async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (CREATE.test(String(input))) throw new TypeError('fetch failed');
    return falDelivers();
  }) as typeof fetch;
  const { outcome } = await route();
  assert.equal(outcome.via, 'fallback');
  assert.equal(outcome.via === 'fallback' && outcome.reason, 'ติดต่อ KIE ไม่ได้');
});

test('no usable KIE key: straight to the fallback, KIE not asked', async () => {
  const calls = stubFetch([[FAL, falDelivers]]);
  const outcome = await routeKieOrder<string>({
    kie: null,
    unavailable: 'คีย์ KIE พักชั่วคราวหลังข้อผิดพลาด',
    enabled: true,
    pick: async () => ({
      target: 'fal',
      run: () => new FastFal().generateImage({ ...order, modelId: 'fal-ai/flux-pro/v1.1', apiKey: 'fal-key' }),
    }),
  });
  assert.equal(outcome.via, 'fallback');
  if (outcome.via !== 'fallback') return;
  assert.equal(outcome.kie, null);
  assert.equal(outcome.reason, 'คีย์ KIE พักชั่วคราวหลังข้อผิดพลาด');
  assert.ok(!calls.some((u) => CREATE.test(u)));
});

test('the fallback failing too ends as one failed result (refunded once by the caller)', async () => {
  stubFetch([[CREATE, kieRefuses(402, 'x')], [FAL, () => json({ detail: 'bad' }, 422)]]);
  const { outcome } = await route();
  assert.equal(outcome.via, 'fallback');
  assert.equal(outcome.result.success, false);
});

// ---------------------------------------------------------------------------
// Which row may stand in
// ---------------------------------------------------------------------------

const row = (over: Partial<FallbackRow> = {}): FallbackRow => ({
  providerSlug: 'fal',
  providerActive: true,
  modelId: 'fal-ai/flux-pro/v1.1',
  category: 'image',
  subcategory: 'premium',
  isActive: true,
  readiness: 'ready',
  maxDuration: null,
  costPerUnit: 0.05,
  ...over,
});
const picture = (over: Partial<FallbackOrder> = {}): FallbackOrder => ({
  kieKey: 'kie/flux-2-pro',
  references: 0,
  firstFrame: false,
  lastFrame: false,
  seconds: null,
  clip: null,
  voice: null,
  ...over,
});

test('whyNotFallback: a plain picture order fits a ready picture row of another provider', () => {
  assert.equal(whyNotFallback(picture(), row()), null);
  assert.equal(whyNotFallback(picture(), row({ readiness: 'tuning' })), 'ยังไม่ผ่านการทดสอบ');
  assert.equal(whyNotFallback(picture(), row({ isActive: false })), 'โมเดลถูกปิด');
  assert.equal(whyNotFallback(picture(), row({ providerActive: false })), 'ผู้ให้บริการถูกปิด');
  assert.equal(whyNotFallback(picture(), row({ category: 'video' })), 'คนละประเภทงาน');
  assert.equal(whyNotFallback(picture(), row({ providerSlug: 'kie' })), 'เป็นโมเดลของ KIE หรือเครื่องเช่า');
  assert.equal(whyNotFallback(picture(), row({ subcategory: 'upscale' })), 'ทำงานคนละแบบ');
});

test('whyNotFallback: references, frames and length must all fit', () => {
  // fal's FLUX Pro takes no reference; gpt-image-1 takes 16.
  const refs = picture({ kieKey: 'kie/nano-banana-2-1', references: 3 });
  assert.equal(whyNotFallback(refs, row()), 'ไม่รับภาพอ้างอิง');
  assert.equal(whyNotFallback(refs, row({ providerSlug: 'openai', modelId: 'gpt-image-1' })), null);
  assert.equal(
    whyNotFallback(picture({ kieKey: 'kie/nano-banana-2-1', references: 12 }), row({ providerSlug: 'byteplus', modelId: 'seedream-5.0' })),
    'รับภาพอ้างอิงได้ 10 ภาพ'
  );
  // An opening frame only reaches models wired for it; Sora's row is not.
  const clip = picture({ kieKey: 'kie/veo-3-1', seconds: 8 });
  const sora = row({ providerSlug: 'openai', modelId: 'sora-2', category: 'video', subcategory: 'premium', maxDuration: 20 });
  assert.equal(whyNotFallback(clip, sora), null);
  assert.equal(whyNotFallback({ ...clip, firstFrame: true }, sora), 'ไม่รับภาพเฟรมแรก');
  assert.equal(whyNotFallback({ ...clip, seconds: 25 }, sora), 'ยาวได้ไม่เกิน 20 วินาที');
});

test('whyNotFallback: a lip-sync row checks the order\'s clip and voice by its own rule', () => {
  const dub = picture({ kieKey: 'kie/volcengine-lipsync' });
  const kling = row({ modelId: 'fal-ai/kling-video/lipsync/audio-to-video', category: 'video', subcategory: 'lipsync' });
  assert.equal(whyNotFallback(dub, kling), 'ไม่มีข้อมูลคลิปและเสียงของออร์เดอร์');
  const facts = { seconds: 8, width: 1280, height: 720, bytes: 4_000_000, ext: 'mp4' };
  assert.equal(whyNotFallback({ ...dub, clip: facts, voice: { seconds: 6, bytes: 200_000 } }, kling), null);
  // Kling takes 2–10 s of clip.
  assert.notEqual(whyNotFallback({ ...dub, clip: { ...facts, seconds: 14 }, voice: { seconds: 6, bytes: 200_000 } }, kling), null);
});

// ---------------------------------------------------------------------------
// Never at a loss
// ---------------------------------------------------------------------------

/** A credit sold at ฿0.50 with ฿36 to the dollar: 36 credits bring in $0.50. */
const basis: KieBasis = { usdToThb: 36, thbPerCredit: 0.5, markup: 2 };

test('creditsUsd: credits at the cheapest rate they sell for, in dollars', () => {
  assert.equal(creditsUsd(36, basis), 0.5);
  assert.equal(creditsUsd(0, basis), 0);
  assert.equal(creditsUsd(Number.NaN, basis), 0);
  // A basis with no rate falls back to the seed's (฿2,499 for 6,500 credits, ฿36/$).
  assert.ok(Math.abs(creditsUsd(6500, { usdToThb: 0, thbPerCredit: 0, markup: 2 }) - 2499 / 36) < 1e-9);
});

test('fallbackCostUsd: one output; a video pro rata past 5 s; a re-dub by its own billing blocks', () => {
  assert.equal(fallbackCostUsd(row(), picture()), 0.05);
  const sora = row({ modelId: 'sora-2', category: 'video', costPerUnit: 0.5 });
  assert.equal(fallbackCostUsd(sora, { seconds: null, clip: null }), 0.5);
  assert.equal(fallbackCostUsd(sora, { seconds: 4, clip: null }), 0.5);
  assert.ok(Math.abs(fallbackCostUsd(sora, { seconds: 8, clip: null }) - 0.8) < 1e-9);
  // Kling's re-dub bills every started 5 s of clip.
  const kling = row({ modelId: 'fal-ai/kling-video/lipsync/audio-to-video', category: 'video', costPerUnit: 0.2 });
  const facts = { seconds: 8, width: 1280, height: 720, bytes: 4_000_000, ext: 'mp4' };
  assert.ok(Math.abs(fallbackCostUsd(kling, { seconds: 8, clip: facts }) - 0.4) < 1e-9);
  // A row with no cost set costs nothing in the books, so nothing here.
  assert.equal(fallbackCostUsd(row({ costPerUnit: Number.NaN }), picture()), 0);
});

test('fallbackLoss: used when what the customer paid covers it, refused when it does not', () => {
  const sora = row({ modelId: 'sora-2', category: 'video', costPerUnit: 0.5 });
  assert.equal(fallbackLoss(sora, { seconds: 5, clip: null }, 36, basis), null, 'break-even is not a loss');
  assert.equal(fallbackLoss(sora, { seconds: 5, clip: null }, 100, basis), null);
  assert.equal(
    fallbackLoss(sora, { seconds: 8, clip: null }, 36, basis),
    'ขาดทุน: ต้นทุน $0.80 มากกว่าที่ลูกค้าจ่าย $0.50'
  );
  assert.notEqual(fallbackLoss(row({ costPerUnit: 0.06 }), picture(), 4, basis), null);
});

test('KIE 402 and the only fallback would lose money: refunded on KIE, fal never called', async () => {
  const calls = stubFetch([[CREATE, kieRefuses(402, 'Credits insufficient')], [FAL, falDelivers]]);
  const skipped: string[] = [];
  const outcome = await routeKieOrder<string>({
    kie: () => new FastKie().generateImage(order),
    enabled: true,
    // What pickFallback does with the row it found: the loss check first.
    pick: async () => {
      const loss = fallbackLoss(row({ costPerUnit: 0.5 }), picture(), 4, basis);
      if (loss) {
        skipped.push(`fal:fal-ai/flux-pro/v1.1: ${loss}`);
        return null;
      }
      return { target: 'fal', run: () => new FastFal().generateImage({ ...order, modelId: 'fal-ai/flux-pro/v1.1', apiKey: 'fal-key' }) };
    },
  });
  assert.equal(outcome.via, 'kie');
  assert.equal(outcome.via === 'kie' && outcome.skipped, 'none');
  assert.equal(outcome.result.success, false);
  assert.match(skipped[0], /ขาดทุน/);
  assert.ok(!calls.some((u) => FAL.test(u)), 'fal never called');
});

test('fallbackParams: KIE\'s own keys never reach another provider', () => {
  const out = fallbackParams({
    kieTier: '4K', resolution: '4K', quality: 'high', voice: 'Kore', speechStyle: 'calm', music: {}, route: {},
    inputAudio: 'a', inputVideo: 'v', inputImageEnd: 'e', referenceImages: ['r'], aspectRatio: '16:9', duration: 8, numOutputs: 4,
  });
  assert.deepEqual(out, { aspectRatio: '16:9', duration: 8, numOutputs: 1 });
});

test('the map: catalogue defaults, admin overrides, bad entries dropped', () => {
  assert.deepEqual(fallbackRefsFor('kie/flux-2-pro', {}), KIE_FALLBACKS['kie/flux-2-pro']);
  assert.deepEqual(fallbackRefsFor('kie/flux-2-pro', { 'kie/flux-2-pro': [] }), [], 'an empty list switches it off');
  assert.deepEqual(fallbackRefsFor('kie/elevenlabs-v3', {}), []);
  const map = readFallbackMap(JSON.stringify({
    'kie/flux-2-pro': ['fal:fal-ai/flux/dev', 'fal:fal-ai/flux/dev', 'kie:kie/z-image', 'simplepod:ltx-2.5', 'nonsense', 7],
    'kie/not-a-model': ['fal:fal-ai/flux/dev'],
    'kie/z-image': 'fal:fal-ai/flux/schnell',
  }));
  assert.deepEqual(map, { 'kie/flux-2-pro': ['fal:fal-ai/flux/dev'] });
  assert.deepEqual(readFallbackMap('not json'), {});
  assert.equal(cleanRefs(Array.from({ length: 9 }, (_, i) => `fal:m-${i}`)).length, 5);
  assert.deepEqual(parseFallbackRef('fal:fal-ai/flux/dev'), { provider: 'fal', modelId: 'fal-ai/flux/dev' });
  assert.equal(readFallbackEnabled(null), true);
  assert.equal(readFallbackEnabled('false'), false);
});

test('every catalogue default names a KIE model and a row that could be a fallback', () => {
  for (const [key, refs] of Object.entries(KIE_FALLBACKS)) {
    const entry = getKieEntry(key);
    assert.ok(entry, `${key} is in the catalogue`);
    assert.deepEqual(cleanRefs(refs), refs, `${key}: refs parse, distinct, at most 5`);
  }
  // Nothing that has no equivalent elsewhere pretends to.
  for (const entry of KIE_CATALOG.filter((e) => e.speech || e.music || e.sourceClip)) {
    assert.ok(!(entry.key in KIE_FALLBACKS), `${entry.key} has no fallback`);
  }
});

test('refusal reasons read the adapter\'s own wording', () => {
  const r = (error: string): Pick<ProviderResponse, 'error'> => ({ error });
  assert.equal(kieRefusalReason(r('KIE 402 insufficient credits: x')), 'เครดิต KIE หมด (402)');
  assert.equal(kieRefusalReason(r('KIE 403 API key refused')), 'KIE ไม่รับคีย์ (403)');
  assert.equal(kieRefusalReason(r('KIE error 505: disabled')), 'KIE ปิดโมเดลนี้ชั่วคราว (505)');
  assert.equal(kieRefusalReason(r('KIE error 503')), 'KIE ขัดข้อง (503)');
  assert.equal(kieRefusalReason(r('KIE request failed: fetch failed')), 'ติดต่อ KIE ไม่ได้');
  assert.equal(kieUnavailableReason([]), 'ยังไม่มีคีย์ KIE');
  assert.equal(kieUnavailableReason(['inactive', 'cooldown']), 'คีย์ KIE พักชั่วคราวหลังข้อผิดพลาด');
});
