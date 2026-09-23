import prisma from '@/lib/db';
import { AccountPoolManager } from './account-pool';
import { isAcceptedFrameSource } from '@/lib/gpu/frame-input';

/**
 * "✨ ปรับพรอมต์ด้วย AI" — turn what a customer typed into what the model reads
 * best.
 *
 * This matters most for self-hosted MiniMax H3. MiniMax's own pipeline never
 * gives H3-Base the customer's words: its Context-IR stage rewrites them first
 * into a structured description (shots, camera, speakers, soundscape, score),
 * and the model card calls that stage "critical to the quality of the final
 * output". Our rented-GPU route has only H3-Base. So, in order of preference:
 *
 *  1. H3, with a MiniMax key: MiniMax's own Context-IR API — the real thing.
 *  2. Any chat model with a key in the account pool (OpenAI, MiniMax,
 *     BytePlus ModelArk — all OpenAI-compatible), or keyless Pollinations if
 *     an admin chose it, following the official prompting guide for H3 and a
 *     model-aware brief for everything else.
 *  3. Rules that need no model at all, so the button always does something.
 *
 * The customer sees the result in the prompt box and can edit it before
 * ordering — nothing is rewritten behind their back.
 */

export type EnhanceKind = 'image' | 'video' | 'audio' | 'edit' | 'lipsync';
export type EnhancerProvider = 'auto' | 'openai' | 'minimax' | 'byteplus' | 'pollinations' | 'off';
type LlmProvider = Exclude<EnhancerProvider, 'auto' | 'off'>;

export interface EnhanceRequest {
  prompt: string;
  kind: EnhanceKind;
  /** `ai_models.modelId` of the model the customer picked. */
  modelKey?: string;
  /** The picked model's provider slug. */
  providerSlug?: string;
  videoMode?: 't2v' | 'i2v' | 'fl2v';
  durationSeconds?: number;
  aspectRatio?: string;
  /** Data URL or one of our upload URLs — only Context-IR looks at them. */
  firstFrame?: string;
  lastFrame?: string;
}

export interface EnhanceResult {
  prompt: string;
  source: 'context-ir' | 'llm' | 'rules';
  /** Which engine, for the admin test and the studio's small print. */
  engine: string;
  /** Why an earlier, better engine was skipped (admin test only). */
  fallbackReason?: string;
}

export interface EnhancerConfig {
  provider: EnhancerProvider;
  /** Empty = the provider's default below. */
  model: string;
  /** Use MiniMax's Context-IR API for H3 when a MiniMax key exists. */
  h3ContextIr: boolean;
  /** Per customer per hour. Admins are not limited. */
  hourlyLimit: number;
  /** Admin-written briefs replacing the built-in ones; empty = built-in. */
  instructions: { image: string; video: string; audio: string };
}

export const ENHANCER_KEYS = {
  provider: 'prompt_enhancer_provider',
  model: 'prompt_enhancer_model',
  h3ContextIr: 'prompt_enhancer_h3_context_ir',
  hourlyLimit: 'prompt_enhancer_hourly_limit',
  image: 'prompt_enhancer_instructions_image',
  video: 'prompt_enhancer_instructions_video',
  audio: 'prompt_enhancer_instructions_audio',
} as const;

export const ENHANCER_SETTING_GROUP = 'workflows';

export const DEFAULT_ENHANCER: EnhancerConfig = {
  provider: 'auto',
  model: '',
  h3ContextIr: true,
  hourlyLimit: 30,
  instructions: { image: '', video: '', audio: '' },
};

/** Tried in this order by `auto`. Pollinations only when chosen by name. */
const AUTO_ORDER: LlmProvider[] = ['openai', 'minimax', 'byteplus'];

export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  openai: 'gpt-4.1-mini',
  minimax: 'MiniMax-M2',
  byteplus: 'seed-1-6-flash-250715',
  pollinations: 'openai',
};

/**
 * Where each provider's OpenAI-compatible chat endpoint lives. A pool row's
 * own endpoint wins, because it is the root the admin already set for that
 * provider's image or video API — the chat route hangs off the same root.
 */
