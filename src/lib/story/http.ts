import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { audioDurationSeconds } from '@/lib/audio-duration';
import { generationErrorResponse } from '@/lib/services/generation-errors';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import {
  ASPECTS,
  CAMERA_MOVES,
  LIMITS,
  LOOKS,
  MOODS,
  SHOT_SIZES,
  filmLengthKey,
  filmTarget,
  pickKey,
  safeCamera,
  withTargetSeconds,
  type StoryMode,
} from './cinematic';
import { assemblePrice, musicSeconds, parseEdit, parseMusicState } from './edit';
import { assemblyStale } from './assemble';
import { chooseModel, imageModels, pictureSettings, shotRefsOf } from './keyframes';
import { ASSET_KINDS, MAX_ASSET_PICTURES, TIMES_OF_DAY, assetPictures, isAssetKind, pickReferences, referencesWanted } from './library';
import { referenceCaps, referenceLabel } from '@/lib/reference-caps';
import { planJob } from './plan-jobs';
import { dubState, suggestedForLipsync, voiceWindow } from './sing';
import { demucsPython, lipsyncCredits, lipsyncModel, projectVocalsState } from './vocals';
import type { Prisma } from '@/generated/prisma/client';
import {
  StoryError,
  assemblePriceSettings,
  customerMessage,
  filmSeconds,
  idList,
  libraryOf,
  movieModels,
  musicCredits,
  musicModel,
  readyFilmSeconds,
  shotCredits,
  type MovieModel,
  type StoryProjectFull,
} from './service';

/** Shared by the /api/story routes: validation, song lookup, replies. */

export function storyErrorReply(error: unknown, context: string): NextResponse {
  if (error instanceof StoryError) return NextResponse.json({ error: error.message }, { status: error.status });
  const known = generationErrorResponse(error);
  if (known) return NextResponse.json({ ...known.body, error: customerMessage(error) }, { status: known.status });
  console.error(`[story] ${context}:`, error);
  return NextResponse.json({ error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' }, { status: 500 });
}

export function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * A URL this user uploaded through /api/uploads — never a stranger's URL, and
 * never another customer's file (keys are uploads/<userId>/<kind>/…).
 */
export function isOwnUpload(url: unknown, userId: number, kind: 'image' | 'audio'): url is string {
  if (typeof url !== 'string' || url.length > 2000) return false;
  const key = keyFromPublicUrl(url);
  return Boolean(key && new RegExp(`(^|/)uploads/${userId}/${kind}/[^/]+$`).test(key));
}

const SONG_FETCH_LIMIT = 40 * 1024 * 1024;

/** Length of a song (or its vocal stem) in our bucket, read from its bytes — never from a number the client sends. */
export async function songSeconds(url: string): Promise<number> {
  const ext = (url.split('?')[0].split('.').pop() ?? '').toLowerCase();
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok || !res.body) throw new StoryError('เปิดไฟล์เพลงไม่ได้ ลองอัปโหลดใหม่', 422);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > SONG_FETCH_LIMIT) throw new StoryError('ไฟล์เพลงใหญ่เกินไป', 422);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SONG_FETCH_LIMIT) {
      await reader.cancel();
      throw new StoryError('ไฟล์เพลงใหญ่เกินไป', 422);
    }
    chunks.push(value);
  }
  const seconds = audioDurationSeconds(Buffer.concat(chunks), ext);
  if (!seconds) throw new StoryError('อ่านความยาวเพลงไม่ได้ ใช้ไฟล์ MP3, WAV, FLAC, OGG หรือ M4A', 422);
  if (seconds > LIMITS.maxSongSeconds) {
    throw new StoryError(`เพลงยาวเกิน ${LIMITS.maxSongSeconds / 60} นาที — ตัดให้สั้นลงก่อน`, 422);
  }
  if (seconds < LIMITS.minShotSeconds * 2) throw new StoryError('เพลงสั้นเกินไป', 422);
  return Math.round(seconds * 100) / 100;
}

