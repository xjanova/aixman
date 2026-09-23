import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import {
  DEFAULT_ENHANCER,
  DEFAULT_MODEL,
  enhancePrompt,
  getEnhancerConfig,
  saveEnhancerConfig,
  type EnhanceKind,
  type EnhancerConfig,
  type EnhancerProvider,
} from '@/lib/services/prompt-enhancer';

/**
 * The prompt assistant's settings for /admin/workflows, and a test button.
 *
 * GET  — the config plus which providers have a usable key right now.
 * PUT  — save it.
 * POST — run one enhancement exactly as a customer would get it, and report
 *        which engine answered and why better ones were skipped.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

const PROVIDERS: EnhancerProvider[] = ['auto', 'openai', 'minimax', 'byteplus', 'pollinations', 'off'];

async function keyStatus(): Promise<Record<string, boolean>> {
  const rows = await prisma.aiProvider.findMany({
    where: { slug: { in: ['openai', 'minimax', 'byteplus', 'pollinations'] } },
    select: { slug: true, isActive: true, accounts: { where: { isActive: true }, select: { id: true } } },
  });
  const out: Record<string, boolean> = { openai: false, minimax: false, byteplus: false, pollinations: false };
  for (const r of rows) out[r.slug] = r.isActive && r.accounts.length > 0;
  return out;
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [config, keys] = await Promise.all([getEnhancerConfig(), keyStatus()]);
  return NextResponse.json({ config, keys, defaults: { config: DEFAULT_ENHANCER, models: DEFAULT_MODEL } });
}

export async function PUT(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Partial<EnhancerConfig> | null;
  if (!body) return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 });

  const provider = PROVIDERS.includes(body.provider as EnhancerProvider) ? (body.provider as EnhancerProvider) : null;
  if (!provider) return NextResponse.json({ error: 'เลือกผู้ให้บริการไม่ถูกต้อง' }, { status: 400 });
  const limit = Number(body.hourlyLimit);
  if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
    return NextResponse.json({ error: 'จำกัดต่อชั่วโมงต้องอยู่ระหว่าง 0–1000 (0 = ปิดสำหรับลูกค้า)' }, { status: 400 });
  }
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const config: EnhancerConfig = {
    provider,
    model: text(body.model).trim(),
    h3ContextIr: body.h3ContextIr !== false,
    hourlyLimit: Math.round(limit),
    instructions: {
      image: text(body.instructions?.image),
      video: text(body.instructions?.video),
      audio: text(body.instructions?.audio),
    },
  };
  await saveEnhancerConfig(config);
  return NextResponse.json({ config });
}

/** Test the assistant with the config sent (saved or not). */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    config?: Partial<EnhancerConfig>;
    prompt?: string;
    kind?: EnhanceKind;
    modelKey?: string;
    videoMode?: 't2v' | 'i2v' | 'fl2v';
  } | null;
  const prompt = typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 2000) : 'แมวส้มนั่งบนหลังคาวัดตอนพระอาทิตย์ตก';
  const saved = await getEnhancerConfig();
  const cfg: EnhancerConfig = {
    ...saved,
    ...(body?.config ?? {}),
    instructions: { ...saved.instructions, ...(body?.config?.instructions ?? {}) },
  } as EnhancerConfig;
  if (!PROVIDERS.includes(cfg.provider)) cfg.provider = saved.provider;

  const started = Date.now();
  const result = await enhancePrompt(
    {
      prompt,
      kind: body?.kind ?? 'image',
      modelKey: body?.modelKey,
      videoMode: body?.videoMode,
      durationSeconds: 5,
      aspectRatio: '16:9',
    },
    cfg
  );
  return NextResponse.json({ ...result, ms: Date.now() - started });
}
