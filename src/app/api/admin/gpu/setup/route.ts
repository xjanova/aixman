import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { encrypt } from '@/lib/utils/encryption';
import { getGpuProvider } from '@/lib/gpu';
import { GPU_DEFAULTS } from '@/lib/gpu/config';

/**
 * One-step GPU setup: supply a marketplace API key and everything else is
 * configured. Creates the provider row, stores the key encrypted, writes the
 * default budget caps, and activates the model.
 *
 * The key is verified against the provider before anything is saved — storing
 * a bad key would leave the queue failing silently at rental time, long after
 * the admin has moved on.
 */

export const dynamic = 'force-dynamic';

const PROVIDER_SLUG = 'simplepod';

/** Budget caps written on first setup. Existing values are never overwritten. */
const DEFAULT_SETTINGS: Array<{ key: string; value: string; type: string }> = [
  { key: 'gpu_provider', value: PROVIDER_SLUG, type: 'string' },
  { key: 'gpu_max_concurrent_workers', value: String(GPU_DEFAULTS.maxConcurrentWorkers), type: 'number' },
  { key: 'gpu_max_price_per_hour_usd', value: String(GPU_DEFAULTS.maxPricePerHourUsd), type: 'number' },
  { key: 'gpu_daily_budget_usd', value: String(GPU_DEFAULTS.dailyBudgetUsd), type: 'number' },
  { key: 'gpu_idle_timeout_minutes', value: String(GPU_DEFAULTS.idleTimeoutMinutes), type: 'number' },
  { key: 'gpu_max_worker_lifetime_minutes', value: String(GPU_DEFAULTS.maxWorkerLifetimeMinutes), type: 'number' },
  { key: 'gpu_warmup_timeout_minutes', value: String(GPU_DEFAULTS.warmupTimeoutMinutes), type: 'number' },
  { key: 'gpu_job_timeout_minutes', value: String(GPU_DEFAULTS.jobTimeoutMinutes), type: 'number' },
];

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const enable = body.enable !== false;

  if (!apiKey) {
    return NextResponse.json({ error: 'กรุณาระบุ API key ของ SimplePod' }, { status: 400 });
  }

  const provider = getGpuProvider(PROVIDER_SLUG);
  if (!provider) {
    return NextResponse.json({ error: 'ไม่รู้จัก GPU provider นี้' }, { status: 400 });
  }

  // Verify before persisting — a key that cannot read the balance cannot rent.
  let balanceUsd: number;
  try {
    const balance = await provider.getBalance(apiKey);
    balanceUsd = balance.balanceUsd;
  } catch (error) {
    console.error('[gpu] setup key verification failed:', error);
    return NextResponse.json(
      { error: 'ใช้ API key นี้เชื่อมต่อ SimplePod ไม่ได้ กรุณาตรวจสอบว่าคัดลอกมาครบและมีสิทธิ์เข้าถึง' },
      { status: 400 }
    );
  }

  try {
    const providerRow = await prisma.aiProvider.upsert({
      where: { slug: PROVIDER_SLUG },
      update: { isActive: true },
      create: {
        slug: PROVIDER_SLUG,
        name: 'SimplePod (เช่า GPU)',
        description:
          'เช่า GPU มารันโมเดลเอง (MiniMax H3) — คิดเงินตามเวลาที่เครื่องเปิด ไม่ใช่ตามจำนวนงาน',
        baseUrl: 'https://api.simplepod.ai',
        authType: 'api_key',
        supportsImage: false,
        supportsVideo: true,
        supportsEdit: false,
        isActive: true,
        sortOrder: 10,
      },
    });

    // One credential row per provider — GPU accounts are infrastructure, not
    // rate-limited keys, so there is nothing to rotate between.
    const existing = await prisma.aiAccountPool.findFirst({
      where: { providerId: providerRow.id },
      orderBy: { id: 'asc' },
    });

    if (existing) {
      await prisma.aiAccountPool.update({
        where: { id: existing.id },
        data: {
          apiKey: encrypt(apiKey),
          isActive: true,
          consecutiveErrors: 0,
          cooldownUntil: null,
          lastError: null,
        },
      });
    } else {
      await prisma.aiAccountPool.create({
        data: {
          providerId: providerRow.id,
          label: 'SimplePod',
          apiKey: encrypt(apiKey),
          isActive: true,
          priority: 50,
          // Quota fields are meaningless for a rental account; the real limits
          // are the GPU budget caps. Left unbounded so pool filters never
          // exclude the credential.
          dailyQuota: 0,
          monthlyQuota: 0,
        },
      });
    }

    for (const setting of DEFAULT_SETTINGS) {
      await prisma.aiSetting.upsert({
        where: { key: setting.key },
        update: {}, // never clobber a value an admin has tuned
        create: { ...setting, group: 'gpu' },
      });
    }

    await prisma.aiSetting.upsert({
      where: { key: 'gpu_enabled' },
      update: { value: enable ? 'true' : 'false' },
      create: { key: 'gpu_enabled', value: enable ? 'true' : 'false', type: 'boolean', group: 'gpu' },
    });

    // Activate the models only alongside enabling — an active model with rental
    // switched off would queue jobs that can never drain. Every catalogue model
    // for this provider is switched together; each still has to prove itself
    // before customers can order it (see ModelReadiness).
    const activated = await prisma.aiModel.updateMany({
      where: { providerId: providerRow.id },
      data: { isActive: enable },
    });

    return NextResponse.json({
      success: true,
      enabled: enable,
      balanceUsd,
      modelsActivated: enable ? activated.count : 0,
      // Surfaced so the admin immediately sees whether renting is even viable.
      warning:
        balanceUsd < GPU_DEFAULTS.maxPricePerHourUsd
          ? `ยอดเงินใน SimplePod เหลือ $${balanceUsd.toFixed(2)} ซึ่งไม่พอเช่าเครื่อง 1 ชั่วโมง กรุณาเติมเงินก่อนใช้งาน`
          : null,
    });
  } catch (error) {
    console.error('[gpu] setup failed:', error);
    return NextResponse.json({ error: 'บันทึกการตั้งค่าไม่สำเร็จ' }, { status: 500 });
  }
}
