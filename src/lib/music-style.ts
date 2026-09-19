/**
 * The vocabulary of song controls — one list, read by both ends.
 *
 * YuE2 takes its direction as free text under a `[Tags]` header (ComfyUI
 * v0.36.0, `comfy/text_encoders/yue2.py`: the prompt is
 * `"<instruction>\n[Tags]\n<style>\n[Lyrics]\n<lyrics>\n"`), and the official
 * Comfy-Org template documents the shape of that text: one comma-separated
 * line reading language, genre, vocal, tempo, instruments, mood, production —
 *
 *   "English, soulful jazz-pop, expressive male vocal, relaxed 88 BPM,
 *    Rhodes piano, upright bass, brushed drums, intimate late-night atmosphere"
 *
 * So the studio's chips are not a decorative layer over a prompt box: they are
 * the documented way to drive this model. Each option therefore carries both
 * the Thai label a customer picks and the exact English tag the model reads.
 *
 * The composing happens server-side (`composeMusicTags`), so the studio, the
 * mobile app and any future client all produce the same prompt from the same
 * choices, and the stored `params.music` keeps the choices themselves — a
 * customer can reopen an order and see "หญิง / ลูกทุ่ง / 92 BPM", not a
 * sentence someone's UI happened to build.
 *
 * Pure and dependency-free, like `pricing.ts`, so it can be imported from a
 * client component without dragging the server in.
 */

export interface MusicOption {
  id: string;
  /** What the customer sees. */
  label: string;
  /** What the model reads. Empty means "say nothing about this". */
  tag: string;
}

/**
 * Who is singing. Skipped entirely for an instrumental.
 *
 * Age, timbre and this are joined into **one** phrase, so their tags are
 * written to read as one: the age and timbre entries are bare adjectives and
 * only these carry the noun. A comma anywhere in here would split the phrase
 * in the middle and leave the model reading "warm rounded tone" as a separate
 * performer.
 */
export const MUSIC_VOCALS: MusicOption[] = [
  { id: 'male', label: 'ชาย', tag: 'male vocal' },
  { id: 'female', label: 'หญิง', tag: 'female vocal' },
  { id: 'duet', label: 'ดูโอ้ ชาย–หญิง', tag: 'male and female duet vocals' },
  { id: 'group', label: 'กลุ่ม/ประสานเสียง', tag: 'layered group harmony vocals' },
  { id: 'choir', label: 'คอรัสหมู่', tag: 'full choir vocals' },
];

/** Roughly how old the voice should sound. An adjective — see `MUSIC_VOCALS`. */
export const MUSIC_AGES: MusicOption[] = [
  { id: 'child', label: 'เด็ก', tag: "child's" },
  { id: 'teen', label: 'วัยรุ่น', tag: 'youthful teenage' },
  { id: 'young', label: 'หนุ่มสาว', tag: 'young adult' },
  { id: 'adult', label: 'กลางคน', tag: 'mature adult' },
  { id: 'senior', label: 'สูงวัย', tag: 'older weathered' },
];

/** The colour of the voice. An adjective — see `MUSIC_VOCALS`. */
export const MUSIC_TIMBRES: MusicOption[] = [
  { id: 'clear', label: 'ใส', tag: 'clear bright' },
  { id: 'warm', label: 'นุ่มอบอุ่น', tag: 'warm rounded' },
  { id: 'raspy', label: 'แหบเสน่ห์', tag: 'raspy husky' },
  { id: 'breathy', label: 'ลมหายใจ', tag: 'breathy intimate' },
  { id: 'powerful', label: 'ทรงพลัง', tag: 'powerful belting' },
  { id: 'deep', label: 'ทุ้มลึก', tag: 'deep-toned' },
];

/**
 * Genres. Thai styles sit at the top because this is a Thai platform and they
 * are what gets ordered — a list that opens with "pop / rock / hip-hop" makes
 * ลูกทุ่ง look like an afterthought. The English tags are what the model was
 * trained on; where a Thai genre has no standard English tag it is described
 * rather than transliterated, which the model can actually act on.
 */