function chatUrl(provider: LlmProvider, endpoint?: string): string {
  const root = endpoint?.trim().replace(/\/+$/, '');
  switch (provider) {
    case 'openai':
      return `${root || 'https://api.openai.com/v1'}/chat/completions`;
    case 'minimax':
      // The pool row usually holds the video API's root, without /v1.
      return `${(root || 'https://api.minimax.io').replace(/\/v1$/, '')}/v1/chat/completions`;
    case 'byteplus':
      return `${root || 'https://ark.ap-southeast.bytepluses.com/api/v3'}/chat/completions`;
    case 'pollinations':
      return 'https://text.pollinations.ai/openai';
  }
}

const LLM_TIMEOUT_MS = 45_000;
const CONTEXT_IR_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 8000;

export async function getEnhancerConfig(): Promise<EnhancerConfig> {
  const rows = await prisma.aiSetting.findMany({ where: { key: { in: Object.values(ENHANCER_KEYS) } } });
  const map = new Map(rows.map((r) => [r.key, r.value ?? '']));
  const provider = map.get(ENHANCER_KEYS.provider)?.trim() as EnhancerProvider | undefined;
  const limit = Number(map.get(ENHANCER_KEYS.hourlyLimit));
  return {
    provider: provider && ['auto', 'openai', 'minimax', 'byteplus', 'pollinations', 'off'].includes(provider) ? provider : DEFAULT_ENHANCER.provider,
    model: map.get(ENHANCER_KEYS.model)?.trim() ?? '',
    h3ContextIr: (map.get(ENHANCER_KEYS.h3ContextIr) ?? 'true').trim() !== 'false',
    hourlyLimit: Number.isFinite(limit) && limit >= 0 ? Math.min(1000, Math.round(limit)) : DEFAULT_ENHANCER.hourlyLimit,
    instructions: {
      image: map.get(ENHANCER_KEYS.image) ?? '',
      video: map.get(ENHANCER_KEYS.video) ?? '',
      audio: map.get(ENHANCER_KEYS.audio) ?? '',
    },
  };
}

