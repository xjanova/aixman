import { ApiError, authenticate, listModels } from '@/lib/llm/gateway';

export const dynamic = 'force-dynamic';

/** OpenAI-compatible model list, for any key. */
export async function GET(request: Request) {
  try {
    await authenticate(request.headers);
    return Response.json({ object: 'list', data: await listModels() });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[api/v1/models]', error);
    return new ApiError(500, 'Internal error.', 'api_error').toResponse();
  }
}