/** The song an MV is cut to: the user's upload, or a song they made here. */
export async function resolveSong(
  userId: number,
  source: unknown
): Promise<{ url: string; seconds: number; lyrics: string }> {
  const s = (source ?? {}) as Record<string, unknown>;
  if (s.uploadUrl !== undefined) {
    if (!isOwnUpload(s.uploadUrl, userId, 'audio')) throw new StoryError('ไฟล์เพลงไม่ถูกต้อง อัปโหลดใหม่อีกครั้ง', 422);
    return { url: s.uploadUrl, seconds: await songSeconds(s.uploadUrl), lyrics: '' };
  }
  const generationId = Number(s.generationId);
  if (Number.isInteger(generationId) && generationId > 0) {
    const gen = await prisma.aiGeneration.findFirst({
      where: { id: generationId, userId, type: 'audio', status: 'completed' },
      select: { resultUrl: true, params: true },
    });
    if (!gen?.resultUrl || !keyFromPublicUrl(gen.resultUrl)) throw new StoryError('ไม่พบเพลงนี้ในผลงานของคุณ', 404);
    const params = (gen.params ?? {}) as Record<string, unknown>;
    return {
      url: gen.resultUrl,
      seconds: await songSeconds(gen.resultUrl),
      lyrics: typeof params.lyrics === 'string' ? params.lyrics : '',
    };
  }
  throw new StoryError('เลือกเพลงก่อน: อัปโหลดเอง หรือเลือกเพลงที่สร้างบนเว็บ', 422);
}

export interface CharacterInput {
  id?: number;
  name: string;
  description: string;
  referenceUrl: string | null;
}

export function parseCharacters(value: unknown, userId: number): CharacterInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new StoryError('ข้อมูลตัวละครไม่ถูกต้อง');
  if (value.length > LIMITS.characters) throw new StoryError(`ตัวละครได้สูงสุด ${LIMITS.characters} คน`);
  return value.map((raw, k) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const name = text(c.name, LIMITS.characterName) || `ตัวละคร ${k + 1}`;
    const ref = c.referenceUrl === null || c.referenceUrl === undefined || c.referenceUrl === '' ? null : c.referenceUrl;
    if (ref !== null && !isOwnUpload(ref, userId, 'image')) {
      throw new StoryError(`ภาพของ ${name} ไม่ถูกต้อง อัปโหลดใหม่อีกครั้ง`, 422);
    }
    const id = Number(c.id);
    return {
      ...(Number.isInteger(id) && id > 0 ? { id } : {}),
      name,
      description: text(c.description, LIMITS.characterDescription),
      referenceUrl: ref,
    };
  });
}

export function projectSettings(body: Record<string, unknown>) {
  const out: { title?: string; templateKey?: string; mood?: string; aspectRatio?: string } = {};
  if (body.title !== undefined) out.title = text(body.title, LIMITS.title);
  if (body.look !== undefined) out.templateKey = pickKey(body.look, LOOKS, 'film');
  if (body.mood !== undefined) out.mood = pickKey(body.mood, MOODS, 'romantic');
  if (body.aspect !== undefined) out.aspectRatio = pickKey(body.aspect, ASPECTS, '16:9');
  return out;
}

