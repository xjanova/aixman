/**
 * When is one more rented machine worth it?
 *
 * Total render time is the same however many machines share a queue; what an
 * extra machine adds is its boot and its idle tail (~$0.035 on an A100 with a
 * 2-minute idle timeout). So the question is only whether it would finish the
 * backlog sooner than the machines already serving it. A new machine is useful
 * after it boots; until then the existing ones keep rendering. It pays off
 * when the backlog per machine outlasts one boot plus one render:
 *
 *   queued / machines  >  (boot + render) / render
 *
 * With history from 2026-09-12 (boot ≈ 132 s): MiniMax H3 (~90 s a clip)
 * scales out at 3+ waiting per machine; Qwen-Image (~30 s) at 6+.
 *
 * Machines still booting count as capacity — they are already paid for and on
 * their way — so a burst of twenty jobs rents one machine per tick up to the
 * cap, instead of waiting for each to come up before deciding on the next.
 * Pure, so the rule can be read and tested without a database.
 */

export interface ScaleInput {
  /** Jobs for this model still waiting for a machine. */
  queued: number;
  /** Machines for this model that are up or on their way. */
  machines: number;
  /** Typical render seconds for one job of this model. */
  renderSeconds: number;
  /** Typical seconds from renting a machine to it being ready. */
  bootSeconds: number;
}

export interface ScaleDecision {
  add: boolean;
  /** Admin-facing, for the tick report and logs. */
  reason: string;
}

export function shouldAddMachine({ queued, machines, renderSeconds, bootSeconds }: ScaleInput): ScaleDecision {
  if (queued <= 0) return { add: false, reason: 'Nothing waiting' };
  if (machines <= 0) return { add: true, reason: 'No machine for this model yet' };

  const render = Math.max(1, renderSeconds);
  const perMachine = queued / machines;
  const threshold = 1 + Math.max(0, bootSeconds) / render;
  if (perMachine > threshold) {
    return {
      add: true,
      reason: `${queued} waiting on ${machines} machine(s) — more than ${threshold.toFixed(1)} each, a new one finishes sooner`,
    };
  }
  return {
    add: false,
    reason: `${queued} waiting on ${machines} machine(s) — within ${threshold.toFixed(1)} each, no new machine needed`,
  };
}

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
