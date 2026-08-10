/**
 * Showcase manifest — the real generated work the marketing pages lead with.
 *
 * Every entry points at a still in `public/showcase/`. The matching `.mp4`
 * is optional: `<MediaTile>` renders the still and only crossfades to video
 * once the file actually loads, so a missing clip degrades to the poster
 * instead of a broken frame. Drop the mp4 in at the listed path and it
 * starts playing on the next request — no code change needed.
 *
 * `prompt` is the prompt that genuinely produced the still. Showing the real
 * one is the whole point of the section; do not swap in copy that reads
 * better but wasn't used.
 */

export type ShowcaseItem = {
  key: string;
  /** Thai display title */
  title: string;
  /** The prompt that actually produced this frame (trimmed for display) */
  prompt: string;
  model: string;
  mode: "image" | "video";
  /** CSS aspect-ratio for the masonry cell */
  ratio: string;
  image: string;
  /** Optional clip. Missing file → still stays visible. */
  video?: string;
  hue: number;
};

/**
 * Full-bleed cinematic frame behind the hero.
 *
 * The poster is the 2K Seedream still, and the clip was generated *from that
 * exact still* as its start frame — so frame 0 of the video and the poster are
 * the same picture and the handover is invisible, while the poster stays
 * sharper than the 720p clip could be.
 *
 * An earlier attempt generated the clip from the prompt alone. It came back
 * warm amber, fought the cyan→violet headline over it, and would have jumped
 * on crossfade. If this clip is ever regenerated, pass `hero-reel.jpg` as
 * `keyframes.start` again or both properties are lost.
 */
export const HERO_MEDIA = {
  image: "/showcase/hero-reel.jpg",
  video: "/showcase/hero-reel.mp4",
  prompt:
    "The colossal helix of woven light slowly rotates and breathes, filaments unravelling and re-braiding, mist drifting across the mirror-still salt flat",
  /** Poster from Seedream, motion from Kling — both are true, so name both. */
  model: "Seedream 5 Pro + Kling 2.5",
} as const;

/** The credibility wall — mixed ratios so the masonry has rhythm. */
export const SHOWCASE_ITEMS: ShowcaseItem[] = [
  {
    key: "portrait",
    title: "แสงในเส้นผม",
    prompt:
      "She breathes and blinks once, the fibre-optic filaments woven through her hair glowing in slow waves. Nothing else moves",
    model: "Kling 2.5",
    mode: "video",
    ratio: "9 / 16",
    image: "/showcase/portrait.jpg",
    video: "/showcase/portrait.mp4",
    hue: 280,
  },
  {
    key: "city",
    title: "มหานครกลางสายฝน",
    prompt:
      "Rain falls through the megacity canyon, the holographic ribbon between the towers shimmering, slow push in down the centre of the street",
    model: "Kling 2.5",
    mode: "video",
    ratio: "16 / 9",
    image: "/showcase/city.jpg",
    video: "/showcase/city.mp4",
    hue: 200,
  },
  {
    key: "product",
    title: "ขวดน้ำหอมออบซิเดียน",
    prompt:
      "A ribbon of liquid cyan light flows continuously around the obsidian bottle as it rotates, specular highlights travelling across the facets",
    model: "Kling 2.5",
    mode: "video",
    ratio: "1 / 1",
    image: "/showcase/product.jpg",
    video: "/showcase/product.mp4",
    hue: 190,
  },
  {
    key: "anime",
    title: "ศาลเจ้าลอยฟ้า",
    prompt:
      "Ribbons of glowing cyan thread spiral upward from the hero's raised hand into the violet cloudscape, coat and hair whipping in the wind",
    model: "Kling 2.5",
    mode: "video",
    ratio: "9 / 16",
    image: "/showcase/anime.jpg",
    video: "/showcase/anime.mp4",
    hue: 260,
  },
  {
    key: "temple",
    title: "โคมลอยในพระวิหาร",
    prompt:
      "Ancient Thai temple hall at night, gilded naga balustrade, thousands of lanterns rising gold to cyan, 35mm",
    model: "Seedream 5 Pro",
    mode: "image",
    ratio: "3 / 4",
    image: "/showcase/temple.jpg",
    hue: 40,
  },
  {
    key: "food",
    title: "ก๋วยเตี๋ยวเรือ",
    prompt:
      "Thai boat noodles macro, volumetric steam, chilli oil beading, chopsticks lifting noodles, 100mm f/4",
    model: "Seedream 5 Pro",
    mode: "image",
    ratio: "1 / 1",
    image: "/showcase/food.jpg",
    hue: 20,
  },
  {
    key: "creature",
    title: "ผู้พิทักษ์ป่าเรืองแสง",
    prompt:
      "The forest guardian breathes slowly, cyan filaments pulsing through its root-woven body as it turns its antlered head toward camera",
    model: "Kling 2.5",
    mode: "video",
    ratio: "16 / 9",
    image: "/showcase/creature.jpg",
    video: "/showcase/creature.mp4",
    hue: 160,
  },
  {
    key: "coast",
    title: "ชายฝั่งทรายดำ",
    prompt:
      "Top-down drone over volcanic black-sand coast at blue hour, turquoise surf braiding into foam channels",
    model: "Seedream 5 Pro",
    mode: "image",
    ratio: "3 / 4",
    image: "/showcase/coast.jpg",
    hue: 180,
  },
  {
    key: "dancer",
    title: "เส้นทางของการเคลื่อนไหว",
    prompt:
      "The dancer completes the leap as trailing arcs of cyan and violet light draw the path of the movement, braiding and fading like ribbon",
    model: "Kling 2.5",
    mode: "video",
    ratio: "4 / 3",
    image: "/showcase/dancer.jpg",
    video: "/showcase/dancer.mp4",
    hue: 300,
  },
];

