/**
 * What the camera does in each camera option the studio and the movie editor
 * offer, as numbers a small 3D scene plays back — so a customer sees "push in"
 * against "zoom" against "orbit" instead of guessing from the words.
 *
 * Pure: no three.js here. `src/components/camera-preview/engine.ts` builds the
 * scene and calls `shotAt` every frame. The scene's fixed facts, which every
 * number below is measured against:
 *   - the figure stands at the origin facing +z, 1.75 tall, head centre at
 *     y 1.55 (radius 0.17), eyes at y 1.57;
 *   - a flower at (0.35, 0, 0.9), bloom at y 0.24 — the macro subject;
 *   - stepping stones run from the figure along −z, kept clear of trees;
 *   - no tree reaches within 5.5 of the origin, nor into the wedge in front of
 *     the figure (|x| < 1.5 + 0.35z) or the path behind it (|x| < 1.4);
 *   - treetops end below 3.6, and the hills begin 40 out;
 *   - the moon hangs at (−8, 40, −60), behind the figure.
 */

import type { Locale, Msg } from '@/lib/i18n/locale';

export type Vec3 = [number, number, number];

export const CAMERA_MOVE_IDS = [
  'static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'truck-left', 'tilt-up',
  'orbit', 'tracking', 'crane-up', 'handheld', 'pov', 'drone', 'zoom-face',
] as const;
/** The movie editor's `SHOT_SIZES` keys, one for one. */
export const SHOT_SIZE_IDS = ['extreme-wide', 'wide', 'full', 'medium', 'medium-close', 'close', 'extreme-close'] as const;
export const LENS_ANGLE_IDS = ['portrait-85', 'wide-24', 'macro', 'aerial', 'low-angle', 'top-down'] as const;

export type CameraMoveId = (typeof CAMERA_MOVE_IDS)[number];
export type ShotSizeId = (typeof SHOT_SIZE_IDS)[number];
export type LensAngleId = (typeof LENS_ANGLE_IDS)[number];

/**
 * One preview: a move (optionally from a shot size's framing — the movie
 * editor's pair), a size held still, or a still-photo angle.
 */
export interface ShotSpec {
  move?: CameraMoveId;
  size?: ShotSizeId;
  angle?: LensAngleId;
}

export interface HeroPose {
  x: number;
  z: number;
  /** Rotation about y; 0 faces +z (the default camera). */
  heading: number;
  /** 0 = standing, 1 = walking. */
  walk: number;
  /** Stride phase in radians. */
  phase: number;
  /** 0..1, the left arm raised to wave. */
  wave: number;
}

export interface ShotFrame {
  eye: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Radians about the view axis (handheld). */
  roll: number;
  hero: HeroPose;
  /** Background blur in px at a 160 px wide tile; 0 = all sharp. */
  blur: number;
  /** What stays sharp when `blur` is on. */
  focus: 'hero' | 'flower';
  /** 0..1 darkness of the loop's cross-fade. */
  fade: number;
}

export const isCameraMoveId = (v: unknown): v is CameraMoveId =>
  typeof v === 'string' && (CAMERA_MOVE_IDS as readonly string[]).includes(v);
export const isShotSizeId = (v: unknown): v is ShotSizeId =>
  typeof v === 'string' && (SHOT_SIZE_IDS as readonly string[]).includes(v);

