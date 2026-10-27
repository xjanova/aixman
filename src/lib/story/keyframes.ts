import prisma from '@/lib/db';
import { getGpuConfig } from '@/lib/gpu/config';
import { isCommunityOnlyModel } from '@/lib/gpu/catalog';
import { isInHouse } from '@/lib/public-provider';
import { referenceCaps, referenceLabel } from '@/lib/reference-caps';
import { GenerationService } from '@/lib/services/generation';
import { ModelReadiness, TUNING_MESSAGE } from '@/lib/services/model-readiness';
import { isStorageConfigured } from '@/lib/storage/r2';
import { ASPECTS, LOOKS, MOODS, type StoryMode } from './cinematic';
import { MAX_ASSET_PICTURES, keyframePrompt, pickReferences, type LibraryAsset, type ShotRefs } from './library';
import { StoryError, customerMessage, idList, libraryOf, type StoryProjectFull } from './service';

/**
 * Opening pictures for shots, and AI pictures for library items — both
 * ordinary image orders through GenerationService (content gate, readiness,
 * price, refunds), run after the response (`deferApi`) and brought up to date
 * when the page asks for the project, like the shots' clips.
 *
 * Any active image model may be picked; how many references it takes comes
 * from reference-caps.ts and is what the page shows. A model that takes none
 * can still draw a library item from its description, never an opening
 * picture — that would ignore every face.
 */

const ORPHAN_CLAIM_MS = 10 * 60_000;

export interface ImageModelOption {
  id: number;
  key: string;
  name: string;
  /** Reference pictures it takes (0 = none). */
  refs: number;
  label: string;
  orderable: boolean;
  reason: string | null;
  /** What one picture costs. */
  credits: number;
}

