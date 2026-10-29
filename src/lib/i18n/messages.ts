import { isMsg, pick, type Locale, type Msg } from '@/lib/i18n/locale';
import { refusalEn } from '@/lib/i18n/refusal-en';

/**
 * Customer-facing messages that leave the server: thrown in a request and
 * answered in the visitor's language, or stored on a row and read later.
 * Pure — shared by services, routes and tests.
 */

/**
 * An error whose message a customer may read, in both languages. `message`
 * stays the Thai, so logs and any `.message` check read as before; a route
 * answers with `messageFor(error, locale)`.
 */
export class UserMessageError extends Error {
  readonly msg: Msg;

  constructor(msg: Msg) {
    super(msg.th);
    this.name = 'UserMessageError';
    this.msg = msg;
  }
}

/** The pair an error carries, if it carries one (UserMessageError, OrderRefusedError). */
export function errorMsg(error: unknown): Msg | null {
  const msg = (error as { msg?: unknown } | null)?.msg;
  return isMsg(msg) && typeof msg.th === 'string' && typeof msg.en === 'string' ? (msg as Msg) : null;
}

/**
 * An error's text in `locale`: its pair when it has one; else, for English, a
 * known Thai refusal's English (refusal-en.ts); else its message as it is.
 */
export function messageFor(error: unknown, locale: Locale): string {
  const msg = errorMsg(error);
  if (msg) return pick(msg, locale);
  const message = (error as Error | null)?.message ?? '';
  if (locale !== 'en') return message;
  const code = (error as { code?: unknown } | null)?.code;
  return refusalEn(message, typeof code === 'string' ? code : undefined) ?? message;
}

// ─── Stored messages ────────────────────────────────────────────────────
//
// A failure reason written to a row (ai_generations.error_message, a story
// shot's error) is read later, by whoever opens it, in whatever language they
// chose by then. So both languages are stored: the Thai first — what an admin
// screen or a log line shows when it prints the column as it is — then a
// marker and the English. Rows written before this carry Thai only; the
// known ones are matched against the registry below.

const EN_MARK = '\n⟦en⟧ ';

/** The column value for a pair. */
export function packMsg(msg: Msg): string {
  return `${msg.th}${EN_MARK}${msg.en}`;
}

/**
 * Cut a packed value to fit a column: each half keeps its share, so the
 * marker and the English survive a `.slice(0, 1000)`.
 */
export function packMsgWithin(msg: Msg, max: number): string {
  const packed = packMsg(msg);
  if (packed.length <= max) return packed;
  const room = Math.max(0, max - EN_MARK.length);
  const th = msg.th.slice(0, Math.ceil(room / 2));
  return `${th}${EN_MARK}${msg.en.slice(0, room - th.length)}`;
}

/** Messages that were stored Thai-only before packing existed, by their Thai. */
const LEGACY = new Map<string, string>();

/** Teach `readStoredMessage` the English of a Thai message older rows hold. */
export function registerStoredMsgs(...msgs: Msg[]): void {
  for (const m of msgs) LEGACY.set(m.th, m.en);
}

/**
 * A stored message in `locale`. Packed values split; an old Thai-only value is
 * translated when it is a known message (with or without a known suffix),
 * otherwise returned as it is — a vendor's raw text, say.
 */
export function readStoredMessage(stored: string | null | undefined, locale: Locale): string | null {
  if (stored === null || stored === undefined) return null;
  const at = stored.indexOf(EN_MARK);
  if (at >= 0) return locale === 'en' ? stored.slice(at + EN_MARK.length) : stored.slice(0, at);
  if (locale === 'th') return stored;
  const exact = LEGACY.get(stored);
  if (exact !== undefined) return exact;
  // "<known message> (คืนเครดิตแล้ว)" and similar: a known message plus a known tail.
  for (const [th, en] of LEGACY) {
    if (!stored.startsWith(th)) continue;
    const rest = LEGACY.get(stored.slice(th.length).trim());
    if (rest !== undefined) return `${en} ${rest}`;
  }
  return stored;
}

/** Only the Thai of a stored message — for admin screens and alerts. */
export function storedMessageThai(stored: string | null | undefined): string | null {
  return readStoredMessage(stored, 'th');
}