/** One-liners under each tile, in both languages: what the camera physically does. */
export const MOVE_HINTS: Record<CameraMoveId, Msg> = {
  static: { th: 'กล้องไม่ขยับเลย ขยับแค่ตัวละคร', en: 'The camera stays still; only the character moves' },
  'push-in': { th: 'กล้องเคลื่อนเข้าหาตัวละคร', en: 'The camera moves toward the character' },
  'pull-out': { th: 'กล้องถอยห่าง เห็นฉากกว้างขึ้น', en: 'The camera backs away to show more of the scene' },
  'pan-left': { th: 'กล้องอยู่กับที่ หันไปทางซ้าย', en: 'The camera stays put and turns left' },
  'pan-right': { th: 'กล้องอยู่กับที่ หันไปทางขวา', en: 'The camera stays put and turns right' },
  'truck-left': { th: 'กล้องเลื่อนข้างไปพร้อมตัวละคร', en: 'The camera slides sideways with the character' },
  'tilt-up': { th: 'กล้องอยู่กับที่ เงยจากพื้นขึ้นฟ้า', en: 'The camera stays put and tilts from the ground up to the sky' },
  orbit: { th: 'กล้องเดินวนรอบตัวละคร', en: 'The camera circles the character' },
  tracking: { th: 'กล้องเดินตามหลังตัวละคร', en: 'The camera follows behind the character' },
  'crane-up': { th: 'กล้องลอยสูงขึ้น เผยทั้งฉาก', en: 'The camera rises to reveal the whole scene' },
  handheld: { th: 'ภาพไหวนิดๆ เหมือนถือกล้องด้วยมือ', en: 'A slight shake, like a camera held by hand' },
  pov: { th: 'เห็นภาพผ่านสายตาตัวละคร', en: "Seen through the character's eyes" },
  drone: { th: 'บินสูงผ่านเหนือฉาก', en: 'Flies high over the scene' },
  'zoom-face': { th: 'กล้องอยู่กับที่ ซูมเลนส์เข้าที่หน้า', en: 'The camera stays put and zooms in on the face' },
};

export const SIZE_HINTS: Record<ShotSizeId, Msg> = {
  'extreme-wide': { th: 'เห็นทั้งฉาก ตัวละครเล็กนิดเดียว', en: 'The whole scene; the character is tiny' },
  wide: { th: 'ตัวละครทั้งตัวกับฉากรอบๆ', en: 'The whole character and the scene around them' },
  full: { th: 'ตัวละครเต็มตัวพอดีเฟรม', en: 'The whole character, just filling the frame' },
  medium: { th: 'ตั้งแต่เอวขึ้นไป', en: 'From the waist up' },
  'medium-close': { th: 'ตั้งแต่อกขึ้นไป', en: 'From the chest up' },
  close: { th: 'เต็มใบหน้า', en: 'The face fills the frame' },
  'extreme-close': { th: 'เจาะรายละเอียด เช่น ดวงตา', en: 'A close detail, such as the eyes' },
};

export const ANGLE_HINTS: Record<LensAngleId, Msg> = {
  'portrait-85': { th: 'หน้าคมชัด ฉากหลังเบลอ', en: 'Sharp face, blurred background' },
  'wide-24': { th: 'เห็นฉากกว้าง ระยะใกล้ดูลึก', en: 'A wide view with deep perspective up close' },
  macro: { th: 'ของชิ้นเล็กๆ ใกล้มาก', en: 'Small things, very close' },
  aerial: { th: 'มองลงมาจากท้องฟ้า', en: 'Looking down from the sky' },
  'low-angle': { th: 'มองขึ้นจากพื้น ดูยิ่งใหญ่', en: 'Looking up from the ground; feels grand' },
  'top-down': { th: 'มองตรงลงมาจากด้านบน', en: 'Looking straight down from above' },
};

/** The hint under a preview tile; Thai unless a locale is given. */
export function shotHint(spec: ShotSpec, locale: Locale = 'th'): string {
  if (spec.angle) return ANGLE_HINTS[spec.angle][locale];
  if (spec.move) return MOVE_HINTS[spec.move][locale];
  if (spec.size) return SIZE_HINTS[spec.size][locale];
  return '';
}

/** Seconds one loop of the preview lasts. */
export function loopSeconds(spec: ShotSpec): number {
  if (spec.angle) return 4.2;
  switch (spec.move) {
    case undefined: return 5;
    case 'orbit': return 7;
    case 'drone': return 5;
    case 'tracking':
    case 'truck-left':
    case 'pov': return 4;
    case 'handheld': return 4;
    default: return 3.4;
  }
}

