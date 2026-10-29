/**
 * Audio files a customer may read through our origin, and how copied files
 * are named.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/own-audio.test.mts)
 *
 * Every song, voice and stem an API vendor sent was stored as `.bin` (its type
 * was right): downloads were saved as `.bin` and the studio's audio route
 * refused the file, so a single-track result would not play there. The file
 * route that draws waveforms must only ever hand over the caller's own files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetType } from '@/lib/storage/media-type';
import { audioTypeFor, isOwnAudioKey, readableAudioUrl } from '@/lib/own-audio';
import { namedByType } from '@/lib/client-actions';

test('copied audio is named by its type, not .bin', () => {
  assert.deepEqual(assetType('audio/mpeg', 'https://cdn.example/x/abc'), { contentType: 'audio/mpeg', ext: 'mp3' });
  assert.deepEqual(assetType('audio/wav; charset=binary', 'https://cdn.example/x'), { contentType: 'audio/wav', ext: 'wav' });
  assert.deepEqual(assetType('AUDIO/X-FLAC', 'https://cdn.example/x'), { contentType: 'audio/x-flac', ext: 'flac' });
  assert.deepEqual(assetType('audio/mp4', 'https://cdn.example/x'), { contentType: 'audio/mp4', ext: 'm4a' });
  assert.deepEqual(assetType('image/png', 'https://cdn.example/x'), { contentType: 'image/png', ext: 'png' });
});

test('an untyped answer is named by its own URL when that is a known type', () => {
  assert.deepEqual(assetType('application/octet-stream', 'https://cdn.example/a/song.MP3?sig=1'), { contentType: 'audio/mpeg', ext: 'mp3' });
  assert.deepEqual(assetType(null, 'https://cdn.example/a/clip.mp4'), { contentType: 'video/mp4', ext: 'mp4' });
  assert.deepEqual(assetType('application/octet-stream', 'https://cdn.example/a/model.glb'), { contentType: 'application/octet-stream', ext: 'bin' });
  // A typed answer is believed over its URL; an unknown type stays .bin.
  assert.deepEqual(assetType('image/svg+xml', 'https://cdn.example/a/x.png'), { contentType: 'image/svg+xml', ext: 'bin' });
  assert.deepEqual(assetType('application/octet-stream', 'data:application/octet-stream;base64,AAAA'), { contentType: 'application/octet-stream', ext: 'bin' });
});

test('own audio: the caller’s uploads and order files, nobody else’s', () => {
  assert.equal(isOwnAudioKey('uploads/5/audio/3f2a9c1e-0b1d-4c55-9a77-1e2d3c4b5a69.mp3', 5), true);
  assert.equal(isOwnAudioKey('generations/5/322/1761731801387-a1b2c3d4e5f6.mp3', 5), true);
  assert.equal(isOwnAudioKey('aixman/generations/5/322/1761731801387-df93f17b.bin', 5), true, 'a bucket prefix is allowed');
  assert.equal(isOwnAudioKey('uploads/6/audio/x.mp3', 5), false, 'another customer');
  assert.equal(isOwnAudioKey('generations/55/322/x.mp3', 5), false, 'id prefix of another customer');
  assert.equal(isOwnAudioKey('uploads/5/image/x.mp3', 5), false, 'not the audio folder');
  assert.equal(isOwnAudioKey('story/5/x.mp3', 5), false);
  assert.equal(isOwnAudioKey('uploads/5/audio/../../generations/6/1/x.mp3', 5), false);
  assert.equal(isOwnAudioKey('uploads/5/audio/..%2F..%2Fgenerations%2F6%2Fx.mp3', 5), false);
  assert.equal(isOwnAudioKey('generations/5/322/sub/x.mp3', 5), false, 'no deeper folders');
  assert.equal(isOwnAudioKey(null, 5), false);
  assert.equal(isOwnAudioKey('uploads/0/audio/x.mp3', 0), false);
});

test('audio is served by its extension; an old .bin by its stored audio type only', () => {
  assert.equal(audioTypeFor('generations/5/1/a.mp3', null), 'audio/mpeg');
  assert.equal(audioTypeFor('generations/5/1/a.FLAC', 'application/octet-stream'), 'audio/flac');
  assert.equal(audioTypeFor('generations/5/1/a.bin', 'audio/mpeg'), 'audio/mpeg');
  assert.equal(audioTypeFor('generations/5/1/a.bin', 'audio/mpeg; charset=binary'), 'audio/mpeg');
  assert.equal(audioTypeFor('generations/5/1/a.bin', 'text/html'), null, 'never anything a page could run');
  assert.equal(audioTypeFor('generations/5/1/a.bin', null), null);
  assert.equal(audioTypeFor('generations/5/1/a.png', 'audio/mpeg'), null, 'a picture is not served as audio');
});

test('the page reads a stored file through our route, a local one as it is', () => {
  const url = 'https://pub.example.r2.dev/uploads/5/audio/a b.mp3';
  assert.equal(readableAudioUrl(url), `/api/studio/audio/file?src=${encodeURIComponent(url)}`);
  assert.equal(readableAudioUrl('blob:https://ai.example/123'), 'blob:https://ai.example/123');
  assert.equal(readableAudioUrl('/api/studio/audio/322'), '/api/studio/audio/322');
});

test('a .bin download is saved under its real extension', () => {
  assert.equal(namedByType('xdreamer-322.bin', 'audio/mpeg'), 'xdreamer-322.mp3');
  assert.equal(namedByType('xdreamer-322-2.bin', 'audio/wav'), 'xdreamer-322-2.wav');
  assert.equal(namedByType('xdreamer-322.mp3', 'audio/wav'), 'xdreamer-322.mp3', 'a named file is left alone');
  assert.equal(namedByType('xdreamer-9.bin', 'application/octet-stream'), 'xdreamer-9.bin');
});
