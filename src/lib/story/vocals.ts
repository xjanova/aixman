import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import prisma from '@/lib/db';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { creditsForDuration } from '@/lib/pricing';
import { GenerationService } from '@/lib/services/generation';
import { generationErrorResponse } from '@/lib/services/generation-errors';
import { ModelReadiness } from '@/lib/services/model-readiness';
import { uploadBuffer } from '@/lib/storage/r2';
import { voiceRenderSeconds } from '@/lib/voice-length';
import { StoryJobError, download, enqueueJob, runFfmpeg, runNiced } from './media';
import { LIPSYNC_MODEL_KEY, SILENT_MEAN_DB, meanVolumeDb, vocalsState, voiceWindow } from './sing';
import { StoryError, customerMessage, type StoryProjectFull } from './service';

/**
 * MV lip-sync, server side: the song's lead vocal (separated here or
 * uploaded), and the LatentSync orders made from slices of it. Pure rules in
 * sing.ts.
 *
 * Separation is Demucs htdemucs (MIT) on this host's CPU, in its own venv
 * (`DEMUCS_PYTHON`, else ~/venvs/demucs/bin/python: torch 2.5.1+cpu,
 * torchaudio 2.5.1, demucs 4.0.1, soundfile). A 4-minute song takes ~2.5 min
 * on 8 threads and ~1.9 GB of memory; it is queued with the cut (media.ts) and
 * niced below it. Free to the customer, once per song.
 */

const SEPARATE_STALE_MS = 40 * 60_000;
const SEPARATE_TIMEOUT_MS = 30 * 60_000;
const SONG_MAX_BYTES = 80 * 1024 * 1024;
const VOCALS_MAX_BYTES = 120 * 1024 * 1024;
/** Matches LIMITS.maxSongSeconds; ffmpeg cuts anything longer before Demucs sees it. */
const MAX_SECONDS = 360;

/**
 * Runs with `python -I` (no script directory or user site on the path): the
 * directory also holds the downloaded song. Reads 44.1 kHz stereo PCM that
 * ffmpeg made, with soundfile — torchaudio's backends and ffmpeg's PATH stay
 * out of it.
 */
const SEPARATE_PY = String.raw`import sys, time
import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

src, dest, threads = sys.argv[1], sys.argv[2], int(sys.argv[3])
torch.set_num_threads(max(1, threads))
started = time.time()
model = get_model("htdemucs")
model.eval()
audio, rate = sf.read(src, dtype="float32", always_2d=True)
if rate != model.samplerate or audio.shape[1] != model.audio_channels:
    raise SystemExit(f"expected {model.samplerate} Hz x{model.audio_channels}, got {rate} Hz x{audio.shape[1]}")
wav = torch.from_numpy(np.ascontiguousarray(audio.T))
ref = wav.mean(0)
mean, std = ref.mean(), ref.std() + 1e-8
with torch.no_grad():
    sources = apply_model(model, ((wav - mean) / std)[None], shifts=1, split=True, overlap=0.25, progress=False, device="cpu")[0]
vocals = sources[model.sources.index("vocals")] * std + mean
sf.write(dest, vocals.clamp(-1, 1).numpy().T, rate, subtype="PCM_16")
print(f"ok {time.time() - started:.1f}")
`;

/** The Demucs interpreter, or null when this host has none (then only an uploaded stem works). */
export function demucsPython(): string | null {
  if (process.env.DEMUCS_PYTHON) return existsSync(process.env.DEMUCS_PYTHON) ? process.env.DEMUCS_PYTHON : null;
  const venv = path.join(homedir(), 'venvs', 'demucs', 'bin', 'python');
  return existsSync(venv) ? venv : null;
}

function demucsThreads(): number {
  const n = Number(process.env.DEMUCS_THREADS);
  return Number.isInteger(n) && n > 0 ? n : 8;
}

export function projectVocalsState(p: StoryProjectFull) {
  return vocalsState(p, SEPARATE_STALE_MS);
}

const notSeparating = () => [
  { vocalsStatus: null },
  { vocalsStatus: { not: 'separating' } },
  { vocalsStartedAt: { lt: new Date(Date.now() - SEPARATE_STALE_MS) } },
];

/**
 * Claim the project for separation and queue it. False when one is already
 * running. The claim is conditional, so a double click separates once.
 */
