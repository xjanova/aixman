import type { Msg } from '@/lib/i18n/locale';

export const SHOT_TRANSITIONS: Record<string, Msg> = {
  inherit: { th: 'ตามการตัดต่อหลัก', en: 'Use film setting' },
  cut: { th: 'ตัดชน', en: 'Straight cut' },
  fade: { th: 'เฟดดำ', en: 'Fade through black' },
  dissolve: { th: 'ภาพซ้อน', en: 'Dissolve' },
  wipeleft: { th: 'กวาดซ้าย', en: 'Wipe left' },
};
export const SHOT_EFFECTS: Record<string, Msg> = {
  none: { th: 'ไม่มี', en: 'None' },
  warm: { th: 'โทนอุ่น', en: 'Warm' },
  cool: { th: 'โทนเย็น', en: 'Cool' },
  dream: { th: 'ความทรงจำ / ฝัน', en: 'Memory / dream' },
  flash: { th: 'แสงวาบเปิดช็อต', en: 'Opening flash' },
};
export const SHOT_SFX: Record<string, Msg> = {
  none: { th: 'ไม่มี', en: 'None' },
  whoosh: { th: 'ลมผ่าน', en: 'Whoosh' },
  impact: { th: 'กระแทกต่ำ', en: 'Low impact' },
  chime: { th: 'ระฆังใส', en: 'Chime' },
};
export interface ShotCut { transition: string; effect: string; sfx: string; sfxVolume: number }
const key = (v: unknown, table: Record<string, unknown>, fallback: string) => typeof v === 'string' && Object.hasOwn(table, v) ? v : fallback;
export function shotCut(raw: unknown): ShotCut {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = Number(r.sfxVolume);
  return { transition: key(r.transition, SHOT_TRANSITIONS, 'inherit'), effect: key(r.effect, SHOT_EFFECTS, 'none'), sfx: key(r.sfx, SHOT_SFX, 'none'),
    sfxVolume: typeof r.sfxVolume === 'number' && Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 100) / 100 : 0.3 };
}
export function transitionOf(cut: unknown, global: string): string {
  const t = shotCut(cut).transition;
  return t === 'inherit' ? global : t;
}
export function effectFilter(effect: string): string {
  return ({ warm: 'colorbalance=rs=0.045:bs=-0.035', cool: 'colorbalance=rs=-0.035:bs=0.045',
    dream: 'gblur=sigma=0.6,eq=saturation=0.75:brightness=0.025',
    flash: "eq=brightness='0.35*max(0,1-t/0.25)':eval=frame" } as Record<string, string>)[effect] ?? '';
}
export function lookGrade(look: string): string {
  if (['palace', 'siam', 'period', 'wuxia'].includes(look)) return 'colorbalance=rs=0.025:bs=-0.02,eq=saturation=0.95';
  if (look === 'xianxia') return 'colorbalance=bs=0.025,eq=saturation=1.05';
  return 'eq=contrast=1.025:saturation=0.98';
}
export function sfxSource(raw: unknown): string | null {
  const c = shotCut(raw);
  if (c.sfx === 'none' || c.sfxVolume === 0) return null;
  const source = ({
    whoosh: 'anoisesrc=color=pink:amplitude=0.3:duration=0.55:sample_rate=48000,highpass=f=800,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.43',
    impact: 'sine=frequency=65:duration=0.6:sample_rate=48000,afade=t=out:st=0:d=0.6',
    chime: 'sine=frequency=1200:duration=0.8:sample_rate=48000,afade=t=out:st=0:d=0.8',
  } as Record<string, string>)[c.sfx];
  return source ? `${source},volume=${c.sfxVolume},aformat=channel_layouts=stereo` : null;
}

export interface JoinPart { seconds: number; transition: string }
export const DISSOLVE_SECONDS = 0.3;

export function joinGraph(parts: JoinPart[]): string {
  if (!parts.length) throw new Error('No segments to join');
  const graph = parts.flatMap((p, k) => [
    `[${k}:v]settb=AVTB,setpts=PTS-STARTPTS[v${k}]`,
    `[${k}:a]atrim=duration=${p.seconds.toFixed(3)},asetpts=PTS-STARTPTS[a${k}]`,
  ]);
  let last = 'v0';
  let offset = parts[0].seconds;
  for (let k = 1; k < parts.length; k++) {
    const t = parts[k].transition;
    if (t === 'dissolve' || t === 'wipeleft') {
      graph.push(`[${last}]tpad=stop_mode=clone:stop_duration=${DISSOLVE_SECONDS}[p${k}]`);
      graph.push(`[p${k}][v${k}]xfade=transition=${t === 'dissolve' ? 'fade' : 'wipeleft'}:duration=${DISSOLVE_SECONDS}:offset=${offset.toFixed(3)}[j${k}]`);
    } else graph.push(`[${last}][v${k}]concat=n=2:v=1:a=0[j${k}]`);
    last = `j${k}`;
    offset += parts[k].seconds;
  }
  graph.push(`[${last}]format=yuv420p[vout]`);
  graph.push(`${parts.map((_, k) => `[a${k}]`).join('')}concat=n=${parts.length}:v=0:a=1[aout]`);
  return graph.join(';');
}
