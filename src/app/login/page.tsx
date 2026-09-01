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

const HUE = 70;
const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

/**
 * What each `?xman_error=` code means to a customer. Deliberately vague about
 * the internals — "upstream" and "invalid" are our problem, not something they
 * can act on beyond trying again.
 */
const XMAN_ERRORS: Record<string, string> = {
  unavailable: "ระบบเข้าสู่ระบบด้วย XMAN ID ยังไม่พร้อมใช้งาน กรุณาใช้อีเมลและรหัสผ่าน",
  expired: "ลิงก์เข้าสู่ระบบหมดอายุแล้ว กรุณาลองใหม่อีกครั้ง",
  upstream: "ติดต่อ xman4289.com ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  inactive: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบริการลูกค้า",
  invalid: "เข้าสู่ระบบด้วย XMAN ID ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(XMAN_ERRORS[failure] ?? XMAN_ERRORS.invalid);
      window.history.replaceState({}, "", "/login");
      return;
    }

    const ticket = params.get("xman_ticket");
    if (!ticket) return;

    const destination = params.get("callbackUrl") || "/generate";
    // Strip the ticket before anything can put it in history or a Referer.
    window.history.replaceState({}, "", "/login");

    setSsoBusy(true);
    signIn("xman-sso", { ticket, redirect: false }).then((result) => {
      if (result?.error) {
        setSsoBusy(false);
        setError(XMAN_ERRORS.expired);
        return;
      }
      router.push(destination.startsWith("/") && !destination.startsWith("//") ? destination : "/generate");
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    else router.push("/generate");
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
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Link href="/" style={{ display: "inline-block" }}>
            <Image src="/xdreamer-logo.png" alt="X-DREAMER" width={64} height={64}
              style={{ borderRadius: 16, margin: "0 auto 16px", boxShadow: `0 0 50px hsla(${270 + HUE},70%,50%,0.55)`, objectFit: "cover" }} />
          </Link>
          <div style={{ fontSize: 22, color: "#fff", fontWeight: 300, letterSpacing: "-0.01em" }}>
            {isSignup ? (
              <>เริ่มต้น<span className="xdr-italic-th" style={{ fontStyle: "italic", color: `hsl(${220 + HUE},70%,75%)`, marginLeft: 6 }}>ฟรี</span></>
            ) : (
              <>ยินดีต้อนรับ<span className="xdr-italic-th" style={{ fontStyle: "italic", color: `hsl(${220 + HUE},70%,75%)`, marginLeft: 6 }}>กลับมา</span></>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>
            ใช้บัญชีเดียวกับ{" "}
            <a href={XMAN_URL} style={{ color: "#a5f3fc", textDecoration: "none" }} target="_blank" rel="noopener noreferrer">xman4289.com</a>
          </div>
        </div>

        {isSignup && (
          <div style={{ marginBottom: 18, padding: "14px 16px", borderRadius: 12, background: `hsla(${160 + HUE},60%,30%,0.18)`, border: `1px solid hsla(${160 + HUE},60%,55%,0.3)` }}>
            <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 10, lineHeight: 1.5 }}>
              บัญชีใช้ร่วมกับ XMAN Studio — สมัครฟรีที่นั่นแล้วรับ <strong style={{ color: "#a5f3fc" }}>เครดิตต้อนรับ</strong> ทันที
            </div>
            <a href={`${XMAN_URL}/register`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 10, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)", color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              สร้างบัญชีฟรีที่ XMAN Studio →
            </a>
          </div>
        )}

        {/* One click for anyone already signed in at xman4289.com — no password
            to retype, and no second account to keep track of. */}
        {/* A real document navigation, not a Link: /api/auth/xman/start answers
            with a 302 to xman4289.com, and client-side routing cannot follow a
            redirect off this origin. */}
        <button type="button" disabled={ssoBusy}
          onClick={() => { setSsoBusy(true); window.location.href = "/api/auth/xman/start"; }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            width: "100%", padding: "13px 0", borderRadius: 12,
            background: "rgba(2,6,23,0.5)", border: `1px solid hsla(${220 + HUE},70%,65%,0.35)`,
            color: "#e2e8f0", fontSize: 14, fontWeight: 600, fontFamily: "inherit",
            cursor: ssoBusy ? "wait" : "pointer", opacity: ssoBusy ? 0.6 : 1,
          }}>
          <span aria-hidden style={{ color: "#a5f3fc", fontWeight: 800, letterSpacing: 1 }}>X</span>
          {ssoBusy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบด้วย XMAN ID"}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: 11, color: "#64748b" }}>หรือใช้อีเมล</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {isSignup && (
            <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>มีบัญชีอยู่แล้ว? เข้าสู่ระบบด้านล่าง</div>
          )}
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>อีเมล</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com" required
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.04em" }}>รหัสผ่าน</div>
              <a href={`${XMAN_URL}/forgot-password`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#a5f3fc", textDecoration: "none" }}>ลืมรหัสผ่าน?</a>
            </div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13, textAlign: "center" }}>
              {error}
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
            {loading ? "⟳ กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ →"}
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          ยังไม่มีบัญชี?{" "}
          <a href="https://xman4289.com/register" target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>
            สมัครที่ XMAN Studio →
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
            ทุกภาพในเว็บนี้<br />
            <span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, background: "linear-gradient(120deg, hsl(230,85%,75%), hsl(300,85%,80%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              สร้างที่นี่ทั้งหมด
            </span>
          </div>
          <div className="xdr-auth-stats">
            {[
              { v: "9", l: "ผู้ให้บริการ" },
              { v: "17+", l: "โมเดล" },
              { v: "1", l: "ระบบเครดิต" },
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
