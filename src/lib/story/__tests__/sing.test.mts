/**
 * MV lip-sync's pure rules: which stretch of the vocal a shot mouths, which
 * shots are worth a dub, when a dub is used in the cut, and the vocal's state.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/sing.test.mts)
 *
 * What must hold: a dub made from an older clip is never cut into the film;
 * the voice window is the shot's own place in the song and within what
 * LatentSync renders; a film never has the lip-sync switch on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultEdit, parseEdit } from '@/lib/story/edit';
import {
  LIPSYNC_MAX_SECONDS,
  dubState,
  meanVolumeDb,
  minusOneFor,
  suggestedForLipsync,
  usableDub,
  vocalsState,
  voiceWindow,
} from '@/lib/story/sing';

test('the voice window is the shot\'s place in the song, within LatentSync\'s length', () => {
  assert.deepEqual(voiceWindow(12.5, 6.25), { ok: true, start: 12.5, seconds: 6.25 });
  assert.equal(voiceWindow(null, 6).ok, false);
  assert.equal(voiceWindow(-1, 6).ok, false);
  assert.equal(voiceWindow(10, 0.5).ok, false);
  assert.equal(voiceWindow(10, LIPSYNC_MAX_SECONDS).ok, true);
  assert.equal(voiceWindow(10, LIPSYNC_MAX_SECONDS + 0.5).ok, false);
});

test('a dub is suggested for a sung line with someone close enough to see a mouth', () => {
  assert.equal(suggestedForLipsync({ line: 'รักเธอ', characterIds: [1], shotSize: 'close' }), true);
  assert.equal(suggestedForLipsync({ line: 'รักเธอ', characterIds: [1], shotSize: 'medium' }), true);
  assert.equal(suggestedForLipsync({ line: 'รักเธอ', characterIds: [1], shotSize: 'wide' }), false);
  assert.equal(suggestedForLipsync({ line: 'รักเธอ', characterIds: [], shotSize: 'close' }), false);
  assert.equal(suggestedForLipsync({ line: '  ', characterIds: [1], shotSize: 'close' }), false);
});

test('only a finished dub of the clip the shot has now, switched on, is cut in', () => {
  const base = { mediaUrl: 'https://cdn/a.mp4', lipsyncStatus: 'done', lipsyncUrl: 'https://cdn/dub.mp4', lipsyncSourceUrl: 'https://cdn/a.mp4', lipsyncUse: true };
  assert.equal(dubState(base), 'done');
  assert.equal(usableDub(base), true);
  // The shot was re-rendered after the dub.
  assert.equal(dubState({ ...base, mediaUrl: 'https://cdn/b.mp4' }), 'stale');
  assert.equal(usableDub({ ...base, mediaUrl: 'https://cdn/b.mp4' }), false);
  assert.equal(usableDub({ ...base, lipsyncUse: false }), false);
  assert.equal(usableDub({ ...base, lipsyncStatus: 'rendering' }), false);
  assert.equal(dubState({ ...base, lipsyncStatus: null, lipsyncUrl: null }), 'none');
  assert.equal(dubState({ ...base, lipsyncStatus: 'failed' }), 'failed');
});

test('volumedetect output is read, silence included', () => {
  assert.equal(meanVolumeDb('[Parsed_volumedetect_0 @ 0x1] mean_volume: -23.4 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -3.0 dB'), -23.4);
  assert.equal(meanVolumeDb('mean_volume: -inf dB'), -Infinity);
  assert.equal(meanVolumeDb('nothing here'), null);
});

test('the vocal\'s state: a dead separation fails, another song makes it stale', () => {
  const song = 'https://cdn/song.mp3';
  const now = Date.UTC(2026, 9, 27, 12);
  const p = { vocalsStatus: 'separating', vocalsUrl: null, vocalsSongUrl: song, songUrl: song, vocalsStartedAt: new Date(now - 60_000) };
  assert.equal(vocalsState(p, 40 * 60_000, now), 'separating');
  assert.equal(vocalsState({ ...p, vocalsStartedAt: new Date(now - 41 * 60_000) }, 40 * 60_000, now), 'failed');
  const done = { ...p, vocalsStatus: 'done', vocalsUrl: 'https://cdn/v.mp3' };
  assert.equal(vocalsState(done, 40 * 60_000, now), 'done');
  assert.equal(vocalsState({ ...done, songUrl: 'https://cdn/other.mp3' }, 40 * 60_000, now), 'stale');
  assert.equal(vocalsState({ ...p, vocalsStatus: null }, 40 * 60_000, now), 'none');
});

test('a separated vocal has its minus-one beside it; an uploaded stem has none', () => {
  assert.equal(minusOneFor('story/7/31/vocals-1761700000000.mp3'), 'story/7/31/vocals-1761700000000-minus.mp3');
  assert.equal(
    minusOneFor('https://cdn.example/aixman/story/7/31/vocals-1761700000000.mp3'),
    'https://cdn.example/aixman/story/7/31/vocals-1761700000000-minus.mp3'
  );
  assert.equal(minusOneFor('https://cdn.example/aixman/uploads/7/audio/vocals-1761700000000.mp3'), null);
  assert.equal(minusOneFor('story/7/31/vocals-1761700000000-minus.mp3'), null);
  assert.equal(minusOneFor('story/7/31/sing-4-1761700000000.wav'), null);
});

test('the lip-sync switch is an MV setting: on by default there, never on for a film', () => {
  assert.equal(defaultEdit('mv').lipsync, true);
  assert.equal(parseEdit({ lipsync: false }, 'mv').lipsync, false);
  assert.equal(parseEdit({ lipsync: true }, 'film').lipsync, false);
});
