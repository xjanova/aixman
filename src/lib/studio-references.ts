/**
 * Several reference pictures in one studio order, and what each one is.
 *
 * The customer numbers them "ภาพ 1", "ภาพ 2" … in their own prompt and tags
 * each with a role (a character, an outfit, a place …). The model only reads
 * the pictures by the order they are sent in (Seedream's `image` array,
 * gpt-image's `image[]`), so the roles travel as a block of plain lines after
 * the prompt — the same "Image N is …" form the movie studio's opening
 * pictures use (story/library.ts keyframePrompt), with the Thai number beside
 * the English one so "ภาพ 2" in the customer's words points at the right file.
 *
 * The block is part of the stored prompt, so reopening the order must take it
 * off again (`splitReferencePrompt`) or the next order would carry it twice.
 * Both directions live here, next to each other, for that reason.
 */

import type { Locale, Msg } from '@/lib/i18n/locale';

export type ReferenceRole = 'character' | 'outfit' | 'object' | 'place' | 'style' | 'other';

/** `label` is what the customer reads (both languages); `line` is prompt text the model reads — never translated. */
export const REFERENCE_ROLES: { id: ReferenceRole; label: Msg; line: string }[] = [
  { id: 'character', label: { th: 'ตัวละคร', en: 'Character' }, line: 'is the person: keep exactly this face, hair and body.' },
  { id: 'outfit', label: { th: 'ชุด', en: 'Outfit' }, line: 'is the outfit: dress the person in exactly these clothes.' },
  { id: 'object', label: { th: 'สิ่งของ', en: 'Object' }, line: 'is an object: keep its exact shape, design and colours.' },
  { id: 'place', label: { th: 'สถานที่', en: 'Place' }, line: 'is the place: keep its architecture, layout and colours.' },
  { id: 'style', label: { th: 'สไตล์', en: 'Style' }, line: 'is the style: match its look, colours and lighting.' },
  { id: 'other', label: { th: 'อื่น ๆ', en: 'Other' }, line: 'is a reference.' },
];

/** The role a new picture starts with: the first is usually who is in it. */
export function defaultRole(index: number): ReferenceRole {
  return index === 0 ? 'character' : 'other';
}

/** The next role when the customer taps a picture's label. */
export function nextRole(role: ReferenceRole): ReferenceRole {
  const i = REFERENCE_ROLES.findIndex((r) => r.id === role);
  return REFERENCE_ROLES[(i + 1) % REFERENCE_ROLES.length].id;
}

/** A role's label in both languages (render it with `t()`). */
export function roleLabel(role: ReferenceRole): Msg {
  return (REFERENCE_ROLES.find((r) => r.id === role) ?? REFERENCE_ROLES[REFERENCE_ROLES.length - 1]).label;
}

/**
 * The token the customer types (or inserts) to point at picture `n` (1-based),
 * in their language. Both forms point at the same picture: the block below
 * names each one as "Image N (ภาพ N)". The block itself always uses the Thai
 * default, so stored prompts keep parsing.
 */
export function referenceToken(n: number, locale: Locale = 'th'): string {
  return locale === 'en' ? `Image ${n}` : `ภาพ ${n}`;
}

const HEADER = 'References:';
const LINE = /^Image (\d+) \(ภาพ \1\) (.+)$/;

/**
 * The prompt the model gets: the customer's words, then one line per picture
 * in the order the pictures are sent. Nothing is added without pictures.
 */
export function composeReferencePrompt(prompt: string, roles: ReferenceRole[]): string {
  const text = prompt.trim();
  if (roles.length === 0) return text;
  const lines = roles.map((role, i) => {
    const r = REFERENCE_ROLES.find((x) => x.id === role) ?? REFERENCE_ROLES[REFERENCE_ROLES.length - 1];
    return `Image ${i + 1} (${referenceToken(i + 1)}) ${r.line}`;
  });
  return `${text}\n\n${HEADER}\n${lines.join('\n')}`;
}

/**
 * A stored prompt back into the customer's words and the roles it was sent
 * with. A prompt without a block — or with anything that is not exactly the
 * block `composeReferencePrompt` writes — comes back untouched, roles null.
 */
export function splitReferencePrompt(stored: string): { prompt: string; roles: ReferenceRole[] | null } {
  const at = stored.lastIndexOf(`\n\n${HEADER}\n`);
  if (at < 0) return { prompt: stored, roles: null };
  const lines = stored.slice(at + HEADER.length + 3).split('\n');
  const roles: ReferenceRole[] = [];
  for (const [i, line] of lines.entries()) {
    const m = LINE.exec(line);
    if (!m || Number(m[1]) !== i + 1) return { prompt: stored, roles: null };
    const role = REFERENCE_ROLES.find((r) => r.line === m[2]);
    if (!role) return { prompt: stored, roles: null };
    roles.push(role.id);
  }
  return roles.length > 0 ? { prompt: stored.slice(0, at), roles } : { prompt: stored, roles: null };
}
