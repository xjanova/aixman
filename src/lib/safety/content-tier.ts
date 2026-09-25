/**
 * What kind of content an order asks for, read from its words before any
 * credit moves (owner decision D4, 2026-09-18).
 *
 *   general — nothing sexual, readable: may run anywhere, including a
 *             GPUxMINE home PC.
 *   adult   — nudity, sex or clearly sexualised wording. Allowed on this
 *             platform (terms §5), never on a community machine.
 *   blocked — a category terms §6 forbids outright: sexual content involving
 *             minors, sexual content of real identifiable people, sexual
 *             violence, bestiality, necrophilia. Refused before charging.
 *   unknown — the words could not be assessed (no text, or a script this
 *             lexicon does not read). Treated as not community-safe.
 *
 * This is a lexicon, not a model, and it leans one way on purpose: a false
 * "adult" only keeps a job off home PCs, a false "general" sends a stranger's
 * private content to someone else's computer. Thai has no spaces between
 * words, so Thai terms match as substrings and are chosen long enough not to
 * hide inside innocent words (หีบ is carved out of หี, หวาดเสียว is simply not
 * listed). English terms match whole words, in the plain text and again with
 * the usual disguises undone: digits for letters (s3x, l0li), letters spaced
 * out (n u d e, p.o.r.n), zero-width characters, full-width forms and accents.
 *
 * Pure — no database, no network — so `node --test` can pin every rule.
 */

export type ContentTier = 'general' | 'adult' | 'blocked' | 'unknown';

export const CONTENT_TIERS: readonly ContentTier[] = ['general', 'adult', 'blocked', 'unknown'];

/** Why an order was refused outright. Terms §6 names each one. */
export type BlockedCategory =
  | 'minor-sexual'
  | 'real-person-sexual'
  | 'sexual-violence'
  | 'bestiality'
  | 'necrophilia';

export interface ContentInput {
  prompt?: string | null;
  /**
   * What the model is told to avoid. "nude, nsfw" here is the most common way
   * to ask for a *clean* image, so sexual words in it never make an order
   * adult — but "clothes" here is how people ask for nudity without saying so.
   */
  negativePrompt?: string | null;
  /** Other text the model reads: a style's suffix, song lyrics. */
  extraText?: readonly (string | null | undefined)[];
  /** The customer attached an image, frame, song or clip to this order. */
  hasInputMedia?: boolean;
}

export interface ContentAssessment {
  tier: ContentTier;
  /**
   * Short codes for why ('sexual', 'minor', 'unreadable-script', …) — for
   * logs and admins. Never the customer's words.
   */
  reasons: string[];
  /** Set when `tier` is 'blocked'. */
  blocked?: BlockedCategory;
}

// ---------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------

const INVISIBLE = /[​-‍⁠﻿­᠎͏]/g;
const LATIN_MARKS = /[̀-ͯ]/g;
const THAI_DIGITS = /[๐-๙]/g;

/**
 * One spelling for text that can be written many ways. NFKC folds full-width
 * letters and ligatures; it also splits Thai sara am (ำ) into two code points,
 * which is why the Thai lexicon below is folded the same way before use.
 * Accents are removed from Latin letters only — Thai vowels and tone marks
 * are combining marks too, and removing those would change the word.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .normalize('NFD')
    .replace(LATIN_MARKS, '')
    .normalize('NFC')
    .replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50))
    .toLowerCase();
}

const LEET_COMMON: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function unLeet(text: string, one: 'i' | 'l'): string {
  // Only characters standing between letters are read as letters, so the
  // "18" in "18+" and the "4" in "4k" stay numbers.
  return text.replace(/[013457@$]/g, (ch, at: number) => {
    const before = text[at - 1] ?? '';
    const after = text[at + 1] ?? '';
    const nextToLetter = /[a-z]/.test(before) || /[a-z]/.test(after);
    if (!nextToLetter) return ch;
    return ch === '1' ? one : LEET_COMMON[ch] ?? ch;
  });
}

/** Single letters strung together with separators: "n u d e", "p.o.r.n", "s-e-x". */
const SPACED_LETTERS = /(?:^|[^\p{L}\p{N}])((?:[a-z][\s._*+|/\\-]+){2,}[a-z])(?=$|[^\p{L}\p{N}])/gu;
/** Separators wedged between Thai characters: "โ ป๊", "เ-ย็-ด". */
const THAI_GAPS = /(?<=[฀-๿])[\s._*+|/\\-]+(?=[฀-๿])/g;

