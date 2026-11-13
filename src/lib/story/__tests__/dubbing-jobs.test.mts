import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Exercise the actual job orchestration with in-memory DB / provider ports.
// No real orders, credentials or database are needed. File duration parsing
// and temporary-file cleanup still use the real implementations.
test('dubbing jobs claim once, place ordinary orders, measure real audio, reject old results and release failures', () => {
  const result = spawnSync(process.execPath, [
    '--experimental-test-module-mocks', '--experimental-transform-types',
    '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--import', './scripts/alias-loader.mjs', '--input-type=module', '-e', String.raw`
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { ELEVENLABS_VOICES, speechBlock } = await import('@/lib/story/dubbing');
const voice = ELEVENLABS_VOICES[0].id;
let rows = [], orders = [], serial = 100, throwAt = null, raceOnUpload = false, audioSeconds = 2;
const project = () => ({ id: 7, userId: 3, mode: 'film', status: 'draft', scriptJson: { dubbing: { enabled: true } }, characters: [], shots: structuredClone(rows) });
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === 'AND') return value.every((v) => matches(row, v));
  if (key === 'OR') return value.some((v) => matches(row, v));
  if (value instanceof Date) return row[key]?.getTime() === value.getTime();
  if (value && typeof value === 'object') {
    if ('not' in value) return row[key] !== null && row[key] !== value.not;
  }
  return row[key] === value;
});
const db = { aiModel: { findFirst: async () => ({ id: 4, name: 'ElevenLabs V3', creditsPerUnit: 2, defaultParams: {}, readiness: 'ready' }) },
  aiStoryShot: {
    findFirst: async ({ where }) => rows.find((r) => matches(r, where)),
    updateMany: async ({ where, data }) => {
      const found = rows.filter((r) => matches(r, where));
      for (const row of found) Object.assign(row, data, { updatedAt: new Date(++serial) });
      return { count: found.length };
    },
  },
  aiGeneration: { findFirst: async ({ where }) => where.userId === 3 ? ({ status: 'completed', resultUrl: 'https://bucket/generation.wav', creditsRefunded: 0 }) : null },
};
class StoryError extends Error { constructor(msg, status = 400) { super(msg.th); this.msg = msg; this.status = status; } }
mock.module('@/lib/db', { defaultExport: db });
mock.module('@/lib/story/service', { namedExports: { StoryError, customerMsg: (e) => e.msg ?? ({ th: 'failed', en: 'failed' }), loadOwnedProject: async () => project() } });
mock.module('@/lib/services/generation', { namedExports: { GenerationService: { generate: async (user, input, options) => {
  orders.push({ user, input, options });
  if (throwAt === orders.length) throw Object.assign(new Error('credits'), { status: 402 });
  return { id: 800 + orders.length };
} } } });
mock.module('@/lib/services/generation-errors', { namedExports: { generationErrorResponse: (e) => e.status ? { status: e.status } : null } });
mock.module('@/lib/services/model-readiness', { namedExports: { ModelReadiness: { canOrder: () => true } } });
const keys = [];
mock.module('@/lib/storage/r2', { namedExports: { uploadBuffer: async (bytes, key, mime) => {
  assert.equal(mime, 'audio/wav'); keys.push(key);
  if (raceOnUpload) { rows[0].dubStartedAt = new Date(999999); rows[0].dubGenerationId = 999; }
  return 'https://bucket/' + key;
} } });
const commands = [];
mock.module('@/lib/story/media', { namedExports: {
  StoryJobError: class extends Error {}, enqueueJob: () => {}, hasAudio: async () => true,
  runFfmpeg: async (args) => { commands.push(args); return ''; },
  download: async (url, file) => {
  const dataSize = 16000 * 2 * audioSeconds;
  const b = Buffer.alloc(44 + dataSize);
  b.write('RIFF'); b.writeUInt32LE(36 + dataSize, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataSize, 40); await writeFile(file, b);
} } });
const { claimSpeech, placeSpeech, syncSpeech } = await import('@/lib/story/dub-service');
const reset = (n = 1) => {
  orders = []; throwAt = null; raceOnUpload = false; audioSeconds = 2;
  rows = Array.from({ length: n }, (_, k) => ({ id: k + 1, projectId: 7, shotNumber: k + 1,
    narration: 'สวัสดี', speakerId: null, delivery: 'neutral', durationSec: 6,
    status: 'pending', dubStatus: null, dubGenerationId: null, dubStartedAt: null, lipsyncStatus: null, updatedAt: new Date(++serial) }));
};

reset();
const snapshot = project();
const [first, second] = await Promise.all([claimSpeech(snapshot, [1]), claimSpeech(snapshot, [1])]);
assert.equal(first.length + second.length, 1, 'two tabs claim only one order');
await placeSpeech(3, false, 7, first.length ? first : second);
assert.equal(orders.length, 1);
assert.equal(orders[0].input.params.voice, voice);
assert.equal(orders[0].input.prompt, 'สวัสดี');
assert.deepEqual(orders[0].options, { isAdmin: false, deferApi: true });
assert.equal(await syncSpeech(project()), true);
assert.equal(rows[0].dubStatus, 'done');
assert.equal(rows[0].dubSeconds, 2);
assert.equal(rows[0].durationSec, 3);
assert.match(rows[0].audioUrl, /story\/3\/7\/dub-1-801.wav$/);
assert.equal(speechBlock(rows[0], project()), null);

reset();
await placeSpeech(3, false, 7, await claimSpeech(project(), [1]));
raceOnUpload = true;
assert.equal(await syncSpeech(project()), false, 'an older result cannot settle a newer claim');
assert.equal(rows[0].dubGenerationId, 999);
assert.equal(rows[0].dubStatus, 'rendering');

reset(3); throwAt = 1;
await placeSpeech(3, false, 7, await claimSpeech(project(), [1, 2, 3]));
assert.equal(orders.length, 1, 'an empty balance stops the remaining paid orders');
assert.ok(rows.every((r) => r.dubStatus === 'failed'));

reset();
await claimSpeech(project(), [1]);
rows[0].dubStartedAt = new Date(Date.now() - 11 * 60_000);
await syncSpeech(project());
assert.equal(rows[0].dubStatus, 'failed', 'an orphaned claim can be tried again');

reset(); audioSeconds = 12;
await placeSpeech(3, false, 7, await claimSpeech(project(), [1]));
await syncSpeech(project());
assert.equal(rows[0].dubSeconds, 12);
assert.equal(rows[0].durationSec, 6, 'an overlong line is not silently truncated to the shot cap');
assert.ok(speechBlock(rows[0], project()));
assert.equal(keys.length, 3);

mock.module('@/lib/lyrics/karaoke-job', { namedExports: { KaraokeError: class extends Error {}, findKaraoke: async () => null } });
const { renderFilm } = await import('@/lib/story/assemble');
const { defaultEdit } = await import('@/lib/story/edit');
const dir = await mkdtemp(path.join(tmpdir(), 'aixman-dub-test-'));
try {
  const shots = [{ number: 1, seconds: 3, voiceSeconds: 2, text: 'สวัสดี', burnsSubs: false }, { number: 2, seconds: 3, text: '', burnsSubs: false }];
  await renderFilm({ dir, files: ['a.mp4', 'b.mp4'], dubs: ['voice.wav', null], shots, aspect: '9:16',
    edit: { ...defaultEdit('film'), clipAudio: false }, music: 'music.mp3' });
  assert.ok(commands[0].includes('voice.wav'));
  assert.doesNotMatch(commands[0][commands[0].indexOf('-filter_complex') + 1], /\[0:a\]/, 'dub replaces the clip voice, never doubles it');
  assert.match(commands[1][commands[1].indexOf('-filter_complex') + 1], /\[1:a\]anull/);
  assert.match(commands.at(-1)[commands.at(-1).indexOf('-filter_complex') + 1], /sidechaincompress/, 'music ducks under the dub even with original clip sound off');
  assert.match(await readFile(path.join(dir, 'film.ass'), 'utf8'), /0:00:00.00,0:00:02.00,Sub/);

  commands.length = 0;
  await renderFilm({ dir, files: ['a.mp4', 'b.mp4'], dubs: ['voice.wav', null], shots, aspect: '9:16',
    edit: { ...defaultEdit('film'), clipVolume: 0.4 }, music: null });
  assert.doesNotMatch(commands[0][commands[0].indexOf('-filter_complex') + 1], /volume=0.4|afade/, 'clip volume and fades do not fade or silence dialogue');
  assert.match(commands[1][commands[1].indexOf('-filter_complex') + 1], /\[0:a\].*volume=0.4/, 'non-speaking shots keep the original ambient audio');
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Dubbing job scenarios passed');
`], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Dubbing job scenarios passed/);
});
