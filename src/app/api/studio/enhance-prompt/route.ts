import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { chatViaPool, enhancePrompt, getEnhancerConfig, type EnhanceKind } from '@/lib/services/prompt-enhancer';
import { LYRICS_BRIEF, isDraft, linesChanged, lyricsFailure, lyricsRequest, tagStanzas, tidyLyrics } from '@/lib/lyrics/write';
import { composeMusicTags, sanitizeMusicParams } from '@/lib/music-style';
import { requestLocale, translator } from '@/lib/i18n/locale';

/**
 * POST /api/studio/enhance-prompt — the studio's "✨ ปรับพรอมต์ด้วย AI".
 *
 * Free to the customer and limited per hour instead: a Context-IR or chat call
 * costs us a fraction of a cent, and the limit is what stops it being a free
 * LLM for anyone with an account. The answer goes back into the prompt box,
 * where the customer can read and edit it before ordering.
 *
 * `tab: 'lyrics'` is the ✨ on the lyrics box: the same door and the same
 * hourly allowance, another writer (lyrics/write.ts).
 */

export const dynamic = 'force-dynamic';
// Context-IR is a queued task that can take a minute or two.
export const maxDuration = 150;

const KINDS: EnhanceKind[] = ['image', 'video', 'audio', 'edit', 'lipsync'];
const MAX_PROMPT = 4000;
/**
 * A thinking model spends most of the tokens before it answers: Thai lyrics
 * ran dry at 4,000 and took 18–52 s at 16,000 (measured 2026-10-31). The clock
 * stops short of a proxy's 100 s, so the customer hears why from us.
 */
const LYRICS_LIMITS = { maxTokens: 16_000, maxChars: 8000, timeoutMs: 90_000 };

export async function POST(request: NextRequest) {
  const t = translator(requestLocale(request));
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: t('กรุณาเข้าสู่ระบบ', 'Please sign in') }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: t('พิมพ์ไอเดียสั้น ๆ ก่อน แล้วค่อยให้ AI ช่วยขยาย', 'Type a short idea first, then let the AI expand it') }, { status: 400 });
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: t(`พรอมต์ยาวเกิน ${MAX_PROMPT.toLocaleString('en-US')} ตัวอักษร`, `The prompt is longer than ${MAX_PROMPT.toLocaleString('en-US')} characters`) }, { status: 400 });
  }
  const kind = KINDS.includes(body?.tab as EnhanceKind) ? (body?.tab as EnhanceKind) : 'image';

  const [admin, cfg] = await Promise.all([isAdmin(), getEnhancerConfig()]);
  if (!admin) {
    if (cfg.hourlyLimit === 0) {
      return NextResponse.json({ error: t('ผู้ช่วยเขียนพรอมต์ปิดอยู่ในขณะนี้', 'The prompt assistant is switched off right now') }, { status: 403 });
    }
    const limit = rateLimit(`enhance:${userId}`, cfg.hourlyLimit, 60 * 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: t(
            `ใช้ผู้ช่วย AI ครบ ${cfg.hourlyLimit} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ในอีก ${Math.ceil(limit.retryAfter / 60)} นาที`,
            `You’ve used the AI assistant ${cfg.hourlyLimit} times this hour. Try again in ${Math.ceil(limit.retryAfter / 60)} min.`
          ),
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
      );
    }
  }

  if (body?.tab === 'lyrics') return writeLyrics(prompt, body, admin, t);

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

/** The words for `text`, or rough words sorted by rule, and always the reason when the model gave none. */
async function writeLyrics(text: string, body: Record<string, unknown>, admin: boolean, t: ReturnType<typeof translator>) {
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
  const style = composeMusicTags(description, sanitizeMusicParams(body.music));
  let failed: string;
  try {
    const reply = await chatViaPool(LYRICS_BRIEF, lyricsRequest({ text, style, continuation: body.sunoTool === 'extend' }), LYRICS_LIMITS);
    const lyrics = tidyLyrics(reply.text);
    if (lyrics) {
      return NextResponse.json({
        prompt: lyrics,
        source: 'llm',
        changed: isDraft(text) ? linesChanged(text, lyrics) : 0,
        ...(admin ? { engine: reply.engine } : {}),
      });
    }
    failed = `${reply.engine} answered with no song sections`;
  } catch (error) {
    failed = (error as Error).message;
  }
  console.error(`[lyrics] ${failed}`);
  const reason = t(lyricsFailure(failed));
  const sorted = tagStanzas(text);
  if (sorted) return NextResponse.json({ prompt: sorted, source: 'rules', reason });
  return NextResponse.json({ error: reason }, { status: 503 });
}
