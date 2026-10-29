import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { translator, type Locale, type Msg } from '@/lib/i18n/locale';
import { UserMessageError } from '@/lib/i18n/messages';
import { isStorageConfigured, keyFromPublicUrl, publicUrlFor, uploadBuffer } from '@/lib/storage/r2';
import { StoryJobError, download, enqueueJob, runFfmpeg, runNiced } from '@/lib/story/media';
import { SEPARATE_PY, demucsPython, demucsThreads } from '@/lib/story/vocals';
import { ALIGN_PY, alignerModelDir, alignerPython, alignerThreads } from './aligner';
import { alignTarget, buildTiming, lyricLines, parseTiming, type AlignResult, type AlignedChar, type KaraokeTiming, type LyricLine } from './karaoke';

/**
 * Karaoke timing for a customer's song, made on this server and kept in R2:
 * the vocal is separated (Demucs, as for MV lip-sync), the Thai aligner gives
 * each letter its moment (aligner.ts), and karaoke.ts makes words and lines.
 * The song without its vocal comes out of the same separation and is kept
 * with it — the backing track of a sing-along cut.
 *
 * Free to the customer, a few minutes per song, queued with the other CPU
 * jobs (story/media.ts). One timing per song and lyrics: the key is an HMAC
 * of the song's object key and the sung lines, under the customer's own
 * prefix, so the studio and an MV made from the same song share it, and a
 * corrected timing is saved over it.
 *
 * In-process state (which songs are being timed) is correct because PM2 runs
 * one instance, like rate-limit.ts; a restart loses only jobs in flight.
 */

export const KARAOKE_DOC_VERSION = 1;

export interface KaraokeDoc {
  version: typeof KARAOKE_DOC_VERSION;
  /** The song it was timed on (ours). */
  songUrl: string;
  timing: KaraokeTiming;
  /** The song without its lead vocal (the other stems summed), mp3. */
  instrumentalUrl: string | null;
  createdAt: string;
  /** When the customer last moved its lines. */
  editedAt: string | null;
}

export type KaraokeStage = 'queued' | 'separating' | 'aligning';

export type KaraokeStatus =
  | { state: 'none' }
  | { state: KaraokeStage; since: number }
  | { state: 'failed'; error: Msg }
  | { state: 'done'; doc: KaraokeDoc };

export class KaraokeError extends UserMessageError {
  constructor(
    msg: Msg,
    readonly status = 422
  ) {
    super(msg);
  }
}

/** Matches Suno's longest track; Demucs and the aligner both scale with it. */
export const KARAOKE_MAX_SECONDS = 480;
const SONG_MAX_BYTES = 80 * 1024 * 1024;
const SEPARATE_TIMEOUT_MS = 30 * 60_000;
const ALIGN_TIMEOUT_MS = 30 * 60_000;
/** A job older than this was lost (it cannot run this long). */
const STALE_MS = 75 * 60_000;
/** How long a failure is reported before the song can simply be asked again. */
const FAILED_KEPT_MS = 15 * 60_000;
const MAX_ACTIVE = 6;
const MAX_ACTIVE_PER_USER = 2;
const DOC_CACHE = 200;

const NOT_READY: Msg = { th: 'ระบบจับจังหวะเนื้อร้องยังไม่พร้อม ลองใหม่ภายหลัง', en: "Lyric timing isn't available yet. Please try again later." };
const BUSY: Msg = { th: 'คิวจับจังหวะเนื้อร้องเต็ม ลองใหม่ในอีกสักครู่', en: 'The lyric timing queue is full. Please try again in a few minutes.' };
const USER_BUSY: Msg = {
  th: 'กำลังจับจังหวะเพลงอื่นของคุณอยู่ รอให้เสร็จก่อน',
  en: "Another of your songs is being timed. Wait for it to finish first.",
};
const FAILED: Msg = { th: 'จับจังหวะเนื้อร้องไม่สำเร็จ ลองใหม่อีกครั้ง', en: "Couldn't time the lyrics. Please try again." };
const NO_LINES: Msg = { th: 'ยังไม่มีเนื้อเพลงให้จับจังหวะ', en: 'There are no lyrics to time.' };
const NOT_THAI: Msg = {
  th: 'ตัวจับจังหวะรองรับเนื้อเพลงภาษาไทย — เนื้อเพลงนี้ไม่มีภาษาไทยเลย',
  en: 'Lyric timing works on Thai lyrics, and these lyrics have no Thai in them.',
};

