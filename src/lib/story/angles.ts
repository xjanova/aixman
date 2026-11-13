import type { Msg } from '@/lib/i18n/locale';

export const CAMERA_ANGLES: Record<string, { label: Msg; prompt: string }> = {
  'eye-level': { label: { th: 'ระดับสายตา', en: 'Eye level' }, prompt: 'Eye-level angle.' },
  low: { label: { th: 'มุมต่ำ', en: 'Low angle' }, prompt: 'Low angle, looking slightly up.' },
  high: { label: { th: 'มุมสูง', en: 'High angle' }, prompt: 'High angle, looking slightly down.' },
  'over-shoulder': { label: { th: 'ข้ามไหล่', en: 'Over the shoulder' }, prompt: 'Over-the-shoulder angle; the speaking face is unobstructed, large and in focus.' },
  dutch: { label: { th: 'มุมเอียง', en: 'Dutch angle' }, prompt: 'A subtle Dutch angle conveys unease.' },
};
export const CONTINUITY_NOTE_LIMIT = 500;
export const angleOf = (v: unknown): string => typeof v === 'string' && Object.hasOwn(CAMERA_ANGLES, v) ? v : 'eye-level';
