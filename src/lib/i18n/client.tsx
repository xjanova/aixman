"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, localeFromCookieHeader, translator,
  type Locale, type Translate,
} from "@/lib/i18n/locale";

type LocaleState = { locale: Locale; setLocale: (next: Locale) => void; switching: boolean };

const LocaleContext = createContext<LocaleState>({ locale: DEFAULT_LOCALE, setLocale: () => {}, switching: false });

function writeCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * The visitor's language for every client component, set by the root layout
 * from the cookie (or Accept-Language on a first visit).
 */
export function LocaleProvider({ locale: fromServer, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  // The switch shows at once; the refresh that follows re-renders the server
  // components, after which the server's locale is the same one.
  const [chosen, setChosen] = useState<Locale | null>(null);
  const [switching, startTransition] = useTransition();
  const locale = chosen ?? fromServer;

  // A first visit was shown a negotiated language: store it, so the API calls
  // this page is about to make answer in it too (requestLocale reads only the
  // cookie). A layout effect runs before any child's fetch effect.
  useLayoutEffect(() => {
    if (!localeFromCookieHeader(document.cookie)) writeCookie(fromServer);
  }, [fromServer]);

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      switching,
      setLocale: (next: Locale) => {
        writeCookie(next);
        document.documentElement.lang = next;
        setChosen(next);
        startTransition(() => router.refresh());
      },
    }),
    [locale, switching, router]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** `{ locale, setLocale, switching }`. */
export function useLocale(): LocaleState {
  return useContext(LocaleContext);
}

/** The translator: `t("ไทย", "English")`, or `t(msg)` for a `{ th, en }` pair. */
export function useT(): Translate {
  const { locale } = useContext(LocaleContext);
  return useMemo(() => translator(locale), [locale]);
}