export async function saveEnhancerConfig(cfg: EnhancerConfig): Promise<void> {
  const values: [string, string][] = [
    [ENHANCER_KEYS.provider, cfg.provider],
    [ENHANCER_KEYS.model, cfg.model.trim().slice(0, 120)],
    [ENHANCER_KEYS.h3ContextIr, cfg.h3ContextIr ? 'true' : 'false'],
    [ENHANCER_KEYS.hourlyLimit, String(cfg.hourlyLimit)],
    [ENHANCER_KEYS.image, cfg.instructions.image.slice(0, 8000)],
    [ENHANCER_KEYS.video, cfg.instructions.video.slice(0, 8000)],
    [ENHANCER_KEYS.audio, cfg.instructions.audio.slice(0, 8000)],
  ];
  await prisma.$transaction(
    values.map(([key, value]) =>
      prisma.aiSetting.upsert({
        where: { key },
        update: { value, group: ENHANCER_SETTING_GROUP },
        create: { key, value, group: ENHANCER_SETTING_GROUP, type: 'string' },
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

const IMAGE_BRIEF = `You are a prompt engineer for state-of-the-art text-to-image models (Qwen-Image, Seedream, FLUX, SDXL).
Rewrite the user's idea as ONE richly detailed English prompt of 50–110 words.
- Keep every subject, count, colour, brand, name and action the user gave. Never contradict them.
- Text that must appear in the image goes in double quotes, in its original language (Thai stays Thai).
- Add what a professional would specify: medium or art style; composition and framing (shot size, angle, lens); lighting (source, direction, quality, time of day); colour palette; materials, textures and fine details; atmosphere.
- Natural sentences or a flowing comma-separated description. No lists, labels, markdown or preamble.
Output only the prompt.`;

const EDIT_BRIEF = `You write instructions for an AI image-editing model.
Rewrite the user's request as ONE clear English instruction (1–2 sentences): exactly what to change, and what must stay the same (identity, pose, background, lighting) unless the user asked otherwise. Text to add goes in double quotes in its original language.
Output only the instruction.`;

const VIDEO_BRIEF = `You are a prompt engineer for AI video models (Kling, Seedance, Luma, Runway, Hailuo).
Rewrite the user's idea as ONE English paragraph of 60–120 words describing a single continuous shot that fits {DURATION} seconds at {ASPECT}:
visual style; subject and appearance; setting; the action as it unfolds in order; camera movement with its speed (slow push in, pan right, tracking shot, static shot, orbit…); lighting and mood.
- Keep names, counts and on-screen text exactly (text in double quotes, original language).
- Spoken words stay verbatim in their original language, in quotes.
Output only the prompt — no labels, markdown or commentary.`;

const AUDIO_BRIEF = `You are a music producer writing the style line for an AI song model (YuE, ACE-Step).
Turn the user's description into ONE line of 12–25 comma-separated English tags covering: language of the vocal (if any), genre and sub-genre, era, up to 3 moods, tempo in BPM, up to 6 key instruments, vocal gender and timbre, production style.
No sentences, no lyrics, no preamble. Output only the tag line.`;

/**
 * H3's own format, condensed from MiniMax's VIDEO_PROMPT_WRITING_GUIDE_base_en
 * (the guide published with the model for building a Context-IR substitute).
 */
const H3_BRIEF = `You rewrite a user's video idea into the structured prompt MiniMax H3 was trained on (the output format of its Context-IR stage). The video is {DURATION} seconds long, aspect ratio {ASPECT}. Follow every rule.

FORMAT (exactly these field names, each on its own paragraph):
{LEAD}integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...

integrated_multimodal_description — the main body, along the timeline:
- Open [Shot 1] with the visual style (Live-action, cinematic / 2D-animated / 3D CG / claymation / watercolor / vintage film) and the opening composition, e.g. "[Shot 1] Live-action, cinematic, a medium-wide shot frames…".
- Describe subjects (age, build, hair, clothing, position), setting and key props, then the actions and reactions in order, so the motion fills the whole duration.
- Camera motion as natural sentences using: push in / pull out, zoom in / zoom out, pan left / right, truck left / right, tilt up / down, pedestal up / down, arc shot, tracking shot, static shot, shake slightly / strongly, POV, roll clockwise / counterclockwise. Add "with small/large amplitude" or "at slow/fast speed" only when it matters.
- One shot unless the idea needs cuts. A later shot starts with a strictly increasing time inside the video: "[Shot 2] At 00:04.000, the camera cuts to…". No time on Shot 1.
- Anyone who speaks or sings gets a stable ID (S1), (S2) and a short voice description the first time (age, gender, timbre, pace). Only the spoken words go inside <d>[Language] …</d>, verbatim in the user's language — never translate dialogue. Example: The elderly man with a deep, calm voice (S1) says: <d>[Thai] สวัสดีครับ</d>
- On-screen text (signs, titles) in double quotes, original language.

overall_soundscape — 1–4 sentences of ambient and physical sounds (wind, footsteps, crowd, impacts). No dialogue, no music. N/A only if the user wants silence.
non_diegetic_music — 1–3 sentences on the background score the characters cannot hear: instruments, tempo, rhythm, dynamics. No mood words. N/A if there should be none.

Write in English except the verbatim dialogue and on-screen text. Keep every name, number and detail the user gave. Output only the final prompt — no commentary, no markdown.`;

const H3_LEAD_I2V =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';

function h3Lead(mode: EnhanceRequest['videoMode'], seconds: number): string {
  if (mode === 'fl2v') {
    return (
      'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark ' +
      `of the target video; Picture 2 (from Shot 1) aligns with the ${seconds.toFixed(2)}-second mark of the target video.`
    );
  }
  return mode === 'i2v' ? H3_LEAD_I2V : '';
}

/** The seconds H3 actually renders for `duration` (17k+5 frames at 24 fps). */
function h3Seconds(duration: number): number {
  const raw = Math.max(5, Math.round(duration * 24));
  return (raw + ((((5 - (raw % 17)) % 17) + 17) % 17)) / 24;
}

function isSelfHostedH3(req: EnhanceRequest): boolean {
  return req.kind === 'video' && req.modelKey === 'minimax-h3';
}

function briefFor(req: EnhanceRequest, cfg: EnhancerConfig): string {
  const duration = Math.max(4, Math.min(15, req.durationSeconds ?? 5));
  const fill = (s: string) =>
    s.replaceAll('{DURATION}', String(Math.round(duration))).replaceAll('{ASPECT}', req.aspectRatio || '16:9');

  if (isSelfHostedH3(req)) {
    if (cfg.instructions.video.trim()) return fill(cfg.instructions.video);
    const lead = h3Lead(req.videoMode, h3Seconds(duration));
    const frames =
      req.videoMode === 'i2v'
        ? '\nA first-frame picture is supplied but you cannot see it: refer to it as <Picture 1> ("the woman shown in <Picture 1>"), start Shot 1 from what it shows, keep identity, clothing and setting, and develop the action forward. Do not invent details that could contradict it.'
        : req.videoMode === 'fl2v'
          ? '\nFirst and last pictures are supplied but you cannot see them: use ONE continuous shot that moves from the state of Picture 1 to the state of Picture 2, reached exactly at the end. Refer to them as Picture 1 and Picture 2 and do not invent contradicting details.'
          : '';
    return fill(H3_BRIEF).replace('{LEAD}', lead ? `${lead}\n\n` : '') + frames;
  }
  switch (req.kind) {
    case 'video':
    case 'lipsync':
      return fill(cfg.instructions.video.trim() || VIDEO_BRIEF);
    case 'audio':
      return cfg.instructions.audio.trim() || AUDIO_BRIEF;
    case 'edit':
      return EDIT_BRIEF;
    default:
      return cfg.instructions.image.trim() || IMAGE_BRIEF;
  }
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function accountFor(slug: string): Promise<{ apiKey: string; apiEndpoint?: string } | null> {
  const provider = await prisma.aiProvider.findUnique({ where: { slug }, select: { id: true, isActive: true } });
  if (!provider?.isActive) return null;
  const account = await AccountPoolManager.selectAccount(provider.id);
  if (!account) return null;
  // Pollinations' pool row is deliberately keyless (encrypt('')).
  if (!account.apiKey && slug !== 'pollinations') return null;
  return { apiKey: account.apiKey, apiEndpoint: account.apiEndpoint };
}

/** What a chat model sometimes wraps its answer in. */
function cleanOutput(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*(final\s+)?(prompt|output|tags?)\s*:\s*/i, '')
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim()
    .slice(0, MAX_OUTPUT_CHARS);
}

async function callChat(provider: LlmProvider, model: string, system: string, user: string): Promise<string> {
  const account: { apiKey: string; apiEndpoint?: string } | null =
    provider === 'pollinations' ? { apiKey: '' } : await accountFor(provider);
  if (!account) throw new Error(`no active ${provider} key in the account pool`);
  const url = chatUrl(provider, account.apiEndpoint);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  // Reasoning models spend tokens before answering; OpenAI's newer ones take
  // only `max_completion_tokens` and reject a temperature.
  if (provider === 'openai') body.max_completion_tokens = 2500;
  else body.max_tokens = provider === 'minimax' ? 4000 : 2500;
  if (provider !== 'openai') body.temperature = 0.7;
  // A rewrite needs little thinking, and a thinking model given a long brief
  // spends its whole budget on it: Pollinations' free gpt-oss is capped at 1,500
  // output tokens and, asked at its default effort, returned `finish_reason:
  // length` with no answer at all (measured 2026-09-23; 8 s and a full answer at
  // "low"). Only sent where it is accepted — OpenAI rejects it on non-reasoning
  // models such as gpt-4.1.
  if (provider === 'pollinations' || (provider === 'openai' && /^(o\d|gpt-5)/i.test(model))) {
    body.reasoning_effort = 'low';
  }

  const res = await withTimeout(LLM_TIMEOUT_MS, (signal) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(account.apiKey ? { Authorization: `Bearer ${account.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    })
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${text.slice(0, 200)}`);
  type ChatReply = {
    choices?: { finish_reason?: string; message?: { content?: string } }[];
    base_resp?: { status_msg?: string; status_code?: number };
  };
  let data: ChatReply | null = null;
  try {
    data = JSON.parse(text) as ChatReply;
  } catch {
    data = null; // Pollinations may answer in plain text
  }
  // MiniMax reports some failures as HTTP 200 with a status code of its own.
  if (data?.base_resp?.status_code) {
    throw new Error(`${provider}: ${data.base_resp.status_msg ?? data.base_resp.status_code}`);
  }
  const content = data && typeof data === 'object' ? (data.choices?.[0]?.message?.content ?? '') : text;
  const out = cleanOutput(content);
  if (!out) {
    throw new Error(
      data?.choices?.[0]?.finish_reason === 'length'
        ? `${provider} ran out of tokens while reasoning and gave no answer — try another model`
        : `${provider} returned an empty answer`
    );
  }
  return out;
}

/**
 * MiniMax's own H3-Context-IR: POST /v2/h3_context_ir, then poll the task until
 * it has `task.content.prompt`. Takes the frames too, which no other engine
 * here can see.
 */
async function callContextIr(req: EnhanceRequest): Promise<string> {
  const account = await accountFor('minimax');
  if (!account) throw new Error('no active MiniMax key in the account pool');
  const base = (account.apiEndpoint || 'https://api.minimax.io').replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${account.apiKey}` };

  const content: Record<string, unknown>[] = [{ type: 'text', text: req.prompt }];
  if (req.videoMode !== 't2v' && req.firstFrame && isAcceptedFrameSource(req.firstFrame)) {
    content.push({ type: 'image_url', image_url: { url: req.firstFrame }, role: 'first_frame' });
    if (req.videoMode === 'fl2v' && req.lastFrame && isAcceptedFrameSource(req.lastFrame)) {
      content.push({ type: 'image_url', image_url: { url: req.lastFrame }, role: 'last_frame' });
    }
  }
  const ratio = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(req.aspectRatio ?? '') ? req.aspectRatio : 'adaptive';

  return withTimeout(CONTEXT_IR_TIMEOUT_MS, async (signal) => {
    const created = await fetch(`${base}/v2/h3_context_ir`, {
      method: 'POST',
      headers,
      signal,
      cache: 'no-store',
      body: JSON.stringify({
        model: 'MiniMax-H3',
        content,
        duration: Math.max(4, Math.min(15, Math.round(req.durationSeconds ?? 5))),
        ratio,
      }),
    });
    const createdText = await created.text();
    if (!created.ok) throw new Error(`Context-IR HTTP ${created.status}: ${createdText.slice(0, 200)}`);
    const taskId = (JSON.parse(createdText) as { task_id?: string }).task_id;
    if (!taskId) throw new Error(`Context-IR returned no task id: ${createdText.slice(0, 200)}`);

    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const polled = await fetch(`${base}/v2/query/video_generation/${encodeURIComponent(taskId)}`, { headers, signal, cache: 'no-store' });
      if (!polled.ok) continue;
      const data = (await polled.json()) as { task?: { status?: string; content?: { prompt?: string }; error?: unknown } };
      const status = data.task?.status;
      if (status === 'succeeded') {
        const prompt = cleanOutput(data.task?.content?.prompt ?? '');
        if (!prompt) throw new Error('Context-IR succeeded with an empty prompt');
        return prompt;
      }
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(`Context-IR ${status}: ${JSON.stringify(data.task?.error ?? '').slice(0, 200)}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Rules — no model, always available
// ---------------------------------------------------------------------------

const RULE_STYLES: { test: RegExp; add: string }[] = [
  { test: /portrait|face|woman|man|girl|boy|คน|ผู้หญิง|ผู้ชาย|สาว|หนุ่ม|ใบหน้า|เด็ก|คุณยาย|คุณตา/i, add: 'portrait photography, 85mm lens, shallow depth of field, soft key light, natural skin texture, catchlights in the eyes' },
  { test: /product|bottle|package|shoe|watch|สินค้า|ขวด|แพ็กเกจ|รองเท้า|นาฬิกา|โฆษณา/i, add: 'commercial product photography, studio softbox lighting, clean background, crisp reflections, sharp focus' },
  { test: /anime|manga|cartoon|chibi|การ์ตูน|อนิเมะ|มังงะ/i, add: 'anime illustration, clean line art, vibrant cel shading, expressive lighting, detailed background' },
  { test: /food|dish|coffee|cake|อาหาร|กาแฟ|ขนม|ก๋วยเตี๋ยว|ส้มตำ/i, add: 'food photography, 45-degree angle, soft window light, shallow depth of field, appetising textures, steam' },
  { test: /landscape|mountain|sea|beach|forest|city|วิว|ภูเขา|ทะเล|ชายหาด|ป่า|เมือง|วัด/i, add: 'landscape photography, golden hour light, wide-angle lens, atmospheric depth, rich dynamic range' },
];

function rulesEnhance(req: EnhanceRequest): string {
  const text = req.prompt.trim();
  if (isSelfHostedH3(req)) {
    const lead = h3Lead(req.videoMode, h3Seconds(req.durationSeconds ?? 5));
    if (/integrated_multimodal_description\s*:/i.test(text)) return text;
    // The customer's words as a sentence of their own, between the guide's
    // opening style note and a camera direction.
    const described = text.replace(/[.,;:\s]+$/, '');
    return (
      `${lead ? `${lead}\n\n` : ''}integrated_multimodal_description: [Shot 1] Live-action, cinematic. ${described}. ` +
      'The camera pushes in with small amplitude at slow speed, and the motion continues naturally until the end of the shot.' +
      '\n\noverall_soundscape: Natural ambient sound and physical action sounds that match what happens on screen.' +
      '\n\nnon_diegetic_music: N/A'
    );
  }
  if (req.kind === 'audio' || req.kind === 'edit' || req.kind === 'lipsync') return text;
  if (req.kind === 'video') {
    return `${text.replace(/[.\s]+$/, '')}. Cinematic, the camera moves slowly and smoothly, natural motion, soft volumetric lighting, rich detail.`;
  }
  const style = RULE_STYLES.find((s) => s.test.test(text))?.add ?? 'cinematic lighting, balanced composition, fine detailed textures, rich colour, high dynamic range';
  return `${text.replace(/[.,\s]+$/, '')}, ${style}`;
}

// ---------------------------------------------------------------------------

/** Enhance one prompt. Never throws: the rules are the last resort. */
export async function enhancePrompt(req: EnhanceRequest, cfgIn?: EnhancerConfig): Promise<EnhanceResult> {
  const cfg = cfgIn ?? (await getEnhancerConfig());
  const reasons: string[] = [];

  if (cfg.provider !== 'off') {
    if (isSelfHostedH3(req) && cfg.h3ContextIr) {
      try {
        return { prompt: await callContextIr(req), source: 'context-ir', engine: 'MiniMax H3-Context-IR' };
      } catch (error) {
        reasons.push(`Context-IR: ${(error as Error).message}`);
      }
    }

    const order: LlmProvider[] = cfg.provider === 'auto' ? AUTO_ORDER : [cfg.provider];
    const system = briefFor(req, cfg);
    for (const provider of order) {
      const model = cfg.model && cfg.provider !== 'auto' ? cfg.model : DEFAULT_MODEL[provider];
      try {
        const prompt = await callChat(provider, model, system, req.prompt);
        return { prompt, source: 'llm', engine: `${provider} · ${model}`, fallbackReason: reasons.join(' | ') || undefined };
      } catch (error) {
        reasons.push(`${provider}: ${(error as Error).message}`);
      }
    }
  } else {
    reasons.push('ปิดผู้ช่วย AI ไว้');
  }

  return { prompt: rulesEnhance(req), source: 'rules', engine: 'rules', fallbackReason: reasons.join(' | ') || undefined };
}
