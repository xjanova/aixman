/**
 * /contact — ติดต่อเรา
 *
 * Support, billing and account management live on XMAN Studio (shared accounts),
 * so this page routes users to the real channels rather than a dead form.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ติดต่อเรา · X-DREAMER",
  description: "ช่องทางการติดต่อและการสนับสนุนของ X-DREAMER",
};

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

const CHANNELS = [
  {
    t: "บัญชี & การชำระเงิน",
    d: "จัดการบัญชี เครดิต และใบเสร็จผ่าน XMAN Studio ซึ่งดูแลระบบบัญชีและการชำระเงิน",
    cta: "ไปที่ XMAN Studio",
    href: `${XMAN_URL}`,
    external: true,
  },
  {
    t: "ปัญหาการใช้งาน",
    d: "พบปัญหาการสร้างผลงาน เครดิตไม่เข้า หรือผลลัพธ์ผิดพลาด? ส่งรายละเอียดมาที่ทีมงานผ่านศูนย์ช่วยเหลือ",
    cta: "ศูนย์ช่วยเหลือ XMAN",
    href: `${XMAN_URL}/contact`,
    external: true,
  },
];

export default function ContactPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "30px 24px 80px", color: "#e2e8f0" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 12 }}>· ติดต่อเรา</div>
      <h1 style={{ fontSize: "clamp(34px,5vw,52px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", margin: 0 }}>เราพร้อมช่วยเหลือ</h1>
      <p style={{ marginTop: 18, fontSize: 16, lineHeight: 1.6, color: "rgba(203,213,225,0.8)", fontWeight: 300 }}>
        บัญชีผู้ใช้และการชำระเงินของ X-DREAMER ใช้ร่วมกับ XMAN Studio — เลือกช่องทางที่เหมาะกับเรื่องของคุณด้านล่าง
      </p>

      <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 16 }}>
        {CHANNELS.map((c, i) => (
          <div key={i} style={{ padding: 24, borderRadius: 16, background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(18px)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, color: "#fff", fontWeight: 500, marginBottom: 6 }}>{c.t}</div>
              <div style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", lineHeight: 1.6 }}>{c.d}</div>
            </div>
            <a href={c.href} target="_blank" rel="noopener noreferrer"
              style={{ flexShrink: 0, padding: "11px 20px", borderRadius: 10, background: "rgba(165,243,252,0.1)", border: "1px solid rgba(165,243,252,0.25)", color: "#a5f3fc", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
              {c.cta} →
            </a>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: "#94a3b8" }}>
        อยากเริ่มสร้างเลย? ไปที่ <Link href="/generate" style={{ color: "#a5f3fc", textDecoration: "none" }}>สตูดิโอ</Link> ·
        {" "}ดู <Link href="/pricing" style={{ color: "#a5f3fc", textDecoration: "none" }}>แพ็กเกจเครดิต</Link>
      </p>
    </div>
  );
}