export const MUSIC_GENRES: MusicOption[] = [
  { id: 'luktung', label: 'ลูกทุ่ง', tag: 'Thai luk thung country ballad, khaen and phin accents, expressive vibrato' },
  { id: 'morlam', label: 'หมอลำ/อีสาน', tag: 'Isan mor lam, driving phin and khaen, fast syncopated groove' },
  { id: 'lukkrung', label: 'ลูกกรุง', tag: 'classic Thai luk krung, lush orchestral ballad, 1960s crooner' },
  { id: 'string', label: 'สตริงไทย', tag: 'Thai pop rock, clean guitars, radio ballad' },
  { id: 'pop', label: 'ป็อป', tag: 'modern pop' },
  { id: 'rock', label: 'ร็อก', tag: 'rock band, distorted guitars' },
  { id: 'ballad', label: 'บัลลาด', tag: 'slow emotional ballad' },
  { id: 'acoustic', label: 'อะคูสติก', tag: 'acoustic singer-songwriter, sparse arrangement' },
  { id: 'rnb', label: 'R&B / โซล', tag: 'soulful R&B, smooth groove' },
  { id: 'hiphop', label: 'ฮิปฮอป', tag: 'hip-hop, hard drums, rhythmic delivery' },
  { id: 'edm', label: 'EDM / เต้น', tag: 'EDM dance production, synth leads, four-on-the-floor' },
  { id: 'citypop', label: 'ซิตี้ป็อป', tag: '80s city pop, glossy synths, funky bass' },
  { id: 'kpop', label: 'เค-ป็อป', tag: 'K-pop production, punchy mix, layered hooks' },
  { id: 'jazz', label: 'แจ๊ส', tag: 'jazz combo, swung feel, extended harmony' },
  { id: 'country', label: 'คันทรี', tag: 'country, acoustic guitar and pedal steel' },
  { id: 'reggae', label: 'เร้กเก้/สกา', tag: 'reggae skank, offbeat guitar, deep bass' },
  { id: 'metal', label: 'เมทัล', tag: 'metal, heavy riffs, double kick' },
  { id: 'lofi', label: 'โลไฟ', tag: 'lo-fi chillhop, dusty drums, mellow keys' },
  { id: 'cinematic', label: 'ซาวด์แทร็ก', tag: 'cinematic orchestral score' },
  { id: 'folk', label: 'โฟล์ก', tag: 'folk, acoustic storytelling' },
];

/** The feeling. Several may be picked. */
export const MUSIC_MOODS: MusicOption[] = [
  { id: 'happy', label: 'สนุกสดใส', tag: 'upbeat and joyful' },
  { id: 'sad', label: 'เศร้า', tag: 'sad and melancholic' },
  { id: 'romantic', label: 'โรแมนติก', tag: 'romantic and tender' },
  { id: 'epic', label: 'ฮึกเหิม', tag: 'epic and triumphant' },
  { id: 'calm', label: 'ผ่อนคลาย', tag: 'calm and soothing' },
  { id: 'dark', label: 'มืดหม่น', tag: 'dark and brooding' },
  { id: 'nostalgic', label: 'คิดถึงอดีต', tag: 'nostalgic and wistful' },
  { id: 'hopeful', label: 'มีความหวัง', tag: 'hopeful and uplifting' },
  { id: 'angry', label: 'ดุดัน', tag: 'angry and defiant' },
  { id: 'dreamy', label: 'ล่องลอย', tag: 'dreamy and atmospheric' },
];

/** Instruments to put in the arrangement. Several may be picked. */
export const MUSIC_INSTRUMENTS: MusicOption[] = [
  { id: 'acoustic_guitar', label: 'กีตาร์โปร่ง', tag: 'acoustic guitar' },
  { id: 'electric_guitar', label: 'กีตาร์ไฟฟ้า', tag: 'electric guitar' },
  { id: 'piano', label: 'เปียโน', tag: 'piano' },
  { id: 'synth', label: 'ซินธ์', tag: 'synthesizer pads and leads' },
  { id: 'strings', label: 'เครื่องสาย', tag: 'string section' },
  { id: 'brass', label: 'เครื่องเป่าทองเหลือง', tag: 'brass section' },
  { id: 'sax', label: 'แซกโซโฟน', tag: 'saxophone' },
  { id: 'flute', label: 'ขลุ่ย/ฟลูต', tag: 'flute' },
  { id: 'drums', label: 'กลองชุด', tag: 'drum kit' },
  { id: 'percussion', label: 'เพอร์คัสชัน', tag: 'hand percussion' },
  { id: 'bass', label: 'เบส', tag: 'bass guitar' },
  { id: 'organ', label: 'ออร์แกน', tag: 'Hammond organ' },
  { id: 'phin', label: 'พิณ', tag: 'Thai phin lute' },
  { id: 'khaen', label: 'แคน', tag: 'Thai khaen mouth organ' },
  { id: 'ranad', label: 'ระนาด', tag: 'Thai ranat xylophone' },
  { id: 'erhu', label: 'ซอ', tag: 'bowed Thai so / erhu' },
];