/** Every image model, with what it takes and whether this caller can order it now. */
export async function imageModels(admin: boolean): Promise<ImageModelOption[]> {
  const [rows, accounts, gpu] = await Promise.all([
    prisma.aiModel.findMany({
      where: { isActive: true, category: 'image' },
      include: { provider: { select: { id: true, slug: true, isActive: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.aiAccountPool.findMany({ where: { isActive: true }, select: { providerId: true } }),
    getGpuConfig(),
  ]);
  const keyed = new Set(accounts.map((a) => a.providerId));
  return rows
    // Home PCs never take an upload, and a library picture is one.
    .filter((m) => !(isInHouse(m.provider.slug) && isCommunityOnlyModel(m.modelId)))
    .map((m) => {
      const caps = referenceCaps({ providerSlug: m.provider.slug, modelId: m.modelId, category: m.category, defaultParams: m.defaultParams });
      const connected = m.provider.isActive && (isInHouse(m.provider.slug) ? gpu.enabled && isStorageConfigured() : keyed.has(m.provider.id));
      const ready = ModelReadiness.canOrder(m.readiness, admin);
      return {
        id: m.id,
        key: m.modelId,
        name: m.name,
        refs: caps.images,
        label: referenceLabel(caps),
        orderable: connected && ready,
        reason: !connected ? 'ยังไม่เปิดให้บริการ' : ready ? null : m.readiness === 'tuning' ? TUNING_MESSAGE : 'ปิดปรับปรุงชั่วคราว',
        credits: m.creditsPerUnit,
      };
    })
    .sort((a, b) => Number(b.orderable) - Number(a.orderable) || b.refs - a.refs);
}

export interface PictureSettings {
  /** Composes the shots' opening pictures. */
  keyframeModelId: number | null;
  /** Draws library items. */
  pictureModelId: number | null;
}

export function pictureSettings(script: unknown): PictureSettings {
  const raw = ((script ?? {}) as { pictures?: Partial<PictureSettings> }).pictures ?? {};
  const id = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
  return { keyframeModelId: id(raw.keyframeModelId), pictureModelId: id(raw.pictureModelId) };
}

/** The customer's pick if it can still do the job, else the orderable model that takes the most references. */
export function chooseModel(models: ImageModelOption[], picked: number | null, needsRefs: boolean): ImageModelOption | null {
  const fits = (m: ImageModelOption) => !needsRefs || m.refs > 0;
  const mine = models.find((m) => m.id === picked && fits(m));
  if (mine) return mine;
  return models.filter((m) => m.orderable && fits(m)).sort((a, b) => b.refs - a.refs)[0] ?? null;
}

/** A shot's characters, props and place; a shot with no place of its own is in its scene's. */
export function shotRefsOf(shot: StoryProjectFull['shots'][number], project: StoryProjectFull): ShotRefs {
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  return { characterIds: idList(shot.characterIds), propIds: idList(shot.propIds), locationId: shot.locationId ?? scene?.locationId ?? null };
}

function frameParams(project: StoryProjectFull) {
  const frame = ASPECTS[project.aspectRatio] ?? ASPECTS['16:9'];
  return { width: frame.width, height: frame.height, aspectRatio: project.aspectRatio };
}

/**
 * Order one shot's opening picture. Claimed first with a conditional update
 * (a double click orders once); a refusal puts the shot back as failed with
 * the reason, before any credit moves.
 */
export async function orderKeyframe(
  userId: number,
  admin: boolean,
  project: StoryProjectFull,
  shotId: number,
  model: ImageModelOption
): Promise<void> {
  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) throw new StoryError('ไม่พบช็อตนี้', 404);
  if (model.refs === 0) throw new StoryError(`${model.name} ไม่รับภาพอ้างอิง เลือกโมเดลอื่นสำหรับภาพเปิดช็อต`, 422);
  if (!model.orderable) throw new StoryError(`${model.name}: ${model.reason ?? 'ยังใช้ไม่ได้'}`, 409);
  const claimed = await prisma.aiStoryShot.updateMany({
    where: { id: shot.id, projectId: project.id, OR: [{ keyframeStatus: null }, { keyframeStatus: { not: 'rendering' } }] },
    data: { keyframeStatus: 'rendering', keyframeGenerationId: null, keyframeError: null },
  });
  if (claimed.count === 0) throw new StoryError(`ภาพเปิดช็อต ${shot.shotNumber} กำลังสร้างอยู่แล้ว`, 409);

  const library = libraryOf(project);
  const refsOf = shotRefsOf(shot, project);
  const refs = pickReferences(refsOf, library, model.refs);
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  const byIds = (ids: number[]) => ids.map((id) => library.find((a) => a.id === id)).filter((a): a is LibraryAsset => Boolean(a));
  const prompt = keyframePrompt(refs, {
    mode: project.mode as StoryMode,
    look: project.templateKey,
    mood: project.mood ?? '',
    aspect: project.aspectRatio,
    shotSize: shot.shotSize,
    visual: shot.visualPrompt,
    timeOfDay: scene?.timeOfDay ?? null,
    characters: byIds(refsOf.characterIds).filter((a) => a.kind === 'character'),
    props: byIds(refsOf.propIds).filter((a) => a.kind === 'prop'),
    location: library.find((a) => a.id === refsOf.locationId && a.kind === 'location') ?? null,
  });
  try {
    const result = await GenerationService.generate(
      userId,
      {
        modelId: model.id,
        // Nothing pictured (a place described in words only): drawn from the words.
        type: refs.length ? 'edit' : 'image',
        prompt,
        referenceImages: refs.length ? refs.map((r) => r.url) : undefined,
        params: frameParams(project),
      },
      { isAdmin: admin, deferApi: true }
    );
    await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, keyframeStatus: 'rendering', keyframeGenerationId: null },
      data: { keyframeGenerationId: result.id },
    });
  } catch (error) {
    await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, keyframeStatus: 'rendering', keyframeGenerationId: null },
      data: { keyframeStatus: 'failed', keyframeError: customerMessage(error) },
    });
    throw error;
  }
}