export type ModeCard = {
  key: string;
  eyebrow: string;
  title: string;
  desc: string;
  image: string;
  /** Omitted where the card should stay a still. */
  video?: string;
  href: string;
  cta: string;
  hue: number;
  specs: { k: string; l: string }[];
};

/** The three things the platform actually does, each with a real result. */
export const MODE_CARDS: ModeCard[] = [
  {
    key: "image",
    eyebrow: "TEXT → IMAGE",
    title: "ข้อความเป็นภาพ",
    desc: "พิมพ์สิ่งที่คิด ได้ภาพความละเอียดสูงในไม่กี่วินาที เลือกโมเดลได้เองหรือให้ระบบเลือกให้",
    // Deliberately a still — a card advertising image generation should not move.
    image: "/showcase/product.jpg",
    href: "/generate?tab=image",
    cta: "เริ่มสร้างภาพ",
    hue: 190,
    specs: [
      { k: "4K", l: "ความละเอียดสูงสุด" },
      { k: "~10s", l: "ต่อภาพ" },
    ],
  },
  {
    key: "video",
    eyebrow: "TEXT / IMAGE → VIDEO",
    title: "ไอเดียเป็นวิดีโอ",
    desc: "เปลี่ยนข้อความหรือภาพนิ่งให้เคลื่อนไหว กำหนดมุมกล้องและความยาวได้ พร้อมเสียงในตัวบางโมเดล",
    image: "/showcase/dancer.jpg",
    video: "/showcase/dancer.mp4",
    href: "/generate?tab=video",
    cta: "สร้างวิดีโอ",
    hue: 280,
    specs: [
      { k: "1080p", l: "ความละเอียด" },
      { k: "15s", l: "ความยาวสูงสุด" },
    ],
  },
  {
    key: "edit",
    eyebrow: "EDIT & UPSCALE",
    title: "แก้ไขและขยายภาพ",
    desc: "ปรับแก้ภาพเดิมด้วย prompt หรือขยายความละเอียดให้คมขึ้นหลายเท่า โดยรักษารายละเอียดต้นฉบับไว้",
    image: "/showcase/macro.jpg",
    href: "/generate?tab=edit",
    cta: "ลองแก้ไขภาพ",
    hue: 160,
    specs: [
      { k: "2–4×", l: "ขยายภาพ" },
      { k: "img2img", l: "แก้ด้วย prompt" },
    ],
  },
];

/**
 * Providers wired into the platform. Kept factual — these are the adapters
 * that exist under `src/lib/providers/` plus the self-hosted GPU path.
 */
export const PROVIDERS = [
  "BytePlus",
  "OpenAI",
  "Stability AI",
  "Runway",
  "Replicate",
  "fal.ai",
  "Kling",
  "Luma",
  "Leonardo",
  "Self-hosted GPU",
] as const;

/** Straight answers to the things that stop people from paying. */
export const FAQ_ITEMS = [
  {
    q: "ผลงานที่สร้างเป็นของใคร ใช้เชิงพาณิชย์ได้ไหม",
    a: "ผลงานที่คุณสร้างเป็นของคุณ ใช้ในงานเชิงพาณิชย์ได้ ทั้งนี้ยังต้องอยู่ภายใต้เงื่อนไขของผู้ให้บริการโมเดลที่คุณเลือกใช้ในงานนั้น ๆ ซึ่งเราแสดงไว้ที่หน้าเลือกโมเดล",
  },
  {
    q: "ถ้าสร้างไม่สำเร็จ เครดิตหายไหม",
    a: "ไม่หาย ระบบคืนเครดิตอัตโนมัติทุกครั้งที่งานล้มเหลว คุณตรวจสอบรายการคืนย้อนหลังได้ในหน้าโปรไฟล์ → ประวัติเครดิต",
  },
  {
    q: "เครดิตมีวันหมดอายุไหม",
    a: "เครดิตที่ซื้อแบบจ่ายครั้งเดียวไม่มีวันหมดอายุ อยู่ในบัญชีจนกว่าจะใช้หมด",
  },
  {
    q: "จ่ายเงินอย่างไร ปลอดภัยแค่ไหน",
    a: "ชำระผ่านระบบของ XMAN STUDIO ซึ่งใช้ Stripe เป็นผู้ประมวลผลการชำระเงิน เราไม่เก็บเลขบัตรของคุณไว้ในระบบเลย",
  },
  {
    q: "ข้อมูลและภาพของฉันถูกนำไปเทรนโมเดลไหม",
    a: "ไม่ เราไม่นำผลงานของคุณไปเทรนโมเดล ผลงานจะเป็นส่วนตัวจนกว่าคุณจะเลือกแชร์เอง",
  },
  {
    q: "ทำไมต้องใช้ที่นี่แทนการสมัครแต่ละเจ้าเอง",
    a: "เพราะได้โมเดลจากหลายผู้ให้บริการในระบบเครดิตเดียว ไม่ต้องถือหลายซับสคริปชัน และระบบหมุน API key ให้อัตโนมัติเมื่อเจ้าใดเจ้าหนึ่งติดคิวหรือล่ม",
  },
] as const;
