import type { Locale } from '@/lib/i18n/locale';

/**
 * Suno's stem names in English. kie-suno.ts names each stem in Thai — in the
 * "one instrument" picker and on every file a split returns, which is stored
 * with the order (`params.outputLabels`) — so the English is looked up here by
 * that Thai name: for the picker (/api/models) and for finished files (the
 * studio). Pure: tests use it.
 */
const STEM_EN: Record<string, string> = {
  // SUNO_STEMS — what "ดึงชิ้นเดียว" may pull out
  'เสียงร้องนำ': 'Lead vocal',
  'เสียงประสาน': 'Backing vocals',
  'คอรัส': 'Choir',
  'กลองชุด': 'Drum kit',
  'กระเดื่อง': 'Kick',
  'สแนร์': 'Snare',
  'เครื่องเคาะ': 'Percussion',
  'เบส': 'Bass',
  'กีตาร์': 'Guitar',
  'กีตาร์โปร่ง': 'Acoustic guitar',
  'กีตาร์ไฟฟ้า': 'Electric guitar',
  'เปียโน': 'Piano',
  'คีย์บอร์ด': 'Keyboards',
  'ออร์แกน': 'Organ',
  'ซินธ์': 'Synth',
  'ซินธ์แพด': 'Synth pad',
  'เครื่องสาย': 'Strings',
  'ไวโอลิน': 'Violin',
  'เครื่องทองเหลือง': 'Brass',
  'แซกโซโฟน': 'Saxophone',
  'ฟลุต': 'Flute',
  'เอฟเฟกต์เสียง': 'Sound effects',
  // STEM_LABELS — the groups a split names its files by
  'เสียงร้อง': 'Vocals',
  'ดนตรี (ไม่มีเสียงร้อง)': 'Music (no vocals)',
  'กลอง': 'Drums',
  'เอฟเฟกต์': 'Effects',
  'เครื่องเป่าลมไม้': 'Woodwinds',
};

const THAI = /[฀-๿]/;

/** A stem's name, as kie-suno.ts writes it, in `locale`; a name of no known shape is returned as it is. */
export function stemLabelText(label: string, locale: Locale): string {
  if (locale === 'th' || !THAI.test(label)) return label;
  const known = STEM_EN[label];
  if (known) return known;
  // An "ดึงชิ้นเดียว" split's second file: the song with that part taken out.
  const without = /^เพลงที่ไม่มี(.+)$/.exec(label);
  if (without) {
    const part = STEM_EN[without[1]];
    return part ? `Song without ${part.toLowerCase()}` : 'Song without that part';
  }
  const nth = /^สเต็ม (\d+)$/.exec(label);
  if (nth) return `Stem ${nth[1]}`;
  return label;
}

/** The "one instrument" picker's list for `locale`. */
export function stemOptions<T extends { label: string }>(stems: readonly T[] | null, locale: Locale): T[] | null {
  return stems ? stems.map((s) => ({ ...s, label: stemLabelText(s.label, locale) })) : null;
}
