import { ApiError, MAX_BODY_BYTES, authenticate, chatCompletion } from '@/lib/llm/gateway';

export const dynamic = 'force-dynamic';
// A long reasoning answer streams for minutes.
export const maxDuration = 900;

/** OpenAI-compatible chat completions, billed in AI credits per token. */
export async function POST(request: Request) {
  try {
    const caller = await authenticate(request.headers);
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      throw new ApiError(413, `The request body is over ${MAX_BODY_BYTES / 1024 / 1024} MB.`);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, 'The body is not valid JSON.');
    }
    return await chatCompletion(caller, body, request.signal);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[api/v1/chat/completions]', error);
    return new ApiError(500, 'Internal error.', 'api_error').toResponse();
  }
}
