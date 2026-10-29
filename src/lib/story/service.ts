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
  LIMITS,
  buildShotPrompt,
  filmOutlineMessages,
  filmPartCount,
  filmPlannerMessages,
  filmTarget,
  fitToTarget,
  partShotBudget,
  mvPlannerMessages,
  parseFilmOutline,
  parseFilmPlan,
  parseMvPlan,
  planFromRules,
  renderSeconds,
  songTimeline,
  type CharacterLite,
  type ShotDraft,
  type StoryMode,
  type TimelineSlot,
} from './cinematic';
import { asLite, assetPictures, isAssetKind, spliceScene, type AssetKind, type LibraryAsset, type StructureInput, type StructurePlan } from './library';
import { planMvSlots, planSceneShots, planStructuredFilm, type SceneBrief } from './structure';
import { ASSEMBLE_PRICE_DEFAULTS, musicPrompt, musicSeconds } from './edit';
import type { Prisma } from '@/generated/prisma/client';
import type { Locale, Msg } from '@/lib/i18n/locale';
import { UserMessageError, packMsg, registerStoredMsgs } from '@/lib/i18n/messages';

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
  acts: { orderBy: { actNumber: 'asc' as const } },
  scenes: { orderBy: { sceneNumber: 'asc' as const } },
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

/** The project's reference library: characters, props and places with their pictures. */
export function libraryOf(project: StoryProjectFull): LibraryAsset[] {
  return project.characters.map((c) => ({
    id: c.id,
    kind: isAssetKind(c.kind) ? c.kind : 'character',
    name: c.name,
    description: c.description,
    pictures: assetPictures(c),
  }));
}

export function libraryLites(project: StoryProjectFull, kind: AssetKind): CharacterLite[] {
  return libraryOf(project).filter((a) => a.kind === kind).map(asLite);
}

export function characterLites(project: StoryProjectFull): CharacterLite[] {
  return libraryLites(project, 'character');
}

