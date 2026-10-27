import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import prisma from '@/lib/db';
import { keyFromPublicUrl, uploadBuffer } from '@/lib/storage/r2';
import {
  MAX_FILM_SECONDS,
  buildAss,
  mixFilter,
  parseEdit,
  parseMusicState,
  shotVideoFilter,
  subtitleCues,
  FADE_SECONDS,
  type CutShot,
  type EditSettings,
} from './edit';
import type { StoryMode } from './cinematic';

/**
 * Joins a project's finished shots into one film on this server (ffmpeg from
 * the ffmpeg-static package; the host has no ffmpeg of its own).
 *
 * One film at a time, in process like rate-limit.ts — correct because PM2
 * runs a single instance. ffmpeg runs niced and with a few threads so the web
 * server keeps answering. A film claimed for assembly that never finished
 * (the process restarted) can be claimed again after STALE_MS.
 *
 * Only our own bucket's files are fetched (keyFromPublicUrl): a shot's media
 * and the song are URLs we stored, never a stranger's.
 */

const STALE_MS = 30 * 60_000;
const SEGMENT_TIMEOUT_MS = 4 * 60_000;
const FINAL_TIMEOUT_MS = 20 * 60_000;
const MAX_INPUT_BYTES = 400 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 900 * 1024 * 1024;
const FONT_FILE = 'Sarabun-Bold.ttf';
const FONT_NAME = 'Sarabun';

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'node_modules', 'ffmpeg-static', bin);
}

class AssembleError extends Error {}

function runFfmpeg(args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const bin = ffmpegPath();
  const [cmd, argv] = process.platform === 'linux' ? ['nice', ['-n', '10', bin, ...args]] : [bin, args];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

async function download(url: string, dest: string): Promise<void> {
  if (!keyFromPublicUrl(url)) throw new AssembleError('ไฟล์บางช็อตไม่ได้อยู่ในคลังของเรา สร้างช็อตนั้นใหม่');
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new AssembleError('ดาวน์โหลดคลิปบางช็อตไม่ได้ ลองใหม่อีกครั้ง');
  if (Number(res.headers.get('content-length') ?? 0) > MAX_INPUT_BYTES) throw new AssembleError('คลิปบางช็อตใหญ่เกินไป');
  let total = 0;
  const limited = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) limited.destroy(new AssembleError('คลิปบางช็อตใหญ่เกินไป'));
  });
  await pipeline(limited, createWriteStream(dest));
}

async function hasAudio(file: string, cwd: string): Promise<boolean> {
  // `ffmpeg -i` with no output exits 1 but prints the streams.
  const out = await runFfmpeg(['-hide_banner', '-i', file, '-f', 'null', '-t', '0', '-'], cwd, 30_000).catch((e: Error) => e.message);
  return /Stream #\d+:\d+.*Audio:/.test(out);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

let chain: Promise<void> = Promise.resolve();

/**
 * Claim the project for assembly (conditional, so a double click or two tabs
 * start it once) and queue it. Returns false when it is already being made.
 */
export async function startAssembly(userId: number, projectId: number): Promise<boolean> {
  const claimed = await prisma.aiStoryProject.updateMany({
    where: {
      id: projectId,
      userId,
      OR: [{ status: { not: 'assembling' } }, { updatedAt: { lt: new Date(Date.now() - STALE_MS) } }],
    },
    data: { status: 'assembling', errorMessage: null },
  });
  if (claimed.count === 0) return false;
  chain = chain.then(() =>
    assemble(projectId).catch(async (error) => {
      const message = error instanceof AssembleError ? error.message : 'ตัดต่อไม่สำเร็จ ลองใหม่อีกครั้ง';
      if (!(error instanceof AssembleError)) console.error(`[story] assemble ${projectId}:`, error);
      await prisma.aiStoryProject
        .updateMany({ where: { id: projectId, status: 'assembling' }, data: { status: 'draft', errorMessage: message } })
        .catch(() => {});
    })
  );
  return true;
}

/** True when an assembly claim is old enough to count as dead. */
export function assemblyStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > STALE_MS;
}

