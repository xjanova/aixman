import prisma from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { deleteObjects, keyFromPublicUrl, isStorageConfigured } from '@/lib/storage/r2';

/**
 * Media retention.
 *
 * Generated media is kept for a fixed window and then removed from storage.
 * Two things make this worth doing carefully:
 *
 *  - Storage grows without bound otherwise, and video is expensive to keep.
 *  - A customer who is not told the window will lose work they assumed was
 *    permanent. So the expiry is stamped on the row at completion time and
 *    surfaced everywhere the media is shown, rather than being an implicit
 *    policy enforced by a background job.
 *
 * The generation row itself is never deleted — history, credits and cost
 * accounting stay intact. Only the stored bytes go.
 */

const DEFAULT_RETENTION_DAYS = 30;
const SETTING_KEY = 'media_retention_days';

/**
 * Keys inside a generation's `params` that hold a URL to an object we stored.
 *
 * These ride in params rather than in columns of their own so that adding
 * lip-sync did not require a migration on a table Laravel also reads. The cost
 * is that the sweep has to know their names — so they are listed here once, and
 * anything added to `/api/uploads` must be added here too or it leaks.
 */
const INPUT_URL_PARAMS = ['inputAudio', 'inputVideo'] as const;

export interface SweepResult {
  scanned: number;
  generations: number;
  objectsDeleted: number;
  objectsFailed: number;
}

export class RetentionService {
  /** Retention window in days. 0 or unset means "keep indefinitely". */
  static async getRetentionDays(): Promise<number> {
    const row = await prisma.aiSetting.findUnique({ where: { key: SETTING_KEY } });
    const raw = Number(row?.value);
    if (!Number.isFinite(raw) || raw < 0) return DEFAULT_RETENTION_DAYS;
    return Math.floor(raw);
  }

  static expiryFor(from: Date, days: number): Date | null {
    if (days <= 0) return null; // keep forever
    return new Date(from.getTime() + days * 86_400_000);
  }

  /**
   * Stamp the expiry on a generation that just completed.
   *
   * Called from the completion paths rather than computed on read, so the
   * customer's window is fixed at the moment they got the file — changing the
   * setting later cannot retroactively shorten what someone was already
   * promised.
   */
  static async stampExpiry(generationId: number, completedAt: Date = new Date()): Promise<void> {
    const days = await this.getRetentionDays();
    const expiresAt = this.expiryFor(completedAt, days);
    if (!expiresAt) return;

    await prisma.aiGeneration.updateMany({
      // Never move an expiry that already exists.
      where: { id: generationId, expiresAt: null },
      data: { expiresAt },
    });
  }