function planInputOf(project: StoryProjectFull): StructureInput {
  const mode = project.mode as StoryMode;
  return {
    mode,
    brief: project.brief,
    characters: characterLites(project),
    props: libraryLites(project, 'prop'),
    locations: libraryLites(project, 'location'),
    look: project.templateKey,
    mood: project.mood ?? '',
    songSeconds: Number(project.songSeconds ?? 0),
    targetSeconds: mode === 'film' ? filmTarget(project.scriptJson) : null,
  };
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
    propIds: idList(shot.propIds),
    locationId: shot.locationId,
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
      data: { status: 'failed', errorMessage: packMsg(ORDER_INCOMPLETE) },
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
      const r = await prisma.aiStoryShot.updateMany({
        where: { id: shot.id, status: 'rendering', visualGenerationId: gen.id },
        data: { status: 'failed', errorMessage: packMsg(shotFailed(gen.creditsRefunded > 0)) },
      });
      changed ||= r.count > 0;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * A refusal the customer reads, in both languages (`message` stays the Thai),
 * with the HTTP status the route answers with.
 */
export class StoryError extends UserMessageError {
  constructor(msg: Msg, readonly status = 400) {
    super(msg);
    this.name = 'StoryError';
  }
}

// Failure reasons written to shot rows and read back later (packMsg).
const ORDER_INCOMPLETE: Msg = {
  th: 'การสั่งสร้างไม่สมบูรณ์ — ตรวจในแกลเลอรีก่อนสั่งใหม่',
  en: "The order didn't finish — check your gallery before ordering again.",
};
const shotFailed = (refunded: boolean): Msg =>
  refunded
    ? { th: 'สร้างช็อตไม่สำเร็จ (คืนเครดิตแล้ว) — ลองสร้างใหม่ได้', en: "Couldn't make this shot. Your credits have been refunded — you can try again." }
    : { th: 'สร้างช็อตไม่สำเร็จ — ลองสร้างใหม่ได้', en: "Couldn't make this shot — you can try again." };
const ORDER_FAILED: Msg = { th: 'สั่งสร้างไม่สำเร็จ ลองใหม่อีกครั้ง', en: "The order didn't go through. Please try again." };
const NO_CREDITS: Msg = { th: 'เครดิตไม่พอ เติมเครดิตแล้วลองใหม่', en: 'Not enough credits. Top up and try again.' };
const VIDEO_BUSY: Msg = { th: 'ระบบสร้างวิดีโอไม่ว่างชั่วคราว ลองใหม่ภายหลัง', en: 'Video rendering is busy right now. Please try again later.' };
const MODEL_OFF: Msg = { th: 'โมเดลนี้ปิดใช้งานอยู่ เลือกโมเดลอื่น', en: 'This model is switched off. Please pick another one.' };
// Rows written before messages were stored in both languages hold these in Thai only.
registerStoredMsgs(ORDER_INCOMPLETE, shotFailed(true), shotFailed(false), ORDER_FAILED, NO_CREDITS, VIDEO_BUSY, MODEL_OFF);

/** The title a project gets when the customer leaves it blank — the plan may replace it. */
export const NEW_PROJECT_TITLE: Msg = { th: 'โปรเจกต์ใหม่', en: 'New project' };

/**
 * A long film in two steps, so no chat call has to write the whole thing: an
 * outline of FILM_PART_SECONDS parts, then every part's shots at once. A part
 * the model fails is laid out by the rules from its outline line, so one bad
 * answer costs that part its polish, not the film.
 */
async function planLongFilm(input: StructureInput): Promise<{ planned: { title: string; shots: ShotDraft[] } | null; engine: string; fallbackReason?: string }> {
  const target = input.targetSeconds!;
  const count = filmPartCount(target);
  const head = filmOutlineMessages(input, count);
  const reply = await chatViaPool(head.system, head.user, { maxTokens: 8000, maxChars: 30_000, timeoutMs: 90_000 });
  const outline = parseFilmOutline(reply.text, count);
  if (!outline) return { planned: null, engine: reply.engine, fallbackReason: `${reply.engine} answered with no usable outline` };

  const seconds = target / count;
  const budget = partShotBudget(count);
  const failed: string[] = [];
  const parts = await Promise.all(
    outline.parts.map(async (summary, index) => {
      const part = { index, count, summary, seconds, outline: outline.parts, maxShots: budget };
      const { system, user } = filmPlannerMessages(input, part);
      // A thinking model may spend its whole budget reasoning; one retry
      // before this part falls back to the rules.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const answer = await chatViaPool(system, user, { maxTokens: 16_000, maxChars: 60_000, timeoutMs: 120_000 });
          const plan = parseFilmPlan(answer.text, input);
          if (plan) return fitToTarget(plan.shots.slice(0, budget), seconds);
          failed.push(`part ${index + 1} try ${attempt}: no usable shots`);
        } catch (error) {
          failed.push(`part ${index + 1} try ${attempt}: ${(error as Error).message.slice(0, 200)}`);
        }
      }
      return fitToTarget(planFromRules({ ...input, brief: summary, targetSeconds: seconds }).slice(0, budget), seconds);
    })
  );
  return {
    planned: { title: outline.title, shots: parts.flat().slice(0, LIMITS.shotsFilm) },
    engine: `${reply.engine} · ${count} parts`,
    fallbackReason: failed.length ? failed.join(' | ') : undefined,
  };
}

/**
 * An MV song section's name as the page shows it — stored as the scene's
 * title, in the language of whoever asked for the plan.
 */
