/**
 * The fal.ai adapter against fal's documented queue behaviour.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/fal-provider.test.mts)
 *
 * fal has no FAILED status — a failed request reports COMPLETED with `error`
 * set (https://fal.ai/docs/model-apis/model-endpoints/queue). Read as success,
 * that stored a finished generation with no file and never refunded the
 * customer. `globalThis.fetch` is stubbed; nothing reaches the network.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FalProvider } from '@/lib/providers/fal';
import type { ProviderGenerateParams } from '@/types';

class FastFal extends FalProvider {
  protected pollIntervalMs = 0;
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

/** Answer each request from `routes` by URL (first match wins); record every call. */
function stubFetch(routes: [RegExp, () => Response | Promise<Response>][]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      auth: headers.get('authorization'),
    });
    for (const [pattern, answer] of routes) if (pattern.test(url)) return answer();
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const QUEUE = 'https://queue.fal.run/fal-ai/infinitalk/requests/req-1';

const portrait: ProviderGenerateParams = {
  modelId: 'fal-ai/infinitalk',
  prompt: 'a host smiling',
  inputImage: 'https://cdn.example.test/uploads/7/image/face.png',
  inputAudio: 'https://cdn.example.test/uploads/7/audio/voice.mp3',
  maxDuration: 5,
  apiKey: 'test-key',
  // What the studio actually sends along: its own video preset id, a size
  // object's worth of leftovers, and the two fields that change fal's bill.
  extraParams: { resolution: '720p', acceleration: 'none', width: 1344, loop_mode: 'pingpong', aspectRatio: '16:9' },
};

const submitted = () => json({ request_id: 'req-1', status_url: `${QUEUE}/status`, response_url: QUEUE });

test('a request fal completes with an error fails, and is not fetched as a result', async () => {
  const calls = stubFetch([
    [/\/status$/, () => json({ status: 'COMPLETED', error: 'Face not detected in image', error_type: 'face_detection_error' })],
    [/requests\/req-1$/, () => json({ video: { url: 'https://fal.media/should-not-be-read.mp4' } })],
    [/queue\.fal\.run\/fal-ai\/infinitalk$/, submitted],
  ]);
  const out = await new FastFal().generateVideo(portrait);
  assert.equal(out.success, false);
  assert.match(out.error ?? '', /face_detection_error.*Face not detected/);
  assert.equal(out.resultUrl, undefined);
  assert.ok(!calls.some((c) => c.url === QUEUE), 'the result endpoint is never read for a failed request');
});

test('a completed request with no file in it is a failure, not an empty success', async () => {
  stubFetch([
    [/\/status$/, () => json({ status: 'COMPLETED' })],
    [/requests\/req-1$/, () => json({ seed: 42 })],
    [/queue\.fal\.run\/fal-ai\/infinitalk$/, submitted],
  ]);
  const out = await new FastFal().generateVideo(portrait);
  assert.equal(out.success, false);
  assert.match(out.error ?? '', /no output/);
});

test('a result endpoint that answers with an error is a failure carrying its detail', async () => {
  stubFetch([
    [/\/status$/, () => json({ status: 'COMPLETED' })],
    [/requests\/req-1$/, () => json({ detail: [{ msg: 'Audio file could not be decoded' }] }, 422)],
    [/queue\.fal\.run\/fal-ai\/infinitalk$/, submitted],
  ]);
  const out = await new FastFal().generateVideo(portrait);
  assert.equal(out.success, false);
  assert.match(out.error ?? '', /422.*Audio file could not be decoded/);
});

test('a finished clip is delivered, after waiting out the queue and a status blip', async () => {
  const statuses = [json({ status: 'IN_QUEUE' }), json({ error: 'upstream' }, 503), json({ status: 'IN_PROGRESS' }), json({ status: 'COMPLETED' })];
  const calls = stubFetch([
    [/\/status$/, () => statuses.shift() ?? json({ status: 'COMPLETED' })],
    [/requests\/req-1$/, () => json({ video: { url: 'https://fal.media/files/talk.mp4' }, seed: 42 })],
    [/queue\.fal\.run\/fal-ai\/infinitalk$/, submitted],
  ]);
  const out = await new FastFal().generateVideo(portrait);
  assert.equal(out.success, true, out.error);
  assert.equal(out.resultUrl, 'https://fal.media/files/talk.mp4');
  assert.deepEqual(out.resultUrls, ['https://fal.media/files/talk.mp4']);
  assert.equal(out.jobId, 'req-1');
  assert.equal(calls.filter((c) => c.url.endsWith('/status')).length, 4);
});

