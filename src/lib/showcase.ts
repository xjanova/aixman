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

import type { Msg } from "@/lib/i18n/locale";

export type ShowcaseItem = {
  key: string;
  /** Display title, in both languages */
  title: Msg;
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
    title: { th: "แสงในเส้นผม", en: "Light in her hair" },
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
    title: { th: "มหานครกลางสายฝน", en: "Megacity in the rain" },
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
    title: { th: "ขวดน้ำหอมออบซิเดียน", en: "Obsidian perfume bottle" },
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
    title: { th: "ศาลเจ้าลอยฟ้า", en: "Shrine in the sky" },
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
    title: { th: "โคมลอยในพระวิหาร", en: "Lanterns in the temple hall" },
    prompt:
      "Thousands of candle-lanterns drift steadily upward between the temple columns, their glow shifting from warm gold to cyan as they rise",
    // Poster is the 2K still; the clip was generated from it as start frame,
    // so both are true and both are named.
    model: "Seedream 5 Pro + Kling 2.5",
    mode: "video",
    ratio: "3 / 4",
    image: "/showcase/temple.jpg",
    video: "/showcase/temple.mp4",
    hue: 40,
  },
  {
    key: "food",
    title: { th: "ก๋วยเตี๋ยวเรือ", en: "Thai boat noodles" },
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
    title: { th: "ผู้พิทักษ์ป่าเรืองแสง", en: "Glowing forest guardian" },
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
    title: { th: "ชายฝั่งทรายดำ", en: "Black-sand coast" },
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
    title: { th: "เส้นทางของการเคลื่อนไหว", en: "The path of movement" },
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

/**
 * Model makers whose models the platform serves, plus our in-house engine.
 * Resellers and hosts we reach them through (BytePlus, Replicate, fal…) are
 * never named to customers (see lib/public-provider.ts).
 */
export const PROVIDERS = [
  "OpenAI",
  "Stability AI",
  "Runway",
  "Kling",
  "Luma",
  "Leonardo",
  "X-DREAMER Engine",
] as const;

/**
 * Straight answers to the things that stop people from paying. The English
 * names no service we run on (Stripe is the payment processor, not a model).
 */
export const FAQ_ITEMS: { q: Msg; a: Msg }[] = [
  {
    q: {
      th: "ผลงานที่สร้างเป็นของใคร ใช้เชิงพาณิชย์ได้ไหม",
      en: "Who owns what I create? Can I use it commercially?",
    },
    a: {
      th: "ผลงานที่คุณสร้างเป็นของคุณ ใช้ในงานเชิงพาณิชย์ได้ ทั้งนี้ยังต้องอยู่ภายใต้เงื่อนไขของผู้ให้บริการโมเดลที่คุณเลือกใช้ในงานนั้น ๆ ซึ่งเราแสดงไว้ที่หน้าเลือกโมเดล",
      en: "What you create is yours, and you can use it commercially. It is still subject to the terms of the model you chose for that piece, which we show where you pick the model.",
    },
  },
  {
    q: {
      th: "ถ้าสร้างไม่สำเร็จ เครดิตหายไหม",
      en: "If a job fails, do I lose my credits?",
    },
    a: {
      th: "ไม่หาย ระบบคืนเครดิตอัตโนมัติทุกครั้งที่งานล้มเหลว คุณตรวจสอบรายการคืนย้อนหลังได้ในหน้าโปรไฟล์ → ประวัติเครดิต",
      en: "No. Your credits are refunded automatically every time a job fails. You can look back over every refund in your dashboard → Credit history.",
    },
  },
  {
    q: {
      th: "เครดิตมีวันหมดอายุไหม",
      en: "Do credits expire?",
    },
    a: {
      th: "เครดิตที่ซื้อแบบจ่ายครั้งเดียวไม่มีวันหมดอายุ อยู่ในบัญชีจนกว่าจะใช้หมด",
      en: "Credits bought with a one-time payment never expire. They stay in your account until you use them up.",
    },
  },
  {
    q: {
      th: "จ่ายเงินอย่างไร ปลอดภัยแค่ไหน",
      en: "How do I pay, and is it safe?",
    },
    a: {
      th: "ชำระผ่านระบบของ XMAN STUDIO ซึ่งใช้ Stripe เป็นผู้ประมวลผลการชำระเงิน เราไม่เก็บเลขบัตรของคุณไว้ในระบบเลย",
      en: "You pay through XMAN STUDIO, which uses Stripe to process payments. We never store your card number.",
    },
  },
  {
    q: {
      th: "ข้อมูลและภาพของฉันถูกนำไปเทรนโมเดลไหม",
      en: "Are my data and pictures used to train models?",
    },
    a: {
      th: "ไม่ เราไม่นำผลงานของคุณไปเทรนโมเดล ผลงานจะเป็นส่วนตัวจนกว่าคุณจะเลือกแชร์เอง",
      en: "No. We never use your work to train models, and it stays private until you choose to share it.",
    },
  },
  {
    q: {
      th: "ทำไมต้องใช้ที่นี่แทนการสมัครแต่ละเจ้าเอง",
      en: "Why use this instead of signing up with each service?",
    },
    a: {
      th: "เพราะได้โมเดลจากหลายผู้ให้บริการในระบบเครดิตเดียว ไม่ต้องถือหลายซับสคริปชัน และระบบหมุน API key ให้อัตโนมัติเมื่อเจ้าใดเจ้าหนึ่งติดคิวหรือล่ม",
      en: "You get models from many makers on one set of credits, without a pile of subscriptions — and when one service is queued up or down, we switch around it automatically.",
    },
  },
];