/** A shot edit from the page, every field checked. Only the fields sent change. */
export function shotPatch(body: Record<string, unknown>, project: StoryProjectFull, models: MovieModel[], current?: { shotSize: string; camera: string; characterIds: number[] }) {
  const idsOf = (kind: string) => new Set(project.characters.filter((c) => (c.kind || 'character') === kind).map((c) => c.id));
  const castIds = idsOf('character');
  const data: Record<string, unknown> = {};
  if (body.propIds !== undefined) {
    const props = idsOf('prop');
    data.propIds = [...new Set(idList(body.propIds))].filter((id) => props.has(id)).slice(0, ASSET_KINDS.prop.max);
  }
  if (body.locationId !== undefined) {
    const id = Number(body.locationId);
    data.locationId = body.locationId !== null && idsOf('location').has(id) ? id : null;
  }
  // Whether the clip opens on the composed opening picture or the lead's photo.
  if (typeof body.keyframeUse === 'boolean') data.keyframeUse = body.keyframeUse;
  if (body.visual !== undefined) {
    const visual = text(body.visual, LIMITS.visual);
    if (!visual) throw new StoryError('คำบรรยายภาพว่างไม่ได้');
    data.visualPrompt = visual;
  }
  if (body.line !== undefined) data.narration = text(body.line, LIMITS.line) || null;
  if (body.sound !== undefined) data.sound = text(body.sound, LIMITS.sound) || null;
  if (body.durationSec !== undefined) {
    const n = Number(body.durationSec);
    if (!Number.isFinite(n)) throw new StoryError('ความยาวช็อตไม่ถูกต้อง');
    data.durationSec = Math.round(Math.min(LIMITS.maxShotSeconds, Math.max(LIMITS.minShotSeconds, n)) * 100) / 100;
  }
  if (body.startSec !== undefined) {
    const n = Number(body.startSec);
    data.startSec = body.startSec === null || !Number.isFinite(n) ? null : Math.round(Math.max(0, Math.min(LIMITS.maxSongSeconds, n)) * 100) / 100;
  }
  if (body.characterIds !== undefined) {
    data.characterIds = [...new Set(idList(body.characterIds))].filter((id) => castIds.has(id)).slice(0, LIMITS.characters);
  }
  if (body.speakerId !== undefined) {
    const id = Number(body.speakerId);
    data.speakerId = body.speakerId !== null && castIds.has(id) ? id : null;
  }
  // Whether the cut uses this shot's lip-sync dub (sing.ts usableDub).
  if (typeof body.lipsyncUse === 'boolean') data.lipsyncUse = body.lipsyncUse;
  if (body.modelId !== undefined) {
    const id = Number(body.modelId);
    if (!models.some((m) => m.id === id)) throw new StoryError('โมเดลนี้ใช้กับโหมดหนังไม่ได้');
    data.modelId = id;
  }
  const size = body.shotSize !== undefined ? pickKey(body.shotSize, SHOT_SIZES, 'medium') : current?.shotSize ?? 'medium';
  if (body.shotSize !== undefined) data.shotSize = size;
  if (body.camera !== undefined || body.shotSize !== undefined || body.characterIds !== undefined) {
    const cast = (data.characterIds as number[] | undefined) ?? current?.characterIds ?? [];
    const camera = body.camera !== undefined ? pickKey(body.camera, CAMERA_MOVES, 'static') : current?.camera ?? 'static';
    data.camera = safeCamera(size, camera, cast.length > 0);
  }
  return data;
}

