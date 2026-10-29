/**
 * The KIE.ai catalogue and its prices.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/kie-catalog.test.mts)
 *
 * The studio and GenerationService both price a KIE order with `kieQuote`
 * over the table the sync stores in `defaultParams.kie` — public through
 * /api/models, so it must carry credits only, never the vendor's dollars.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KIE_CATALOG, getKieEntry, kieImageCount, kiePriceTable, nearestAspect, type KieOrder } from '@/lib/providers/kie-catalog';
import { DEFAULT_KIE_BASIS, kieCredits, kieQuote, pickKieDuration, readKiePriceTable } from '@/lib/providers/kie-pricing';
import { referenceCaps } from '@/lib/reference-caps';
import { apiVideoLipsyncRule } from '@/lib/lipsync-rules';

const order = (over: Partial<KieOrder> = {}): KieOrder => ({
  prompt: 'a lighthouse at dusk',
  tier: '',
  seconds: null,
  images: [],
  ...over,
});

test('credits: twice the cost at the cheapest package rate, rounded up, never zero', () => {
  // $0.02 × ฿36 × 2 / (฿2,499 / 6,500) = 3.75 → 4.
  assert.equal(kieCredits(0.02), 4);
  assert.equal(kieCredits(0.09), 17);
  assert.equal(kieCredits(0.0025), 1);
  assert.equal(kieCredits(0), 1);
  assert.equal(kieCredits(Number.NaN), 1);
  // Float noise just above a whole number is not another credit.
  const basis = { usdToThb: 1, thbPerCredit: 0.1, markup: 1 };
  assert.equal(kieCredits(0.3, basis), 3);
  // A broken rate falls back to the seed rate instead of dividing by zero.
  assert.equal(kieCredits(0.02, { ...DEFAULT_KIE_BASIS, thbPerCredit: 0 }), 4);
});

test('every entry: a unique kie/ key, a default tier, a price for each tier, a sane wait', () => {
  const keys = new Set<string>();
  for (const e of KIE_CATALOG) {
    assert.match(e.key, /^kie\/[a-z0-9-]+$/, e.key);
    assert.ok(!keys.has(e.key), `duplicate ${e.key}`);
    keys.add(e.key);
    assert.ok(e.tiers.length > 0, e.key);
    assert.equal(e.tiers.filter((t) => t.isDefault).length, 1, `${e.key}: one default tier`);
    assert.ok(e.maxWaitSeconds >= 60 && e.maxWaitSeconds <= 60 * 60, e.key);
    for (const t of e.tiers) {
      for (const s of e.durations ?? [1]) {
        const usd = e.usd(t.id, s);
        assert.ok(Number.isFinite(usd) && usd > 0 && usd < 20, `${e.key} ${t.id} ${s}s → ${usd}`);
      }
    }
    // A tier chip the studio cannot show would be a price the customer never sees.
    if (e.tiers.length > 1) assert.ok(e.tierParam, `${e.key}: several tiers need a tierParam`);
    if (e.category === 'image') assert.ok((e.references ?? 0) <= 16, e.key);
    if (e.lastFrame) assert.ok(e.firstFrame, `${e.key}: a last frame needs a first`);
  }
});

test('every entry builds a task with a model and no empty values, for every tier', () => {
  const frame = 'https://cdn.example.test/uploads/7/image/f.png';
  for (const e of KIE_CATALOG) {
    for (const t of e.tiers) {
      const task = e.build(order({
        tier: t.id,
        seconds: e.perSecond ? 6 : e.durations?.[0] ?? null,
        aspectRatio: '16:9',
        images: e.category === 'image' && e.references ? [frame, frame] : [],
        image: e.category === 'edit' || e.firstFrame || e.subcategory.startsWith('lipsync') ? frame : undefined,
        audio: e.subcategory.startsWith('lipsync') ? 'https://cdn.example.test/uploads/7/audio/v.mp3' : undefined,
        video: e.subcategory === 'lipsync' ? 'https://cdn.example.test/uploads/7/video/c.mp4' : undefined,
      }));
      assert.ok(typeof task.model === 'string' && task.model.length > 0, e.key);
      for (const [k, v] of Object.entries(task.input)) {
        assert.ok(v !== undefined && v !== null && v !== '', `${e.key}: ${k} is empty`);
      }
    }
  }
});

test('a model never gets more references than it takes', () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://cdn.example.test/uploads/7/image/${i}.png`);
  for (const e of KIE_CATALOG.filter((x) => x.category === 'image')) {
    const input = e.build(order({ tier: e.tiers[0].id, images: many.slice(0, e.references ?? 0) })).input;
    const sent = Object.values(input).filter(Array.isArray).flat().filter((v) => typeof v === 'string' && v.startsWith('https://'));
    assert.ok(sent.length <= (e.references ?? 0), `${e.key} sent ${sent.length}`);
  }
});

test('the price table holds whole credits only — no dollars reach /api/models', () => {
  for (const e of KIE_CATALOG) {
    const table = kiePriceTable(e);
    const text = JSON.stringify(table);
    assert.doesNotMatch(text, /usd/i, e.key);
    for (const row of Object.values(table.credits)) {
      for (const n of Object.values(row)) assert.ok(Number.isInteger(n) && n >= 1, `${e.key} ${n}`);
    }
    // What the sync stores is what GenerationService reads back.
    assert.deepEqual(JSON.parse(JSON.stringify(readKiePriceTable({ kie: JSON.parse(text) }))), JSON.parse(text), e.key);
  }
});

test('a malformed stored table is ignored, not trusted', () => {
  assert.equal(readKiePriceTable(null), null);
  assert.equal(readKiePriceTable({ kie: { tiers: [], credits: {} } }), null);
  assert.equal(readKiePriceTable({ kie: { tiers: [{ id: 'a', label: 'A' }], credits: { a: { '*': -3 } } } }), null);
  assert.equal(readKiePriceTable({ kie: { tiers: [{ id: 'a', label: 'A' }], credits: {} } }), null);
  const t = readKiePriceTable({ kie: { tierParam: 'evil', tiers: [{ id: 'a', label: 'A' }], credits: { a: { '*': 2.5, x: 3 } }, imageCredits: -1 } });
  assert.equal(t?.tierParam, null);
  assert.deepEqual(t?.credits, { a: { x: 3 } });
  assert.equal(t?.imageCredits, undefined);
});

test('quotes: by tier, by sold length, by voice second, and per extra picture', () => {
  const nano = kiePriceTable(getKieEntry('kie/nano-banana-2-1')!);
  assert.equal(kieQuote(nano, { tier: '1K' }), kieCredits(0.02));
  assert.equal(kieQuote(nano, { tier: '4K' }), kieCredits(0.045));
  // An unknown tier is the default (1K), exactly as the adapter sends it.
  assert.equal(kieQuote(nano, { tier: '16K' }), kieQuote(nano, {}));

  const kling = kiePriceTable(getKieEntry('kie/kling-3')!);
  assert.deepEqual(kling.durations, [5, 10, 15]);
  assert.equal(kieQuote(kling, { tier: '1080p', seconds: 10 }), kieCredits(0.135 * 10));
  // A length not sold is the shortest, the same snap the adapter applies.
  assert.equal(pickKieDuration(kling, 7), 5);
  assert.equal(kieQuote(kling, { tier: '720p', seconds: 7 }), kieCredits(0.1 * 5));

  const avatar = kiePriceTable(getKieEntry('kie/kling-avatar')!);
  assert.equal(avatar.perSecond, true);
  assert.equal(kieQuote(avatar, { seconds: 7.2 }), kieCredits(0.04) * 8);
  assert.equal(kieQuote(avatar, { seconds: 0 }), kieCredits(0.04));

  const seedream = kiePriceTable(getKieEntry('kie/seedream-5-pro')!);
  const base = kieQuote(seedream, { tier: 'basic' });
  assert.equal(kieQuote(seedream, { tier: 'basic', images: 1 }), base);
  assert.equal(kieQuote(seedream, { tier: 'basic', images: 4 }), base + 3 * kieCredits(0.0025));
});

test('billable pictures: references up to the cap; a clip’s frames only where the model takes them', () => {
  const nano = getKieEntry('kie/nano-banana-2-1')!;
  assert.equal(kieImageCount(nano, { references: 14 }), 10);
  const kling = getKieEntry('kie/kling-3')!;
  assert.equal(kieImageCount(kling, { references: 0, inputImage: 'a', inputImageEnd: 'b' }), 2);
  const grok = getKieEntry('kie/grok-imagine-video')!;
  assert.equal(kieImageCount(grok, { references: 0, inputImage: 'a', inputImageEnd: 'b' }), 1);
  assert.equal(kieImageCount(kling, { references: 0 }), 0);
});

test('the studio’s reference caps follow the catalogue', () => {
  for (const e of KIE_CATALOG) {
    const caps = referenceCaps({ providerSlug: 'kie', modelId: e.key, category: e.category });
    if (e.category === 'image') assert.equal(caps.images, e.references ?? 0, e.key);
    if (e.category === 'video') {
      assert.equal(caps.firstFrame, e.firstFrame === true, e.key);
      assert.equal(caps.lastFrame, e.lastFrame === true, e.key);
    }
  }
  // An admin's lower cap still wins; a higher one is held at what the adapter forwards.
  const capped = (n: number) =>
    referenceCaps({ providerSlug: 'kie', modelId: 'kie/nano-banana-pro', category: 'image', defaultParams: { maxReferenceImages: n } }).images;
  assert.equal(capped(2), 2);
  assert.equal(capped(40), 8);
});

test('the clip re-dub has its upload rules; portraits are priced by their voice', () => {
  for (const e of KIE_CATALOG) {
    if (e.subcategory === 'lipsync') assert.ok(apiVideoLipsyncRule(e.key), `${e.key}: no lipsync-rules entry`);
    if (e.subcategory === 'lipsync-portrait') {
      assert.ok(e.perSecond && e.lengthFromAudio, `${e.key}: a portrait is priced by its voice`);
      assert.ok(e.firstFrame !== true, `${e.key}: the face is the portrait's image, not a frame`);
    }
  }
});

test('nearest aspect: the model’s own shape closest to the order', () => {
  assert.equal(nearestAspect('3:2', ['1:1', '16:9', '9:16', '4:3', '3:4']), '4:3');
  assert.equal(nearestAspect('2:3', ['1:1', '16:9', '9:16']), '9:16');
  assert.equal(nearestAspect('16:9', ['1:1', '16:9']), '16:9');
  assert.equal(nearestAspect(undefined, ['auto', '1:1'], 'auto'), 'auto');
  assert.equal(nearestAspect('wide', ['1:1', '16:9']), '1:1');
});

test('the picker test lists every catalogue key', () => {
  const src = readFileSync('src/lib/__tests__/model-samples.test.mts', 'utf8');
  for (const e of KIE_CATALOG) assert.ok(src.includes(`'${e.key}'`), `${e.key} missing from model-samples LIVE_IDS`);
});
