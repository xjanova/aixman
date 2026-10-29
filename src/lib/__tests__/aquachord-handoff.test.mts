/**
 * Song Handoff v1 — the link that hands a song to AquaChord.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/aquachord-handoff.test.mts)
 *
 * The token is the only thing standing between a customer's song and anyone
 * who guesses a URL, so every way of bending one has to come back null.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  HANDOFF_TTL_SEC,
  aquachordOrigin,
  handoffAudio,
  handoffConfigured,
  handoffHeaders,
  handoffLang,
  handoffLyrics,
  handoffTitle,
  signHandoff,
  verifyHandoff,
} from '@/lib/aquachord-handoff';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);
const env = process.env as Record<string, string | undefined>;
const saved = { secret: env.AQUACHORD_HANDOFF_SECRET, origin: env.AQUACHORD_ORIGIN, node: env.NODE_ENV };

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

beforeEach(() => {
  env.AQUACHORD_HANDOFF_SECRET = SECRET;
  delete env.AQUACHORD_ORIGIN;
});
afterEach(() => {
  restore('AQUACHORD_HANDOFF_SECRET', saved.secret);
  restore('AQUACHORD_ORIGIN', saved.origin);
  restore('NODE_ENV', saved.node);
});

function forge(payload: string, key = SECRET): string {
  const sig = createHmac('sha256', key).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

test('a fresh token names its generation and lives 15 minutes', () => {
  const signed = signHandoff(123, NOW);
  assert.ok(signed);
  assert.equal(signed.exp, Math.floor(NOW / 1000) + HANDOFF_TTL_SEC);
  assert.deepEqual(verifyHandoff(signed.token, NOW), { genId: 123, exp: signed.exp });
  assert.deepEqual(verifyHandoff(signed.token, NOW + (HANDOFF_TTL_SEC - 1) * 1000), { genId: 123, exp: signed.exp });
  assert.match(signed.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
});

test('an expired token is refused', () => {
  const signed = signHandoff(123, NOW)!;
  assert.equal(verifyHandoff(signed.token, NOW + HANDOFF_TTL_SEC * 1000), null);
  assert.equal(verifyHandoff(signed.token, NOW + 60 * 60 * 1000), null);
});

test('a token signed with another secret, or after the secret rotated, is refused', () => {
  const exp = Math.floor(NOW / 1000) + 600;
  assert.equal(verifyHandoff(forge(`123.${exp}`, 'some-other-secret'), NOW), null);
  const signed = signHandoff(123, NOW)!;
  env.AQUACHORD_HANDOFF_SECRET = 'rotated-secret-abcdefghijklmnop';
  assert.equal(verifyHandoff(signed.token, NOW), null);
});

test('changing the generation or the expiry breaks the signature', () => {
  const signed = signHandoff(123, NOW)!;
  const [, sig] = signed.token.split('.');
  const otherId = `${Buffer.from(`124.${signed.exp}`).toString('base64url')}.${sig}`;
  const longer = `${Buffer.from(`123.${signed.exp + 86400}`).toString('base64url')}.${sig}`;
  assert.equal(verifyHandoff(otherId, NOW), null);
  assert.equal(verifyHandoff(longer, NOW), null);
});

test('malformed tokens are refused without throwing', () => {
  const exp = Math.floor(NOW / 1000) + 600;
  for (const bad of [
    undefined, null, 42, '', '.', 'abc', 'a.b', 'a.b.c',
    `${forge(`123.${exp}`)}x`,
    `${forge(`123.${exp}`)}.extra`,
    forge(`0.${exp}`),
    forge(`-5.${exp}`),
    forge(`12a.${exp}`),
    forge(`123.${exp}.1`),
    forge(`123456789012.${exp}`),
    'A'.repeat(500) + '.' + 'B'.repeat(43),
  ]) {
    assert.equal(verifyHandoff(bad, NOW), null, String(bad));
  }
});

test('without the secret nothing is signed and nothing verifies', () => {
  const signed = signHandoff(123, NOW)!;
  delete env.AQUACHORD_HANDOFF_SECRET;
  assert.equal(handoffConfigured(), false);
  assert.equal(signHandoff(123, NOW), null);
  assert.equal(verifyHandoff(signed.token, NOW), null);
  env.AQUACHORD_HANDOFF_SECRET = '   ';
  assert.equal(handoffConfigured(), false);
});

test('bad generation ids are not signed', () => {
  for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(signHandoff(id, NOW), null, String(id));
  }
});

test('partner headers allow AquaChord only, never credentials or *', () => {
  const h = handoffHeaders({ 'content-type': 'audio/flac' });
  assert.equal(h.get('access-control-allow-origin'), 'https://aquachord.online');
  assert.equal(h.get('vary'), 'Origin');
  assert.equal(h.get('cache-control'), 'no-store');
  assert.equal(h.get('access-control-expose-headers'), 'Content-Length, Content-Type');
  assert.equal(h.get('access-control-allow-credentials'), null);
  assert.equal(h.get('content-type'), 'audio/flac');
});

test('AQUACHORD_ORIGIN points at a local AquaChord, but never in production', () => {
  env.AQUACHORD_ORIGIN = 'http://localhost:8123/some/path';
  env.NODE_ENV = 'development';
  assert.equal(aquachordOrigin(), 'http://localhost:8123');
  env.AQUACHORD_ORIGIN = 'javascript:alert(1)';
  assert.equal(aquachordOrigin(), 'https://aquachord.online');
  env.AQUACHORD_ORIGIN = 'http://localhost:8123';
  env.NODE_ENV = 'production';
  assert.equal(aquachordOrigin(), 'https://aquachord.online');
});

test('only a stored, undeleted song in a browser format is handed over', () => {
  const ok = { type: 'audio', resultUrl: 'https://pub.r2.dev/a/song.FLAC?v=1', mediaDeletedAt: null };
  assert.deepEqual(handoffAudio(ok), { url: ok.resultUrl, ext: 'flac', mime: 'audio/flac' });
  assert.equal(handoffAudio({ ...ok, resultUrl: 'https://x/y.mp3' })?.mime, 'audio/mpeg');
  assert.equal(handoffAudio({ ...ok, type: 'video' }), null);
  assert.equal(handoffAudio({ ...ok, resultUrl: null }), null);
  assert.equal(handoffAudio({ ...ok, mediaDeletedAt: new Date() }), null);
  assert.equal(handoffAudio({ ...ok, resultUrl: 'https://x/y.mp4' }), null);
  assert.equal(handoffAudio({ ...ok, resultUrl: 'https://x/y.constructor' }), null);
});

test('title: the given name, else the first line of the prompt', () => {
  assert.equal(handoffTitle('Thai pop ballad', { suno: { title: 'ฝนตกที่หน้าต่าง' } }), 'ฝนตกที่หน้าต่าง');
  assert.equal(handoffTitle('\n  Thai pop\tballad  \nsecond line', {}), 'Thai pop ballad');
  assert.equal(handoffTitle(null, null), 'X-DREAMER song');
  assert.equal(handoffTitle('x'.repeat(300), null).length, 120);
});

test('lyrics come from params.lyrics, capped', () => {
  assert.equal(handoffLyrics({ lyrics: '[Verse]\r\nบรรทัด 1\r\nบรรทัด 2  ' }), '[Verse]\nบรรทัด 1\nบรรทัด 2');
  assert.equal(handoffLyrics({ lyrics: 5 }), '');
  assert.equal(handoffLyrics(null), '');
  assert.equal(handoffLyrics({ lyrics: 'a'.repeat(30_000) }).length, 20_000);
  // What Suno sang wins over an empty or typed box (output-lyrics.ts).
  assert.equal(handoffLyrics({ lyrics: '', outputLyrics: ['[Verse]\r\nร้องจริง', 'อีกเวอร์ชัน'] }), '[Verse]\nร้องจริง');
  assert.equal(handoffLyrics({ lyrics: 'พิมพ์เอง', outputLyrics: ['  '] }), 'พิมพ์เอง');
});

test('language: the studio choice first, else the lyrics script', () => {
  assert.equal(handoffLang({ music: { language: 'th' } }, ''), 'th');
  assert.equal(handoffLang({ music: { language: 'th_en' } }, ''), 'th');
  assert.equal(handoffLang({ music: { language: 'en' } }, 'ภาษาไทย'), 'en');
  assert.equal(handoffLang({ music: { language: 'ja' } }, ''), 'auto');
  assert.equal(handoffLang({}, '[Verse]\nฝนตกที่หน้าต่าง คิดถึงเธอ'), 'th');
  assert.equal(handoffLang({}, 'Rain on the window, thinking of you'), 'en');
  assert.equal(handoffLang({}, ''), 'auto');
});
