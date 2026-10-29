/**
 * The KIE.ai adapter against KIE's documented task API.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/kie-provider.test.mts)
 *
 * Responses are built from docs.kie.ai: `createTask` answers `{code, msg,
 * data:{taskId}}` — errors too come back as HTTP 200 with another `code` —
 * and `recordInfo` reports `state` waiting | queuing | generating | success |
 * fail, with the files in `resultJson`, a JSON *string*. `globalThis.fetch`
 * is stubbed; nothing reaches the network and no credit is spent.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { KieProvider, outputUrls } from '@/lib/providers/kie';
import type { ProviderGenerateParams } from '@/types';

class FastKie extends KieProvider {
  protected pollIntervalMs = 0;
  protected retryDelayMs = 0;
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer each request from `routes` by URL (first match wins, a list is played in order); record every call. */
function stubFetch(routes: [RegExp, (() => Response) | (() => Response)[]][]): Call[] {
  const calls: Call[] = [];
  const queues = routes.map(([, a]) => (Array.isArray(a) ? [...a] : null));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      auth: headers.get('authorization'),
    });
    for (const [i, [pattern, answer]] of routes.entries()) {
      if (!pattern.test(url)) continue;
      const queue = queues[i];
      if (queue) {
        const next = queue.length > 1 ? queue.shift()! : queue[0];
        return next();
      }
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
const UPLOAD = /kieai\.redpandaai\.co\/api\/file-base64-upload$/;

const created = () => json({ code: 200, msg: 'success', data: { taskId: 'task-1' } });
const state = (s: string, extra: Record<string, unknown> = {}) => () =>
  json({ code: 200, msg: 'success', data: { taskId: 'task-1', state: s, ...extra } });
const succeeded = (resultJson: unknown, creditsConsumed = 6) =>
  state('success', { resultJson: JSON.stringify(resultJson), creditsConsumed });

const REF_1 = 'https://cdn.example.test/uploads/7/image/a.png';
const REF_2 = 'https://cdn.example.test/uploads/7/image/b.png';

const picture: ProviderGenerateParams = {
  modelId: 'kie/nano-banana-2-1',
  prompt: 'ภาพ 1 wearing the jacket from ภาพ 2',
  aspectRatio: '16:9',
  inputImage: REF_1,
  referenceImages: [REF_1, REF_2],
  apiKey: 'test-key',
  extraParams: { kieTier: '2K', quality: '2K', numOutputs: 4 },
};

test('a picture: one task with every reference, polled until it succeeds', async () => {
  const calls = stubFetch([
    [CREATE, created],
    [RECORD, [state('waiting'), state('generating'), succeeded({ resultUrls: ['https://tempfile.kie.test/out.png'] })]],
  ]);
  const result = await new FastKie().generateImage(picture);

  assert.equal(result.success, true);
  assert.equal(result.resultUrl, 'https://tempfile.kie.test/out.png');
  assert.equal(result.jobId, 'task-1');
  // KIE's own unit: 6 credits × $0.005.
  assert.equal(result.costUsd, 0.03);

  const create = calls.find((c) => CREATE.test(c.url))!;
  assert.equal(create.method, 'POST');
  assert.equal(create.auth, 'Bearer test-key');
  assert.deepEqual(create.body, {
    model: 'nano-banana-2-1',
    input: {
      prompt: picture.prompt,
      image_input: [REF_1, REF_2],
      aspect_ratio: '16:9',
      resolution: '2K',
      output_format: 'png',
    },
  });
  assert.equal(calls.filter((c) => RECORD.test(c.url)).length, 3);
});

test('a data: URI frame goes through KIE upload first; the first and last frame reach Kling in order', async () => {
  const calls = stubFetch([
    [UPLOAD, () => json({ success: true, code: 200, msg: 'ok', data: { downloadUrl: 'https://tempfile.redpandaai.co/x/first.png' } })],
    [CREATE, created],
    [RECORD, succeeded({ resultUrls: ['https://tempfile.kie.test/clip.mp4'] })],
  ]);
  const result = await new FastKie().generateVideo({
    modelId: 'kie/kling-3',
    prompt: 'the hero turns around',
    aspectRatio: '9:16',
    duration: 10,
    inputImage: 'data:image/png;base64,iVBORw0KGgo=',
    inputImageEnd: 'https://cdn.example.test/uploads/7/image/last.png',
    apiKey: 'test-key',
    extraParams: { kieTier: '1080p' },
  });

  assert.equal(result.success, true);
  const upload = calls.find((c) => UPLOAD.test(c.url))!;
  assert.equal(upload.auth, 'Bearer test-key');
  assert.equal(upload.body?.base64Data, 'data:image/png;base64,iVBORw0KGgo=');
  assert.match(String(upload.body?.fileName), /\.png$/);
  const create = calls.find((c) => CREATE.test(c.url))!;
  assert.deepEqual(create.body, {
    model: 'kling-3.0/video',
    input: {
      prompt: 'the hero turns around',
      image_urls: ['https://tempfile.redpandaai.co/x/first.png', 'https://cdn.example.test/uploads/7/image/last.png'],
      sound: true,
      duration: '10',
      mode: 'pro',
      multi_shots: false,
    },
  });
});

test('a length the model is not sold at is sent as its shortest one, never as asked', async () => {
  const calls = stubFetch([[CREATE, created], [RECORD, succeeded({ resultUrls: ['https://tempfile.kie.test/c.mp4'] })]]);
  await new FastKie().generateVideo({ modelId: 'kie/seedance-2-fast', prompt: 'rain on a window', duration: 60, apiKey: 'k' });
  const input = calls.find((c) => CREATE.test(c.url))!.body?.input as Record<string, unknown>;
  assert.equal(input.duration, 5);
  // The tier defaults to the entry's own, not to anything left in params.
  assert.equal(input.resolution, '720p');
});

test('a task KIE reports as failed fails, as the order’s fault, with KIE’s reason', async () => {
  stubFetch([[CREATE, created], [RECORD, state('fail', { failCode: '501', failMsg: 'content policy violation' })]]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, false);
  assert.equal(result.orderFault, true);
  assert.match(result.error ?? '', /content policy violation/);
});

test('402 on createTask (HTTP 200 body) is the key’s problem, says so, and polls nothing', async () => {
  const calls = stubFetch([[CREATE, () => json({ code: 402, msg: 'Credits insufficient' })]]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /^KIE 402 insufficient credits/);
  assert.notEqual(result.orderFault, true);
  assert.equal(calls.some((c) => RECORD.test(c.url)), false);
});

test('a refused input (422) is the order’s fault: the shared key is not counted against', async () => {
  stubFetch([[CREATE, () => json({ code: 422, msg: 'aspect_ratio is invalid' })]]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, false);
  assert.equal(result.orderFault, true);
  assert.match(result.error ?? '', /aspect_ratio is invalid/);
});

test('429 on createTask is retried; a rejected create is not queued by KIE', async () => {
  const calls = stubFetch([
    [CREATE, [() => json({ code: 429, msg: 'rate limited' }), created]],
    [RECORD, succeeded({ resultUrls: ['https://tempfile.kie.test/out.png'] })],
  ]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, true);
  assert.equal(calls.filter((c) => CREATE.test(c.url)).length, 2);
});

test('429 that does not lift reads as a rate limit (the key cools down, it is not disabled)', async () => {
  stubFetch([[CREATE, () => json({ code: 429, msg: 'rate limited' })]]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /429/);
});

test('"success" with no file is a failure, so the customer is refunded', async () => {
  stubFetch([[CREATE, created], [RECORD, succeeded({ resultUrls: [] })]]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, false);
  assert.equal(result.orderFault, true);
});

test('a blip on the status read is not the task failing', async () => {
  stubFetch([
    [CREATE, created],
    [RECORD, [() => json({ error: 'bad gateway' }, 502), state('queuing'), succeeded({ resultUrls: ['https://tempfile.kie.test/out.png'] })]],
  ]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, true);
});

test('only https inputs leave the server, and refusing one is not held against the key', async () => {
  const calls = stubFetch([[CREATE, created]]);
  const result = await new FastKie().editImage({
    modelId: 'kie/recraft-remove-background',
    prompt: 'x',
    inputImage: 'http://169.254.169.254/latest/meta-data',
    apiKey: 'k',
  });
  assert.equal(result.success, false);
  assert.equal(result.orderFault, true);
  assert.equal(calls.length, 0);
});

test('a status read that never answers is asked again, not taken as the task failing', async () => {
  let reads = 0;
  stubFetch([
    [CREATE, created],
    [RECORD, () => {
      reads++;
      if (reads === 1) throw new TypeError('fetch failed');
      return succeeded({ resultUrls: ['https://tempfile.kie.test/out.png'] })();
    }],
  ]);
  const result = await new FastKie().generateImage(picture);
  assert.equal(result.success, true);
  assert.equal(reads, 2);
});

test('a task that outlives its wait fails as the order’s fault', async () => {
  stubFetch([[CREATE, created], [RECORD, state('generating')]]);
  const result = await new FastKie().generateImage({ ...picture, maxWaitSeconds: 2 });
  assert.equal(result.success, false);
  assert.equal(result.orderFault, true);
  assert.match(result.error ?? '', /timed out/);
});

test('Suno: lyrics are sung in the composed style, in custom mode', async () => {
  const calls = stubFetch([
    [CREATE, created],
    [RECORD, succeeded({ data: [{ audio_url: 'https://cdn.kie.test/a.mp3' }, { audio_url: 'https://cdn.kie.test/b.mp3' }] })],
  ]);
  const result = await new FastKie().generateAudio!({
    modelId: 'kie/suno-v6',
    prompt: 'เพลงรักริมทะเล',
    apiKey: 'k',
    extraParams: { lyrics: '[Verse]\nคลื่นซัดฝั่ง', music: { genre: 'pop' } },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.resultUrls, ['https://cdn.kie.test/a.mp3', 'https://cdn.kie.test/b.mp3']);
  const input = calls.find((c) => CREATE.test(c.url))!.body?.input as Record<string, unknown>;
  assert.equal(calls.find((c) => CREATE.test(c.url))!.body?.model, 'ai-music-api/generate');
  assert.equal(input.custom_mode, true);
  assert.equal(input.model, 'V6');
  assert.equal(input.instrumental, false);
  assert.equal(input.lyrics, '[Verse]\nคลื่นซัดฝั่ง');
  assert.equal(input.title, 'เพลงรักริมทะเล');
  assert.match(String(input.style), /เพลงรักริมทะเล/);
});

test('Suno: no lyrics and vocals wanted → the simple mode writes the words itself', async () => {
  const calls = stubFetch([[CREATE, created], [RECORD, succeeded({ data: [{ audio_url: 'https://cdn.kie.test/a.mp3' }] })]]);
  await new FastKie().generateAudio!({ modelId: 'kie/suno-v6', prompt: 'upbeat summer song', apiKey: 'k' });
  const input = calls.find((c) => CREATE.test(c.url))!.body?.input as Record<string, unknown>;
  assert.equal(input.custom_mode, false);
  assert.equal(input.prompt, 'upbeat summer song');
  assert.equal(input.lyrics, undefined);
});

test('a talking portrait sends its face, voice and a prompt KIE requires', async () => {
  const calls = stubFetch([[CREATE, created], [RECORD, succeeded({ resultUrls: ['https://tempfile.kie.test/talk.mp4'] })]]);
  await new FastKie().generateVideo({
    modelId: 'kie/kling-avatar',
    prompt: '',
    duration: 7,
    inputImage: 'https://cdn.example.test/uploads/7/image/face.png',
    inputAudio: 'https://cdn.example.test/uploads/7/audio/voice.mp3',
    apiKey: 'k',
  });
  const body = calls.find((c) => CREATE.test(c.url))!.body!;
  assert.equal(body.model, 'kling/ai-avatar-standard');
  const input = body.input as Record<string, unknown>;
  assert.equal(input.image_url, 'https://cdn.example.test/uploads/7/image/face.png');
  assert.equal(input.audio_url, 'https://cdn.example.test/uploads/7/audio/voice.mp3');
  assert.ok(String(input.prompt).length > 0);
});

test('result files: Veo 1080p’s upscaled file wins; Suno tracks; strangers’ schemes are dropped', () => {
  assert.deepEqual(
    outputUrls({ resultJson: JSON.stringify({ resultUrls: ['https://x.test/720.mp4'], data: { result_urls: ['https://x.test/1080.mp4'] } }) }),
    ['https://x.test/1080.mp4']
  );
  assert.deepEqual(outputUrls({ resultJson: '', response: { sunoData: [{ audioUrl: 'https://x.test/s.mp3' }] } }), ['https://x.test/s.mp3']);
  assert.deepEqual(outputUrls({ resultJson: JSON.stringify({ resultUrls: ['javascript:alert(1)', 'http://x.test/a.png'] }) }), []);
  assert.deepEqual(outputUrls({ resultJson: 'not json' }), []);
});

test('the key check reads KIE’s balance and never takes a key it refuses', async () => {
  stubFetch([[/chat\/credit$/, () => json({ code: 200, msg: 'success', data: 1234 })]]);
  assert.deepEqual(await new FastKie().credits('good'), { ok: true, credits: 1234 });
  stubFetch([[/chat\/credit$/, () => json({ code: 401, msg: 'Unauthorized' })]]);
  const refused = await new FastKie().credits('bad');
  assert.equal(refused.ok, false);
});