/** The texts every term is looked for in: as written, and with the disguises undone. */
function variants(plain: string): string[] {
  const out = new Set<string>([plain, unLeet(plain, 'i'), unLeet(plain, 'l')]);
  const joined = [...plain.matchAll(SPACED_LETTERS)].map((m) => m[1].replace(/[^a-z]/g, ''));
  if (joined.length > 0) out.add(joined.join(' '));
  const thai = plain.replace(THAI_GAPS, '');
  if (thai !== plain) out.add(thai);
  return [...out];
}

// ---------------------------------------------------------------------------
// The lexicon
// ---------------------------------------------------------------------------

/** English (and a few other Latin-script) terms: regex sources, whole words only. */
function latin(sources: readonly string[]): RegExp {
  return new RegExp(`(?<![a-z])(?:${sources.join('|')})(?![a-z])`, 'u');
}

/** Thai terms: regex sources, matched anywhere (Thai writes no spaces between words). */
function thai(sources: readonly string[]): RegExp {
  // Folded like the text is, so a term written with ำ still matches.
  return new RegExp(`(?:${sources.map((s) => s.normalize('NFKC')).join('|')})`, 'u');
}

interface Lexicon {
  latin?: RegExp;
  thai?: RegExp;
  other?: RegExp;
}

function hits(lexicon: Lexicon, texts: readonly string[]): boolean {
  return texts.some(
    (t) => (lexicon.latin?.test(t) ?? false) || (lexicon.thai?.test(t) ?? false) || (lexicon.other?.test(t) ?? false)
  );
}

/** Nudity and sex, said outright. */
const EXPLICIT: Lexicon = {
  latin: latin([
    'nsfw',
    // "nude" the colour (lipstick, heels, a beige palette) is not nudity.
    'nude(?![\\s-]*(?:colou?r\\w*|tones?|palettes?|lip\\w*|makeup|make-up|heels?|shoes?|pumps?|sandals?|beige|pink|shades?|nails?|polish|eye\\s*shadow|blush|tights|stockings))',
    'nudes', 'nudity', 'nudist\\w*', 'nudism',
    'naked(?!\\s+eyes?)', 'fully\\s+naked',
    'porn\\w*', 'hentai', 'xxx+', 'ecchi', 'ahegao', 'futanari', 'yiff\\w*', 'rule\\s*34', 'r-?18(?!\\d)',
    'sex', 'sexes', 'sexual', 'sexually', 'sexuality', 'sexting', 'sex\\s*toys?', 'intercourse', 'coitus',
    'orgasm\\w*', 'orgy', 'orgies', 'threesome\\w*', 'gang\\s*bang\\w*', 'creampie\\w*', 'bukkake',
    'erotic\\w*', 'erotica', 'lewd\\w*', 'horny', 'aroused', 'arousal', 'fetish\\w*', 'bdsm', 'bondage',
    'sexually\\s+explicit', 'explicit\\s+(?:content|scenes?|sex|nudity|images?|photos?|pictures?)',
    'genital\\w*', 'penis\\w*', 'phallus', 'vagina\\w*', 'vulva\\w*', 'labia', 'clitor\\w*', 'clit',
    'testicles?', 'scrotum', 'anus', 'anal', 'pubic', 'pussy', 'pussies',
    'nipples?', 'areolae?', 'boobs?', 'tits', 'titty', 'titties',
    '(?:bare|exposed|naked|uncovered)\\s+(?:breasts?|chest|bosom|butt|buttocks|bottom|crotch)',
    'breasts?\\s+(?:out|exposed|bare)',
    'cum(?!\\s+laude)', 'cums', 'cumming', 'cumshot\\w*', 'semen', 'ejaculat\\w*',
    '(?:blow|hand|foot|tit|boob)\\s*-?\\s*jobs?', 'fellatio', 'cunnilingus', 'masturbat\\w*', 'dildos?', 'strap-?on',
    'topless', 'bottomless', 'undress\\w*', 'unclothed', 'unclad', 'disrob\\w*',
    '(?:without|no|zero)\\s+(?:any\\s+)?(?:clothes|clothing)',
    // Nudity said without the usual words.
    'wearing\\s+nothing', '(?:with|wearing|has|having|had)\\s+nothing\\s+on(?![\\s-]*[a-z])',
    'not\\s+wearing\\s+(?:anything|any\\s+clothes|clothes|clothing)',
    'bare[\\s-]+(?:bod(?:y|ied)|skin(?:ned)?)', 'birthday\\s+suit', 'in\\s+the\\s+(?:buff|nude)', 'au\\s+naturel',
    'skinny[\\s-]*dipp\\w*', 'cloth(?:e|es)?-?less', 'clothing[\\s-]*optional', 'without\\s+a\\s+(?:stitch|thread)',
    'strippers?', 'striptease', 'prostitut\\w*', 'brothel', 'onlyfans', 'camgirls?',
    'upskirt', 'downblouse', 'camel\\s*toe', 'doggy\\s*style', 'missionary\\s+position',
    'spread(?:ing)?\\s+(?:her\\s+|his\\s+|their\\s+)?legs',
    // A few non-English words customers do type.
    'desnud[oa]s?', 'nackt\\w*', 'telanjang', 'bugil', 'bogel', 'khoa\\s+than',
  ]),
  thai: thai([
    'โป๊', 'เปลือย', 'ล่อนจ้อน', 'แก้ผ้า', 'นู้ด', 'ไม่(?:ได้)?(?:ใส่|สวม)(?:เสื้อผ้า|อะไรเลย)', 'ถอดเสื้อผ้า',
    'ไม่(?:ได้)?นุ่ง(?:ผ้า|อะไร)', 'ไม่มี(?:อะไร)?ปกปิด',
    'เซ็กส์', 'เซ็กซ์', 'เย็ด', 'ร่วมเพศ', 'เพศสัมพันธ์', 'ร่วมรัก', 'ลามก', 'อนาจาร', 'หื่น', 'กามารมณ์', 'น้ำกาม',
    'ควย', 'หี(?!บ)', 'จิ๋ม', 'จู๋', 'หัวนม', 'อวัยวะเพศ', 'ช่วยตัวเอง', 'สำเร็จความใคร่', 'ออรัล', 'โอรัล', 'ขย่ม', 'ของลับ',
  ]),
  // 🔞 is "18+" itself.
  other: /(?<!\d)18\s*\+|\u{1F51E}/u,
};

