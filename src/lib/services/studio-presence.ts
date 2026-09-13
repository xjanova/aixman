import prisma from '@/lib/db';
import { PREWARM_DEMAND_PREFIX } from '@/lib/settings-catalog';

/**
 * "Someone is on the studio with this model selected."
 *
 * A rented machine boots in ~2 min, so the idle timeout can be short — but the
 * customer who watches a clip and orders again a few minutes later would pay
 * for that saving with a fresh boot. The studio pings while it is visible; the
 * idle reaper then grants up to `presenceExtensionMinutes` past the idle
 * timeout, and only while pings keep coming. The grace never starts a machine
 * and never extends one past that bound, so a tab left open costs at most a
 * few minutes of one card. (Pre-warming, below, can start one — on arrival
 * only.)
 *
 * Kept in `ai_settings`, not a module-level Map: the reaper runs from the
 * scheduler that `instrumentation.ts` starts, which Next bundles separately
 * from route handlers — the two would each see their own Map.
 */

const GROUP = 'gpu_presence';
const keyFor = (modelKey: string) => `gpu_presence_${modelKey}`;

/** The studio pings every 30 s; older than this means the customer left. */
export const PRESENCE_FRESH_MS = 75_000;

/** Many open tabs must not mean many writes: at most one per model per 20 s. */
const WRITE_EVERY_MS = 20_000;

const store = globalThis as unknown as {
  __studioPresenceWrites?: Map<string, number>;
  __studioVisits?: Map<string, { since: number; last: number }>;
  __prewarmWrites?: Map<string, number>;
};
const lastWrites = (store.__studioPresenceWrites ??= new Map<string, number>());

export async function touchStudioPresence(modelKey: string, now = Date.now()): Promise<void> {
  if (now - (lastWrites.get(modelKey) ?? 0) < WRITE_EVERY_MS) return;
  lastWrites.set(modelKey, now);
  await prisma.aiSetting.upsert({
    where: { key: keyFor(modelKey) },
    update: { value: String(now) },
    create: { key: keyFor(modelKey), value: String(now), type: 'number', group: GROUP },
  });
}

export async function isStudioPresent(modelKey: string, now = Date.now()): Promise<boolean> {
  const row = await prisma.aiSetting.findUnique({ where: { key: keyFor(modelKey) } });
  const seen = Number(row?.value);
  return Number.isFinite(seen) && seen > 0 && now - seen < PRESENCE_FRESH_MS;
}

/*
 * Pre-warming: "a customer who can pay just arrived on this model."
 *
 * The one wait a customer still sees in full is the first order on a model
 * with no machine: rent, boot, download — minutes before the render starts.
 * Most of that fits in the time they spend writing a prompt, if the machine is
 * rented when they arrive instead of when they press the button. The queue's
 * tick does the renting (GpuQueue.prewarm), with its own guards; this only
 * records that the moment has come.
 *
 * Arrival, not presence: a tab left open all afternoon must not keep asking
 * for machines. A visit starts at the first ping after a gap and asks for a
 * machine only during its first few minutes.
 */

const PREWARM_GROUP = 'gpu_prewarm';
const PREWARM_PREFIX = PREWARM_DEMAND_PREFIX;

/**
 * How long a customer must stay on a model before it counts. The studio picks
 * each tab's featured model by itself and pings the moment the selection
 * changes, so someone clicking through tabs and models would otherwise ask for
 * a machine for every one of them. The studio's next ping comes 30 s later.
 */
export const PREWARM_DWELL_MS = 25_000;

/** How long after arriving a visit still asks for a machine. */
export const PREWARM_ARRIVAL_MS = 3 * 60_000;

const visits = (store.__studioVisits ??= new Map());
const demandWrites = (store.__prewarmWrites ??= new Map());

/**
 * Record a ping in this user's visit to the model; true once the visit has
 * lasted `PREWARM_DWELL_MS` and until it is `PREWARM_ARRIVAL_MS` old. A gap
 * longer than the presence window ends a visit, so coming back later counts
 * as arriving again.
 *
 * In memory: only the presence route calls it, and a restart merely makes a
 * visit look new — which the tick's guards absorb.
 */
export function isArrival(userId: number, modelKey: string, now = Date.now()): boolean {
  const id = `${userId}:${modelKey}`;
  const visit = visits.get(id);
  if (!visit || now - visit.last > PRESENCE_FRESH_MS) {
    if (visits.size > 5_000) visits.clear();
    visits.set(id, { since: now, last: now });
    return false;
  }
  visit.last = now;
  const age = now - visit.since;
  return age >= PREWARM_DWELL_MS && age <= PREWARM_ARRIVAL_MS;
}

export async function notePrewarmDemand(modelKey: string, now = Date.now()): Promise<void> {
  if (now - (demandWrites.get(modelKey) ?? 0) < WRITE_EVERY_MS) return;
  demandWrites.set(modelKey, now);
  const key = `${PREWARM_PREFIX}${modelKey}`;
  await prisma.aiSetting.upsert({
    where: { key },
    update: { value: String(now) },
    create: { key, value: String(now), type: 'number', group: PREWARM_GROUP },
  });
}

/** Models a paying customer arrived on within the presence window. */
export async function prewarmDemand(now = Date.now()): Promise<string[]> {
  const rows = await prisma.aiSetting.findMany({ where: { group: PREWARM_GROUP } });
  return rows
    .filter((r) => r.key.startsWith(PREWARM_PREFIX))
    .filter((r) => {
      const at = Number(r.value);
      return Number.isFinite(at) && at > 0 && now - at < PRESENCE_FRESH_MS;
    })
    .map((r) => r.key.slice(PREWARM_PREFIX.length));
}
