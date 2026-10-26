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
  assert.equal(millicreditsFor(1000, 500, cfg), 60);
  assert.equal(millicreditsFor(1, 0, cfg), 1, 'one token is never free');
  assert.equal(millicreditsFor(0, 0, cfg), 0);
  assert.equal(millicreditsFor(1_000_000, 1_000_000, cfg), 100_000);
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
  assert.deepEqual(relay.usage, { promptTokens: 12, completionTokens: 7 });
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
  assert.deepEqual(readUsage({ prompt_tokens: 3, completion_tokens: 4 }), { promptTokens: 3, completionTokens: 4 });
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
