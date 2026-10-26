/**
 * The workflow layer end to end, with no ComfyUI and no GPU: every catalogue
 * entry is built in every shape an order can take — through `buildJobGraph`,
 * the function the workers and /admin/workflows share — and validated against
 * the vendored ComfyUI v0.36.0 schema. Then the values that are *valid but
 * could be wrong* are read back and checked, because the validator cannot tell
 * a Lightning switch left off from one turned on.
 *
 * Run: npx tsx --test src/lib/gpu/__tests__/workflows.test.mts
 *
 * (tsx rather than plain `node --test`: the catalogue imports its templates as
 * JSON, which Node's own loader refuses without import attributes.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The override store imports Prisma, whose adapter wants a URL at import time.
// Nothing here queries a database.
process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const { MODEL_CATALOG, getCatalogEntry, nearestBucket, h3Prompt, ltxFrame } = await import('@/lib/gpu/catalog');
const { validateGraph } = await import('@/lib/gpu/comfy-validate');
const { alternativeTunables, coerceTunable, resolveTunables } = await import('@/lib/gpu/tunables');
const { buildJobGraph, sampleJob, shapePrompt } = await import('@/lib/gpu/workflow-build');
const { effectiveWorkflow, pickQualityMode, sanitizeOverride, visibleQualityModes } = await import('@/lib/gpu/workflow-overrides');
const baseline = (await import('@/lib/gpu/workflows/schema/baseline-v0.36.0.json')).default as { classes: Record<string, unknown> };
const hunyuan3dPack = (await import('@/lib/gpu/workflows/schema/hunyuan3d21-pack.json')).default as { classes: Record<string, unknown> };
const latentsyncPack = (await import('@/lib/gpu/workflows/schema/latentsync-pack.json')).default as { classes: Record<string, unknown> };

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type Schema = Parameters<typeof validateGraph>[1];

const FIRST = 'aixman-first-test.png';
const LAST = 'aixman-last-test.png';
const AUDIO = 'aixman-source-test.mp3';

/** The baseline with the test's stand-in uploads present in the input dir. */
function schema(): Schema {
  // The packs catalogue entries install, as a worker that booted them would report.
  const s = JSON.parse(JSON.stringify({ ...baseline.classes, ...hunyuan3dPack.classes, ...latentsyncPack.classes })) as Record<string, { input?: { required?: Record<string, unknown[]> } }>;
  const add = (cls: string, input: string, names: string[]) => {
    const def = s[cls]?.input?.required?.[input];
    if (!def) return;
    if (Array.isArray(def[0])) (def[0] as unknown[]).push(...names);
    else if (def[0] === 'COMBO') {
      const opts = (def[1] ?? {}) as { options?: unknown[] };
      opts.options = [...(opts.options ?? []), ...names];
      def[1] = opts;
    }
  };
  // …and its own stand-in portrait for entries that make one speak.
  add('LoadImage', 'image', [FIRST, LAST, 'aixman-first-sample.png']);
  add('Hy3D21LoadImageWithTransparency', 'image', [FIRST, 'aixman-first-sample.png']);
  // `sampleJob` names its own stand-in song for entries that need one.
  add('LoadAudio', 'audio', [AUDIO, 'aixman-source-sample.mp3']);
  return s as Schema;
}

function build(key: string, job: Record<string, unknown> = {}, workflow: Record<string, unknown> | null = null): { graph: Graph; warnings: string[]; custom: boolean } {
  const entry = getCatalogEntry(key);
  assert.ok(entry, `no catalogue entry ${key}`);
  const base = sampleJob(entry, job as never);
  const { tuning: _unused, ...params } = base;
  void _unused;
  const wf = workflow
    ? {
        tuning: resolveTunables(entry.tunables, (workflow.tuning as Record<string, unknown>) ?? null),
        nodeInputs: [],
        promptPrefix: '',
        promptSuffix: '',
        customGraph: null,
        version: 1,
        ...workflow,
      }
    : null;
  const s = schema();
  const built = buildJobGraph(entry, s, params, wf as never, {
    first: base.imageFilename,
    last: base.lastImageFilename,
    audio: base.audioFilename,
    video: base.videoFilename,
  });
  const validated = validateGraph(built.graph, s);
  return { graph: validated.graph as Graph, warnings: [...built.warnings, ...validated.warnings], custom: built.custom };
}

