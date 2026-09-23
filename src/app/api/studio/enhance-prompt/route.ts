import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { enhancePrompt, getEnhancerConfig, type EnhanceKind } from '@/lib/services/prompt-enhancer';

/**
 * POST /api/studio/enhance-prompt — the studio's "✨ ปรับพรอมต์ด้วย AI".
 *
 * Free to the customer and limited per hour instead: a Context-IR or chat call
 * costs us a fraction of a cent, and the limit is what stops it being a free
 * LLM for anyone with an account. The answer goes back into the prompt box,
 * where the customer can read and edit it before ordering.
 */

export const dynamic = 'force-dynamic';
// Context-IR is a queued task that can take a minute or two.
export const maxDuration = 150;

const KINDS: EnhanceKind[] = ['image', 'video', 'audio', 'edit', 'lipsync'];
const MAX_PROMPT = 4000;

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'พิมพ์ไอเดียสั้น ๆ ก่อน แล้วค่อยให้ AI ช่วยขยาย' }, { status: 400 });
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `พรอมต์ยาวเกิน ${MAX_PROMPT.toLocaleString()} ตัวอักษร` }, { status: 400 });
  }
  const kind = KINDS.includes(body?.tab as EnhanceKind) ? (body?.tab as EnhanceKind) : 'image';

  const [admin, cfg] = await Promise.all([isAdmin(), getEnhancerConfig()]);
  if (!admin) {
    if (cfg.hourlyLimit === 0) {
      return NextResponse.json({ error: 'ผู้ช่วยเขียนพรอมต์ปิดอยู่ในขณะนี้' }, { status: 403 });
    }
    const limit = rateLimit(`enhance:${userId}`, cfg.hourlyLimit, 60 * 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: `ใช้ผู้ช่วย AI ครบ ${cfg.hourlyLimit} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${Math.ceil(limit.retryAfter / 60)} นาที` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
      );
    }
  }

  // The model decides which brief applies (H3 self-host has its own format).
  const modelId = Number(body?.modelId);
  const model = Number.isInteger(modelId) && modelId > 0
    ? await prisma.aiModel.findUnique({ where: { id: modelId }, select: { modelId: true, provider: { select: { slug: true } } } })
    : null;

  const mode = body?.videoMode === 'i2v' ? (typeof body?.lastFrame === 'string' && body.lastFrame ? 'fl2v' : 'i2v') : 't2v';
  const result = await enhancePrompt({
    prompt,
    kind,
    modelKey: model?.modelId,
    providerSlug: model?.provider.slug,
    videoMode: kind === 'video' ? mode : undefined,
    durationSeconds: Number(body?.duration) || undefined,
    aspectRatio: typeof body?.aspectRatio === 'string' ? body.aspectRatio : undefined,
    firstFrame: typeof body?.firstFrame === 'string' ? body.firstFrame : undefined,
    lastFrame: typeof body?.lastFrame === 'string' ? body.lastFrame : undefined,
  }, cfg);

  return NextResponse.json({
    prompt: result.prompt,
    source: result.source,
    // Which engine answered is shown to admins only — customers see the text.
    ...(admin ? { engine: result.engine, fallbackReason: result.fallbackReason ?? null } : {}),
  });
}