export function sectionTitle(section: string, locale: Locale = 'th'): string {
  const t = section.trim().toLowerCase();
  const n = /\d+/.exec(t)?.[0];
  const named: Msg | null = /pre-?chorus/.test(t)
    ? { th: 'ก่อนฮุก', en: 'Pre-chorus' }
    : /chorus|hook/.test(t)
      ? { th: 'ท่อนฮุก', en: 'Chorus' }
      : /verse/.test(t)
        ? { th: 'ท่อนร้อง', en: 'Verse' }
        : /bridge/.test(t)
          ? { th: 'บริดจ์', en: 'Bridge' }
          : /intro/.test(t)
            ? { th: 'อินโทร', en: 'Intro' }
            : /outro|end/.test(t)
              ? { th: 'เอาท์โทร', en: 'Outro' }
              : /inst|solo|break|interlude|drop/.test(t)
                ? { th: 'ดนตรี', en: 'Instrumental' }
                : null;
  const name = named ? named[locale] : section.trim() || { th: 'ท่อน', en: 'Section' }[locale];
  return n ? `${name} ${n}` : name;
}

function shotData(s: ShotDraft, projectId: number, shotNumber: number, modelId: number | null, sceneId: number | null, propIds: number[]) {
  return {
    projectId,
    sceneId,
    shotNumber,
    visualPrompt: s.visual,
    narration: s.line || null,
    characterIds: s.characterIds,
    propIds,
    locationId: s.locationId ?? null,
    speakerId: s.speakerId,
    shotSize: s.shotSize,
    camera: s.camera,
    sound: s.sound || null,
    modelId,
    startSec: s.startSec,
    durationSec: Math.round(s.durationSec * 100) / 100,
  };
}

export const BUSY_MESSAGE: Msg = {
  th: 'มีช็อตหรือภาพเปิดช็อตกำลังสร้างอยู่ รอให้เสร็จก่อนแล้วค่อยให้ AI วางช็อตใหม่',
  en: 'A shot or opening picture is still being made. Wait for it to finish, then let AI re-plan.',
};
/** A shot whose clip or opening picture is being made: an order in flight owns it. */
export const isBusyShot = (s: { status: string; keyframeStatus: string | null }) => s.status === 'rendering' || s.keyframeStatus === 'rendering';
const BUSY_WHERE = [{ status: 'rendering' }, { keyframeStatus: 'rendering' }];

/**
 * Write (or rewrite) the storyboard. A film is cut into acts and scenes first
 * (structure.ts), naming the places and props it needs — new ones join the
 * library without pictures — then each run of scenes gets its shots. When the
 * structure step fails, the older outline/parts planner runs, then the rules.
 * An MV's scenes are its song's sections.
 *
 * Refused while any shot or its opening picture is rendering — replacing it
 * would orphan an order in flight. Finished shots, acts and scenes are replaced too; the page asks
 * before it calls this when there are any.
 */
