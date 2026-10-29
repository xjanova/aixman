import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';
import { KieProvider } from '@/lib/providers/kie';
import { getKieEntry, KIE_CATALOG } from '@/lib/providers/kie-catalog';
import { readKiePriceTable } from '@/lib/providers/kie-pricing';
import {
  FALLBACK_ENABLED_KEY,
  FALLBACK_MAP_KEY,
  cleanRefs,
  fallbackLoss,
  fallbackRefsFor,
  parseFallbackRef,
  readFallbackMap,
  whyNotFallback,
  type FallbackOrder,
} from '@/lib/providers/kie-fallback';
import { fallbackRowOf, loadFallbackSettings, type ModelWithProvider } from '@/lib/services/kie-route';
import { kieBasis } from '@/lib/providers/kie-sync';
import { accountBlock } from '@/lib/services/account-pool';
import { periodStarts } from '@/lib/llm/key-limits';

/**
 * Admin → KIE.ai (/admin/kie): the primary provider's own control room.
 *
 *   GET                                   keys (masked), the 402 state, today's and this month's
 *                                         spend per model, recent failures, the model list, and
 *                                         the fallback switch, map and log.
 *   POST {action:'balance'}               KIE's balance on the first usable key (free, read only).
 *   POST {action:'recheck', keyId}        that key's balance; when KIE answers with credit left,
 *                                         the key's errors and cooldown are cleared — it takes
 *                                         orders again at once (after a top-up).
 *   POST {action:'replace', keyId, apiKey} a new key for that row, checked first, stored encrypted.
 *   POST {action:'model', id, isActive}   a KIE row on or off.
 *   POST {action:'fallback', enabled}     the fallback switch.
 *   POST {action:'fallback-map', modelId, refs|null}  a model's fallback rows; null = the catalogue's.
 *
 * Adding a key and syncing rows stay on /api/admin/providers/kie. Nothing here spends KIE credits.
 */

const kie = new KieProvider();
const USD_PER_KIE_CREDIT = 0.005;
const FORBIDDEN = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });

/** Which vendor family a row belongs to — the page groups rows by it, one test order each. */
const FAMILIES: [RegExp, string][] = [
  [/nano-banana/, 'Nano Banana'], [/gpt-image/, 'GPT Image'], [/seedream/, 'Seedream'], [/flux/, 'FLUX'],
  [/ideogram/, 'Ideogram'], [/qwen/, 'Qwen-Image'], [/grok/, 'Grok Imagine'], [/z-image/, 'Z-Image'],
  [/recraft/, 'Recraft'], [/topaz/, 'Topaz'], [/kling/, 'Kling'], [/veo/, 'Veo'], [/seedance/, 'Seedance'],
  [/minimax/, 'MiniMax'], [/wan-/, 'Wan'], [/pixverse/, 'PixVerse'], [/infinitalk/, 'InfiniTalk'],
  [/volcengine/, 'Volcengine'], [/suno/, 'Suno'], [/elevenlabs/, 'ElevenLabs'], [/gemini/, 'Gemini TTS'],
];
const familyOf = (key: string) => FAMILIES.find(([re]) => re.test(key))?.[1] ?? 'อื่น ๆ';

function mask(encrypted: string): string {
  try {
    const key = decrypt(encrypted);
    return key.length > 10 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : '••••';
  } catch {
    return '•••• (ถอดรหัสไม่ได้)';
  }
}

/** A plain order on the model: what the map editor checks each row against. */
function plainOrder(key: string): FallbackOrder {
  return { kieKey: key, references: 0, firstFrame: false, lastFrame: false, seconds: null, clip: null, voice: null };
}

/**
 * The cheapest order a row's table sells and its length: the list's "from N",
 * and the order each fallback's cost is checked against (the one most likely
 * to lose money on a row that bills per order).
 */