/** The loop phase a still preview (reduced motion) is drawn at: the move mostly done. */
export const STILL_PHASE = 0.7;

// ── framing ───────────────────────────────────────────────────────────────

interface Framing {
  /** Distance from the figure's axis. */
  d: number;
  eyeY: number;
  lookY: number;
  fov: number;
}

/** Where each shot size puts the camera (35° vertical: the visible height is 0.63 × distance). */
const SIZES: Record<ShotSizeId, Framing> = {
  'extreme-wide': { d: 24, eyeY: 3.4, lookY: 1.6, fov: 35 },
  wide: { d: 9.5, eyeY: 1.8, lookY: 1.05, fov: 35 },
  full: { d: 3.9, eyeY: 1.3, lookY: 0.92, fov: 35 },
  medium: { d: 1.95, eyeY: 1.5, lookY: 1.33, fov: 35 },
  'medium-close': { d: 1.35, eyeY: 1.55, lookY: 1.46, fov: 35 },
  close: { d: 0.85, eyeY: 1.56, lookY: 1.54, fov: 35 },
  'extreme-close': { d: 0.42, eyeY: 1.57, lookY: 1.57, fov: 35 },
};

/** Radius around the figure no tree reaches. */
const CLEARING = 5.5;
/** Higher than the tallest treetop. */
const ABOVE_TREES = 4.2;
/** Farthest the camera goes from the figure: the hills start beyond it. */
const MAX_REACH = 36;

/** A studio move tile frames the whole figure with some ground around it. */
const MOVE_FRAMING: Framing = { d: 4.6, eyeY: 1.5, lookY: 1.05, fov: 38 };

// ── helpers ───────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** A move that travels: still for a beat, moves, holds, then fades to start over. */
const TRAVEL_FROM = 0.06;
const TRAVEL_TO = 0.84;
const FADE_OUT = 0.92;
function travel(t: number, to = TRAVEL_TO): number {
  return easeInOut(clamp01((t - TRAVEL_FROM) / (to - TRAVEL_FROM)));
}
function travelLinear(t: number): number {
  return clamp01((t - TRAVEL_FROM) / (TRAVEL_TO - TRAVEL_FROM));
}
function loopFade(t: number): number {
  if (t < TRAVEL_FROM) return 1 - t / TRAVEL_FROM;
  if (t > FADE_OUT) return (t - FADE_OUT) / (1 - FADE_OUT);
  return 0;
}

const STANDING: HeroPose = { x: 0, z: 0, heading: 0, walk: 0, phase: 0, wave: 0 };

function frame(eye: Vec3, target: Vec3, fov: number, extra: Partial<ShotFrame> = {}): ShotFrame {
  return { eye, target, fov, roll: 0, hero: STANDING, blur: 0, focus: 'hero', fade: 0, ...extra };
}

/** The view direction from `eye` to `target`, turned about y by `yaw` (positive = to the right). */
function turned(eye: Vec3, target: Vec3, yaw: number): Vec3 {
  const dx = target[0] - eye[0];
  const dz = target[2] - eye[2];
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  return [eye[0] + dx * c + dz * s, target[1], eye[2] - dx * s + dz * c];
}

// ── moves ─────────────────────────────────────────────────────────────────