// ---------------------------------------------------------------------------

test('every catalogue entry builds and validates in every shape an order can take', () => {
  for (const entry of MODEL_CATALOG) {
    const shapes: { label: string; job: Record<string, unknown>; tuning?: Record<string, unknown> }[] = [{ label: 'default', job: {} }];
    for (const m of entry.qualityModes ?? []) shapes.push({ label: `quality ${m.id}`, job: { quality: m.id } });
    if (entry.tunables?.length) shapes.push({ label: 'every tunable moved', job: {}, tuning: alternativeTunables(entry.tunables) });
    if (entry.video?.firstFrame) shapes.push({ label: 'first frame', job: { imageFilename: FIRST } });
    if (entry.video?.lastFrame) shapes.push({ label: 'first+last', job: { imageFilename: FIRST, lastImageFilename: LAST } });
    if (entry.needs?.audio) shapes.push({ label: 'uploaded song', job: { audioFilename: AUDIO } });
    for (const shape of shapes) {
      assert.doesNotThrow(
        () => build(entry.key, shape.job, shape.tuning ? { tuning: shape.tuning } : null),
        `${entry.key} · ${shape.label}`
      );
    }
  }
});

test('tunable defaults reproduce what the catalogue rendered before tunables existed', () => {
  const h3 = build('minimax-h3', { width: 1344, height: 768 }).graph;
  assert.equal(h3['105_9'].inputs.steps, 4);
  assert.equal(h3['105_17'].inputs.sampler_name, 'euler');
  assert.equal(h3['105_120'].inputs.shift_video, 6);
  assert.equal(h3['105_120'].inputs.shift_audio, 3);
  assert.equal(h3['105_119'].inputs.strength_model, 1);

  const portrait = build('minimax-h3', { width: 768, height: 1344 }).graph;
  assert.equal(portrait['105_9'].inputs.steps, 8);
  assert.equal(portrait['105_120'].inputs.shift_video, 12);

  const ace = build('ace-step-1.5').graph;
  assert.equal(ace['3'].inputs.steps, 8);

  const sdxl = build('sdxl-community', { steps: 42 }).graph;
  assert.equal(sdxl['5'].inputs.steps, 20, 'a caller may ask for fewer steps, never more');
  assert.equal(sdxl['5'].inputs.cfg, 6.5);
});

test('Qwen-Image renders at its native canvas for the requested shape', () => {
  assert.deepEqual(nearestBucket(1344, 768, [{ w: 1664, h: 928 }, { w: 1328, h: 1328 }]), { w: 1664, h: 928 });
  const cases: [number, number, number, number][] = [
    [1024, 1024, 1328, 1328],
    [1344, 768, 1664, 928],
    [768, 1344, 928, 1664],
    [1216, 832, 1584, 1056],
    [1152, 896, 1472, 1136], // 1140 on the model card, snapped to the latent's 16 px
    [896, 1152, 1136, 1472],
    [832, 1216, 1056, 1584],
  ];
  for (const [w, h, ew, eh] of cases) {
    const g = build('qwen-image', { width: w, height: h }).graph;
    assert.deepEqual([g['76_58'].inputs.width, g['76_58'].inputs.height], [ew, eh], `${w}x${h}`);
  }
  // Switched off, the old behaviour: the requested size, snapped.
  const off = build('qwen-image', { width: 1024, height: 1024 }, { tuning: { nativeResolution: false } }).graph;
  assert.deepEqual([off['76_58'].inputs.width, off['76_58'].inputs.height], [1024, 1024]);
});

test('Qwen-Image appends the official suffix exactly once', () => {
  const g = build('qwen-image', { prompt: 'A red lantern' }).graph;
  assert.equal(g['76_6'].inputs.text, 'A red lantern, Ultra HD, 4K, cinematic composition.');
  const already = build('qwen-image', { prompt: 'A red lantern, Ultra HD, 4K, cinematic composition.' }).graph;
  assert.equal(already['76_6'].inputs.text, 'A red lantern, Ultra HD, 4K, cinematic composition.');
  const off = build('qwen-image', { prompt: 'A red lantern' }, { tuning: { magicSuffix: false } }).graph;
  assert.equal(off['76_6'].inputs.text, 'A red lantern');
});

