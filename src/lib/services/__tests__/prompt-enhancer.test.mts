/**
 * ✨ on the prompt box: what one press may spend, and what a customer is told
 * when it gets no answer.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/services/__tests__/prompt-enhancer.test.mts)
 *
 * What must hold: a press allows a thinking model enough tokens for long Thai;
 * an answer the limit cut short never reaches the box as if it were whole; the
 * clock covers the body, where DeepSeek does its thinking, and every engine of
 * a press together stays short of a proxy's 100 s; and every failure has a
 * reason a customer can read, with no provider's name in it.
 *
 * `fetch` is stubbed and nothing connects. Pollinations needs no key, so a
 * single engine runs with no database; the engine chain gets a stand-in pool.
 */
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The Prisma client wants a URL at import time; nothing here connects.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const { DEFAULT_ENHANCER, enhancePrompt } = await import('@/lib/services/prompt-enhancer');
const { enhanceFailure } = await import('@/lib/services/chat-failure');
const { lyricsFailure } = await import('@/lib/lyrics/write');
const { AccountPoolManager } = await import('@/lib/services/account-pool');
const { default: prisma } = await import('@/lib/db');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
  mock.restoreAll();
});

const POLLINATIONS = { ...DEFAULT_ENHANCER, provider: 'pollinations' as const };
const IMAGE = { prompt: 'ทะเลตอนเช้า', kind: 'image' as const };

function answering(reply: { content: string; finish_reason: string }) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ finish_reason: reply.finish_reason, message: { content: reply.content } }] }));
  }) as typeof fetch;
  return bodies;
}

/** Headers at once, and a body that never comes until the signal aborts: DeepSeek while it thinks. */
function thinkingForever() {
  const urls: string[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    return new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('This operation was aborted', 'AbortError')));
        },
      })
    );
  }) as typeof fetch;
  return urls;
}

