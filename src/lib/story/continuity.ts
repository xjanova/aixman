import { createHash } from 'node:crypto';
import type { Msg } from '@/lib/i18n/locale';
import { assetPictures, pickReferences, type LibraryAsset, type ShotRefs } from './library';

export interface ContinuitySettings {
  enabled: boolean;
  endingFrame: boolean;
}

export function continuitySettings(script: unknown): ContinuitySettings {
  const raw = (script as { continuity?: Partial<ContinuitySettings> } | null)?.continuity;
  return { enabled: raw?.enabled === true, endingFrame: raw?.endingFrame === true };
}

interface ContinuityAsset {
  id: number;
  kind: string;
  name: string;
  description: string;
  referenceUrl: string | null;
  images: unknown;
}

interface ContinuityShot {
  id: number;
  shotNumber: number;
  sceneId: number | null;
  characterIds: unknown;
  propIds: unknown;
  locationId: number | null;
  visualPrompt: string;
  shotSize: string;
  angle?: string;
  keyframeStatus: string | null;
  keyframeUrl: string | null;
  keyframeUse: boolean;
  keyframeMeta?: unknown;
}

interface ContinuityProject {
  mode: string;
  templateKey: string;
  mood: string | null;
  aspectRatio: string;
  scriptJson: unknown;
  characters: ContinuityAsset[];
  scenes: { id: number; locationId: number | null; timeOfDay: string | null }[];
  shots: ContinuityShot[];
}

const ids = (raw: unknown): number[] => Array.isArray(raw) ? [...new Set(raw.filter((n): n is number => Number.isInteger(n) && n > 0))] : [];

export function continuityRefs(shot: ContinuityShot, project: ContinuityProject): ShotRefs {
  return { characterIds: ids(shot.characterIds), propIds: ids(shot.propIds), locationId: shot.locationId ?? project.scenes.find((s) => s.id === shot.sceneId)?.locationId ?? null };
}

function library(project: ContinuityProject): LibraryAsset[] {
  return project.characters.map((a) => ({ ...a, kind: a.kind === 'prop' || a.kind === 'location' ? a.kind : 'character', pictures: assetPictures(a) }));
}

export function missingFaces(shot: ContinuityShot, project: ContinuityProject): string[] {
  return ids(shot.characterIds).flatMap((id) => {
    const asset = project.characters.find((c) => c.id === id && c.kind === 'character');
    return asset && assetPictures(asset).length ? [] : [asset?.name ?? `#${id}`];
  });
}

