import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import type { Msg } from '@/lib/i18n/locale';
import { UserMessageError } from '@/lib/i18n/messages';

/**
 * The server-side media work behind โหมดหนัง / MV — the cut (assemble.ts) and
 * the vocal separation and slicing for lip-sync (vocals.ts): this host's
 * ffmpeg and Python, downloads from our own bucket only, and one queue.
 *
 * One job at a time, in process like rate-limit.ts — correct because PM2 runs
 * a single instance. Both kinds of job eat CPU, so they share the queue: the
 * web server keeps answering while one runs.
 */

/**
 * A failure whose message is written for the customer (no internals), in both
 * languages: `message` is the Thai, `msg` the pair (UserMessageError).
 */
export class StoryJobError extends UserMessageError {}

/**
 * FFMPEG_PATH, else the host's own static build in ~/bin (prod: ffmpeg 7.0.2
 * from johnvansickle.com, which has libass — not on the service's PATH), else
 * whatever `ffmpeg` the PATH finds.
 */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const home = path.join(homedir(), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return existsSync(home) ? home : 'ffmpeg';
}

/**
 * Run a program niced on Linux, killed at the timeout. Resolves with the tail
 * of stdout+stderr; rejects with it when the exit code is not 0.
 */
export function runNiced(bin: string, args: string[], opts: { cwd: string; timeoutMs: number; niceness?: number; env?: NodeJS.ProcessEnv }): Promise<string> {
  const [cmd, argv] = process.platform === 'linux' ? ['nice', ['-n', String(opts.niceness ?? 10), bin, ...args]] : [bin, args];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (d: Buffer) => {
      output = (output + d.toString()).slice(-8000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${output.slice(-1500)}`));
    });
  });
}

export function runFfmpeg(args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return runNiced(ffmpegPath(), args, { cwd, timeoutMs });
}

/**
 * Fetch one of our own files to disk, capped in size. `what` names it in the
 * customer's message ("คลิปบางช็อต" / "some shot clips", "เพลง" / "the song").
 */
export async function download(url: string, dest: string, maxBytes: number, what: Msg): Promise<void> {
  if (!keyFromPublicUrl(url)) {
    throw new StoryJobError({ th: `${what.th}ไม่ได้อยู่ในคลังของเรา สร้างหรืออัปโหลดใหม่`, en: `Couldn't find ${what.en} in our storage. Please create or upload again.` });
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!res?.ok || !res.body) throw new StoryJobError({ th: `ดาวน์โหลด${what.th}ไม่ได้ ลองใหม่อีกครั้ง`, en: `Couldn't download ${what.en}. Please try again.` });
  const tooBig = { th: `${what.th}ใหญ่เกินไป`, en: `Too large to process: ${what.en}.` };
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new StoryJobError(tooBig);
  let total = 0;
  const limited = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBytes) limited.destroy(new StoryJobError(tooBig));
  });
  await pipeline(limited, createWriteStream(dest));
}

export async function hasAudio(file: string, cwd: string): Promise<boolean> {
  // `ffmpeg -i` with no output exits 1 but prints the streams.
  const out = await runFfmpeg(['-hide_banner', '-i', file, '-f', 'null', '-t', '0', '-'], cwd, 30_000).catch((e: Error) => e.message);
  return /Stream #\d+:\d+.*Audio:/.test(out);
}

let chain: Promise<void> = Promise.resolve();

/** Queue a CPU-heavy job behind the others. The job handles its own failure. */
export function enqueueJob(job: () => Promise<void>): void {
  chain = chain.then(job).catch((e) => console.error('[story] queued job threw:', e));
}