/** What language the vocal is sung in. */
export const MUSIC_LANGUAGES: MusicOption[] = [
  { id: 'th', label: 'ไทย', tag: 'sung in Thai' },
  { id: 'en', label: 'อังกฤษ', tag: 'sung in English' },
  { id: 'th_en', label: 'ไทย + อังกฤษ', tag: 'sung in Thai with English hooks' },
  { id: 'ja', label: 'ญี่ปุ่น', tag: 'sung in Japanese' },
  { id: 'ko', label: 'เกาหลี', tag: 'sung in Korean' },
  { id: 'zh', label: 'จีน', tag: 'sung in Mandarin' },
  { id: 'lo', label: 'ลาว', tag: 'sung in Lao' },
];

/**
 * How dense the arrangement should be.
 *
 * Two things at once, and only one of them is text. `mode` is a real node
 * input: `full` makes YuE2 write a **chord-annotated** score before it sings,
 * `melody` writes the melody alone (ComfyUI `INSTRUCTIONS` in yue2.py). A
 * chord chart is what gives the band something to play, so the sparse settings
 * ask for melody and the dense ones for full harmony.
 *
 * A cover never changes `mode` — SheetSage2 already supplies the melody and
 * the official template pins `melody` for exactly that reason — so there only
 * the tag applies.
 */
export interface MusicComplexityLevel {
  value: number;
  label: string;
  tag: string;
  mode: 'full' | 'melody';
}

export const MUSIC_COMPLEXITY: MusicComplexityLevel[] = [
  { value: 1, label: 'เรียบง่าย', tag: 'sparse minimal arrangement, one or two instruments, lots of space', mode: 'melody' },
  { value: 2, label: 'โปร่ง', tag: 'light arrangement, restrained backing', mode: 'melody' },
  { value: 3, label: 'มาตรฐาน', tag: 'balanced full-band arrangement', mode: 'full' },
  { value: 4, label: 'แน่น', tag: 'rich layered arrangement, countermelodies and backing vocals', mode: 'full' },
  { value: 5, label: 'ซับซ้อน', tag: 'complex arrangement, dense harmony, instrumental solos, dynamic section changes', mode: 'full' },
];

export const MUSIC_COMPLEXITY_DEFAULT = 3;

/**
 * How far the model may wander.
 *
 * Straight through to `YuE2GenerateMusic.temperature` (0–5 at the node, but
 * anything past ~1.4 stops sounding like a song). 1.0 is the node's own
 * default and what every proven render here used, so it is the middle.
 */
export const MUSIC_VARIANCE_MIN = 0.6;
export const MUSIC_VARIANCE_MAX = 1.4;
export const MUSIC_VARIANCE_DEFAULT = 1.0;

/** Tempo the customer may pin, or leave to the model. */
export const MUSIC_BPM_MIN = 50;
export const MUSIC_BPM_MAX = 190;

/** The choices themselves, stored on the generation and sent to the worker. */
export interface MusicStyleParams {
  vocal?: string;
  age?: string;
  timbre?: string;
  genre?: string;
  language?: string;
  moods?: string[];
  instruments?: string[];
  /** Beats per minute; omitted or 0 lets the model choose. */
  bpm?: number;
  /** 1–5, see `MUSIC_COMPLEXITY`. */
  complexity?: number;
  /** `YuE2GenerateMusic.temperature`. */
  variance?: number;
  /** No vocal at all: the vocal chips are skipped and the lyrics are dropped. */
  instrumental?: boolean;
}

/**
 * Keep only the keys this module knows, with values it knows.
 *
 * `params` arrives from a browser or the mobile app and is stored verbatim on
 * the generation, so without this a client could park a megabyte of anything
 * under `music`. The composer is already injection-proof — an id it does not
 * recognise produces no tag, and the three numbers are clamped — so this is
 * about what gets *written down*, not about what reaches the model.
 */