test('Qwen-Image quality mode is the full model, not an undercooked Lightning', () => {
  const fast = build('qwen-image').graph;
  assert.equal(fast['76_86'].inputs.value, true);
  assert.equal(fast['76_3'].inputs.steps, 8);
  assert.ok(Array.isArray(fast['76_3'].inputs.cfg), 'Lightning keeps the switch-fed cfg (1)');

  const quality = build('qwen-image', { quality: 'quality' }).graph;
  assert.equal(quality['76_86'].inputs.value, false, 'LoRA switched out');
  assert.equal(quality['76_3'].inputs.steps, 20);
  assert.equal(quality['76_3'].inputs.cfg, 4);
  assert.deepEqual(quality['76_78'].inputs.on_false, ['76_37', 0], 'the switch routes the plain UNET');
});

test('H3 gets the keyframe instruction line its prompting guide requires', () => {
  const t2v = build('minimax-h3', { prompt: 'A cat on a temple roof' }).graph;
  assert.equal(t2v['105_104'].inputs.prompt, 'A cat on a temple roof');

  const i2v = build('minimax-h3', { prompt: 'She smiles', imageFilename: FIRST }).graph;
  assert.equal(
    i2v['105_104'].inputs.prompt,
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nShe smiles'
  );

  const fl2v = build('minimax-h3', { prompt: 'She spins', imageFilename: FIRST, lastImageFilename: LAST, durationSeconds: 5 }).graph;
  const text = String(fl2v['105_104'].inputs.prompt);
  assert.match(text, /^How the reference pictures align with the target video — Picture 1 \(from Shot 1\) aligns with the 0\.00-second mark/);
  assert.match(text, /aligns with the 5\.17-second mark of the target video\.\n\nShe spins$/, '124 frames at 24 fps');
});

test('an H3 instruction line is rebuilt from the frames the order actually has', () => {
  const entry = getCatalogEntry('minimax-h3')!;
  const tuning = resolveTunables(entry.tunables, null);
  const written = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: [Shot 1] A dancer.';
  const base = { width: 1344, height: 768, durationSeconds: 5, fps: 24, seed: 1, tuning };
  assert.equal(h3Prompt({ ...base, prompt: written }), 'integrated_multimodal_description: [Shot 1] A dancer.', 'no picture → no line');
  assert.match(h3Prompt({ ...base, prompt: written, imageFilename: 'a', lastImageFilename: 'b' }), /^How the reference pictures align/);
  // The three-field wrap, when chosen, leaves a structured prompt alone.
  const full = { ...base, tuning: { ...tuning, promptStructure: 'full' } };
  assert.match(h3Prompt({ ...full, prompt: 'A dancer' }), /^integrated_multimodal_description: \[Shot 1\] A dancer\n\noverall_soundscape: .+\n\nnon_diegetic_music: N\/A$/);
  assert.equal(h3Prompt({ ...full, prompt: 'integrated_multimodal_description: [Shot 1] X' }), 'integrated_multimodal_description: [Shot 1] X');
});

test("an admin's node input lands; one that names nothing only warns", () => {
  const r = build('qwen-image', {}, {
    nodeInputs: [
      { nodeId: '76_3', input: 'denoise', value: 0.9 },
      { nodeId: '76_999', input: 'nope', value: 1 },
    ],
  });
  assert.equal(r.graph['76_3'].inputs.denoise, 0.9);
  assert.ok(r.warnings.some((w) => w.includes('76_999.nope')));
});

test('prompt affixes wrap the customer prompt before the model adds its own', () => {
  assert.equal(shapePrompt('a cat', { promptPrefix: 'Photo:', promptSuffix: 'sharp' }), 'Photo: a cat, sharp');
  const g = build('qwen-image', { prompt: 'a cat' }, { promptPrefix: 'Photo:', promptSuffix: 'sharp focus' }).graph;
  assert.equal(g['76_6'].inputs.text, 'Photo: a cat, sharp focus, Ultra HD, 4K, cinematic composition.');
});

test('a custom graph gets typed placeholders', () => {
  const r = build('sdxl-community', { prompt: 'a castle', width: 832, height: 1216, seed: 7 }, {
    customGraph: {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: '{{prompt}}, masterpiece' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: '{{negative_prompt}}' } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
      '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: '{{seed}}', steps: 25, cfg: 6, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
    },
  });
  assert.equal(r.custom, true);
  assert.equal(r.graph['2'].inputs.text, 'a castle, masterpiece');
  assert.equal(r.graph['4'].inputs.width, 832, 'a whole-string placeholder takes the value type');
  assert.equal(r.graph['5'].inputs.seed, 7);
});

