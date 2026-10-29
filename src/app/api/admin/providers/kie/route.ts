import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';
import { KieProvider } from '@/lib/providers/kie';
import { KIE_CATALOG } from '@/lib/providers/kie-catalog';
import { ensureKieProvider, syncKieModels } from '@/lib/providers/kie-sync';

/**
 * Admin → ผู้ให้บริการ → KIE.ai: one key, every KIE model.
 *
 *   GET                         — what is set up: keys (never their values), rows, readiness.
 *   POST {action:'save-key'}    — check the key against KIE (`/api/v1/chat/credit`, free),
 *                                 store it encrypted in the account pool, sync the models.
 *   POST {action:'test'}        — the balance on the first usable key.
 *   POST {action:'sync'}        — rewrite the rows and prices from the catalogue;
 *                                 `openNow` puts every row still `tuning` on sale.
 *
 * Nothing here spends KIE credits.
 */

const kie = new KieProvider();

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const provider = await prisma.aiProvider.findUnique({ where: { slug: 'kie' }, select: { id: true, isActive: true } });
  if (!provider) {
    return NextResponse.json({ provider: null, keys: [], models: { total: 0, ready: 0, tuning: 0 }, catalog: KIE_CATALOG.length });
  }
  const [keys, models] = await Promise.all([
    prisma.aiAccountPool.findMany({
      where: { providerId: provider.id },
      select: { id: true, label: true, isActive: true, consecutiveErrors: true, lastError: true, cooldownUntil: true, usageToday: true },
      orderBy: { priority: 'desc' },
    }),
    prisma.aiModel.groupBy({ by: ['readiness'], where: { providerId: provider.id, isActive: true }, _count: true }),
  ]);
  const count = (r: string) => models.find((m) => m.readiness === r)?._count ?? 0;
  return NextResponse.json({
    provider,
    keys,
    models: { total: models.reduce((s, m) => s + m._count, 0), ready: count('ready'), tuning: count('tuning') },
    catalog: KIE_CATALOG.length,
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    apiKey?: unknown;
    label?: unknown;
    openNow?: unknown;
    markup?: unknown;
  };
  const markup = Number(body.markup);
  const syncOpts = {
    openNow: body.openNow === true,
    // Bounded: a typo must not sell at a loss or at ten times the price.
    markup: Number.isFinite(markup) && markup >= 1.2 && markup <= 5 ? markup : undefined,
  };

  try {
    if (body.action === 'save-key') {
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!/^[A-Za-z0-9_-]{16,200}$/.test(apiKey)) {
        return NextResponse.json({ error: 'คีย์ไม่ถูกรูปแบบ — คัดลอกจาก kie.ai/api-key ทั้งบรรทัด' }, { status: 422 });
      }
      const check = await kie.credits(apiKey);
      if (!check.ok) return NextResponse.json({ error: `KIE ไม่รับคีย์นี้ (${check.error})` }, { status: 422 });

      const provider = await ensureKieProvider();
      // The same key pasted again replaces nothing and adds nothing.
      const existing = await prisma.aiAccountPool.findMany({ where: { providerId: provider.id }, select: { id: true, apiKey: true } });
      const duplicate = existing.find((a) => {
        try {
          return decrypt(a.apiKey) === apiKey;
        } catch {
          return false;
        }
      });
      if (!duplicate) {
        await prisma.aiAccountPool.create({
          data: {
            providerId: provider.id,
            label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 100) : 'KIE.ai',
            apiKey: encrypt(apiKey),
            priority: 50,
            rotationMode: 'balanced',
            // KIE's own limit is 20 creates per 10 s; the pool's request quota
            // (1,000 a day by default) would stop the whole provider instead.
            rateLimitPerMinute: 120,
            dailyQuota: 0,
            monthlyQuota: 0,
            isActive: true,
          },
        });
      } else {
        // A key that had been switched off or errored out is good again.
        await prisma.aiAccountPool.update({
          where: { id: duplicate.id },
          data: { isActive: true, consecutiveErrors: 0, cooldownUntil: null, lastError: null },
        });
      }
      const sync = await syncKieModels(syncOpts);
      return NextResponse.json({ ok: true, credits: check.credits, added: !duplicate, sync });
    }

    if (body.action === 'test') {
      const provider = await prisma.aiProvider.findUnique({ where: { slug: 'kie' }, select: { id: true } });
      const account = provider
        ? await prisma.aiAccountPool.findFirst({ where: { providerId: provider.id, isActive: true }, orderBy: { priority: 'desc' } })
        : null;
      if (!account) return NextResponse.json({ error: 'ยังไม่มีคีย์ KIE ที่เปิดใช้งาน' }, { status: 404 });
      const check = await kie.credits(decrypt(account.apiKey));
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 502 });
      return NextResponse.json({ ok: true, credits: check.credits, usd: Math.round(check.credits * 0.005 * 100) / 100 });
    }

    if (body.action === 'sync') {
      return NextResponse.json({ ok: true, sync: await syncKieModels(syncOpts) });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[admin/kie] failed:', (error as Error).message);
    return NextResponse.json({ error: 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