export function sanitizeMusicParams(raw: unknown): MusicStyleParams | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const one = (list: MusicOption[], v: unknown) =>
    typeof v === 'string' && list.some((o) => o.id === v) ? v : undefined;
  const many = (list: MusicOption[], v: unknown, limit: number) => {
    if (!Array.isArray(v)) return undefined;
    const picked = v.filter((x): x is string => typeof x === 'string' && list.some((o) => o.id === x));
    const unique = [...new Set(picked)].slice(0, limit);
    return unique.length > 0 ? unique : undefined;
  };
  const bpm = Number(r.bpm);
  const complexity = Number(r.complexity);

  const out: MusicStyleParams = {
    vocal: one(MUSIC_VOCALS, r.vocal),
    age: one(MUSIC_AGES, r.age),
    timbre: one(MUSIC_TIMBRES, r.timbre),
    genre: one(MUSIC_GENRES, r.genre),
    language: one(MUSIC_LANGUAGES, r.language),
    moods: many(MUSIC_MOODS, r.moods, 3),
    instruments: many(MUSIC_INSTRUMENTS, r.instruments, 6),
    bpm: Number.isFinite(bpm) && bpm >= MUSIC_BPM_MIN && bpm <= MUSIC_BPM_MAX ? Math.round(bpm) : undefined,
    complexity: MUSIC_COMPLEXITY.some((c) => c.value === complexity) ? complexity : undefined,
    variance: r.variance === undefined ? undefined : musicVariance(Number(r.variance)),
    instrumental: r.instrumental === true ? true : undefined,
  };
  for (const key of Object.keys(out) as (keyof MusicStyleParams)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function tagOf(list: MusicOption[], id: string | undefined): string {
  if (!id) return '';
  return list.find((o) => o.id === id)?.tag ?? '';
}

function tagsOf(list: MusicOption[], ids: string[] | undefined, limit: number): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .slice(0, limit)
    .map((id) => tagOf(list, id))
    .filter(Boolean);
}

export function musicComplexity(value: number | undefined): MusicComplexityLevel {
  return (
    MUSIC_COMPLEXITY.find((c) => c.value === value) ??
    MUSIC_COMPLEXITY.find((c) => c.value === MUSIC_COMPLEXITY_DEFAULT)!
  );
}

/** Clamp to what `YuE2GenerateMusic.temperature` will accept and sound like music. */
export function musicVariance(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return MUSIC_VARIANCE_DEFAULT;
  return Math.min(MUSIC_VARIANCE_MAX, Math.max(MUSIC_VARIANCE_MIN, Math.round(n * 20) / 20));
}

/**
 * The `[Tags]` line, built in the order the official template documents:
 * language, genre, vocal, tempo, instruments, mood, arrangement.
 *
 * The customer's own words come first and are never rewritten — the chips add
 * to a description, they do not replace it. Duplicates are dropped so picking
 * "ลูกทุ่ง" and also typing "ลูกทุ่ง" does not say it twice, and the whole
 * thing is capped: the prompt shares a 24,576-token context with the song
 * itself, so every tag spent is music budget taken away.
 */
export function composeMusicTags(description: string, music: MusicStyleParams | undefined): string {
  const head = (description ?? '').trim();
  if (!music) return head;

  const instrumental = music.instrumental === true;
  const parts: string[] = [];

  if (!instrumental) parts.push(tagOf(MUSIC_LANGUAGES, music.language));
  parts.push(tagOf(MUSIC_GENRES, music.genre));

  if (instrumental) {
    parts.push('instrumental, no vocals');
  } else {
    // One phrase, not three: "young adult voice, warm rounded tone, female
    // vocal" reads as three singers to a tag model. Age and colour are
    // adjectives that qualify the voice, so they are folded into it — and when
    // they are given without one, the noun still has to be there or the line
    // ends on "young adult warm".
    const qualifiers = [tagOf(MUSIC_AGES, music.age), tagOf(MUSIC_TIMBRES, music.timbre)].filter(Boolean);
    const noun = tagOf(MUSIC_VOCALS, music.vocal) || (qualifiers.length > 0 ? 'vocal' : '');
    const voice = [...qualifiers, noun].filter(Boolean).join(' ');
    if (voice) parts.push(voice);
  }

  const bpm = Number(music.bpm);
  if (Number.isFinite(bpm) && bpm >= MUSIC_BPM_MIN && bpm <= MUSIC_BPM_MAX) {
    parts.push(`${Math.round(bpm)} BPM`);
  }

  parts.push(...tagsOf(MUSIC_INSTRUMENTS, music.instruments, 6));
  parts.push(...tagsOf(MUSIC_MOODS, music.moods, 3));
  parts.push(musicComplexity(music.complexity).tag);

  const seen = new Set(head.toLowerCase().split(/[,\n]/).map((s) => s.trim()).filter(Boolean));
  const extra: string[] = [];
  for (const tag of parts) {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    extra.push(tag.trim());
  }

  if (extra.length === 0) return head;
  return head ? `${head}, ${extra.join(', ')}` : extra.join(', ');
}
