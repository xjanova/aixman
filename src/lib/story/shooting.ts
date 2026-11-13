import { CAMERA_MOVES, SHOT_SIZES } from './cinematic';
import { SHOT_EFFECTS, SHOT_SFX, SHOT_TRANSITIONS, shotCut } from './finishing';
import { TIMES_OF_DAY } from './library';
import type { Locale, Msg } from '@/lib/i18n/locale';
import { CAMERA_ANGLES, angleOf } from './angles';

export interface ScriptShot {
  id: number; shotNumber: number; sceneId: number | null; characterIds: unknown; propIds: unknown; locationId: number | null;
  speakerId: number | null; visualPrompt: string; narration: string | null; sound: string | null; shotSize: string; camera: string;
  angle?: string; continuityNote?: string | null; cutJson?: unknown; durationSec: unknown; status: string; mediaUrl?: string | null;
}
export interface ScriptProject {
  id: number; title: string; episodeNumber: number | null;
  characters: { id: number; name: string; description: string; kind: string }[];
  scenes: { id: number; sceneNumber: number; title: string; locationId: number | null; timeOfDay: string | null }[];
  shots: ScriptShot[];
}
const ids = (v: unknown): number[] => Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const sorted = (p: ScriptProject) => [...p.shots].sort((a, b) => a.shotNumber - b.shotNumber);

export function episodeLedger(project: ScriptProject, budget = 7500): string {
  const name = (id: number | null) => project.characters.find((a) => a.id === id)?.name ?? '';
  const lines = sorted(project).map((s) => {
    const scene = project.scenes.find((sc) => sc.id === s.sceneId);
    const place = name(s.locationId ?? scene?.locationId ?? null);
    const people = ids(s.characterIds).map(name).filter(Boolean).join(', ');
    const props = ids(s.propIds).map(name).filter(Boolean).join(', ');
    const event = oneLine(s.continuityNote || s.visualPrompt).slice(0, 500);
    return `Shot ${s.shotNumber} [${s.status === 'done' && s.mediaUrl ? 'rendered; script description' : 'planned; not rendered'}] ${place ? `at ${place}; ` : ''}${scene?.timeOfDay ? `${scene.timeOfDay}; ` : ''}${people ? `cast: ${people}; ` : ''}${props ? `props: ${props}; ` : ''}${event}${s.narration ? ` | ${name(s.speakerId) || 'Narrator'}: ${oneLine(s.narration).slice(0, 180)}` : ''}`;
  });
  const header = `EP.${project.episodeNumber ?? '?'} ${oneLine(project.title)} — ledger from current shot scripts, not visual analysis.\n`;
  const kept: string[] = [];
  let used = header.length + '(earlier shots omitted)\n'.length;
  for (let k = lines.length - 1; k >= 0; k--) {
    if (used + lines[k].length + 1 > budget) break;
    kept.unshift(lines[k]); used += lines[k].length + 1;
  }
  return kept.length ? header + (kept.length < lines.length ? '(earlier shots omitted)\n' : '') + kept.join('\n') : '';
}

export function continuityContext(ledgers: string[]): string {
  if (!ledgers.filter(Boolean).length) return '';
  return `\n\nContinuity from earlier episodes (latest shot scripts; a planned shot is not a completed take):\n${ledgers.filter(Boolean).join('\n\n')}\nContinue these state changes, locations, injuries, possessions and revelations. Never revive a dead character, restore a lost object or erase a revelation without an explicit story reason. The current episode must show any change.\n`;
}

export function shootingScript(project: ScriptProject, locale: Locale): string {
  const th = locale === 'th';
  const t = (m: Msg) => m[locale];
  const name = (id: number | null) => project.characters.find((a) => a.id === id)?.name ?? '';
  const lines = [project.title, th ? 'บทถ่ายทำจากช็อตปัจจุบัน — สถานะสร้างคลิปไม่ใช่การตรวจเนื้อหาในภาพ' : 'Shooting script from current shots — render status is not visual verification', ''];
  let at = 0;
  for (const s of sorted(project)) {
    const sc = project.scenes.find((x) => x.id === s.sceneId);
    const duration = Number(s.durationSec) || 0;
    const cut = shotCut(s.cutJson);
    lines.push(`${th ? 'ช็อต' : 'Shot'} ${s.shotNumber} | ${at.toFixed(2)}–${(at + duration).toFixed(2)}s | ${s.status === 'done' && s.mediaUrl ? (th ? 'สร้างคลิปแล้ว' : 'Rendered') : (th ? 'ยังไม่สร้างคลิป' : 'Not rendered')}`);
    lines.push(`${sc ? `${th ? 'ฉาก' : 'Scene'} ${sc.sceneNumber}: ${sc.title} | ` : ''}${name(s.locationId ?? sc?.locationId ?? null)}${sc?.timeOfDay && TIMES_OF_DAY[sc.timeOfDay] ? ` | ${t(TIMES_OF_DAY[sc.timeOfDay].label)}` : ''}`);
    lines.push([SHOT_SIZES[s.shotSize]?.label, CAMERA_ANGLES[angleOf(s.angle)].label, CAMERA_MOVES[s.camera]?.label].filter((m): m is Msg => Boolean(m)).map(t).join(' | '));
    lines.push(`${th ? 'ตัวละคร' : 'Cast'}: ${ids(s.characterIds).map(name).filter(Boolean).join(', ')}`, `${th ? 'ภาพ' : 'Visual'}: ${s.visualPrompt}`);
    if (s.narration) lines.push(`${name(s.speakerId) || (th ? 'ผู้บรรยาย' : 'Narrator')}: ${s.narration}`);
    if (s.sound) lines.push(`${th ? 'เสียงบรรยากาศ' : 'Ambience'}: ${s.sound}`);
    if (s.continuityNote) lines.push(`${th ? 'ส่งต่อเหตุการณ์' : 'State change'}: ${s.continuityNote}`);
    lines.push(`${th ? 'ตัดต่อ' : 'Edit'}: ${t(SHOT_TRANSITIONS[cut.transition])} | ${t(SHOT_EFFECTS[cut.effect])} | ${t(SHOT_SFX[cut.sfx])}`, '');
    at += duration;
  }
  return lines.join('\n');
}
