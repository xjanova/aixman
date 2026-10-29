/**
 * The KIE.ai catalogue and its prices.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/kie-catalog.test.mts)
 *
 * The studio and GenerationService both price a KIE order with `kieQuote`
 * over the table the sync stores in `defaultParams.kie` — public through
 * /api/models, so it must carry credits only, never the vendor's dollars.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KIE_CATALOG, getKieEntry, kieImageCount, kiePriceTable, nearestAspect, type KieOrder } from '@/lib/providers/kie-catalog';
import { DEFAULT_KIE_BASIS, kieCredits, kieQuote, pickKieDuration, readKiePriceTable, speechChars } from '@/lib/providers/kie-pricing';
import { referenceCaps } from '@/lib/reference-caps';
import { apiVideoLipsyncRule, checkClip } from '@/lib/lipsync-rules';

const order = (over: Partial<KieOrder> = {}): KieOrder => ({
  prompt: 'a lighthouse at dusk',
  tier: '',
  seconds: null,
  images: [],
  ...over,
});

test('credits: twice the cost at the cheapest package rate, rounded up, never zero', () => {
  // $0.02 × ฿36 × 2 / (฿2,499 / 6,500) = 3.75 → 4.
  assert.equal(kieCredits(0.02), 4);
  assert.equal(kieCredits(0.09), 17);
  assert.equal(kieCredits(0.0025), 1);
  assert.equal(kieCredits(0), 1);
  assert.equal(kieCredits(Number.NaN), 1);
  // Float noise just above a whole number is not another credit.
  const basis = { usdToThb: 1, thbPerCredit: 0.1, markup: 1 };
  assert.equal(kieCredits(0.3, basis), 3);
  // A broken rate falls back to the seed rate instead of dividing by zero.
  assert.equal(kieCredits(0.02, { ...DEFAULT_KIE_BASIS, thbPerCredit: 0 }), 4);
});

test('every entry: a unique kie/ key, a default tier, a price for each tier, a sane wait', () => {
  const keys = new Set<string>();
  for (const e of KIE_CATALOG) {
    assert.match(e.key, /^kie\/[a-z0-9-]+$/, e.key);
    assert.ok(!keys.has(e.key), `duplicate ${e.key}`);
    keys.add(e.key);
    assert.ok(e.tiers.length > 0, e.key);
    assert.equal(e.tiers.filter((t) => t.isDefault).length, 1, `${e.key}: one default tier`);
    assert.ok(e.maxWaitSeconds >= 60 && e.maxWaitSeconds <= 60 * 60, e.key);
    for (const t of e.tiers) {
      for (const s of e.durations ?? [1]) {
        const usd = e.usd(t.id, s);
        assert.ok(Number.isFinite(usd) && usd > 0 && usd < 20, `${e.key} ${t.id} ${s}s → ${usd}`);
      }
    }
    // A tier chip the studio cannot show would be a price the customer never sees.
    if (e.tiers.length > 1) assert.ok(e.tierParam, `${e.key}: several tiers need a tierParam`);
    if (e.category === 'image') assert.ok((e.references ?? 0) <= 16, e.key);
    if (e.lastFrame) assert.ok(e.firstFrame, `${e.key}: a last frame needs a first`);
  }
});

test('every entry builds a task with a model and no empty values, for every tier', () => {
  const frame = 'https://cdn.example.test/uploads/7/image/f.png';
  for (const e of KIE_CATALOG) {
    for (const t of e.tiers) {
      const task = e.build(order({
        tier: t.id,
        seconds: e.perSecond ? 6 : e.durations?.[0] ?? null,
        aspectRatio: '16:9',
        images: e.category === 'image' && e.references ? [frame, frame] : [],
        image: e.category === 'edit' || e.firstFrame || e.needsImage || e.subcategory.startsWith('lipsync') ? frame : undefined,
        audio: e.subcategory.startsWith('lipsync') ? 'https://cdn.example.test/uploads/7/audio/v.mp3' : undefined,
        video: e.subcategory === 'lipsync' || e.sourceClip ? 'https://cdn.example.test/uploads/7/video/c.mp4' : undefined,
        voice: e.speech?.voices[0].id,
      }));
      assert.ok(typeof task.model === 'string' && task.model.length > 0, e.key);
      for (const [k, v] of Object.entries(task.input)) {
        assert.ok(v !== undefined && v !== null && v !== '', `${e.key}: ${k} is empty`);
        if (Array.isArray(v)) assert.ok(v.length > 0, `${e.key}: ${k} is an empty list`);
      }
    }
  }
});

test('a model never gets more references than it takes', () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://cdn.example.test/uploads/7/image/${i}.png`);
  for (const e of KIE_CATALOG.filter((x) => x.category === 'image')) {
    const input = e.build(order({ tier: e.tiers[0].id, images: many.slice(0, e.references ?? 0) })).input;
    const sent = Object.values(input).filter(Array.isArray).flat().filter((v) => typeof v === 'string' && v.startsWith('https://'));
    assert.ok(sent.length <= (e.references ?? 0), `${e.key} sent ${sent.length}`);
  }
});

test('the price table holds whole credits only — no dollars reach /api/models', () => {
  for (const e of KIE_CATALOG) {
    const table = kiePriceTable(e);
    const text = JSON.stringify(table);
    assert.doesNotMatch(text, /usd/i, e.key);
    for (const row of Object.values(table.credits)) {
      for (const n of Object.values(row)) assert.ok(Number.isInteger(n) && n >= 1, `${e.key} ${n}`);
    }
    // What the sync stores is what GenerationService reads back.
    assert.deepEqual(JSON.parse(JSON.stringify(readKiePriceTable({ kie: JSON.parse(text) }))), JSON.parse(text), e.key);
  }
});

test('a malformed stored table is ignored, not trusted', () => {
  assert.equal(readKiePriceTable(null), null);
  assert.equal(readKiePriceTable({ kie: { tiers: [], credits: {} } }), null);
  assert.equal(readKiePriceTable({ kie: { tiers: [{ id: 'a', label: 'A' }], credits: { a: { '*': -3 } } } }), null);
  assert.equal(readKiePriceTable({ kie: { tiers: [{ id: 'a', label: 'A' }], credits: {} } }), null);
  const t = readKiePriceTable({ kie: { tierParam: 'evil', tiers: [{ id: 'a', label: 'A' }], credits: { a: { '*': 2.5, x: 3 } }, imageCredits: -1 } });
  assert.equal(t?.tierParam, null);
  assert.deepEqual(t?.credits, { a: { x: 3 } });
  assert.equal(t?.imageCredits, undefined);
});

test('quotes: by tier, by sold length, by voice second, and per extra picture', () => {
  const nano = kiePriceTable(getKieEntry('kie/nano-banana-2-1')!);
  assert.equal(kieQuote(nano, { tier: '1K' }), kieCredits(0.02));
  assert.equal(kieQuote(nano, { tier: '4K' }), kieCredits(0.045));
  // An unknown tier is the default (1K), exactly as the adapter sends it.
  assert.equal(kieQuote(nano, { tier: '16K' }), kieQuote(nano, {}));

  const kling = kiePriceTable(getKieEntry('kie/kling-3')!);
  assert.deepEqual(kling.durations, [5, 10, 15]);
  assert.equal(kieQuote(kling, { tier: '1080p', seconds: 10 }), kieCredits(0.135 * 10));
  // A length not sold is the shortest, the same snap the adapter applies.
  assert.equal(pickKieDuration(kling, 7), 5);
  assert.equal(kieQuote(kling, { tier: '720p', seconds: 7 }), kieCredits(0.1 * 5));

  const avatar = kiePriceTable(getKieEntry('kie/kling-avatar')!);
  assert.equal(avatar.perSecond, true);
  assert.equal(kieQuote(avatar, { seconds: 7.2 }), kieCredits(0.04) * 8);
  assert.equal(kieQuote(avatar, { seconds: 0 }), kieCredits(0.04));

  const seedream = kiePriceTable(getKieEntry('kie/seedream-5-pro')!);
  const base = kieQuote(seedream, { tier: 'basic' });
  assert.equal(kieQuote(seedream, { tier: 'basic', images: 1 }), base);
  assert.equal(kieQuote(seedream, { tier: 'basic', images: 4 }), base + 3 * kieCredits(0.0025));
});

test('billable pictures: references up to the cap; a clip’s frames only where the model takes them', () => {
  const nano = getKieEntry('kie/nano-banana-2-1')!;
  assert.equal(kieImageCount(nano, { references: 14 }), 10);
  const kling = getKieEntry('kie/kling-3')!;
  assert.equal(kieImageCount(kling, { references: 0, inputImage: 'a', inputImageEnd: 'b' }), 2);
  const grok = getKieEntry('kie/grok-imagine-video')!;
  assert.equal(kieImageCount(grok, { references: 0, inputImage: 'a', inputImageEnd: 'b' }), 1);
  assert.equal(kieImageCount(kling, { references: 0 }), 0);
});

test('the studio’s reference caps follow the catalogue', () => {
  for (const e of KIE_CATALOG) {
    const caps = referenceCaps({ providerSlug: 'kie', modelId: e.key, category: e.category });
    if (e.category === 'image') assert.equal(caps.images, e.references ?? 0, e.key);
    if (e.category === 'video') {
      assert.equal(caps.firstFrame, e.firstFrame === true, e.key);
      assert.equal(caps.lastFrame, e.lastFrame === true, e.key);
    }
  }
  // An admin's lower cap still wins; a higher one is held at what the adapter forwards.
  const capped = (n: number) =>
    referenceCaps({ providerSlug: 'kie', modelId: 'kie/nano-banana-pro', category: 'image', defaultParams: { maxReferenceImages: n } }).images;
  assert.equal(capped(2), 2);
  assert.equal(capped(40), 8);
});

test('the clip re-dub has its upload rules; portraits are priced by their voice', () => {
  for (const e of KIE_CATALOG) {
    if (e.subcategory === 'lipsync') assert.ok(apiVideoLipsyncRule(e.key), `${e.key}: no lipsync-rules entry`);
    if (e.subcategory === 'lipsync-portrait') {
      assert.ok(e.perSecond && e.lengthFromAudio, `${e.key}: a portrait is priced by its voice`);
      assert.ok(e.firstFrame !== true, `${e.key}: the face is the portrait's image, not a frame`);
    }
  }
});

test('nearest aspect: the model’s own shape closest to the order', () => {
  assert.equal(nearestAspect('3:2', ['1:1', '16:9', '9:16', '4:3', '3:4']), '4:3');
  assert.equal(nearestAspect('2:3', ['1:1', '16:9', '9:16']), '9:16');
  assert.equal(nearestAspect('16:9', ['1:1', '16:9']), '16:9');
  assert.equal(nearestAspect(undefined, ['auto', '1:1'], 'auto'), 'auto');
  assert.equal(nearestAspect('wide', ['1:1', '16:9']), '1:1');
});

test('the picker test lists every catalogue key', () => {
  const src = readFileSync('src/lib/__tests__/model-samples.test.mts', 'utf8');
  for (const e of KIE_CATALOG) assert.ok(src.includes(`'${e.key}'`), `${e.key} missing from model-samples LIVE_IDS`);
});

test('speech: priced per thousand characters, pro rata, at least one credit', () => {
  const eleven = kiePriceTable(getKieEntry('kie/elevenlabs-v3')!);
  assert.equal(eleven.perChars, 1000);
  assert.equal(eleven.durations, null);
  const perThousand = kieCredits(0.07);
  assert.equal(perThousand, 14);
  assert.equal(kieQuote(eleven, { chars: 1000 }), perThousand);
  assert.equal(kieQuote(eleven, { chars: 5000 }), perThousand * 5);
  // A one-line greeting is not billed a thousand characters…
  assert.equal(kieQuote(eleven, { chars: 200 }), Math.ceil((perThousand * 200) / 1000));
  // …and nothing is free.
  assert.equal(kieQuote(eleven, { chars: 1 }), 1);
  assert.equal(kieQuote(eleven, { chars: 0 }), 1);
  assert.equal(kieQuote(kiePriceTable(getKieEntry('kie/gemini-3-8-flash-tts')!), { chars: 1000 }), kieCredits(0.03));
  // A stored table with a broken character unit is read without it, not trusted.
  const bad = readKiePriceTable({ kie: { tiers: [{ id: 'std', label: 'x' }], credits: { std: { '1': 14 } }, perChars: -5 } });
  assert.equal(bad?.perChars, undefined);
});

test('speech characters are counted the way GenerationService counts them', () => {
  assert.equal(speechChars('  hello  '), 5);
  // Thai is counted by code point, vowel and tone marks included.
  assert.equal(speechChars('สวัสดี'), 6);
  // An emoji is one character, not two UTF-16 halves.
  assert.equal(speechChars('hi 👋'), 4);
  assert.equal(speechChars(undefined), 0);
  assert.equal(speechChars(42), 0);
});

test('speech: voices are unique, labelled "Name — description", and the text is cut to the limit', () => {
  for (const e of KIE_CATALOG.filter((x) => x.speech)) {
    const voices = e.speech!.voices;
    assert.ok(voices.length >= 4, e.key);
    assert.equal(new Set(voices.map((v) => v.id)).size, voices.length, `${e.key}: duplicate voice`);
    for (const v of voices) {
      assert.match(v.id, /^[A-Za-z0-9]+$/, `${e.key}: ${v.id}`);
      assert.match(v.label, /^\S.* — \S/, `${e.key}: ${v.label} — the studio splits the name from the description`);
      assert.ok(v.gender === 'female' || v.gender === 'male', v.id);
    }
    assert.equal(e.category, 'audio');
    assert.equal(e.subcategory, 'speech');
    assert.equal(e.perChars, 1000, e.key);
    const long = 'ก'.repeat(e.speech!.maxChars + 50);
    const text = JSON.stringify(e.build(order({ tier: e.tiers[0].id, prompt: long, voice: voices[0].id })).input);
    assert.ok(!text.includes('ก'.repeat(e.speech!.maxChars + 1)), `${e.key}: text past the limit reached KIE`);
  }
});

test('ElevenLabs: one dialogue turn in the chosen voice, Thai text marked Thai', () => {
  const e = getKieEntry('kie/elevenlabs-v3')!;
  const thai = e.build(order({ tier: 'std', prompt: '  สวัสดีค่ะ [laughs] ยินดีต้อนรับ ', voice: 'EkK5I93UQWFDigLMpZcX' }));
  assert.equal(thai.model, 'elevenlabs/text-to-dialogue-v3');
  assert.deepEqual(thai.input, {
    dialogue: [{ text: 'สวัสดีค่ะ [laughs] ยินดีต้อนรับ', voice: 'EkK5I93UQWFDigLMpZcX' }],
    stability: 0.5,
    language_code: 'th',
  });
  const english = e.build(order({ tier: 'std', prompt: 'Welcome back.', voice: 'hpp4J3VqNfWAUOO0d1Us' }));
  assert.equal((english.input as Record<string, unknown>).language_code, undefined);
});

test('Gemini TTS: one speaker in the chosen voice, the speaking style on its turn', () => {
  const e = getKieEntry('kie/gemini-3-8-flash-tts')!;
  const task = e.build(order({ tier: 'std', prompt: 'นิทานก่อนนอน', voice: 'Puck', speechStyle: 'พูดช้า ๆ อบอุ่น' }));
  assert.equal(task.model, 'google/gemini-3-8-flash-tts');
  assert.deepEqual(task.input, {
    speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Puck' }],
    dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'นิทานก่อนนอน', style: 'พูดช้า ๆ อบอุ่น' }],
  });
  const plain = e.build(order({ tier: 'std', prompt: 'hello', voice: 'Kore' }));
  assert.deepEqual((plain.input as { dialogue_turns: unknown[] }).dialogue_turns, [{ speaker_id: 'Speaker 1', text: 'hello' }]);
});

test('clip tools: priced per second of the clip, with the clip rule the order is checked against', () => {
  const topaz = getKieEntry('kie/topaz-video-upscale')!;
  const motion = getKieEntry('kie/kling-3-motion-control')!;
  for (const e of [topaz, motion]) {
    assert.equal(e.category, 'video');
    assert.equal(e.perSecond, true, e.key);
    assert.ok(e.sourceClip, e.key);
    assert.equal(e.tierParam, 'resolution', `${e.key}: its tiers are the studio's resolution chips`);
    assert.ok(e.maxDuration === e.sourceClip!.maxSeconds, e.key);
  }
  assert.equal(topaz.subcategory, 'video-upscale');
  assert.equal(motion.subcategory, 'motion');
  assert.equal(motion.needsImage, true);

  const up = kiePriceTable(topaz);
  assert.equal(kieQuote(up, { tier: '4', seconds: 12 }), kieCredits(0.07) * 12);
  assert.equal(kieQuote(up, { tier: '2', seconds: 12 }), kieCredits(0.04) * 12);
  assert.equal(kieQuote(up, {}), kieCredits(0.04), 'the default is ×2, one second when no clip is known');
  const mo = kiePriceTable(motion);
  assert.equal(kieQuote(mo, { tier: '1080p', seconds: 10 }), kieCredits(0.135) * 10);

  const clip = { seconds: 8, width: 1280, height: 720, bytes: 20 * 1024 * 1024, ext: 'mp4' as const };
  assert.equal(checkClip(motion.sourceClip!, clip).ok, true);
  assert.equal(checkClip(motion.sourceClip!, { ...clip, seconds: 2 }).ok, false, 'motion needs 3 s');
  assert.equal(checkClip(motion.sourceClip!, { ...clip, seconds: 31 }).ok, false);
  assert.equal(checkClip(motion.sourceClip!, { ...clip, width: 320, height: 240 }).ok, false, 'sides over 340 px');
  assert.equal(checkClip(motion.sourceClip!, { ...clip, ext: 'webm' as never }).ok, false);
  assert.equal(checkClip(topaz.sourceClip!, { ...clip, bytes: 60 * 1024 * 1024 }).ok, false, 'Topaz takes 50 MB');
});

test('clip tools build what KIE documents', () => {
  const video = 'https://cdn.example.test/uploads/7/video/c.mp4';
  const image = 'https://cdn.example.test/uploads/7/image/hero.png';
  assert.deepEqual(getKieEntry('kie/topaz-video-upscale')!.build(order({ tier: '4', video, prompt: '' })), {
    model: 'topaz/video-upscale',
    input: { video_url: video, upscale_factor: '4' },
  });
  const motion = getKieEntry('kie/kling-3-motion-control')!;
  assert.deepEqual(motion.build(order({ tier: '1080p', video, image, prompt: '' })), {
    model: 'kling-3.0/motion-control',
    input: { input_urls: [image], video_urls: [video], mode: '1080p', character_orientation: 'video' },
  });
  const withPrompt = motion.build(order({ tier: '720p', video, image, prompt: ' on a beach at sunset ' })).input as Record<string, unknown>;
  assert.equal(withPrompt.prompt, 'on a beach at sunset');
});