function moveAt(move: CameraMoveId, f: Framing, t: number): ShotFrame {
  const eye: Vec3 = [0, f.eyeY, f.d];
  const target: Vec3 = [0, f.lookY, 0];
  switch (move) {
    case 'static': {
      // The camera is still on purpose; the figure waves so the tile is not a photo.
      const wave = clamp01((t - 0.1) / 0.15) * (1 - clamp01((t - 0.75) / 0.15));
      return frame(eye, target, f.fov, { hero: { ...STANDING, wave } });
    }
    case 'push-in': {
      const p = travel(t);
      const end = Math.max(f.d * 0.38, Math.min(0.32, f.d * 0.75));
      return frame([0, lerp(f.eyeY, 1.55, p * 0.6), lerp(f.d, end, p)], [0, lerp(f.lookY, 1.5, p * 0.7), 0], f.fov, { fade: loopFade(t) });
    }
    case 'pull-out': {
      const p = travel(t);
      return frame(
        [0, f.eyeY + p * (0.15 * f.d + 0.5), lerp(f.d, Math.min(f.d * 2.8 + 1, MAX_REACH), p)],
        [0, lerp(f.lookY, 1, p), 0],
        f.fov,
        { fade: loopFade(t) },
      );
    }
    case 'pan-left':
    case 'pan-right': {
      const p = travel(t);
      const sweep = lerp(-0.6, 0.6, p) * (move === 'pan-right' ? 1 : -1);
      return frame(eye, turned(eye, target, sweep), f.fov, { fade: loopFade(t) });
    }
    case 'truck-left': {
      // The figure walks left; the camera slides with it, so only the world streams past.
      const x = lerp(1.8, -1.8, travelLinear(t));
      return frame([x, f.eyeY, f.d], [x, f.lookY, 0], f.fov, {
        hero: { x, z: 0, heading: -Math.PI / 2, walk: 1, phase: TAU * 5 * t, wave: 0 },
        fade: loopFade(t),
      });
    }
    case 'tilt-up': {
      const p = travel(t);
      const at: Vec3 = [0, 1.6, Math.max(f.d, 6)];
      const pitch = lerp(-0.5, 0.7, p);
      return frame(at, [0, at[1] + Math.sin(pitch), at[2] - Math.cos(pitch)], f.fov, { fade: loopFade(t) });
    }
    case 'orbit': {
      // A full circle per loop, so it never has to cut. Wider than the
      // clearing, it circles above the treetops instead of through them.
      const a = 0.3 + TAU * t;
      const y = f.d > CLEARING ? Math.max(f.eyeY, ABOVE_TREES) : f.eyeY;
      return frame([Math.sin(a) * f.d, y, Math.cos(a) * f.d], target, f.fov);
    }
    case 'tracking': {
      // The figure walks away down the stones; the camera follows over its shoulder.
      const z = lerp(1, -7, travelLinear(t));
      const k = f.d / MOVE_FRAMING.d;
      return frame([0.9 * k, lerp(1.25, 1.75, Math.min(1, k)), z + 3.2 * k], [0, 1.1, z - 1.5], f.fov, {
        hero: { x: 0, z, heading: Math.PI, walk: 1, phase: TAU * 4 * t, wave: 0 },
        fade: loopFade(t),
      });
    }
    case 'crane-up': {
      const p = travel(t);
      return frame(
        [0, lerp(0.45, 0.45 + Math.max(3.5, f.d * 0.9), p), lerp(f.d * 0.9, f.d * 1.25, p)],
        [0, lerp(f.lookY, 0.7, p), 0],
        f.fov,
        { fade: loopFade(t) },
      );
    }
    case 'handheld': {
      // Whole-number frequencies keep the shake seamless across the loop.
      const amp = 0.025 + 0.012 * f.d;
      const s = (n: number, ph = 0) => Math.sin(TAU * n * t + ph);
      return frame(
        [eye[0] + amp * (s(3) + 0.5 * s(7, 1)), eye[1] + amp * 0.7 * (s(4, 2) + 0.4 * s(9)), eye[2]],
        [target[0] + amp * 0.6 * s(5, 0.5), target[1] + amp * 0.5 * s(6, 1.5), target[2]],
        f.fov,
        { roll: 0.012 * s(5, 0.5) },
      );
    }
    case 'pov': {
      // Through someone's eyes, walking toward the figure, who waves back.
      const z = lerp(2.5, -3.5, travelLinear(t));
      const bob = 0.035 * Math.sin(TAU * 5 * t);
      const sway = 0.025 * Math.sin(TAU * 2.5 * t);
      return frame([sway, 1.62 + bob, z], [0.15 * Math.sin(TAU * t), 1.5, z - 4], 42, {
        hero: { x: 0, z: -7.5, heading: 0, walk: 0, phase: 0, wave: 1 },
        fade: loopFade(t),
      });
    }
    case 'drone': {
      const k = travelLinear(t);
      // Over the wood beside the path, so treetops stream past underneath.
      const at: Vec3 = [lerp(3.6, 5.2, k), 8, lerp(6, -26, k)];
      return frame(at, [at[0] - 2.2, 0, at[2] - 8], 42, { fade: loopFade(t) });
    }
    case 'zoom-face': {
      // The camera stays put and only the lens narrows: the flat look a zoom has.
      const p = travel(t);
      const d = Math.max(f.d, 5.5);
      const faceFov = (2 * Math.atan(0.24 / d) * 180) / Math.PI;
      return frame([0, 1.5, d], [0, lerp(f.lookY, 1.55, p), 0], lerp(f.fov, faceFov, p), { fade: loopFade(t) });
    }
  }
}