function cheapestOrder(defaultParams: unknown, creditsPerUnit: number): { credits: number; seconds: number | null } {
  const table = readKiePriceTable(defaultParams);
  let best: { credits: number; seconds: number | null } | null = null;
  for (const row of Object.values(table?.credits ?? {})) {
    for (const [length, credits] of Object.entries(row)) {
      if (!Number.isFinite(credits) || credits <= 0 || (best && credits >= best.credits)) continue;
      best = { credits, seconds: table?.durations ? Number(length) : table?.perSecond ? 1 : null };
    }
  }
  return best ?? { credits: creditsPerUnit, seconds: null };
}

interface Tally {
  orders: number;
  completed: number;
  failed: number;
  credits: number;
  costUsd: number;
}
const emptyTally = (): Tally => ({ orders: 0, completed: 0, failed: 0, credits: 0, costUsd: 0 });

export async function GET() {
  if (!(await isAdmin())) return FORBIDDEN();
  const provider = await prisma.aiProvider.findUnique({ where: { slug: 'kie' }, select: { id: true, isActive: true } });
  const settings = await loadFallbackSettings();
  if (!provider) {
    return NextResponse.json({ provider: null, keys: [], models: [], catalog: KIE_CATALOG.length, fallback: { enabled: settings.enabled } });
  }

  const now = Date.now();
  const { day, month } = periodStarts(now);
  const [keys, rows, alertState] = await Promise.all([
    prisma.aiAccountPool.findMany({ where: { providerId: provider.id }, orderBy: { priority: 'desc' } }),
    prisma.aiModel.findMany({ where: { providerId: provider.id }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.aiSetting.findUnique({ where: { key: 'notify_alert_state' }, select: { value: true } }),
  ]);
  const rowIds = rows.map((r) => r.id);
  const keyIds = keys.map((k) => k.id);

  const [genToday, genMonth, spendToday, spendMonth, failures, fellOver, fellOverToday, fellOverMonth, others] = await Promise.all([
    prisma.aiGeneration.groupBy({
      by: ['modelId', 'status'],
      where: { modelId: { in: rowIds }, createdAt: { gte: day } },
      _count: true,
      _sum: { creditsUsed: true, creditsRefunded: true, costUsd: true },
    }),
    prisma.aiGeneration.groupBy({
      by: ['modelId', 'status'],
      where: { modelId: { in: rowIds }, createdAt: { gte: month } },
      _count: true,
      _sum: { creditsUsed: true, creditsRefunded: true, costUsd: true },
    }),
    prisma.aiUsageLog.aggregate({ where: { accountPoolId: { in: keyIds }, status: 'success', createdAt: { gte: day } }, _sum: { costUsd: true }, _count: true }),
    prisma.aiUsageLog.aggregate({ where: { accountPoolId: { in: keyIds }, status: 'success', createdAt: { gte: month } }, _sum: { costUsd: true }, _count: true }),
    prisma.aiGeneration.findMany({
      where: { modelId: { in: rowIds }, status: 'failed', createdAt: { gte: new Date(now - 30 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, modelId: true, errorMessage: true, creditsRefunded: true, createdAt: true, params: true },
    }),
    prisma.aiGeneration.findMany({
      where: { modelId: { in: rowIds }, params: { path: '$.route.via', equals: 'fallback' }, createdAt: { gte: new Date(now - 30 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, modelId: true, status: true, creditsUsed: true, costUsd: true, createdAt: true, params: true },
    }),
    prisma.aiGeneration.count({ where: { modelId: { in: rowIds }, params: { path: '$.route.via', equals: 'fallback' }, createdAt: { gte: day } } }),
    prisma.aiGeneration.count({ where: { modelId: { in: rowIds }, params: { path: '$.route.via', equals: 'fallback' }, createdAt: { gte: month } } }),
    prisma.aiModel.findMany({
      where: { provider: { slug: { notIn: ['kie', 'simplepod', 'gpuxmine'] } }, category: { in: ['image', 'edit', 'video', 'audio'] } },
      include: { provider: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  ]);

  // Which other providers have a key that can take an order now.
  const otherKeys = await prisma.aiAccountPool.findMany({
    where: { providerId: { in: [...new Set(others.map((o) => o.providerId))] } },
  });
  const providerHasKey = new Set(otherKeys.filter((k) => accountBlock(k) === null).map((k) => k.providerId));
  const byRef = new Map<string, ModelWithProvider>(others.map((o) => [`${o.provider.slug}:${o.modelId}`, o]));

  const tallies = (groups: typeof genToday) => {
    const out = new Map<number, Tally>();
    for (const g of groups) {
      const t = out.get(g.modelId) ?? emptyTally();
      t.orders += g._count;
      if (g.status === 'completed') t.completed += g._count;
      if (g.status === 'failed') t.failed += g._count;
      t.credits += (g._sum.creditsUsed ?? 0) - (g._sum.creditsRefunded ?? 0);
      t.costUsd += Number(g._sum.costUsd ?? 0);
      out.set(g.modelId, t);
    }
    return out;
  };
  const today = tallies(genToday);
  const thisMonth = tallies(genMonth);
  const sum = (m: Map<number, Tally>) =>
    [...m.values()].reduce((a, t) => ({ orders: a.orders + t.orders, completed: a.completed + t.completed, failed: a.failed + t.failed, credits: a.credits + t.credits, costUsd: a.costUsd + t.costUsd }), emptyTally());

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const routeOf = (params: unknown) => {
    const r = (params as { route?: Record<string, unknown> } | null)?.route;
    return r && typeof r === 'object' ? { name: String(r.name ?? r.modelId ?? ''), provider: String(r.provider ?? ''), reason: String(r.reason ?? '') } : null;
  };

  // The 402 state: a key whose last word from KIE was "no credit" and that has not delivered since.
  let alerts: Record<string, number> = {};
  try {
    alerts = JSON.parse(alertState?.value ?? '{}') as Record<string, number>;
  } catch {
    alerts = {};
  }
  const keyView = keys.map((k) => {
    const out402 = /^KIE 402\b/.test(k.lastError ?? '') && !!k.lastErrorAt && (!k.lastUsedAt || k.lastErrorAt > k.lastUsedAt);
    const alertAt = alerts[`kie-balance:${k.id}`];
    return {
      id: k.id,
      label: k.label,
      masked: mask(k.apiKey),
      isActive: k.isActive,
      block: accountBlock(k),
      cooldownUntil: k.cooldownUntil?.toISOString() ?? null,
      consecutiveErrors: k.consecutiveErrors,
      lastError: k.lastError?.slice(0, 300) ?? null,
      lastErrorAt: k.lastErrorAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      usageToday: k.usageToday,
      usageThisMonth: k.usageThisMonth,
      totalCostUsd: Number(k.totalCost),
      out402,
      alert402At: typeof alertAt === 'number' ? new Date(alertAt).toISOString() : null,
    };
  });

  // What a credit sells for now — what each fallback's cost is weighed against.
  const basis = await kieBasis();
  const models = rows.map((r) => {
    const entry = getKieEntry(r.modelId);
    const refs = fallbackRefsFor(r.modelId, settings.map);
    const cheapest = cheapestOrder(r.defaultParams, r.creditsPerUnit);
    return {
      id: r.id,
      modelId: r.modelId,
      name: r.name,
      family: familyOf(r.modelId),
      category: r.category,
      subcategory: r.subcategory,
      isActive: r.isActive,
      readiness: r.readiness,
      inCatalog: !!entry,
      priceFrom: cheapest.credits,
      unit: entry?.perChars ? `ต่อ ${entry.perChars.toLocaleString('en-US')} ตัวอักษร` : entry?.perSecond || entry?.sourceClip ? 'ต่อวินาที' : 'ต่องาน',
      today: today.get(r.id) ?? emptyTally(),
      month: thisMonth.get(r.id) ?? emptyTally(),
      fallback: {
        custom: Object.hasOwn(settings.map, r.modelId),
        refs: refs.map((ref) => {
          const row = byRef.get(ref);
          const why = !entry ? 'ไม่อยู่ในแคตตาล็อก' : !row ? 'ไม่มีโมเดลนี้ในระบบ' : whyNotFallback(plainOrder(r.modelId), fallbackRowOf(row));
          // Orders it would lose money on are refunded instead (pickFallback).
          const loss = row && why === null
            ? fallbackLoss(fallbackRowOf(row), { seconds: cheapest.seconds, clip: null }, cheapest.credits, basis)
            : null;
          return {
            ref,
            name: row?.name ?? null,
            provider: row?.provider.name ?? parseFallbackRef(ref)?.provider ?? ref,
            costPerUnit: row ? Number(row.costPerUnit) : null,
            usable: why === null && !!row && providerHasKey.has(row.providerId),
            loss,
            why: why ?? (row && !providerHasKey.has(row.providerId) ? 'ผู้ให้บริการยังไม่มีคีย์ที่ใช้ได้' : null),
          };
        }),
      },
    };
  });

  return NextResponse.json({
    provider,
    catalog: KIE_CATALOG.length,
    keys: keyView,
    out402: keyView.some((k) => k.out402 && k.isActive),
    spend: {
      today: { ...sum(today), kieUsd: Number(spendToday._sum.costUsd ?? 0), kieCalls: spendToday._count, fallback: fellOverToday },
      month: { ...sum(thisMonth), kieUsd: Number(spendMonth._sum.costUsd ?? 0), kieCalls: spendMonth._count, fallback: fellOverMonth },
    },
    models,
    failures: failures.map((f) => ({
      id: f.id,
      model: rowById.get(f.modelId)?.name ?? `#${f.modelId}`,
      error: (f.errorMessage ?? '').slice(0, 300),
      refunded: f.creditsRefunded,
      at: f.createdAt.toISOString(),
      route: routeOf(f.params),
    })),
    fallback: {
      enabled: settings.enabled,
      recent: fellOver.map((g) => ({
        id: g.id,
        model: rowById.get(g.modelId)?.name ?? `#${g.modelId}`,
        status: g.status,
        credits: g.creditsUsed,
        costUsd: Number(g.costUsd),
        at: g.createdAt.toISOString(),
        route: routeOf(g.params),
      })),
      // Rows the editor may add, by category.
      candidates: others.map((o) => ({
        ref: `${o.provider.slug}:${o.modelId}`,
        name: o.name,
        provider: o.provider.name,
        category: o.category,
        subcategory: o.subcategory,
        readiness: o.readiness,
        isActive: o.isActive && o.provider.isActive,
        hasKey: providerHasKey.has(o.providerId),
      })),
    },
  });
}

async function saveSetting(key: string, value: string, type: string) {
  await prisma.aiSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value, type, group: 'kie' },
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return FORBIDDEN();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = await prisma.aiProvider.findUnique({ where: { slug: 'kie' }, select: { id: true } });

  try {
    if (body.action === 'balance' || body.action === 'recheck') {
      if (!provider) return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า KIE' }, { status: 404 });
      const keyId = Number(body.keyId);
      const account =
        body.action === 'recheck'
          ? await prisma.aiAccountPool.findFirst({ where: { id: keyId, providerId: provider.id } })
          : await prisma.aiAccountPool.findFirst({ where: { providerId: provider.id, isActive: true }, orderBy: { priority: 'desc' } });
      if (!account) return NextResponse.json({ error: 'ไม่พบคีย์ KIE' }, { status: 404 });
      let apiKey: string;
      try {
        apiKey = decrypt(account.apiKey);
      } catch {
        return NextResponse.json({ error: 'ถอดรหัสคีย์ไม่ได้ — วางคีย์ใหม่แทน' }, { status: 422 });
      }
      const check = await kie.credits(apiKey);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 502 });
      const usd = Math.round(check.credits * USD_PER_KIE_CREDIT * 100) / 100;
      if (body.action === 'balance') return NextResponse.json({ ok: true, credits: check.credits, usd });
      if (check.credits <= 0) {
        return NextResponse.json({ error: `คีย์ใช้ได้ แต่ยอดคงเหลือ 0 เครดิต — เติมที่ kie.ai ก่อน` }, { status: 422 });
      }
      await prisma.aiAccountPool.update({
        where: { id: account.id },
        data: { isActive: true, consecutiveErrors: 0, cooldownUntil: null, lastError: null },
      });
      return NextResponse.json({ ok: true, credits: check.credits, usd, reactivated: true });
    }

    if (body.action === 'replace') {
      if (!provider) return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า KIE' }, { status: 404 });
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!/^[A-Za-z0-9_-]{16,200}$/.test(apiKey)) {
        return NextResponse.json({ error: 'คีย์ไม่ถูกรูปแบบ — คัดลอกจาก kie.ai/api-key ทั้งบรรทัด' }, { status: 422 });
      }
      const account = await prisma.aiAccountPool.findFirst({ where: { id: Number(body.keyId), providerId: provider.id } });
      if (!account) return NextResponse.json({ error: 'ไม่พบคีย์ KIE' }, { status: 404 });
      const others = await prisma.aiAccountPool.findMany({ where: { providerId: provider.id, id: { not: account.id } }, select: { apiKey: true } });
      if (others.some((o) => { try { return decrypt(o.apiKey) === apiKey; } catch { return false; } })) {
        return NextResponse.json({ error: 'คีย์นี้มีอยู่แล้วในอีกแถว' }, { status: 409 });
      }
      const check = await kie.credits(apiKey);
      if (!check.ok) return NextResponse.json({ error: `KIE ไม่รับคีย์นี้ (${check.error})` }, { status: 422 });
      await prisma.aiAccountPool.update({
        where: { id: account.id },
        data: { apiKey: encrypt(apiKey), isActive: true, consecutiveErrors: 0, cooldownUntil: null, lastError: null },
      });
      return NextResponse.json({ ok: true, credits: check.credits });
    }

    if (body.action === 'model') {
      if (!provider) return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า KIE' }, { status: 404 });
      const updated = await prisma.aiModel.updateMany({
        where: { id: Number(body.id), providerId: provider.id },
        data: { isActive: body.isActive === true },
      });
      if (updated.count === 0) return NextResponse.json({ error: 'ไม่พบโมเดล' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'fallback') {
      await saveSetting(FALLBACK_ENABLED_KEY, body.enabled === false ? 'false' : 'true', 'boolean');
      return NextResponse.json({ ok: true, enabled: body.enabled !== false });
    }

    if (body.action === 'fallback-map') {
      const key = typeof body.modelId === 'string' ? body.modelId : '';
      const entry = getKieEntry(key);
      if (!entry) return NextResponse.json({ error: 'ไม่ใช่โมเดลในแคตตาล็อก KIE' }, { status: 422 });
      const row = await prisma.aiSetting.findUnique({ where: { key: FALLBACK_MAP_KEY }, select: { value: true } });
      const map = readFallbackMap(row?.value);
      if (body.refs === null) {
        delete map[key];
      } else {
        if (!Array.isArray(body.refs)) return NextResponse.json({ error: 'รายการโมเดลสำรองไม่ถูกต้อง' }, { status: 422 });
        const refs = cleanRefs(body.refs);
        // Each must be a row of another provider doing the same kind of work.
        for (const ref of refs) {
          const parsed = parseFallbackRef(ref)!;
          const target = await prisma.aiModel.findFirst({
            where: { modelId: parsed.modelId, provider: { slug: parsed.provider } },
            select: { category: true },
          });
          if (!target) return NextResponse.json({ error: `ไม่มีโมเดล ${ref} ในระบบ` }, { status: 422 });
          if (target.category !== entry.category) {
            return NextResponse.json({ error: `${ref} เป็นงานคนละประเภทกับ ${entry.name}` }, { status: 422 });
          }
        }
        map[key] = refs;
      }
      await saveSetting(FALLBACK_MAP_KEY, JSON.stringify(map), 'json');
      return NextResponse.json({ ok: true, refs: fallbackRefsFor(key, map), custom: Object.hasOwn(map, key) });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[admin/kie] failed:', (error as Error).message);
    return NextResponse.json({ error: 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
