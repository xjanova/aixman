/**
 * Submit every catalogue graph to a real ComfyUI's own `/prompt` validator.
 *
 * This is the check CLAUDE.md requires before `COMFYUI_REF` moves or a model is
 * added: templates are converted against node signatures, and those change
 * between releases in ways nothing else here would notice. It needs no GPU and
 * no weights — a CPU-only ComfyUI with **zero-byte files** standing in for the
 * checkpoints is enough, because the loaders only need the names to appear in
 * their combo lists.
 *
 *   git clone --depth 1 --branch <COMFYUI_REF> https://github.com/Comfy-Org/ComfyUI
 *   python -m venv .venv && .venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
 *   .venv/Scripts/pip install -r requirements.txt
 *   npx tsx scripts/validate-graphs.ts --stubs <comfy-dir>     # write the stub files
 *   .venv/Scripts/python main.py --cpu --port 8199
 *   npx tsx scripts/validate-graphs.ts
 *
 * PASS means ComfyUI accepted the graph: every class exists, every input name
 * and type matches, and every combo value is one it offers. Execution then
 * fails at `SafetensorError: header too small` on the stub weights, which is
 * the expected end — the graph is what is under test, not the model.
 *
 * Each entry is submitted in every shape an order can take: its default, each
 * quality mode, every admin tunable moved off its default at once (so a knob
 * that writes a bad value is caught before an admin turns it), and — for a
 * model that takes them — text-only, first-and-last-frame, portrait and each
 * resolution preset. Graphs are built by `buildJobGraph`, the same function the
 * workers and the /admin/workflows dry run use.
 *
 *   --dump <key>        print the bound graph of that entry's default order
 *   --dump <key> --all  …of every variant
 */
import { mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { MODEL_CATALOG, type CatalogEntry, type CatalogJobParams } from '../src/lib/gpu/catalog';
import { validateGraph, type ComfyGraph, type ComfyObjectInfo } from '../src/lib/gpu/comfy-validate';
import { alternativeTunables, resolveTunables, type TunableValue } from '../src/lib/gpu/tunables';
import { buildJobGraph } from '../src/lib/gpu/workflow-build';
// Type only: the module itself imports Prisma, which a script without a
// database must not load.
import type { EffectiveWorkflow } from '../src/lib/gpu/workflow-overrides';

const HOST = process.env.COMFY_URL ?? 'http://127.0.0.1:8199';
/** Stands in for a customer upload; the stub writer puts a file of this name in `input/`. */
const AUDIO_STUB = 'aixman-validate.flac';
/** Ships in ComfyUI's own input dir. */
const IMAGE_STUB = 'example.png';

function jobParams(entry: CatalogEntry): CatalogJobParams {
  return {
    prompt: 'validation prompt',
    negativePrompt: '',
    width: 1024,
    height: 1024,
    durationSeconds: entry.kind === 'audio' ? 60 : 5,
    fps: 24,
    seed: 12345,
    lyrics: '[Verse]\nvalidation lyrics',
    audioFilename: entry.needs?.audio ? AUDIO_STUB : undefined,
    imageFilename: entry.video?.firstFrame ? IMAGE_STUB : undefined,
    quality: entry.qualityModes?.find((m) => m.isDefault)?.id,
    // A full set of song controls, so the run covers the composed `[Tags]`
    // path and the two that are real node inputs: `complexity` picks YuE2's
    // `mode` (a combo — ComfyUI rejects a value outside its options) and
    // `variance` is its `temperature` (a float with a range). Leaving these
    // unset let a binding that names a wrong input pass validation unnoticed.
    music: entry.music?.controls
      ? {
          vocal: 'duet',
          age: 'young',
          timbre: 'warm',
          genre: 'luktung',
          language: 'th',
          moods: ['nostalgic', 'hopeful'],
          instruments: ['phin', 'khaen', 'drums'],
          bpm: 96,
          complexity: 5,
          variance: 1.25,
        }
      : undefined,
  };
}

interface Variant {
  label: string;
  params: CatalogJobParams;
  tuning: Record<string, TunableValue>;
}

/** Every shape of order worth submitting for one entry. */
function variants(entry: CatalogEntry): Variant[] {
  const base = jobParams(entry);
  const defaults = resolveTunables(entry.tunables, null);
  const out: Variant[] = [{ label: 'default', params: base, tuning: defaults }];
  for (const mode of entry.qualityModes ?? []) {
    if (!mode.isDefault) out.push({ label: `quality=${mode.id}`, params: { ...base, quality: mode.id }, tuning: defaults });
  }
  if (entry.tunables?.length) {
    out.push({ label: 'tunables moved', params: base, tuning: alternativeTunables(entry.tunables) });
  }
  if (entry.video?.firstFrame) {
    out.push({ label: 'text only', params: { ...base, imageFilename: undefined }, tuning: defaults });
    if (entry.video.lastFrame) {
      out.push({ label: 'first+last frame', params: { ...base, lastImageFilename: IMAGE_STUB }, tuning: defaults });
    }
    out.push({ label: 'portrait 9:16', params: { ...base, width: 768, height: 1344 }, tuning: defaults });
  }
  for (const r of entry.video?.resolutions ?? []) {
    if (!r.isDefault) {
      out.push({ label: `resolution=${r.id}`, params: { ...base, width: 1344, height: 768, resolution: r.id }, tuning: defaults });
    }
  }
  return out;
}

function workflowOf(tuning: Record<string, TunableValue>): EffectiveWorkflow {
  return { tuning, nodeInputs: [], promptPrefix: '', promptSuffix: '', customGraph: null, version: null };
}

/**
 * Write a zero-byte file for every weight the catalogue names, plus the audio
 * stub. Model loaders list the directory to build their combo, so an empty file
 * is indistinguishable from a real one until something tries to read it.
 */
function writeStubs(comfyDir: string): void {
  const files: string[] = [];
  for (const entry of MODEL_CATALOG) {
    for (const d of entry.downloads) {
      const dir = join(comfyDir, 'models', d.dest);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, d.as ?? basename(d.file));
      writeFileSync(path, '');
      files.push(path);
    }
  }
  const inputDir = join(comfyDir, 'input');
  mkdirSync(inputDir, { recursive: true });
  writeFileSync(join(inputDir, AUDIO_STUB), '');
  files.push(join(inputDir, AUDIO_STUB));
  console.log(`wrote ${files.length} stub files under ${comfyDir}`);
}

