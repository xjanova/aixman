import { ApiError, authenticate } from '@/lib/llm/gateway';
import { AnthropicRequestError, anthropicError, anthropicToOpenAI } from '@/lib/llm/anthropic';

export const dynamic = 'force-dynamic';

/**
 * Anthropic's token count, which Claude Code asks for to manage its context.
 * No tokenizer here: about three bytes a token over the translated request —
 * close for English and code, generous for Thai. Free; nothing is held.
 */
export async function POST(request: Request) {
  try {
    await authenticate(request.headers);
    const body = await request.json().catch(() => null);
    const openai = anthropicToOpenAI({ max_tokens: 1, ...(body ?? {}) });
    const bytes = Buffer.byteLength(JSON.stringify({ m: openai.messages, t: openai.tools ?? null }), 'utf8');
    return Response.json({ input_tokens: Math.ceil(bytes / 3) });
  } catch (error) {
    if (error instanceof ApiError) return Response.json(anthropicError(error.status, error.message), { status: error.status });
    if (error instanceof AnthropicRequestError) return Response.json(anthropicError(400, error.message), { status: 400 });
    return Response.json(anthropicError(500, 'Internal error.'), { status: 500 });
  }
}