/** Ask a picture for a library item from its description (and its pictures, when the model takes them). */
export async function orderAssetPicture(
  userId: number,
  admin: boolean,
  project: StoryProjectFull,
  assetId: number,
  model: ImageModelOption,
  note: string
): Promise<void> {
  const row = project.characters.find((c) => c.id === assetId);
  if (!row) throw new StoryError('ไม่พบรายการนี้ในคลัง', 404);
  if (!model.orderable) throw new StoryError(`${model.name}: ${model.reason ?? 'ยังใช้ไม่ได้'}`, 409);
  const asset = libraryOf(project).find((a) => a.id === assetId)!;
  if (asset.pictures.length >= MAX_ASSET_PICTURES) throw new StoryError(`มีภาพครบ ${MAX_ASSET_PICTURES} ภาพแล้ว ลบภาพเดิมก่อน`, 422);
  if (!asset.description.trim() && !note.trim()) throw new StoryError('เขียนคำอธิบายรูปลักษณ์ก่อน AI จึงวาดได้', 422);
  const claimed = await prisma.aiStoryCharacter.updateMany({
    where: { id: assetId, projectId: project.id, OR: [{ imageStatus: null }, { imageStatus: { not: 'rendering' } }] },
    data: { imageStatus: 'rendering', imageGenerationId: null, imageError: null },
  });
  if (claimed.count === 0) throw new StoryError(`กำลังวาดภาพของ ${asset.name} อยู่แล้ว`, 409);

  // Another angle of something already pictured keeps it the same.
  const refs = model.refs > 0 ? asset.pictures.slice(0, model.refs) : [];
  const style = project.mode === 'mv' ? MOODS[project.mood ?? '']?.style ?? MOODS.romantic.style : LOOKS[project.templateKey]?.style ?? LOOKS.film.style;
  const subject =
    asset.kind === 'character'
      ? `A character reference sheet photo of ${asset.name}: ${asset.description}. Full body, standing, facing the camera, plain light grey studio background, even soft light.`
      : asset.kind === 'prop'
        ? `A product reference photo of ${asset.name}: ${asset.description}. The whole object, centred, plain light grey background, even studio light.`
        : `An establishing photo of the place ${asset.name}: ${asset.description}. Wide angle, no people.`;
  const prompt = [
    refs.length ? `Image 1${refs.length > 1 ? ` to ${refs.length}` : ''} show ${asset.name}; keep exactly the same look.` : '',
    subject,
    note.trim() ? `Also: ${note.trim()}` : '',
    `${style}. Photorealistic. No text, no watermark, one single image.`,
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const result = await GenerationService.generate(
      userId,
      {
        modelId: model.id,
        type: refs.length ? 'edit' : 'image',
        prompt,
        referenceImages: refs.length ? refs : undefined,
        params: asset.kind === 'location' ? frameParams(project) : { width: 1024, height: 1024, aspectRatio: '1:1' },
      },
      { isAdmin: admin, deferApi: true }
    );
    await prisma.aiStoryCharacter.updateMany({
      where: { id: assetId, imageStatus: 'rendering', imageGenerationId: null },
      data: { imageGenerationId: result.id },
    });
  } catch (error) {
    await prisma.aiStoryCharacter.updateMany({
      where: { id: assetId, imageStatus: 'rendering', imageGenerationId: null },
      data: { imageStatus: 'failed', imageError: customerMessage(error) },
    });
    throw error;
  }
}

type GenOutcome = { status: string; resultUrl: string | null; creditsRefunded: number } | undefined;

