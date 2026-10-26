import prisma from '@/lib/db';
import type { GpuBudgetConfig } from '@/lib/gpu/config';
import { LLM_CATALOG } from '@/lib/gpu/llm-catalog';
import { getDemand, getFleetConfig, getPolicies, wantedMachines } from '@/lib/gpu/llm-policy';
import { LLM_CATEGORY, parseLlmConfig } from '@/lib/llm/pricing';
import { raiseAlert } from '@/lib/notify/alerts';
import { GpuWorkerManager } from './gpu-worker';

/**
 * Rents API machines (vLLM) to what each model's uptime policy and its recent
 * demand ask for. Runs inside the GPU tick, under its lease; releasing is the
 * reconcile pass's job (GpuWorkerManager.reapLlmIfDone).
 *
 * A model is only kept up while it is on sale: an active `text` row whose
 * backend is `gpu` and whose upstream id is the catalogue key. Turning the row
 * off is enough to stop renting for it.
 */

const LIVE = ['provisioning', 'warming', 'ready', 'busy'];

/** Catalogue keys with an active row selling them. */
export async function modelsOnSale(): Promise<Set<string>> {
  const rows = await prisma.aiModel.findMany({
    where: { category: LLM_CATEGORY, isActive: true },
    select: { defaultParams: true },
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const cfg = parseLlmConfig(row.defaultParams);
    if (cfg.backend === 'gpu' && cfg.upstreamModel) keys.add(cfg.upstreamModel);
  }
  return keys;
}

export class LlmFleet {
  static async tick(cfg: GpuBudgetConfig): Promise<string[]> {
    if (!cfg.enabled) return [];
    const [policies, demand, fleet, onSale] = await Promise.all([getPolicies(), getDemand(), getFleetConfig(), modelsOnSale()]);
    const notes: string[] = [];
    const now = new Date();
    await this.watchBudget(fleet.dailyBudgetUsd, now);
    for (const entry of LLM_CATALOG) {
      const policy = policies[entry.key];
      if (!policy || policy.mode === 'off' || !onSale.has(entry.key)) continue;
      const live = await prisma.aiGpuWorker.count({
        where: { modelKey: entry.key, status: { in: LIVE }, terminatedAt: null },
      });
      const wanted = wantedMachines(policy, now, demand[entry.key], live);
      if (live >= wanted) continue;
      try {
        const result = await GpuWorkerManager.addCapacity(
          entry.key,
          { ...cfg, maxPricePerHourUsd: fleet.maxPricePerHourUsd },
          { queued: wanted - live, oldestQueuedAt: null },
          { llm: { maxWorkers: fleet.maxWorkers, dailyBudgetUsd: fleet.dailyBudgetUsd } }
        );
        notes.push(`${entry.key}: ${result.reason}`);
      } catch (error) {
        // Configuration (no vendor key at all): nothing to refund, say it and move on.
        notes.push(`${entry.key}: ${(error as Error).message}`);
      }
    }
    if (notes.length > 0) console.log(`[llm] fleet: ${notes.join(' · ')}`.slice(0, 1000));
    return notes;
  }

  /** Once a day per level: 80% of the API machines' budget, then all of it. */
  private static async watchBudget(budgetUsd: number, now: Date): Promise<void> {
    if (budgetUsd <= 0) return;
    const spent = await GpuWorkerManager.todaySpendUsd('llm');
    const used = spent / budgetUsd;
    if (used < 0.8) return;
    const full = used >= 1;
    raiseAlert({
      type: 'llm-budget',
      key: `${full ? 100 : 80}:${now.toDateString()}`,
      level: 'warning',
      title: full
        ? 'งบเครื่อง GPU ของ API โมเดลภาษาวันนี้หมดแล้ว — ปิดเครื่อง API และไม่เช่าใหม่จนขึ้นวันใหม่'
        : `งบเครื่อง GPU ของ API โมเดลภาษาวันนี้ใช้ไปแล้ว ${Math.round(used * 100)}%`,
      lines: [`ใช้ไป $${spent.toFixed(2)} จากงบ $${budgetUsd.toFixed(2)}`, 'ปรับงบได้ที่หน้า API โมเดลภาษา → รันเองบน GPU'],
      cooldownMs: 24 * 3_600_000,
      path: '/admin/llm',
    });
  }
}