export async function startSeparation(project: StoryProjectFull): Promise<boolean> {
  if (project.mode !== 'mv' || !project.songUrl) throw new StoryError('แยกเสียงร้องได้เฉพาะ MV ที่มีเพลง', 422);
  if (!demucsPython()) throw new StoryError('ระบบแยกเสียงร้องอัตโนมัติยังไม่พร้อม — อัปโหลดไฟล์เสียงร้องแยกแทน', 503);
  const claimed = await prisma.aiStoryProject.updateMany({
    where: { id: project.id, userId: project.userId, songUrl: project.songUrl, OR: notSeparating() },
    data: { vocalsStatus: 'separating', vocalsStartedAt: new Date(), vocalsError: null, vocalsSongUrl: project.songUrl },
  });
  if (claimed.count === 0) return false;
  enqueueJob(() =>
    separate(project.id).catch(async (error) => {
      const message = error instanceof StoryJobError ? error.message : 'แยกเสียงร้องไม่สำเร็จ ลองใหม่ หรืออัปโหลดไฟล์เสียงร้องแยกแทน';
      if (!(error instanceof StoryJobError)) console.error(`[story] separate ${project.id}:`, error);
      await prisma.aiStoryProject
        .updateMany({ where: { id: project.id, vocalsStatus: 'separating' }, data: { vocalsStatus: 'failed', vocalsError: message } })
        .catch((e) => console.error(`[story] separate ${project.id} status write failed:`, e));
    })
  );
  return true;
}

