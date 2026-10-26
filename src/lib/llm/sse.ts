/**
 * Pass an upstream's OpenAI-style event stream through to the customer, and
 * learn what it cost on the way.
 *
 * Each `data:` event is relabelled with the model id the customer asked for
 * (the upstream's own id is ours to change), and the `usage` object the
 * upstream sends at the end (`stream_options.include_usage`) is kept. A stream
 * that ends without one — the customer hung up, the upstream died — is billed
 * from the text that did go out (`streamedChars`).
 *
 * Pure: bytes in, bytes out.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens served from the upstream's cache. */
  cachedTokens: number;
}

/**
 * Read an OpenAI-style `usage` object; null when it carries no counts. Cached
 * prompt tokens come as OpenAI's `prompt_tokens_details.cached_tokens` (vLLM
 * too) or DeepSeek's own `prompt_cache_hit_tokens`.
 */
export function readUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const p = Number(u.prompt_tokens);
  const c = Number(u.completion_tokens);
  if (!Number.isFinite(p) && !Number.isFinite(c)) return null;
  const details = u.prompt_tokens_details as Record<string, unknown> | null | undefined;
  const cached = Number(u.prompt_cache_hit_tokens ?? details?.cached_tokens);
  const promptTokens = Number.isFinite(p) ? Math.max(0, p) : 0;
  return {
    promptTokens,
    completionTokens: Number.isFinite(c) ? Math.max(0, c) : 0,
    cachedTokens: Number.isFinite(cached) ? Math.min(promptTokens, Math.max(0, cached)) : 0,
  };
}

export class SseRelay {
  usage: TokenUsage | null = null;
  /** Characters of generated text (answer and reasoning) relayed so far. */
  streamedChars = 0;
  private buffer = '';

  constructor(private readonly publicModel: string) {}

  /** Feed upstream text; returns what to send on. Holds back an unfinished line. */
  push(text: string): string {
    this.buffer += text;
    const end = this.buffer.lastIndexOf('\n');
    if (end < 0) return '';
    const complete = this.buffer.slice(0, end + 1);
    this.buffer = this.buffer.slice(end + 1);
    return complete
      .split('\n')
      .map((line, i, all) => (i === all.length - 1 ? line : this.line(line)))
      .join('\n');
  }

  /** Whatever was held back when the upstream closed. */
  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? this.line(rest) : '';
  }

  private line(line: string): string {
    const m = /^data:\s?(.*)$/.exec(line.replace(/\r$/, ''));
    if (!m || m[1].trim() === '[DONE]') return line;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(m[1]);
    } catch {
      return line;
    }
    if (!event || typeof event !== 'object') return line;
    const usage = readUsage(event.usage);
    if (usage) this.usage = usage;
    for (const choice of Array.isArray(event.choices) ? event.choices : []) {
      const delta = (choice as { delta?: Record<string, unknown> })?.delta;
      for (const field of ['content', 'reasoning_content']) {
        const v = delta?.[field];
        if (typeof v === 'string') this.streamedChars += v.length;
      }
    }
    if ('model' in event) event.model = this.publicModel;
    return `data: ${JSON.stringify(event)}`;
  }
}

/**
 * Tokens to bill when the upstream never said: one per two characters. English
 * runs ≈4 characters a token and Thai ≈1–2, so this sits between them — only
 * an interrupted stream is ever billed this way.
 */
export function tokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 2));
}