test('rollout: an admin-only override renders only admins’ orders; switched off, nobody’s', () => {
  const entry = getCatalogEntry('qwen-image')!;
  const stored = { override: { enabled: true, rollout: 'admin' as const, tuning: { qualitySteps: 30 } }, version: 3, updatedAt: '', updatedBy: null, note: null };
  assert.equal(effectiveWorkflow(entry, stored, false).version, null);
  assert.equal(effectiveWorkflow(entry, stored, false).tuning.qualitySteps, 20);
  assert.equal(effectiveWorkflow(entry, stored, true).tuning.qualitySteps, 30);
  const all = { ...stored, override: { ...stored.override, rollout: 'all' as const } };
  assert.equal(effectiveWorkflow(entry, all, false).tuning.qualitySteps, 30);
  const off = { ...all, override: { ...all.override, enabled: false } };
  assert.equal(effectiveWorkflow(entry, off, true).version, null);
});

test('a quality mode still being tried is invisible and unorderable for customers', () => {
  const entry = getCatalogEntry('qwen-image')!;
  assert.deepEqual(visibleQualityModes(entry, null, false).map((m) => m.id), ['fast']);
  assert.equal(pickQualityMode(entry, null, 'quality', false)?.id, 'fast', 'falls back to the default');
  assert.equal(pickQualityMode(entry, null, 'quality', true)?.id, 'quality');
  const opened = { override: { enabled: true, rollout: 'admin' as const, quality: { quality: { public: true, creditsMultiplier: 2.5 } } }, version: 1, updatedAt: '', updatedBy: null, note: null };
  const picked = pickQualityMode(entry, opened, 'quality', false);
  assert.equal(picked?.id, 'quality');
  assert.equal(picked?.creditsMultiplier, 2.5);
  assert.equal(pickQualityMode(getCatalogEntry('minimax-h3'), null, 'quality', true), null, 'no modes, no mode');
});

test('an override is checked field by field before it is stored', () => {
  const entry = getCatalogEntry('qwen-image')!;
  const ok = sanitizeOverride(entry, { rollout: 'all', tuning: { qualitySteps: 30, fastSteps: 8, magicSuffix: true } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.override.tuning, { qualitySteps: 30 }, 'values equal to the default are not stored');

  assert.ok(sanitizeOverride(entry, { tuning: { qualitySteps: 500 } }).errors.length > 0, 'out of range');
  assert.ok(sanitizeOverride(entry, { quality: { quality: { creditsMultiplier: 50 } } }).errors.length > 0);
  assert.ok(sanitizeOverride(entry, { nodeInputs: [{ nodeId: 'x y', input: 'z', value: 1 }] }).errors.length > 0);
  assert.ok(
    sanitizeOverride(entry, { customGraph: { enabled: true, graph: JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }) } })
      .errors.some((e) => e.includes('{{prompt}}')),
    'a graph that ignores the prompt would give every customer the same picture'
  );
  assert.ok(
    sanitizeOverride(entry, { customGraph: { enabled: true, graph: { nodes: [], links: [] } } }).errors.some((e) => e.includes('API')),
    'a UI-format export is refused with a hint'
  );
});

test('stored tunables are coerced, never trusted', () => {
  const entry = getCatalogEntry('minimax-h3')!;
  const steps = entry.tunables!.find((t) => t.id === 'steps768')!;
  assert.equal(coerceTunable(steps, '6'), 6);
  assert.equal(coerceTunable(steps, 99), null);
  assert.equal(coerceTunable(steps, 'abc'), null);
  const resolved = resolveTunables(entry.tunables, { steps768: 99, sampler: 'not-a-sampler' });
  assert.equal(resolved.steps768, 4, 'an out-of-range value falls back to the default');
  assert.equal(resolved.sampler, 'euler');
});

// ---------------------------------------------------------------------------
// LTX-2.5 — video with its own sound, from text or a first frame
// ---------------------------------------------------------------------------

