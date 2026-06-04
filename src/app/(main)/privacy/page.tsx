/**
 * /privacy — นโยบายความเป็นส่วนตัว (Privacy Policy)
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "นโยบายความเป็นส่วนตัว · X-DREAMER",
  description: "นโยบายความเป็นส่วนตัวและการจัดการข้อมูลของ X-DREAMER",
};

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

const SECTIONS: { h: string; body: string[] }[] = [
  {
    h: "1. ข้อมูลที่เราเก็บ",
    body: [
      "ข้อมูลบัญชี: ชื่อ อีเมล และข้อมูลโปรไฟล์ — ใช้ร่วมกับบัญชี XMAN Studio (xman4289.com)",
      "ข้อมูลการใช้งาน: prompt ที่คุณป้อน ผลงานที่สร้าง ประวัติเครดิต และบันทึกการใช้งานโมเดล",
      "เราไม่เก็บข้อมูลการชำระเงิน (บัตร/บัญชี) — การชำระเงินดำเนินการผ่านระบบของ XMAN Studio",
    ],
  },
  {
    h: "2. การใช้ข้อมูล",
    body: [
      "เพื่อให้บริการสร้างผลงาน หักและคืนเครดิต และแสดงประวัติในแกลเลอรีของคุณ",
      "เพื่อปรับปรุงความเสถียรของระบบ เช่น การวิเคราะห์อัตราความสำเร็จและการหมุน API key",
      "เราไม่ขายข้อมูลส่วนบุคคลของคุณให้บุคคลภายนอก",
    ],
  },
  {
    h: "3. การส่งข้อมูลให้ผู้ให้บริการ AI",
    body: [
      "prompt และภาพต้นทางที่คุณส่ง จะถูกส่งต่อไปยังผู้ให้บริการโมเดลที่คุณเลือก (เช่น OpenAI, Stability, Replicate ฯลฯ) เพื่อสร้างผลงาน",
      "การประมวลผลฝั่งผู้ให้บริการเป็นไปตามนโยบายความเป็นส่วนตัวของแต่ละราย",
    ],
  },
  {
    h: "4. ความปลอดภัย",
    body: [
      "API key ของระบบถูกเข้ารหัสด้วย AES-256-GCM ก่อนจัดเก็บ",
      "รหัสผ่านถูกแฮชด้วย bcrypt และจัดการโดยระบบบัญชีของ XMAN Studio",
    ],
  },
  {
    h: "5. สิทธิ์ของคุณ",
    body: [
      "คุณสามารถขอเข้าถึง แก้ไข หรือลบข้อมูลบัญชีได้ผ่าน XMAN Studio",
      "การลบบัญชีจะลบผลงานและประวัติที่เกี่ยวข้องในแพลตฟอร์มนี้",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "30px 24px 80px", color: "#e2e8f0" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 12 }}>· เอกสารทางกฎหมาย</div>
      <h1 style={{ fontSize: "clamp(34px,5vw,52px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", margin: 0 }}>นโยบายความเป็นส่วนตัว</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginTop: 10 }}>ปรับปรุงล่าสุด: มิถุนายน 2026</p>

      <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 20 }}>
        {SECTIONS.map((s, i) => (
          <section key={i} style={{ padding: 24, borderRadius: 16, background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(18px)" }}>
            <h2 style={{ fontSize: 18, color: "#fff", fontWeight: 500, marginTop: 0, marginBottom: 12 }}>{s.h}</h2>
            {s.body.map((p, j) => (
              <p key={j} style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(203,213,225,0.85)", margin: "0 0 10px" }}>{p}</p>
            ))}
          </section>
        ))}
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: "#94a3b8" }}>
        ต้องการจัดการข้อมูลบัญชี? ไปที่ <a href={XMAN_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>XMAN Studio</a>
        {" "}หรือดู <Link href="/terms" style={{ color: "#a5f3fc", textDecoration: "none" }}>ข้อกำหนดการใช้งาน</Link>
      </p>
    </div>
  );
}