export async function planProject(
  project: StoryProjectFull,
  defaultModelId: number | null,
  /** The language of the scene titles written here (an MV's song sections). */
  locale: Locale = 'th'
): Promise<{ shots: number; engine: string; fallbackReason?: string }> {
  if (project.shots.some(isBusyShot)) throw new StoryError(BUSY_MESSAGE, 409);
  const mode = project.mode as StoryMode;
  const input = planInputOf(project);

  let planned: { title: string; shots: ShotDraft[] } | null = null;
  let structure: StructurePlan | null = null;
  let slots: TimelineSlot[] = [];
  let engine = 'rules';
  let fallbackReason: string | undefined;
  try {
    if (mode === 'mv') {
      slots = songTimeline(input.brief, input.songSeconds);
      if (slots.length === 0) throw new StoryError({ th: 'เพลงสั้นเกินไปหรือไม่มีความยาว — เลือกเพลงใหม่', en: 'The song is too short or has no length. Pick another song.' }, 422);
      const { system, user } = mvPlannerMessages(input, slots);
      const reply = await chatViaPool(system, user, { maxTokens: 8000, maxChars: 60_000 });
      planned = parseMvPlan(reply.text, input, slots);
      engine = reply.engine;
    } else {
      const structured = await planStructuredFilm(input).catch((error: Error) => {
        fallbackReason = `structure: ${error.message.slice(0, 200)}`;
        return null;
      });
      if (structured) {
        structure = structured.structure;
        planned = { title: structure.title, shots: structured.shots };
        engine = structured.engine;
        fallbackReason = structured.fallbackReason;
      } else if (filmPartCount(input.targetSeconds) > 0) {
        const long = await planLongFilm(input);
        planned = long.planned;
        engine = long.engine;
        fallbackReason = [fallbackReason, long.fallbackReason].filter(Boolean).join(' | ') || undefined;
      } else {
        const { system, user } = filmPlannerMessages(input);
        const reply = await chatViaPool(system, user, { maxTokens: 5000, maxChars: 40_000 });
        planned = parseFilmPlan(reply.text, input);
        if (planned && input.targetSeconds) planned.shots = fitToTarget(planned.shots, input.targetSeconds);
        engine = reply.engine;
      }
    }
    if (!planned) fallbackReason ??= `${engine} answered with no usable storyboard`;
  } catch (error) {
    if (error instanceof StoryError) throw error;
    fallbackReason = (error as Error).message;
  }
  if (!planned) {
    planned = { title: '', shots: planFromRules(input) };
    engine = 'rules';
  }
  if (planned.shots.length === 0) throw new StoryError({ th: 'เขียนเรื่องหรือเนื้อเพลงให้ยาวกว่านี้ แล้วลองใหม่', en: 'Write a longer story or more lyrics, then try again.' }, 422);
  const shots = planned.shots;
  // An MV's shots are its slots, in order, from the planner or the rules alike.
  const sections = mode === 'mv' && slots.length === shots.length ? slots.map((sl) => sl.section) : null;

  await prisma.$transaction(async (tx) => {
    // Conditional: a render started between our check and here keeps its shot.
    const busy = await tx.aiStoryShot.count({ where: { projectId: project.id, OR: BUSY_WHERE } });
    if (busy > 0) throw new StoryError(BUSY_MESSAGE, 409);
    await tx.aiStoryShot.deleteMany({ where: { projectId: project.id } });
    await tx.aiStoryScene.deleteMany({ where: { projectId: project.id } });
    await tx.aiStoryAct.deleteMany({ where: { projectId: project.id } });

    // Places and props the structure named that the library did not have.
    const created: Record<'location' | 'prop', number[]> = { location: [], prop: [] };
    if (structure) {
      let order = project.characters.length;
      for (const [kind, list] of [['location', structure.newLocations], ['prop', structure.newProps]] as const) {
        for (const a of list) {
          const row = await tx.aiStoryCharacter.create({
            data: { projectId: project.id, kind, name: a.name, description: a.description, origin: 'planned', sortOrder: order++ },
          });
          created[kind].push(row.id);
        }
      }
    }
    const real = (kind: 'location' | 'prop', id: number | null | undefined): number | null =>
      id === null || id === undefined ? null : id >= 0 ? id : created[kind][-1 - id] ?? null;
    const props = (ids: number[] | undefined) => [...new Set((ids ?? []).map((id) => real('prop', id)).filter((id): id is number => id !== null))];

    const sceneOf: (number | null)[] = shots.map(() => null);
    if (structure) {
      const sceneIds: number[] = [];
      for (const [k, act] of structure.acts.entries()) {
        const actRow = await tx.aiStoryAct.create({
          data: { projectId: project.id, actNumber: k + 1, title: act.title, summary: act.summary || null },
        });
        for (const sc of act.scenes) {
          const row = await tx.aiStoryScene.create({
            data: {
              projectId: project.id,
              actId: actRow.id,
              sceneNumber: sceneIds.length + 1,
              title: sc.title,
              summary: sc.summary || null,
              locationId: real('location', sc.locationRef),
              timeOfDay: sc.timeOfDay,
            },
          });
          sceneIds.push(row.id);
        }
      }
      shots.forEach((sh, k) => (sceneOf[k] = sceneIds[(sh.scene ?? 1) - 1] ?? null));
    } else if (sections) {
      // One scene per run of the same section, placed where most of its shots are.
      let from = 0;
      let number = 0;
      while (from < shots.length) {
        let to = from;
        while (to + 1 < shots.length && sections[to + 1] === sections[from]) to++;
        const places = shots.slice(from, to + 1).map((sh) => sh.locationId).filter((id): id is number => typeof id === 'number');
        const place = places.sort((a, b) => places.filter((x) => x === b).length - places.filter((x) => x === a).length)[0] ?? null;
        const row = await tx.aiStoryScene.create({
          data: { projectId: project.id, sceneNumber: ++number, title: sectionTitle(sections[from], locale), locationId: place },
        });
        for (let k = from; k <= to; k++) sceneOf[k] = row.id;
        from = to + 1;
      }
    }

    await tx.aiStoryShot.createMany({
      data: shots.map((sh, k) => ({
        ...shotData(sh, project.id, k + 1, defaultModelId, sceneOf[k], props(sh.propIds)),
        locationId: mode === 'mv' ? real('location', sh.locationId) : null,
      })),
    });
    const isPlaceholderTitle = !project.title.trim() || project.title === NEW_PROJECT_TITLE.th || project.title === NEW_PROJECT_TITLE.en;
    if (isPlaceholderTitle && planned!.title) {
      await tx.aiStoryProject.update({ where: { id: project.id }, data: { title: planned!.title } });
    }
  });
  return { shots: shots.length, engine, fallbackReason };
}