/** The id of a song + lyrics' timing (hex), the same for every caller. */
export function karaokeId(userId: number, songUrl: string, lines: LyricLine[]): string {
  const key = keyFromPublicUrl(songUrl) ?? songUrl;
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'aixman-karaoke';
  const sung = lines.map((l) => `${l.section}|${l.text}`).join('\n');
  return createHmac('sha256', secret).update(`karaoke:${userId}\n${key}\n${sung}`).digest('hex').slice(0, 40);
}

export const isKaraokeId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{40}$/.test(id);

const docKey = (userId: number, id: string) => `karaoke/${userId}/${id}.json`;

export function karaokeReady(): boolean {
  return isStorageConfigured() && Boolean(demucsPython() && alignerPython() && alignerModelDir());
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Job {
  userId: number;
  stage: KaraokeStage | 'failed';
  since: number;
  error?: Msg;
}

const jobs = new Map<string, Job>();
const docs = new Map<string, KaraokeDoc>();

function remember(key: string, doc: KaraokeDoc): void {
  docs.delete(key);
  docs.set(key, doc);
  while (docs.size > DOC_CACHE) docs.delete(docs.keys().next().value!);
}

function liveJob(key: string): Job | null {
  const job = jobs.get(key);
  if (!job) return null;
  const age = Date.now() - job.since;
  if ((job.stage === 'failed' && age > FAILED_KEPT_MS) || (job.stage !== 'failed' && age > STALE_MS)) {
    jobs.delete(key);
    return null;
  }
  return job;
}

export function parseKaraokeDoc(raw: unknown): KaraokeDoc | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const timing = parseTiming(r.timing);
  if (r.version !== KARAOKE_DOC_VERSION || !timing || typeof r.songUrl !== 'string') return null;
  return {
    version: KARAOKE_DOC_VERSION,
    songUrl: r.songUrl,
    timing,
    instrumentalUrl: typeof r.instrumentalUrl === 'string' && keyFromPublicUrl(r.instrumentalUrl) ? r.instrumentalUrl : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    editedAt: typeof r.editedAt === 'string' ? r.editedAt : null,
  };
}

/** The stored timing, or null when there is none yet. */
export async function readKaraokeDoc(userId: number, id: string): Promise<KaraokeDoc | null> {
  const key = docKey(userId, id);
  const cached = docs.get(key);
  if (cached) return cached;
  const url = publicUrlFor(key);
  if (!url) return null;
  // A fresh query each time: a saved correction must not be read back from a cache.
  const res = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const doc = parseKaraokeDoc(await res.json().catch(() => null));
  if (doc) remember(key, doc);
  return doc;
}

async function writeDoc(userId: number, id: string, doc: KaraokeDoc): Promise<void> {
  const key = docKey(userId, id);
  await uploadBuffer(Buffer.from(JSON.stringify(doc)), key, 'application/json');
  remember(key, doc);
}

