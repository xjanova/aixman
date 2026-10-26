/**
 * Anthropic Messages API ⇄ the OpenAI chat format our gateway speaks.
 *
 * Claude Code (and other Anthropic-SDK tools) talk `POST /v1/messages`; with
 * `ANTHROPIC_BASE_URL=https://ai.xman4289.com/api` and one of our keys they
 * reach /api/v1/messages, which translates the request, runs it through the
 * same gateway (same holds, caps, billing), and translates the answer back —
 * tool calls included, since an agent is mostly tool calls.
 *
 * Pure: no database, no network. Thinking blocks are not carried either way:
 * a reply's reasoning has no Anthropic signature to give it, and a request's
 * past thinking means nothing to another model.
 */

type Json = Record<string, unknown>;

export class AnthropicRequestError extends Error {}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Anthropic content (a string or blocks) as plain text, for system prompts and tool results. */
function blocksText(content: unknown): string {
  if (typeof content === 'string') return content;
  return asArray(content)
    .map((b) => (b && typeof b === 'object' && (b as Json).type === 'text' ? String((b as Json).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

/** An image block as an OpenAI image_url part (base64 → data URL). */
function imagePart(block: Json): Json | null {
  const src = block.source as Json | undefined;
  if (!src) return null;
  if (src.type === 'base64' && typeof src.data === 'string') {
    return { type: 'image_url', image_url: { url: `data:${src.media_type ?? 'image/png'};base64,${src.data}` } };
  }
  if (src.type === 'url' && typeof src.url === 'string') return { type: 'image_url', image_url: { url: src.url } };
  return null;
}

function toolChoice(choice: unknown): unknown {
  const c = choice as Json | undefined;
  switch (c?.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', function: { name: String(c.name ?? '') } };
    default:
      return undefined;
  }
}

/** An Anthropic `/v1/messages` body as an OpenAI chat-completions body. */
export function anthropicToOpenAI(body: unknown): Json {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AnthropicRequestError('The body must be a JSON object.');
  const b = body as Json;
  if (!Array.isArray(b.messages) || b.messages.length === 0) throw new AnthropicRequestError('`messages` must be a non-empty array.');

  const messages: Json[] = [];
  const system = blocksText(b.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const raw of b.messages) {
    const m = raw as Json;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m.content === 'string') {
      messages.push({ role, content: m.content });
      continue;
    }
    const blocks = asArray(m.content) as Json[];
    if (role === 'assistant') {
      const text = blocks.filter((x) => x.type === 'text').map((x) => String(x.text ?? '')).join('');
      const toolCalls = blocks
        .filter((x) => x.type === 'tool_use')
        .map((x) => ({ id: String(x.id), type: 'function', function: { name: String(x.name), arguments: JSON.stringify(x.input ?? {}) } }));
      messages.push({ role: 'assistant', content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    // A user turn: tool results become `tool` messages (they must follow the
    // assistant's tool calls directly), the rest one user message.
    const parts: Json[] = [];
    for (const x of blocks) {
      if (x.type === 'tool_result') {
        const text = blocksText(x.content);
        messages.push({ role: 'tool', tool_call_id: String(x.tool_use_id), content: x.is_error ? `Error: ${text}` : text });
      } else if (x.type === 'text') {
        parts.push({ type: 'text', text: String(x.text ?? '') });
      } else if (x.type === 'image') {
        const img = imagePart(x);
        if (img) parts.push(img);
      }
    }
    if (parts.length > 0) {
      const onlyText = parts.every((p) => p.type === 'text');
      messages.push({ role: 'user', content: onlyText ? parts.map((p) => p.text).join('\n') : parts });
    }
  }

  const out: Json = { model: b.model, messages, max_tokens: b.max_tokens, stream: b.stream === true };
  if (typeof b.temperature === 'number') out.temperature = b.temperature;
  if (typeof b.top_p === 'number') out.top_p = b.top_p;
  if (typeof b.top_k === 'number') out.top_k = b.top_k;
  if (Array.isArray(b.stop_sequences) && b.stop_sequences.length > 0) out.stop = b.stop_sequences;
  const tools = asArray(b.tools)
    .map((t) => t as Json)
    // Server tools (web search, …) have no schema and run at Anthropic; nothing here can run them.
    .filter((t) => typeof t.name === 'string' && t.input_schema)
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }));
  if (tools.length > 0) out.tools = tools;
  const choice = toolChoice(b.tool_choice);
  if (choice !== undefined && tools.length > 0) out.tool_choice = choice;
  return out;
}

const STOP: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'refusal',
};

function stopReason(finish: unknown): string {
  return STOP[String(finish)] ?? 'end_turn';
}

function parseArgs(args: unknown): unknown {
  if (typeof args !== 'string' || !args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { _raw: args };
  }
}

function anthropicUsage(usage: unknown): Json {
  const u = (usage ?? {}) as Json;
  const details = u.prompt_tokens_details as Json | undefined;
  const cached = Number(u.prompt_cache_hit_tokens ?? details?.cached_tokens ?? 0) || 0;
  const prompt = Number(u.prompt_tokens ?? 0) || 0;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: Number(u.completion_tokens ?? 0) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

/** A whole (non-streamed) OpenAI answer as an Anthropic message. */
export function openAIToAnthropic(json: Json, model: string): Json {
  const choice = (asArray(json.choices)[0] ?? {}) as Json;
  const message = (choice.message ?? {}) as Json;
  const content: Json[] = [];
  if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
  for (const call of asArray(message.tool_calls) as Json[]) {
    const fn = (call.function ?? {}) as Json;
    content.push({ type: 'tool_use', id: String(call.id ?? `toolu_${Math.random().toString(36).slice(2)}`), name: String(fn.name ?? ''), input: parseArgs(fn.arguments) });
  }
  return {
    id: `msg_${String(json.id ?? Date.now())}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason(choice.finish_reason),
    stop_sequence: null,
    usage: anthropicUsage(json.usage),
  };
}

function event(type: string, data: Json): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/**
 * OpenAI stream chunks in, Anthropic stream events out. Text and each tool
 * call become their own content block, opened on first sight and closed when
 * the next begins or the stream ends.
 */
export class AnthropicStream {
  private buffer = '';
  private started = false;
  private finished = false;
  private index = -1;
  /** The open block: text, or the OpenAI tool-call index it carries. */
  private open: { kind: 'text' } | { kind: 'tool'; callIndex: number } | null = null;
  private stop = 'end_turn';
  private usage: Json = {};

  constructor(private readonly model: string) {}

  /** Feed OpenAI SSE text; returns Anthropic SSE text to send. */
  push(text: string): string {
    this.buffer += text;
    let out = '';
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      out += this.line(line);
    }
    return out;
  }

  /** Close everything still open. Safe to call more than once. */
  end(): string {
    if (this.finished) return '';
    this.finished = true;
    let out = this.start();
    out += this.closeBlock();
    // The input count is only known at the end of an OpenAI stream, so it rides here too.
    out += event('message_delta', { delta: { stop_reason: this.stop, stop_sequence: null }, usage: { output_tokens: 0, ...this.usage } });
    out += event('message_stop', {});
    return out;
  }

  private start(): string {
    if (this.started) return '';
    this.started = true;
    return event('message_start', {
      message: {
        id: `msg_${Date.now().toString(36)}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  private closeBlock(): string {
    if (!this.open) return '';
    this.open = null;
    return event('content_block_stop', { index: this.index });
  }

  private line(line: string): string {
    const m = /^data:\s?(.*)$/.exec(line);
    if (!m || m[1].trim() === '[DONE]') return '';
    let chunk: Json;
    try {
      chunk = JSON.parse(m[1]);
    } catch {
      return '';
    }
    let out = this.start();
    if (chunk.usage) this.usage = anthropicUsage(chunk.usage);
    for (const choice of asArray(chunk.choices) as Json[]) {
      const delta = (choice.delta ?? {}) as Json;
      if (typeof delta.content === 'string' && delta.content) {
        if (this.open?.kind !== 'text') {
          out += this.closeBlock();
          this.index += 1;
          this.open = { kind: 'text' };
          out += event('content_block_start', { index: this.index, content_block: { type: 'text', text: '' } });
        }
        out += event('content_block_delta', { index: this.index, delta: { type: 'text_delta', text: delta.content } });
      }
      for (const call of asArray(delta.tool_calls) as Json[]) {
        const callIndex = Number(call.index ?? 0);
        const fn = (call.function ?? {}) as Json;
        if (!(this.open?.kind === 'tool' && this.open.callIndex === callIndex)) {
          out += this.closeBlock();
          this.index += 1;
          this.open = { kind: 'tool', callIndex };
          out += event('content_block_start', {
            index: this.index,
            content_block: { type: 'tool_use', id: String(call.id ?? `toolu_${this.index}`), name: String(fn.name ?? ''), input: {} },
          });
        }
        if (typeof fn.arguments === 'string' && fn.arguments) {
          out += event('content_block_delta', { index: this.index, delta: { type: 'input_json_delta', partial_json: fn.arguments } });
        }
      }
      if (choice.finish_reason) this.stop = stopReason(choice.finish_reason);
    }
    return out;
  }
}

/** Our gateway's error as Anthropic's error body. */
export function anthropicError(status: number, message: string): Json {
  const type =
    status === 401 ? 'authentication_error'
    : status === 402 ? 'billing_error'
    : status === 404 ? 'not_found_error'
    : status === 429 ? 'rate_limit_error'
    : status === 503 ? 'overloaded_error'
    : status >= 500 ? 'api_error'
    : 'invalid_request_error';
  return { type: 'error', error: { type, message } };
}