  /**
   * Delete media whose window has passed.
   *
   * Bounded per run so a large backlog is worked through over several ticks
   * instead of one very long request that risks timing out mid-delete.
   */
  static async sweep(limit = 200): Promise<SweepResult> {
    const result: SweepResult = { scanned: 0, generations: 0, objectsDeleted: 0, objectsFailed: 0 };

    const due = await prisma.aiGeneration.findMany({
      where: {
        expiresAt: { not: null, lt: new Date() },
        mediaDeletedAt: null,
      },
      select: {
        id: true,
        resultUrl: true,
        resultUrls: true,
        thumbnailUrl: true,
        // Inputs count too. A lip-sync job is driven by a voice track and often
        // a clip the customer uploaded, both of which sit in our bucket under
        // `uploads/`. Sweeping only the outputs would leave those behind
        // forever — the generation row is the sole record that they exist, so
        // once it is marked deleted nothing else could ever find them.
        inputImage: true,
        params: true,
      },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });

    result.scanned = due.length;
    if (due.length === 0) return result;

    const keys: string[] = [];
    for (const gen of due) {
      const urls: string[] = [];
      if (gen.resultUrl) urls.push(gen.resultUrl);
      if (gen.thumbnailUrl) urls.push(gen.thumbnailUrl);
      if (Array.isArray(gen.resultUrls)) {
        for (const u of gen.resultUrls) if (typeof u === 'string') urls.push(u);
      }
      // `inputImage` predates uploads and is usually a base64 data URL, and a
      // params value can be anything the client sent. Both are handed to
      // `keyFromPublicUrl` unchecked because it already answers null for
      // everything that is not one of our own object URLs.
      if (gen.inputImage) urls.push(gen.inputImage);
      for (const field of INPUT_URL_PARAMS) {
        const value = (gen.params as Record<string, unknown> | null)?.[field];
        if (typeof value === 'string') urls.push(value);
      }
      for (const url of urls) {
        const key = keyFromPublicUrl(url);
        // Anything not in our bucket (a provider URL kept from before R2 was
        // configured) has nothing for us to delete — the row is still cleared.
        if (key) keys.push(key);
      }
    }

    if (isStorageConfigured() && keys.length > 0) {
      const { deleted, failed } = await deleteObjects([...new Set(keys)]);
      result.objectsDeleted = deleted;
      result.objectsFailed = failed;
    }

    // Clear the URLs regardless of whether the object delete succeeded: a URL
    // pointing at a deleted object is worse than an honest "expired" state, and
    // leaving the rows unmarked would retry the same batch forever.
    const now = new Date();
    await prisma.aiGeneration.updateMany({
      where: { id: { in: due.map((g) => g.id) } },
      data: {
        mediaDeletedAt: now,
        resultUrl: null,
        resultUrls: undefined,
        thumbnailUrl: null,
        inputImage: null,
      },
    });
    result.generations = due.length;

    // `params` is JSON, so the upload URLs inside it cannot be cleared by the
    // bulk update above. Only rows that actually carry one are touched, which
    // in practice means lip-sync jobs rather than the whole batch. The rest of
    // params — size, seed, duration — is preserved: the customer can still see
    // what they asked for after the media itself is gone.
    for (const gen of due) {
      const params = gen.params as Record<string, unknown> | null;
      if (!params || !INPUT_URL_PARAMS.some((f) => typeof params[f] === 'string')) continue;

      const stripped = { ...params };
      for (const field of INPUT_URL_PARAMS) delete stripped[field];

      await prisma.aiGeneration.update({
        where: { id: gen.id },
        data: { params: stripped as Prisma.InputJsonValue },
      });
    }

    return result;
  }

  /**
   * Backfill expiries for completed generations that predate this feature, so
   * nothing sits without a stated window.
   */
  static async backfill(limit = 1000): Promise<number> {
    const days = await this.getRetentionDays();
    if (days <= 0) return 0;

    const rows = await prisma.aiGeneration.findMany({
      where: { status: 'completed', expiresAt: null, mediaDeletedAt: null },
      select: { id: true, createdAt: true },
      take: limit,
    });

    for (const row of rows) {
      await prisma.aiGeneration.update({
        where: { id: row.id },
        data: { expiresAt: this.expiryFor(row.createdAt, days) },
      });
    }
    return rows.length;
  }
}

/** Days left before media is removed. Negative means already past due. */
export function daysUntil(expiresAt: Date | null | undefined): number | null {
  if (!expiresAt) return null;
  return Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
}

// --------------------------------------------------------------------
// Self-scheduling
// --------------------------------------------------------------------

/** Hourly is ample — the window is measured in days. */
const SWEEP_INTERVAL_MS = 60 * 60_000;
const STARTUP_DELAY_MS = 90_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Sweep on the app's own schedule, so retention works without the operator
 * remembering a crontab. `/api/cron/retention` stays available for external
 * scheduling and for on-demand backfills.
 */
export function startRetentionScheduler(): void {
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await RetentionService.sweep();
      if (result.generations > 0) {
        console.log(
          `[retention] removed media for ${result.generations} generations ` +
            `(${result.objectsDeleted} objects, ${result.objectsFailed} failed)`
        );
      }
    } catch (error) {
      // Never throw out of a timer — an unhandled rejection would take the
      // process down over a storage hiccup.
      console.error('[retention] scheduled sweep failed:', (error as Error).message);
    } finally {
      running = false;
    }
  };

  const begin = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), SWEEP_INTERVAL_MS);
    timer.unref?.();
  }, STARTUP_DELAY_MS);
  begin.unref?.();

  console.log('[retention] scheduler started (sweep hourly)');
}