async function main(): Promise<void> {
  const stubDir = process.argv.includes('--stubs') ? process.argv[process.argv.indexOf('--stubs') + 1] : null;
  if (stubDir) {
    writeStubs(stubDir);
    return;
  }
  // `--dump <key>` prints the bound graph. Passing the validator is not the
  // same as being right: Qwen-Image's Lightning switch and ACE-Step's duration
  // were both valid and wrong, and only reading the values caught them.
  const dumpKey = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
  const dumpAll = process.argv.includes('--all');

  const infoRes = await fetch(`${HOST}/object_info`);
  if (!infoRes.ok) throw new Error(`ComfyUI at ${HOST} answered ${infoRes.status} for /object_info`);
  const objectInfo = (await infoRes.json()) as ComfyObjectInfo;
  console.log(`node classes: ${Object.keys(objectInfo).length}\n`);

  let failures = 0;
  let submitted = 0;
  for (const entry of MODEL_CATALOG) {
    if (dumpKey && entry.key !== dumpKey) continue;
    for (const v of variants(entry)) {
      if (dumpKey && v.label !== 'default' && !dumpAll) continue;
      process.stdout.write(`${entry.key.padEnd(16)} ${v.label.padEnd(22)} `);
      let graph: ComfyGraph;
      try {
        const job: Omit<CatalogJobParams, 'tuning'> = { ...v.params };
        delete (job as Partial<CatalogJobParams>).tuning;
        const built = buildJobGraph(entry, objectInfo, job, workflowOf(v.tuning), {
          first: v.params.imageFilename,
          last: v.params.lastImageFilename,
          audio: v.params.audioFilename,
        });
        graph = validateGraph(built.graph, objectInfo).graph;
      } catch (error) {
        failures += 1;
        console.log(`FAIL (build) — ${(error as Error).message}`);
        continue;
      }

      if (dumpKey) {
        console.log('');
        for (const [id, node] of Object.entries(graph)) {
          const n = node as { class_type: string; inputs: Record<string, unknown> };
          const inputs = Object.entries(n.inputs)
            .map(([k, val]) => `${k}=${typeof val === 'string' ? JSON.stringify(val.slice(0, 60)) : JSON.stringify(val)}`)
            .join(' ');
          console.log(`  [${id}] ${n.class_type}\n      ${inputs}`);
        }
        continue;
      }

      submitted += 1;
      const res = await fetch(`${HOST}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: 'aixman-validate' }),
      });
      const text = await res.text();
      if (res.ok) {
        console.log(`PASS (${Object.keys(graph).length} nodes)`);
      } else {
        failures += 1;
        console.log(`FAIL (/prompt ${res.status})\n${text.slice(0, 1200)}\n`);
      }
    }
  }

  if (!dumpKey) console.log(`\n${submitted} graphs submitted`);
  console.log(failures === 0 ? 'all graphs accepted' : `${failures} graph(s) rejected`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
