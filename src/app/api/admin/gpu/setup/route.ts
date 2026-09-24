import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { encrypt } from '@/lib/utils/encryption';
import { getGpuProvider } from '@/lib/gpu';
import { GPU_DEFAULTS, getGpuConfig } from '@/lib/gpu/config';
import { syncCatalogModels } from '@/lib/gpu/model-sync';
import { isGpuProviderSlug, type GpuProviderSlug } from '@/lib/gpu/types';
import { relayBaseUrl } from '@/lib/gpu/gpuxmine';
import { GpuBalance } from '@/lib/services/gpu-balance';

/**
 * One-step GPU setup, per vendor: supply that vendor's credential and
 * everything else is configured. Creates the vendor's provider row, stores the
 * credential encrypted, adds the vendor to the ones the picker rents from,
 * writes the default budget caps, and activates the models.
 *
 * The credential is verified against the vendor before anything is saved —
 * storing a bad key would leave the queue failing silently at rental time,
 * long after the admin has moved on.
 *
 * The models themselves stay on the SimplePod provider row whichever vendor
 * is set up: that row is what marks them as served by rented GPUs
 * (`getGpuProvider(slug)` in generation.ts), and the vendor a job runs on is
 * chosen per machine, not per model.
 */

export const dynamic = 'force-dynamic';

/** Which row owns the self-hosted models. */
const MODELS_PROVIDER: GpuProviderSlug = 'simplepod';

const VENDOR_ROWS: Record<GpuProviderSlug, { name: string; baseUrl: string; description: string }> = {
  simplepod: {
    name: 'SimplePod (เช่า GPU)',
    baseUrl: 'https://api.simplepod.ai',
    description: 'เช่า GPU มารันโมเดลเอง — คิดเงินตามเวลาที่เครื่องเปิด ไม่ใช่ตามจำนวนงาน',
  },
  runpod: {
    name: 'RunPod (เช่า GPU)',
    baseUrl: 'https://api.runpod.io/v2',
    description: 'ผู้ให้เช่า GPU สำรอง — ศูนย์ข้อมูลของ RunPod และเครื่องชุมชนที่ผ่านการตรวจ',
  },
  vast: {
    name: 'Vast.ai (เช่า GPU)',
    baseUrl: 'https://console.vast.ai/api/v0',
    description: 'ตลาดเช่า GPU ราคาถูก ของเยอะ — ใช้รองรับตอนเครื่องล้น',
  },
  verda: {
    name: 'Verda (เช่า GPU)',
    baseUrl: 'https://api.verda.com/v1',
    description: 'ศูนย์ข้อมูลของ Verda (DataCrunch เดิม) ที่ฟินแลนด์ — RTX PRO 6000, H100, A100, L40S',
  },
  // Not a marketplace. The credential is the relay's admin key, and it only
  // buys the admin pages a live view of who is online. The pool itself works
  // without one: XMAN Studio pushes each node's endpoint and tunnel token, and
  // the reconciler probes the node through it (gpuxmine.ts, gpu-worker.ts).
  gpuxmine: {
    name: 'GPUxMINE (เครื่องชุมชน)',
    baseUrl: relayBaseUrl(),
    description: 'เครื่องของผู้ใช้ที่ลงไคลเอนต์ GPUxMINE เอง — ไม่มีค่าเช่ารายชั่วโมง จ่ายเป็นค่าตอบแทนต่องาน',
  },
};

/** Budget caps written on first setup. Existing values are never overwritten. */
const DEFAULT_SETTINGS: Array<{ key: string; value: string; type: string }> = [
  { key: 'gpu_provider', value: MODELS_PROVIDER, type: 'string' },
  { key: 'gpu_max_concurrent_workers', value: String(GPU_DEFAULTS.maxConcurrentWorkers), type: 'number' },
  { key: 'gpu_max_price_per_hour_usd', value: String(GPU_DEFAULTS.maxPricePerHourUsd), type: 'number' },
  { key: 'gpu_daily_budget_usd', value: String(GPU_DEFAULTS.dailyBudgetUsd), type: 'number' },
  { key: 'gpu_idle_timeout_minutes', value: String(GPU_DEFAULTS.idleTimeoutMinutes), type: 'number' },
  { key: 'gpu_max_worker_lifetime_minutes', value: String(GPU_DEFAULTS.maxWorkerLifetimeMinutes), type: 'number' },
  { key: 'gpu_warmup_timeout_minutes', value: String(GPU_DEFAULTS.warmupTimeoutMinutes), type: 'number' },
  { key: 'gpu_job_timeout_minutes', value: String(GPU_DEFAULTS.jobTimeoutMinutes), type: 'number' },
];

/** The stored credential: an API key, or Verda's `client_id:client_secret`. */
function credentialFrom(body: Record<string, unknown>, kind: 'api-key' | 'client-id-secret'): string {
  if (kind === 'client-id-secret') {
    const id = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const secret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    return id && secret ? `${id}:${secret}` : '';
  }
  return typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
}