/** Sexualised without saying it: an order a stranger's PC should not see either. */
const SUGGESTIVE: Lexicon = {
  latin: latin([
    'sexy', 'sexier', 'sexiest', 'seduc\\w*', 'sensual\\w*', 'sultry', 'provocative\\w*', 'suggestive',
    'lingerie', 'underwear', 'panties', 'panty', 'thongs?', 'g-?strings?', 'braless', 'cleavage', 'busty',
    'boudoir', 'see-?through\\s+(?:clothes|clothing|dress|shirt|top|blouse|lingerie|bra|panties|outfit|fabric|nightgown)', 'sheer\\s+(?:dress|lingerie|top|blouse|nightgown)', 'wet\\s+t-?shirt', 'thirst\\s+trap',
    'revealing\\s+(?:outfit|clothes|clothing|dress|lingerie)', 'risque',
  ]),
  thai: thai([
    'เซ็กซี่', 'ชุดชั้นใน', 'กางเกงใน', 'จีสตริง', 'วาบหวิว', 'โนบรา', 'ซีทรู', 'ร่องอก', 'ยั่วยวน', 'ยั่วสวาท', 'ท่ายั่ว', 'ยวนใจ', 'ชุดนอนบาง',
  ]),
  // 🍆 🍑 💦 👅: innuendo as emoji.
  other: /[\u{1F346}\u{1F351}\u{1F4A6}\u{1F445}]/u,
};

