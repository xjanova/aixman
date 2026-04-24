"use client";

/**
 * /login — auth (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER `AuthPage` reference: centered card with
 * X-DREAMER logo + glow, form fields styled to match Studio inputs.
 *
 * Preserves the same NextAuth credentials flow + redirect.
 */

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

const HUE = 70;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "60px 24px 40px", color: "#f1f5f9" }}>
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
            ยินดีต้อนรับ<span className="xdr-italic-th" style={{ fontStyle: "italic", color: `hsl(${220 + HUE},70%,75%)`, marginLeft: 6 }}>กลับมา</span>
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>
            ใช้บัญชีเดียวกับ{" "}
            <a href="https://xman4289.com" style={{ color: "#a5f3fc", textDecoration: "none" }} target="_blank" rel="noopener noreferrer">xman4289.com</a>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>อีเมล</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com" required
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
          </div>

          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>รหัสผ่าน</div>
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
  );
}
