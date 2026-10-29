"use client";

/**
 * /login — auth (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER `AuthPage` reference: centered card with
 * X-DREAMER logo + glow, form fields styled to match Studio inputs.
 *
 * Preserves the same NextAuth credentials flow + redirect.
 */

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { XdreamerMark } from "@/components/xdreamer/logo";
import { safeCallbackPath } from "@/lib/safe-callback";
import { useT } from "@/lib/i18n/client";
import { LocaleSwitch } from "@/components/layout/locale-switch";
import type { Msg } from "@/lib/i18n/locale";

const HUE = 70;
const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

/**
 * What each `?xman_error=` code means to a customer. Deliberately vague about
 * the internals — "upstream" and "invalid" are our problem, not something they
 * can act on beyond trying again.
 */
const XMAN_ERRORS: Record<string, Msg> = {
  unavailable: {
    th: "ระบบเข้าสู่ระบบด้วย XMAN ID ยังไม่พร้อมใช้งาน กรุณาใช้อีเมลและรหัสผ่าน",
    en: "Sign-in with XMAN ID isn't available right now. Please use your email and password.",
  },
  expired: {
    th: "ลิงก์เข้าสู่ระบบหมดอายุแล้ว กรุณาลองใหม่อีกครั้ง",
    en: "Your sign-in link has expired. Please try again.",
  },
  upstream: {
    th: "ติดต่อ xman4289.com ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    en: "We couldn't reach xman4289.com. Please try again.",
  },
  inactive: {
    th: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบริการลูกค้า",
    en: "This account has been suspended. Please contact customer support.",
  },
  invalid: {
    th: "เข้าสู่ระบบด้วย XMAN ID ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    en: "Sign-in with XMAN ID didn't work. Please try again.",
  },
};

