/**
 * /terms — ข้อกำหนดการใช้งาน (Terms of Service)
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ข้อกำหนดการใช้งาน · X-DREAMER",
  description: "ข้อกำหนดและเงื่อนไขการใช้งานแพลตฟอร์ม AI ของ X-DREAMER",
};

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

const SECTIONS: { h: string; body: string[] }[] = [
  {
    h: "1. การยอมรับข้อกำหนด",
    body: [
      "การเข้าใช้งาน X-DREAMER ถือว่าคุณยอมรับข้อกำหนดเหล่านี้ทั้งหมด หากไม่ยอมรับ กรุณางดใช้งานบริการ",
      "บัญชีผู้ใช้เป็นบัญชีเดียวกับ XMAN Studio (xman4289.com) — การสมัคร การชำระเงิน และการจัดการบัญชีดำเนินการผ่าน XMAN Studio",
    ],
  },
  {
    h: "2. เครดิตและการชำระเงิน",
    body: [
      "การสร้างผลงานแต่ละครั้งจะหักเครดิตตามอัตราของแต่ละโมเดล หากการสร้างล้มเหลว ระบบจะคืนเครดิตให้อัตโนมัติ",
      "เครดิตซื้อผ่าน XMAN Studio ไม่มีวันหมดอายุ และไม่สามารถขอคืนเป็นเงินสดได้ เว้นแต่กรณีที่กฎหมายกำหนด",
      "ราคาแพ็กเกจและอัตราเครดิตอาจปรับเปลี่ยนได้ โดยจะมีผลกับการซื้อครั้งถัดไปเท่านั้น",
    ],
  },
  {
    h: "3. การใช้งานที่ยอมรับได้",
    body: [
      "ห้ามใช้บริการสร้างเนื้อหาที่ผิดกฎหมาย ละเมิดลิขสิทธิ์ เนื้อหาที่เป็นอันตราย หรือละเมิดสิทธิ์ของผู้อื่น",
      "ห้ามใช้บริการเพื่อสร้างเนื้อหาที่แอบอ้างเป็นบุคคลอื่นโดยมิชอบ หรือเนื้อหาที่หลอกลวง",
      "เราขอสงวนสิทธิ์ระงับบัญชีที่ละเมิดข้อกำหนดโดยไม่คืนเครดิต",
    ],
  },
  {
    h: "4. สิทธิ์ในผลงาน",
    body: [
      "ผลงานที่คุณสร้างขึ้นเป็นของคุณภายใต้ขอบเขตที่ผู้ให้บริการโมเดลต้นทางอนุญาต คุณรับผิดชอบต่อการนำไปใช้",
      "เราอาจเก็บผลงานไว้ในแกลเลอรีส่วนตัวของคุณเพื่อให้คุณเข้าถึงย้อนหลังได้",
    ],
  },
  {
    h: "5. ข้อจำกัดความรับผิด",
    body: [
      "บริการให้ตามสภาพ (as-is) ผลลัพธ์จาก AI อาจไม่สมบูรณ์หรือคลาดเคลื่อน เราไม่รับประกันความเหมาะสมต่อวัตถุประสงค์เฉพาะ",
      "เราไม่รับผิดต่อความเสียหายทางอ้อมที่เกิดจากการใช้งานบริการ",
    ],
  },
];

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "30px 24px 80px", color: "#e2e8f0" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 12 }}>· เอกสารทางกฎหมาย</div>
      <h1 style={{ fontSize: "clamp(34px,5vw,52px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", margin: 0 }}>ข้อกำหนดการใช้งาน</h1>
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
        มีคำถามเกี่ยวกับข้อกำหนด? ดูที่ <Link href="/contact" style={{ color: "#a5f3fc", textDecoration: "none" }}>หน้าติดต่อ</Link> หรือ
        {" "}<a href={XMAN_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>XMAN Studio</a>
      </p>
    </div>
  );
}
