import prisma from '@/lib/db';
import { getCatalogEntry } from '@/lib/gpu/catalog';
import { creditsForDuration } from '@/lib/pricing';
import { GenerationService } from '@/lib/services/generation';
import { generationErrorResponse } from '@/lib/services/generation-errors';
import { ModelReadiness } from '@/lib/services/model-readiness';
import { chatViaPool } from '@/lib/services/prompt-enhancer';
import {
  ASPECTS,
  MOVIE_MODEL_KEYS,
  buildShotPrompt,
  filmPlannerMessages,
  mvPlannerMessages,
  parseFilmPlan,
  parseMvPlan,
  planFromRules,
  renderSeconds,
  songTimeline,
  type CharacterLite,
  type PlanInput,
  type ShotDraft,
  type StoryMode,
} from './cinematic';

/**
 * Movie and MV projects: storage, planning, and ordering shots.
 *
 * Phase 1 renders each shot as an ordinary studio order (GenerationService:
 * content gate, readiness, price, refunds all apply), one ai_generations row
 * per shot, linked from ai_story_shots. Assembling the shots into one film is
 * phase 2.
 */

const projectInclude = {
  characters: { orderBy: { sortOrder: 'asc' as const } },
  shots: { orderBy: { shotNumber: 'asc' as const } },
};

const ORPHAN_CLAIM_MS = 10 * 60_000;

export type StoryProjectFull =NonNullable<Awaited<ReturnType<typeof loadOwnedProject>>>;

/** The project if it belongs to this user — every route goes through here. */
export async function loadOwnedProject(userId: number, projectId: number) {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  return prisma.aiStoryProject.findFirst({ where: { id: projectId, userId }, include: projectInclude });
}

export interface MovieModel {
  id: number;
  key: string;
  name: string;
  creditsPerUnit: number;
  orderable: boolean;
}

/** The video models a shot may use, as this caller may order them. */
export async function movieModels(admin: boolean): Promise<MovieModel[]> {
  const rows = await prisma.aiModel.findMany({
    where: { modelId: { in: [...MOVIE_MODEL_KEYS] }, isActive: true },
    select: { id: true, modelId: true, name: true, creditsPerUnit: true, readiness: true },
  });
  return MOVIE_MODEL_KEYS.flatMap((key) => {
    const m = rows.find((r) => r.modelId === key);
    return m ? [{ id: m.id, key, name: m.name, creditsPerUnit: m.creditsPerUnit, orderable: ModelReadiness.canOrder(m.readiness, admin) }] : [];
  });
}

/** What a shot costs on its model — the number GenerationService will charge. */
export function shotCredits(model: MovieModel | undefined, durationSec: number): number | null {
  if (!model) return null;
  return creditsForDuration(model.creditsPerUnit, getCatalogEntry(model.key)?.pricing.durationCurve, renderSeconds(durationSec));
}

export function characterLites(project: StoryProjectFull): CharacterLite[] {
  return project.characters.map((c) => ({ id: c.id, name: c.name, description: c.description, hasReference: Boolean(c.referenceUrl) }));
}

export function idList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => Number.isInteger(n)) : [];
}

export function shotDraftOf(shot: StoryProjectFull['shots'][number]): ShotDraft {
  return {
    characterIds: idList(shot.characterIds),
    speakerId: shot.speakerId,
    shotSize: shot.shotSize,
    camera: shot.camera,
    durationSec: Number(shot.durationSec),
    startSec: shot.startSec === null ? null : Number(shot.startSec),
    visual: shot.visualPrompt,
    line: shot.narration ?? '',
    sound: shot.sound ?? '',
  };
}

/**
 * Bring rendering shots up to date with their generation rows. Status writes
 * are conditional on 'rendering' and on the same generation, so a re-render
 * started meanwhile is never overwritten by the old order's result.
 */
