/**
 * The MCP server's protocol surface, with no database: what a client sees on
 * connect, how tools are described, and that a bad call comes back as a tool
 * error the model can read rather than a protocol failure.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
const { handleRpc, PROTOCOL_VERSIONS, TOOLS } = await import('@/lib/mcp/server');

const caller = { apiKeyId: 1, userId: 1 };
const rpc = (method: string, params?: Record<string, unknown>, id: number | null = 1) =>
  handleRpc(caller, { jsonrpc: '2.0', id: id ?? undefined, method, params } as never);

test('initialize: agrees on a version the client knows, else offers the newest', async () => {
  const known = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })) as { result: Record<string, unknown> };
  assert.equal(known.result.protocolVersion, '2025-06-18');
  assert.deepEqual(known.result.capabilities, { tools: { listChanged: false } });
  assert.equal((known.result.serverInfo as { name: string }).name, 'aixman');
  const unknown = (await rpc('initialize', { protocolVersion: '1999-01-01' })) as { result: Record<string, unknown> };
  assert.equal(unknown.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('notifications get no answer; unknown methods and malformed messages get JSON-RPC errors', async () => {
  assert.equal(await rpc('notifications/initialized', undefined, null), null);
  const missing = (await rpc('sampling/createMessage')) as { error: { code: number } };
  assert.equal(missing.error.code, -32601);
  const bad = (await handleRpc(caller, { id: 3, method: 'ping' } as never)) as { error: { code: number } };
  assert.equal(bad.error.code, -32600, 'jsonrpc: "2.0" is required');
  assert.deepEqual(await rpc('ping'), { jsonrpc: '2.0', id: 1, result: {} });
});

test('tools/list: every tool has a name, a description and an object schema; required fields exist', async () => {
  const res = (await rpc('tools/list')) as { result: { tools: typeof TOOLS } };
  const names = res.result.tools.map((t) => t.name);
  for (const want of ['list_models', 'get_credits', 'generate_image', 'generate_video', 'generate_music', 'generate_speech', 'get_generation', 'list_generations', 'upload_image', 'chat']) {
    assert.ok(names.includes(want), want);
  }
  for (const t of res.result.tools) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object');
    for (const r of (t.inputSchema.required as string[] | undefined) ?? []) {
      assert.ok((t.inputSchema.properties as Record<string, unknown>)[r], `${t.name} requires ${r} but does not describe it`);
    }
  }
});

test('a bad tool call is a tool error the model can read, not a protocol error', async () => {
  const noPrompt = (await rpc('tools/call', { name: 'generate_image', arguments: {} })) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(noPrompt.result.isError, true);
  assert.match(noPrompt.result.content[0].text, /prompt/);
  const wrongType = (await rpc('tools/call', { name: 'generate_video', arguments: { prompt: 7 } })) as { result: { isError: boolean } };
  assert.equal(wrongType.result.isError, true);
  const noText = (await rpc('tools/call', { name: 'generate_speech', arguments: { voice: 'Kore' } })) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(noText.result.isError, true);
  assert.match(noText.result.content[0].text, /text/);
  const unknownTool = (await rpc('tools/call', { name: 'rm_rf', arguments: {} })) as { error: { code: number } };
  assert.equal(unknownTool.error.code, -32602);
});
