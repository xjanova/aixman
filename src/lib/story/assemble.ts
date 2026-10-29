import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import prisma from '@/lib/db';
import { uploadBuffer } from '@/lib/storage/r2';
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
import { StoryJobError, download, enqueueJob, hasAudio, runFfmpeg } from './media';
import { usableDub } from './sing';
import type { Msg } from '@/lib/i18n/locale';
import { packMsg, registerStoredMsgs } from '@/lib/i18n/messages';

/**
 * Joins a project's finished shots into one film on this server's ffmpeg,
 * queued with the other CPU jobs (media.ts). ffmpeg runs niced and with a few
 * threads so the web server keeps answering. A film claimed for assembly that
 * never finished (the process restarted) can be claimed again after STALE_MS.
 *
 * Only our own bucket's files are fetched (media.ts download): a shot's media
 * and the song are URLs we stored, never a stranger's.
 */

// A 10-minute film is ~60 segments and a full re-encode with subtitles.
const STALE_MS = 60 * 60_000;
const SEGMENT_TIMEOUT_MS = 4 * 60_000;
const FINAL_TIMEOUT_MS = 30 * 60_000;
const MAX_INPUT_BYTES = 400 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 900 * 1024 * 1024;
const FONT_FILE = 'Sarabun-Bold.ttf';
const FONT_NAME = 'Sarabun';

// The reason a cut failed, written to the project row and read back later (packMsg).
const CUT_FAILED: Msg = { th: 'ตัดต่อไม่สำเร็จ ลองใหม่อีกครั้ง', en: "Couldn't cut the film. Please try again." };
const REFUNDED: Msg = { th: '(คืนเครดิตแล้ว)', en: 'Your credits have been refunded.' };
const withRefund = (msg: Msg): Msg => ({ th: `${msg.th} ${REFUNDED.th}`, en: `${msg.en} ${REFUNDED.en}` });
const NO_READY_SHOTS: Msg = { th: 'ยังไม่มีช็อตที่สร้างเสร็จ', en: 'No shots are finished yet.' };
// Rows written before messages were stored in both languages hold these in Thai only.
registerStoredMsgs(CUT_FAILED, REFUNDED, NO_READY_SHOTS);

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/**
 * Claim the project for assembly, charge for it, and queue it — one
 * transaction, so a double click or two tabs start (and charge) it once, and
 * a balance too low leaves nothing claimed. Returns false when it is already
 * being made. `credits` is 0 for admins.
 *
 * The charge sits on ai_story_projects.credits_charged while the film is
 * being made. Its refund rides on the same conditional status change that
 * ends the attempt (assembling → draft), so it can happen once only; a dead
 * claim taken over after STALE_MS is refunded as it is taken over.
 */
