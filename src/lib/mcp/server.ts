import prisma from '@/lib/db';
import { ApiError, chatCompletion, listModels, type ApiCaller } from '@/lib/llm/gateway';
import { getKieEntry } from '@/lib/providers/kie-catalog';
import { kieQuote, readKiePriceTable, speechChars } from '@/lib/providers/kie-pricing';
import { publicProvider } from '@/lib/public-provider';
import { ModelReadiness } from '@/lib/services/model-readiness';
import { isOrderRefused } from '@/lib/services/order-refusal';
import { isStorageConfigured, keyFromPublicUrl, uploadBuffer } from '@/lib/storage/r2';
import { MAX_BYTES, sniff, uploadKey } from '@/lib/uploads';
import type { GenerationRequest, GenerationType } from '@/types';

/**
 * aixman as an MCP server: Claude Code, Claude Desktop, Cursor and any other
 * MCP client can make images, videos, music and speech, follow them, and call
 * our language models, with the customer's own API key and credits.
 *
 * Every tool goes through what the website uses — GenerationService for
 * renders (same content gate, readiness, prices, refunds), the /api/v1 gateway
 * for chat (same holds and caps) — so nothing here can cost or allow more than
 * the studio does. Files are only ever ours: a frame must be a URL on our own
 * storage (a render, or `upload_image`), never a stranger's URL.
 *
 * Stateless JSON-RPC over Streamable HTTP (route: /api/mcp): one POST, one
 * JSON answer; no session, no server-sent stream.
 */

export const SERVER_INFO = { name: 'aixman', title: 'XDREAMER (aixman)', version: '1.0.0' };
/** Newest first; an unknown version from the client gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Json = Record<string, unknown>;

export class McpToolError extends Error {}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations?: Json;
}

const ASPECTS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1344, h: 768 },
  '9:16': { w: 768, h: 1344 },
  '4:3': { w: 1152, h: 896 },
  '3:4': { w: 896, h: 1152 },
  '3:2': { w: 1216, h: 832 },
  '2:3': { w: 832, h: 1216 },
};
const ASPECT_ENUM = Object.keys(ASPECTS);

/**
 * What the render tools order, as list_models names it. Music and speech are
 * both 'audio' rows; the subcategory tells them apart.
 */
type Kind = 'image' | 'video' | 'audio' | 'speech';
const KINDS: Kind[] = ['image', 'video', 'audio', 'speech'];

