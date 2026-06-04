/**
 * /about — เกี่ยวกับ X-DREAMER
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "เกี่ยวกับเรา · X-DREAMER",
  description: "X-DREAMER แพลตฟอร์มสร้างภาพและวิดีโอด้วย AI รวมผู้ให้บริการชั้นนำไว้ในที่เดียว",
};

const FEATURES = [
  { t: "ภาพจากข้อความ", d: "Seedream, FLUX, GPT Image, Stable Diffusion และอื่น ๆ" },
  { t: "วิดีโอจากข้อความ/ภาพ", d: "Seedance, Sora, Kling, Runway, Luma" },
  { t: "แก้ไข & ขยายภาพ", d: "image-to-image และ upscale คมชัดหลายเท่า" },
  { t: "ระบบเครดิตเดียว", d: "หมุน API key อัตโนมัติ คืนเครดิตเมื่อสร้างไม่สำเร็จ" },
];

export default function AboutPage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 24px 80px", color: "#e2e8f0" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 12 }}>· เกี่ยวกับเรา</div>
      <h1 style={{ fontSize: "clamp(36px,5.5vw,60px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", margin: 0, lineHeight: 1.05 }}>
        ทอความฝัน <span className="xdr-italic-th" style={{ fontStyle: "italic", color: "#c4b5fd" }}>ด้วย AI</span>
      </h1>
      <p style={{ marginTop: 20, fontSize: 17, lineHeight: 1.6, color: "rgba(203,213,225,0.8)", fontWeight: 300, maxWidth: 680 }}>
        X-DREAMER คือแพลตฟอร์มสร้างสรรค์ด้วย AI ที่รวมโมเดลภาพและวิดีโอชั้นนำจาก 9 ผู้ให้บริการไว้ในอินเทอร์เฟซเดียว
        คุณไม่ต้องสมัครและจัดการ API หลายเจ้า — เลือกโมเดล พิมพ์ไอเดีย แล้วจ่ายด้วยเครดิตเดียว
      </p>

      <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {FEATURES.map((f, i) => (
          <div key={i} style={{ padding: 22, borderRadius: 16, background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(18px)" }}>
            <div style={{ fontSize: 16, color: "#fff", fontWeight: 500, marginBottom: 8 }}>{f.t}</div>
            <div style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", lineHeight: 1.6 }}>{f.d}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 44, padding: 28, borderRadius: 20, background: "linear-gradient(160deg, hsla(290,60%,22%,0.5), hsla(220,60%,15%,0.5))", border: "1px solid hsla(290,70%,55%,0.3)", textAlign: "center" }}>
        <div style={{ fontSize: 20, color: "#fff", fontWeight: 400, marginBottom: 14 }}>พร้อมเริ่มทอความฝันแรกของคุณแล้วหรือยัง?</div>
        <Link href="/generate" style={{ display: "inline-block", padding: "13px 30px", borderRadius: 12, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)", color: "#fff", textDecoration: "none", fontSize: 15, fontWeight: 600 }}>
          เริ่มสร้างเลย →
        </Link>
      </div>
    </div>
  );
}