/** Asking for the clothes to come off — with an attached photo, that photo's subject. */
const NUDIFY: Lexicon = {
  latin: latin([
    'undress\\w*', 'nudif\\w*',
    '(?:remove[sd]?|removing|take\\s+off|takes\\s+off|taking\\s+off|strip\\s+off|without|no)\\s+(?:all\\s+)?(?:(?:her|his|their|the|its|of)\\s+)?(?:clothes|clothing|outfit|dress|shirt|top|bra|underwear|panties)',
    'x-?ray\\s+(?:vision|clothes|through|filter)',
    '(?:make|makes|making|turn|render)\\s+(?:her|him|them|this|it|the\\s+(?:person|woman|girl|man|boy|photo|picture|image))\\s+(?:naked|nude)',
    '(?:naked|nude)\\s+version',
  ]),
  thai: thai(['ถอดเสื้อ(?!คลุม|แจ็คเก็ต|แจ็กเก็ต|กันหนาว|สูท|นอก)', 'แก้ผ้า', 'ลบเสื้อผ้า', 'เอาเสื้อผ้าออก', 'ทำให้(?:โป๊|เปลือย)', 'ไม่(?:ได้)?(?:ใส่|สวม)เสื้อผ้า']),
};

/**
 * In the negative prompt: "no clothes please", said the other way round.
 * SDXL follows a negative prompt, so naming what she wears there is asking
 * for it to be gone — the generic words, and every garment by name ("shirt,
 * pants, dress, bikini" in the negative of "a woman on a beach" is a nude).
 * Accessories are left out on purpose: no hat, no glasses, no shoes is not
 * nudity. A false hit only keeps the order off a home PC.
 */
const NEGATIVE_STRIPS: Lexicon = {
  latin: latin([
    'clothes', 'clothing', 'clothed', 'cloth', 'dressed', 'garments?', 'outfits?', 'attire', 'apparel',
    'underwear', 'bras?', 'panties', 'panty', 'lingerie', 'briefs', 'boxers', 'knickers', 'thongs?', 'undergarments?',
    't-?shirts?', 'tee\\s*shirts?', 'tees', 'shirts?', 'blouses?', 'tank\\s*tops?', 'crop\\s*tops?', 'tube\\s*tops?',
    // "top" the garment, not the viewpoint or the corner.
    'tops?(?![\\s-]*(?:view|down|angle|shot|light\\w*|left|right|corner|edge|of|side|quality|rated|notch|hat))',
    'sweaters?', 'hoodies?', 'jumpers?', 'cardigans?', 'vests?', 'jackets?', 'coats?', 'robes?', 'bathrobes?', 'kimonos?',
    'dress(?:es)?', 'gowns?', 'nightgowns?', 'nightdress(?:es)?', 'pajamas?', 'pyjamas?', 'sleepwear', 'skirts?', 'miniskirts?',
    'pants', 'trousers', 'jeans', 'shorts', 'leggings', 'tights', 'stockings', 'bottoms',
    'bikinis?', 'swimsuits?', 'swimwear', 'bathing\\s*suits?', 'bodysuits?', 'leotards?', 'jumpsuits?', 'overalls',
    // Anything that would cover her instead ("snow covered" is a landscape, not a body).
    '(?<!(?:snow|moss|ice|frost|cloud|dust|leaf|grass|ivy|vine|sand|mud|blood|water|flower|tree)[\\s-]+)covered',
    'covering', 'coverings', 'cover(?:ed)?\\s+up', 'modest\\w*', 'fabric', 'textiles?', 'towels?', 'blankets?',
    'bed\\s*sheets?', 'drapes?', 'draped', 'censor\\w*', 'mosaic', 'bar\\s+censor', 'pixelat\\w*', 'blurred\\s+(?:body|crotch|chest)',
  ]),
  thai: thai([
    // บรา before another consonant is บราซิล or บราวนี่, not a bra.
    'เสื้อ', 'ชุดชั้นใน', 'ชั้นใน', 'กางเกง', 'กระโปรง', 'เดรส', 'ชุดว่ายน้ำ', 'บิกินี', 'ยกทรง', 'บรา(?![ก-ฮ])', 'ชุดนอน', 'ชุดคลุม',
    'ผ้าเช็ดตัว', 'ผ้าห่ม', 'ผ้าคลุม', 'ผ้าปู', 'ปกปิด', 'สวมใส่', 'เครื่องแต่งกาย', 'เครื่องนุ่งห่ม', 'เซ็นเซอร์', 'โมเสก',
  ]),
};

