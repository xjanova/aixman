/**
 * /about — เกี่ยวกับ X-DREAMER
 */
import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/xdreamer/page-hero";
import { getT } from "@/lib/i18n/server";
import type { Msg } from "@/lib/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("เกี่ยวกับเรา · X-DREAMER", "About us · X-DREAMER"),
    description: t(
      "X-DREAMER แพลตฟอร์มสร้างภาพและวิดีโอด้วย AI รวมผู้ให้บริการชั้นนำไว้ในที่เดียว",
      "X-DREAMER is an AI image and video platform that brings leading providers together in one place."
    ),
  };
}

/** `d` is a pair, or a plain list of model names that reads the same in both. */
const FEATURES: { t: Msg; d: Msg | string }[] = [
  { t: { th: "ภาพจากข้อความ", en: "Text to image" }, d: { th: "Seedream, FLUX, GPT Image, Stable Diffusion และอื่น ๆ", en: "Seedream, FLUX, GPT Image, Stable Diffusion and more" } },
  { t: { th: "วิดีโอจากข้อความ/ภาพ", en: "Text or image to video" }, d: "Seedance, Sora, Kling, Runway, Luma" },
  { t: { th: "แก้ไข & ขยายภาพ", en: "Edit & upscale" }, d: { th: "image-to-image และ upscale คมชัดหลายเท่า", en: "Image-to-image, plus upscaling to several times the sharpness" } },
  { t: { th: "ระบบเครดิตเดียว", en: "One credit system" }, d: { th: "หมุน API key อัตโนมัติ คืนเครดิตเมื่อสร้างไม่สำเร็จ", en: "Automatic API key rotation, and credits refunded when a creation fails" } },
];

export default async function AboutPage() {
  const t = await getT();
  return (
    <>
      <PageHero
        image="/showcase/about-hero.jpg"
        eyebrow={t("· เกี่ยวกับเรา", "· About us")}
        title={t("ทอความฝัน", "Weave dreams")}
        emphasis={t("ด้วย AI", "with AI")}
        hue={270}
        sub={t(
          "X-DREAMER คือแพลตฟอร์มสร้างสรรค์ด้วย AI ที่รวมโมเดลภาพและวิดีโอชั้นนำจาก 9 ผู้ให้บริการไว้ในอินเทอร์เฟซเดียว — เลือกโมเดล พิมพ์ไอเดีย แล้วจ่ายด้วยเครดิตเดียว ไม่ต้องถือหลายซับสคริปชัน",
          "X-DREAMER is an AI creative platform that brings leading image and video models from 9 providers into one interface — pick a model, type your idea, and pay with one set of credits. No juggling several subscriptions."
        )}
      />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 80px", color: "#e2e8f0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {FEATURES.map((f, i) => (
          <div key={i} style={{ padding: 22, borderRadius: 16, background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(18px)" }}>
            <div style={{ fontSize: 16, color: "#fff", fontWeight: 500, marginBottom: 8 }}>{t(f.t)}</div>
            <div style={{ fontSize: 13, color: "rgba(203,213,225,0.7)", lineHeight: 1.6 }}>{t(f.d)}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 44, padding: 28, borderRadius: 20, background: "linear-gradient(160deg, hsla(290,60%,22%,0.5), hsla(220,60%,15%,0.5))", border: "1px solid hsla(290,70%,55%,0.3)", textAlign: "center" }}>
        <div style={{ fontSize: 20, color: "#fff", fontWeight: 400, marginBottom: 14 }}>{t("พร้อมเริ่มทอความฝันแรกของคุณแล้วหรือยัง?", "Ready to weave your first dream?")}</div>
        <Link href="/generate" style={{ display: "inline-block", padding: "13px 30px", borderRadius: 12, background: "linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6)", color: "#fff", textDecoration: "none", fontSize: 15, fontWeight: 600 }}>
          {t("เริ่มสร้างเลย →", "Start creating →")}
        </Link>
      </div>
      </div>
    </>
  );
}
