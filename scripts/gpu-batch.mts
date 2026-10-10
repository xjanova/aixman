/**
 * Runs a batch of GPU-catalogue jobs as an admin: studio asset production (the
 * HIVE // BREACH models, a set of reference images) rather than customers'
 * orders. Every job is an ordinary generation, so it rents, renders, stores to
 * R2 and settles exactly like an order from the studio; this only saves an
 * admin from submitting ninety of them by hand.
 *
 * On the server, from the app directory:
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning \
 *     --import ./scripts/alias-loader.mjs scripts/gpu-batch.mts submit <manifest.json>
 *   … status <manifest.json>
 *   … fetch  <manifest.json> <out-dir>
 *
 * Manifest:
 *   { "userId": 1,
 *     "jobs": [ { "id": "lyra", "model": "hunyuan3d-2.1", "prompt": "LYRA",
 *                 "image": "inputs/lyra.png", "seed": 7 },
 *               { "id": "skitter-ref", "model": "qwen-image", "prompt": "…",
 *                 "width": 1328, "height": 1328 } ] }
 *
 * `image` is a path relative to the manifest. It is uploaded to R2 first,
 * because an R2 URL is what a rented worker is allowed to read
 * (frame-input.ts). `type` defaults to "image". Generation ids are kept in
 * `<manifest>.state.json`; `submit` skips jobs already there, so a rerun only
 * sends what is missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';

import prisma from '@/lib/db';
import { GenerationService } from '@/lib/services/generation';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { uploadBuffer } from '@/lib/storage/r2';

interface BatchJob {
  id: string;
  model: string;
  prompt: string;
  /** Defaults to 'model3d' for a 3D model and 'image' for everything else. */
  type?: 'image' | 'video' | 'edit' | 'audio' | 'model3d';
  /** Quality mode id, for models that have them (hunyuan3d-2.1: standard | game | ultra). */
  quality?: string;
  image?: string;
  seed?: number;
  width?: number;
  height?: number;
}

interface Manifest {
  userId: number;
  jobs: BatchJob[];
}

type State = Record<string, { generationId: number; submittedAt: string }>;

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function load(path: string): { manifest: Manifest; statePath: string; state: State } {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  if (!Number.isInteger(manifest.userId) || !Array.isArray(manifest.jobs)) throw new Error('manifest needs userId and jobs[]');
  const ids = new Set<string>();
  for (const job of manifest.jobs) {
    if (!job.id || !job.model || typeof job.prompt !== 'string') throw new Error(`job ${JSON.stringify(job)} needs id, model, prompt`);
    if (ids.has(job.id)) throw new Error(`duplicate job id ${job.id}`);
    ids.add(job.id);
  }
  const statePath = path.replace(/\.json$/, '') + '.state.json';
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : {};
  return { manifest, statePath, state };
}

async function submit(path: string): Promise<void> {
  const { manifest, statePath, state } = load(path);
  const user = await prisma.user.findUnique({ where: { id: manifest.userId }, select: { id: true, role: true } });
  if (!user || !['admin', 'super_admin'].includes(String(user.role))) throw new Error(`user ${manifest.userId} is not an admin`);
  const models = new Map<string, number>();
  for (const key of new Set(manifest.jobs.map((j) => j.model))) {
    const row = await prisma.aiModel.findFirst({ where: { modelId: key }, select: { id: true } });
    if (!row) throw new Error(`no ai_models row for ${key} — run "sync models" in /admin/gpu first`);
    models.set(key, row.id);
  }

  const batch = basename(path).replace(/\.json$/, '');
  let sent = 0;
  for (const job of manifest.jobs) {
    if (state[job.id]) continue;
    let inputImage: string | undefined;
    if (job.image) {
      const file = resolve(dirname(path), job.image);
      const contentType = IMAGE_TYPES[extname(file).toLowerCase()];
      if (!contentType) throw new Error(`${job.id}: ${job.image} is not a png/jpg/webp`);
      const key = `batch/${batch}/${job.id}-${randomBytes(4).toString('hex')}${extname(file).toLowerCase()}`;
      inputImage = await uploadBuffer(readFileSync(file), key, contentType);
    }
    const result = await GenerationService.generate(
      manifest.userId,
      {
        modelId: models.get(job.model)!,
        type: job.type ?? (getCatalogEntry(job.model)?.outputKind === 'model3d' ? 'model3d' : 'image'),
        prompt: job.prompt,
        inputImage,
        params: {
          ...(job.seed !== undefined ? { seed: job.seed } : {}),
          ...(job.quality ? { quality: job.quality } : {}),
          ...(job.width ? { width: job.width } : {}),
          ...(job.height ? { height: job.height } : {}),
        },
      },
      { isAdmin: true }
    );
    state[job.id] = { generationId: result.id, submittedAt: new Date().toISOString() };
    // Written after every job, so a crash halfway does not resubmit (and pay
    // for) the ones already sent.
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    sent++;
    console.log(`submitted ${job.id} → generation #${result.id}`);
  }
  console.log(`${sent} submitted, ${Object.keys(state).length}/${manifest.jobs.length} in the batch`);
}

async function rows(path: string) {
  const { manifest, state } = load(path);
  const ids = Object.values(state).map((s) => s.generationId);
  const gens = await prisma.aiGeneration.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, resultUrl: true, errorMessage: true },
  });
  const byId = new Map(gens.map((g) => [g.id, g]));
  return manifest.jobs.map((job) => ({ job, gen: state[job.id] ? byId.get(state[job.id].generationId) : undefined }));
}

async function status(path: string): Promise<void> {
  const counts: Record<string, number> = {};
  for (const { job, gen } of await rows(path)) {
    const s = gen?.status ?? 'not-submitted';
    counts[s] = (counts[s] ?? 0) + 1;
    const note = gen?.errorMessage ? ` — ${gen.errorMessage.slice(0, 160)}` : '';
    console.log(`${s.padEnd(13)} ${job.id}${gen ? ` (#${gen.id})` : ''}${note}`);
  }
  console.log(JSON.stringify(counts));
}

async function fetchAll(path: string, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  let got = 0;
  for (const { job, gen } of await rows(path)) {
    if (gen?.status !== 'completed' || !gen.resultUrl) continue;
    const ext = extname(new URL(gen.resultUrl).pathname) || '.bin';
    const target = join(outDir, `${job.id}${ext}`);
    if (existsSync(target)) continue;
    const res = await fetch(gen.resultUrl);
    if (!res.ok) {
      console.log(`skip ${job.id}: HTTP ${res.status}`);
      continue;
    }
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    got++;
    console.log(`saved ${target}`);
  }
  console.log(`${got} new file(s) in ${outDir}`);
}

const [command, manifestPath, outDir] = process.argv.slice(2);
try {
  if (command === 'submit' && manifestPath) await submit(resolve(manifestPath));
  else if (command === 'status' && manifestPath) await status(resolve(manifestPath));
  else if (command === 'fetch' && manifestPath && outDir) await fetchAll(resolve(manifestPath), resolve(outDir));
  else {
    console.error('usage: gpu-batch.mts submit|status <manifest.json>  |  fetch <manifest.json> <out-dir>');
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
