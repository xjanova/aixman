import { ELEVENLABS_VOICES } from '@/lib/providers/elevenlabs-voices';
import { LIMITS } from './cinematic';
import type { Msg } from '@/lib/i18n/locale';

export const DUB_MODEL_KEY = 'kie/elevenlabs-v3';
export { ELEVENLABS_VOICES };
export const DELIVERIES = {
  neutral: { label: { th: 'ปกติ', en: 'Neutral' }, tag: '' },
  whisper: { label: { th: 'กระซิบ', en: 'Whisper' }, tag: '[whispers]' },
  shout: { label: { th: 'ตะโกน', en: 'Shout' }, tag: '[shouts]' },
  sad: { label: { th: 'เศร้า', en: 'Sad' }, tag: '[sad]' },
  angry: { label: { th: 'โกรธ', en: 'Angry' }, tag: '[angry]' },
  excited: { label: { th: 'ตื่นเต้น', en: 'Excited' }, tag: '[excited]' },
} as const;

export function voiceIdOf(raw: unknown): string | null {
  return typeof raw === 'string' && ELEVENLABS_VOICES.some((v) => v.id === raw) ? raw : null;
}
export function deliveryOf(raw: unknown): keyof typeof DELIVERIES {
  return typeof raw === 'string' && Object.hasOwn(DELIVERIES, raw) ? raw as keyof typeof DELIVERIES : 'neutral';
}
export interface DubbingSettings { enabled: boolean; narratorVoiceId: string }
export function dubbingSettings(script: unknown): DubbingSettings {
  const s = (script ?? {}) as { dubbing?: Partial<DubbingSettings> };
  return { enabled: s.dubbing?.enabled === true, narratorVoiceId: voiceIdOf(s.dubbing?.narratorVoiceId) ?? ELEVENLABS_VOICES[0].id };
}
export function spokenText(line: string): string {
  return line.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}
export function dubText(line: string, delivery: unknown): string {
  return [DELIVERIES[deliveryOf(delivery)].tag, spokenText(line)].filter(Boolean).join(' ');
}
export const DUB_TAIL_SECONDS = 0.2;
export function dubShotSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds + DUB_TAIL_SECONDS > LIMITS.maxShotSeconds) return null;
  return Math.max(LIMITS.minShotSeconds, Math.ceil((seconds + DUB_TAIL_SECONDS) * 100) / 100);
}
export interface SpeechFields {
  narration: string | null; speakerId: number | null; delivery: string;
  dubStatus: string | null; audioUrl: string | null; dubText: string | null;
  dubVoiceId: string | null; dubSeconds: unknown;
}
export interface VoiceContext { characters: { id: number; kind: string; voiceId: string | null }[]; scriptJson: unknown }
export function shotVoice(shot: Pick<SpeechFields, 'speakerId'>, project: VoiceContext): string | null {
  return shot.speakerId === null ? dubbingSettings(project.scriptJson).narratorVoiceId
    : voiceIdOf(project.characters.find((c) => c.id === shot.speakerId && c.kind === 'character')?.voiceId);
}
export function speechState(shot: SpeechFields, project: VoiceContext): 'none' | 'rendering' | 'done' | 'stale' | 'failed' {
  if (shot.dubStatus === 'rendering') return 'rendering';
  if (shot.dubStatus === 'failed') return 'failed';
  if (shot.dubStatus !== 'done' || !shot.audioUrl) return 'none';
  return shot.dubText === dubText(shot.narration ?? '', shot.delivery) && shot.dubVoiceId === shotVoice(shot, project) ? 'done' : 'stale';
}
export function speechBlock(shot: SpeechFields, project: VoiceContext): Msg | null {
  if (!spokenText(shot.narration ?? '')) return null;
  if (!shotVoice(shot, project)) return { th: 'เลือกเสียงให้ผู้พูดในคลังตัวละครก่อน', en: 'Choose the speaker’s voice in the character library first.' };
  if (speechState(shot, project) !== 'done') return { th: 'สร้างพากย์ให้ตรงกับบทและเสียงปัจจุบันก่อน', en: 'Create the dub for the current line and voice first.' };
  if (dubShotSeconds(Number(shot.dubSeconds)) === null) return { th: 'บทพูดยาวเกินช็อต 10 วินาที — ย่อบทหรือแบ่งเป็นหลายช็อตแล้วพากย์ใหม่', en: 'The line exceeds a 10-second shot — shorten it or split it into shots, then dub again.' };
  return null;
}
export function filmDubReady(shot: SpeechFields, project: VoiceContext): boolean {
  return Boolean(spokenText(shot.narration ?? '')) && speechBlock(shot, project) === null;
}
