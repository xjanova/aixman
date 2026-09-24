/**
 * The content gate: which orders are refused, which never reach a home PC.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/safety/__tests__/content-tier.test.mts)
 *
 * Two kinds of mistake are pinned here. A forbidden request that slips
 * through (a child and a sexual word, a celebrity and a nude, "undress her"
 * next to an uploaded photo), and an ordinary request refused for a word that
 * only looks bad ("nude lipstick", "grape", "pedometer", a treasure chest
 * called หีบ). Owner decision D4: forbidden is refused before charging; adult
 * and anything unreadable never runs on a community machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  blockedMessage,
  classifyContent,
  isCommunitySafe,
  normalizeText,
  readContentTier,
  type ContentInput,
} from '@/lib/safety/content-tier';

const tier = (prompt: string, extra: Omit<ContentInput, 'prompt'> = {}) => classifyContent({ prompt, ...extra }).tier;

test('ordinary prompts, English and Thai, are general', () => {
  for (const prompt of [
    'a lighthouse at dusk, oil painting',
    'Beautiful portrait of a young woman, soft natural lighting, bokeh background',
    'แมวส้มนอนบนโซฟา แสงอบอุ่นยามเย็น',
    'ตลาดน้ำอัมพวา ภาพถ่ายมุมสูง',
    'a treasure chest (หีบสมบัติ) on the beach',
    'a bowl of grapes and a drape on the table',
    'runner checking her pedometer in the park',
    'cyberpunk city at night, 4k, 1girl walking in the rain',
    'nude lipstick and nude heels, fashion product shot',
    'a nude-colored dress on a mannequin',
    'data analysis chart for a therapist office in Essex',
    'a star visible to the naked eye over the desert',
    'summa cum laude graduation photo',
    'a child flying a kite on a windy hill',
    'เด็กๆ เล่นน้ำที่ชายหาด',
    'a see-through glass teapot on a wooden table',
  ]) {
    assert.equal(tier(prompt), 'general', prompt);
  }
});

test('nudity and sex, however written, are adult', () => {
  for (const prompt of [
    'nude woman on a bed, nsfw',
    'NAKED couple',
    'erotic photo shoot',
    'woman in lingerie, sexy pose',
    'ภาพโป๊ผู้หญิง',
    'ผู้หญิงเปลือยกาย',
    'สาวเซ็กซี่ในชุดชั้นใน',
    'ฉากร่วมรักบนเตียง',
    's3xy girl',
    'n u d e model',
    'p.o.r.n star',
    'ｎｕｄｅ',
    'nu​de model',
    'woman, 18+',
    'woman \u{1F51E}',
    'โ ป๊',
  ]) {
    assert.equal(tier(prompt), 'adult', prompt);
  }
});

test('sexual words in the negative prompt ask for a clean image, not an adult one', () => {
  assert.equal(tier('a woman reading in a cafe', { negativePrompt: 'nsfw, nude, lowres, bad anatomy' }), 'general');
  assert.equal(tier('portrait of a man', { negativePrompt: 'โป๊, ลามก' }), 'general');
});

test('asking for the clothes to go through the negative prompt is adult', () => {
  const result = classifyContent({ prompt: 'a woman standing in a garden', negativePrompt: 'clothes, clothing' });
  assert.equal(result.tier, 'adult');
  assert.ok(result.reasons.includes('negative-strips-clothes'));
  assert.equal(tier('ผู้หญิงยืนในสวน', { negativePrompt: 'เสื้อผ้า' }), 'adult');
});

test('a minor next to anything sexual or suggestive is refused', () => {
  for (const prompt of [
    'nude child',
    'sexy schoolgirl',
    'teen girl in lingerie',
    'little girl, nsfw',
    '15 year old girl, naked',
    '12yo, sexy pose',
    'girl aged 16, topless',
    'fourteen-year-old model, erotic',
    'เด็กผู้หญิงโป๊',
    'นักเรียนหญิงเซ็กซี่',
    'สาวอายุ 15 เปลือย',
    'loli, nude',
    'l0li nude',
    's c h o o l g i r l nude',
  ]) {
    const result = classifyContent({ prompt });
    assert.equal(result.tier, 'blocked', prompt);
    assert.equal(result.blocked, 'minor-sexual', prompt);
  }
});

test('a child with the clothes removed through the negative prompt is refused', () => {
  const result = classifyContent({ prompt: 'a child standing by a pool', negativePrompt: 'clothes' });
  assert.equal(result.blocked, 'minor-sexual');
});

test('an adult age is not a minor', () => {
  assert.equal(tier('25 year old woman, nude'), 'adult');
  assert.equal(tier('สาววัย 30 เซ็กซี่'), 'adult');
});

test('words that are CSAM on their own are refused without any other word', () => {
  for (const prompt of ['lolicon art', 'jailbait', 'child porn', 'โลลิคอน', 'ภาพอนาจารเด็ก']) {
    assert.equal(classifyContent({ prompt }).blocked, 'minor-sexual', prompt);
  }
});

test('sexual content of a real, identifiable person is refused', () => {
  for (const prompt of [
    'famous actress nude',
    'celebrity naked on the beach',
    'deepfake porn of a singer',
    'my ex-girlfriend nude',
    'my coworker naked',
    'ดาราเปลือย',
    'แฟนเก่าของฉันโป๊',
    'face swap nude',
  ]) {
    assert.equal(classifyContent({ prompt }).blocked, 'real-person-sexual', prompt);
  }
  // A real person, dressed, is just a portrait of a public figure.
  assert.equal(tier('a celebrity on the red carpet'), 'general');
});

test('undressing an attached photo is refused; the same words without one are adult', () => {
  const attached = classifyContent({ prompt: 'undress her', hasInputMedia: true });
  assert.equal(attached.tier, 'blocked');
  assert.equal(attached.blocked, 'real-person-sexual');
  assert.equal(classifyContent({ prompt: 'remove her clothes', hasInputMedia: true }).blocked, 'real-person-sexual');
  assert.equal(classifyContent({ prompt: 'ถอดเสื้อผ้าออก', hasInputMedia: true }).blocked, 'real-person-sexual');
  assert.equal(tier('undress her'), 'adult');
  // Taking off a coat is not undressing.
  assert.equal(tier('ถอดเสื้อคลุมออก', { hasInputMedia: true }), 'general');
});

test('sexual violence, bestiality and necrophilia are refused', () => {
  assert.equal(classifyContent({ prompt: 'rape scene' }).blocked, 'sexual-violence');
  assert.equal(classifyContent({ prompt: 'ฉากข่มขืน' }).blocked, 'sexual-violence');
  assert.equal(classifyContent({ prompt: 'bestiality' }).blocked, 'bestiality');
  assert.equal(classifyContent({ prompt: 'necrophilia' }).blocked, 'necrophilia');
});

test('words the lexicon cannot read are unknown, never general', () => {
  assert.equal(tier('裸の女性'), 'unknown');
  assert.equal(tier('обнажённая женщина'), 'unknown');
  // A single Cyrillic letter hiding in an English word.
  assert.equal(tier('nаked'), 'unknown');
  assert.equal(tier('a cat', { negativePrompt: '衣服' }), 'unknown');
  assert.deepEqual(classifyContent({ prompt: '   ' }), { tier: 'unknown', reasons: ['no-text'] });
  assert.equal(classifyContent({ prompt: '', hasInputMedia: true }).tier, 'unknown');
});

test('a style suffix and song lyrics are read too', () => {
  assert.equal(tier('a woman on a beach', { extraText: [', erotic photography'] }), 'adult');
  assert.equal(tier('a love song', { extraText: ['เนื้อเพลงเกี่ยวกับการเย็ด'] }), 'adult');
});

test('only general work with nothing uploaded may go to a community machine', () => {
  assert.equal(isCommunitySafe({ contentTier: 'general', hasInputMedia: false }), true);
  assert.equal(isCommunitySafe({ contentTier: 'general', hasInputMedia: true }), false);
  assert.equal(isCommunitySafe({ contentTier: 'adult', hasInputMedia: false }), false);
  assert.equal(isCommunitySafe({ contentTier: 'unknown', hasInputMedia: false }), false);
  assert.equal(isCommunitySafe({ contentTier: 'blocked', hasInputMedia: false }), false);
  // A row written before the column existed.
  assert.equal(isCommunitySafe({ contentTier: null, hasInputMedia: null }), false);
});

test('stored tiers are read tolerantly', () => {
  assert.equal(readContentTier('adult'), 'adult');
  assert.equal(readContentTier('GENERAL'), 'unknown');
  assert.equal(readContentTier(null), 'unknown');
});

test('every refusal is Thai and says no credit was taken', () => {
  for (const category of ['minor-sexual', 'real-person-sexual', 'sexual-violence', 'bestiality', 'necrophilia'] as const) {
    const message = blockedMessage(category);
    assert.match(message, /[฀-๿]/);
    assert.match(message, /ไม่ได้หักเครดิต/);
  }
});

test('normalising folds Thai digits, full-width letters and sara am the same way on both sides', () => {
  assert.equal(normalizeText('อายุ ๑๕'), 'อายุ 15');
  assert.equal(normalizeText('ＮＳＦＷ'), 'nsfw');
  assert.equal(tier('สาวอายุ ๑๕ ปี เปลือย'), 'blocked');
  // กระทำชำเรา is written with ำ, which NFKC splits.
  assert.equal(classifyContent({ prompt: 'ฉากกระทำชำเรา' }).blocked, 'sexual-violence');
});

test('a long prompt is classified quickly', () => {
  const long = 'a quiet mountain village at sunrise, '.repeat(280);
  const started = performance.now();
  assert.equal(tier(long), 'general');
  assert.ok(performance.now() - started < 1000);
});