/** A row's kind, or null for one no tool here can feed: lip-sync and the clip tools want a clip. */
function kindOf(row: { category: string; subcategory: string | null }): Kind | null {
  const sub = row.subcategory ?? '';
  if (sub.startsWith('lipsync') || sub === 'motion' || sub === 'video-upscale') return null;
  if (row.category === 'audio') return sub === 'speech' ? 'speech' : 'audio';
  return row.category === 'image' || row.category === 'video' ? row.category : null;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_models',
    title: 'List models',
    description:
      'Models you can use, with their price in credits. kind: image | video | audio (music) | speech (text to speech: voices and character limit) | text (language models for `chat`). Omit for all.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: [...KINDS, 'text'] } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_credits',
    title: 'Credit balance',
    description: "Your AI credit balance. Every render and chat request is paid in credits.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'generate_image',
    title: 'Generate an image',
    description:
      'Create images from a prompt (Thai or English). Spends credits. Returns a generation id; when the result is not ready at once, call get_generation with wait_seconds.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', maxLength: 10000 },
        model: { type: 'string', description: 'A model id from list_models (kind image). Default: the featured one.' },
        aspect_ratio: { type: 'string', enum: ASPECT_ENUM },
        negative_prompt: { type: 'string' },
        num_outputs: { type: 'integer', minimum: 1, maximum: 4 },
      },
    },
  },
  {
    name: 'generate_video',
    title: 'Generate a video',
    description:
      'Create a video (most models add their own sound) from a prompt, optionally starting from first_frame_url and ending on last_frame_url — URLs from generate_image results or upload_image. Spends credits. Videos take minutes: follow with get_generation.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', maxLength: 10000 },
        model: { type: 'string', description: 'A model id from list_models (kind video).' },
        duration: { type: 'integer', minimum: 1, maximum: 20, description: 'Seconds; each model has its own maximum.' },
        aspect_ratio: { type: 'string', enum: ASPECT_ENUM },
        resolution: { type: 'string', description: "A preset some models offer, e.g. '720p'." },
        first_frame_url: { type: 'string' },
        last_frame_url: { type: 'string' },
      },
    },
  },
  {
    name: 'generate_music',
    title: 'Generate music',
    description: 'Create a song or a piece of music from a style prompt, with optional lyrics. Spends credits. Follow with get_generation.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Style: genre, mood, instruments, voice.' },
        lyrics: { type: 'string', maxLength: 3000 },
        model: { type: 'string', description: 'A model id from list_models (kind audio).' },
        duration: { type: 'integer', minimum: 10, maximum: 300 },
      },
    },
  },
  {
    name: 'generate_speech',
    title: 'Text to speech',
    description:
      "Read a text aloud (Thai or English) in one of a model's voices. Spends credits by the text's length (per 1,000 characters, pro rata). list_models kind speech gives each model's voices and character limit. Follow with get_generation.",
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', maxLength: 10000, description: 'What to say. ElevenLabs reads tags like [laughs] or [whispers] as delivery, not words.' },
        model: { type: 'string', description: 'A model id from list_models (kind speech). Default: the featured one.' },
        voice: { type: 'string', description: "A voice id from that model's `voices`. Default: its first." },
        style: { type: 'string', maxLength: 300, description: 'How to speak (e.g. "slow, warm, like a bedtime story") — only models with takes_style.' },
      },
    },
  },
  {
    name: 'get_generation',
    title: 'Generation status',
    description: 'Status and result URLs of a generation. wait_seconds (up to 45) waits for it to finish before answering.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'integer' }, wait_seconds: { type: 'integer', minimum: 0, maximum: 45 } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_generations',
    title: 'Recent generations',
    description: 'Your most recent generations, newest first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'upload_image',
    title: 'Upload an image',
    description: 'Store an image (base64, PNG/JPEG/WebP) and get a URL to use as first_frame_url / last_frame_url.',
    inputSchema: {
      type: 'object',
      required: ['data_base64'],
      properties: { data_base64: { type: 'string', description: 'The file, base64 (a data: URL prefix is fine).' } },
    },
  },
  {
    name: 'chat',
    title: 'Ask a language model',
    description: 'One answer from a language model (list_models kind text), paid in credits per token.',
    inputSchema: {
      type: 'object',
      required: ['model', 'prompt'],
      properties: {
        model: { type: 'string' },
        prompt: { type: 'string' },
        system: { type: 'string' },
        max_tokens: { type: 'integer', minimum: 1, maximum: 32768 },
      },
    },
  },
];

function str(args: Json, key: string, required = false): string | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new McpToolError(`\`${key}\` is required.`);
    return undefined;
  }
  if (typeof v !== 'string') throw new McpToolError(`\`${key}\` must be a string.`);
  return v;
}

function int(args: Json, key: string, min: number, max: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new McpToolError(`\`${key}\` must be a number.`);
  return Math.min(max, Math.max(min, n));
}

/** A frame must already be ours: a render or an upload on our storage. */
function ownUrl(args: Json, key: string): string | undefined {
  const url = str(args, key);
  if (url && !keyFromPublicUrl(url)) {
    throw new McpToolError(`\`${key}\` must be a URL from one of your generations or from upload_image.`);
  }
  return url;
}

async function isAdminUser(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === 'admin' || user?.role === 'super_admin';
}

/**
 * A model the caller may order, by its id or name, or the featured one of a
 * kind. Speech rows are kept out of music (a featured voice model would read
 * the song's style aloud) and the clip tools out of video.
 */
async function pickModel(kind: Kind, wanted: string | undefined, admin: boolean) {
  const rows = await prisma.aiModel.findMany({
    where: { category: kind === 'speech' ? 'audio' : kind, isActive: true, provider: { isActive: true } },
    orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    include: { provider: { select: { name: true, slug: true, logo: true } } },
  });
  const orderable = rows.filter((r) => ModelReadiness.canOrder(r.readiness, admin) && kindOf(r) === kind);
  if (!wanted) {
    if (orderable.length === 0) throw new McpToolError(`No ${kind} model is available right now.`);
    return orderable[0];
  }
  const w = wanted.trim().toLowerCase();
  const found = orderable.find((r) => r.modelId.toLowerCase() === w || String(r.id) === w || r.name.toLowerCase() === w);
  if (!found) throw new McpToolError(`No ${kind} model "${wanted}" is available. Call list_models with kind "${kind}".`);
  return found;
}

