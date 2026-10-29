/**
 * English for the Thai refusals GenerationService throws as plain strings.
 *
 * A stopgap while those throw sites are still Thai-only: the route that
 * answers looks the Thai up here (exact, else a pattern with its figures),
 * else falls back to the refusal code. New refusals should throw a `{ th, en }`
 * pair instead (OrderRefusedError takes one); a test pins that every Thai
 * literal in generation.ts is covered until then. Pure.
 */

const EXACT: Record<string, string> = {
  'โมเดลนี้ถูกปลดออกแล้ว กรุณาเลือกโมเดลอื่น': 'This model has been retired. Please choose another one.',
  'ต้องอัปโหลดภาพที่จะแก้ก่อน': 'Upload the picture to edit first.',
  'ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน': 'Upload the voice to speak first.',
  'ต้องอัปโหลดรูปคนที่จะให้พูดก่อน': 'Upload a picture of the person who will speak first.',
  'ไฟล์ที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่': 'The attached file isn’t valid. Please upload it again.',
  'ต้องอัปโหลดภาพตัวละครก่อน': 'Upload the character picture first.',
  'ใส่ข้อความที่จะให้อ่านก่อน': 'Type the text to read first.',
  'โหมดคัฟเวอร์ต้องอัปโหลดเพลงต้นฉบับก่อน': 'Cover mode needs the original song uploaded first.',
  'ต้องอัปโหลดคลิปก่อน': 'Upload the clip first.',
  'ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับก่อน': 'Upload the clip to dub first.',
  'ภาพอ้างอิงไม่ถูกต้อง': 'The reference pictures aren’t valid.',
  'โมเดลนี้ไม่รับภาพอ้างอิง เลือกโมเดลอื่น': 'This model doesn’t take reference pictures. Choose another model.',
  'ภาพอ้างอิงต้องเป็นไฟล์ที่อัปโหลดไว้บนเว็บ อัปโหลดใหม่อีกครั้ง':
    'Reference pictures must be files uploaded to this site. Please upload them again.',
  'อ่านไฟล์เสียงที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง': 'We couldn’t read the uploaded audio. Please try again.',
  'อ่านคลิปที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง': 'We couldn’t read the uploaded clip. Please try again.',
  'อ่านความยาวหรือขนาดของคลิปไม่ได้ กรุณาบันทึกคลิปเป็น MP4 แล้วอัปโหลดใหม่':
    'We couldn’t read the clip’s length or size. Please save it as MP4 and upload it again.',
  'อ่านความยาวของไฟล์เสียงไม่ได้ กรุณาใช้ไฟล์ MP3, WAV หรือ M4A':
    'We couldn’t read the audio’s length. Please use an MP3, WAV or M4A file.',
  'อ่านความยาวของเพลงไม่ได้ กรุณาใช้ไฟล์ MP3, WAV หรือ M4A':
    'We couldn’t read the song’s length. Please use an MP3, WAV or M4A file.',
  'เพลงต้นฉบับสั้นเกินไปที่จะต่อ': 'The original song is too short to extend.',
  'ต้องอัปโหลดเพลงต้นฉบับที่จะคัฟเวอร์ก่อน': 'Upload the original song to cover first.',
  'ต้องอัปโหลดเพลงที่จะต่อก่อน': 'Upload the song to extend first.',
  'ต้องอัปโหลดดนตรีบรรเลงที่จะใส่เสียงร้องก่อน': 'Upload the instrumental to add vocals to first.',
  'ต้องอัปโหลดเสียงร้องที่จะใส่ดนตรีก่อน': 'Upload the vocals to add music to first.',
  'ต้องอัปโหลดเพลงที่จะแยกสเต็มก่อน': 'Upload the song to split into stems first.',
  'ต้องอัปโหลดเพลงก่อน': 'Upload the song first.',
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^ข้อความยาวเกินไป \(([\d,]+) ตัวอักษร\) — โมเดลนี้อ่านได้ครั้งละไม่เกิน ([\d,]+) ตัวอักษร$/,
    (m) => `The text is too long (${m[1]} characters) — this model reads at most ${m[2]} characters at a time.`,
  ],
  [/^โมเดลนี้รับภาพอ้างอิงได้สูงสุด (\d+) ภาพ$/, (m) => `This model takes at most ${m[1]} reference ${m[1] === '1' ? 'picture' : 'pictures'}.`],
];

/** By refusal code, when the Thai is one this file has not met. */
const BY_CODE: Record<string, string> = {
  'model-retired': EXACT['โมเดลนี้ถูกปลดออกแล้ว กรุณาเลือกโมเดลอื่น'],
  'missing-image': 'Upload the picture this model needs first.',
  'missing-audio': 'Upload the audio this model needs first.',
  'missing-video': 'Upload the clip this model needs first.',
  'missing-text': 'Type the text first.',
  'invalid-input': EXACT['ไฟล์ที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่'],
  'text-too-long': 'The text is too long for this model.',
  'bad-references': EXACT['ภาพอ้างอิงไม่ถูกต้อง'],
  'no-references': EXACT['โมเดลนี้ไม่รับภาพอ้างอิง เลือกโมเดลอื่น'],
  'too-many-references': 'Too many reference pictures for this model.',
  'foreign-reference': EXACT['ภาพอ้างอิงต้องเป็นไฟล์ที่อัปโหลดไว้บนเว็บ อัปโหลดใหม่อีกครั้ง'],
  'voice-fetch-failed': EXACT['อ่านไฟล์เสียงที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'],
  'clip-fetch-failed': EXACT['อ่านคลิปที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'],
  'clip-unreadable': EXACT['อ่านความยาวหรือขนาดของคลิปไม่ได้ กรุณาบันทึกคลิปเป็น MP4 แล้วอัปโหลดใหม่'],
  'voice-unreadable': 'We couldn’t read the uploaded audio. Please use an MP3, WAV or M4A file.',
  'song-too-large': 'The song file is too large for this model.',
  'song-too-long': 'The song is too long for this model.',
  'song-too-short': 'The song is too short for this model.',
};

/** The English of a Thai refusal, or null when neither its text nor its code is known. */
export function refusalEn(thai: string, code?: string): string | null {
  const exact = EXACT[thai];
  if (exact) return exact;
  for (const [re, to] of PATTERNS) {
    const m = thai.match(re);
    if (m) return to(m);
  }
  return code ? BY_CODE[code] ?? null : null;
}

/** For the coverage test: whether `thai` is known by its text alone. */
export function hasRefusalEn(thai: string): boolean {
  return EXACT[thai] !== undefined || PATTERNS.some(([re]) => re.test(thai));
}
