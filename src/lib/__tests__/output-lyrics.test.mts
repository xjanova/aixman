/**
 * A finished song shows its words (output-lyrics.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/output-lyrics.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songLyrics, songTracks, sunoTrackLyrics } from '@/lib/output-lyrics';

const A = 'https://cdn.kie.test/a.mp3';
const B = 'https://cdn.kie.test/b.mp3';

test('Suno tracks give their own words, matched by file', () => {
  const resultJson = {
    data: [
      { audio_url: B, title: 'x', prompt: '[Verse]\nฝนตก\n\n[Chorus]\nคิดถึง' },
      { audio_url: A, title: 'x', prompt: '[Verse]\nแดดออก' },
    ],
  };
  assert.deepEqual(sunoTrackLyrics([resultJson], [A, B]), ['[Verse]\nแดดออก', '[Verse]\nฝนตก\n\n[Chorus]\nคิดถึง']);
});

test('the camelCase sunoData shape and an explicit lyric field are read', () => {
  const response = { sunoData: [{ audioUrl: A, lyric: 'la la\nla' }, { audioUrl: B, prompt: 'line one\nline two' }] };
  assert.deepEqual(sunoTrackLyrics([null, response], [A, B]), ['la la\nla', 'line one\nline two']);
});

test('an instrumental track’s one-line style is not lyrics', () => {
  assert.equal(sunoTrackLyrics([{ data: [{ audio_url: A, prompt: 'lofi chill beat' }] }], [A]), undefined);
  assert.equal(sunoTrackLyrics([{ data: [] }], [A]), undefined);
  assert.equal(sunoTrackLyrics([{ data: [{ audio_url: A, prompt: 'x\ny' }] }], []), undefined);
});

test('files renamed after the read still line up by order', () => {
  const resultJson = { data: [{ audio_url: 'https://other/1.mp3', prompt: 'a\nb' }, { audio_url: 'https://other/2.mp3', prompt: 'c\nd' }] };
  assert.deepEqual(sunoTrackLyrics([resultJson], [A, B]), ['a\nb', 'c\nd']);
});

test('stored words win; the customer’s own lyrics are the fallback', () => {
  assert.deepEqual(songLyrics({ lyrics: 'mine', outputLyrics: ['sung 1', 'sung 2'] }, [A, B]), ['sung 1', 'sung 2']);
  assert.deepEqual(songLyrics({ lyrics: ' mine\r\n' }, [A, B]), ['mine', 'mine']);
  assert.deepEqual(songLyrics({ lyrics: 'mine' }, null), ['mine']);
  assert.deepEqual(songLyrics({ lyrics: 'mine', outputLyrics: ['only one'] }, [A, B]), ['mine', 'mine']);
});

test('no words, a stem split, or no params → nothing to show', () => {
  assert.equal(songLyrics({ prompt: 'x' }, [A]), null);
  assert.equal(songLyrics({ lyrics: '   ' }, [A]), null);
  assert.equal(songLyrics({ lyrics: 'mine', outputLabels: ['เสียงร้อง', 'กลอง'] }, [A, B]), null);
  assert.equal(songLyrics(null, [A]), null);
});

test('songTracks: each take is a song with what it sings; a stem split is one song', () => {
  assert.deepEqual(songTracks({ lyrics: 'mine', outputLyrics: ['sung 1', 'sung 2'] }, A, [A, B]), [
    { url: A, lyrics: 'sung 1' },
    { url: B, lyrics: 'sung 2' },
  ]);
  // Suno wrote the words itself: the typed lyrics are empty, the takes still sing.
  assert.deepEqual(songTracks({ lyrics: '', outputLyrics: ['a', 'b'] }, A, [A, B]).map((x) => x.lyrics), ['a', 'b']);
  assert.deepEqual(songTracks({ lyrics: 'mine' }, A, null), [{ url: A, lyrics: 'mine' }]);
  assert.deepEqual(songTracks({ lyrics: 'mine', outputLabels: ['เสียงร้อง', 'กลอง'] }, A, [A, B]), [{ url: A, lyrics: 'mine' }]);
  assert.deepEqual(songTracks({}, null, null), []);
  assert.deepEqual(songTracks(null, A, [A, 7]), [{ url: A, lyrics: '' }]);
});
