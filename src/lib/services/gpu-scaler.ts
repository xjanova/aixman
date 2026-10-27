/**
 * When is one more rented machine worth it, and which slot does it get?
 *
 * Total render time is the same however many machines share a queue; what an
 * extra machine adds is its boot and its idle tail, and what it saves is the
 * customers' waiting. planBacklog (below) plays the backlog out on the
 * machines a model has and on more, and rents when finishing sooner is worth
 * the boot. It replaced the rule of thumb `queued / machines > 1 + boot/render`,
 * which ignored what the machine cost, how long customers had already been
 * promised, and that machines still booting are not free yet.
 *
 * Machines still booting count as capacity from when they are due up, so a
 * burst of twenty jobs rents one machine per tick up to the cap, instead of
 * waiting for each to come up before deciding on the next. Pure, so the rules
 * can be read and tested without a database.
 */

/**
 * A model with no machine at all waits for a free slot. At the worker cap
 * that slot only comes from an *idle* machine of another model — and a model
 * with a long backlog never has one: the fast lane hands each machine its
 * next job within seconds. On 2026-10-27 a 60-shot film held all three slots
 * and a song ordered behind it could only wait for the whole film or its
 * refund.
 *
 * So once the starved model has waited this long, one machine of a model
 * that has at least two takes no new job and gives its slot up when its
 * current one ends. The other model keeps rendering on the rest.
 */
export const STARVE_HANDOVER_MS = 10 * 60_000;

export interface HandoverCandidate {
  id: number;
  modelKey: string;
  /** When its current job started; null = between jobs. */
  busySince: Date | null;
}

/** The machine to hand over, or null: idle first, then the one nearest the end of its job. */
export function pickHandover(wanted: string, waitedMs: number, machines: HandoverCandidate[]): number | null {
  if (waitedMs < STARVE_HANDOVER_MS) return null;
  const perModel = new Map<string, number>();
  for (const m of machines) perModel.set(m.modelKey, (perModel.get(m.modelKey) ?? 0) + 1);
  const eligible = machines
    .filter((m) => m.modelKey !== wanted && (perModel.get(m.modelKey) ?? 0) >= 2)
    .sort((a, b) => (a.busySince?.getTime() ?? 0) - (b.busySince?.getTime() ?? 0));
  return eligible[0]?.id ?? null;
}

/** The model a machine is handing its slot over to (`metadata.handOverTo`), or null. */
export function readHandover(metadata: unknown): string | null {
  const to = (metadata as { handOverTo?: { modelKey?: unknown } } | null)?.handOverTo?.modelKey;
  return typeof to === 'string' && to !== '' ? to : null;
}

/**
 * The work plan: how many more machines this backlog is worth, decided by
 * playing the queue out rather than by a rule of thumb.
 *
 * Every option (0, 1, 2 … more machines) is simulated job by job — each job
 * goes to whichever machine is free first, a new machine only once booted —
 * giving when the backlog finishes and how long customers wait in total.
 * Rendering costs the same whichever machine does it, so an extra machine's
 * cost is its boot, download fee and idle tail (addedMachineUsd) — four
 * machines that finish sooner for about what one costs are worth renting,
 * four that each pay a 40 GB download are not. The wait is priced at
 * `gpu_wait_value_usd_per_hour`, the same exchange rate the offer picker uses.
 * The cheapest option wins, fewer machines on a tie.
 */
export interface BacklogPlanInput {
  queued: number;
  /** Seconds until each machine already serving the model can start a job: 0 idle, the rest of a render, or of a boot. */
  machinesFreeIn: number[];
  /** Render seconds of one waiting job. */
  renderSeconds: number;
  /** Seconds from renting a new machine to it taking a job. */
  bootSeconds: number;
  /** What a new machine costs per hour. */
  hourlyUsd: number;
  /** What a new machine pays the vendor to download its weights (Vast's per-GB fee). */
  ingressUsd?: number;
  /** Chance a new machine never comes up — its boot and download are paid for nothing. */
  bootFailureChance?: number;
  /** How long an extra machine idles after the backlog before it closes. */
  idleTailSeconds: number;
  waitValueUsdPerHour: number;
  /** Most machines that could be added (free slots). */
  maxAdd: number;
}