test('LTX-2.5 without a first frame loads no picture and skips the image nodes', () => {
  const g = build('ltx-2.5', { imageFilename: undefined }).graph;
  const classes = Object.values(g).map((n) => n.class_type);
  for (const gone of ['LoadImage', 'LTXVImgToVideoInplace', 'LTXVPreprocess', 'ResizeImageMaskNode']) {
    assert.ok(!classes.includes(gone), `${gone} reached a text-to-video graph`);
  }
  assert.deepEqual(g['398_377'].inputs.video_latent, ['398_356', 0], 'first pass starts from the empty latent');
  assert.deepEqual(g['398_340'].inputs.video_latent, ['398_348', 0], 'second pass takes the upscaled latent');
});

test('LTX-2.5 with a first frame conditions both passes on it', () => {
  const g = build('ltx-2.5', { imageFilename: FIRST }).graph;
  assert.equal(g['395'].inputs.image, FIRST);
  assert.equal(g['398_363'].inputs.value, false, 'image nodes are not bypassed');
  assert.deepEqual(g['398_377'].inputs.video_latent, ['398_357', 0]);
  assert.deepEqual(g['398_340'].inputs.video_latent, ['398_349', 0]);
  assert.equal(g['398_357'].inputs.strength, 0.7);
});

test("LTX-2.5 gets the customer's prompt directly, never the template's enhancer", () => {
  const g = build('ltx-2.5', { prompt: '  นักร้องหญิงร้องเพลงบนเวที  ', seed: 41 }).graph;
  const classes = Object.values(g).map((n) => n.class_type);
  for (const gone of ['TextGenerateLTX2Prompt', 'ComfySwitchNode', 'PreviewAny', 'ResolutionSelector']) {
    assert.ok(!classes.includes(gone), `${gone} reached the graph`);
  }
  assert.equal(g['398_364'].inputs.text, 'นักร้องหญิงร้องเพลงบนเวที');
  const clips = Object.values(g).filter((n) => n.class_type === 'CLIPLoader');
  assert.equal(clips.length, 1, 'only the Gemma 4 12B encoder is loaded');
  assert.notEqual(g['398_339'].inputs.noise_seed, g['398_338'].inputs.noise_seed, 'two passes, two seeds');
});

test('LTX-2.5 with both frames runs the FLF2V graph: first at frame 0, last at the end', () => {
  const g = build('ltx-2.5', { imageFilename: FIRST, lastImageFilename: LAST, prompt: 'ช็อตต่อเนื่อง', seed: 9 }).graph;
  assert.equal(g['31'].inputs.image, FIRST);
  assert.equal(g['39'].inputs.image, LAST);
  assert.equal(g['251_206'].inputs.frame_idx, 0);
  assert.equal(g['251_204'].inputs.frame_idx, -1);
  assert.deepEqual(g['251_206'].inputs.image, ['251_199', 0], 'frame 0 is guided by the first still');
  assert.deepEqual(g['251_199'].inputs.image, ['251_213', 0]);
  assert.deepEqual(g['251_213'].inputs.input, ['31', 0]);
  assert.deepEqual(g['251_214'].inputs.input, ['39', 0], 'the last frame is guided by the last still');
  assert.equal(g['251_222'].inputs.text, 'ช็อตต่อเนื่อง');
  assert.equal(g['251_196'].inputs.noise_seed, 9);
  const classes = Object.values(g).map((n) => n.class_type);
  for (const gone of ['TextGenerateLTX2Prompt', 'PreviewAny']) assert.ok(!classes.includes(gone), `${gone} reached the graph`);
  assert.equal(classes.filter((c) => c === 'CLIPLoader').length, 1, 'no prompt-enhancer Gemma');
  // One still alone is still the two-pass image-to-video graph.
  assert.ok(build('ltx-2.5', { imageFilename: FIRST }).graph['398_357'], 'first frame only: the i2v template');
});

test('LTX-2.5 renders whole seconds on a 64 px grid in the ordered shape', () => {
  assert.deepEqual(ltxFrame(1920, 1080), { width: 1280, height: 704 });
  assert.deepEqual(ltxFrame(1080, 1920), { width: 704, height: 1280 });
  assert.deepEqual(ltxFrame(1000, 1000), { width: 960, height: 960 });
  assert.deepEqual(ltxFrame(0, 0), { width: 1280, height: 704 }, 'unknown shape → landscape');
  const g = build('ltx-2.5', { width: 1344, height: 768, durationSeconds: 10.4 }).graph;
  assert.equal(g['398_372'].inputs.value, 1280);
  assert.equal(g['398_360'].inputs.value, 704);
  assert.equal(g['398_362'].inputs.value, 10);
});

