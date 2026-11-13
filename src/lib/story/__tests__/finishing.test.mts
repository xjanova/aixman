import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectFilter, joinGraph, lookGrade, sfxSource, shotCut } from '@/lib/story/finishing';
import { buildAss, buildSrt, episodeEdit, parseEdit, subtitleCues, type CutShot } from '@/lib/story/edit';

test('editing accepts only supported effects and finite bounded volume', () => {
  assert.deepEqual(shotCut({ transition: 'movie=secret', effect: 'bad', sfx: 'bad', sfxVolume: Infinity }), shotCut(null));
  assert.equal(shotCut({ sfxVolume: -1 }).sfxVolume, 0);
  assert.equal(shotCut({ sfxVolume: 10 }).sfxVolume, 1);
  assert.equal(sfxSource({ sfx: 'whoosh', sfxVolume: 0 }), null);
  assert.match(sfxSource({ sfx: 'impact' })!, /frequency=65/);
  assert.match(effectFilter('flash'), /eval=frame/);
  assert.match(lookGrade('wuxia'), /colorbalance/);
  assert.equal(effectFilter('unknown'), '');
});
test('dissolves preserve shot boundaries and audio rather than overlapping or shortening dialogue', () => {
  const graph = joinGraph([{ seconds: 4, transition: 'cut' }, { seconds: 3, transition: 'dissolve' }, { seconds: 5, transition: 'wipeleft' }]);
  assert.match(graph, /tpad=stop_mode=clone:stop_duration=0.3/);
  assert.match(graph, /offset=4.000/);
  assert.match(graph, /offset=7.000/);
  assert.match(graph, /\[a0\]\[a1\]\[a2\]concat=n=3:v=0:a=1/);
  assert.doesNotMatch(graph, /acrossfade/);
  assert.doesNotMatch(joinGraph([{ seconds: 4, transition: 'cut' }, { seconds: 3, transition: 'cut' }]), /xfade/);
});
test('SRT follows measured dub duration and cut timing; captions cannot become ASS commands', () => {
  const shots: CutShot[] = [{ number: 1, seconds: 4, voiceSeconds: 1.25, text: 'สวัสดี', burnsSubs: false }, { number: 2, seconds: 3, text: 'ลาก่อน', burnsSubs: false }];
  const srt = buildSrt(subtitleCues(shots, false));
  assert.match(srt, /00:00:00,000 --> 00:00:01,250/);
  assert.match(srt, /00:00:04,050 --> 00:00:06,950/);
  const ass = buildAss({ aspect: '9:16', cues: [], font: 'Sarabun', recap: '{\\pos(0,0)}เรื่องก่อน', ending: 'ต่อไป', seconds: 7 });
  assert.doesNotMatch(ass, /\\pos/);
  assert.match(ass, /0:00:04.50,0:00:07.00,Card/);
});
test('a new episode inherits its score and edit but never the previous episode delivery', () => {
  const seeded = episodeEdit({ edit: { transition: 'dissolve', normalizeAudio: true }, music: { generationId: 17, seconds: 120 }, delivery: { srt: 'old' } });
  assert.deepEqual(seeded.music, { generationId: 17, seconds: 120 });
  assert.equal('delivery' in seeded, false);
  assert.equal(parseEdit(seeded.edit, 'film').normalizeAudio, true);
  assert.equal(parseEdit(episodeEdit(null).edit, 'film').episodeCards, true);
  assert.equal(parseEdit({ episodeCards: true }, 'mv').episodeCards, false);
});