export interface BacklogPlanOption {
  add: number;
  /** When the last waiting job is done, seconds from now. */
  finishSeconds: number;
  /** Customers' total wait until their job is done, in seconds. */
  waitSeconds: number;
  /** What the added machines cost beyond the rendering itself. */
  extraCostUsd: number;
  scoreUsd: number;
}

export interface BacklogPlan {
  best: BacklogPlanOption;
  options: BacklogPlanOption[];
  /** One line for the tick report and the admin page. */
  summary: string;
}

/** Play `queued` jobs out on machines free at the given times. */
export function playQueue(freeIn: number[], queued: number, renderSeconds: number): { finish: number; wait: number } {
  if (queued <= 0) return { finish: 0, wait: 0 };
  if (freeIn.length === 0) return { finish: Infinity, wait: Infinity };
  const free = freeIn.map((t) => Math.max(0, t));
  const render = Math.max(1, renderSeconds);
  let finish = 0;
  let wait = 0;
  for (let job = 0; job < queued; job++) {
    let next = 0;
    for (let i = 1; i < free.length; i++) if (free[i] < free[next]) next = i;
    const done = free[next] + render;
    free[next] = done;
    wait += done;
    finish = Math.max(finish, done);
  }
  return { finish, wait };
}

/**
 * What one added machine costs beyond the rendering it does: its boot and its
 * download fee — paid again for every boot that fails, so divided by the
 * chance of success — and its idle tail once the backlog is done. Without
 * the fee and the failures the plan thought an LTX machine cost ~$0.10 more
 * when a Vast host pulling 40 GB charged that again in download alone.
 */
export function addedMachineUsd(input: Pick<BacklogPlanInput, 'hourlyUsd' | 'bootSeconds' | 'idleTailSeconds' | 'ingressUsd' | 'bootFailureChance'>): number {
  const hourly = Math.max(0, input.hourlyUsd);
  const boot = (hourly * Math.max(0, input.bootSeconds)) / 3600 + Math.max(0, input.ingressUsd ?? 0);
  const success = 1 - Math.min(0.9, Math.max(0, input.bootFailureChance ?? 0));
  return boot / success + (hourly * Math.max(0, input.idleTailSeconds)) / 3600;
}

export function planBacklog(input: BacklogPlanInput): BacklogPlan {
  const options: BacklogPlanOption[] = [];
  const perMachineUsd = addedMachineUsd(input);
  for (let add = 0; add <= Math.max(0, input.maxAdd); add++) {
    const free = [...input.machinesFreeIn, ...Array<number>(add).fill(Math.max(0, input.bootSeconds))];
    const { finish, wait } = playQueue(free, input.queued, input.renderSeconds);
    const extraCostUsd = add * perMachineUsd;
    const scoreUsd = extraCostUsd + (Math.max(0, input.waitValueUsdPerHour) * wait) / 3600;
    options.push({ add, finishSeconds: finish, waitSeconds: wait, extraCostUsd, scoreUsd });
  }
  const best = options.reduce((a, b) => (b.scoreUsd < a.scoreUsd - 1e-9 ? b : a));
  const minutes = (s: number) => (Number.isFinite(s) ? `~${Math.max(1, Math.round(s / 60))} min` : 'never');
  const now = options[0];
  const summary =
    input.queued <= 0
      ? 'Nothing waiting'
      : best.add === 0
        ? `Plan: ${input.queued} waiting on ${input.machinesFreeIn.length} machine(s) finish in ${minutes(now.finishSeconds)} — another machine would not pay for itself`
        : `Plan: ${input.queued} waiting — +${best.add} machine(s) finish in ${minutes(best.finishSeconds)} ` +
          `instead of ${minutes(now.finishSeconds)} for +$${best.extraCostUsd.toFixed(2)}`;
  return { best, options, summary };
}
