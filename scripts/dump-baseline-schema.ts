/**
 * Regenerate `src/lib/gpu/workflows/schema/baseline-v<ref>.json` — the node
 * schema /admin/workflows dry-runs graphs against before any worker has run.
 *
 * Run it against the same CPU-only ComfyUI that `validate-graphs.ts` uses
 * (weights as zero-byte stubs, so loader lists are exactly the catalogue's):
 *
 *   npx tsx scripts/validate-graphs.ts --stubs <comfy-dir>
 *   <comfy-dir>/.venv/Scripts/python main.py --cpu --port 8199
 *   npx tsx scripts/dump-baseline-schema.ts
 *
 * Whenever `COMFYUI_REF` moves, regenerate it (and point workflow-admin.ts at
 * the new file): a dry run against an old schema would pass graphs the new
 * ComfyUI rejects. A live worker's schema, once one has run, is laid over this
 * file anyway — this is only the floor.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { MODEL_CATALOG } from '../src/lib/gpu/catalog';
import type { ComfyObjectInfo } from '../src/lib/gpu/comfy-validate';
import { COMFYUI_REF } from '../src/lib/gpu/provision';
import { sampleJob, schemaSubset, templateClasses } from '../src/lib/gpu/workflow-build';

const HOST = process.env.COMFY_URL ?? 'http://127.0.0.1:8199';

/** Building blocks an admin is likely to reach for in a custom graph. */
const EXTRAS = [
  'LoadImage', 'LoadAudio', 'ImageScale', 'ImageScaleBy', 'UpscaleModelLoader', 'ImageUpscaleWithModel',
  'SaveImage', 'PreviewImage', 'VAEEncode', 'VAEDecode', 'VAELoader', 'LatentUpscaleBy', 'LatentUpscale',
  'KSampler', 'KSamplerAdvanced', 'CLIPTextEncode', 'CLIPSetLastLayer', 'CheckpointLoaderSimple', 'LoraLoader',
  'LoraLoaderModelOnly', 'UNETLoader', 'CLIPLoader', 'DualCLIPLoader', 'EmptyLatentImage', 'EmptySD3LatentImage',
  'ModelSamplingAuraFlow', 'ConditioningZeroOut', 'SaveVideo', 'CreateVideo', 'SaveAudio', 'SaveAudioMP3',
  'SaveAudioAdvanced', 'ImageBlend', 'ImageSharpen', 'FreeU_V2', 'RandomNoise', 'BasicGuider', 'CFGGuider',
  'BasicScheduler', 'KSamplerSelect', 'SamplerCustomAdvanced',
];

async function main(): Promise<void> {
  const res = await fetch(`${HOST}/object_info`);
  if (!res.ok) throw new Error(`ComfyUI at ${HOST} answered ${res.status}`);
  const info = (await res.json()) as ComfyObjectInfo;

  const classes = new Set<string>(EXTRAS);
  for (const entry of MODEL_CATALOG) {
    for (const cls of templateClasses(entry, sampleJob(entry))) classes.add(cls);
    // Nodes only some orders inject (first/last frame, a resize preset).
    if (entry.inject) {
      const variant = sampleJob(entry, { imageFilename: 'a.png', lastImageFilename: 'b.png', resolution: '720p' });
      for (const node of Object.values(entry.inject(variant))) classes.add(node.class_type);
    }
  }
  const missing = [...classes].filter((c) => !info[c]);
  if (missing.length > 0) throw new Error(`ComfyUI has no ${missing.join(', ')} — wrong version, or a pack is missing`);

  const subset = schemaSubset(info, classes);
  // Input-dir listings are whatever this machine happened to hold, not a fact
  // about any worker: the dry run adds its own stand-in upload names.
  for (const cls of ['LoadImage', 'LoadAudio']) {
    const required = subset[cls]?.input?.required as Record<string, unknown[]> | undefined;
    for (const [name, def] of Object.entries(required ?? {})) {
      if (Array.isArray(def) && Array.isArray(def[0])) required![name] = [[], ...def.slice(1)];
      else if (Array.isArray(def) && def[0] === 'COMBO') required![name] = ['COMBO', { ...(def[1] as object), options: [] }];
    }
  }

  const version = COMFYUI_REF.replace(/^v/, '');
  const out = {
    comfyVersion: version,
    capturedAt: new Date().toISOString(),
    note: `CPU ComfyUI ${COMFYUI_REF} with the catalogue weights as zero-byte stubs — loader file lists are exactly the catalogue downloads.`,
    classes: subset,
  };
  mkdirSync('src/lib/gpu/workflows/schema', { recursive: true });
  const path = `src/lib/gpu/workflows/schema/baseline-v${version}.json`;
  writeFileSync(path, JSON.stringify(out));
  console.log(`${path}: ${Object.keys(subset).length} classes, ${JSON.stringify(out).length} bytes`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
