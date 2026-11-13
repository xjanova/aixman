import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUB_MODEL_KEY, ELEVENLABS_VOICES, deliveryOf, dubbingSettings, dubShotSeconds, dubText, filmDubReady, shotVoice, speechBlock, speechState, spokenText, voiceIdOf, type SpeechFields } from '@/lib/story/dubbing';
import { getKieEntry } from '@/lib/providers/kie-catalog';
import { castOf, episodeLibrary } from '@/lib/story/series';
import { parseEdit, subtitleCues } from '@/lib/story/edit';

const female = ELEVENLABS_VOICES[0].id;
const male = ELEVENLABS_VOICES[1].id;
const project = { scriptJson: { dubbing: { enabled: true, narratorVoiceId: female } }, characters: [{ id: 5, kind: 'character', voiceId: male }, { id: 9, kind: 'prop', voiceId: female }] };
const shot: SpeechFields = { narration: 'เจ้ากลับมาแล้ว', speakerId: 5, delivery: 'whisper', dubStatus: 'done', audioUrl: 'https://cdn/dub.mp3', dubText: '[whispers] เจ้ากลับมาแล้ว', dubVoiceId: male, dubSeconds: 3.451 };

test('voice casting resolves each character and the narrator, without silently substituting a different voice', () => {
  assert.equal(shotVoice(shot, project), male);
  assert.equal(shotVoice({ speakerId: null }, project), female);
  assert.equal(shotVoice({ speakerId: 500 }, project), null);
  assert.equal(shotVoice({ speakerId: 9 }, project), null);
  assert.equal(voiceIdOf('invented-voice'), null);
  const entry = getKieEntry(DUB_MODEL_KEY)!;
  assert.deepEqual(entry.speech!.voices, ELEVENLABS_VOICES);
  const order = entry.build({ prompt: shot.dubText!, voice: male, tier: 'std', seconds: 0, images: [] });
  assert.equal(order.model, 'elevenlabs/text-to-dialogue-v3');
  assert.deepEqual(order.input.dialogue, [{ text: shot.dubText, voice: male }]);
  assert.equal(order.input.language_code, 'th');
});

test('changing the line, delivery, speaker or casting makes a paid dub stale', () => {
  assert.equal(speechState(shot, project), 'done');
  for (const changed of [{ narration: 'อย่าไป' }, { delivery: 'shout' }, { speakerId: null }]) {
    assert.equal(speechState({ ...shot, ...changed }, project), 'stale');
    assert.equal(filmDubReady({ ...shot, ...changed }, project), false);
  }
  assert.equal(speechState(shot, { ...project, characters: [{ id: 5, kind: 'character', voiceId: female }] }), 'stale');
  assert.equal(speechState({ ...shot, dubStatus: 'rendering' }, project), 'rendering');
  assert.equal(speechState({ ...shot, audioUrl: null }, project), 'none');
  assert.equal(filmDubReady(shot, project), true);
});

test('audio length sets the shot; overlong and unknown audio is refused instead of truncated', () => {
  assert.equal(dubShotSeconds(3.451), 3.66);
  assert.equal(dubShotSeconds(0.5), 3);
  assert.equal(dubShotSeconds(9.8), 10);
  for (const value of [9.801, 15, 0, -1, NaN, Infinity]) assert.equal(dubShotSeconds(value), null);
  assert.ok(speechBlock({ ...shot, dubSeconds: 15 }, project));
  assert.ok(speechBlock({ ...shot, dubStatus: 'failed' }, project));
  assert.equal(speechBlock({ ...shot, narration: '' }, project), null, 'silent shots retain their ambient audio');
  assert.equal(filmDubReady({ ...shot, narration: '' }, project), false);
});

test('only known delivery tags reach speech; tags do not appear in subtitles', () => {
  assert.equal(deliveryOf('__proto__'), 'neutral');
  assert.equal(dubText('[laughs]  ข้ายังอยู่\nตรงนี้', 'whisper'), '[whispers] ข้ายังอยู่ ตรงนี้');
  assert.equal(spokenText('[whispers] ข้ายังอยู่'), 'ข้ายังอยู่');
  assert.deepEqual(dubbingSettings(null), { enabled: false, narratorVoiceId: female });
  assert.deepEqual(dubbingSettings({ dubbing: { enabled: 'yes', narratorVoiceId: 'bad' } }), { enabled: false, narratorVoiceId: female });
});

test('subtitle cues end with the actual dub, including short lines, and offset into consecutive shots', () => {
  const cues = subtitleCues([
    { number: 1, seconds: 3, text: 'คำแรก', burnsSubs: false, voiceSeconds: 0.2 },
    { number: 2, seconds: 4, text: 'คำที่สอง', burnsSubs: false, voiceSeconds: 3.451 },
  ], true);
  assert.deepEqual(cues, [{ start: 0, end: 0.2, text: 'คำแรก' }, { start: 3, end: 6.451, text: 'คำที่สอง' }]);
  assert.equal(parseEdit({ lipsync: true }, 'film').lipsync, true);
});

test('series casting persists and seeds future episodes while keeping existing faces', () => {
  const cast = castOf([{ name: 'หลิน', description: 'hero', voiceId: male }]);
  assert.equal(cast[0].voiceId, male);
  assert.equal(castOf([{ name: 'หลิน', voiceId: 'bad' }])[0].voiceId, null);
  const first = episodeLibrary([], cast, []);
  assert.equal(first[0].voiceId, male);
  const later = episodeLibrary([{ ...first[0], voiceId: female, referenceUrl: 'face.png' }], cast, []);
  assert.equal(later[0].voiceId, male, 'explicit series casting wins for new episodes');
  assert.equal(later[0].referenceUrl, 'face.png');
  assert.equal(episodeLibrary(later, [], [])[0].voiceId, male);
});
