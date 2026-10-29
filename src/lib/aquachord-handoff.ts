/**
 * Song Handoff v1 — send a finished song to AquaChord (aquachord.online),
 * which works out its chords, lyrics and guitar tab in the customer's browser.
 *
 * AquaChord is another origin: it cannot send our session cookie, and it cannot
 * read R2 either (no CORS). So the studio mints a link that carries its own
 * authority — a stateless HMAC token naming one generation and an expiry — and
 * the partner routes under /api/partner/aquachord accept nothing else. They
 * answer AquaChord's origin only and hand out the song's bytes, never the R2 URL.
 *
 * Token: base64url("<genId>.<exp>") + "." + base64url(HMAC-SHA256(secret, "<genId>.<exp>"))
 * with `exp` in Unix seconds. No table, no migration: a leaked link dies with
 * its 15 minutes, and rotating AQUACHORD_HANDOFF_SECRET kills every live one.
 *
 * Contract: AquaChord repo, docs/10-SONG-HANDOFF.md. Pure — no Next, no DB —
 * so the tests can run it as it is.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** How long a link works. AquaChord fetches it the moment its tab opens. */
export const HANDOFF_TTL_SEC = 15 * 60;

const PRODUCTION_ORIGIN = 'https://aquachord.online';

/**
 * The one origin the partner routes answer, and the site the studio opens.
 *
 * `AQUACHORD_ORIGIN` points both at a local AquaChord for an end-to-end test.
 * A production build ignores it, so a stray value on the server can never widen
 * who may read a customer's song.
 */
export function aquachordOrigin(): string {
  if (process.env.NODE_ENV === 'production') return PRODUCTION_ORIGIN;
  const raw = process.env.AQUACHORD_ORIGIN?.trim();
  if (!raw) return PRODUCTION_ORIGIN;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : PRODUCTION_ORIGIN;
  } catch {
    return PRODUCTION_ORIGIN;
  }
}

function secret(): string | null {
  const value = process.env.AQUACHORD_HANDOFF_SECRET?.trim();
  return value ? value : null;
}

/** False until AQUACHORD_HANDOFF_SECRET is set — the studio route then answers 503. */
export function handoffConfigured(): boolean {
  return secret() !== null;
}

function mac(key: string, payload: string): Buffer {
  return createHmac('sha256', key).update(payload).digest();
}

/**
 * A link for one generation, or null when there is no key. `key` defaults to
 * AQUACHORD_HANDOFF_SECRET; the routes pass the one aquachord-config.ts keeps.
 */
export function signHandoff(genId: number, nowMs = Date.now(), key: string | null = secret()): { token: string; exp: number } | null {
  if (!key || !Number.isSafeInteger(genId) || genId <= 0) return null;
  const exp = Math.floor(nowMs / 1000) + HANDOFF_TTL_SEC;
  const payload = `${genId}.${exp}`;
  return {
    token: `${Buffer.from(payload).toString('base64url')}.${mac(key, payload).toString('base64url')}`,
    exp,
  };
}

// Payload "<≤10 digits>.<10–12 digits>" is at most 23 bytes → ≤ 31 base64url
// characters; a SHA-256 MAC is always 43. Anything else is refused before any
// decoding or hashing is done for it.
const TOKEN_RE = /^[A-Za-z0-9_-]{4,40}\.[A-Za-z0-9_-]{43}$/;
const PAYLOAD_RE = /^([1-9]\d{0,9})\.(\d{10,12})$/;

/** The generation a link names, if it is genuine and has not expired. */
export function verifyHandoff(token: unknown, nowMs = Date.now(), key: string | null = secret()): { genId: number; exp: number } | null {
  if (!key || typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const [encoded, signature] = token.split('.');
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const match = PAYLOAD_RE.exec(payload);
  if (!match) return null;
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(key, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const genId = Number(match[1]);
  const exp = Number(match[2]);
  if (exp * 1000 <= nowMs) return null;
  return { genId, exp };
}

/**
 * Every partner response, the errors included: a 410 without
 * Access-Control-Allow-Origin reaches AquaChord as a bare network failure
 * instead of "this link has expired — send it again".
 *
 * No Allow-Credentials and never `*`: AquaChord fetches with
 * `credentials: 'omit'`, and nobody else is meant to read these.
 */
export function handoffHeaders(init?: Record<string, string>): Headers {
  const headers = new Headers(init);
  headers.set('Access-Control-Allow-Origin', aquachordOrigin());
  headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return headers;
}

/** Same list as /api/studio/audio/[id]: what a finished song can be stored as. */
export const HANDOFF_AUDIO_TYPE: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
};

export interface HandoffRow {
  type: string;
  resultUrl: string | null;
  mediaDeletedAt: Date | null;
}

/**
 * The stored song a generation can hand over, or null: it has to be a song,
 * still on storage, and in a format a browser decodes.
 */
export function handoffAudio(row: HandoffRow): { url: string; ext: string; mime: string } | null {
  if (row.type !== 'audio' || !row.resultUrl || row.mediaDeletedAt) return null;
  const ext = (row.resultUrl.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  if (!Object.hasOwn(HANDOFF_AUDIO_TYPE, ext)) return null;
  return { url: row.resultUrl, ext, mime: HANDOFF_AUDIO_TYPE[ext] };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The song's name: the title the customer gave it, else the first line of the
 * prompt. AquaChord names the file after it, so control characters go.
 */
export function handoffTitle(prompt: string | null, params: unknown): string {
  const given = record(record(params)?.suno)?.title;
  const source = typeof given === 'string' && given.trim()
    ? given
    : (prompt ?? '').split(/\r?\n/).find((line) => line.trim()) ?? '';
  const clean = source.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 120) || 'X-DREAMER song';
}

/**
 * The words as the customer wrote them. Section labels ([Verse], ท่อนฮุก …)
 * stay: AquaChord drops them itself before lining the words up with the audio.
 */
export function handoffLyrics(params: unknown): string {
  // What the song actually sings (Suno writes its own when the box was empty; output-lyrics.ts).
  const sung = record(params)?.outputLyrics;
  if (Array.isArray(sung) && typeof sung[0] === 'string' && sung[0].trim()) {
    return sung[0].replace(/\r\n?/g, '\n').trim().slice(0, 20_000);
  }
  const lyrics = record(params)?.lyrics;
  return typeof lyrics === 'string' ? lyrics.replace(/\r\n?/g, '\n').trim().slice(0, 20_000) : '';
}

/**
 * The language AquaChord should transcribe in: the vocal language picked in the
 * studio when there is one, else a guess from the lyrics' script, with the same
 * thresholds AquaChord applies to pasted lyrics.
 */
export function handoffLang(params: unknown, lyrics: string): 'th' | 'en' | 'auto' {
  const chosen = record(record(params)?.music)?.language;
  if (chosen === 'th' || chosen === 'th_en') return 'th';
  if (chosen === 'en') return 'en';
  if (typeof chosen === 'string' && chosen) return 'auto';
  const thai = (lyrics.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latin = (lyrics.match(/[A-Za-z]/g) || []).length;
  if (thai > latin * 0.3) return 'th';
  if (latin > thai * 3) return 'en';
  return 'auto';
}