async function assemble(projectId: number): Promise<void> {
  const project = await prisma.aiStoryProject.findUnique({
    where: { id: projectId },
    include: {
      shots: { orderBy: { shotNumber: 'asc' } },
    },
  });
  if (!project || project.status !== 'assembling') return;
  const mode = project.mode as StoryMode;
  const script = (project.scriptJson ?? {}) as Record<string, unknown>;
  const edit = parseEdit(script.edit, mode);

  const ready = project.shots.filter((s) => s.status === 'done' && s.mediaUrl);
  if (ready.length === 0) throw new AssembleError('ยังไม่มีช็อตที่สร้างเสร็จ');

  const modelKeys = new Map(
    (await prisma.aiModel.findMany({ where: { id: { in: ready.map((s) => s.modelId ?? 0) } }, select: { id: true, modelId: true } })).map((m) => [m.id, m.modelId])
  );
  const shots: CutShot[] = ready.map((s) => ({
    number: s.shotNumber,
    seconds: Number(s.durationSec),
    text: s.narration ?? '',
    // A shot whose model is unknown is treated as LTX: covering an empty band costs nothing.
    burnsSubs: modelKeys.get(s.modelId ?? 0) !== 'minimax-h3',
  }));
  const total = shots.reduce((n, s) => n + s.seconds, 0);
  if (total > MAX_FILM_SECONDS) throw new AssembleError(`หนังยาวเกิน ${MAX_FILM_SECONDS / 60} นาที ลดช็อตลงก่อน`);

  let musicUrl: string | null = null;
  if (edit.music === 'song') {
    musicUrl = project.songUrl;
    if (!musicUrl) throw new AssembleError('โปรเจกต์นี้ไม่มีเพลง ปิดดนตรีประกอบหรือเลือกเพลงใหม่');
  } else if (edit.music === 'generate') {
    const state = parseMusicState(script.music);
    const gen = state
      ? await prisma.aiGeneration.findFirst({ where: { id: state.generationId, userId: project.userId }, select: { status: true, resultUrl: true } })
      : null;
    if (!gen) throw new AssembleError('ยังไม่ได้สร้างเพลงประกอบ — สร้างก่อน หรือปิดดนตรีประกอบ');
    if (gen.status !== 'completed' || !gen.resultUrl) throw new AssembleError('เพลงประกอบยังสร้างไม่เสร็จ รอสักครู่แล้วลองใหม่');
    musicUrl = gen.resultUrl;
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'aixman-film-'));
  try {
    const files: string[] = [];
    for (const [k, shot] of ready.entries()) {
      files.push(`in_${k}.mp4`);
      await download(shot.mediaUrl!, path.join(dir, files[k]));
    }
    if (musicUrl) await download(musicUrl, path.join(dir, 'music.bin'));
    const out = await renderFilm({
      dir,
      files,
      shots,
      aspect: project.aspectRatio,
      edit,
      music: musicUrl ? 'music.bin' : null,
      title: edit.titleCard ? project.title : undefined,
    });
    const size = (await stat(out)).size;
    if (size > MAX_OUTPUT_BYTES) throw new AssembleError('ไฟล์หนังใหญ่เกินไป ลดจำนวนช็อตลง');
    const url = await uploadBuffer(await readFile(out), `story/${project.userId}/${project.id}/${Date.now()}.mp4`, 'video/mp4');
    await prisma.aiStoryProject.updateMany({
      where: { id: project.id, status: 'assembling' },
      data: { status: 'done', finalVideoUrl: url, durationSec: Math.round(total), errorMessage: null },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The cut itself, on files already in `dir`: each shot to a segment in the
 * film's frame (24 fps, stereo 48 kHz), joined without re-encoding, then
 * music, subtitles and title over the whole. Returns the film's path.
 */
export async function renderFilm(opts: {
  dir: string;
  files: string[];
  shots: CutShot[];
  aspect: string;
  edit: EditSettings;
  music: string | null;
  title?: string;
}): Promise<string> {
  const { dir, shots, edit } = opts;
  await mkdir(path.join(dir, 'fonts'), { recursive: true });
  await copyFile(path.join(/*turbopackIgnore: true*/ process.cwd(), 'assets', 'fonts', FONT_FILE), path.join(dir, 'fonts', FONT_FILE));
  const total = shots.reduce((n, s) => n + s.seconds, 0);
  const fade = edit.transition === 'fade';

  const list: string[] = [];
  for (const [k, shot] of shots.entries()) {
    const src = opts.files[k];
    const useClip = edit.clipAudio && (await hasAudio(src, dir));
    const vf = shotVideoFilter({ aspect: opts.aspect, seconds: shot.seconds, cover: edit.coverFakeSubs && shot.burnsSubs, fade });
    const afade = fade ? `,afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${Math.max(0, shot.seconds - FADE_SECONDS).toFixed(3)}:d=${FADE_SECONDS}` : '';
    const audio = useClip ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad${afade}[a]` : '[1:a]anull[a]';
    const seg = `seg_${k}.mp4`;
    await runFfmpeg(
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', src,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        // A clip a little short of its slot holds its last frame.
        '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=10,${vf}[v];${audio}`,
        '-map', '[v]', '-map', '[a]', '-t', shot.seconds.toFixed(3),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '24', '-threads', '4',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        seg,
      ],
      dir,
      SEGMENT_TIMEOUT_MS
    );
    list.push(`file '${seg}'`);
  }

  // Segments share every parameter, so the join copies.
  await writeFile(path.join(dir, 'list.txt'), list.join('\n') + '\n');
  await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'joined.mp4'], dir, SEGMENT_TIMEOUT_MS);

  const inputs = ['-i', 'joined.mp4'];
  if (opts.music) inputs.push('-stream_loop', '-1', '-i', opts.music);
  const cues = edit.subtitles ? subtitleCues(shots, fade) : [];
  const burnText = cues.length > 0 || Boolean(opts.title?.trim());
  if (burnText) await writeFile(path.join(dir, 'film.ass'), buildAss({ aspect: opts.aspect, cues, title: opts.title, font: FONT_NAME }));
  const mix = mixFilter({
    clips: edit.clipAudio,
    music: Boolean(opts.music),
    clipVolume: edit.clipVolume,
    musicVolume: edit.musicVolume,
    duck: edit.duck,
    seconds: total,
  });
  const graph = [burnText ? '[0:v]subtitles=film.ass:fontsdir=fonts[vout]' : null, mix].filter(Boolean).join(';');
  await runFfmpeg(
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputs,
      ...(graph ? ['-filter_complex', graph] : []),
      '-map', burnText ? '[vout]' : '0:v',
      '-map', mix ? '[aout]' : '0:a',
      '-t', total.toFixed(3),
      ...(burnText ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '4'] : ['-c:v', 'copy']),
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      'film.mp4',
    ],
    dir,
    FINAL_TIMEOUT_MS
  );
  return path.join(dir, 'film.mp4');
}
