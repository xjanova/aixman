/**
 * When a booting machine is a broken host rather than a slow one.
 *
 * The flat warmup timeout (gpu_warmup_timeout_minutes, 60) is sized for 40 GB
 * of weights on a slow uplink. On 2026-10-27 an ACE-Step machine — a boot the
 * picker priced at 3 minutes — sat silent for that whole hour: it billed, the
 * scaler counted it as a machine on its way so nothing replaced it, and the
 * song order behind it was refunded after 90 minutes.
 *
 * So a boot is judged against its own estimate and its own progress:
 * - past max(15 min, 3 × the estimate) with nothing moving for a while → stalled;
 * - downloading at a rate that cannot finish inside the warmup limit → doomed,
 *   replaced now instead of at the limit.
 * A boot that keeps moving is left alone up to the flat limit. Pure, so the
 * thresholds are pinned by tests (boot-watch.test.mts).
 */

/** Never judge a boot stalled sooner than this, however quick its estimate. */
export const BOOT_STALL_FLOOR_MS = 15 * 60_000;
/** Real boots finished within 4.3× their estimate (87–779 s, 2026-09…10). */
export const BOOT_STALL_FACTOR = 3;
/** Nothing moved for this long: installing, downloading or not answering. */
export const BOOT_QUIET_MS = 8 * 60_000;
/**
 * Every weight is on disk and the server is loading them into VRAM — vLLM
 * compiling a 27B model says nothing for minutes, so it gets longer.
 */
export const BOOT_STARTING_QUIET_MS = 15 * 60_000;
/** A download rate measured over less than this is noise, not a projection. */
export const BOOT_RATE_SAMPLE_MS = 4 * 60_000;

export interface BootProgress {
  /** What the machine last said about its boot (stage, vendor status). */
  mark: string;
  /** When the boot last moved: a new mark, or more bytes on disk. */
  at: number;
  /** Weight bytes on disk at the latest reading. */
  bytes?: number;
  /** When `bytes` last grew — with `firstBytes`/`firstAt`, the host's real download rate (host-record.ts). */
  bytesAt?: number;
  /** The first reading with bytes on disk, to measure the download rate from. */
  firstBytes?: number;
  firstAt?: number;
}

export interface BootReading {
  /** The proxy's stage ('downloading', 'starting'), or the vendor's status text. */
  mark: string;
  bytes?: number;
}

/** The record kept in `ai_gpu_workers.metadata.bootProgress`, or null. */
export function readBootProgress(metadata: unknown): BootProgress | null {
  const raw = (metadata as { bootProgress?: unknown } | null)?.bootProgress as Partial<BootProgress> | undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.mark !== 'string' || !Number.isFinite(raw.at)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    mark: raw.mark,
    at: raw.at as number,
    bytes: num(raw.bytes),
    bytesAt: num(raw.bytesAt),
    firstBytes: num(raw.firstBytes),
    firstAt: num(raw.firstAt),
  };
}

/**
 * Fold one tick's reading in. Bytes count as progress only when they grow, so
 * a download that froze reads as quiet even though it keeps reporting.
 * Returns `prev` itself when nothing changed (no write needed).
 */
export function noteBootProgress(prev: BootProgress | null, reading: BootReading, now: number): BootProgress {
  const bytes = typeof reading.bytes === 'number' && reading.bytes >= 0 ? reading.bytes : undefined;
  if (!prev) {
    return { mark: reading.mark, at: now, ...(bytes !== undefined ? { bytes, bytesAt: now, firstBytes: bytes, firstAt: now } : {}) };
  }
  const grew = bytes !== undefined && bytes > (prev.bytes ?? -1);
  const newMark = reading.mark !== prev.mark;
  if (!grew && !newMark) return prev;
  const first = prev.firstAt !== undefined ? {} : bytes !== undefined ? { firstBytes: bytes, firstAt: now } : {};
  return { ...prev, ...first, mark: reading.mark, at: now, ...(grew ? { bytes, bytesAt: now } : {}) };
}

/** How old a boot may get before going quiet counts against it. */
export function bootStallDeadlineMs(expectedBootSeconds: number, warmupTimeoutMs: number): number {
  const scaled = BOOT_STALL_FACTOR * Math.max(0, expectedBootSeconds) * 1000;
  return Math.min(warmupTimeoutMs, Math.max(BOOT_STALL_FLOOR_MS, scaled));
}

export type BootVerdict = { stalled: false } | { stalled: true; reason: string };