/** Let everything that does not depend on the clock run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

test('a press allows 12,000 tokens, far more than the 2,500 that long Thai ran out of', async () => {
  const bodies = answering({ content: 'A calm sea at dawn', finish_reason: 'stop' });
  const result = await enhancePrompt(IMAGE, POLLINATIONS);
  assert.equal(result.source, 'llm');
  assert.equal(result.prompt, 'A calm sea at dawn');
  assert.equal(bodies[0].max_tokens, 12_000);
});

test('an answer the token limit cut short falls back with the reason, never as a whole prompt', async () => {
  answering({ content: 'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium', finish_reason: 'length' });
  const result = await enhancePrompt(IMAGE, POLLINATIONS);
  assert.equal(result.source, 'rules');
  assert.match(result.fallbackReason ?? '', /ran out of tokens and cut its answer short/);
  assert.doesNotMatch(result.prompt, /integrated_multimodal_description/);
});

test('no answer at all after running out of tokens falls back with the reason', async () => {
  answering({ content: '', finish_reason: 'length' });
  const result = await enhancePrompt(IMAGE, POLLINATIONS);
  assert.equal(result.source, 'rules');
  assert.match(result.fallbackReason ?? '', /ran out of tokens while reasoning/);
});

test('the clock covers the body: headers in time do not stop it', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  thinkingForever();
  const pressed = enhancePrompt(IMAGE, POLLINATIONS);
  await settle();
  mock.timers.tick(59_999);
  await settle();
  let finished = false;
  void pressed.then(() => (finished = true));
  await settle();
  assert.equal(finished, false, 'still waiting one millisecond before the limit');

  mock.timers.tick(1);
  const result = await pressed;
  assert.equal(result.source, 'rules');
  assert.match(result.fallbackReason ?? '', /abort/i);
});

test('every engine of one press shares 90 s, and one with too little left is not started', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const urls = thinkingForever();
  // Every engine has a key.
  Object.defineProperty(prisma, 'aiProvider', { configurable: true, value: { findUnique: async () => ({ id: 1, isActive: true }) } });
  mock.method(AccountPoolManager, 'selectAccount', (async () => ({ apiKey: 'test-key' })) as never);

  const pressed = enhancePrompt(IMAGE, { ...DEFAULT_ENHANCER, provider: 'auto' });
  await settle();
  assert.equal(urls.length, 1);
  mock.timers.tick(60_000); // the first engine's whole allowance
  await settle();
  assert.equal(urls.length, 2, 'the second engine starts with what is left');
  mock.timers.tick(30_000); // the rest of the press
  const result = await pressed;

  assert.equal(urls.length, 2, 'nothing is left to start a third on');
  assert.equal(result.source, 'rules');
  assert.match(result.fallbackReason ?? '', /minimax: timed out.*byteplus: timed out/);
});

test('with the assistant off, a press still comes back with its reason', async () => {
  const result = await enhancePrompt(IMAGE, { ...DEFAULT_ENHANCER, provider: 'off' });
  assert.equal(result.source, 'rules');
  assert.match(enhanceFailure(result.fallbackReason ?? '').th, /ปิดผู้ช่วย AI/);
});

test('music, edit and lip-sync have no rules: the prompt comes back as it went in', async () => {
  for (const kind of ['audio', 'edit', 'lipsync'] as const) {
    const result = await enhancePrompt({ prompt: 'เพลงลูกทุ่ง', kind }, { ...DEFAULT_ENHANCER, provider: 'off' });
    assert.equal(result.prompt, 'เพลงลูกทุ่ง', kind);
  }
  const picture = await enhancePrompt(IMAGE, { ...DEFAULT_ENHANCER, provider: 'off' });
  assert.notEqual(picture.prompt, IMAGE.prompt);
});

test('enhanceFailure: every failure has its own reason, and no provider is named', () => {
  const noKeys = 'openai: no active openai key in the account pool | minimax: no active minimax key in the account pool';
  const cases: [string, RegExp][] = [
    ['ปิดผู้ช่วย AI ไว้', /ปิดผู้ช่วย AI/],
    [`deepseek: This operation was aborted | ${noKeys}`, /ช้าเกินเวลา/],
    ['deepseek: This operation was aborted | openai: timed out, the press has no time left', /ช้าเกินเวลา/],
    [`deepseek: deepseek ran out of tokens while reasoning and gave no answer — try another model | ${noKeys}`, /เขียนพรอมต์ไม่จบ/],
    [`deepseek: deepseek ran out of tokens and cut its answer short | ${noKeys}`, /เขียนพรอมต์ไม่จบ/],
    [`deepseek: deepseek returned an empty answer | ${noKeys}`, /เขียนพรอมต์ไม่จบ/],
    [`deepseek: deepseek HTTP 429: {"error":"too many"} | ${noKeys}`, /ใช้ AI เต็ม/],
    [`deepseek: deepseek HTTP 402: {"error":"insufficient balance"} | ${noKeys}`, /บัญชี AI/],
    [noKeys, /ยังไม่ได้เชื่อมต่อ AI สำหรับปรับพรอมต์/],
    ['fetch failed', /เชื่อมต่อ AI ไม่สำเร็จ/],
  ];
  for (const [reason, expected] of cases) {
    const message = enhanceFailure(reason);
    assert.match(message.th, expected, reason);
    assert.ok(message.en.length > 0);
    assert.doesNotMatch(`${message.th} ${message.en}`, /deepseek|openai|minimax|byteplus|HTTP/i);
  }
});

test('the two ✨ buttons share a classifier and differ only in what was being written', () => {
  const dry = 'deepseek: deepseek ran out of tokens while reasoning and gave no answer';
  assert.match(lyricsFailure(dry).th, /เนื้อเพลง/);
  assert.match(enhanceFailure(dry).th, /พรอมต์/);
  assert.deepEqual(lyricsFailure('deepseek: deepseek HTTP 429: {}'), enhanceFailure('deepseek: deepseek HTTP 429: {}'));
});
