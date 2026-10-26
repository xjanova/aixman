import { ApiError, MAX_BODY_BYTES, authenticate, chatCompletion } from '@/lib/llm/gateway';
import { AnthropicRequestError, AnthropicStream, anthropicError, anthropicToOpenAI, openAIToAnthropic } from '@/lib/llm/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 900;

const ENCODER = new TextEncoder();

function fail(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(anthropicError(status, message), { status, headers });
}

/**
 * Anthropic-compatible Messages API, for Claude Code and the Anthropic SDKs:
 * ANTHROPIC_BASE_URL=https://ai.xman4289.com/api with one of our keys. Runs
 * through the same gateway as /api/v1/chat/completions — same holds, caps and
 * billing — and answers in Anthropic's shape, streamed or not.
 */
export async function POST(request: Request) {
  try {
    const caller = await authenticate(request.headers);
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return fail(413, `The request body is over ${MAX_BODY_BYTES / 1024 / 1024} MB.`);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, 'The body is not valid JSON.');
    }
    const openai = anthropicToOpenAI(body);
    const model = String(body.model ?? '');
    const res = await chatCompletion(caller, openai, request.signal);

    if (openai.stream !== true) return Response.json(openAIToAnthropic(await res.json(), model));

    const translator = new AnthropicStream(model);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const out = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const rest = translator.push(decoder.decode()) + translator.end();
            if (rest) controller.enqueue(ENCODER.encode(rest));
            controller.close();
            return;
          }
          const chunk = translator.push(decoder.decode(value, { stream: true }));
          if (chunk) controller.enqueue(ENCODER.encode(chunk));
        } catch (error) {
          controller.error(error);
        }
      },
      // Cancelling the inner stream is what settles the request (gateway.ts).
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(out, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
    });
  } catch (error) {
    if (error instanceof ApiError) return fail(error.status, error.message, error.headers);
    if (error instanceof AnthropicRequestError) return fail(400, error.message);
    console.error('[api/v1/messages]', error);
    return fail(500, 'Internal error.');
  }
}
