"use client";

import { useLocale } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/locale";

const LABEL: Record<Locale, string> = { th: "TH", en: "EN" };
const NAME: Record<Locale, string> = { th: "ภาษาไทย", en: "English" };

/**
 * TH | EN — the language switch in every nav. The choice is a cookie
 * (LocaleProvider), so it holds across pages, visits and the API's answers.
 */
export function LocaleSwitch({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { locale, setLocale, switching } = useLocale();
  const lg = size === "lg";
  return (
    <div
      role="group"
      aria-label="Language / ภาษา"
      style={{
        display: "inline-flex", alignItems: "center", padding: 2, borderRadius: 999,
        background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
        opacity: switching ? 0.7 : 1, transition: "opacity 150ms",
      }}
    >
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            title={NAME[l]}
            aria-label={NAME[l]}
            aria-pressed={active}
            onClick={() => { if (!active) setLocale(l); }}
            style={{
              minWidth: lg ? 52 : 34, padding: lg ? "8px 14px" : "4px 9px", borderRadius: 999, border: "none",
              fontFamily: "inherit", fontSize: lg ? 14 : 11, fontWeight: 600, letterSpacing: "0.06em",
              cursor: active ? "default" : "pointer",
              color: active ? "#030612" : "rgba(226,232,240,0.75)",
              background: active ? "linear-gradient(135deg, #a5f3fc, #c4b5fd)" : "transparent",
              transition: "background 150ms, color 150ms",
            }}
          >
            {LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}
