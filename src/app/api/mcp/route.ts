import { ApiError, authenticate, checkRate } from '@/lib/llm/gateway';
import { handleRpc } from '@/lib/mcp/server';

export const dynamic = 'force-dynamic';
// get_generation may wait 45 s; a chat answer up to 55.
export const maxDuration = 60;

/** Tool calls per minute per key: renders spend credits, and a looping agent should stall, not spend. */
const MCP_CALLS_PER_MINUTE = 60;
/** The largest message accepted: an upload_image of 10 MB, base64. */
const MAX_BODY_BYTES = 15 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, X-Api-Key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function unauthorized(message: string): Response {
  return Response.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message } },
    { status: 401, headers: { ...CORS, 'WWW-Authenticate': 'Bearer realm="aixman", error="invalid_token"' } }
  );
}

/**
 * MCP over Streamable HTTP, stateless: each POST carries one JSON-RPC message
 * (or a batch) and gets one JSON answer. Authenticated by a customer API key
 * (`Authorization: Bearer axm-…`), the same key /api/v1 takes.
 */
export async function POST(request: Request) {
  let caller;
  try {
    caller = await authenticate(request.headers);
  } catch (error) {
    if (error instanceof ApiError) return unauthorized(error.message);
    throw error;
  }

  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } }, { status: 413, headers: CORS });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS });
  }

  const messages = Array.isArray(body) ? body : [body];
  const calls = messages.filter((m) => (m as { method?: string })?.method === 'tools/call').length;
  if (calls > 0) {
    try {
      // Its own bucket (the negated key id), apart from the key's /api/v1 requests.
      for (let i = 0; i < calls; i++) checkRate({ ...caller, apiKeyId: -caller.apiKeyId }, MCP_CALLS_PER_MINUTE);
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error.message } }, { status: 429, headers: { ...CORS, ...error.headers } });
      }
      throw error;
    }
  }

  const answers = (await Promise.all(messages.map((m) => handleRpc(caller, m as never)))).filter((a) => a !== null);
  // Only notifications: nothing to say.
  if (answers.length === 0) return new Response(null, { status: 202, headers: CORS });
  return Response.json(Array.isArray(body) ? answers : answers[0], { headers: CORS });
}

/** No server-initiated stream: this server never pushes. */
export async function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
}

export async function DELETE() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