async function separate(projectId: number): Promise<void> {
  const project = await prisma.aiStoryProject.findUnique({ where: { id: projectId } });
  if (!project || project.vocalsStatus !== 'separating' || !project.songUrl) return;
  const python = demucsPython();
  if (!python) throw new StoryJobError('ระบบแยกเสียงร้องอัตโนมัติยังไม่พร้อม — อัปโหลดไฟล์เสียงร้องแยกแทน');
  const songUrl = project.songUrl;
  const dir = await mkdtemp(path.join(tmpdir(), 'aixman-vocals-'));
  try {
    await download(songUrl, path.join(dir, 'song.bin'), SONG_MAX_BYTES, 'เพลง');
    await runFfmpeg(
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'song.bin', '-t', String(MAX_SECONDS), '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', 'in.wav'],
      dir,
      2 * 60_000
    ).catch(() => {
      throw new StoryJobError('อ่านไฟล์เพลงไม่ได้ ใช้ไฟล์ MP3, WAV หรือ M4A');
    });
    await writeFile(path.join(dir, 'separate.py'), SEPARATE_PY);
    const threads = demucsThreads();
    await runNiced(python, ['-I', 'separate.py', 'in.wav', 'out.wav', String(threads)], {
      cwd: dir,
      timeoutMs: SEPARATE_TIMEOUT_MS,
      niceness: 15,
      env: { ...process.env, OMP_NUM_THREADS: String(threads), MKL_NUM_THREADS: String(threads) },
    });
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'out.wav', '-c:a', 'libmp3lame', '-b:a', '192k', 'vocals.mp3'], dir, 2 * 60_000);
    const url = await uploadBuffer(await readFile(path.join(dir, 'vocals.mp3')), `story/${project.userId}/${project.id}/vocals-${Date.now()}.mp3`, 'audio/mpeg');
    // Only if the project still waits for this song's vocal.
    await prisma.aiStoryProject.updateMany({
      where: { id: project.id, vocalsStatus: 'separating', vocalsSongUrl: songUrl },
      data: { vocalsStatus: 'done', vocalsUrl: url, vocalsSource: 'separated', vocalsError: null },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A vocal stem the customer uploaded instead (the route checked it is theirs and as long as the song). */
export async function adoptUploadedVocals(project: StoryProjectFull, url: string): Promise<void> {
  const r = await prisma.aiStoryProject.updateMany({
    where: { id: project.id, userId: project.userId, OR: notSeparating() },
    data: { vocalsStatus: 'done', vocalsUrl: url, vocalsSource: 'upload', vocalsSongUrl: project.songUrl, vocalsError: null, vocalsStartedAt: null },
  });
  if (r.count === 0) throw new StoryError('กำลังแยกเสียงร้องอยู่ รอให้เสร็จก่อน', 409);
}

// ---------------------------------------------------------------------------
// Lip-sync orders
// ---------------------------------------------------------------------------

export interface LipsyncModel {
  id: number;
  name: string;
  creditsPerUnit: number;
  maxDuration: number | null;
  orderable: boolean;
}

export async function lipsyncModel(admin: boolean): Promise<LipsyncModel | null> {
  const m = await prisma.aiModel.findFirst({
    where: { modelId: LIPSYNC_MODEL_KEY, isActive: true },
    select: { id: true, name: true, creditsPerUnit: true, maxDuration: true, readiness: true },
  });
  return m ? { id: m.id, name: m.name, creditsPerUnit: m.creditsPerUnit, maxDuration: m.maxDuration, orderable: ModelReadiness.canOrder(m.readiness, admin) } : null;
}

/** What GenerationService will charge for a voice of `seconds` — the same rounding and curve. */
export function lipsyncCredits(model: LipsyncModel | null, seconds: number): number | null {
  const entry = getCatalogEntry(LIPSYNC_MODEL_KEY);
  if (!model || !entry?.lengthFromAudio) return null;
  const length = voiceRenderSeconds(seconds, entry.lengthFromAudio, model.maxDuration);
  return length.ok ? creditsForDuration(model.creditsPerUnit, entry.pricing.durationCurve, length.seconds) : null;
}

const ORPHAN_CLAIM_MS = 10 * 60_000;

/**
 * Claim shots for a dub (→ rendering), each with a conditional update, so a
 * double click or two tabs order a shot once. Returns the ids claimed.
 * Ordering happens after the response (`placeLipsync`).
 */
export async function claimLipsync(project: StoryProjectFull, shotIds: number[]): Promise<number[]> {
  if (project.mode !== 'mv') throw new StoryError('ลิปซิงก์เสียงร้องใช้ได้เฉพาะโหมด MV');
  if (projectVocalsState(project) !== 'done') throw new StoryError('ยังไม่มีเสียงร้องแยก — แยกเสียงร้องหรืออัปโหลดก่อน', 409);
  const claimed: number[] = [];
  for (const id of shotIds) {
    const shot = project.shots.find((s) => s.id === id);
    if (!shot || shot.status !== 'done' || !shot.mediaUrl) continue;
    if (!voiceWindow(shot.startSec === null ? null : Number(shot.startSec), Number(shot.durationSec)).ok) continue;
    const r = await prisma.aiStoryShot.updateMany({
      where: {
        id: shot.id,
        projectId: project.id,
        status: 'done',
        mediaUrl: shot.mediaUrl,
        OR: [
          { lipsyncStatus: null },
          { lipsyncStatus: { not: 'rendering' } },
          // Claimed but never linked to an order (the process died): taken over.
          { lipsyncGenerationId: null, updatedAt: { lt: new Date(Date.now() - ORPHAN_CLAIM_MS) } },
        ],
      },
      data: { lipsyncStatus: 'rendering', lipsyncGenerationId: null, lipsyncSourceUrl: shot.mediaUrl, lipsyncError: null, lipsyncUse: true },
    });
    if (r.count > 0) claimed.push(shot.id);
  }
  return claimed;
}

/**
 * For each claimed shot: cut its slice of the vocal, store it, and order the
 * dub. A slice with no singing in it is refused before any charge; a balance
 * that runs out stops the rest with the same message.
 */
export async function placeLipsync(userId: number, admin: boolean, projectId: number, shotIds: number[]): Promise<void> {
  const fail = (ids: number[], message: string) =>
    prisma.aiStoryShot.updateMany({
      where: { id: { in: ids }, lipsyncStatus: 'rendering', lipsyncGenerationId: null },
      data: { lipsyncStatus: 'failed', lipsyncError: message },
    });
  const project = await prisma.aiStoryProject.findFirst({ where: { id: projectId, userId }, include: { shots: true } });
  if (!project) return;
  const model = await lipsyncModel(admin);
  if (!model?.orderable) {
    await fail(shotIds, 'ตัวลิปซิงก์ยังไม่เปิดให้ใช้ ลองใหม่ภายหลัง');
    return;
  }
  if (!project.vocalsUrl || project.vocalsStatus !== 'done') {
    await fail(shotIds, 'ยังไม่มีเสียงร้องแยก');
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'aixman-sing-'));
  const pending = [...shotIds];
  try {
    try {
      await download(project.vocalsUrl, path.join(dir, 'vocals.bin'), VOCALS_MAX_BYTES, 'ไฟล์เสียงร้อง');
    } catch (error) {
      await fail(pending, error instanceof StoryJobError ? error.message : 'อ่านไฟล์เสียงร้องไม่ได้ ลองใหม่อีกครั้ง');
      return;
    }
    while (pending.length > 0) {
      const id = pending.shift()!;
      const shot = project.shots.find((s) => s.id === id);
      if (!shot?.mediaUrl) {
        await fail([id], 'ช็อตนี้ยังไม่มีคลิป');
        continue;
      }
      const window = voiceWindow(shot.startSec === null ? null : Number(shot.startSec), Number(shot.durationSec));
      if (!window.ok) {
        await fail([id], window.message);
        continue;
      }
      try {
        const slice = `slice_${id}.wav`;
        await runFfmpeg(
          ['-y', '-hide_banner', '-loglevel', 'error', '-ss', window.start.toFixed(3), '-t', window.seconds.toFixed(3), '-i', 'vocals.bin',
            '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', slice],
          dir,
          60_000
        );
        const level = meanVolumeDb(await runFfmpeg(['-hide_banner', '-i', slice, '-af', 'volumedetect', '-f', 'null', '-'], dir, 60_000));
        if (level === null || level < SILENT_MEAN_DB) {
          await fail([id], 'ช่วงนี้ของเพลงไม่มีเสียงร้อง ไม่ต้องลิปซิงก์ (ไม่เสียเครดิต)');
          continue;
        }
        const voiceUrl = await uploadBuffer(await readFile(path.join(dir, slice)), `story/${userId}/${projectId}/sing-${id}-${Date.now()}.wav`, 'audio/wav');
        const result = await GenerationService.generate(
          userId,
          { modelId: model.id, type: 'video', prompt: '', inputVideo: shot.mediaUrl, inputAudio: voiceUrl },
          { isAdmin: admin }
        );
        await prisma.aiStoryShot.updateMany({
          where: { id, lipsyncStatus: 'rendering', lipsyncGenerationId: null },
          data: { lipsyncGenerationId: result.id },
        });
      } catch (error) {
        await fail([id], customerMessage(error));
        if (generationErrorResponse(error)?.status === 402) {
          await fail(pending.splice(0), customerMessage(error));
        } else if (!(error instanceof StoryError) && !generationErrorResponse(error)) {
          console.error(`[story] lipsync shot ${id}:`, error);
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Bring dubs in flight up to date with their orders — the same conditional
 * writes as syncShots: a newer claim is never settled with an old result.
 */
export async function syncDubs(project: StoryProjectFull): Promise<boolean> {
  let changed = false;
  const orphans = project.shots.filter(
    (s) => s.lipsyncStatus === 'rendering' && !s.lipsyncGenerationId && Date.now() - s.updatedAt.getTime() > ORPHAN_CLAIM_MS
  );
  for (const shot of orphans) {
    const r = await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, lipsyncStatus: 'rendering', lipsyncGenerationId: null },
      data: { lipsyncStatus: 'failed', lipsyncError: 'การสั่งลิปซิงก์ไม่สมบูรณ์ — ตรวจในแกลเลอรีก่อนสั่งใหม่' },
    });
    changed ||= r.count > 0;
  }
  const flying = project.shots.filter((s) => s.lipsyncStatus === 'rendering' && s.lipsyncGenerationId);
  if (flying.length === 0) return changed;
  const gens = await prisma.aiGeneration.findMany({
    where: { id: { in: flying.map((s) => s.lipsyncGenerationId!) }, userId: project.userId },
    select: { id: true, status: true, resultUrl: true, errorMessage: true, creditsRefunded: true },
  });
  for (const shot of flying) {
    const gen = gens.find((g) => g.id === shot.lipsyncGenerationId);
    if (!gen) continue;
    if (gen.status === 'completed' && gen.resultUrl) {
      const r = await prisma.aiStoryShot.updateMany({
        where: { id: shot.id, lipsyncStatus: 'rendering', lipsyncGenerationId: gen.id },
        data: { lipsyncStatus: 'done', lipsyncUrl: gen.resultUrl, lipsyncError: null },
      });
      changed ||= r.count > 0;
    } else if (gen.status === 'failed' || gen.status === 'cancelled') {
      const refunded = gen.creditsRefunded > 0 ? ' (คืนเครดิตแล้ว)' : '';
      // LatentSync stops when a frame has no face it can find (input-fault.ts):
      // worth saying, or the customer orders the same shot again.
      const reason = /ใบหน้า|Face not detected/i.test(gen.errorMessage ?? '')
        ? 'ไม่พบใบหน้าในบางช่วงของช็อต — ใช้ช็อตที่เห็นหน้าชัดตลอด หรือข้ามช็อตนี้'
        : 'ลิปซิงก์ไม่สำเร็จ ลองสั่งใหม่ได้';
      const r = await prisma.aiStoryShot.updateMany({
        where: { id: shot.id, lipsyncStatus: 'rendering', lipsyncGenerationId: gen.id },
        data: { lipsyncStatus: 'failed', lipsyncError: `${reason}${refunded}` },
      });
      changed ||= r.count > 0;
    }
  }
  return changed;
}
