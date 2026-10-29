import { cookies, headers } from 'next/headers';
import { isLocale, LOCALE_COOKIE, negotiateLocale, translator, type Locale, type Translate } from '@/lib/i18n/locale';

/**
 * The visitor's language in a server component, layout or generateMetadata:
 * their cookie, else their browser's Accept-Language, else Thai.
 * (Route handlers answer with `requestLocale(request)` from locale.ts.)
 */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale((await headers()).get('accept-language'));
}

/** The translator for this request: `t("ไทย", "English")` or `t(msg)`. */
export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