/** A child, or someone who reads as one (Criminal Code s.287/1: "ทำให้เข้าใจได้ว่าเป็นผู้เยาว์"). */
const MINOR: Lexicon = {
  latin: latin([
    'child', 'children', 'childs', 'kids?', 'kiddies', 'kiddie', 'kiddo', 'minors?', 'under-?aged?',
    'pre-?teens?', 'pre-?pubescent', 'pubescent', 'teen', 'teens', 'teenage', 'teenaged', 'teenagers?', 'tweens?',
    'adolescen\\w*', 'juveniles?', 'toddlers?', 'infants?', 'newborns?',
    '(?:little|young|small|tiny)\\s+(?:girls?|boys?)', 'school\\s*(?:girls?|boys?|kids?|children|uniforms?)',
    '(?:elementary|primary|middle|junior\\s+high|high)\\s+school\\w*', 'grade\\s*school\\w*',
    '\\d{1,2}(?:st|nd|rd|th)[\\s-]+grade\\w*',
    'loli', 'lolis', 'lolita\\w*', 'shota\\w*',
    '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[\\s-]*(?:years?|yrs?)[\\s-]*old',
  ]),
  thai: thai([
    'เด็ก(?!เสิร์ฟ|ปั๊ม|เอ็น|ดริ้ง|ดริ๊งค์|ฝึกงาน|เสี่ย)', 'ผู้เยาว์', 'เยาวชน', 'วัยรุ่น', 'วัยเรียน', 'นักเรียน', 'ประถม', 'มัธยม',
    'ม\\.ต้น', 'ม\\.ปลาย', 'อนุบาล', 'ทารก', 'ขวบ', 'หนูน้อย', 'โลลิ', 'ด\\.ญ\\.', 'ด\\.ช\\.', 'ยังไม่บรรลุนิติภาวะ',
  ]),
};

/** Ages written as numbers — only a number under 18 counts. */
const AGE_PATTERNS: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])(\d{1,2})\s*-?\s*(?:years?|yrs?)\s*-?\s*old(?![a-z])/gu,
  /(?<![\p{L}\p{N}])(\d{1,2})\s*(?:yo|y\/o|y\.o\.?)(?![a-z])/gu,
  /(?<![a-z])aged?\s*[:=]?\s*(\d{1,2})(?!\d)/gu,
  /(?:อายุ|วัย)\s*(\d{1,2})(?!\d)/gu,
];

/** Names and roles that point at a real, identifiable person. */
const REAL_PERSON: Lexicon = {
  latin: latin([
    'celebrit(?:y|ies)', 'celebs?', 'famous\\s+(?:person|people|actress|actor|singer|star|model|woman|man|girl|guy)',
    'actress(?:es)?', 'actors?', 'movie\\s+stars?', 'pop\\s+stars?', '[kj]-?pop\\s+(?:idols?|stars?|singers?|groups?)',
    'influencers?', 'youtubers?', 'tiktokers?', 'streamers?', 'instagram\\s+(?:models?|influencers?)',
    'politicians?', 'president', 'prime\\s+minister', 'royal\\s+family',
    'real\\s+(?:person|people|woman|women|man|men|girl|boy|life\\s+person)',
    'my\\s+(?:ex|ex-?(?:girlfriend|boyfriend|wife|husband)|girlfriend|boyfriend|wife|husband|sister|brother|mother|mom|mum|daughter|son|cousin|aunt|niece|nephew|friend|best\\s+friend|classmates?|co-?workers?|colleagues?|boss|teacher|student|neighbou?r|crush|roommate|step-?sister|step-?mom|step-?mother)',
    'ex-?(?:girlfriend|boyfriend|wife|husband)', 'classmates?', 'co-?workers?', 'colleagues?', 'neighbou?rs?',
    'deep\\s*-?fakes?', 'face\\s*-?swap\\w*', '(?:with|using)\\s+(?:her|his|their|my)\\s+(?:real\\s+)?face',
  ]),
  thai: thai([
    'ดารา', 'นักแสดง', 'นักร้อง', 'คนดัง', 'เซเลบ', 'เน็ตไอดอล', 'อินฟลูเอนเซอร์', 'ยูทูบเบอร์', 'ติ๊กต็อกเกอร์', 'นักการเมือง', 'นายกรัฐมนตรี', 'นายกฯ',
    'ในหลวง', 'พระราชินี', 'ราชวงศ์', 'เจ้าฟ้า',
    'แฟนเก่า', '(?:แฟน|เมีย|ภรรยา|สามี|ผัว|พี่สาว|น้องสาว|แม่|ลูกสาว|เพื่อน|เจ้านาย|ครู|หัวหน้า)(?:ของ)?(?:ฉัน|ผม|เรา|กู|หนู)',
    'เพื่อนร่วมงาน', 'เพื่อนบ้าน', 'เพื่อนร่วมห้อง', 'เพื่อนร่วมชั้น', 'คนจริง', 'บุคคลจริง',
    'ดีปเฟค', 'ดีพเฟค', 'ดีฟเฟค', 'ตัดต่อหน้า', 'สลับหน้า', 'เปลี่ยนหน้า', 'ใส่หน้า',
  ]),
};

