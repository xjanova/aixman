import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

/**
 * POST /api/admin/seed
 * Seeds the database with all providers, models, packages, styles, and settings.
 * Safe to run multiple times (uses upsert).
 */
export async function POST() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const results = {
      providers: 0,
      models: 0,
      packages: 0,
      styles: 0,
      templates: 0,
      settings: 0,
    };

    // ══════════════════════════════════════════
    // 1. AI PROVIDERS
    // ══════════════════════════════════════════
    const providers = [
      { slug: 'byteplus', name: 'BytePlus', description: 'ByteDance AI platform — Seedream (image) & Seedance (video)', baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3', authType: 'bearer', supportsImage: true, supportsVideo: true, supportsEdit: true, sortOrder: 1 },
      { slug: 'openai', name: 'OpenAI', description: 'GPT Image, DALL-E 3, Sora — industry-leading AI generation', baseUrl: 'https://api.openai.com/v1', authType: 'bearer', supportsImage: true, supportsVideo: true, supportsEdit: false, sortOrder: 2 },
      { slug: 'stability', name: 'Stability AI', description: 'Stable Diffusion, SDXL, Stable Image Ultra', baseUrl: 'https://api.stability.ai', authType: 'bearer', supportsImage: true, supportsVideo: false, supportsEdit: true, sortOrder: 3 },
      { slug: 'replicate', name: 'Replicate', description: 'FLUX, 1000+ open-source models via API', baseUrl: 'https://api.replicate.com/v1', authType: 'bearer', supportsImage: true, supportsVideo: true, supportsEdit: true, sortOrder: 4 },
      { slug: 'fal', name: 'fal.ai', description: 'Ultra-fast inference for FLUX, Stable Diffusion, and more', baseUrl: 'https://queue.fal.run', authType: 'bearer', supportsImage: true, supportsVideo: true, supportsEdit: true, sortOrder: 5 },
      { slug: 'runway', name: 'Runway ML', description: 'Gen-4 Turbo video generation — Hollywood-grade AI', baseUrl: 'https://api.dev.runwayml.com/v1', authType: 'bearer', supportsImage: true, supportsVideo: true, supportsEdit: false, sortOrder: 6 },
      { slug: 'kling', name: 'Kling AI', description: 'Kling 2.5 video generation by Kuaishou', baseUrl: 'https://api.klingai.com', authType: 'api_key_secret', supportsImage: true, supportsVideo: true, supportsEdit: false, sortOrder: 7 },
      { slug: 'luma', name: 'Luma AI', description: 'Dream Machine — photorealistic video from text/image', baseUrl: 'https://api.lumalabs.ai/dream-machine/v1', authType: 'bearer', supportsImage: true, supportsVideo: true, supportsEdit: false, sortOrder: 8 },
      { slug: 'leonardo', name: 'Leonardo.ai', description: 'Creative AI — Phoenix, Kino XL models', baseUrl: 'https://cloud.leonardo.ai/api/rest/v1', authType: 'bearer', supportsImage: true, supportsVideo: false, supportsEdit: false, sortOrder: 9 },
    ];

    for (const p of providers) {
      await prisma.aiProvider.upsert({
        where: { slug: p.slug },
        create: { ...p, isActive: true },
        update: { name: p.name, description: p.description, baseUrl: p.baseUrl, authType: p.authType, supportsImage: p.supportsImage, supportsVideo: p.supportsVideo, supportsEdit: p.supportsEdit, sortOrder: p.sortOrder },
      });
      results.providers++;
    }

    // ══════════════════════════════════════════
    // 2. AI MODELS
    // ══════════════════════════════════════════
    const models = [
      // BytePlus — Image
      { providerSlug: 'byteplus', modelId: 'seedream-3.0', name: 'Seedream 3.0', category: 'image', subcategory: 'general', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 2048, maxHeight: 2048, isFeatured: true },
      { providerSlug: 'byteplus', modelId: 'seedream-5.0-lite', name: 'Seedream 5.0 Lite', category: 'image', subcategory: 'general', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 4096, maxHeight: 4096, isFeatured: false },
      { providerSlug: 'byteplus', modelId: 'seedream-5.0', name: 'Seedream 5.0', category: 'image', subcategory: 'premium', costPerUnit: 0.05, creditsPerUnit: 5, maxWidth: 4096, maxHeight: 4096, isFeatured: true },
      // BytePlus — Video
      { providerSlug: 'byteplus', modelId: 'seedance-1.0-lite', name: 'Seedance 1.0 Lite', category: 'video', subcategory: 'general', costPerUnit: 0.05, creditsPerUnit: 12, maxDuration: 10 },
      { providerSlug: 'byteplus', modelId: 'seedance-2.0', name: 'Seedance 2.0', category: 'video', subcategory: 'premium', costPerUnit: 0.10, creditsPerUnit: 15, maxDuration: 10, isFeatured: true },

      // OpenAI — Image
      { providerSlug: 'openai', modelId: 'gpt-image-1', name: 'GPT Image 1', category: 'image', subcategory: 'general', costPerUnit: 0.04, creditsPerUnit: 5, maxWidth: 1024, maxHeight: 1024, isFeatured: true },
      { providerSlug: 'openai', modelId: 'gpt-image-1-mini', name: 'GPT Image 1 Mini', category: 'image', subcategory: 'fast', costPerUnit: 0.01, creditsPerUnit: 2, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'openai', modelId: 'dall-e-3', name: 'DALL-E 3', category: 'image', subcategory: 'general', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'openai', modelId: 'dall-e-3-hd', name: 'DALL-E 3 HD', category: 'image', subcategory: 'premium', costPerUnit: 0.08, creditsPerUnit: 8, maxWidth: 1024, maxHeight: 1792 },
      // OpenAI — Video
      { providerSlug: 'openai', modelId: 'sora-2', name: 'Sora 2', category: 'video', subcategory: 'premium', costPerUnit: 0.50, creditsPerUnit: 20, maxDuration: 20, isFeatured: true },

      // Stability AI — Image
      { providerSlug: 'stability', modelId: 'stable-image-ultra', name: 'Stable Image Ultra', category: 'image', subcategory: 'premium', costPerUnit: 0.08, creditsPerUnit: 6, maxWidth: 1024, maxHeight: 1024, isFeatured: true },
      { providerSlug: 'stability', modelId: 'stable-image-core', name: 'Stable Image Core', category: 'image', subcategory: 'general', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'stability', modelId: 'sd3.5-large', name: 'Stable Diffusion 3.5 Large', category: 'image', subcategory: 'general', costPerUnit: 0.065, creditsPerUnit: 5, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'stability', modelId: 'sd3.5-medium', name: 'Stable Diffusion 3.5 Medium', category: 'image', subcategory: 'fast', costPerUnit: 0.035, creditsPerUnit: 3, maxWidth: 1024, maxHeight: 1024 },
      // Stability AI — Edit
      { providerSlug: 'stability', modelId: 'stable-image-upscale', name: 'Image Upscale (4x)', category: 'edit', subcategory: 'upscale', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 4096, maxHeight: 4096 },
      { providerSlug: 'stability', modelId: 'stable-image-inpaint', name: 'Inpaint / Erase', category: 'edit', subcategory: 'inpaint', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'stability', modelId: 'stable-image-outpaint', name: 'Outpaint / Expand', category: 'edit', subcategory: 'outpaint', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 2048, maxHeight: 2048 },
      { providerSlug: 'stability', modelId: 'remove-background', name: 'Remove Background', category: 'edit', subcategory: 'background', costPerUnit: 0.02, creditsPerUnit: 2, maxWidth: 4096, maxHeight: 4096 },

      // Replicate — Image
      { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-1.1-pro', name: 'FLUX 1.1 Pro', category: 'image', subcategory: 'general', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 1440, maxHeight: 1440, isFeatured: true },
      { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-schnell', name: 'FLUX Schnell', category: 'image', subcategory: 'fast', costPerUnit: 0.003, creditsPerUnit: 1, maxWidth: 1024, maxHeight: 1024, isFeatured: true },
      { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-dev', name: 'FLUX Dev', category: 'image', subcategory: 'general', costPerUnit: 0.025, creditsPerUnit: 3, maxWidth: 1440, maxHeight: 1440 },
      { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-1.1-pro-ultra', name: 'FLUX 1.1 Pro Ultra', category: 'image', subcategory: 'premium', costPerUnit: 0.06, creditsPerUnit: 6, maxWidth: 2048, maxHeight: 2048 },
      // Replicate — Video
      { providerSlug: 'replicate', modelId: 'minimax/video-01', name: 'MiniMax Video-01', category: 'video', subcategory: 'general', costPerUnit: 0.20, creditsPerUnit: 12, maxDuration: 6 },

      // fal.ai — Image
      { providerSlug: 'fal', modelId: 'fal-ai/flux/dev', name: 'FLUX Dev (fal)', category: 'image', subcategory: 'general', costPerUnit: 0.025, creditsPerUnit: 3, maxWidth: 1440, maxHeight: 1440 },
      { providerSlug: 'fal', modelId: 'fal-ai/flux/schnell', name: 'FLUX Schnell (fal)', category: 'image', subcategory: 'fast', costPerUnit: 0.003, creditsPerUnit: 1, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'fal', modelId: 'fal-ai/flux-pro/v1.1', name: 'FLUX Pro 1.1 (fal)', category: 'image', subcategory: 'premium', costPerUnit: 0.05, creditsPerUnit: 5, maxWidth: 2048, maxHeight: 2048 },
      { providerSlug: 'fal', modelId: 'fal-ai/recraft-v3', name: 'Recraft V3', category: 'image', subcategory: 'general', costPerUnit: 0.04, creditsPerUnit: 4, maxWidth: 2048, maxHeight: 2048 },
      // fal.ai — Edit
      { providerSlug: 'fal', modelId: 'fal-ai/creative-upscaler', name: 'Creative Upscaler', category: 'edit', subcategory: 'upscale', costPerUnit: 0.05, creditsPerUnit: 5, maxWidth: 4096, maxHeight: 4096 },

      // Runway — Video
      { providerSlug: 'runway', modelId: 'gen4_turbo', name: 'Gen-4 Turbo', category: 'video', subcategory: 'premium', costPerUnit: 0.25, creditsPerUnit: 12, maxDuration: 10, isFeatured: true },
      { providerSlug: 'runway', modelId: 'gen3a_turbo', name: 'Gen-3 Alpha Turbo', category: 'video', subcategory: 'general', costPerUnit: 0.15, creditsPerUnit: 8, maxDuration: 10 },

      // Kling AI — Video
      { providerSlug: 'kling', modelId: 'kling-v2.5-pro', name: 'Kling 2.5 Pro', category: 'video', subcategory: 'premium', costPerUnit: 0.50, creditsPerUnit: 18, maxDuration: 10, isFeatured: true },
      { providerSlug: 'kling', modelId: 'kling-v2.5', name: 'Kling 2.5', category: 'video', subcategory: 'general', costPerUnit: 0.35, creditsPerUnit: 14, maxDuration: 10 },
      { providerSlug: 'kling', modelId: 'kling-v1.6', name: 'Kling 1.6', category: 'video', subcategory: 'fast', costPerUnit: 0.15, creditsPerUnit: 8, maxDuration: 5 },
      // Kling AI — Image
      { providerSlug: 'kling', modelId: 'kolors', name: 'Kolors', category: 'image', subcategory: 'general', costPerUnit: 0.02, creditsPerUnit: 2, maxWidth: 1024, maxHeight: 1024 },

      // Luma AI — Video
      { providerSlug: 'luma', modelId: 'ray-2', name: 'Ray 2', category: 'video', subcategory: 'premium', costPerUnit: 0.30, creditsPerUnit: 15, maxDuration: 10, isFeatured: true },
      { providerSlug: 'luma', modelId: 'ray-2-flash', name: 'Ray 2 Flash', category: 'video', subcategory: 'fast', costPerUnit: 0.10, creditsPerUnit: 6, maxDuration: 5 },

      // Leonardo.ai — Image
      { providerSlug: 'leonardo', modelId: 'phoenix-1.0', name: 'Phoenix 1.0', category: 'image', subcategory: 'general', costPerUnit: 0.02, creditsPerUnit: 2, maxWidth: 1472, maxHeight: 1472, isFeatured: true },
      { providerSlug: 'leonardo', modelId: 'kino-xl', name: 'Kino XL', category: 'image', subcategory: 'cinematic', costPerUnit: 0.03, creditsPerUnit: 3, maxWidth: 1024, maxHeight: 1024 },
      { providerSlug: 'leonardo', modelId: 'leonardo-diffusion-xl', name: 'Leonardo Diffusion XL', category: 'image', subcategory: 'general', costPerUnit: 0.02, creditsPerUnit: 2, maxWidth: 1024, maxHeight: 1024 },
    ];

    for (const m of models) {
      const provider = await prisma.aiProvider.findUnique({ where: { slug: m.providerSlug } });
      if (!provider) continue;

      await prisma.aiModel.upsert({
        where: { providerId_modelId: { providerId: provider.id, modelId: m.modelId } },
        create: {
          providerId: provider.id,
          modelId: m.modelId,
          name: m.name,
          category: m.category,
          subcategory: m.subcategory || null,
          costPerUnit: m.costPerUnit,
          creditsPerUnit: m.creditsPerUnit,
          maxWidth: m.maxWidth || null,
          maxHeight: m.maxHeight || null,
          maxDuration: m.maxDuration || null,
          isActive: true,
          isFeatured: m.isFeatured || false,
        },
        update: {
          name: m.name,
          category: m.category,
          subcategory: m.subcategory || null,
          costPerUnit: m.costPerUnit,
          creditsPerUnit: m.creditsPerUnit,
          maxWidth: m.maxWidth || null,
          maxHeight: m.maxHeight || null,
          maxDuration: m.maxDuration || null,
          isFeatured: m.isFeatured || false,
        },
      });
      results.models++;
    }

    // ══════════════════════════════════════════
    // 3. CREDIT PACKAGES
    // ══════════════════════════════════════════
    const packages = [
      { name: 'ทดลองใช้', slug: 'trial', credits: 20, priceThb: 0, priceUsd: 0, bonusCredits: 0, badge: 'ฟรี', isFeatured: false, sortOrder: 0, features: ['20 เครดิตฟรี', 'ภาพ ~5-7 ภาพ', 'วิดีโอ ~1 คลิป', 'สำหรับสมาชิกใหม่'] },
      { name: 'Starter', slug: 'starter', credits: 100, priceThb: 99, priceUsd: 2.99, bonusCredits: 0, badge: null, isFeatured: false, sortOrder: 1, features: ['100 เครดิต', 'ภาพ ~25-33 ภาพ', 'วิดีโอ ~5-8 คลิป', 'ไม่มีวันหมดอายุ'] },
      { name: 'Creator', slug: 'creator', credits: 500, priceThb: 399, priceUsd: 11.99, bonusCredits: 50, badge: 'ยอดนิยม', isFeatured: true, sortOrder: 2, features: ['500 + 50 โบนัส เครดิต', 'ภาพ ~137 ภาพ', 'วิดีโอ ~36 คลิป', 'ประหยัด 20%', 'ไม่มีวันหมดอายุ'] },
      { name: 'Pro', slug: 'pro', credits: 1500, priceThb: 999, priceUsd: 29.99, bonusCredits: 250, badge: 'คุ้มที่สุด', isFeatured: true, sortOrder: 3, features: ['1,500 + 250 โบนัส เครดิต', 'ภาพ ~437 ภาพ', 'วิดีโอ ~116 คลิป', 'ประหยัด 33%', 'ไม่มีวันหมดอายุ'] },
      { name: 'Enterprise', slug: 'enterprise', credits: 5000, priceThb: 2499, priceUsd: 74.99, bonusCredits: 1500, badge: 'สำหรับทีม', isFeatured: false, sortOrder: 4, features: ['5,000 + 1,500 โบนัส เครดิต', 'ภาพ ~1,625 ภาพ', 'วิดีโอ ~433 คลิป', 'ประหยัด 50%', 'ซัพพอร์ตพิเศษ'] },
    ];

    for (const pkg of packages) {
      await prisma.aiCreditPackage.upsert({
        where: { slug: pkg.slug },
        create: { ...pkg, features: JSON.stringify(pkg.features) },
        update: { name: pkg.name, credits: pkg.credits, priceThb: pkg.priceThb, priceUsd: pkg.priceUsd, bonusCredits: pkg.bonusCredits, badge: pkg.badge, isFeatured: pkg.isFeatured, sortOrder: pkg.sortOrder, features: JSON.stringify(pkg.features) },
      });
      results.packages++;
    }

    // ══════════════════════════════════════════
    // 4. AI STYLES
    // ══════════════════════════════════════════
    const styles = [
      { name: 'ไม่มีสไตล์', slug: 'none', description: 'ใช้ prompt ตรงๆ ไม่เพิ่ม style', promptSuffix: '', sortOrder: 0 },
      { name: 'Photorealistic', slug: 'photorealistic', description: 'ภาพถ่ายเหมือนจริง', promptSuffix: ', photorealistic, highly detailed, 8k uhd, professional photography, sharp focus', sortOrder: 1 },
      { name: 'Cinematic', slug: 'cinematic', description: 'สไตล์ภาพยนตร์ ดราม่า', promptSuffix: ', cinematic lighting, film grain, dramatic atmosphere, movie still, anamorphic lens', sortOrder: 2 },
      { name: 'Anime', slug: 'anime', description: 'สไตล์อนิเมะญี่ปุ่น', promptSuffix: ', anime style, vibrant colors, detailed, cel shaded, anime key visual, studio ghibli', sortOrder: 3 },
      { name: 'Digital Art', slug: 'digital-art', description: 'ศิลปะดิจิทัลสมัยใหม่', promptSuffix: ', digital art, vibrant colors, detailed illustration, artstation, concept art, trending', sortOrder: 4 },
      { name: 'Oil Painting', slug: 'oil-painting', description: 'ภาพสีน้ำมัน คลาสสิก', promptSuffix: ', oil painting style, textured brush strokes, classical art, rich colors, masterpiece', sortOrder: 5 },
      { name: 'Watercolor', slug: 'watercolor', description: 'สีน้ำโปร่งใส', promptSuffix: ', watercolor painting, soft edges, translucent, flowing colors, artistic, paper texture', sortOrder: 6 },
      { name: '3D Render', slug: '3d-render', description: 'งาน 3D เหมือน CGI', promptSuffix: ', 3d render, octane render, unreal engine 5, global illumination, subsurface scattering, ray tracing', sortOrder: 7 },
      { name: 'Pixel Art', slug: 'pixel-art', description: 'พิกเซลอาร์ท เรโทร', promptSuffix: ', pixel art, 16-bit style, retro gaming aesthetic, clean pixels, sprite style', sortOrder: 8 },
      { name: 'Minimalist', slug: 'minimalist', description: 'เรียบง่าย มินิมอล', promptSuffix: ', minimalist design, clean lines, simple shapes, white space, modern aesthetic', sortOrder: 9 },
      { name: 'Fantasy', slug: 'fantasy', description: 'แฟนตาซี มหัศจรรย์', promptSuffix: ', fantasy art, magical, ethereal, mystical atmosphere, epic scenery, enchanted, detailed illustration', sortOrder: 10 },
      { name: 'Cyberpunk', slug: 'cyberpunk', description: 'ไซเบอร์พังค์ นีออน', promptSuffix: ', cyberpunk style, neon lights, futuristic city, dark atmosphere, rain, holographic, blade runner', sortOrder: 11 },
      { name: 'Vintage', slug: 'vintage', description: 'วินเทจ ย้อนยุค', promptSuffix: ', vintage photography, retro aesthetic, muted colors, film grain, nostalgic, old school', sortOrder: 12 },
      { name: 'Isometric', slug: 'isometric', description: 'มุมมอง Isometric 3D', promptSuffix: ', isometric view, isometric art, detailed miniature, diorama style, clean design, 3d illustration', sortOrder: 13 },
      { name: 'Logo Design', slug: 'logo', description: 'ออกแบบโลโก้', promptSuffix: ', professional logo design, vector art, clean lines, modern branding, on white background, scalable', sortOrder: 14 },
    ];

    for (const s of styles) {
      await prisma.aiStyle.upsert({
        where: { slug: s.slug },
        create: { ...s, isActive: true },
        update: { name: s.name, description: s.description, promptSuffix: s.promptSuffix, sortOrder: s.sortOrder },
      });
      results.styles++;
    }

    // ══════════════════════════════════════════
    // 5. SYSTEM SETTINGS
    // ══════════════════════════════════════════
    const settingsList = [
      // General
      { key: 'site_name', value: 'XMAN AI Studio', type: 'string', group: 'general' },
      { key: 'site_description', value: 'AI Image & Video Generation Platform', type: 'string', group: 'general' },
      { key: 'site_url', value: 'https://ai.xman4289.com', type: 'string', group: 'general' },
      { key: 'default_language', value: 'th', type: 'string', group: 'general' },
      { key: 'maintenance_mode', value: 'false', type: 'boolean', group: 'general' },

      // Credits
      { key: 'new_user_free_credits', value: '20', type: 'number', group: 'credits' },
      { key: 'max_credits_per_generation', value: '50', type: 'number', group: 'credits' },
      { key: 'credit_expiry_days', value: '0', type: 'number', group: 'credits' },
      { key: 'referral_bonus_credits', value: '10', type: 'number', group: 'credits' },

      // Generation
      { key: 'max_prompt_length', value: '10000', type: 'number', group: 'generation' },
      { key: 'max_concurrent_generations', value: '3', type: 'number', group: 'generation' },
      { key: 'max_generations_per_day', value: '100', type: 'number', group: 'generation' },
      { key: 'default_image_model', value: 'seedream-3.0', type: 'string', group: 'generation' },
      { key: 'default_video_model', value: 'seedance-2.0', type: 'string', group: 'generation' },
      { key: 'auto_save_to_gallery', value: 'true', type: 'boolean', group: 'generation' },
      { key: 'nsfw_filter_enabled', value: 'true', type: 'boolean', group: 'generation' },
      { key: 'watermark_enabled', value: 'false', type: 'boolean', group: 'generation' },

      // Storage
      { key: 'storage_driver', value: 'local', type: 'string', group: 'storage' },
      { key: 'max_file_size_mb', value: '50', type: 'number', group: 'storage' },
      { key: 'image_output_format', value: 'webp', type: 'string', group: 'storage' },
      { key: 'image_quality', value: '90', type: 'number', group: 'storage' },
      { key: 'thumbnail_width', value: '512', type: 'number', group: 'storage' },

      // Rate Limiting
      { key: 'rate_limit_per_minute', value: '10', type: 'number', group: 'rate_limit' },
      { key: 'rate_limit_per_hour', value: '100', type: 'number', group: 'rate_limit' },
      { key: 'cooldown_after_errors', value: '300', type: 'number', group: 'rate_limit' },
      { key: 'max_consecutive_errors', value: '5', type: 'number', group: 'rate_limit' },

      // Integration
      { key: 'xman_webhook_enabled', value: 'true', type: 'boolean', group: 'integration' },
      { key: 'google_drive_enabled', value: 'false', type: 'boolean', group: 'integration' },
      { key: 'google_analytics_id', value: '', type: 'string', group: 'integration' },

      // System
      { key: 'setup_completed', value: 'true', type: 'boolean', group: 'system' },
      { key: 'seed_version', value: '1.0.0', type: 'string', group: 'system' },
    ];

    for (const s of settingsList) {
      await prisma.aiSetting.upsert({
        where: { key: s.key },
        create: s,
        update: { type: s.type, group: s.group },
      });
      results.settings++;
    }

    // ══════════════════════════════════════════
    // 6. TEMPLATES (prompt presets)
    // ══════════════════════════════════════════
    const templates = [
      { name: 'Portrait สวยงาม', category: 'portrait', prompt: 'Beautiful portrait of a young woman, soft natural lighting, bokeh background, professional photography, high detail, sharp focus', negativePrompt: 'ugly, blurry, deformed, low quality', isFeatured: true, sortOrder: 1 },
      { name: 'ทิวทัศน์มหัศจรรย์', category: 'landscape', prompt: 'Breathtaking landscape photography, golden hour, dramatic clouds, mountain valley with river, professional nature photography, 8k', negativePrompt: 'people, buildings, text, watermark', isFeatured: true, sortOrder: 2 },
      { name: 'Product Shot', category: 'product', prompt: 'Professional product photography, clean white background, studio lighting, high-end commercial photo, sharp details, minimalist', negativePrompt: 'text, watermark, blurry', isFeatured: false, sortOrder: 3 },
      { name: 'Logo Modern', category: 'design', prompt: 'Modern minimalist logo design, clean vector art, professional branding, geometric shapes, on solid white background', negativePrompt: 'realistic, photograph, text, complex', isFeatured: false, sortOrder: 4 },
      { name: 'Cyberpunk City', category: 'creative', prompt: 'Futuristic cyberpunk cityscape at night, neon lights, rain-soaked streets, flying vehicles, holographic billboards, blade runner style, highly detailed', negativePrompt: 'bright, daytime, nature', isFeatured: true, sortOrder: 5 },
      { name: 'Anime Character', category: 'anime', prompt: 'Beautiful anime character, vibrant colors, detailed eyes, flowing hair, dynamic pose, studio ghibli inspired, high quality anime key visual', negativePrompt: 'realistic, 3d, low quality', isFeatured: true, sortOrder: 6 },
      { name: 'อาหารน่ากิน', category: 'food', prompt: 'Delicious food photography, close-up, warm lighting, rustic wooden table, steam rising, appetizing, restaurant quality, food styling', negativePrompt: 'ugly, cold, unappetizing', isFeatured: false, sortOrder: 7 },
      { name: 'Interior Design', category: 'architecture', prompt: 'Luxurious modern interior design, minimalist architecture, natural light, floor-to-ceiling windows, warm wood tones, professional architectural photography', negativePrompt: 'people, clutter, dark', isFeatured: false, sortOrder: 8 },
    ];

    for (const t of templates) {
      const existing = await prisma.aiTemplate.findFirst({ where: { name: t.name } });
      if (!existing) {
        await prisma.aiTemplate.create({
          data: { ...t, isActive: true },
        });
      }
      results.templates++;
    }

    return NextResponse.json({
      success: true,
      message: 'Seed data created successfully',
      results,
    });
  } catch (error) {
    console.error('Seed failed:', error);
    return NextResponse.json(
      { error: 'Seed failed', details: String(error) },
      { status: 500 }
    );
  }
}