/** What the page gets: the project, its shots with prices, and the models it may pick. */
export async function serializeProject(project: StoryProjectFull, admin: boolean) {
  const isMv = project.mode === 'mv';
  const [models, score, price, dubber, pictureModels] = await Promise.all([
    movieModels(admin),
    project.mode === 'film' ? musicModel(admin) : null,
    assemblePriceSettings(),
    isMv ? lipsyncModel(admin) : null,
    imageModels(admin),
  ]);
  const cast = project.characters.filter((c) => (c.kind || 'character') === 'character');
  const charById = new Map(cast.map((c) => [c.id, c]));
  const assetIds = new Set(project.characters.map((c) => c.id));
  const library = libraryOf(project);
  const script = (project.scriptJson ?? {}) as Record<string, unknown>;
  const pictures = pictureSettings(script);
  const keyframeModel = chooseModel(pictureModels, pictures.keyframeModelId, true);
  const pictureModel = chooseModel(pictureModels, pictures.pictureModelId, false);
  const musicState = parseMusicState(script.music);
  const musicGen = musicState
    ? await prisma.aiGeneration.findFirst({
        where: { id: musicState.generationId, userId: project.userId },
        select: { status: true, resultUrl: true, creditsRefunded: true },
      })
    : null;
  const seconds = filmSeconds(project);
  const assembling = project.status === 'assembling' && !assemblyStale(project.updatedAt);
  return {
    project: {
      id: project.id,
      mode: project.mode,
      title: project.title,
      brief: project.brief,
      look: project.templateKey,
      filmLength: project.mode === 'film' ? filmLengthKey(filmTarget(script)) : null,
      mood: project.mood,
      aspect: project.aspectRatio,
      songUrl: project.songUrl,
      songSeconds: project.songSeconds === null ? null : Number(project.songSeconds),
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      characters: cast.map((c) => ({ id: c.id, name: c.name, description: c.description, referenceUrl: c.referenceUrl })),
      // The whole reference library: characters, props, places, each with its pictures.
      library: project.characters.map((c) => ({
        id: c.id,
        kind: isAssetKind(c.kind) ? c.kind : 'character',
        name: c.name,
        description: c.description,
        pictures: assetPictures(c),
        origin: c.origin,
        image: { state: c.imageStatus, error: c.imageStatus === 'failed' ? c.imageError : null },
      })),
      acts: project.acts.map((a) => ({ id: a.id, number: a.actNumber, title: a.title, summary: a.summary ?? '' })),
      scenes: project.scenes.map((sc) => ({
        id: sc.id,
        actId: sc.actId,
        number: sc.sceneNumber,
        title: sc.title,
        summary: sc.summary ?? '',
        locationId: sc.locationId !== null && assetIds.has(sc.locationId) ? sc.locationId : null,
        timeOfDay: sc.timeOfDay,
      })),
      shots: project.shots.map((s) => {
        const model = models.find((m) => m.id === s.modelId);
        return {
          id: s.id,
          number: s.shotNumber,
          visual: s.visualPrompt,
          line: s.narration ?? '',
          sound: s.sound ?? '',
          shotSize: s.shotSize,
          camera: s.camera,
          durationSec: Number(s.durationSec),
          startSec: s.startSec === null ? null : Number(s.startSec),
          characterIds: idList(s.characterIds).filter((id) => charById.has(id)),
          speakerId: s.speakerId !== null && charById.has(s.speakerId) ? s.speakerId : null,
          sceneId: s.sceneId,
          propIds: idList(s.propIds).filter((id) => assetIds.has(id)),
          locationId: s.locationId !== null && assetIds.has(s.locationId) ? s.locationId : null,
          keyframe: (() => {
            const refs = shotRefsOf(s, project);
            return {
              state: s.keyframeStatus,
              url: s.keyframeStatus === 'done' ? s.keyframeUrl : null,
              error: s.keyframeStatus === 'failed' ? s.keyframeError : null,
              use: s.keyframeUse,
              // Pictures this shot's references hold, and how many the chosen model will get.
              wanted: referencesWanted(refs, library),
              sent: keyframeModel ? pickReferences(refs, library, keyframeModel.refs).length : 0,
            };
          })(),
          modelId: s.modelId,
          credits: shotCredits(model, Number(s.durationSec)),
          status: s.status,
          mediaUrl: s.mediaUrl,
          generationId: s.visualGenerationId,
          error: s.errorMessage,
          ...(isMv
            ? {
                lipsync: {
                  state: dubState(s),
                  url: s.lipsyncStatus === 'done' ? s.lipsyncUrl : null,
                  error: s.lipsyncStatus === 'failed' ? s.lipsyncError : null,
                  use: s.lipsyncUse,
                  // Why this shot cannot be dubbed, or null when it can.
                  blocked: (() => {
                    const w = voiceWindow(s.startSec === null ? null : Number(s.startSec), Number(s.durationSec));
                    return w.ok ? null : w.message;
                  })(),
                  credits: lipsyncCredits(dubber, Number(s.durationSec)),
                  suggested: suggestedForLipsync({ line: s.narration ?? '', characterIds: idList(s.characterIds), shotSize: s.shotSize }),
                },
              }
            : {}),
        };
      }),
    },
    models: models.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      orderable: m.orderable,
      references: referenceLabel(referenceCaps({ providerSlug: 'simplepod', modelId: m.key, category: 'video' })),
    })),
    pictures: {
      keyframeModelId: keyframeModel?.id ?? null,
      pictureModelId: pictureModel?.id ?? null,
      models: pictureModels,
      times: Object.fromEntries(Object.entries(TIMES_OF_DAY).map(([k, t]) => [k, t.label])),
      kinds: Object.fromEntries(Object.entries(ASSET_KINDS).map(([k, v]) => [k, { label: v.label, max: v.max }])),
      maxPictures: MAX_ASSET_PICTURES,
    },
    edit: parseEdit(script.edit, project.mode as StoryMode),
    music: {
      available: Boolean(score?.orderable),
      credits: musicCredits(score, seconds),
      // The track on file is shorter than the film now: the page offers a new one.
      stale: Boolean(musicState && musicState.seconds < musicSeconds(seconds) - 1),
      status: musicGen ? (musicGen.status === 'completed' && musicGen.resultUrl ? 'done' : ['failed', 'cancelled'].includes(musicGen.status) ? 'failed' : 'rendering') : 'none',
      url: musicGen?.status === 'completed' ? musicGen.resultUrl : null,
    },
    vocals: isMv
      ? {
          state: projectVocalsState(project),
          source: project.vocalsSource,
          url: project.vocalsStatus === 'done' ? project.vocalsUrl : null,
          error: project.vocalsStatus === 'failed' ? project.vocalsError : projectVocalsState(project) === 'failed' ? 'การแยกเสียงร้องครั้งก่อนค้าง ลองใหม่อีกครั้ง' : null,
          // This server can separate a song itself (Demucs installed).
          auto: demucsPython() !== null,
          // The dubbing model is open to this caller.
          dubbing: Boolean(dubber?.orderable),
        }
      : null,
    film: {
      status: assembling ? 'assembling' : project.finalVideoUrl ? 'done' : 'none',
      // What the cut of the finished shots costs now (admins are not charged).
      credits: admin ? 0 : assemblePrice(readyFilmSeconds(project), price),
      url: project.finalVideoUrl,
      seconds: project.durationSec,
      error: project.status === 'assembling' && !assembling ? 'การตัดต่อครั้งก่อนค้าง ลองกดตัดต่อใหม่' : project.errorMessage,
    },
    planning: planJob(project.id),
  };
}