test('a picture becomes a textured mesh, cut out first and exported after painting', () => {
  const { graph: g } = build('hunyuan3d-2.1', { imageFilename: FIRST, seed: 777 });
  // The customer's picture, through the background remover, into both the
  // shape model and the painter — a backdrop left in comes back as a slab.
  assert.equal(g['14'].inputs.image, FIRST);
  assert.deepEqual(g['60'].inputs.image, ['14', 2], 'the remover reads the picture with its alpha');
  assert.deepEqual(g['37'].inputs.image, ['60', 0]);
  assert.deepEqual(g['20'].inputs.image, ['60', 0]);
  // The export carries the painted mesh, not the white one.
  assert.deepEqual(g['44'].inputs.trimesh, ['49', 2]);
  assert.equal(g['44'].inputs.file_format, 'glb');
  // The pack's seeds have no "randomize" after them: the widget after each
  // seed must still be what it says, not shifted by one.
  assert.equal(g['37'].inputs.attention_mode, 'sdpa');
  assert.equal(g['37'].inputs.seed, 777);
  assert.equal(g['20'].inputs.seed, 777);
  assert.equal(g['20'].inputs.unwrap_mesh, false, 'the mesh is already unwrapped upstream');
  // The defaults are the high-quality ones the owner asked for.
  assert.equal(g['9'].inputs.octree_resolution, 384);
  assert.equal(g['20'].inputs.texture_size, 2048);
  assert.equal(g['43'].inputs.max_facenum, 60000);
});

test('a 3D quality mode changes only what makes it that mode', () => {
  const standard = build('hunyuan3d-2.1', { imageFilename: FIRST, seed: 1, quality: 'standard' }).graph;
  assert.equal(standard['43'].inputs.max_facenum, 60000);
  assert.equal(standard['20'].inputs.view_size, 768, 'the template view size, stated');
  // Game-ready: fewer faces, everything else as standard.
  const game = build('hunyuan3d-2.1', { imageFilename: FIRST, seed: 1, quality: 'game' }).graph;
  assert.equal(game['43'].inputs.max_facenum, 15000);
  assert.equal(game['9'].inputs.octree_resolution, standard['9'].inputs.octree_resolution);
  assert.equal(game['20'].inputs.texture_size, standard['20'].inputs.texture_size);
  // An admin who already set fewer faces is not raised to the game cap.
  const lean = build('hunyuan3d-2.1', { imageFilename: FIRST, seed: 1, quality: 'game' }, { tuning: { faces: 8000 } }).graph;
  assert.equal(lean['43'].inputs.max_facenum, 8000);
  const ultra = build('hunyuan3d-2.1', { imageFilename: FIRST, seed: 1, quality: 'ultra' }).graph;
  assert.equal(ultra['9'].inputs.octree_resolution, 512);
  assert.equal(ultra['43'].inputs.max_facenum, 200000);
  assert.equal(ultra['20'].inputs.texture_size, 4096);
  assert.equal(ultra['20'].inputs.view_size, 1024);
  assert.equal(ultra['37'].inputs.steps, 50);
  const modes = getCatalogEntry('hunyuan3d-2.1')!.qualityModes!;
  assert.equal(modes.find((m) => m.isDefault)?.id, 'standard');
  assert.equal(modes.find((m) => m.id === 'ultra')?.adminOnly, true, 'ultra is tried by admins first');
});

test('the 3D entry boots a devel image and builds its texture extensions', () => {
  const entry = getCatalogEntry('hunyuan3d-2.1');
  assert.ok(entry);
  assert.equal(entry.outputKind, 'model3d');
  assert.equal(entry.runtime?.tag, '2.13.0-cuda13.0-cudnn9-devel', 'the runtime image has no nvcc');
  const script = entry.runtime?.setupScript ?? '';
  for (const ext of ['custom_rasterizer', 'DifferentiableRenderer']) assert.ok(script.includes(ext), `builds ${ext}`);
  assert.match(script, /aixman_rembg\.py <<'AIXMAN_PY'\n[\s\S]*class AixmanRemoveBackground[\s\S]*\nAIXMAN_PY\n/, 'writes the remover node');
  assert.ok(!/TORCH_CUDA_ARCH_LIST/.test(script), 'builds for the card in the machine only');
  assert.match(script, /pip_install "[^"]*" "transformers>=4\.50\.3,<5" "diffusers>=0\.30,<0\.35"/, "5.x renamed DINOv2's layers; diffusers 0.35+ refuses the paint unet's code and 0.40+ needs a huggingface_hub transformers 4.x refuses");
  // Every pack class the template uses is in the schema the tests and the admin dry run read.
  const used = new Set((entry.template as { nodes: { type: string }[] }).nodes.map((n) => n.type));
  for (const cls of used) assert.ok(cls in hunyuan3dPack.classes || cls in baseline.classes, `${cls} has a schema`);
});