const BAD_PASSWORD: Msg = { th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง", en: "Incorrect email or password." };

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The message as a pair, not a string, so switching language re-reads it.
  const [error, setError] = useState<Msg | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);

  // Read ?signup=1 client-side (avoids needing a Suspense boundary for useSearchParams).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSignup(new URLSearchParams(window.location.search).get("signup") === "1");
  }, []);

  /**
   * Finish "Sign in with XMAN ID".
   *
   * /api/auth/xman/callback has already proved who this is, server to server,
   * and left a single-use ticket on the URL. All that is left is to trade it for
   * a NextAuth session — which only the browser can do.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const failure = params.get("xman_error");
    if (failure) {
      // Own keys only: `?xman_error=constructor` must not reach Object.prototype.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(Object.hasOwn(XMAN_ERRORS, failure) ? XMAN_ERRORS[failure] : XMAN_ERRORS.invalid);
      // Drop the error code, keep the way back for the password form.
      const back = params.get("callbackUrl");
      window.history.replaceState({}, "", back ? `/login?callbackUrl=${encodeURIComponent(back)}` : "/login");
      return;
    }

    const ticket = params.get("xman_ticket");
    if (!ticket) return;

    const destination = safeCallbackPath(params.get("callbackUrl"));
    // Strip the ticket before anything can put it in history or a Referer.
    window.history.replaceState({}, "", "/login");

    setSsoBusy(true);
    signIn("xman-sso", { ticket, redirect: false }).then((result) => {
      if (result?.error) {
        setSsoBusy(false);
        setError(XMAN_ERRORS.expired);
        return;
      }
      router.push(destination);
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) setError(BAD_PASSWORD);
    else router.push(safeCallbackPath(new URLSearchParams(window.location.search).get("callbackUrl")));
  };

  return (
    <div className="xdr-auth">
      <div className="xdr-auth-form">
      <div style={{
        width: "100%", maxWidth: 440, padding: 40, borderRadius: 24,
        background: "rgba(15,23,42,0.65)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(18px)",
        boxShadow: "0 40px 80px -20px rgba(0,0,0,0.7)",
      }}>
        {/* No navbar here, so the language switch sits on the card. */}
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "-16px -16px 8px 0" }}>
          <LocaleSwitch />
        </div>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Link href="/" style={{ display: "inline-block" }}>
            <span style={{ display: "block", width: 64, margin: "0 auto 16px", filter: `drop-shadow(0 0 22px hsla(${270 + HUE},70%,55%,0.55))` }}>
              <XdreamerMark size={64} title="X-DREAMER" />
            </span>
          </Link>
          <div style={{ fontSize: 22, color: "#fff", fontWeight: 300, letterSpacing: "-0.01em" }}>
            {isSignup ? (
              <>{t("เริ่มต้น", "Start")}<span className="xdr-italic-th" style={{ fontStyle: "italic", color: `hsl(${220 + HUE},70%,75%)`, marginLeft: 6 }}>{t("ฟรี", "free")}</span></>
            ) : (
              <>{t("ยินดีต้อนรับ", "Welcome")}<span className="xdr-italic-th" style={{ fontStyle: "italic", color: `hsl(${220 + HUE},70%,75%)`, marginLeft: 6 }}>{t("กลับมา", "back")}</span></>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>
            {t("ใช้บัญชีเดียวกับ", "Use the same account as")}{" "}
            <a href={XMAN_URL} style={{ color: "#a5f3fc", textDecoration: "none" }} target="_blank" rel="noopener noreferrer">xman4289.com</a>
          </div>
        </div>

        {isSignup && (
          <div style={{ marginBottom: 18, padding: "14px 16px", borderRadius: 12, background: `hsla(${160 + HUE},60%,30%,0.18)`, border: `1px solid hsla(${160 + HUE},60%,55%,0.3)` }}>
            <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 10, lineHeight: 1.5 }}>
              {t(
                <>บัญชีใช้ร่วมกับ XMAN Studio — สมัครฟรีที่นั่นแล้วรับ <strong style={{ color: "#a5f3fc" }}>เครดิตต้อนรับ</strong> ทันที</>,
                <>Your account is shared with XMAN Studio — sign up there for free and get <strong style={{ color: "#a5f3fc" }}>welcome credits</strong> right away.</>
              )}
            </div>
            <a href={`${XMAN_URL}/register`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 10, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)", color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              {t("สร้างบัญชีฟรีที่ XMAN Studio →", "Create a free account at XMAN Studio →")}
            </a>
          </div>
        )}

        {/* One click for anyone already signed in at xman4289.com — no password
            to retype, and no second account to keep track of. */}
        {/* A real document navigation, not a Link: /api/auth/xman/start answers
            with a 302 to xman4289.com, and client-side routing cannot follow a
            redirect off this origin. */}
        <button type="button" disabled={ssoBusy}
          onClick={() => {
            setSsoBusy(true);
            // The start route checks this again and carries it through xman4289.com.
            const back = new URLSearchParams(window.location.search).get("callbackUrl");
            window.location.href = back ? `/api/auth/xman/start?callbackUrl=${encodeURIComponent(back)}` : "/api/auth/xman/start";
          }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            width: "100%", padding: "13px 0", borderRadius: 12,
            background: "rgba(2,6,23,0.5)", border: `1px solid hsla(${220 + HUE},70%,65%,0.35)`,
            color: "#e2e8f0", fontSize: 14, fontWeight: 600, fontFamily: "inherit",
            cursor: ssoBusy ? "wait" : "pointer", opacity: ssoBusy ? 0.6 : 1,
          }}>
          <span aria-hidden style={{ color: "#a5f3fc", fontWeight: 800, letterSpacing: 1 }}>X</span>
          {ssoBusy ? t("กำลังเข้าสู่ระบบ...", "Signing in...") : t("เข้าสู่ระบบด้วย XMAN ID", "Sign in with XMAN ID")}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: 11, color: "#64748b" }}>{t("หรือใช้อีเมล", "or use your email")}</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {isSignup && (
            <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>{t("มีบัญชีอยู่แล้ว? เข้าสู่ระบบด้านล่าง", "Already have an account? Sign in below.")}</div>
          )}
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>{t("อีเมล", "Email")}</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com" required
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.04em" }}>{t("รหัสผ่าน", "Password")}</div>
              <a href={`${XMAN_URL}/forgot-password`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#a5f3fc", textDecoration: "none" }}>{t("ลืมรหัสผ่าน?", "Forgot password?")}</a>
            </div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13, textAlign: "center" }}>
              {t(error)}
            </div>
          )}

          <button type="submit" disabled={loading}
            style={{
              marginTop: 10, padding: 14, borderRadius: 12,
              background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`,
              color: "#fff", border: "none", fontSize: 14, fontWeight: 600,
              cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1,
              boxShadow: `0 12px 30px -10px hsla(${270 + HUE},70%,50%,0.55)`,
            }}>
            {loading ? t("⟳ กำลังเข้าสู่ระบบ...", "⟳ Signing in...") : t("เข้าสู่ระบบ →", "Sign in →")}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          {t("ยังไม่มีบัญชี?", "No account yet?")}{" "}
          <a href="https://xman4289.com/register" target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>
            {t("สมัครที่ XMAN Studio →", "Sign up at XMAN Studio →")}
          </a>
        </div>
      </div>
      </div>

      {/* Showcase panel — a real generated frame, so the first screen a visitor
          sees is the product's own output. Hidden on narrow screens where the
          form should own the viewport. */}
      <aside className="xdr-auth-art">
        <Image src="/showcase/login-panel.jpg" alt="" fill priority sizes="50vw" style={{ objectFit: "cover" }} />
        <div className="xdr-auth-art-scrim" />
        <div className="xdr-auth-art-copy">
          <div className="xdr-auth-quote">
            {t("ทุกภาพในเว็บนี้", "Every picture on this site")}<br />
            <span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, background: "linear-gradient(120deg, hsl(230,85%,75%), hsl(300,85%,80%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {t("สร้างที่นี่ทั้งหมด", "was made right here")}
            </span>
          </div>
          <div className="xdr-auth-stats">
            {[
              { v: "9", l: t("ผู้ให้บริการ", "providers") },
              { v: "17+", l: t("โมเดล", "models") },
              { v: "1", l: t("ระบบเครดิต", "credit system") },
            ].map((s) => (
              <div key={s.l}>
                <div className="xdr-auth-stat-v">{s.v}</div>
                <div className="xdr-auth-stat-l">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