/** A film's `filmLength` (a FILM_LENGTHS key) stored in script_json, keeping what is there. */
export function withFilmLength(script: unknown, raw: unknown): Prisma.InputJsonValue {
  return withTargetSeconds(script, raw) as Prisma.InputJsonValue;
}

/** PATCH body's `pictures`: which image models compose opening pictures and draw library items. */
export function picturesPatch(script: unknown, raw: unknown): Prisma.InputJsonValue {
  const base = (script ?? {}) as Record<string, unknown>;
  const current = pictureSettings(base);
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = (v: unknown, fallback: number | null) => (v === undefined ? fallback : Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
  return { ...base, pictures: { keyframeModelId: id(r.keyframeModelId, current.keyframeModelId), pictureModelId: id(r.pictureModelId, current.pictureModelId) } } as Prisma.InputJsonValue;
}

/** A library item from the page, every field checked. */
export function assetInput(body: Record<string, unknown>, userId: number, existing: string[] = []) {
  const out: { kind?: 'character' | 'prop' | 'location'; name?: string; description?: string; pictures?: string[] } = {};
  if (body.kind !== undefined) {
    if (!isAssetKind(body.kind)) throw new StoryError('ประเภทไม่ถูกต้อง');
    out.kind = body.kind;
  }
  if (body.name !== undefined) out.name = text(body.name, LIMITS.characterName);
  if (body.description !== undefined) out.description = text(body.description, LIMITS.characterDescription);
  if (body.pictures !== undefined) {
    if (!Array.isArray(body.pictures)) throw new StoryError('ภาพไม่ถูกต้อง');
    const list = [...new Set(body.pictures.filter((u): u is string => typeof u === 'string' && u !== ''))];
    if (list.length > MAX_ASSET_PICTURES) throw new StoryError(`ภาพได้สูงสุด ${MAX_ASSET_PICTURES} ภาพต่อรายการ`);
    // This customer's own uploads, or pictures the item already has (one we drew for it).
    for (const u of list) if (!isOwnUpload(u, userId, 'image') && !existing.includes(u)) throw new StoryError('ภาพไม่ถูกต้อง อัปโหลดใหม่อีกครั้ง', 422);
    out.pictures = list;
  }
  return out;
}

/** PATCH body's `edit`: stored beside the music state in script_json. */
export function editPatch(project: StoryProjectFull, raw: unknown): Prisma.InputJsonValue {
  const script = (project.scriptJson ?? {}) as Record<string, unknown>;
  const current = parseEdit(script.edit, project.mode as StoryMode);
  const merged = parseEdit({ ...current, ...(raw && typeof raw === 'object' ? raw : {}) }, project.mode as StoryMode);
  return { ...script, edit: { ...merged } } as Prisma.InputJsonValue;
}
