/**
 * The words of each song an order delivered.
 *
 * Suno returns its tracks with the lyrics they sing — the customer's own, or
 * the ones it wrote when the lyrics box was left empty. The KIE adapter reads
 * them off the finished task (`sunoTrackLyrics`) and GenerationService keeps
 * them in the order's `params.outputLyrics`, same order as `result_urls`, the
 * way `outputLabels` keeps a stem split's names. Orders from before that, and
 * models that return no words (YuE2, ACE-Step), fall back to the lyrics the
 * customer typed. Pure, so the tests run it as it is.
 */

/** Longer than any lyrics box we offer (3,000) or Suno writes. */
const MAX_CHARS = 6000;

function clean(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The lyrics to show for each of `urls` (one entry when the order has a single
 * file), or null when there are none. An empty string is a track without words.
 */
export function songLyrics(params: unknown, urls: unknown): string[] | null {
  const p = record(params);
  if (!p) return null;
  const count = Array.isArray(urls) && urls.length > 0 ? urls.length : 1;
  const stored = p.outputLyrics;
  if (Array.isArray(stored) && stored.length === count && stored.every((l) => typeof l === 'string')) {
    const words = (stored as string[]).map(clean);
    if (words.some(Boolean)) return words;
  }
  // A stem split's files are parts of one song, not songs with words of their own.
  if (Array.isArray(p.outputLabels)) return null;
  const own = typeof p.lyrics === 'string' ? clean(p.lyrics) : '';
  return own ? Array(count).fill(own) : null;
}

/**
 * Each song an order delivered, with the words it sings — Suno's two takes are
 * two songs. A stem split is one song: its first file, with the lyrics typed.
 * Empty when the order kept no file.
 */
export function songTracks(params: unknown, resultUrl: string | null, resultUrls: unknown): { url: string; lyrics: string }[] {
  const urls = Array.isArray(resultUrls) && resultUrls.length > 0 && resultUrls.every((u) => typeof u === 'string' && u) ? (resultUrls as string[]) : resultUrl ? [resultUrl] : [];
  if (urls.length === 0) return [];
  const p = record(params);
  if (Array.isArray(p?.outputLabels)) return [{ url: resultUrl ?? urls[0], lyrics: typeof p.lyrics === 'string' ? clean(p.lyrics) : '' }];
  const words = songLyrics(params, urls) ?? [];
  return urls.map((url, i) => ({ url, lyrics: words[i] ?? '' }));
}

/** A Suno track's words: `lyric(s)` when given, else `prompt` when it reads like lyrics. */
function trackWords(o: Record<string, unknown>): string {
  for (const key of ['lyric', 'lyrics']) {
    if (typeof o[key] === 'string' && o[key].trim()) return clean(o[key]);
  }
  // In a finished track `prompt` is what it sings. A one-line style or
  // description (instrumental orders) is not shown as lyrics.
  const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
  return prompt.includes('\n') || /\[[^\]\n]{1,40}\]/.test(prompt) ? clean(prompt) : '';
}

function audioOf(o: Record<string, unknown>): string | null {
  for (const key of ['audio_url', 'audioUrl', 'source_audio_url', 'sourceAudioUrl']) {
    if (typeof o[key] === 'string' && o[key]) return o[key];
  }
  return null;
}

function tracks(node: unknown, depth: number, out: Record<string, unknown>[]): void {
  if (!node || depth > 5) return;
  if (Array.isArray(node)) {
    for (const n of node) tracks(n, depth + 1, out);
    return;
  }
  const o = record(node);
  if (!o) return;
  if (audioOf(o)) {
    out.push(o);
    return;
  }
  for (const value of Object.values(o)) tracks(value, depth + 1, out);
}

/**
 * The words of each delivered file, same order as `urls`, read from a
 * finished Suno task (`resultJson` or `response`). Undefined when the task
 * names none, so nothing is stored and the customer's own lyrics are shown.
 */
export function sunoTrackLyrics(sources: unknown[], urls: string[]): string[] | undefined {
  if (urls.length === 0) return undefined;
  for (const source of sources) {
    const found: Record<string, unknown>[] = [];
    tracks(source, 0, found);
    if (found.length === 0) continue;
    const byUrl = new Map(found.map((o) => [audioOf(o), trackWords(o)]));
    const words = urls.every((u) => byUrl.has(u))
      ? urls.map((u) => byUrl.get(u) ?? '')
      : found.length === urls.length
        ? found.map(trackWords)
        : null;
    if (words && words.some(Boolean)) return words;
  }
  return undefined;
}