test('nothing a caller sends can change what fal bills: no resolution, no acceleration, frames ours', async () => {
  const calls = stubFetch([
    [/\/status$/, () => json({ status: 'COMPLETED' })],
    [/requests\/req-1$/, () => json({ video: { url: 'https://fal.media/files/talk.mp4' } })],
    [/queue\.fal\.run\/fal-ai\/infinitalk$/, submitted],
  ]);
  await new FastFal().generateVideo({ ...portrait, extraParams: { ...portrait.extraParams, num_frames: 721 } });
  const body = calls.find((c) => c.method === 'POST')?.body ?? {};
  assert.equal('resolution' in body, false, 'resolution 720p would double the per-second price');
  assert.equal('acceleration' in body, false);
  assert.equal('width' in body, false);
  assert.equal(body.num_frames, 125, '5 s at 25 fps, from the model row — not the 721 asked for');
  assert.equal(body.loop_mode, 'pingpong', 'harmless extras still pass');
  assert.equal(body.image_url, portrait.inputImage);
  assert.equal(body.audio_url, portrait.inputAudio);
});

test("fal's own queue URLs are followed — and only when they point at fal", async () => {
  const nested = 'https://queue.fal.run/fal-ai/flux/requests/req-2';
  const calls = stubFetch([
    [/elsewhere\.example/, () => json({ status: 'COMPLETED' })],
    [/\/status$/, () => json({ status: 'COMPLETED' })],
    [/requests\/req-2$/, () => json({ images: [{ url: 'https://fal.media/a.png' }, { url: 'https://fal.media/b.png' }] })],
    [/queue\.fal\.run\/fal-ai\/flux\/dev$/, () => json({ request_id: 'req-2', status_url: `${nested}/status`, response_url: nested })],
  ]);
  const out = await new FastFal().generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'a lighthouse', apiKey: 'test-key' });
  assert.equal(out.success, true, out.error);
  assert.deepEqual(out.resultUrls, ['https://fal.media/a.png', 'https://fal.media/b.png']);
  // The nested id's real URLs, not `fal-ai/flux/dev/requests/…` built by hand.
  assert.ok(calls.some((c) => c.url === `${nested}/status`));

  const leaked = stubFetch([
    [/\/status$/, () => json({ status: 'COMPLETED' })],
    [/requests\/req-3$/, () => json({ images: [{ url: 'https://fal.media/c.png' }] })],
    [/queue\.fal\.run\/fal-ai\/flux\/dev$/, () => json({ request_id: 'req-3', status_url: 'https://elsewhere.example/steal', response_url: 'http://queue.fal.run/x' })],
  ]);
  await new FastFal().generateImage({ modelId: 'fal-ai/flux/dev', prompt: 'a lighthouse', apiKey: 'test-key' });
  assert.ok(!leaked.some((c) => /elsewhere\.example|^http:/.test(c.url)), 'the API key never leaves fal over a URL fal did not vouch for');
  assert.ok(leaked.every((c) => c.auth === 'Key test-key'));
});

test("an upscaler's single `image` output is delivered too", async () => {
  stubFetch([
    [/\/status$/, () => json({ status: 'COMPLETED' })],
    [/requests\/req-4$/, () => json({ image: { url: 'https://fal.media/up.png' } })],
    [/queue\.fal\.run\/fal-ai\/creative-upscaler$/, () => json({ request_id: 'req-4' })],
  ]);
  const out = await new FastFal().editImage({ modelId: 'fal-ai/creative-upscaler', prompt: '', inputImage: 'https://fal.media/in.png', apiKey: 'test-key' });
  assert.equal(out.success, true, out.error);
  assert.equal(out.resultUrl, 'https://fal.media/up.png');
});