test("an upload is looked for in every loader the template uses, not only LoadImage's list", async () => {
  const { imageLoaderClasses } = await import('@/lib/gpu/worker-client');
  const s = schema() as never;
  const hy3d = imageLoaderClasses(getCatalogEntry('hunyuan3d-2.1')!, s);
  assert.ok(hy3d.includes('Hy3D21LoadImageWithTransparency'), 'the pack loader is refreshed after the upload');
  assert.ok(hy3d.includes('LoadImage'));
  // A core-only template still refreshes exactly LoadImage.
  assert.deepEqual(imageLoaderClasses(getCatalogEntry('qwen-image')!, s), ['LoadImage']);
});

// ---------------------------------------------------------------------------
// LatentSync 1.6 — a clip re-dubbed with the customer's voice
// ---------------------------------------------------------------------------

const CLIP = 'aixman-clip-test.mp4';

test('a clip is re-dubbed with the uploaded voice: one length drives the trim, the clip read and the frames', () => {
  const g = build('latentsync-1.6', { audioFilename: AUDIO, videoFilename: CLIP, durationSeconds: 7.36, seed: 4_294_967_295 }).graph;
  assert.equal(g['1'].inputs.audio, AUDIO);
  assert.equal(g['3'].inputs.video, CLIP);
  // The voice is trimmed to the priced length, and only that much clip is read.
  assert.equal(g['2'].inputs.duration, 7.36);
  assert.equal(g['3'].inputs.max_seconds, 7.36);
  assert.deepEqual(g['4'].inputs.images, ['3', 0]);
  assert.deepEqual(g['4'].inputs.audio, ['2', 0]);
  // The file carries the trimmed recording, not the node's 16 kHz copy.
  assert.deepEqual(g['5'].inputs.images, ['4', 0]);
  assert.deepEqual(g['5'].inputs.audio, ['2', 0]);
  assert.equal(g['5'].inputs.fps, 25);
  assert.equal(g['6'].inputs.filename_prefix, 'video/aixman');
  // numpy refuses a seed past 32 bits.
  assert.ok(Number(g['4'].inputs.seed) < 2 ** 31);
  // The node's own defaults, stated.
  assert.equal(g['4'].inputs.lips_expression, 1.5);
  assert.equal(g['4'].inputs.inference_steps, 20);
  assert.equal(g['3'].inputs.max_side, 1280);
  assert.ok(!Object.values(g).some((n) => n.class_type === 'MarkdownNote'));
});

test('the re-dub entry asks for a clip and a voice, and is a lip-sync row with no portrait', async () => {
  const entry = getCatalogEntry('latentsync-1.6')!;
  assert.deepEqual(entry.needs, { audio: true, video: true });
  assert.deepEqual(entry.pools, ['rented'], 'an uploaded clip never goes to a home PC');
  const { catalogSubcategory } = await import('@/lib/gpu/model-sync');
  assert.equal(catalogSubcategory(entry), 'lipsync', 'the studio asks for a clip, not a still');
  // 25 fps grid; priced by the voice on a gentler curve than the portrait.
  const { voiceRenderSeconds } = await import('@/lib/voice-length');
  const { creditsForDuration } = await import('@/lib/pricing');
  const v = voiceRenderSeconds(7.379, entry.lengthFromAudio!, entry.limits?.maxDuration);
  assert.ok(v.ok && Math.abs(v.seconds - 7.36) < 1e-6);
  const price = (s: number) => creditsForDuration(entry.pricing.creditsPerUnit, entry.pricing.durationCurve, s);
  assert.deepEqual([price(3), price(5), price(10), price(20)], [10, 10, 23, 53]);
  assert.equal(voiceRenderSeconds(25, entry.lengthFromAudio!, entry.limits?.maxDuration).ok, false, 'past 20 s is refused');
});