export function judgeBoot(input: {
  ageMs: number;
  now: number;
  /** The picker's estimate for this host, else the model's median boot. */
  expectedBootSeconds: number;
  warmupTimeoutMs: number;
  progress: BootProgress | null;
  /** Everything the boot must download; unknown → no projection. */
  totalBytes?: number;
}): BootVerdict {
  const { ageMs, now, progress, warmupTimeoutMs } = input;
  const minutes = (ms: number) => Math.round(ms / 60_000);

  const deadline = bootStallDeadlineMs(input.expectedBootSeconds, warmupTimeoutMs);
  if (ageMs > deadline) {
    // Never moved at all: quiet since it was rented.
    const quietMs = progress ? now - progress.at : ageMs;
    const allowed = progress?.mark === 'starting' ? BOOT_STARTING_QUIET_MS : BOOT_QUIET_MS;
    if (quietMs > allowed) {
      return {
        stalled: true,
        reason:
          `Boot stalled: no progress for ${minutes(quietMs)} min at ${minutes(ageMs)} min ` +
          `(expected ~${Math.max(1, Math.round(input.expectedBootSeconds / 60))} min; last: ${(progress?.mark ?? 'nothing').slice(0, 80)})`,
      };
    }
  }

  // A download that is moving, but too slowly to finish inside the limit,
  // ends the same way an hour later — replace it now.
  const total = input.totalBytes ?? 0;
  if (
    total > 0 &&
    progress?.bytes !== undefined &&
    progress.firstBytes !== undefined &&
    progress.firstAt !== undefined &&
    progress.bytes < total &&
    now - progress.firstAt >= BOOT_RATE_SAMPLE_MS
  ) {
    const rate = (progress.bytes - progress.firstBytes) / (now - progress.firstAt); // bytes per ms
    const finishAgeMs = rate > 0 ? ageMs + (total - progress.bytes) / rate : Infinity;
    if (finishAgeMs > warmupTimeoutMs) {
      const gb = (b: number) => (b / 1e9).toFixed(1);
      return {
        stalled: true,
        reason:
          `Download too slow: ${gb(progress.bytes)} of ${gb(total)} GB at ${(rate * 1000 / 1e6).toFixed(1)} MB/s ` +
          `would not finish within the ${minutes(warmupTimeoutMs)}-min warmup limit`,
      };
    }
  }
  return { stalled: false };
}

/**
 * A boot nobody needs any more. The plan rents for the backlog it sees; by
 * the time a machine has booted, the machines already up may have cleared it
 * (worker #86, 2026-10-27: rented for an MV's last 2 shots, still booting 15
 * minutes after they were done). Finishing that boot buys only idle time, so
 * it is cancelled — unless it was meant to wait: an admin's test rental, a
 * pre-warm, or the model's only machine while a customer is on its studio.
 * A job queued within the grace keeps it, so an order arriving as the last
 * one is taken does not cancel the machine it needs.
 */
export const UNNEEDED_BOOT_GRACE_MS = 2 * 60_000;

export function bootStillNeeded(input: {
  /** The model's jobs waiting for a machine. */
  waitingJobs: number;
  /** Since its newest job was queued; null when it has none. */
  lastQueuedAgoMs: number | null;
  /** The model's other live machines (booting, ready or busy). */
  otherMachines: number;
  studioPresent: boolean;
  /** Admin test rental or pre-warm: rented with nothing queued on purpose. */
  rentedToWait: boolean;
}): boolean {
  if (input.rentedToWait) return true;
  if (input.waitingJobs > 0) return true;
  if (input.lastQueuedAgoMs !== null && input.lastQueuedAgoMs < UNNEEDED_BOOT_GRACE_MS) return true;
  return input.studioPresent && input.otherMachines === 0;
}

/**
 * A boot failure that is the host's own, not the model's: no usable GPU, or
 * its network dropped a download (pip, Hugging Face). Another host will do
 * fine, so that host is avoided instead of every rental of the model being
 * paused — a pip ProtocolError on one A4000 held an ACE-Step order back ten
 * minutes on 2026-10-27.
 */
export const HOST_FAULT =
  /CUDA is unavailable|ProtocolError|IncompleteRead|Connection (?:broken|reset|aborted|refused)|ConnectionResetError|Read ?timed ?out|ReadTimeout|Temporary failure in name resolution|Could not resolve host|Name or service not known|Network is unreachable/i;

export function isHostFault(detail: string | null | undefined): boolean {
  return HOST_FAULT.test(detail ?? '');
}
