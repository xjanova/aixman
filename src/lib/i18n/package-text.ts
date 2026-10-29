import type { Locale } from '@/lib/i18n/locale';

/**
 * Credit packages in English. Their names, badges and feature lines are typed
 * by an admin in Thai into `ai_credit_packages` — a table xmanstudio also
 * reads, so it gets no English columns. The lines admins actually write follow
 * a few shapes; those are translated here, and a feature line in Thai that
 * matches none is left out of the English page rather than shown in Thai.
 */

const THAI = /[฀-๿]/;

const WORDS: Record<string, string> = {
  // names
  'ทดลองใช้': 'Trial',
  // badges
  'ฟรี': 'Free',
  'ยอดนิยม': 'Popular',
  'คุ้มที่สุด': 'Best value',
  'คุ้มสุด': 'Best value',
  'สำหรับทีม': 'For teams',
  'แนะนำ': 'Recommended',
  'ใหม่': 'New',
  // features
  'ไม่มีวันหมดอายุ': 'Never expires',
  'สำหรับสมาชิกใหม่': 'For new members',
  'ซัพพอร์ตพิเศษ': 'Priority support',
  'ใช้ได้ทุกโมเดล': 'Works with every model',
};

const n = (s: string) => s.replace(/\s+/g, '');
/** "~1 video", "~2 videos", "~5–7 videos": plural unless the count is exactly one. */
const about = (count: string, one: string, many: string) => {
  const c = n(count);
  return `~${c} ${c === '1' ? one : many}`;
};
const credits = (count: string, kind = '') => `${count}${kind} ${count === '1' ? 'credit' : 'credits'}`;

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^([\d,]+)\s*เครดิตฟรี$/, (m) => credits(m[1], ' free')],
  [/^ฟรี\s*([\d,]+)\s*เครดิต$/, (m) => credits(m[1], ' free')],
  [/^([\d,]+)\s*\+\s*([\d,]+)\s*โบนัส(\s*เครดิต)?$/, (m) => `${m[1]} + ${m[2]} bonus credits`],
  [/^([\d,]+)\s*เครดิต$/, (m) => credits(m[1])],
  [/^โบนัส\s*([\d,]+)\s*เครดิต$/, (m) => credits(m[1], ' bonus')],
  [/^ภาพ\s*~\s*([\d,\-–\s]+?)\s*ภาพ$/, (m) => about(m[1], 'image', 'images')],
  [/^วิดีโอ\s*~\s*([\d,\-–\s]+?)\s*(คลิป|วิดีโอ)$/, (m) => about(m[1], 'video', 'videos')],
  [/^คลิป\s*~\s*([\d,\-–\s]+?)\s*คลิป$/, (m) => about(m[1], 'video', 'videos')],
  [/^เพลง\s*~\s*([\d,\-–\s]+?)\s*เพลง$/, (m) => about(m[1], 'song', 'songs')],
  [/^ประหยัด\s*([\d.]+%)$/, (m) => `Save ${m[1]}`],
];

/** One package text in English, or null when it is Thai this file cannot read. */
export function packageTextEn(text: string): string | null {
  const s = text.trim();
  if (!THAI.test(s)) return s;
  if (WORDS[s]) return WORDS[s];
  for (const [re, to] of PATTERNS) {
    const m = s.match(re);
    if (m) return to(m);
  }
  return null;
}

/** A package name or badge in `locale`; untranslatable Thai stays as typed (a name must show). */
export function packageLabel(text: string, locale: Locale): string;
export function packageLabel(text: string | null, locale: Locale): string | null;
export function packageLabel(text: string | null, locale: Locale): string | null {
  if (text === null || locale === 'th') return text;
  return packageTextEn(text) ?? text;
}

/** Feature lines in `locale`; in English, Thai lines it cannot translate are dropped. */
export function packageFeatures(features: string[], locale: Locale): string[] {
  if (locale === 'th') return features;
  return features.map(packageTextEn).filter((f): f is string => f !== null);
}
