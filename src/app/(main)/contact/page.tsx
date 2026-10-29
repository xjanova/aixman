/**
 * /contact — ติดต่อเรา
 *
 * Support, billing and account management live on XMAN Studio (shared accounts),
 * so this page routes users to the real channels rather than a dead form.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/xdreamer/page-hero";
import { getT } from "@/lib/i18n/server";
import type { Msg } from "@/lib/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("ติดต่อเรา · X-DREAMER", "Contact us · X-DREAMER"),
    description: t("ช่องทางการติดต่อและการสนับสนุนของ X-DREAMER", "How to reach X-DREAMER and get support"),
  };
}

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

const CHANNELS: { t: Msg; d: Msg; cta: Msg; href: string; external: boolean }[] = [
  {
    t: { th: "บัญชี & การชำระเงิน", en: "Account & payments" },
    d: {
      th: "จัดการบัญชี เครดิต และใบเสร็จผ่าน XMAN Studio ซึ่งดูแลระบบบัญชีและการชำระเงิน",
      en: "Manage your account, credits and receipts on XMAN Studio, which runs accounts and payments.",
    },
    cta: { th: "ไปที่ XMAN Studio", en: "Go to XMAN Studio" },
    href: `${XMAN_URL}`,
    external: true,
  },
  {
    t: { th: "ปัญหาการใช้งาน", en: "Problems using the site" },
    d: {
      th: "พบปัญหาการสร้างผลงาน เครดิตไม่เข้า หรือผลลัพธ์ผิดพลาด? ส่งรายละเอียดมาที่ทีมงานผ่านศูนย์ช่วยเหลือ",
      en: "Trouble creating, credits not showing up, or a wrong result? Send the details to our team through the help centre.",
    },
    cta: { th: "ศูนย์ช่วยเหลือ XMAN", en: "XMAN help centre" },
    href: `${XMAN_URL}/contact`,
    external: true,
  },
];

export default async function ContactPage() {
  const t = await getT();
  return (
    <>
      <PageHero
        image="/showcase/contact-art.jpg"
        eyebrow={t("· ติดต่อเรา", "· Contact us")}
        title={t("เราพร้อม", "We're here")}
        emphasis={t("ช่วยเหลือ", "to help")}
        hue={190}
        sub={t(
          "บัญชีผู้ใช้และการชำระเงินของ X-DREAMER ใช้ร่วมกับ XMAN Studio — เลือกช่องทางที่เหมาะกับเรื่องของคุณด้านล่าง",
          "X-DREAMER accounts and payments are shared with XMAN Studio — pick the channel that fits your question below."
        )}
      />

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 80px", color: "#e2e8f0" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {CHANNELS.map((c, i) => (
          <div key={i} style={{ padding: 24, borderRadius: 16, background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(18px)", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, color: "#fff", fontWeight: 500, marginBottom: 6 }}>{t(c.t)}</div>
              <div style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", lineHeight: 1.6 }}>{t(c.d)}</div>
            </div>
            <a href={c.href} target="_blank" rel="noopener noreferrer"
              style={{ flexShrink: 0, padding: "11px 20px", borderRadius: 10, background: "rgba(165,243,252,0.1)", border: "1px solid rgba(165,243,252,0.25)", color: "#a5f3fc", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
              {t(c.cta)} →
            </a>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: "#94a3b8" }}>
        {t("อยากเริ่มสร้างเลย? ไปที่", "Want to start creating? Go to the")} <Link href="/generate" style={{ color: "#a5f3fc", textDecoration: "none" }}>{t("สตูดิโอ", "Studio")}</Link> ·
        {" "}{t("ดู", "See")} <Link href="/pricing" style={{ color: "#a5f3fc", textDecoration: "none" }}>{t("แพ็กเกจเครดิต", "credit packages")}</Link>
      </p>
      </div>
    </>
  );
}