// ── still-photo angles ────────────────────────────────────────────────────

/** Each angle starts from a plain eye-level view and settles into itself, so the change is what teaches. */
const NEUTRAL = { eye: [0, 1.5, 4.6] as Vec3, target: [0, 1.05, 0] as Vec3, fov: 38 };

const ANGLES: Record<LensAngleId, { eye: Vec3; target: Vec3; fov: number; blur: number; focus: 'hero' | 'flower' }> = {
  'portrait-85': { eye: [0.25, 1.58, 3.2], target: [0, 1.5, 0], fov: 13, blur: 3.5, focus: 'hero' },
  'wide-24': { eye: [0.9, 1.0, 2.2], target: [0, 1.15, 0], fov: 78, blur: 0, focus: 'hero' },
  macro: { eye: [0.42, 0.3, 1.25], target: [0.35, 0.235, 0.9], fov: 28, blur: 5, focus: 'flower' },
  aerial: { eye: [3.2, 8.5, 5.5], target: [0, 0.3, 0], fov: 40, blur: 0, focus: 'hero' },
  'low-angle': { eye: [0.25, 0.22, 2.4], target: [0, 1.75, 0], fov: 52, blur: 0, focus: 'hero' },
  // A hair off vertical, so the view keeps one orientation (head at the top of the frame).
  'top-down': { eye: [0, 4.6, 0.02], target: [0, 0, 0], fov: 40, blur: 0, focus: 'hero' },
};

function angleAt(angle: LensAngleId, t: number): ShotFrame {
  const a = ANGLES[angle];
  const p = travel(t, 0.6);
  return frame(lerp3(NEUTRAL.eye, a.eye, p), lerp3(NEUTRAL.target, a.target, p), lerp(NEUTRAL.fov, a.fov, p), {
    blur: a.blur * p,
    focus: a.focus,
    fade: loopFade(t),
  });
}

/** Where the camera is at loop phase `t` (0 ≤ t < 1). */
export function shotAt(spec: ShotSpec, t: number): ShotFrame {
  const phase = ((t % 1) + 1) % 1;
  if (spec.angle) return angleAt(spec.angle, phase);
  const framing = spec.size ? SIZES[spec.size] : MOVE_FRAMING;
  // A size alone is held still; the figure's idle sway keeps it alive.
  if (!spec.move) return frame([0, framing.eyeY, framing.d], [0, framing.lookY, 0], framing.fov);
  return moveAt(spec.move, framing, phase);
}

/** A stable string for a spec — effect dependencies, map keys. */
export function shotKey(spec: ShotSpec): string {
  return `${spec.move ?? ''}|${spec.size ?? ''}|${spec.angle ?? ''}`;
}

export function parseShotKey(key: string): ShotSpec {
  const [move, size, angle] = key.split('|');
  const spec: ShotSpec = {};
  if (isCameraMoveId(move)) spec.move = move;
  if (isShotSizeId(size)) spec.size = size;
  if ((LENS_ANGLE_IDS as readonly string[]).includes(angle)) spec.angle = angle as LensAngleId;
  return spec;
}