export async function startAssembly(userId: number, projectId: number, credits: number, title: string): Promise<boolean> {
  const started = await prisma.$transaction(async (tx) => {
    const stale = await tx.aiStoryProject.findFirst({
      where: { id: projectId, userId, status: 'assembling', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
      select: { creditsCharged: true },
    });
    const claimed = await tx.aiStoryProject.updateMany({
      where: {
        id: projectId,
        userId,
        OR: [{ status: { not: 'assembling' } }, { updatedAt: { lt: new Date(Date.now() - STALE_MS) } }],
      },
      data: { status: 'assembling', errorMessage: null, creditsCharged: credits },
    });
    if (claimed.count === 0) return false;
    if (stale && stale.creditsCharged > 0) {
      await refundWithin(tx, userId, stale.creditsCharged, projectId, 'คืนเครดิต: การตัดต่อครั้งก่อนค้าง');
    }
    if (credits > 0) {
      const paid = await tx.$executeRawUnsafe(
        'UPDATE ai_user_credits SET balance = balance - ?, total_used = total_used + ? WHERE user_id = ? AND balance >= ?',
        credits, credits, userId, credits
      );
      if (paid === 0) {
        const credit = await tx.aiUserCredit.findUnique({ where: { userId } });
        // Rolls the claim back with it.
        throw new Error(`Insufficient credits. Need ${credits}, have ${credit?.balance ?? 0}`);
      }
      const credit = await tx.aiUserCredit.findUnique({ where: { userId } });
      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'usage',
          amount: -credits,
          balanceAfter: credit?.balance ?? 0,
          description: `ตัดต่อหนัง: ${title}`.slice(0, 500),
          metadata: { storyProjectId: projectId, kind: 'story-assemble' },
        },
      });
    }
    return true;
  });
  if (!started) return false;

  enqueueJob(() =>
    assemble(projectId).catch(async (error) => {
      const message = error instanceof StoryJobError ? error.msg : CUT_FAILED;
      if (!(error instanceof StoryJobError)) console.error(`[story] assemble ${projectId}:`, error);
      await prisma
        .$transaction(async (tx) => {
          const row = await tx.aiStoryProject.findFirst({ where: { id: projectId, status: 'assembling' }, select: { creditsCharged: true } });
          const ended = await tx.aiStoryProject.updateMany({
            where: { id: projectId, status: 'assembling' },
            data: { status: 'draft', errorMessage: packMsg(row && row.creditsCharged > 0 ? withRefund(message) : message), creditsCharged: 0 },
          });
          if (ended.count > 0 && row && row.creditsCharged > 0) {
            await refundWithin(tx, userId, row.creditsCharged, projectId, 'คืนเครดิต: ตัดต่อหนังไม่สำเร็จ');
          }
        })
        .catch((e) => console.error(`[story] assemble ${projectId} refund failed:`, e));
    })
  );
  return true;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function refundWithin(tx: Tx, userId: number, amount: number, projectId: number, description: string) {
  const credit = await tx.aiUserCredit.update({
    where: { userId },
    data: { balance: { increment: amount }, totalUsed: { decrement: amount } },
  });
  await tx.aiCreditTransaction.create({
    data: {
      userId,
      type: 'refund',
      amount,
      balanceAfter: credit.balance,
      description,
      metadata: { storyProjectId: projectId, kind: 'story-assemble' },
    },
  });
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
  // A singing shot is cut from its lip-sync dub when the switch is on and the
  // dub was made from the clip the shot has now.
  const sources = ready.map((s) => (mode === 'mv' && edit.lipsync && usableDub(s) ? s.lipsyncUrl! : s.mediaUrl!));
  if (ready.length === 0) throw new StoryJobError(NO_READY_SHOTS);

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
  if (total > MAX_FILM_SECONDS) {
    throw new StoryJobError({ th: `หนังยาวเกิน ${MAX_FILM_SECONDS / 60} นาที ลดช็อตลงก่อน`, en: `The film is longer than ${MAX_FILM_SECONDS / 60} minutes. Remove some shots first.` });
  }

  let musicUrl: string | null = null;
  if (edit.music === 'song') {
    musicUrl = project.songUrl;
    if (!musicUrl) {
      throw new StoryJobError({ th: 'โปรเจกต์นี้ไม่มีเพลง ปิดดนตรีประกอบหรือเลือกเพลงใหม่', en: "This project has no song. Turn the music off or pick a new song." });
    }
  } else if (edit.music === 'generate') {
    const state = parseMusicState(script.music);
    const gen = state
      ? await prisma.aiGeneration.findFirst({ where: { id: state.generationId, userId: project.userId }, select: { status: true, resultUrl: true } })
      : null;
    if (!gen) {
      throw new StoryJobError({ th: 'ยังไม่ได้สร้างเพลงประกอบ — สร้างก่อน หรือปิดดนตรีประกอบ', en: "The background music hasn't been made yet — make it first, or turn the music off." });
    }
    if (gen.status !== 'completed' || !gen.resultUrl) {
      throw new StoryJobError({ th: 'เพลงประกอบยังสร้างไม่เสร็จ รอสักครู่แล้วลองใหม่', en: "The background music isn't finished yet. Wait a moment and try again." });
    }
    musicUrl = gen.resultUrl;
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'aixman-film-'));
  try {
    const files: string[] = [];
    for (const [k, url] of sources.entries()) {
      files.push(`in_${k}.mp4`);
      await download(url, path.join(dir, files[k]), MAX_INPUT_BYTES, { th: 'คลิปบางช็อต', en: 'some shot clips' });
    }
    if (musicUrl) await download(musicUrl, path.join(dir, 'music.bin'), MAX_INPUT_BYTES, { th: 'เพลง', en: 'the music' });
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
    if (size > MAX_OUTPUT_BYTES) throw new StoryJobError({ th: 'ไฟล์หนังใหญ่เกินไป ลดจำนวนช็อตลง', en: 'The film file is too large. Use fewer shots.' });
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
