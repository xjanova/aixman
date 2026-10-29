/**
 * Which karaoke files the retention sweep takes with their song (lyrics/karaoke-files.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/lyrics/__tests__/karaoke-files.test.mts)
 *
 * What must hold: a timing goes with every minus-one made under its id; a
 * song a story project still uses keeps its timing; a timing that could not
 * be read, another song's timing and anything that is not a karaoke file
 * stay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expiredKaraokeKeys, karaokeObject } from '@/lib/lyrics/karaoke-files';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const SONG = 'aixman/generations/7/120/song-0.mp3';
const OTHER = 'aixman/generations/7/121/song-0.mp3';

test('a karaoke file says whose it is, which timing, and whether it is the timing', () => {
  assert.deepEqual(karaokeObject(`aixman/karaoke/7/${A}.json`), { userId: 7, id: A, doc: true });
  assert.deepEqual(karaokeObject(`karaoke/7/${A}-minus-1761700000000.mp3`), { userId: 7, id: A, doc: false });
  assert.equal(karaokeObject(`aixman/karaoke/7/${A}.mp3`), null);
  assert.equal(karaokeObject(`aixman/karaoke/7/short.json`), null);
  assert.equal(karaokeObject(`aixman/uploads/7/audio/${A}.json`), null);
});

test('a timing goes with its song, every minus-one under its id with it', () => {
  const keys = [
    `aixman/karaoke/7/${A}.json`,
    `aixman/karaoke/7/${A}-minus-1.mp3`,
    `aixman/karaoke/7/${A}-minus-2.mp3`,
    `aixman/karaoke/7/${B}.json`,
    `aixman/karaoke/7/${B}-minus-3.mp3`,
  ];
  const songOf = new Map([
    [keys[0], SONG],
    [keys[3], OTHER],
  ]);
  assert.deepEqual(expiredKaraokeKeys(keys, songOf, new Set([SONG]), new Set()), keys.slice(0, 3));
});

test('a song a story project still uses keeps its timing', () => {
  const keys = [`aixman/karaoke/7/${A}.json`, `aixman/karaoke/7/${A}-minus-1.mp3`];
  assert.deepEqual(expiredKaraokeKeys(keys, new Map([[keys[0], SONG]]), new Set([SONG]), new Set([SONG])), []);
});

test('a timing that could not be read stays, and so do its minus-ones', () => {
  const keys = [`aixman/karaoke/7/${C}.json`, `aixman/karaoke/7/${C}-minus-1.mp3`];
  assert.deepEqual(expiredKaraokeKeys(keys, new Map(), new Set([SONG]), new Set()), []);
});