/** Words that are CSAM on their own, whatever else the prompt says. */
const CSAM_TERMS: Lexicon = {
  latin: latin(['lolicon', 'shotacon', 'jailbait', 'child\\s*porn\\w*', 'kiddie\\s*porn\\w*', 'kiddy\\s*porn\\w*', 'pedos?', 'pedophil\\w*', 'paedos?', 'paedophil\\w*', 'pedobear', 'pthc', 'csam', 'cp\\s+porn']),
  thai: thai(['โลลิคอน', 'อนาจารเด็ก', 'ลามกเด็ก', 'โป๊เด็ก', 'เด็กโป๊', 'ใคร่เด็ก']),
};

const SEXUAL_VIOLENCE: Lexicon = {
  latin: latin([
    'rape', 'raped', 'rapes', 'raping', 'rapist\\w*', 'non-?consensual', 'noncon', 'forced\\s+(?:sex|intercourse)',
    'sexual(?:ly)?\\s+assault\\w*', 'molest\\w*', 'sex(?:ual)?\\s+slave\\w*', 'date\\s+rape',
  ]),
  thai: thai(['ข่มขืน', 'กระทำชำเรา', 'ล่วงละเมิดทางเพศ', 'รุมโทรม', 'ทาสกาม', 'บังคับ(?:มี)?เพศสัมพันธ์', 'บังคับร่วมเพศ']),
};

const BESTIALITY: Lexicon = {
  latin: latin(['bestiality', 'zoophil\\w*', 'zoo\\s*porn\\w*']),
  thai: thai(['ร่วมเพศกับสัตว์', 'สมสู่กับสัตว์', 'เย็ดหมา', 'เย็ดสัตว์']),
};

const NECROPHILIA: Lexicon = {
  latin: latin(['necrophil\\w*']),
  thai: thai(['ร่วมเพศกับศพ', 'เย็ดศพ', 'สมสู่กับศพ']),
};

/** A letter in any script but Latin and Thai: words this lexicon cannot read. */
const UNREADABLE_LETTER = /(?=\p{L})(?!\p{Script=Latin})(?!\p{Script=Thai})./u;