/** A finished, failed or waiting generation, as the caller sees it. */
async function describeGeneration(userId: number, id: number): Promise<Json | null> {
  const g = await prisma.aiGeneration.findFirst({
    where: { id, userId },
    include: { model: { select: { modelId: true, name: true } } },
  });
  if (!g) return null;
  const urls = Array.isArray(g.resultUrls) ? (g.resultUrls as string[]) : g.resultUrl ? [g.resultUrl] : [];
  return {
    id: g.id,
    type: g.type,
    model: g.model.modelId,
    status: g.status,
    prompt: g.prompt,
    result_urls: g.mediaDeletedAt ? [] : urls,
    error: g.status === 'failed' ? g.errorMessage : null,
    credits_used: g.creditsUsed - g.creditsRefunded,
    refunded: g.creditsRefunded > 0,
    expires_at: g.expiresAt?.toISOString() ?? null,
    created_at: g.createdAt.toISOString(),
  };
}

const DONE = new Set(['completed', 'failed', 'cancelled']);

async function generate(caller: ApiCaller, type: GenerationType, category: 'image' | 'video' | 'audio', args: Json): Promise<Json> {
  const prompt = str(args, 'prompt', true)!;
  if (prompt.length > 10_000) throw new McpToolError('`prompt` must be under 10,000 characters.');
  const admin = await isAdminUser(caller.userId);
  const model = await pickModel(category, str(args, 'model'), admin);
  const aspect = str(args, 'aspect_ratio');
  if (aspect && !ASPECTS[aspect]) throw new McpToolError(`\`aspect_ratio\` must be one of ${ASPECT_ENUM.join(', ')}.`);
  const size = ASPECTS[aspect ?? (category === 'video' ? '16:9' : '1:1')];
  const lyrics = str(args, 'lyrics');
  if (lyrics && lyrics.length > 3000) throw new McpToolError('`lyrics` must be under 3,000 characters.');

  const request: GenerationRequest = {
    modelId: model.id,
    type,
    prompt,
    negativePrompt: str(args, 'negative_prompt'),
    params: {
      width: size.w,
      height: size.h,
      aspectRatio: aspect ?? (category === 'video' ? '16:9' : '1:1'),
      ...(int(args, 'num_outputs', 1, 4) ? { numOutputs: int(args, 'num_outputs', 1, 4) } : {}),
      ...(int(args, 'duration', 1, 300) ? { duration: int(args, 'duration', 1, 300) } : {}),
      ...(str(args, 'resolution') ? { resolution: str(args, 'resolution') } : {}),
      ...(lyrics ? { lyrics } : {}),
    },
    inputImage: ownUrl(args, 'first_frame_url'),
    inputImageEnd: ownUrl(args, 'last_frame_url'),
  };
  if (request.inputImageEnd && !request.inputImage) throw new McpToolError('`last_frame_url` needs `first_frame_url` too.');
  return order(caller, model.modelId, request, admin);
}

/** A text read aloud: checked against the model's own voices and limit before anything is charged. */
async function speak(caller: ApiCaller, args: Json): Promise<Json> {
  const text = str(args, 'text', true)!;
  const admin = await isAdminUser(caller.userId);
  const model = await pickModel('speech', str(args, 'model'), admin);
  const speech = model.provider.slug === 'kie' ? getKieEntry(model.modelId)?.speech : undefined;
  if (!speech) throw new McpToolError(`"${model.modelId}" cannot read text aloud. Call list_models with kind "speech".`);
  const chars = speechChars(text);
  if (chars === 0) throw new McpToolError('`text` is empty.');
  if (chars > speech.maxChars) {
    throw new McpToolError(`\`text\` is ${chars} characters; ${model.modelId} reads at most ${speech.maxChars} per order. Split it.`);
  }
  const voice = str(args, 'voice');
  if (voice && !speech.voices.some((v) => v.id === voice)) {
    throw new McpToolError(`Unknown voice "${voice}" for ${model.modelId}. Voices: ${speech.voices.map((v) => v.id).join(', ')}.`);
  }
  const style = str(args, 'style')?.trim();
  if (style && !speech.style) throw new McpToolError(`${model.modelId} takes no \`style\`; leave it out or pick a model with takes_style.`);
  if (style && style.length > 300) throw new McpToolError('`style` must be under 300 characters.');
  const request: GenerationRequest = {
    modelId: model.id,
    type: 'audio',
    prompt: text,
    params: { voice: voice ?? speech.voices[0].id, ...(style ? { speechStyle: style } : {}) },
  };
  return order(caller, model.modelId, request, admin);
}

