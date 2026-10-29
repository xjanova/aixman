/**
 * How the karaoke looks on a video — pure and import-free, so the MV edit
 * settings (story/edit.ts) and the subtitle builder (karaoke-ass.ts) share it
 * without importing each other.
 */
import type { Msg } from '@/lib/i18n/locale';

export type KaraokeTheme = 'gold' | 'rose' | 'aqua' | 'neon';
export type KaraokePosition = 'bottom' | 'middle' | 'top';

export const KARAOKE_THEMES: Record<KaraokeTheme, { sung: string; unsung: string; outline: string; glow: string; label: Msg }> = {
  gold: { sung: '#FFD54A', unsung: '#FFFFFF', outline: '#1A1208', glow: '#FF9F1A', label: { th: 'ทองคำ', en: 'Gold' } },
  rose: { sung: '#FF5C8A', unsung: '#FFFFFF', outline: '#1F0610', glow: '#FF2E63', label: { th: 'กุหลาบ', en: 'Rose' } },
  aqua: { sung: '#4DE8FF', unsung: '#FFFFFF', outline: '#04161C', glow: '#00B8FF', label: { th: 'ฟ้าน้ำทะเล', en: 'Aqua' } },
  neon: { sung: '#B6FF3B', unsung: '#F5E9FF', outline: '#12051F', glow: '#C13BFF', label: { th: 'นีออน', en: 'Neon' } },
};

export const KARAOKE_POSITIONS: Record<KaraokePosition, Msg> = {
  bottom: { th: 'ด้านล่าง', en: 'Bottom' },
  middle: { th: 'กลางจอ', en: 'Middle' },
  top: { th: 'ด้านบน', en: 'Top' },
};

export interface KaraokeLook {
  theme: KaraokeTheme;
  position: KaraokePosition;
  /** Show the next line on the other row while this one is sung. */
  nextLine: boolean;
  countdown: boolean;
}

export const DEFAULT_KARAOKE_LOOK: KaraokeLook = { theme: 'gold', position: 'bottom', nextLine: true, countdown: true };

export function parseKaraokeLook(raw: unknown): KaraokeLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_KARAOKE_LOOK;
  return {
    theme: typeof r.theme === 'string' && Object.hasOwn(KARAOKE_THEMES, r.theme) ? (r.theme as KaraokeTheme) : d.theme,
    position: typeof r.position === 'string' && Object.hasOwn(KARAOKE_POSITIONS, r.position) ? (r.position as KaraokePosition) : d.position,
    nextLine: typeof r.nextLine === 'boolean' ? r.nextLine : d.nextLine,
    countdown: typeof r.countdown === 'boolean' ? r.countdown : d.countdown,
  };
}