function underageNumber(text: string): boolean {
  for (const pattern of AGE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n >= 0 && n < 18) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

/**
 * The tier of one order.
 *
 * Blocked first, so a forbidden request is never merely "adult": a word that
 * is CSAM on its own, sexual violence, bestiality, necrophilia; a minor next
 * to anything sexual *or* suggestive; a real person next to anything
 * sexual; or clothes coming off a photo the customer attached. Then adult,
 * then unknown (nothing to read, or a script this lexicon cannot read),
 * then general.
 */
export function classifyContent(input: ContentInput): ContentAssessment {
  const positive = [input.prompt, ...(input.extraText ?? [])]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .join('\n');
  const negative = typeof input.negativePrompt === 'string' ? input.negativePrompt : '';

  const plain = normalizeText(positive);
  const texts = variants(plain);
  const negTexts = variants(normalizeText(negative));

  const reasons: string[] = [];
  const blocked = (category: BlockedCategory, why: string): ContentAssessment => ({
    tier: 'blocked',
    blocked: category,
    reasons: [...reasons, why],
  });

  if (hits(CSAM_TERMS, texts)) return blocked('minor-sexual', 'csam-term');
  if (hits(SEXUAL_VIOLENCE, texts)) return blocked('sexual-violence', 'sexual-violence');
  if (hits(BESTIALITY, texts)) return blocked('bestiality', 'bestiality');
  if (hits(NECROPHILIA, texts)) return blocked('necrophilia', 'necrophilia');

  const explicit = hits(EXPLICIT, texts);
  const suggestive = hits(SUGGESTIVE, texts);
  const nudify = hits(NUDIFY, texts);
  const negativeStrips = negative.trim() !== '' && hits(NEGATIVE_STRIPS, negTexts);
  if (explicit) reasons.push('sexual');
  if (suggestive) reasons.push('suggestive');
  if (nudify) reasons.push('nudify');
  if (negativeStrips) reasons.push('negative-strips-clothes');
  const sexual = explicit || nudify || negativeStrips;

  const minor = hits(MINOR, texts) || underageNumber(plain);
  if (minor && (sexual || suggestive)) return blocked('minor-sexual', 'minor');

  if (sexual && hits(REAL_PERSON, texts)) return blocked('real-person-sexual', 'real-person');
  if (nudify && input.hasInputMedia === true) return blocked('real-person-sexual', 'nudify-attached-photo');

  if (sexual || suggestive) return { tier: 'adult', reasons };

  if (plain.trim() === '') return { tier: 'unknown', reasons: ['no-text'] };
  if (UNREADABLE_LETTER.test(plain) || UNREADABLE_LETTER.test(normalizeText(negative))) {
    return { tier: 'unknown', reasons: ['unreadable-script'] };
  }
  return { tier: 'general', reasons };
}

/**
 * Whether a job may run on a GPUxMINE home PC: general content and nothing
 * the customer uploaded (owner decision D4). Personal data — a face, a voice,
 * a photo — stays on machines we control, as the privacy page promises.
 */
export function isCommunitySafe(job: { contentTier?: string | null; hasInputMedia?: boolean | null }): boolean {
  return job.contentTier === 'general' && job.hasInputMedia !== true;
}

/** A stored tier, read tolerantly: anything unrecognised is `unknown`. */
export function readContentTier(value: unknown): ContentTier {
  return typeof value === 'string' && (CONTENT_TIERS as readonly string[]).includes(value) ? (value as ContentTier) : 'unknown';
}

const NOT_CHARGED = 'ระบบไม่ได้หักเครดิต';

const BLOCKED_MESSAGES: Record<BlockedCategory, string> = {
  'minor-sexual': `คำสั่งนี้เข้าข่ายเนื้อหาทางเพศหรือยั่วยุทางเพศที่เกี่ยวข้องกับเด็กหรือผู้เยาว์ ซึ่งผิดกฎหมายและห้ามสร้างเด็ดขาด (ข้อกำหนดการใช้งาน ข้อ 6) — ${NOT_CHARGED}`,
  'real-person-sexual': `คำสั่งนี้เข้าข่ายการสร้างเนื้อหาทางเพศของบุคคลจริง เช่น คนดัง คนรู้จัก หรือการถอดเสื้อผ้าจากภาพที่แนบมา ซึ่งห้ามสร้างบนแพลตฟอร์มนี้ (ข้อกำหนดการใช้งาน ข้อ 6) — ${NOT_CHARGED}`,
  'sexual-violence': `คำสั่งนี้เข้าข่ายเนื้อหาความรุนแรงทางเพศ ซึ่งห้ามสร้างบนแพลตฟอร์มนี้ (ข้อกำหนดการใช้งาน ข้อ 6) — ${NOT_CHARGED}`,
  bestiality: `คำสั่งนี้เข้าข่ายเนื้อหาต้องห้ามตามข้อกำหนดการใช้งาน ข้อ 6 ระบบจึงไม่สร้างให้ — ${NOT_CHARGED}`,
  necrophilia: `คำสั่งนี้เข้าข่ายเนื้อหาต้องห้ามตามข้อกำหนดการใช้งาน ข้อ 6 ระบบจึงไม่สร้างให้ — ${NOT_CHARGED}`,
};

/** Thai for the customer whose order was refused. */
export function blockedMessage(category: BlockedCategory): string {
  return BLOCKED_MESSAGES[category];
}

/** Thai for admins (alerts): which §6 category, without the customer's words. */
export const BLOCKED_LABEL: Record<BlockedCategory, string> = {
  'minor-sexual': 'เนื้อหาทางเพศเกี่ยวกับผู้เยาว์',
  'real-person-sexual': 'เนื้อหาทางเพศของบุคคลจริง / ถอดเสื้อผ้าจากภาพที่แนบ',
  'sexual-violence': 'ความรุนแรงทางเพศ',
  bestiality: 'การร่วมเพศกับสัตว์',
  necrophilia: 'การร่วมเพศกับศพ',
};