/** The order itself, through the studio's own path, and its outcome as the caller sees it. */
async function order(caller: ApiCaller, modelId: string, request: GenerationRequest, admin: boolean): Promise<Json> {
  // Lazily: the service pulls in Next's request helpers.
  const { GenerationService } = await import('@/lib/services/generation');
  try {
    const result = await GenerationService.generate(caller.userId, request, { isAdmin: admin });
    return {
      id: result.id,
      model: modelId,
      status: result.status,
      credits_used: result.creditsUsed,
      result_urls: result.resultUrls ?? (result.resultUrl ? [result.resultUrl] : []),
      ...(result.error ? { error: result.error } : {}),
      next: DONE.has(result.status) ? undefined : `Call get_generation with id ${result.id} and wait_seconds 45 until status is completed.`,
    };
  } catch (error) {
    if (isOrderRefused(error)) throw new McpToolError(error.message);
    const message = (error as Error).message;
    if (message.includes('Insufficient credits')) throw new McpToolError(`${message}. Top up at https://ai.xman4289.com/pricing`);
    // The service's own customer-facing reasons (Thai) pass through; nothing else does.
    if (/[฀-๿]/.test(message)) throw new McpToolError(message);
    console.error('[mcp] generate failed', error);
    throw new McpToolError('The order could not be placed. Nothing was charged; try again later.');
  }
}

