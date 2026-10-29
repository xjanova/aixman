/**
 * Suno's seven tools: what each sends, what the stored choices may hold, the
 * checks on the customer's track, the stems' names and the prices.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/kie-suno.test.mts)
 *
 * Field names and limits follow docs.kie.ai/suno-api (2026-10-29). The adapter
 * runs on a stubbed `globalThis.fetch`; nothing reaches the network.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSunoTask,
  checkSunoSource,
  sanitizeSunoParams,
  sunoStemLabels,
  sunoStudioOptions,
  SUNO_STEMS,
  SUNO_STEM_TIERS,
  SUNO_VERSIONS,
  type SunoOrder,
  type SunoTool,
} from '@/lib/providers/kie-suno';
import { getKieEntry, KIE_CATALOG, kiePriceTable } from '@/lib/providers/kie-catalog';
import { kieQuote } from '@/lib/providers/kie-pricing';
import { KieProvider } from '@/lib/providers/kie';
import { whyNotFallback, type FallbackOrder, type FallbackRow } from '@/lib/providers/kie-fallback';

class FastKie extends KieProvider {
  protected pollIntervalMs = 0;
  protected retryDelayMs = 0;
}

const SONG = 'https://cdn.example.test/uploads/7/audio/song.mp3';

const order = (o: Partial<SunoOrder> = {}): SunoOrder => ({
  style: 'thai pop, female vocal',
  prompt: 'เพลงรักริมทะเล, อบอุ่น',
  instrumental: false,
  tier: 'V6',
  suno: {},
  ...o,
});

const CUSTOM_ONLY = ['vocal_gender', 'style_weight', 'weirdness_constraint', 'audio_weight', 'variety', 'duration'];

// ---------------------------------------------------------------- builders

test('song with lyrics: custom mode, the words, the voice and every fine-tuning field', () => {
  const t = buildSunoTask('song', order({
    lyrics: '[Verse]\nคลื่นซัดฝั่ง',
    vocalGender: 'f',
    negativePrompt: 'autotune',
    suno: { title: 'ทะเล', exclude: 'metal', styleWeight: 0.7, weirdness: 0.2, audioWeight: 0.4, variety: 3, length: 120 },
  }));
  assert.equal(t.model, 'ai-music-api/generate');
  assert.deepEqual(t.input, {
    custom_mode: true,
    instrumental: false,
    model: 'V6',
    title: 'ทะเล',
    style: 'thai pop, female vocal',
    lyrics: '[Verse]\nคลื่นซัดฝั่ง',
    vocal_gender: 'f',
    negative_tags: 'metal, autotune',
    duration: 120,
    style_weight: 0.7,
    weirdness_constraint: 0.2,
    audio_weight: 0.4,
    variety: 3,
  });
});

test('song without words: simple mode carries a style and none of the custom-only fields', () => {
  const t = buildSunoTask('song', order({ vocalGender: 'm', suno: { styleWeight: 0.9, length: 60, variety: 4 } }));
  assert.equal(t.input.custom_mode, false);
  assert.equal(t.input.style, 'thai pop, female vocal');
  assert.equal(t.input.prompt, 'เพลงรักริมทะเล, อบอุ่น');
  for (const k of CUSTOM_ONLY) assert.equal(k in t.input, false, k);
  assert.equal('lyrics' in t.input, false);
});

test('song with no description at all still sends the style simple mode requires', () => {
  const t = buildSunoTask('song', order({ style: '', prompt: '' }));
  assert.equal(t.input.style, 'pop');
  assert.equal('prompt' in t.input, false);
});

test('an instrumental sends no lyrics, voice or audio weight', () => {
  for (const tool of ['song', 'cover', 'extend'] as SunoTool[]) {
    const t = buildSunoTask(tool, order({
      instrumental: true, lyrics: 'ไม่ควรส่ง', vocalGender: 'f', audio: SONG, suno: { audioWeight: 0.5, continueAt: 30 },
    }));
    assert.equal(t.input.instrumental, true, tool);
    for (const k of ['lyrics', 'vocal_gender', 'audio_weight']) assert.equal(k in t.input, false, `${tool} ${k}`);
  }
});

test('cover and extension start from our URL; an extension carries where it picks up', () => {
  const cover = buildSunoTask('cover', order({ audio: SONG, tier: 'V6_WILD' }));
  assert.equal(cover.model, 'ai-music-api/upload-and-cover-audio');
  assert.equal(cover.input.upload_url, SONG);
  assert.equal(cover.input.model, 'V6_WILD');
  assert.equal('custom_mode' in cover.input, false);
  assert.equal('continue_at' in cover.input, false);

  const ext = buildSunoTask('extend', order({ audio: SONG, suno: { continueAt: 42.5, length: 200 } }));
  assert.equal(ext.model, 'ai-music-api/upload-and-extend-audio');
  assert.equal(ext.input.continue_at, 42.5);
  assert.equal('duration' in ext.input, false);
  assert.ok(String(ext.input.title).length <= 100);
});

test('added vocals and an added band always carry the fields their endpoints require', () => {
  const v = buildSunoTask('add-vocals', order({ audio: SONG, style: '', instrumental: true, lyrics: '[Chorus]\nลาลา' }));
  assert.equal(v.model, 'ai-music-api/add-vocals');
  assert.equal(v.input.upload_url, SONG);
  assert.equal(v.input.style, 'pop vocal');
  assert.ok(v.input.negative_tags);
  assert.ok(v.input.title);
  assert.equal(v.input.lyrics, '[Chorus]\nลาลา', 'the vocals switch never mutes the words added vocals sing');

  const b = buildSunoTask('add-instrumental', order({ audio: SONG, style: 'acoustic band', vocalGender: 'm' }));
  assert.equal(b.model, 'ai-music-api/add-instrumental');
  assert.equal(b.input.tags, 'acoustic band');
  assert.ok(b.input.negative_tags);
  assert.equal(b.input.vocal_gender, 'm');
  assert.equal('lyrics' in b.input, false);
  assert.equal('style' in b.input, false);
});

test('stems: the split type per tier; only "one" names a stem', () => {
  const pick = (tier: string, stem?: string) => buildSunoTask('stems', order({ audio: SONG, tier, suno: stem ? { stem } : {} }));
  assert.deepEqual(pick('vocals').input, { audio_url: SONG, type: 'separate_vocal' });
  assert.deepEqual(pick('all').input, { audio_url: SONG, type: 'split_stem' });
  assert.deepEqual(pick('one', 'Bass').input, { audio_url: SONG, type: 'split_stem_advanced', stem_name: 'Bass' });
  assert.equal(pick('one').input.stem_name, SUNO_STEMS[0].id);
  assert.equal(pick('all', 'Bass').input.stem_name, undefined);
  assert.equal(pick('vocals').model, 'ai-music-api/separate-vocals');
});

test('sounds: a prompt of at most 500, loop/tempo/key only when chosen', () => {
  const plain = buildSunoTask('sounds', order({ prompt: 'ฝนตก'.repeat(200) }));
  assert.equal(plain.model, 'ai-music-api/sounds');
  assert.equal(String(plain.input.prompt).length, 500);
  assert.equal('sound_loop' in plain.input, false);
  assert.equal('sound_tempo' in plain.input, false);
  const set = buildSunoTask('sounds', order({ prompt: 'boom bap', suno: { loop: true, tempo: 90, key: 'Am' } }));
  assert.equal(set.input.sound_loop, true);
  assert.equal(set.input.sound_tempo, 90);
  assert.equal(set.input.sound_key, 'Am');
});

// ---------------------------------------------------------------- stored choices

test('sanitizeSunoParams keeps known fields, in range, and nothing else', () => {
  assert.deepEqual(sanitizeSunoParams(null), {});
  assert.deepEqual(sanitizeSunoParams([1]), {});
  const s = sanitizeSunoParams({
    title: '  ชื่อ\u0007เพลง  ', exclude: 'x'.repeat(900), styleWeight: 3, weirdness: -1, audioWeight: '0.333',
    variety: 9, length: 5, continueAt: 1000, stem: 'Bass', loop: 'yes', tempo: 0, key: 'Any', extra: 'drop me',
  });
  assert.deepEqual(s, {
    title: 'ชื่อ เพลง',
    exclude: 'x'.repeat(500),
    styleWeight: 1,
    weirdness: 0,
    audioWeight: 0.33,
    variety: 4,
    length: 10,
    continueAt: 480,
    stem: 'Bass',
    tempo: 1,
  });
  assert.deepEqual(sanitizeSunoParams({ stem: 'Kazoo', key: 'H', continueAt: 0, length: 999, loop: true }), { length: 360, loop: true });
  assert.equal(sanitizeSunoParams({ title: 'ก'.repeat(200) }).title?.length, 80);
});

// ---------------------------------------------------------------- the customer's track

test('a track longer than 8 minutes is refused before charging; stems also over 20 MB', () => {
  for (const tool of ['cover', 'extend', 'add-vocals', 'add-instrumental', 'stems'] as SunoTool[]) {
    const r = checkSunoSource(tool, { seconds: 481, bytes: 1000 }, {});
    assert.equal(r.ok, false, tool);
    assert.equal(r.ok === false && r.code, 'song-too-long');
  }
  const message = (seconds: number) => {
    const r = checkSunoSource('cover', { seconds, bytes: 1000 }, {});
    return r.ok === false && typeof r.message === 'string' ? r.message : '';
  };
  assert.match(message(539.6), /ยาว 9:00 นาที/);
  assert.match(message(480.2), /ยาว 8:01 นาที/);
  const big = checkSunoSource('stems', { seconds: 200, bytes: 21 * 1024 * 1024 }, {});
  assert.equal(big.ok === false && big.code, 'song-too-large');
  assert.equal(checkSunoSource('cover', { seconds: 200, bytes: 21 * 1024 * 1024 }, {}).ok, true);
  assert.equal(checkSunoSource('cover', { seconds: 0, bytes: 10 }, {}).ok, false);
  assert.deepEqual(checkSunoSource('song', { seconds: 0, bytes: 0 }, {}), { ok: true });
});

test('an extension starts where asked when that is inside the track, else a second before its end', () => {
  assert.deepEqual(checkSunoSource('extend', { seconds: 180.4, bytes: 1 }, { continueAt: 60 }), { ok: true, continueAt: 60 });
  assert.deepEqual(checkSunoSource('extend', { seconds: 180.4, bytes: 1 }, { continueAt: 400 }), { ok: true, continueAt: 179 });
  assert.deepEqual(checkSunoSource('extend', { seconds: 180.4, bytes: 1 }, {}), { ok: true, continueAt: 179 });
  assert.equal(checkSunoSource('extend', { seconds: 1.5, bytes: 1 }, {}).ok, false);
});

// ---------------------------------------------------------------- stems' names

test('stems are named from origin_data, an extract/remove pair apart', () => {
  const urls = ['https://f.test/a.mp3', 'https://f.test/b.mp3', 'https://f.test/c.mp3', 'https://f.test/d.mp3'];
  const labels = sunoStemLabels({
    resultObject: {
      origin_data: [
        { audio_url: urls[0], stem_type_group_name: 'Vocals' },
        { audio_url: urls[1], stem_type_group_name: 'Instrumental' },
        { extract: { audio_url: urls[2], stem_type_group_name: 'Bass' }, remove: { audio_url: urls[3], stem_type_group_name: 'Bass' } },
      ],
    },
  }, urls);
  assert.deepEqual(labels, ['เสียงร้อง', 'ดนตรี (ไม่มีเสียงร้อง)', 'เบส', 'เพลงที่ไม่มีเบส']);
});

test('without origin_data, the file name’s suffix names a stem; anything else is numbered', () => {
  assert.deepEqual(
    sunoStemLabels({}, ['https://f.test/x/123_Vocals.mp3', 'https://f.test/x/123_Backing_Vocals.mp3', 'https://f.test/x/zzz.bin']),
    ['เสียงร้อง', 'เสียงประสาน', 'สเต็ม 3'],
  );
  assert.deepEqual(sunoStemLabels('not an object', ['https://f.test/q/9_Drum%20Kit.mp3']), ['กลองชุด']);
});

// ---------------------------------------------------------------- catalogue and prices

const SUNO_KEYS = [
  'kie/suno-v6', 'kie/suno-cover', 'kie/suno-extend', 'kie/suno-add-vocals', 'kie/suno-add-instrumental',
  'kie/suno-stems', 'kie/suno-sounds', 'kie/suno-replace', 'kie/suno-mashup',
];

test('nine Suno rows, each with its tool, a version picker (stems: the split) and a builder', () => {
  for (const key of SUNO_KEYS) {
    const e = getKieEntry(key);
    assert.ok(e, key);
    assert.ok(e!.suno, key);
    assert.equal(e!.tierParam, 'quality', key);
    assert.deepEqual(e!.tiers, e!.suno === 'stems' ? SUNO_STEM_TIERS : SUNO_VERSIONS, key);
  }
  assert.equal(KIE_CATALOG.filter((e) => e.suno).length, 9);
});

test('prices at the default basis: 12 a song or edit, stems 10 / 47 / 19, a sound 3', () => {
  const price = (key: string, tier?: string) => kieQuote(kiePriceTable(getKieEntry(key)!), { tier });
  for (const key of SUNO_KEYS.slice(0, 5)) {
    for (const v of ['V6', 'V6_WILD', 'V6_MINI']) assert.equal(price(key, v), 12, `${key} ${v}`);
  }
  assert.equal(price('kie/suno-stems', 'vocals'), 10);
  assert.equal(price('kie/suno-stems', 'all'), 47);
  assert.equal(price('kie/suno-stems', 'one'), 19);
  assert.equal(price('kie/suno-stems'), 10, 'the default split is the cheapest');
  assert.equal(price('kie/suno-sounds'), 3);
  assert.equal(price('kie/suno-replace'), 5);
  assert.equal(price('kie/suno-mashup'), 12);
});

test('nothing a customer reads names the vendor', () => {
  const VENDOR = /\bkie\b|kie\.ai|redpanda|\bfal\b|replicate/i;
  for (const key of SUNO_KEYS) {
    const e = getKieEntry(key)!;
    assert.doesNotMatch(e.name, VENDOR, key);
    assert.doesNotMatch(e.description ?? '', VENDOR, key);
    for (const t of e.tiers) assert.doesNotMatch(`${t.label} ${t.description ?? ''}`, VENDOR, key);
    assert.doesNotMatch(JSON.stringify(sunoStudioOptions(e.suno!)), VENDOR, key);
  }
  for (const tool of ['cover', 'extend', 'stems'] as SunoTool[]) {
    const r = checkSunoSource(tool, { seconds: 9999, bytes: 99e6 }, {});
    assert.doesNotMatch(r.ok ? '' : JSON.stringify(r.message), VENDOR);
  }
});

test('studio options: which tools take a track, lyrics, the vocals switch', () => {
  assert.equal(sunoStudioOptions('song').sourceSong, false);
  assert.equal(sunoStudioOptions('cover').sourceSong, true);
  assert.equal(sunoStudioOptions('stems').lyrics, false);
  assert.equal(sunoStudioOptions('stems').controls, false);
  assert.equal(sunoStudioOptions('add-instrumental').lyrics, false);
  assert.equal(sunoStudioOptions('add-vocals').suno.instrumental, false);
  assert.equal(sunoStudioOptions('extend').suno.instrumental, true);
  assert.ok(sunoStudioOptions('stems').suno.stems?.length);
  assert.ok(sunoStudioOptions('sounds').suno.keys?.includes('Am'));
});

test('no other provider stands in for a Suno tool: a split is not a song', () => {
  const row = (subcategory: string | null): FallbackRow => ({
    providerSlug: 'fal', providerActive: true, modelId: 'fal-ai/some-music', category: 'audio', subcategory,
    isActive: true, readiness: 'ready', maxDuration: null, costPerUnit: 0.01,
  });
  const ask = (kieKey: string): FallbackOrder => ({
    kieKey, references: 0, firstFrame: false, lastFrame: false, seconds: null, clip: null, voice: null,
  });
  for (const key of SUNO_KEYS) {
    assert.equal(whyNotFallback(ask(key), row(null)), 'ทำงานคนละแบบ', `${key} ← a plain audio row`);
    // A song row may stand in for a song, never for a cover, an extension, a split or a sound.
    if (key !== 'kie/suno-v6') assert.equal(whyNotFallback(ask(key), row('music')), 'ทำงานคนละแบบ', `${key} ← a song row`);
  }
});

// ---------------------------------------------------------------- the adapter

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function stub(record: unknown): { body: Record<string, unknown> | null } {
  const seen: { body: Record<string, unknown> | null } = { body: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (/jobs\/createTask$/.test(url)) {
      seen.body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      return json({ code: 200, msg: 'success', data: { taskId: 'task-1' } });
    }
    if (/jobs\/recordInfo\?taskId=task-1$/.test(url)) {
      return json({ code: 200, msg: 'success', data: { taskId: 'task-1', state: 'success', resultJson: JSON.stringify(record) } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return seen;
}

test('adapter: a stem split names each file it returns', async () => {
  const urls = ['https://tempfile.example.test/s/1_Vocals.mp3', 'https://tempfile.example.test/s/1_Instrumental.mp3'];
  const seen = stub({ resultUrls: urls });
  const result = await new FastKie().generateAudio!({
    modelId: 'kie/suno-stems', prompt: '', inputAudio: SONG, apiKey: 'k', extraParams: { kieTier: 'vocals' },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.resultUrls, urls);
  assert.deepEqual(result.resultLabels, ['เสียงร้อง', 'ดนตรี (ไม่มีเสียงร้อง)']);
  assert.equal(seen.body?.model, 'ai-music-api/separate-vocals');
  assert.deepEqual(seen.body?.input, { audio_url: SONG, type: 'separate_vocal' });
});

test('adapter: the stored Suno choices reach the task, sanitised; a song has no stem names', async () => {
  const seen = stub({ data: [{ audio_url: 'https://cdn.example.test/a.mp3' }, { audio_url: 'https://cdn.example.test/b.mp3' }] });
  const result = await new FastKie().generateAudio!({
    modelId: 'kie/suno-extend',
    prompt: 'rock',
    inputAudio: SONG,
    apiKey: 'k',
    extraParams: { kieTier: 'V6_MINI', suno: { continueAt: 30, variety: 7, junk: 1 }, music: { vocal: 'male' } },
  });
  assert.equal(result.success, true);
  assert.equal(result.resultLabels, undefined);
  const input = seen.body?.input as Record<string, unknown>;
  assert.equal(seen.body?.model, 'ai-music-api/upload-and-extend-audio');
  assert.equal(input.model, 'V6_MINI');
  assert.equal(input.continue_at, 30);
  assert.equal(input.variety, 4);
  assert.equal(input.vocal_gender, 'm');
  assert.equal('junk' in input, false);
});
