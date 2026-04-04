import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { encrypt } from '@/lib/utils/encryption';
import prisma from '@/lib/db';

/**
 * Setup Wizard API
 * Creates initial providers, account pools, models, and credit packages
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();

  // Save settings
  const settings = [
    { key: 'site_name', value: body.siteName, type: 'string', group: 'general' },
    { key: 'site_description', value: body.siteDesc, type: 'string', group: 'general' },
    { key: 'setup_completed', value: 'true', type: 'boolean', group: 'system' },
  ];

  for (const s of settings) {
    await prisma.aiSetting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value },
    });
  }

  // Create providers and account pools
  const providerConfigs: Record<string, { name: string; baseUrl: string; supportsImage: boolean; supportsVideo: boolean; supportsEdit: boolean }> = {
    byteplus: { name: 'BytePlus', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', supportsImage: true, supportsVideo: true, supportsEdit: true },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', supportsImage: true, supportsVideo: true, supportsEdit: false },
    replicate: { name: 'Replicate', baseUrl: 'https://api.replicate.com/v1', supportsImage: true, supportsVideo: true, supportsEdit: true },
    fal: { name: 'fal.ai', baseUrl: 'https://queue.fal.run', supportsImage: true, supportsVideo: true, supportsEdit: true },
    stability: { name: 'Stability AI', baseUrl: 'https://api.stability.ai', supportsImage: true, supportsVideo: false, supportsEdit: true },
    runway: { name: 'Runway ML', baseUrl: 'https://api.dev.runwayml.com/v1', supportsImage: true, supportsVideo: true, supportsEdit: false },
    kling: { name: 'Kling AI', baseUrl: 'https://api.klingai.com', supportsImage: true, supportsVideo: true, supportsEdit: false },
    luma: { name: 'Luma AI', baseUrl: 'https://api.lumalabs.ai/dream-machine/v1', supportsImage: true, supportsVideo: true, supportsEdit: false },
    leonardo: { name: 'Leonardo.ai', baseUrl: 'https://cloud.leonardo.ai/api/rest/v1', supportsImage: true, supportsVideo: false, supportsEdit: false },
  };

  for (const providerData of body.providers || []) {
    const config = providerConfigs[providerData.slug];
    if (!config) continue;

    const provider = await prisma.aiProvider.upsert({
      where: { slug: providerData.slug },
      create: {
        slug: providerData.slug,
        name: config.name,
        baseUrl: config.baseUrl,
        supportsImage: config.supportsImage,
        supportsVideo: config.supportsVideo,
        supportsEdit: config.supportsEdit,
        isActive: true,
      },
      update: { isActive: true },
    });

    // Create account pool if API key provided
    if (providerData.apiKey) {
      await prisma.aiAccountPool.create({
        data: {
          providerId: provider.id,
          label: `${config.name} Account #1`,
          apiKey: encrypt(providerData.apiKey),
          apiSecret: providerData.apiSecret ? encrypt(providerData.apiSecret) : null,
          priority: 50,
          dailyQuota: 1000,
          rotationMode: 'round_robin',
        },
      });
    }
  }

  // Create default models
  const defaultModels = [
    { providerSlug: 'byteplus', modelId: 'seedream-3.0', name: 'Seedream 3.0', category: 'image', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 2048, maxHeight: 2048 },
    { providerSlug: 'byteplus', modelId: 'seedream-5.0-lite', name: 'Seedream 5.0 Lite', category: 'image', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 4096, maxHeight: 4096 },
    { providerSlug: 'byteplus', modelId: 'seedance-1.0-lite', name: 'Seedance 1.0 Lite', category: 'video', costPerUnit: 0.05, creditsPerUnit: 12, maxDuration: 10 },
    { providerSlug: 'byteplus', modelId: 'seedance-2.0', name: 'Seedance 2.0', category: 'video', costPerUnit: 0.10, creditsPerUnit: 15, maxDuration: 10 },
    { providerSlug: 'openai', modelId: 'gpt-image-1', name: 'GPT Image 1', category: 'image', costPerUnit: 0.04, creditsPerUnit: 5, maxWidth: 1024, maxHeight: 1024 },
    { providerSlug: 'openai', modelId: 'gpt-image-1-mini', name: 'GPT Image 1 Mini', category: 'image', costPerUnit: 0.01, creditsPerUnit: 2, maxWidth: 1024, maxHeight: 1024 },
    { providerSlug: 'openai', modelId: 'dall-e-3', name: 'DALL-E 3', category: 'image', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 1024, maxHeight: 1024 },
    { providerSlug: 'openai', modelId: 'sora-2', name: 'Sora 2', category: 'video', costPerUnit: 0.50, creditsPerUnit: 20, maxDuration: 20 },
    { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-1.1-pro', name: 'FLUX 1.1 Pro', category: 'image', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 1440, maxHeight: 1440 },
    { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-schnell', name: 'FLUX Schnell', category: 'image', costPerUnit: 0.003, creditsPerUnit: 1, maxWidth: 1024, maxHeight: 1024 },
    { providerSlug: 'stability', modelId: 'stable-image-ultra', name: 'Stable Image Ultra', category: 'image', costPerUnit: 0.08, creditsPerUnit: 6, maxWidth: 1024, maxHeight: 1024 },
    { providerSlug: 'stability', modelId: 'sd3.5-large', name: 'SD 3.5 Large', category: 'image', costPerUnit: 0.065, creditsPerUnit: 5, maxWidth: 1024, maxHeight: 1024 },
    { providerSlug: 'runway', modelId: 'gen4_turbo', name: 'Gen-4 Turbo', category: 'video', costPerUnit: 0.25, creditsPerUnit: 12, maxDuration: 10 },
    { providerSlug: 'kling', modelId: 'kling-v2.5', name: 'Kling 2.5', category: 'video', costPerUnit: 0.35, creditsPerUnit: 14, maxDuration: 10 },
    { providerSlug: 'luma', modelId: 'ray-2', name: 'Dream Machine Ray-2', category: 'video', costPerUnit: 0.20, creditsPerUnit: 15, maxDuration: 10 },
  ];

  for (const m of defaultModels) {
    const provider = await prisma.aiProvider.findUnique({ where: { slug: m.providerSlug } });
    if (!provider) continue;

    await prisma.aiModel.upsert({
      where: { providerId_modelId: { providerId: provider.id, modelId: m.modelId } },
      create: {
        providerId: provider.id,
        modelId: m.modelId,
        name: m.name,
        category: m.category,
        costPerUnit: m.costPerUnit,
        creditsPerUnit: m.creditsPerUnit,
        maxWidth: m.maxWidth || null,
        maxHeight: m.maxHeight || null,
        maxDuration: m.maxDuration || null,
        isActive: true,
        isFeatured: false,
      },
      update: {
        name: m.name,
        costPerUnit: m.costPerUnit,
        creditsPerUnit: m.creditsPerUnit,
      },
    });
  }

  // Create default credit packages
  const defaultPackages = [
    { name: 'Starter', slug: 'starter', credits: 100, priceThb: 99, priceUsd: 2.99, bonusCredits: 0, sortOrder: 1, features: JSON.stringify(['100 เครดิต', 'ภาพ ~25-33 ภาพ', 'วิดีโอ ~5-8 คลิป', 'ไม่มีวันหมดอายุ']) },
    { name: 'Creator', slug: 'creator', credits: 500, priceThb: 399, priceUsd: 11.99, bonusCredits: 50, badge: 'ยอดนิยม', isFeatured: true, sortOrder: 2, features: JSON.stringify(['500 + 50 โบนัส เครดิต', 'ภาพ ~137 ภาพ', 'วิดีโอ ~36 คลิป', 'ประหยัด 20%', 'ไม่มีวันหมดอายุ']) },
    { name: 'Pro', slug: 'pro', credits: 1500, priceThb: 999, priceUsd: 29.99, bonusCredits: 250, badge: 'คุ้มที่สุด', sortOrder: 3, features: JSON.stringify(['1,500 + 250 โบนัส เครดิต', 'ภาพ ~437 ภาพ', 'วิดีโอ ~116 คลิป', 'ประหยัด 33%', 'ไม่มีวันหมดอายุ']) },
    { name: 'Enterprise', slug: 'enterprise', credits: 5000, priceThb: 2499, priceUsd: 74.99, bonusCredits: 1500, badge: 'สำหรับทีม', sortOrder: 4, features: JSON.stringify(['5,000 + 1,500 โบนัส เครดิต', 'ภาพ ~1,625 ภาพ', 'วิดีโอ ~433 คลิป', 'ประหยัด 50%', 'ซัพพอร์ตพิเศษ']) },
  ];

  for (const pkg of defaultPackages) {
    await prisma.aiCreditPackage.upsert({
      where: { slug: pkg.slug },
      create: pkg,
      update: { priceThb: pkg.priceThb, priceUsd: pkg.priceUsd, credits: pkg.credits, bonusCredits: pkg.bonusCredits },
    });
  }

  return NextResponse.json({ success: true });
}
