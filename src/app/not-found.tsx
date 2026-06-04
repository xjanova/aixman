/**
 * Custom 404 — keeps the X-DREAMER identity and offers a way back.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "60px 24px", color: "#e2e8f0", textAlign: "center" }}>
      <div style={{ maxWidth: 480 }}>
        <div style={{ fontSize: "clamp(80px,18vw,160px)", fontWeight: 200, lineHeight: 1, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          404
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 300, color: "#fff", marginTop: 8 }}>ไม่พบหน้านี้</h1>
        <p style={{ fontSize: 14, color: "rgba(203,213,225,0.7)", marginTop: 12, lineHeight: 1.6 }}>
          หน้าที่คุณค้นหาอาจถูกย้าย ลบ หรือไม่เคยมีอยู่ — ลองกลับไปเริ่มต้นใหม่
        </p>
        <div style={{ marginTop: 28, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" style={{ padding: "12px 26px", borderRadius: 12, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)", color: "#fff", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
            กลับหน้าแรก
          </Link>
          <Link href="/generate" style={{ padding: "12px 26px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#e2e8f0", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            ไปที่สตูดิโอ
          </Link>
        </div>
      </div>
    </div>
  );
}
