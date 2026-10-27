import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { COMMUNITY_PROVIDER_SLUGS } from '@/lib/gpu/community-dispatch';
import { failureChance, machineKeyOfRow } from '@/lib/gpu/host-record';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';

/**
 * Admin → GPU → ประวัติรายเครื่อง: every machine rented in the last 30 days
 * with what it really did (host-record.ts), and the latest work plan per
 * model (gpu-scaler.ts planBacklog). Read-only.
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [records, rentals] = await Promise.all([
    GpuWorkerManager.hostRecords(),
    prisma.aiGpuWorker.findMany({
      where: {
        providerSlug: { notIn: [...COMMUNITY_PROVIDER_SLUGS] },
        rentedAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      orderBy: { rentedAt: 'desc' },
      select: { providerSlug: true, gpuModel: true, modelKey: true, pricePerHourUsd: true, jobsCompleted: true, metadata: true },
    }),
  ]);

  // What the record does not keep: the card, the latest price, the models served.
  const extra = new Map<string, { provider: string; gpuModel: string | null; priceUsd: number; jobs: number; models: Set<string> }>();
  for (const r of rentals) {
    const key = machineKeyOfRow(r.providerSlug, r.metadata);
    if (!key) continue;
    const e = extra.get(key) ?? { provider: r.providerSlug, gpuModel: r.gpuModel, priceUsd: Number(r.pricePerHourUsd), jobs: 0, models: new Set<string>() };
    e.jobs += r.jobsCompleted;
    e.models.add(r.modelKey);
    extra.set(key, e);
  }

  const machines = [...records.values()]
    .map((r) => {
      const e = extra.get(r.machineKey);
      return {
        machineKey: r.machineKey,
        provider: e?.provider ?? r.machineKey.split(':')[0],
        gpuModel: e?.gpuModel ?? null,
        priceUsdPerHour: e ? Number(e.priceUsd.toFixed(3)) : null,
        rentals: r.judged,
        failures: r.failures,
        failureChance: Number(failureChance(r).toFixed(3)),
        downloadMbps: r.downloadMbps === null ? null : Math.round(r.downloadMbps),
        jobsCompleted: e?.jobs ?? 0,
        models: e ? [...e.models] : [],
        lastFailure: r.lastFailure,
        lastRentedAt: r.lastRentedAt,
      };
    })
    .sort((a, b) => (b.lastRentedAt?.getTime() ?? 0) - (a.lastRentedAt?.getTime() ?? 0))
    .slice(0, 150);

  return NextResponse.json({ machines, plans: GpuWorkerManager.latestPlans() });
}