async function upsertVendorRow(slug: GpuProviderSlug) {
  const row = VENDOR_ROWS[slug];
  return prisma.aiProvider.upsert({
    where: { slug },
    update: { isActive: true },
    create: {
      slug,
      name: row.name,
      description: row.description,
      baseUrl: row.baseUrl,
      authType: 'api_key',
      supportsImage: false,
      supportsVideo: slug === MODELS_PROVIDER,
      supportsEdit: false,
      isActive: true,
      sortOrder: 10,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = body.provider ?? MODELS_PROVIDER;
  const enable = body.enable !== false;
  if (!isGpuProviderSlug(slug)) {
    return NextResponse.json({ error: 'ไม่รู้จักผู้ให้เช่า GPU นี้' }, { status: 400 });
  }
  const provider = getGpuProvider(slug);
  if (!provider) {
    return NextResponse.json({ error: 'ไม่รู้จักผู้ให้เช่า GPU นี้' }, { status: 400 });
  }

  const credential = credentialFrom(body, provider.credential);
  if (!credential) {
    return NextResponse.json(
      {
        error:
          provider.credential === 'client-id-secret'
            ? `กรุณาระบุ Client ID และ Client Secret ของ ${provider.label}`
            : `กรุณาระบุ API key ของ ${provider.label}`,
      },
      { status: 400 }
    );
  }

  // Verify before persisting — a credential that cannot read the balance
  // cannot rent. The market is read too, so the admin learns at once whether
  // this vendor has anything our models can run on.
  let balanceUsd: number | null;
  let balanceUnknown = false;
  try {
    const balance = await provider.getBalance(credential);
    balanceUnknown = Boolean(balance.unknown);
    balanceUsd = Number.isFinite(balance.balanceUsd) ? balance.balanceUsd : null;
  } catch (error) {
    console.error(`[gpu] ${slug} setup verification failed:`, (error as Error).message);
    return NextResponse.json(
      { error: `ใช้ข้อมูลนี้เชื่อมต่อ ${provider.label} ไม่ได้ กรุณาตรวจสอบว่าคัดลอกมาครบและมีสิทธิ์เข้าถึง` },
      { status: 400 }
    );
  }

  try {
    const vendorRow = await upsertVendorRow(slug);

    // One credential row per vendor — GPU accounts are infrastructure, not
    // rate-limited keys, so there is nothing to rotate between.
    const existing = await prisma.aiAccountPool.findFirst({
      where: { providerId: vendorRow.id },
      orderBy: { id: 'asc' },
    });
    if (existing) {
      await prisma.aiAccountPool.update({
        where: { id: existing.id },
        data: { apiKey: encrypt(credential), isActive: true, consecutiveErrors: 0, cooldownUntil: null, lastError: null },
      });
    } else {
      await prisma.aiAccountPool.create({
        data: {
          providerId: vendorRow.id,
          label: provider.label,
          apiKey: encrypt(credential),
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

    // Add this vendor to the ones the picker rents from (or take it off).
    const cfg = await getGpuConfig();
    const providers = enable
      ? [...new Set([...cfg.providers, slug])]
      : cfg.providers.filter((s) => s !== slug);
    await prisma.aiSetting.upsert({
      where: { key: 'gpu_providers' },
      update: { value: providers.join(',') },
      create: { key: 'gpu_providers', value: providers.join(','), type: 'string', group: 'gpu' },
    });

    if (enable) {
      await prisma.aiSetting.upsert({
        where: { key: 'gpu_enabled' },
        update: { value: 'true' },
        create: { key: 'gpu_enabled', value: 'true', type: 'boolean', group: 'gpu' },
      });
    }

    // The models live on the SimplePod row whichever vendor was set up, so it
    // exists even when SimplePod itself has no key.
    const modelsRow = slug === MODELS_PROVIDER ? vendorRow : await upsertVendorRow(MODELS_PROVIDER);

    // Create the catalogue's models if they are not here yet. Doing it at setup
    // rather than in the seeder is what makes "paste the key" actually
    // sufficient — the seeder is a separate admin action that is easy to forget,
    // and without it the models exist in code but never reach the database.
    let activated = 0;
    if (enable) {
      await syncCatalogModels(modelsRow.id);
      activated = (
        await prisma.aiModel.updateMany({ where: { providerId: modelsRow.id }, data: { isActive: true } })
      ).count;
    }

    // Orders pause while no vendor can pay for a machine. A funded vendor just
    // connected reopens them now, not at the next balance read minutes later.
    await GpuBalance.check(await getGpuConfig(), 0).catch((error) =>
      console.error('[gpu] balance refresh after setup failed:', (error as Error).message)
    );

    return NextResponse.json({
      success: true,
      provider: slug,
      enabled: enable,
      balanceUsd,
      balanceUnknown,
      providers,
      modelsActivated: activated,
      // Surfaced so the admin immediately sees whether renting is even viable.
      warning:
        balanceUsd !== null && balanceUsd < GPU_DEFAULTS.maxPricePerHourUsd
          ? `ยอดเงินใน ${provider.label} เหลือ $${balanceUsd.toFixed(2)} ซึ่งไม่พอเช่าเครื่อง 1 ชั่วโมง กรุณาเติมเงินก่อนใช้งาน`
          : null,
    });
  } catch (error) {
    console.error('[gpu] setup failed:', error);
    return NextResponse.json({ error: 'บันทึกการตั้งค่าไม่สำเร็จ' }, { status: 500 });
  }
}
