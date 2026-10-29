/**
 * The site's two languages — Thai (default) and English — and everything
 * about them that server, browser and tests share. Pure: no Next, no React.
 *
 * How a string is written: next to its translation, as a pair.
 *   - in a component:   const t = useT();   t("สร้างภาพ", "Create image")
 *   - in a server page: const t = await getT();
 *   - in a constant:    { th: "ภาพ", en: "Image" } as Msg  →  t(msg)
 * Both halves are required, so a string cannot ship in one language only.
 * Never put an API vendor's name in either half (KIE, fal, Replicate, …).
 *
 * The visitor's choice lives in the `aixman-locale` cookie. With no cookie,
 * pages follow Accept-Language, else Thai, and the browser then stores what
 * it was shown (LocaleProvider), so API calls answer in the same language.
 */

export const LOCALES = ['th', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'th';

export const LOCALE_COOKIE = 'aixman-locale';
/** A year: the choice should outlive a session, not a device. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** A string in both languages. `V` lets a pair hold JSX as well as text. */
export type Msg<V = string> = { th: V; en: V };

export function isLocale(value: unknown): value is Locale {
  return value === 'th' || value === 'en';
}

export function isMsg(value: unknown): value is Msg<unknown> {
  return typeof value === 'object' && value !== null && 'th' in value && 'en' in value;
}

/** One language of a pair; a plain string (legacy, or a name) is returned as it is. */
export function pick<V>(value: Msg<V> | V, locale: Locale): V {
  return isMsg(value) ? (value as Msg<V>)[locale] : (value as V);
}

/**
 * The translator handed out by useT() / getT(): two arguments are the Thai and
 * English of the same thing; one argument is a pair (or a plain string, which
 * passes through).
 */
export type Translate = {
  <V>(th: V, en: V): V;
  <V>(msg: Msg<V> | V): V;
};

export function translator(locale: Locale): Translate {
  return ((...args: unknown[]) => (args.length >= 2 ? args[locale === 'en' ? 1 : 0] : pick(args[0], locale))) as Translate;
}

/**
 * The language a first visit gets from its Accept-Language header: whichever
 * of Thai or English it ranks higher, else Thai. `en-US;q=0.8, th;q=0.9` → th.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  let best: { locale: Locale; q: number; order: number } | null = null;
  acceptLanguage.split(',').forEach((part, order) => {
    const [tag, ...params] = part.trim().split(';');
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (!isLocale(primary)) return;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) return;
    if (!best || q > best.q || (q === best.q && order < best.order)) best = { locale: primary, q, order };
  });
  return (best as { locale: Locale } | null)?.locale ?? DEFAULT_LOCALE;
}

/** The locale named by a Cookie header, if it names one. */
export function localeFromCookieHeader(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return isLocale(value) ? value : null;
  }
  return null;
}

/**
 * The language an API answers a request in: the visitor's cookie, else an
 * `X-Locale` header (for app builds that ask), else Thai. Accept-Language is
 * deliberately not read here — the mobile app sends none of the first two and
 * its screens are Thai, while a browser always carries the cookie
 * (LocaleProvider writes it on the first page view).
 */
export function requestLocale(request: Pick<Request, 'headers'>): Locale {
  const fromCookie = localeFromCookieHeader(request.headers.get('cookie'));
  if (fromCookie) return fromCookie;
  const header = request.headers.get('x-locale')?.trim().toLowerCase();
  return isLocale(header) ? header : DEFAULT_LOCALE;
}

// ─── Formatting ─────────────────────────────────────────────────────────
//
// Thai keeps the Buddhist year (พ.ศ. 2569), which is what Thai readers expect
// and what the site always showed. English uses the Gregorian year with the
// day first and the month as a word ("29 Oct 2026"), the same order as the
// Thai and unambiguous to every English reader.

/** The Intl tag each language formats dates and numbers with. */
export const INTL_LOCALE: Record<Locale, string> = { th: 'th-TH', en: 'en-GB' };

export function formatNumber(n: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(INTL_LOCALE[locale], options);
}

export function formatDate(
  date: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  return new Date(date).toLocaleDateString(INTL_LOCALE[locale], options);
}

export function formatDateTime(
  date: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
): string {
  return new Date(date).toLocaleString(INTL_LOCALE[locale], options);
}

/** Baht, as the site writes it in both languages: ฿1,234 (satang only when there are some). */
export function formatThb(n: number, locale: Locale): string {
  return `฿${formatNumber(n, locale, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "1,234 เครดิต" / "1,234 credits" — the unit every price on the site is in. */
export function formatCredits(n: number, locale: Locale): string {
  const num = formatNumber(n, locale);
  return locale === 'en' ? `${num} ${n === 1 ? 'credit' : 'credits'}` : `${num} เครดิต`;
}