async function callTool(caller: ApiCaller, name: string, args: Json): Promise<Json> {
  switch (name) {
    case 'list_models': {
      const kind = str(args, 'kind');
      const admin = await isAdminUser(caller.userId);
      const out: Json[] = [];
      if (!kind || kind !== 'text') {
        if (kind && !(KINDS as string[]).includes(kind)) {
          throw new McpToolError(`\`kind\` must be one of ${[...KINDS, 'text'].join(', ')}.`);
        }
        const rows = await prisma.aiModel.findMany({
          where: {
            isActive: true,
            provider: { isActive: true },
            category: kind ? (kind === 'speech' ? 'audio' : kind) : { in: ['image', 'video', 'audio'] },
          },
          orderBy: [{ category: 'asc' }, { isFeatured: 'desc' }, { sortOrder: 'asc' }],
          include: { provider: { select: { name: true, slug: true, logo: true } } },
        });
        for (const r of rows) {
          const rowKind = kindOf(r);
          if (!ModelReadiness.canOrder(r.readiness, admin) || !rowKind || (kind && rowKind !== kind)) continue;
          const speech = rowKind === 'speech' && r.provider.slug === 'kie' ? getKieEntry(r.modelId)?.speech : undefined;
          if (rowKind === 'speech' && !speech) continue;
          const table = speech ? readKiePriceTable(r.defaultParams) : null;
          out.push({
            id: r.modelId,
            kind: rowKind,
            name: r.name,
            provider: publicProvider(r.provider).name,
            description: r.description,
            credits: table ? kieQuote(table, { chars: 1000 }) : r.creditsPerUnit,
            unit:
              rowKind === 'image' ? 'per image'
                : rowKind === 'video' ? 'base clip (longer costs more)'
                  : rowKind === 'speech' ? 'per 1,000 characters (charged pro rata, at least 1)'
                    : 'per song',
            ...(r.maxDuration && rowKind !== 'speech' ? { max_duration_seconds: r.maxDuration } : {}),
            ...(speech
              ? {
                  max_characters: speech.maxChars,
                  takes_style: speech.style === true,
                  voices: speech.voices.map((v) => ({ id: v.id, name: v.label, gender: v.gender })),
                }
              : {}),
          });
        }
      }
      if (!kind || kind === 'text') {
        for (const m of await listModels()) {
          out.push({ id: m.id, kind: 'text', name: m.name, description: m.description, pricing: m.pricing, context_length: m.context_length });
        }
      }
      return { models: out };
    }

    case 'get_credits': {
      const credit = await prisma.aiUserCredit.findUnique({ where: { userId: caller.userId }, select: { balance: true } });
      return { balance: credit?.balance ?? 0, top_up: 'https://ai.xman4289.com/pricing' };
    }

    case 'generate_image':
      return generate(caller, 'image', 'image', args);
    case 'generate_video':
      return generate(caller, 'video', 'video', args);
    case 'generate_music':
      return generate(caller, 'audio', 'audio', args);
    case 'generate_speech':
      return speak(caller, args);

    case 'get_generation': {
      const id = int(args, 'id', 1, Number.MAX_SAFE_INTEGER);
      if (!id) throw new McpToolError('`id` is required.');
      const deadline = Date.now() + (int(args, 'wait_seconds', 0, 45) ?? 0) * 1000;
      for (;;) {
        const g = await describeGeneration(caller.userId, id);
        if (!g) throw new McpToolError(`No generation ${id} of yours.`);
        if (DONE.has(String(g.status)) || Date.now() >= deadline) return g;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    case 'list_generations': {
      const rows = await prisma.aiGeneration.findMany({
        where: { userId: caller.userId },
        orderBy: { createdAt: 'desc' },
        take: int(args, 'limit', 1, 20) ?? 10,
        select: { id: true },
      });
      return { generations: (await Promise.all(rows.map((r) => describeGeneration(caller.userId, r.id)))).filter(Boolean) };
    }

    case 'upload_image': {
      if (!isStorageConfigured()) throw new McpToolError('File storage is not available right now.');
      const raw = str(args, 'data_base64', true)!.replace(/^data:[^,]*,/, '');
      const buffer = Buffer.from(raw, 'base64');
      if (buffer.length === 0) throw new McpToolError('The image is empty or not base64.');
      if (buffer.length > MAX_BYTES.image) throw new McpToolError(`The image is over ${Math.round(MAX_BYTES.image / 1024 / 1024)} MB.`);
      const detected = sniff(buffer, 'image');
      if (!detected) throw new McpToolError('Not a supported image (PNG, JPEG or WebP).');
      const url = await uploadBuffer(buffer, uploadKey(caller.userId, 'image', detected.ext), detected.contentType);
      return { url, bytes: buffer.length };
    }

    case 'chat': {
      const model = str(args, 'model', true)!;
      const prompt = str(args, 'prompt', true)!;
      const system = str(args, 'system');
      const body = {
        model,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
        max_tokens: int(args, 'max_tokens', 1, 32_768) ?? 4096,
      };
      try {
        const res = await chatCompletion(caller, body, AbortSignal.timeout(55_000));
        const json = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[]; usage?: unknown };
        return { model, answer: json.choices?.[0]?.message?.content ?? '', usage: json.usage };
      } catch (error) {
        if (error instanceof ApiError) throw new McpToolError(error.message);
        throw error;
      }
    }

    default:
      throw new McpToolError(`Unknown tool "${name}".`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

function ok(id: RpcRequest['id'], result: Json): Json {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: RpcRequest['id'], code: number, message: string): Json {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** One JSON-RPC message → its answer, or null for a notification. */
export async function handleRpc(caller: ApiCaller, msg: RpcRequest): Promise<Json | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'XDREAMER (ai.xman4289.com): make images, videos, music and speech, and call language models, paid from your AI credits. ' +
          'Renders return an id at once; follow them with get_generation (wait_seconds 45) until completed. ' +
          'Use a generated image URL as first_frame_url to animate it. Prompts may be Thai or English.',
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Json;
      if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool "${name}"`);
      try {
        const result = await callTool(caller, name, args);
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
      } catch (error) {
        // A tool's failure is the model's to read and act on, not a protocol error.
        const message = error instanceof McpToolError ? error.message : 'Internal error.';
        if (!(error instanceof McpToolError)) console.error(`[mcp] ${name} failed`, error);
        return ok(msg.id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    case 'resources/list':
      return ok(msg.id, { resources: [] });
    case 'prompts/list':
      return ok(msg.id, { prompts: [] });
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