export async function syncShots(project: StoryProjectFull): Promise<boolean> {
  let changed = false;
  // Claimed but never linked to an order (the process died between the two
  // writes): after a while it is released, or it would stay locked forever.
  const stale = project.shots.filter(
    (s) => s.status === 'rendering' && !s.visualGenerationId && Date.now() - s.updatedAt.getTime() > ORPHAN_CLAIM_MS
  );
  for (const shot of stale) {
    const r = await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, status: 'rendering', visualGenerationId: null },
      data: { status: 'failed', errorMessage: 'การสั่งสร้างไม่สมบูรณ์ — ตรวจในแกลเลอรีก่อนสั่งใหม่' },
    });
    changed ||= r.count > 0;
  }

  const rendering = project.shots.filter((s) => s.status === 'rendering' && s.visualGenerationId);
  if (rendering.length === 0) return changed;
  const gens = await prisma.aiGeneration.findMany({
    where: { id: { in: rendering.map((s) => s.visualGenerationId!) }, userId: project.userId },
    select: { id: true, status: true, resultUrl: true, errorMessage: true, creditsRefunded: true },
  });
  for (const shot of rendering) {
    const gen = gens.find((g) => g.id === shot.visualGenerationId);
    if (!gen) continue;
    if (gen.status === 'completed' && gen.resultUrl) {
      const r = await prisma.aiStoryShot.updateMany({
        where: { id: shot.id, status: 'rendering', visualGenerationId: gen.id },
        data: { status: 'done', mediaUrl: gen.resultUrl, errorMessage: null },
      });
      changed ||= r.count > 0;
    } else if (gen.status === 'failed' || gen.status === 'cancelled') {
      const refunded = gen.creditsRefunded > 0 ? ' (คืนเครดิตแล้ว)' : '';
      const r = await prisma.aiStoryShot.updateMany({
        where: { id: shot.id, status: 'rendering', visualGenerationId: gen.id },
        data: { status: 'failed', errorMessage: `สร้างช็อตไม่สำเร็จ${refunded} — ลองสร้างใหม่ได้` },
      });
      changed ||= r.count > 0;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export class StoryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Write (or rewrite) the storyboard. Refused while any shot is rendering —
 * replacing it would orphan an order in flight. Finished shots are replaced
 * too; the page asks before it calls this when there are any.
 */
export async function planProject(
  project: StoryProjectFull,
  defaultModelId: number | null
): Promise<{ shots: number; engine: string; fallbackReason?: string }> {
  if (project.shots.some((s) => s.status === 'rendering')) {
    throw new StoryError('มีช็อตกำลังสร้างอยู่ รอให้เสร็จก่อนแล้วค่อยให้ AI วางช็อตใหม่', 409);
  }
  const mode = project.mode as StoryMode;
  const input: PlanInput = {
    mode,
    brief: project.brief,
    characters: characterLites(project),
    look: project.templateKey,
    mood: project.mood ?? '',
    songSeconds: Number(project.songSeconds ?? 0),
  };

  let planned: { title: string; shots: ShotDraft[] } | null = null;
  let engine = 'rules';
  let fallbackReason: string | undefined;
  try {
    if (mode === 'mv') {
      const slots = songTimeline(input.brief, input.songSeconds);
      if (slots.length === 0) throw new StoryError('เพลงสั้นเกินไปหรือไม่มีความยาว — เลือกเพลงใหม่', 422);
      const { system, user } = mvPlannerMessages(input, slots);
      const reply = await chatViaPool(system, user, { maxTokens: 8000, maxChars: 60_000 });
      planned = parseMvPlan(reply.text, input, slots);
      engine = reply.engine;
    } else {
      const { system, user } = filmPlannerMessages(input);
      const reply = await chatViaPool(system, user, { maxTokens: 5000, maxChars: 40_000 });
      planned = parseFilmPlan(reply.text, input);
      engine = reply.engine;
    }
    if (!planned) fallbackReason = `${engine} answered with no usable storyboard`;
  } catch (error) {
    if (error instanceof StoryError) throw error;
    fallbackReason = (error as Error).message;
  }
  if (!planned) {
    planned = { title: '', shots: planFromRules(input) };
    engine = 'rules';
  }
  if (planned.shots.length === 0) throw new StoryError('เขียนเรื่องหรือเนื้อเพลงให้ยาวกว่านี้ แล้วลองใหม่', 422);

  await prisma.$transaction(async (tx) => {
    // Conditional: a render started between our check and here keeps its shot.
    const busy = await tx.aiStoryShot.count({ where: { projectId: project.id, status: 'rendering' } });
    if (busy > 0) throw new StoryError('มีช็อตกำลังสร้างอยู่ รอให้เสร็จก่อนแล้วค่อยให้ AI วางช็อตใหม่', 409);
    await tx.aiStoryShot.deleteMany({ where: { projectId: project.id } });
    await tx.aiStoryShot.createMany({
      data: planned!.shots.map((s, k) => ({
        projectId: project.id,
        shotNumber: k + 1,
        visualPrompt: s.visual,
        narration: s.line || null,
        characterIds: s.characterIds,
        speakerId: s.speakerId,
        shotSize: s.shotSize,
        camera: s.camera,
        sound: s.sound || null,
        modelId: defaultModelId,
        startSec: s.startSec,
        durationSec: Math.round(s.durationSec * 100) / 100,
      })),
    });
    const isPlaceholderTitle = !project.title.trim() || project.title === 'โปรเจกต์ใหม่';
    await tx.aiStoryProject.update({
      where: { id: project.id },
      data: { status: 'draft', ...(isPlaceholderTitle && planned!.title ? { title: planned!.title } : {}) },
    });
  });
  return { shots: planned.shots.length, engine, fallbackReason };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Order one shot. The shot is claimed (→ rendering) with a conditional update
 * first, so a double click or two tabs cannot place the order twice; a refusal
 * puts it back as failed with the reason, and no credit has moved then.
 */
export async function renderShot(
  userId: number,
  admin: boolean,
  project: StoryProjectFull,
  shotId: number,
  models: MovieModel[]
): Promise<{ generationId: number }> {
  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) throw new StoryError('ไม่พบช็อตนี้', 404);
  const model = models.find((m) => m.id === shot.modelId);
  if (!model) throw new StoryError(`ช็อต ${shot.shotNumber}: เลือกโมเดลวิดีโอก่อน`, 422);
  if (!model.orderable) throw new StoryError(`ช็อต ${shot.shotNumber}: ${model.name} ยังเปิดให้ใช้ไม่ได้ เลือกโมเดลอื่น`, 409);
  if (!shot.visualPrompt.trim()) throw new StoryError(`ช็อต ${shot.shotNumber}: ยังไม่มีคำบรรยายภาพ`, 422);

  const claimed = await prisma.aiStoryShot.updateMany({
    where: { id: shot.id, projectId: project.id, status: { in: ['pending', 'failed', 'done'] } },
    // Unlinked from the previous order, so a sync meanwhile cannot settle this
    // claim with the old clip.
    data: { status: 'rendering', errorMessage: null, visualGenerationId: null },
  });
  if (claimed.count === 0) throw new StoryError(`ช็อต ${shot.shotNumber} กำลังสร้างอยู่แล้ว`, 409);

  const draft = shotDraftOf(shot);
  const lead = project.characters.find((c) => c.id === draft.characterIds[0]);
  const firstFrame = lead?.referenceUrl ?? undefined;
  const frame = ASPECTS[project.aspectRatio] ?? ASPECTS['16:9'];
  const prompt = buildShotPrompt(model.key, draft, {
    mode: project.mode as StoryMode,
    look: project.templateKey,
    mood: project.mood ?? '',
    characters: characterLites(project),
    hasFirstFrame: Boolean(firstFrame),
  });

  try {
    const result = await GenerationService.generate(
      userId,
      {
        modelId: model.id,
        type: 'video',
        prompt,
        inputImage: firstFrame,
        params: { width: frame.width, height: frame.height, aspectRatio: project.aspectRatio, duration: renderSeconds(draft.durationSec) },
      },
      { isAdmin: admin }
    );
    await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, status: 'rendering', visualGenerationId: null },
      data: { visualGenerationId: result.id, mediaUrl: null },
    });
    await prisma.aiStoryProject.update({ where: { id: project.id }, data: { status: 'rendering' } });
    return { generationId: result.id };
  } catch (error) {
    await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, status: 'rendering', visualGenerationId: null },
      data: { status: 'failed', errorMessage: customerMessage(error) },
    });
    throw error;
  }
}

/** What the customer may read about a refused order — never an internal message. */
export function customerMessage(error: unknown): string {
  if (error instanceof StoryError) return error.message;
  const known = generationErrorResponse(error);
  if (!known) return 'สั่งสร้างไม่สำเร็จ ลองใหม่อีกครั้ง';
  if (known.status === 402) return 'เครดิตไม่พอ เติมเครดิตแล้วลองใหม่';
  if (known.status === 503) return 'ระบบสร้างวิดีโอไม่ว่างชั่วคราว ลองใหม่ภายหลัง';
  if (known.status === 404) return 'โมเดลนี้ปิดใช้งานอยู่ เลือกโมเดลอื่น';
  return known.body.error;
}
