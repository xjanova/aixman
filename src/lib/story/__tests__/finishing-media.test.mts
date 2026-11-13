import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('real FFmpeg preserves dialogue timing through mixed transitions, effects, music, captions and grouped joins', { skip: !process.env.STORY_TEST_FFMPEG, timeout: 180_000 }, () => {
  const code = String.raw`
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
mock.module('@/lib/db', { defaultExport: {} });
mock.module('@/lib/storage/r2', { namedExports: { uploadBuffer: async () => '', keyFromPublicUrl: () => null } });
mock.module('@/lib/lyrics/karaoke-job', { namedExports: { KaraokeError: class extends Error {}, findKaraoke: async () => null } });
const { renderFilm } = await import('@/lib/story/assemble');
const { defaultEdit } = await import('@/lib/story/edit');
const { shotCut } = await import('@/lib/story/finishing');
const dir = await mkdtemp(path.join(process.cwd(), '.tmp-finish-'));
const bin = process.env.STORY_TEST_FFMPEG;
const ff = (args) => {
  const r = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', ...args], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr || r.error?.message);
  return r;
};
const duration = (file) => {
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { cwd: dir, encoding: 'utf8' });
  const match = /Duration: ([0-9]+):([0-9]+):([0-9.]+)/.exec(r.stderr);
  assert.ok(match, r.stderr);
  return +match[1] * 3600 + +match[2] * 60 + +match[3];
};
try {
  ff(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'source.mp4']);
  ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=0.6:sample_rate=48000', 'dub.wav']);
  ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=1:sample_rate=48000', 'music.wav']);
  const shots = Array.from({ length: 10 }, (_, k) => ({ number: k + 1, seconds: 1, voiceSeconds: 0.6, text: k % 2 ? 'ทดสอบบทพูดไทย' : '', burnsSubs: k === 0,
    cut: shotCut({ transition: ['cut', 'dissolve', 'wipeleft', 'fade'][k % 4], effect: ['none', 'warm', 'cool', 'dream', 'flash'][k % 5], sfx: ['none', 'whoosh', 'impact', 'chime'][k % 4] }) }));
  const edit = { ...defaultEdit('film'), transition: 'dissolve', clipAudio: false, music: 'generate', normalizeAudio: true, grade: true };
  const file = await renderFilm({ dir, files: shots.map(() => 'source.mp4'), dubs: shots.map((_, k) => k === 1 ? 'dub.wav' : null), shots, aspect: '16:9', edit, music: 'music.wav', look: 'wuxia', title: 'ตอนทดสอบ', recap: 'ตอนก่อน', ending: 'ติดตามตอนต่อไป' });
  assert.ok(Math.abs(duration(file) - 10) < 0.15, 'crossfades must keep the 10s dialogue timeline');
  ff(['-y', '-i', file, '-map', '0:a', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'audio.raw']);
  const raw = await readFile(path.join(dir, 'audio.raw'));
  const rms = (from, to) => {
    let sum = 0, count = 0;
    for (let k = Math.floor(from * 8000); k < Math.min(raw.length / 4, to * 8000); k++) { const x = raw.readFloatLE(k * 4); sum += x * x; count++; }
    return Math.sqrt(sum / count);
  };
  assert.ok(rms(1.1, 1.45) > 0.005, 'dub remains audible with original clip sound off');
  // Measure the actual cue boundaries independently of the graph text: only a 700 Hz dub, no music/SFX.
  const timed = [0, 1, 2].map((k) => ({ number: k + 1, seconds: 1, text: '', burnsSubs: false, cut: shotCut({ transition: 'dissolve' }) }));
  await renderFilm({ dir, files: timed.map(() => 'source.mp4'), dubs: [null, 'dub.wav', null], shots: timed, aspect: '16:9', edit: { ...defaultEdit('film'), clipAudio: false, subtitles: false, titleCard: false, transition: 'dissolve' }, music: null });
  ff(['-y', '-i', 'film.mp4', '-map', '0:a', '-f', 'f32le', '-ac', '1', '-ar', '8000', 'audio.raw']);
  const timedAudio = await readFile(path.join(dir, 'audio.raw'));
  let first = null, last = null;
  for (let k = 0; k < timedAudio.length / 4; k++) if (Math.abs(timedAudio.readFloatLE(k * 4)) > 0.015) { first ??= k / 8000; last = k / 8000; }
  assert.ok(first > 0.97 && first < 1.05, 'dub starts at the original 1s shot boundary: ' + first);
  assert.ok(last > 1.55 && last < 1.65, 'dub ends at 1.6s, without overlap/truncation: ' + last);
  assert.ok(Math.abs(duration('film.mp4') - 3) < 0.1);
} finally { await rm(dir, { recursive: true, force: true }); }
`;
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './scripts/alias-loader.mjs', '--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: process.env.STORY_TEST_FFMPEG }, timeout: 175_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error?.message ?? ''}`);
});