async function generationsOf(userId: number, ids: number[]) {
  if (ids.length === 0) return new Map<number, GenOutcome>();
  const rows = await prisma.aiGeneration.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, status: true, resultUrl: true, creditsRefunded: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

const failedText = (gen: NonNullable<GenOutcome>, what: string) => `${what}ไม่สำเร็จ${gen.creditsRefunded > 0 ? ' (คืนเครดิตแล้ว)' : ''} — ลองใหม่ได้`;

/**
 * Bring opening pictures and library pictures up to date with their orders.
 * Every write is conditional on the same order still being the one in
 * flight, so a newer order is never overwritten by an older one's result.
 */
export async function syncPictures(project: StoryProjectFull): Promise<boolean> {
  let changed = false;
  const now = Date.now();
  const orphanShots = project.shots.filter((s) => s.keyframeStatus === 'rendering' && !s.keyframeGenerationId && now - s.updatedAt.getTime() > ORPHAN_CLAIM_MS);
  for (const s of orphanShots) {
    const r = await prisma.aiStoryShot.updateMany({
      where: { id: s.id, keyframeStatus: 'rendering', keyframeGenerationId: null },
      data: { keyframeStatus: 'failed', keyframeError: 'การสั่งสร้างไม่สมบูรณ์ — ลองใหม่ได้' },
    });
    changed ||= r.count > 0;
  }
  const orphanAssets = project.characters.filter((c) => c.imageStatus === 'rendering' && !c.imageGenerationId && now - c.updatedAt.getTime() > ORPHAN_CLAIM_MS);
  for (const c of orphanAssets) {
    const r = await prisma.aiStoryCharacter.updateMany({
      where: { id: c.id, imageStatus: 'rendering', imageGenerationId: null },
      data: { imageStatus: 'failed', imageError: 'การสั่งวาดไม่สมบูรณ์ — ลองใหม่ได้' },
    });
    changed ||= r.count > 0;
  }

  const shots = project.shots.filter((s) => s.keyframeStatus === 'rendering' && s.keyframeGenerationId);
  const assets = project.characters.filter((c) => c.imageStatus === 'rendering' && c.imageGenerationId);
  if (shots.length === 0 && assets.length === 0) return changed;
  const gens = await generationsOf(project.userId, [...shots.map((s) => s.keyframeGenerationId!), ...assets.map((c) => c.imageGenerationId!)]);

  for (const shot of shots) {
    const gen = gens.get(shot.keyframeGenerationId!);
    if (!gen) continue;
    const where = { id: shot.id, keyframeStatus: 'rendering', keyframeGenerationId: shot.keyframeGenerationId };
    if (gen.status === 'completed' && gen.resultUrl) {
      const r = await prisma.aiStoryShot.updateMany({ where, data: { keyframeStatus: 'done', keyframeUrl: gen.resultUrl, keyframeError: null, keyframeUse: true } });
      changed ||= r.count > 0;
    } else if (gen.status === 'failed' || gen.status === 'cancelled') {
      const r = await prisma.aiStoryShot.updateMany({ where, data: { keyframeStatus: 'failed', keyframeError: failedText(gen, 'สร้างภาพเปิดช็อต') } });
      changed ||= r.count > 0;
    }
  }

  for (const asset of assets) {
    const gen = gens.get(asset.imageGenerationId!);
    if (!gen) continue;
    const where = { id: asset.id, imageStatus: 'rendering', imageGenerationId: asset.imageGenerationId };
    if (gen.status === 'completed' && gen.resultUrl) {
      // The first picture becomes the main one; later ones are other angles.
      const extra = Array.isArray(asset.images) ? asset.images.filter((u): u is string => typeof u === 'string') : [];
      const data = asset.referenceUrl
        ? { images: [...extra, gen.resultUrl].slice(0, MAX_ASSET_PICTURES - 1) }
        : { referenceUrl: gen.resultUrl };
      const r = await prisma.aiStoryCharacter.updateMany({ where, data: { ...data, imageStatus: 'done', imageError: null } });
      changed ||= r.count > 0;
    } else if (gen.status === 'failed' || gen.status === 'cancelled') {
      const r = await prisma.aiStoryCharacter.updateMany({ where, data: { imageStatus: 'failed', imageError: failedText(gen, 'วาดภาพ') } });
      changed ||= r.count > 0;
    }
  }
  return changed;
}
