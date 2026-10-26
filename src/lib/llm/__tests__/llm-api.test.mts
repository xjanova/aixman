/**
 * The LLM API's money and wire rules, with no database and no upstream.
 *
 * Run: npm test
 *
 * Credits are whole numbers and a request costs a fraction of one, so the
 * carry, the hold and the refund have to add up exactly — a rounding slip is a
 * leak on every request. The stream relay decides what a streamed answer is
 * billed at, and what model name the customer sees.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  costUsdFor,
  isOffPeak,
  isSellable,
  millicreditsFor,
  outputBudget,
  parseLlmConfig,
  promptTokenCeiling,
  reserveCredits,
  settle,
} from '@/lib/llm/pricing';
import { generateApiKey, hashApiKey, readApiKey } from '@/lib/llm/keys';
import { SseRelay, readUsage, tokensFromChars } from '@/lib/llm/sse';
import { salePrice } from '@/lib/llm/presets';

const cfg = parseLlmConfig({
  backend: 'upstream',
  upstreamModel: 'deepseek-flash',
  inputCreditsPerMTok: 20,
  outputCreditsPerMTok: 80,
  maxOutputTokens: 8192,
});

test('config: bad values fall back, missing fields get defaults', () => {
  const c = parseLlmConfig({ inputCreditsPerMTok: -5, outputCreditsPerMTok: 'x', backend: 'weird', maxOutputTokens: 0 });
  assert.equal(c.inputCreditsPerMTok, 0);
  assert.equal(c.outputCreditsPerMTok, 0);
  assert.equal(c.backend, 'upstream');
  assert.equal(c.maxOutputTokens, 1);
  assert.equal(parseLlmConfig(null).contextLength, 131_072);
  assert.equal(isSellable(c), false, 'no price, no upstream model: not on sale');
  assert.equal(isSellable(cfg), true);
  assert.equal(isSellable({ ...cfg, upstreamModel: '' }), false);
  assert.equal(isSellable({ ...cfg, backend: 'gpu', upstreamModel: '' }), true);
});

test('cost: millicredits round up, never down', () => {
  // 1,000 input × 20/M = 0.02 credit = 20 millicredits; 500 output × 80/M = 0.04 = 40.
  const u = (promptTokens: number, completionTokens: number, cachedTokens = 0) => ({ promptTokens, completionTokens, cachedTokens });
  assert.equal(millicreditsFor(u(1000, 500), cfg), 60);
  assert.equal(millicreditsFor(u(1, 0), cfg), 1, 'one token is never free');
  assert.equal(millicreditsFor(u(0, 0), cfg), 0);
  assert.equal(millicreditsFor(u(1_000_000, 1_000_000), cfg), 100_000);
});

test('hold: the worst case, in whole credits, at least one', () => {
  assert.equal(reserveCredits(10, 10, cfg), 1);
  // 100k prompt + 8192 output: 2000 + 655.36 → 2656 millicredits → 3 credits.
  assert.equal(reserveCredits(100_000, 8192, cfg), 3);
  assert.equal(outputBudget(undefined, cfg), 8192);
  assert.equal(outputBudget(100, cfg), 100);
  assert.equal(outputBudget(999_999, cfg), 8192, 'capped at the model limit');
  assert.ok(promptTokenCeiling('สวัสดี') >= 6, 'Thai counts by bytes, a ceiling');
});

test('settle: carry, charge and refund add up to exactly what was used', () => {
  // Held 1, used 600 millicredits on an empty carry: nothing charged yet, 1 back.
  assert.deepEqual(settle(1, 0, 600), { charge: 0, carry: 600, refund: 1 });
  // Next request: 600 more crosses a credit.
  assert.deepEqual(settle(1, 600, 600), { charge: 1, carry: 200, refund: 0 });
  // Held 3, used 2,656 with a carry of 999: charge 3, nothing back.
  assert.deepEqual(settle(3, 999, 2656), { charge: 3, carry: 655, refund: 0 });
  // A worst-case hold always covers the charge, whatever the carry.
  for (const used of [1, 999, 1000, 1001, 2656, 50_000]) {
    for (const carry of [0, 1, 500, 999]) {
      const held = Math.max(1, Math.ceil(used / 1000));
      const s = settle(held, carry, used);
      assert.ok(s.refund >= 0, `held ${held}, carry ${carry}, used ${used}`);
      assert.equal(s.charge * 1000 + s.carry, carry + used, 'nothing created or lost');
    }
  }
  // Used more than held (an upstream counting past our ceiling): refund goes negative.
  assert.equal(settle(1, 0, 3500).refund, -2);
});

test('keys: one format, hashed, read from either header', () => {
  const { key, prefix, hash } = generateApiKey();
  assert.match(key, /^axm-[0-9A-Za-z]{40}$/);
  assert.equal(prefix, key.slice(0, 10));
  assert.equal(hash, hashApiKey(key));
  assert.notEqual(generateApiKey().key, key);
  assert.equal(readApiKey(new Headers({ authorization: `Bearer ${key}` })), key);
  assert.equal(readApiKey(new Headers({ 'x-api-key': key })), key);
  assert.equal(readApiKey(new Headers({ authorization: 'Bearer sk-openai-something' })), null);
  assert.equal(readApiKey(new Headers({ authorization: `Bearer ${key}x` })), null);
  assert.equal(readApiKey(new Headers()), null);
});

test('stream: model relabelled, usage kept, split lines held back', () => {
  const relay = new SseRelay('deepseek-v4.1-flash');
  const chunk1 = 'data: {"id":"1","model":"deepseek-flash","choices":[{"delta":{"content":"สวัส"}}]}\n\ndata: {"id":"1","mod';
  const out1 = relay.push(chunk1);
  assert.match(out1, /"model":"deepseek-v4.1-flash"/);
  assert.ok(!out1.includes('"mod\n'), 'the unfinished line waits');
  const out2 = relay.push('el":"deepseek-flash","choices":[{"delta":{"reasoning_content":"ab","content":"ดี"}}]}\n\n');
  assert.match(out2, /"model":"deepseek-v4.1-flash"/);
  relay.push('data: {"id":"1","model":"deepseek-flash","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}\n\ndata: [DONE]\n\n');
  assert.deepEqual(relay.usage, { promptTokens: 12, completionTokens: 7, cachedTokens: 0 });
  assert.equal(relay.streamedChars, 4 + 2 + 2);
  assert.equal(relay.flush(), '');
});

test('stream: comments, keep-alives and garbage pass through untouched', () => {
  const relay = new SseRelay('m');
  assert.equal(relay.push(': keep-alive\n'), ': keep-alive\n');
  assert.equal(relay.push('data: not json\n'), 'data: not json\n');
  assert.equal(relay.push('data: [DONE]\n'), 'data: [DONE]\n');
  assert.equal(relay.usage, null);
});

test('usage: read when present, estimated from text when not', () => {
  assert.deepEqual(readUsage({ prompt_tokens: 3, completion_tokens: 4 }), { promptTokens: 3, completionTokens: 4, cachedTokens: 0 });
  assert.equal(readUsage({}), null);
  assert.equal(readUsage(null), null);
  assert.equal(tokensFromChars(9), 5);
});

test('preset price: twice cost, at what a credit is worth, rounded up to 0.1', () => {
  // $1.20/M × 2 × ฿36 / ฿1 per credit = 86.4 credits/M.
  assert.equal(salePrice(1.2, 36, 1), 86.4);
  // No packages yet (0 ฿/credit) → treated as ฿1.
  assert.equal(salePrice(0.3, 36, 0), 21.6);
});

test('upstream: only priced fields go out, under its own model id, with usage in the stream', async () => {
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  const { upstreamBody, upstreamChatUrl } = await import('@/lib/llm/gateway');
  const body = upstreamBody(
    { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }], temperature: 0.2, n: 5, logit_bias: { 1: 100 }, user: 'x' },
    cfg,
    512,
    true
  );
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'stream_options', 'temperature']);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(upstreamBody({ messages: [] }, cfg, 1, false).stream_options, undefined);

  assert.equal(upstreamChatUrl('deepseek'), 'https://api.deepseek.com/chat/completions');
  assert.equal(upstreamChatUrl('deepseek', 'https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(upstreamChatUrl('x', null, 'https://proxy.example/v1/chat/completions'), 'https://proxy.example/v1/chat/completions');
  assert.throws(() => upstreamChatUrl('unknown-provider'));
});

test('cache hits are priced apart, and only where a price is set', () => {
  const cached = parseLlmConfig({ ...cfg, cachedInputCreditsPerMTok: 2, inputUsdPerMTok: 0.3, cachedInputUsdPerMTok: 0.03 });
  // 10,000 prompt tokens, 8,000 of them cached: 2,000 × 20 + 8,000 × 2 = 56,000 → 56 millicredits.
  assert.equal(millicreditsFor({ promptTokens: 10_000, completionTokens: 0, cachedTokens: 8_000 }, cached), 56);
  assert.equal(millicreditsFor({ promptTokens: 10_000, completionTokens: 0, cachedTokens: 8_000 }, cfg), 200, 'no cached price: full input price');
  assert.ok(Math.abs(costUsdFor({ promptTokens: 10_000, completionTokens: 0, cachedTokens: 8_000 }, cached) - 0.00084) < 1e-12);
  // More cached than prompt (a confused upstream) never makes tokens free.
  assert.equal(millicreditsFor({ promptTokens: 100, completionTokens: 0, cachedTokens: 5_000 }, cached), 1);
  assert.equal(parseLlmConfig({ cachedInputCreditsPerMTok: '' }).cachedInputCreditsPerMTok, null);
  assert.equal(parseLlmConfig({ cachedInputCreditsPerMTok: 0 }).cachedInputCreditsPerMTok, 0, '0 is a real price (free), not "unset"');
});

test('off-peak: a UTC window, possibly across midnight; the price factor is ours, the cost factor theirs', () => {
  const op = parseLlmConfig({ ...cfg, offPeakStartUtc: '16:30', offPeakEndUtc: '00:30', offPeakCostFactor: 0.5, offPeakPriceFactor: 0.8 });
  assert.equal(isOffPeak(op, new Date('2026-10-26T16:29:00Z')), false);
  assert.equal(isOffPeak(op, new Date('2026-10-26T16:30:00Z')), true);
  assert.equal(isOffPeak(op, new Date('2026-10-27T00:29:00Z')), true);
  assert.equal(isOffPeak(op, new Date('2026-10-27T00:30:00Z')), false);
  const at = new Date('2026-10-26T20:00:00Z');
  assert.equal(millicreditsFor({ promptTokens: 0, completionTokens: 1000 }, op, at), 64, '80 × 0.8');
  assert.equal(millicreditsFor({ promptTokens: 0, completionTokens: 1000 }, op), 80, 'no time given: the full price a hold needs');
  assert.ok(Math.abs(costUsdFor({ promptTokens: 0, completionTokens: 1_000_000 }, { ...op, outputUsdPerMTok: 1.2 }, at) - 0.6) < 1e-12);
  assert.equal(isOffPeak(parseLlmConfig({ offPeakStartUtc: '25:00', offPeakEndUtc: '01:00' }), at), false, 'a bad time is no window');
  assert.equal(parseLlmConfig({ offPeakPriceFactor: 3 }).offPeakPriceFactor, 1, 'a factor never raises the price');
});

test('usage: cached tokens read from OpenAI and DeepSeek shapes, never above the prompt', () => {
  assert.equal(readUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 64 } })?.cachedTokens, 64);
  assert.equal(readUsage({ prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 })?.cachedTokens, 80);
  assert.equal(readUsage({ prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 99 })?.cachedTokens, 10);
  assert.equal(readUsage({ prompt_tokens: 10, completion_tokens: 5 })?.cachedTokens, 0);
});

test('key caps: Bangkok day and month, running holds counted, null is no cap', async () => {
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  const { breachedLimit, parseLimit, periodStarts } = await import('@/lib/llm/key-limits');
  // 2026-10-26 23:30 UTC is 06:30 on the 27th in Bangkok.
  const now = Date.parse('2026-10-26T23:30:00Z');
  const { day, month } = periodStarts(now);
  assert.equal(day.toISOString(), '2026-10-26T17:00:00.000Z', 'midnight Bangkok, 27 Oct');
  assert.equal(month.toISOString(), '2026-09-30T17:00:00.000Z', '1 Oct Bangkok');
  assert.equal(periodStarts(Date.parse('2026-10-31T18:00:00Z')).month.toISOString(), '2026-10-31T17:00:00.000Z', '01:00 on 1 Nov is November');

  const limits = { dailyLimitCredits: 100, monthlyLimitCredits: null };
  assert.equal(breachedLimit(limits, { day: 90, month: 500 }, 0, 10), null, 'exactly at the cap is allowed');
  assert.deepEqual(breachedLimit(limits, { day: 90, month: 500 }, 5, 10), { period: 'day', limit: 100, spent: 90 });
  assert.deepEqual(breachedLimit({ dailyLimitCredits: null, monthlyLimitCredits: 1000 }, { day: 0, month: 995 }, 0, 6), { period: 'month', limit: 1000, spent: 995 });
  assert.equal(breachedLimit({ dailyLimitCredits: null, monthlyLimitCredits: null }, { day: 1e9, month: 1e9 }, 1e9, 1e9), null);
  assert.equal(parseLimit(''), null);
  assert.equal(parseLimit('150.7'), 150);
  assert.equal(parseLimit(-1), null);
  assert.equal(parseLimit(0), 0, '0 blocks the key without revoking it');
});
