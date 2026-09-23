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

const { MODEL_CATALOG, getCatalogEntry, nearestBucket, h3Prompt } = await import('@/lib/gpu/catalog');
const { validateGraph } = await import('@/lib/gpu/comfy-validate');
const { alternativeTunables, coerceTunable, resolveTunables } = await import('@/lib/gpu/tunables');
const { buildJobGraph, sampleJob, shapePrompt } = await import('@/lib/gpu/workflow-build');
const { effectiveWorkflow, pickQualityMode, sanitizeOverride, visibleQualityModes } = await import('@/lib/gpu/workflow-overrides');
const baseline = (await import('@/lib/gpu/workflows/schema/baseline-v0.36.0.json')).default as { classes: Record<string, unknown> };

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
type Schema = Parameters<typeof validateGraph>[1];

const FIRST = 'aixman-first-test.png';
const LAST = 'aixman-last-test.png';
const AUDIO = 'aixman-source-test.mp3';

/** The baseline with the test's stand-in uploads present in the input dir. */
function schema(): Schema {
  const s = JSON.parse(JSON.stringify(baseline.classes)) as Record<string, { input?: { required?: Record<string, unknown[]> } }>;
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
  add('LoadImage', 'image', [FIRST, LAST]);
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