export async function karaokeStatus(userId: number, id: string): Promise<KaraokeStatus> {
  const job = liveJob(docKey(userId, id));
  if (job?.stage === 'failed') return { state: 'failed', error: job.error ?? FAILED };
  if (job) return { state: job.stage, since: job.since };
  const doc = await readKaraokeDoc(userId, id);
  return doc ? { state: 'done', doc } : { state: 'none' };
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

/** The lines to time from `lyrics`, refused when there is nothing Thai to align. */
export function karaokeLines(lyrics: string): LyricLine[] {
  const lines = lyricLines(lyrics);
  if (lines.length === 0) throw new KaraokeError(NO_LINES);
  if (!lines.some((l) => /[ก-ฮ]/.test(l.text))) throw new KaraokeError(NOT_THAI);
  return lines;
}

/** Where a song + lyrics' timing stands, without starting anything. */
export async function findKaraoke(opts: { userId: number; songUrl: string; lyrics: string }): Promise<{ id: string; lines: LyricLine[]; status: KaraokeStatus }> {
  if (!keyFromPublicUrl(opts.songUrl)) throw new KaraokeError({ th: 'ไม่พบเพลงนี้ในคลังของเรา', en: "This song isn't in our storage." });
  const lines = karaokeLines(opts.lyrics);
  const id = karaokeId(opts.userId, opts.songUrl, lines);
  return { id, lines, status: await karaokeStatus(opts.userId, id) };
}

/** Whether `status` means a new timing would be made (none yet, failed, or redone on request). */
export const karaokeNeedsRun = (status: KaraokeStatus, force: boolean) =>
  status.state === 'none' || status.state === 'failed' || (status.state === 'done' && force);

/**
 * Time `songUrl` (one of ours — the caller checked it is the customer's) to
 * `lyrics`. Returns the id and where it stands; a timing that exists or is
 * being made is returned as it is unless `force` (then it is made again from
 * the song).
 */
export async function startKaraoke(opts: { userId: number; songUrl: string; lyrics: string; force?: boolean }): Promise<{ id: string; status: KaraokeStatus }> {
  const { userId, songUrl } = opts;
  const { id, lines, status } = await findKaraoke(opts);
  if (!karaokeNeedsRun(status, opts.force === true)) return { id, status };
  const key = docKey(userId, id);
  if (!karaokeReady()) throw new KaraokeError(NOT_READY, 503);
  const active = [...jobs.entries()].filter(([k, j]) => liveJob(k) && j.stage !== 'failed');
  if (active.length >= MAX_ACTIVE) throw new KaraokeError(BUSY, 503);
  if (active.filter(([, j]) => j.userId === userId).length >= MAX_ACTIVE_PER_USER) throw new KaraokeError(USER_BUSY, 409);

  const job: Job = { userId, stage: 'queued', since: Date.now() };
  jobs.set(key, job);
  enqueueJob(() =>
    makeTiming(job, userId, id, songUrl, lines).then(
      () => {
        if (jobs.get(key) === job) jobs.delete(key);
      },
      (error) => {
        if (!(error instanceof UserMessageError)) console.error(`[karaoke] ${key}:`, error);
        if (jobs.get(key) === job) jobs.set(key, { userId, stage: 'failed', since: Date.now(), error: error instanceof UserMessageError ? error.msg : FAILED });
      }
    )
  );
  return { id, status: { state: 'queued', since: job.since } };
}

/** A status as the API sends it: a failure's reason in the caller's language. */
export function karaokeStatusJson(status: KaraokeStatus, locale: Locale) {
  return status.state === 'failed' ? { state: 'failed' as const, error: translator(locale)(status.error) } : status;
}

function threadEnv(threads: number): NodeJS.ProcessEnv {
  return { ...process.env, OMP_NUM_THREADS: String(threads), MKL_NUM_THREADS: String(threads) };
}

function alignResult(raw: unknown, lineCount: number): (AlignResult & { ok: boolean }) | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(r.chars) || r.chars.length !== lineCount || !Array.isArray(r.voiced) || typeof r.seconds !== 'number') return null;
  const char = (c: unknown): AlignedChar =>
    Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [c[0], c[1], c[2]] : null;
  return {
    ok: r.ok === true,
    chars: r.chars.map((line) => (Array.isArray(line) ? line.map(char) : [])),
    voiced: r.voiced.filter((v): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')),
    seconds: r.seconds,
  };
}