test('the re-dub worker finds faces without InsightFace and skips the pack’s requirements', async () => {
  const entry = getCatalogEntry('latentsync-1.6')!;
  const script = entry.runtime?.setupScript ?? '';
  // The detector written over the pack's: face-alignment, filling the three
  // points ImageProcessor reads from the 68 it gives.
  const detector = script.match(/face_detector\.py" <<'AIXMAN_PY'\n([\s\S]*?)\nAIXMAN_PY\n/)?.[1] ?? '';
  assert.match(detector, /^import face_alignment$/m);
  assert.ok(!/insightface/i.test(detector.replace(/^#.*$/gm, '')), 'no InsightFace import');
  assert.match(detector, /lmk\[_LEFT_BROW\] = points\[17:22\]/);
  assert.match(detector, /lmk\[_RIGHT_BROW\] = points\[22:27\]/);
  assert.match(detector, /lmk\[_NOSE\] = points\[27:36\]/);
  assert.match(detector, /_LEFT_BROW = \[43, 48, 49, 51, 50\]/, 'the indices image_processor.py reads');
  // The loader node, and the weights where each library looks for them.
  assert.match(script, /aixman_load_video\.py <<'AIXMAN_PY'\n[\s\S]*class AixmanLoadVideo25[\s\S]*\nAIXMAN_PY/);
  assert.match(script, /ln -sfn "\$LS_MODELS" "\$LS_DIR\/checkpoints"/);
  assert.match(script, /\.latentsync16_dependencies_installed/);
  assert.match(script, /hash_prefix="11f355bf0693120222f5955ce3f9dc8fb5763ebb30a47d7906e509490d32e4aa"/, "the landmark model is checked against its whole SHA-256 before it is used");
  assert.match(script, /"face-alignment" --no-deps "face-alignment==1\.5\.0"/);
  assert.match(script, /"diffusers==0\.32\.2" "DeepCache==0\.1\.1"/);
  assert.ok(!/\$HOME/.test(script), 'HOME may be unset under set -u');

  const { buildComfyUiStartScript } = await import('@/lib/gpu/provision');
  const boot = buildComfyUiStartScript({
    publicPort: 8189,
    extraScript: script,
    downloads: entry.downloads,
    customNodes: entry.customNodes,
  });
  assert.match(boot, /install_custom_node 'https:\/\/github\.com\/vinavfx\/ComfyUI-LatentSyncWrapper' '4902c39[0-9a-f]+' no-requirements/);
  // Another pack still installs its requirements.
  const hy3d = getCatalogEntry('hunyuan3d-2.1')!;
  assert.doesNotMatch(buildComfyUiStartScript({ publicPort: 8189, customNodes: hy3d.customNodes }), /no-requirements'?$/m);
  for (const f of ['latentsync/latentsync_unet.pt', 'latentsync/whisper/tiny.pt', 'latentsync/vae/config.json', 'latentsync/face/s3fd-619a316812.pth']) {
    assert.ok(boot.includes(`'${f}'`), `${f} is checked before the machine says ready`);
  }

  // A heredoc left open or a quote unbalanced would end every boot: let bash read it.
  const { spawnSync } = await import('node:child_process');
  const bash = spawnSync('bash', ['-n'], { input: boot, encoding: 'utf8' });
  if (bash.error) return; // no bash here; CI has one
  assert.equal(bash.status, 0, bash.stderr);

  // Every class the template uses has a schema for the tests and the admin dry run.
  const used = new Set((entry.template as { nodes: { type: string }[] }).nodes.map((n) => n.type));
  for (const cls of used) {
    if (cls === 'MarkdownNote') continue;
    assert.ok(cls in latentsyncPack.classes || cls in baseline.classes, `${cls} has a schema`);
  }
});

test('a render that failed on the customer’s clip is not retried and says why', async () => {
  const { isCustomerInputFault } = await import('@/lib/gpu/input-fault');
  assert.ok(isCustomerInputFault('LatentSyncNode: RuntimeError: Face not detected'));
  assert.ok(isCustomerInputFault('AIXMAN_INPUT: the clip could not be decoded (moov atom not found)'));
  assert.ok(!isCustomerInputFault('CUDA out of memory. Tried to allocate 2.00 GiB'));
  assert.ok(!isCustomerInputFault('Render exceeded 30 min'));
});