/**
 * Re-plan the shots of some scenes only (a scene, or every scene of an act),
 * leaving the rest of the film as it is. The new shots take the old ones'
 * place; a film's scenes are planned with the whole outline in view, an MV's
 * on the song slots its shots held. Refused while a shot of theirs renders.
 */
export async function planScenes(
  project: StoryProjectFull,
  sceneIds: number[],
  defaultModelId: number | null
): Promise<{ shots: number; engine: string; fallbackReason?: string }> {
  const targets = project.scenes.filter((sc) => sceneIds.includes(sc.id));
  if (targets.length === 0) throw new StoryError({ th: 'ไม่พบฉากที่จะวางใหม่', en: "Couldn't find the scenes to re-plan." }, 404);
  const inTargets = (shot: { sceneId: number | null }) => targets.some((t) => t.id === shot.sceneId);
  if (project.shots.some((sh) => inTargets(sh) && isBusyShot(sh))) throw new StoryError(BUSY_MESSAGE, 409);
  const input = planInputOf(project);
  const mode = project.mode as StoryMode;
  const others = project.shots.filter((sh) => !inTargets(sh)).length;
  const room = Math.max(targets.length, (mode === 'mv' ? LIMITS.shotsMv : LIMITS.shotsFilm) - others);

  const all: SceneBrief[] = project.scenes.map((sc) => {
    const own = project.shots.filter((sh) => sh.sceneId === sc.id);
    const union = (pick: (sh: (typeof own)[number]) => unknown) => [...new Set(own.flatMap((sh) => idList(pick(sh))))];
    return {
      title: sc.title,
      summary: sc.summary ?? '',
      locationRef: sc.locationId,
      timeOfDay: sc.timeOfDay,
      cast: union((sh) => sh.characterIds),
      props: union((sh) => sh.propIds),
      seconds: own.reduce((n, sh) => n + Number(sh.durationSec), 0) || 30,
    };
  });
  const failed: string[] = [];
  const fresh = new Map<number, ShotDraft[]>();
  await Promise.all(
    targets.map(async (scene) => {
      const index = project.scenes.findIndex((sc) => sc.id === scene.id);
      const share = Math.max(1, Math.floor(room / targets.length));
      if (mode === 'mv') {
        const own = project.shots.filter((sh) => sh.sceneId === scene.id);
        const slots: TimelineSlot[] = own.map((sh) => ({
          start: Number(sh.startSec ?? 0),
          duration: Number(sh.durationSec),
          line: sh.narration ?? '',
          section: scene.title,
          instrumental: !(sh.narration ?? '').trim(),
        }));
        if (slots.length === 0) throw new StoryError({ th: `ฉาก "${scene.title}" ไม่มีช่วงเพลง — วางทั้งเพลงใหม่แทน`, en: `Scene "${scene.title}" has no part of the song. Re-plan the whole song instead.` }, 422);
        const shots = await planMvSlots(input, slots).catch(() => null);
        if (!shots) throw new StoryError({ th: 'ผู้ช่วย AI ไม่ว่างตอนนี้ ลองใหม่อีกครั้ง', en: 'The AI assistant is busy right now. Please try again.' }, 503);
        fresh.set(scene.id, shots);
      } else {
        const maxShots = Math.min(share, Math.max(1, Math.round(all[index].seconds / 6) + 2));
        const shots = await planSceneShots(input, all, [index + 1], { index, count: all.length, maxShots, props: input.props, locations: input.locations }, failed);
        fresh.set(scene.id, shots);
      }
    })
  );

  let total = 0;
  await prisma.$transaction(async (tx) => {
    const busy = await tx.aiStoryShot.count({ where: { projectId: project.id, sceneId: { in: targets.map((t) => t.id) }, OR: BUSY_WHERE } });
    if (busy > 0) throw new StoryError(BUSY_MESSAGE, 409);
    const current = await tx.aiStoryShot.findMany({ where: { projectId: project.id }, orderBy: { shotNumber: 'asc' }, select: { id: true, sceneId: true } });
    const orderOf = new Map(project.scenes.map((sc) => [sc.id, sc.sceneNumber]));
    let order: { key: number; sceneId: number | null }[] = current.map((c) => ({ key: c.id, sceneId: c.sceneId }));
    await tx.aiStoryShot.deleteMany({ where: { projectId: project.id, sceneId: { in: targets.map((t) => t.id) } } });
    for (const scene of targets) {
      const ids: number[] = [];
      for (const sh of fresh.get(scene.id) ?? []) {
        const row = await tx.aiStoryShot.create({ data: shotData(sh, project.id, 0, defaultModelId, scene.id, idList(sh.propIds)) });
        ids.push(row.id);
      }
      total += ids.length;
      const keys = spliceScene(
        order.map((o) => ({ key: o.key, sceneOrder: o.sceneId === null ? null : orderOf.get(o.sceneId) ?? null, inScene: o.sceneId === scene.id })),
        ids,
        scene.sceneNumber
      );
      order = keys.map((key) => ({ key, sceneId: ids.includes(key) ? scene.id : order.find((o) => o.key === key)!.sceneId }));
    }
    for (const [k, o] of order.entries()) await tx.aiStoryShot.update({ where: { id: o.key }, data: { shotNumber: k + 1 } });
  });
  return { shots: total, engine: mode === 'mv' ? 'mv' : 'scenes', fallbackReason: failed.length ? failed.join(' | ') : undefined };
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
  if (!shot) throw new StoryError({ th: 'ไม่พบช็อตนี้', en: 'Shot not found.' }, 404);
  const model = models.find((m) => m.id === shot.modelId);
  if (!model) throw new StoryError({ th: `ช็อต ${shot.shotNumber}: เลือกโมเดลวิดีโอก่อน`, en: `Shot ${shot.shotNumber}: pick a video model first.` }, 422);
  if (!model.orderable) {
    throw new StoryError({ th: `ช็อต ${shot.shotNumber}: ${model.name} ยังเปิดให้ใช้ไม่ได้ เลือกโมเดลอื่น`, en: `Shot ${shot.shotNumber}: ${model.name} isn't available yet. Pick another model.` }, 409);
  }
  if (!shot.visualPrompt.trim()) throw new StoryError({ th: `ช็อต ${shot.shotNumber}: ยังไม่มีคำบรรยายภาพ`, en: `Shot ${shot.shotNumber}: describe what it shows first.` }, 422);
  // Its opening picture is on the way: the clip would start from the old one.
  if (shot.keyframeStatus === 'rendering') {
    throw new StoryError({ th: `ช็อต ${shot.shotNumber}: รอภาพเปิดช็อตเสร็จก่อน`, en: `Shot ${shot.shotNumber}: wait for its opening picture to finish first.` }, 409);
  }

  const claimed = await prisma.aiStoryShot.updateMany({
    where: { id: shot.id, projectId: project.id, status: { in: ['pending', 'failed', 'done'] } },
    // Unlinked from the previous order, so a sync meanwhile cannot settle this
    // claim with the old clip.
    data: { status: 'rendering', errorMessage: null, visualGenerationId: null },
  });
  if (claimed.count === 0) throw new StoryError({ th: `ช็อต ${shot.shotNumber} กำลังสร้างอยู่แล้ว`, en: `Shot ${shot.shotNumber} is already being made.` }, 409);

  const draft = shotDraftOf(shot);
  // The composed opening picture when the customer keeps it, else the lead's photo.
  const keyframe = shot.keyframeUse && shot.keyframeStatus === 'done' && shot.keyframeUrl ? shot.keyframeUrl : null;
  const lead = project.characters.find((c) => c.id === draft.characterIds[0] && c.kind === 'character');
  const firstFrame = keyframe ?? lead?.referenceUrl ?? undefined;
  if (!draft.locationId) draft.locationId = project.scenes.find((sc) => sc.id === shot.sceneId)?.locationId ?? null;
  const frame = ASPECTS[project.aspectRatio] ?? ASPECTS['16:9'];
  const prompt = buildShotPrompt(model.key, draft, {
    mode: project.mode as StoryMode,
    look: project.templateKey,
    mood: project.mood ?? '',
    characters: characterLites(project),
    hasFirstFrame: Boolean(firstFrame),
    keyframe: Boolean(keyframe),
    props: libraryLites(project, 'prop'),
    locations: libraryLites(project, 'location'),
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
    // A film being assembled keeps that status; its own finish settles it.
    await prisma.aiStoryProject.updateMany({ where: { id: project.id, status: { not: 'assembling' } }, data: { status: 'rendering' } });
    return { generationId: result.id };
  } catch (error) {
    await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, status: 'rendering', visualGenerationId: null },
      data: { status: 'failed', errorMessage: packMsg(customerMsg(error)) },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Film music (phase 2)
// ---------------------------------------------------------------------------

export const MUSIC_MODEL_KEY = 'ace-step-1.5';

/** The model a film's score is ordered from, as this caller may order it. */
export async function musicModel(admin: boolean): Promise<MovieModel | null> {
  const m = await prisma.aiModel.findFirst({
    where: { modelId: MUSIC_MODEL_KEY, isActive: true },
    select: { id: true, modelId: true, name: true, creditsPerUnit: true, readiness: true },
  });
  return m ? { id: m.id, key: m.modelId, name: m.name, creditsPerUnit: m.creditsPerUnit, orderable: ModelReadiness.canOrder(m.readiness, admin) } : null;
}

export function musicCredits(model: MovieModel | null, seconds: number): number | null {
  if (!model) return null;
  return creditsForDuration(model.creditsPerUnit, getCatalogEntry(model.key)?.pricing.durationCurve, musicSeconds(seconds));
}

export function filmSeconds(project: StoryProjectFull): number {
  return project.shots.reduce((n, s) => n + Number(s.durationSec), 0);
}

/** Length of the film the finished shots make — what the cut is priced on. */
export function readyFilmSeconds(project: StoryProjectFull): number {
  return project.shots.filter((s) => s.status === 'done' && s.mediaUrl).reduce((n, s) => n + Number(s.durationSec), 0);
}

export async function assemblePriceSettings(): Promise<{ perMinute: number; minimum: number }> {
  const rows = await prisma.aiSetting.findMany({
    where: { key: { in: ['story_assemble_credits_per_minute', 'story_assemble_min_credits'] } },
    select: { key: true, value: true },
  });
  if (rows.length < 2) {
    // Rows the admin Settings page can show and edit (it lists existing rows only).
    await prisma.aiSetting
      .createMany({
        data: [
          { key: 'story_assemble_credits_per_minute', value: String(ASSEMBLE_PRICE_DEFAULTS.perMinute), type: 'number', group: 'credits' },
          { key: 'story_assemble_min_credits', value: String(ASSEMBLE_PRICE_DEFAULTS.minimum), type: 'number', group: 'credits' },
        ],
        skipDuplicates: true,
      })
      .catch(() => {});
  }
  const read = (key: string, fallback: number) => {
    const n = Number(rows.find((r) => r.key === key)?.value);
    return Number.isFinite(n) && n >= 0 && rows.some((r) => r.key === key && r.value !== null && r.value !== '') ? Math.floor(n) : fallback;
  };
  return {
    perMinute: read('story_assemble_credits_per_minute', ASSEMBLE_PRICE_DEFAULTS.perMinute),
    minimum: read('story_assemble_min_credits', ASSEMBLE_PRICE_DEFAULTS.minimum),
  };
}

/**
 * Order the film's score: an instrumental in the film's look, as long as the
 * storyboard, charged like any music order. Recorded in script_json.music; a
 * new order replaces the old one (whose track stays in the gallery).
 */
export async function orderMusic(userId: number, admin: boolean, project: StoryProjectFull): Promise<{ generationId: number }> {
  if (project.mode !== 'film') throw new StoryError({ th: 'MV ใช้เพลงของ MV อยู่แล้ว', en: 'An MV already uses its own song.' });
  const seconds = filmSeconds(project);
  if (seconds <= 0) throw new StoryError({ th: 'วางช็อตก่อน ระบบสร้างเพลงยาวเท่าหนัง', en: 'Plan the shots first — the music is made as long as the film.' }, 422);
  const model = await musicModel(admin);
  if (!model?.orderable) {
    throw new StoryError({ th: 'ตัวสร้างเพลงยังไม่เปิดให้ใช้ ปิดดนตรีประกอบไว้ก่อน', en: "The music generator isn't available yet. Turn background music off for now." }, 409);
  }
  const length = musicSeconds(seconds);
  const result = await GenerationService.generate(
    userId,
    { modelId: model.id, type: 'audio', prompt: musicPrompt(project.templateKey, project.mood), params: { duration: length } },
    { isAdmin: admin }
  );
  const script = (project.scriptJson ?? {}) as Record<string, unknown>;
  await prisma.aiStoryProject.update({
    where: { id: project.id },
    data: { scriptJson: { ...script, music: { generationId: result.id, seconds: length } } as Prisma.InputJsonValue },
  });
  return { generationId: result.id };
}

/**
 * What the customer may read about a refused order — never an internal
 * message — in both languages: answered by a route, or stored on a row
 * (`packMsg`) and read back in whichever language the reader has by then.
 */
export function customerMsg(error: unknown): Msg {
  // Our own refusals (StoryError, StoryJobError) carry their pair.
  if (error instanceof UserMessageError) return error.msg;
  const known = generationErrorResponse(error);
  if (!known) return ORDER_FAILED;
  if (known.status === 402) return NO_CREDITS;
  if (known.status === 503) return VIDEO_BUSY;
  if (known.status === 404) return MODEL_OFF;
  return { th: known.body.error, en: generationErrorResponse(error, 'en')?.body.error ?? known.body.error };
}