async function makeTiming(job: Job, userId: number, id: string, songUrl: string, lines: LyricLine[]): Promise<void> {
  const demucs = demucsPython();
  const aligner = alignerPython();
  const model = alignerModelDir();
  if (!demucs || !aligner || !model) throw new KaraokeError(NOT_READY);
  const dir = await mkdtemp(path.join(tmpdir(), 'aixman-karaoke-'));
  try {
    job.stage = 'separating';
    await download(songUrl, path.join(dir, 'song.bin'), SONG_MAX_BYTES, { th: 'เพลง', en: 'the song' });
    await runFfmpeg(
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'song.bin', '-t', String(KARAOKE_MAX_SECONDS + 1), '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', 'in.wav'],
      dir,
      2 * 60_000
    ).catch(() => {
      throw new StoryJobError({ th: 'อ่านไฟล์เพลงไม่ได้ ใช้ไฟล์ MP3, WAV หรือ M4A', en: "Couldn't read the song. Use an MP3, WAV or M4A file." });
    });
    // 16-bit stereo at 44.1 kHz: four bytes a sample, after a 44-byte header.
    const seconds = ((await stat(path.join(dir, 'in.wav'))).size - 44) / (44100 * 4);
    if (seconds > KARAOKE_MAX_SECONDS + 0.5) {
      throw new KaraokeError({ th: `เพลงยาวเกิน ${KARAOKE_MAX_SECONDS / 60} นาที`, en: `The song is longer than ${KARAOKE_MAX_SECONDS / 60} minutes.` });
    }
    if (seconds < 5) throw new KaraokeError({ th: 'เพลงสั้นเกินไป', en: 'The song is too short.' });

    const sepThreads = demucsThreads();
    await writeFile(path.join(dir, 'separate.py'), SEPARATE_PY);
    await runNiced(demucs, ['-I', 'separate.py', 'in.wav', 'vocals.wav', String(sepThreads), 'rest.wav'], {
      cwd: dir,
      timeoutMs: SEPARATE_TIMEOUT_MS,
      niceness: 15,
      env: threadEnv(sepThreads),
    });
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'vocals.wav', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'v16.wav'], dir, 2 * 60_000);
    await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', 'rest.wav', '-c:a', 'libmp3lame', '-b:a', '192k', 'minus.mp3'], dir, 2 * 60_000);
    await rm(path.join(dir, 'in.wav'), { force: true });
    const instrumentalUrl = await uploadBuffer(await readFile(path.join(dir, 'minus.mp3')), `karaoke/${userId}/${id}-minus-${Date.now()}.mp3`, 'audio/mpeg');

    job.stage = 'aligning';
    const alignThreads = alignerThreads();
    await writeFile(path.join(dir, 'lines.json'), JSON.stringify(lines.map((l) => alignTarget(l.text).align)));
    await writeFile(path.join(dir, 'align.py'), ALIGN_PY);
    await runNiced(aligner, ['-I', 'align.py', 'v16.wav', 'lines.json', 'out.json', String(alignThreads), model], {
      cwd: dir,
      timeoutMs: ALIGN_TIMEOUT_MS,
      niceness: 15,
      env: threadEnv(alignThreads),
    });
    const result = alignResult(JSON.parse(await readFile(path.join(dir, 'out.json'), 'utf8')), lines.length);
    if (!result) throw new Error('aligner output malformed');
    if (!result.ok) {
      throw new KaraokeError({
        th: 'เนื้อเพลงยาวเกินกว่าที่ร้องในเพลงนี้ — ตรวจว่าเป็นเนื้อของเพลงนี้',
        en: "The lyrics are longer than what is sung in this song — check they are this song's lyrics.",
      });
    }
    const doc: KaraokeDoc = {
      version: KARAOKE_DOC_VERSION,
      songUrl,
      timing: buildTiming(lines, result),
      instrumentalUrl,
      createdAt: new Date().toISOString(),
      editedAt: null,
    };
    await writeDoc(userId, id, doc);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A timing the customer corrected (lines moved, the whole song nudged). The
 * words and lines are theirs to move, not to replace: the text must be the
 * stored timing's, line for line.
 */
export async function saveKaraokeTiming(userId: number, id: string, raw: unknown): Promise<KaraokeDoc> {
  const doc = await readKaraokeDoc(userId, id);
  if (!doc) throw new KaraokeError({ th: 'ไม่พบจังหวะคาราโอเกะของเพลงนี้', en: 'No karaoke timing was found for this song.' }, 404);
  if (liveJob(docKey(userId, id))) throw new KaraokeError({ th: 'กำลังจับจังหวะใหม่อยู่ รอให้เสร็จก่อน', en: 'It is being timed again. Wait for it to finish first.' }, 409);
  const timing = parseTiming(raw);
  const same =
    timing &&
    timing.lines.length === doc.timing.lines.length &&
    timing.lines.every((l, i) => l.words.map((w) => w.text).join('') === doc.timing.lines[i].words.map((w) => w.text).join(''));
  if (!timing || !same) throw new KaraokeError({ th: 'จังหวะที่ส่งมาไม่ตรงกับเนื้อเพลง โหลดหน้าใหม่แล้วลองอีกครั้ง', en: "The timing sent doesn't match the lyrics. Reload the page and try again." });
  // Words and lines in the order they are sung.
  const outOfOrder = timing.lines.some(
    (l, i) => (i > 0 && l.start < timing.lines[i - 1].start) || l.words.some((w, k) => k > 0 && w.start < l.words[k - 1].start)
  );
  if (outOfOrder) throw new KaraokeError({ th: 'ลำดับเวลาของท่อนไม่ถูกต้อง โหลดหน้าใหม่แล้วลองอีกครั้ง', en: 'The lines are out of order. Reload the page and try again.' });
  const fixed: KaraokeDoc = { ...doc, timing: { ...timing, seconds: doc.timing.seconds }, editedAt: new Date().toISOString() };
  await writeDoc(userId, id, fixed);
  return fixed;
}
