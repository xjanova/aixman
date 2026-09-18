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
 */
import { mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { MODEL_CATALOG, type CatalogEntry, type CatalogJobParams } from '../src/lib/gpu/catalog';
import {
  bindParameters,
  convertUiWorkflowToApi,
  describeUnmatched,
  injectNodes,
  pruneByClass,
  pruneUnreachable,
} from '../src/lib/gpu/comfy-convert';
import { validateGraph, type ComfyGraph, type ComfyObjectInfo } from '../src/lib/gpu/comfy-validate';

const HOST = process.env.COMFY_URL ?? 'http://127.0.0.1:8199';
/** Stands in for a customer upload; the stub writer puts a file of this name in `input/`. */
const AUDIO_STUB = 'aixman-validate.flac';

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
    imageFilename: entry.video?.firstFrame ? 'example.png' : undefined,
  };
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

  const infoRes = await fetch(`${HOST}/object_info`);
  if (!infoRes.ok) throw new Error(`ComfyUI at ${HOST} answered ${infoRes.status} for /object_info`);
  const objectInfo = (await infoRes.json()) as ComfyObjectInfo;
  console.log(`node classes: ${Object.keys(objectInfo).length}\n`);

  let failures = 0;
  for (const entry of MODEL_CATALOG) {
    if (dumpKey && entry.key !== dumpKey) continue;
    const params = jobParams(entry);
    process.stdout.write(`${entry.key.padEnd(16)} `);
    let graph: ComfyGraph;
    try {
      let g = convertUiWorkflowToApi(entry.template, objectInfo);
      if (entry.inject) g = injectNodes(g, entry.inject(params));
      const bound = bindParameters(g, entry.bind(params), objectInfo);
      if (bound.unmatched.length > 0) {
        throw new Error(`unmatched bindings: ${describeUnmatched(bound.unmatched)}`);
      }
      g = bound.graph;
      if (entry.prune?.length) g = pruneByClass(g, entry.prune);
      graph = validateGraph(pruneUnreachable(g, objectInfo) as ComfyGraph, objectInfo).graph;
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
          .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v.slice(0, 60)) : JSON.stringify(v)}`)
          .join(' ');
        console.log(`  [${id}] ${n.class_type}\n      ${inputs}`);
      }
      continue;
    }

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

  console.log(failures === 0 ? '\nall graphs accepted' : `\n${failures} graph(s) rejected`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
