/**
 * The figures the pricing page adds to each credit package.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/pricing-display.test.mts)
 *
 * What must hold: an estimate never counts work nobody can order, never
 * promises more than the middle of the price range gives, and every package —
 * however many there are and whatever they are called — wears an emblem that
 * rises with its price.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMBLEM_COUNT,
  emblemIndexes,
  extraFeatures,
  howMany,
  parseFeatures,
  pricePerCredit,
  recommendedIndex,
  totalCredits,
  typicalCosts,
  type ModelLike,
  type PackageLike,
} from '@/lib/pricing-display';

const pkg = (priceThb: number | string, over: Partial<PackageLike> = {}): PackageLike => ({
  credits: 100, bonusCredits: 0, priceThb, isFeatured: false, ...over,
});
const model = (category: string, creditsPerUnit: number, over: Partial<ModelLike> = {}): ModelLike => ({
  category, creditsPerUnit, canOrder: true, ...over,
});

test('total credits add the bonus; bad numbers count as nothing', () => {
  assert.equal(totalCredits({ credits: 500, bonusCredits: 50 }), 550);
  assert.equal(totalCredits({ credits: 100, bonusCredits: Number.NaN }), 100);
  assert.equal(totalCredits({ credits: -5, bonusCredits: 0 }), 0);
});

test('price per credit is only for paid packages with credits', () => {
  assert.equal(pricePerCredit(399, 550)?.toFixed(4), '0.7255');
  assert.equal(pricePerCredit(0, 20), null);
  assert.equal(pricePerCredit(99, 0), null);
});

test('typical cost is the upper median of what can be ordered', () => {
  const costs = typicalCosts([
    model('image', 1), model('image', 3), // two orderable → the upper one, 3
    model('image', 1, { canOrder: false }),
    model('image', 1, { canOrder: false }),
    model('video', 8), model('video', 12),
    model('video', 177, { subcategory: 'lipsync-portrait' }), // priced by voice length
    model('video', 10, { subcategory: 'lipsync' }),
    model('audio', 4), model('audio', 20), model('audio', 20),
  ]);
  assert.deepEqual(costs, { image: 3, video: 12, audio: 20 });
});

test('a kind with nothing orderable gets no estimate', () => {
  const costs = typicalCosts([model('image', 2), model('video', 12, { canOrder: false })]);
  assert.deepEqual(costs, { image: 2 });
  assert.deepEqual(typicalCosts([]), {});
});

test('an older API without canOrder still counts its models', () => {
  assert.deepEqual(typicalCosts([{ category: 'image', creditsPerUnit: 4 }]), { image: 4 });
});

test('how many rounds down and survives a zero cost', () => {
  assert.equal(howMany(550, 3), 183);
  assert.equal(howMany(550, 0), 0);
});

test('features: the admin text is read in either shape', () => {
  assert.deepEqual(parseFeatures(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseFeatures('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseFeatures('not json'), []);
  assert.deepEqual(parseFeatures(null), []);
  assert.deepEqual(parseFeatures([1, 'x']), ['x']);
});

test('features the card shows as figures are dropped, estimates only when live ones replace them', () => {
  const lines = ['500 + 50 โบนัส เครดิต', 'ภาพ ~137 ภาพ', 'วิดีโอ ~36 คลิป', 'ประหยัด 20%', 'ไม่มีวันหมดอายุ', '20 เครดิตฟรี'];
  assert.deepEqual(extraFeatures(lines, true), ['ประหยัด 20%', 'ไม่มีวันหมดอายุ']);
  assert.deepEqual(extraFeatures(lines, false), ['ภาพ ~137 ภาพ', 'วิดีโอ ~36 คลิป', 'ประหยัด 20%', 'ไม่มีวันหมดอายุ']);
});

test('emblems: free gets the first, the dearest the grandest, in input order', () => {
  // Today's five packages, as /api/packages lists them.
  const live = [pkg('0'), pkg('99'), pkg('399'), pkg('999'), pkg('2499')];
  assert.deepEqual(emblemIndexes(live), [0, 2, 3, 4, 5]);
  // Order of the input does not matter; the rank by price does.
  assert.deepEqual(emblemIndexes([pkg(2499), pkg(0), pkg(99)]), [5, 0, 4]);
});

test('emblems: more paid packages than emblems clamp to the second, never the free one', () => {
  const many = [10, 20, 30, 40, 50, 60, 70].map(p => pkg(p));
  const idx = emblemIndexes(many);
  assert.equal(idx[idx.length - 1], EMBLEM_COUNT - 1);
  assert.ok(idx.every(i => i >= 1 && i < EMBLEM_COUNT));
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] >= idx[i - 1]);
});

test('the recommended package is the first featured paid one', () => {
  const live = [pkg(0, { isFeatured: true }), pkg(99), pkg(399, { isFeatured: true }), pkg(999, { isFeatured: true })];
  assert.equal(recommendedIndex(live), 2);
  assert.equal(recommendedIndex([pkg(99), pkg(399)]), -1);
});