export function keyframeSignature(shot: ContinuityShot, project: ContinuityProject): string {
  const refs = continuityRefs(shot, project);
  const relevant = [...refs.characterIds, refs.locationId, ...refs.propIds];
  const assets = library(project);
  const snapshot = {
    version: 1, mode: project.mode, look: project.templateKey, mood: project.mood, aspect: project.aspectRatio,
    visual: shot.visualPrompt, size: shot.shotSize, angle: shot.angle ?? 'eye-level', refs,
    time: project.scenes.find((s) => s.id === shot.sceneId)?.timeOfDay ?? null,
    assets: relevant.map((id) => assets.find((a) => a.id === id) ?? { id, missing: true }),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export type FaceReview = 'pending' | 'approved' | 'flagged';
export function keyframeMeta(raw: unknown): { signature: string; review: FaceReview; references: number[] } | null {
  const m = raw as { signature?: unknown; review?: unknown; references?: unknown } | null;
  if (typeof m?.signature !== 'string') return null;
  return { signature: m.signature, review: m.review === 'approved' || m.review === 'flagged' ? m.review : 'pending', references: ids(m.references) };
}

export function currentKeyframe(shot: ContinuityShot, project: ContinuityProject): boolean {
  const meta = keyframeMeta(shot.keyframeMeta);
  return shot.keyframeStatus === 'done' && Boolean(shot.keyframeUrl) && meta?.signature === keyframeSignature(shot, project)
    && (!continuitySettings(project.scriptJson).enabled || ids(shot.characterIds).every((id) => meta.references.includes(id)));
}

export type ContinuityState = 'off' | 'none' | 'missing' | 'rendering' | 'stale' | 'unreviewed' | 'approved' | 'flagged';
export function continuityState(shot: ContinuityShot, project: ContinuityProject): ContinuityState {
  if (!continuitySettings(project.scriptJson).enabled) return 'off';
  if (!ids(shot.characterIds).length) return 'none';
  if (missingFaces(shot, project).length) return 'missing';
  if (shot.keyframeStatus === 'rendering') return 'rendering';
  if (!shot.keyframeUrl || shot.keyframeStatus !== 'done') return 'missing';
  if (!currentKeyframe(shot, project)) return 'stale';
  if (!shot.keyframeUse) return 'unreviewed';
  const review = keyframeMeta(shot.keyframeMeta)?.review;
  return review === 'approved' ? 'approved' : review === 'flagged' ? 'flagged' : 'unreviewed';
}

export const CONTINUITY_LABELS: Record<ContinuityState, Msg> = {
  off: { th: 'ปิดการตรวจภาพตัวละคร', en: 'Character checks off' },
  none: { th: 'ไม่มีตัวละครในช็อต', en: 'No characters in this shot' },
  missing: { th: 'ต้องเตรียมภาพตัวละครและภาพเปิดช็อต', en: 'Character references and an opening picture are needed' },
  rendering: { th: 'กำลังเตรียมภาพเปิดช็อต', en: 'Preparing the opening picture' },
  stale: { th: 'บทหรือภาพอ้างอิงเปลี่ยนแล้ว ต้องสร้างภาพเปิดใหม่', en: 'The shot or references changed. Remake the opening picture' },
  unreviewed: { th: 'เทียบหน้ากับภาพอ้างอิง แล้วกดผ่านก่อนสร้างคลิป', en: 'Compare faces with the references and approve before rendering' },
  approved: { th: 'ตรวจหน้าผ่านแล้ว', en: 'Faces approved' },
  flagged: { th: 'แจ้งหน้าเพี้ยนแล้ว ต้องสร้างภาพเปิดใหม่', en: 'Face drift reported. Remake the opening picture' },
};

export function continuityBlock(shot: ContinuityShot, project: ContinuityProject): Msg | null {
  const state = continuityState(shot, project);
  return ['off', 'none', 'approved'].includes(state) ? null : CONTINUITY_LABELS[state];
}

export function keyframeReferenceBlock(shot: ContinuityShot, project: ContinuityProject, cap: number): Msg | null {
  if (!continuitySettings(project.scriptJson).enabled || !ids(shot.characterIds).length) return null;
  const missing = missingFaces(shot, project);
  if (missing.length) return { th: `เพิ่มภาพอ้างอิงตัวละครก่อน: ${missing.join(', ')}`, en: `Add character reference pictures first: ${missing.join(', ')}` };
  const sent = new Set(pickReferences(continuityRefs(shot, project), library(project), cap).map((r) => r.asset.id));
  if (ids(shot.characterIds).some((id) => !sent.has(id))) return {
    th: 'โมเดลนี้รับภาพไม่พอสำหรับตัวละครทุกคนในช็อต เลือกโมเดลที่รับภาพได้มากขึ้น',
    en: 'This model cannot take references for every character in the shot. Choose one that takes more pictures.',
  };
  return null;
}

export function endingFrame(shot: ContinuityShot, project: ContinuityProject, supported: boolean): { url: string; shotNumber: number } | null {
  const settings = continuitySettings(project.scriptJson);
  if (!settings.enabled || !settings.endingFrame || !supported || shot.sceneId === null || continuityState(shot, project) !== 'approved') return null;
  const next = project.shots.filter((s) => s.shotNumber > shot.shotNumber).sort((a, b) => a.shotNumber - b.shotNumber)[0];
  if (!next || next.sceneId !== shot.sceneId || continuityState(next, project) !== 'approved') return null;
  const cast = (s: ContinuityShot) => ids(s.characterIds).sort((a, b) => a - b).join(',');
  if (cast(shot) !== cast(next)) return null;
  return { url: next.keyframeUrl!, shotNumber: next.shotNumber };
}

export const CHARACTER_ANGLES = {
  front: { label: { th: 'หน้าตรง', en: 'Front portrait' }, prompt: 'Head-and-shoulders front portrait, looking at the camera, face large and clearly visible, neutral expression' },
  threequarter: { label: { th: 'หน้าเฉียง', en: 'Three-quarter portrait' }, prompt: 'Head-and-shoulders three-quarter portrait, face turned 45 degrees, eyes and facial features clearly visible' },
  profile: { label: { th: 'ด้านข้าง', en: 'Side profile' }, prompt: 'Head-and-shoulders side profile, face turned 90 degrees, facial silhouette clearly visible' },
  full: { label: { th: 'เต็มตัว / ชุด', en: 'Full body / costume' }, prompt: 'Full body, standing, facing the camera, entire costume and footwear visible' },
} as const;

export function characterAngle(raw: unknown): keyof typeof CHARACTER_ANGLES {
  return typeof raw === 'string' && Object.hasOwn(CHARACTER_ANGLES, raw) ? raw as keyof typeof CHARACTER_ANGLES : 'front';
}

export function characterPicturePrompt(name: string, description: string, angle: unknown): string {
  return `Character reference photo of ${name}: ${description}. ${CHARACTER_ANGLES[characterAngle(angle)].prompt}. Plain light grey studio background, even soft light. Exactly one person, one view; no collage, no contact sheet. Preserve the same facial proportions, age, hair, body and costume as the references.`;
}
