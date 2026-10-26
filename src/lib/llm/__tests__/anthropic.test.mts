/**
 * Claude Code talks Anthropic's Messages API; the gateway talks OpenAI's. An
 * agent is mostly tool calls, so the translation has to carry them exactly —
 * a lost tool_use id or a mangled argument stops the agent mid-task.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AnthropicStream, anthropicError, anthropicToOpenAI, openAIToAnthropic } from '@/lib/llm/anthropic';

test('request: system, text, tool calls and their results, in OpenAI order', () => {
  const out = anthropicToOpenAI({
    model: 'deepseek-v4.1-flash',
    max_tokens: 1024,
    stream: true,
    system: [{ type: 'text', text: 'You are a coding agent.', cache_control: { type: 'ephemeral' } }],
    tools: [
      { name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
      { type: 'web_search_20250305', name: 'web_search' },
    ],
    tool_choice: { type: 'any' },
    stop_sequences: ['END'],
    messages: [
      { role: 'user', content: 'open README' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'README.md' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '# Hello' }] }, { type: 'text', text: 'summarise' }] },
    ],
  });
  assert.equal(out.model, 'deepseek-v4.1-flash');
  assert.equal(out.max_tokens, 1024);
  assert.equal(out.stream, true);
  assert.deepEqual(out.stop, ['END']);
  assert.equal(out.tool_choice, 'required');
  const tools = out.tools as { function: { name: string } }[];
  assert.deepEqual(tools.map((t) => t.function.name), ['Read'], 'a server tool with no schema cannot run here');
  const m = out.messages as Record<string, unknown>[];
  assert.deepEqual(m[0], { role: 'system', content: 'You are a coding agent.' });
  assert.deepEqual(m[1], { role: 'user', content: 'open README' });
  assert.equal(m[2].role, 'assistant');
  assert.equal(m[2].content, 'Reading.', 'thinking is not carried');
  assert.deepEqual(m[2].tool_calls, [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"README.md"}' } }]);
  assert.deepEqual(m[3], { role: 'tool', tool_call_id: 'toolu_1', content: '# Hello' }, 'the result follows its call');
  assert.deepEqual(m[4], { role: 'user', content: 'summarise' });
});

test('request: an error result is marked, images become data URLs, bad bodies are refused', () => {
  const out = anthropicToOpenAI({
    model: 'x',
    max_tokens: 10,
    messages: [{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't', is_error: true, content: 'not found' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
      { type: 'text', text: 'what is this' },
    ] }],
  });
  const m = out.messages as Record<string, unknown>[];
  assert.equal(m[0].content, 'Error: not found');
  assert.deepEqual(m[1].content, [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }, { type: 'text', text: 'what is this' }]);
  assert.equal(out.stream, false);
  assert.throws(() => anthropicToOpenAI({ model: 'x', messages: [] }));
  assert.throws(() => anthropicToOpenAI('hello'));
});

test('response: text and tool calls become blocks; finish reasons and cache reads map', () => {
  const msg = openAIToAnthropic(
    {
      id: 'abc',
      choices: [{ finish_reason: 'tool_calls', message: { content: 'Let me look.', tool_calls: [{ id: 'call_1', function: { name: 'Read', arguments: '{"path":"a.ts"}' } }] } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 60 },
    },
    'deepseek-v4.1-flash'
  );
  assert.equal(msg.type, 'message');
  assert.equal(msg.model, 'deepseek-v4.1-flash');
  assert.equal(msg.stop_reason, 'tool_use');
  assert.deepEqual(msg.content, [
    { type: 'text', text: 'Let me look.' },
    { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a.ts' } },
  ]);
  assert.deepEqual(msg.usage, { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 0 });
  assert.equal(openAIToAnthropic({ choices: [{ finish_reason: 'length', message: { content: 'x' } }] }, 'm').stop_reason, 'max_tokens');
});

/** Parse Anthropic SSE text into its events. */
function events(sse: string): Record<string, unknown>[] {
  return sse
    .split('\n\n')
    .filter((e) => e.trim())
    .map((e) => JSON.parse(e.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

test('stream: text, then two tool calls with split arguments, then usage — each its own block', () => {
  const s = new AnthropicStream('m');
  const chunk = (delta: unknown, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ choices: [{ delta, ...extra }] })}\n\n`;
  let out = '';
  out += s.push(chunk({ content: 'Hi' }));
  out += s.push(chunk({ content: ' there' }).slice(0, 20));
  out += s.push(chunk({ content: ' there' }).slice(20));
  out += s.push(chunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'Read', arguments: '{"pa' } }] }));
  out += s.push(chunk({ tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }] }));
  out += s.push(chunk({ tool_calls: [{ index: 1, id: 'call_b', function: { name: 'Grep', arguments: '{}' } }] }, { finish_reason: 'tool_calls' }));
  out += s.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } })}\n\ndata: [DONE]\n\n`);
  out += s.end();
  assert.equal(s.end(), '', 'ending twice sends nothing more');

  const ev = events(out);
  const types = ev.map((e) => e.type);
  assert.equal(types[0], 'message_start');
  assert.deepEqual(types.slice(-2), ['message_delta', 'message_stop']);
  const starts = ev.filter((e) => e.type === 'content_block_start') as { index: number; content_block: Record<string, unknown> }[];
  assert.deepEqual(starts.map((e) => [e.index, e.content_block.type, e.content_block.id ?? null]), [[0, 'text', null], [1, 'tool_use', 'call_a'], [2, 'tool_use', 'call_b']]);
  const text = ev.filter((e) => e.type === 'content_block_delta' && (e.delta as { type: string }).type === 'text_delta').map((e) => (e.delta as { text: string }).text).join('');
  assert.equal(text, 'Hi there', 'a chunk split mid-line is reassembled');
  const json = ev.filter((e) => e.type === 'content_block_delta' && e.index === 1).map((e) => (e.delta as { partial_json: string }).partial_json).join('');
  assert.equal(json, '{"path":"x"}');
  assert.equal(ev.filter((e) => e.type === 'content_block_stop').length, 3, 'every block is closed');
  const final = ev.find((e) => e.type === 'message_delta') as { delta: { stop_reason: string }; usage: Record<string, number> };
  assert.equal(final.delta.stop_reason, 'tool_use');
  assert.equal(final.usage.output_tokens, 9);
  assert.equal(final.usage.input_tokens, 50);
});

test('stream: an empty answer still opens and closes the message', () => {
  const ev = events(new AnthropicStream('m').end());
  assert.deepEqual(ev.map((e) => e.type), ['message_start', 'message_delta', 'message_stop']);
});

test('errors carry Anthropic types', () => {
  assert.deepEqual(anthropicError(402, 'no credits'), { type: 'error', error: { type: 'billing_error', message: 'no credits' } });
  assert.equal((anthropicError(503, 'warming').error as { type: string }).type, 'overloaded_error');
  assert.equal((anthropicError(400, 'bad').error as { type: string }).type, 'invalid_request_error');
});
