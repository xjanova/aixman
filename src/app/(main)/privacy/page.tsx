/**
 * /privacy — นโยบายความเป็นส่วนตัว (Privacy Policy)
 */
import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/xdreamer/page-hero";
import { getLocale, getT } from "@/lib/i18n/server";
import { translator, type Msg } from "@/lib/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("นโยบายความเป็นส่วนตัว · X-DREAMER", "Privacy policy · X-DREAMER"),
    description: t("นโยบายความเป็นส่วนตัวและการจัดการข้อมูลของ X-DREAMER", "How X-DREAMER handles your data and protects your privacy"),
  };
}

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

const SECTIONS: { h: Msg; body: Msg[] }[] = [
  {
    h: { th: "1. ข้อมูลที่เราเก็บ", en: "1. Information we collect" },
    body: [
      {
        th: "ข้อมูลบัญชี: ชื่อ อีเมล และข้อมูลโปรไฟล์ — ใช้ร่วมกับบัญชี XMAN Studio (xman4289.com)",
        en: "Account information: your name, email and profile details — shared with your XMAN Studio account (xman4289.com).",
      },
      {
        th: "ข้อมูลการใช้งาน: prompt ที่คุณป้อน ผลงานที่สร้าง ประวัติเครดิต และบันทึกการใช้งานโมเดล",
        en: "Usage information: the prompts you enter, the work you create, your credit history and model usage logs.",
      },
      {
        th: "เราไม่เก็บข้อมูลการชำระเงิน (บัตร/บัญชี) — การชำระเงินดำเนินการผ่านระบบของ XMAN Studio",
        en: "We do not store payment details (cards or accounts) — payments are handled by XMAN Studio's system.",
      },
    ],
  },
  {
    h: { th: "2. การใช้ข้อมูล", en: "2. How we use information" },
    body: [
      {
        th: "เพื่อให้บริการสร้างผลงาน หักและคืนเครดิต และแสดงประวัติในแกลเลอรีของคุณ",
        en: "To provide the creation service, deduct and refund credits, and show your history in your gallery.",
      },
      {
        th: "เพื่อปรับปรุงความเสถียรของระบบ เช่น การวิเคราะห์อัตราความสำเร็จและการหมุน API key",
        en: "To improve the system's reliability, for example by analysing success rates and rotating API keys.",
      },
      {
        th: "เพื่อคัดกรองเนื้อหา: ก่อนหักเครดิต ระบบอ่านคำสั่งของคุณ (รวมถึง negative prompt และเนื้อเพลง) โดยอัตโนมัติด้วยรายการคำภาษาไทยและอังกฤษ เพื่อจัดหมวดงานเป็นทั่วไป / สำหรับผู้ใหญ่ / อ่านไม่ออก และบันทึกหมวดนั้นไว้กับงาน คำสั่งที่เข้าข่ายเนื้อหาต้องห้ามตามข้อกำหนดการใช้งานข้อ 6 จะถูกปฏิเสธโดยไม่หักเครดิต และจะไม่ถูกบันทึกไว้เป็นงาน — ผู้ดูแลระบบได้รับแจ้งเพียงหมายเลขบัญชีและหมวดที่เข้าข่าย ไม่ได้รับข้อความคำสั่ง",
        en: "To screen content: before any credits are deducted, the system automatically reads your prompt (including the negative prompt and lyrics) against lists of Thai and English words, classifies the job as general / adult / unreadable, and records that category with the job. A prompt that falls under the prohibited content in section 6 of the terms of use is refused without deducting credits and is not saved as a job — administrators are told only the account number and the category it fell under, not the prompt text.",
      },
      {
        th: "เราไม่ขายข้อมูลส่วนบุคคลของคุณให้บุคคลภายนอก",
        en: "We do not sell your personal information to third parties.",
      },
    ],
  },
  {
    h: { th: "3. การส่งข้อมูลให้ผู้ให้บริการ AI และเครื่องที่ใช้ประมวลผล", en: "3. Sharing data with AI providers and the machines that process it" },
    body: [
      {
        th: "prompt และภาพต้นทางที่คุณส่ง จะถูกส่งต่อไปยังผู้ให้บริการโมเดลที่คุณเลือก เพื่อสร้างผลงาน",
        en: "The prompts and source images you send are passed to the provider of the model you choose, in order to create your work.",
      },
      {
        th: "การประมวลผลฝั่งผู้ให้บริการเป็นไปตามนโยบายความเป็นส่วนตัวของแต่ละราย",
        en: "Processing on a provider's side follows that provider's own privacy policy.",
      },
      {
        th: "งานบางประเภทประมวลผลบน GPU ที่เราเช่าจากศูนย์ข้อมูล ซึ่งเราปิดและลบทิ้งทั้งเครื่องเมื่อไม่มีงานต่อ",
        en: "Some types of jobs are processed on GPUs we rent from data centres; we shut down and delete the whole machine when it has no further work.",
      },
      {
        th: "โมเดลที่ระบุว่า \"เครื่องชุมชน\" (ปัจจุบันคือการสร้างภาพนิ่ง SDXL) ประมวลผลบนคอมพิวเตอร์ของผู้ร่วมแบ่งปันกำลังประมวลผล (GPUxMINE) เท่านั้น ไม่มีการเช่าเครื่องแทน ข้อมูลระหว่างระบบของเรากับเครื่องเหล่านั้นส่งผ่านการเชื่อมต่อแบบเข้ารหัส (HTTPS) และเครื่องได้รับเฉพาะคำสั่งสร้างและค่าที่ใช้สร้างภาพของงานนั้น ไม่มีชื่อ อีเมล หรือข้อมูลบัญชีของคุณ",
        en: "Models marked \"community machines\" (currently SDXL still-image generation) are processed only on the computers of people who share their computing power (GPUxMINE); no machine is rented in their place. Data between our system and those machines travels over an encrypted connection (HTTPS), and a machine receives only the prompt and the image settings for that job — not your name, email or any account information.",
      },
      {
        th: "เครื่องของผู้ร่วมแบ่งปันได้รับเฉพาะงานที่ระบบคัดกรองคำสั่งแล้วว่าเป็นเนื้อหาทั่วไป และไม่มีไฟล์ที่คุณอัปโหลด งานที่มีเนื้อหาสำหรับผู้ใหญ่ งานที่ระบบอ่านคำสั่งไม่ได้ครบ (เช่น ภาษาที่ระบบยังไม่รองรับ) และงานที่แนบภาพ เสียง หรือวิดีโอ จะไม่ถูกส่งไปยังเครื่องของผู้ร่วมแบ่งปันไม่ว่ากรณีใด — โมเดลเครื่องชุมชนจะปฏิเสธงานเหล่านี้ตั้งแต่ก่อนหักเครดิต",
        en: "Community machines receive only jobs whose prompt the system has screened as general content and that include no files you uploaded. Jobs with adult content, jobs whose prompt the system could not fully read (for example, in a language it does not support yet), and jobs with attached images, audio or video are never sent to community machines under any circumstances — community-machine models refuse these jobs before any credits are deducted.",
      },
      {
        th: "เมื่อคัดลอกผลงานกลับมาเก็บในระบบของเราแล้ว ระบบจะสั่งให้เครื่องของผู้ร่วมแบ่งปันลบไฟล์ผลงานและประวัติคำสั่งของงานนั้นทันที หากเครื่องออฟไลน์หรือยังไม่ยืนยันการลบ ระบบจะสั่งลบซ้ำเมื่อเครื่องกลับมาออนไลน์ภายใน 24 ชั่วโมง งานที่ส่งถึงเครื่องแล้วแต่ไม่สำเร็จจะถูกสั่งลบเช่นกันหนึ่งครั้ง ผลงานที่ลบจากเครื่องแล้วยังอยู่ในแกลเลอรีของคุณตามระยะเวลาเก็บรักษาที่แจ้งไว้",
        en: "Once your work has been copied back into our system, the system tells the community machine to delete that job's result files and prompt history straight away. If the machine is offline or has not yet confirmed the deletion, the system repeats the instruction when the machine comes back online, within 24 hours. A job that reached a machine but did not succeed is also sent a delete instruction once. Work deleted from the machine stays in your gallery for the retention period we have stated.",
      },
    ],
  },
  {
    h: { th: "4. การเก็บบันทึกตามกฎหมาย และการเปิดเผยต่อเจ้าหน้าที่", en: "4. Records kept by law, and disclosure to the authorities" },
    body: [
      {
        th: "ในฐานะผู้ให้บริการ เรามีหน้าที่เก็บข้อมูลจราจรทางคอมพิวเตอร์ตาม พ.ร.บ.ว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ มาตรา 26 ซึ่งรวมถึงเวลาใช้งาน หมายเลข IP บัญชีผู้ใช้ และข้อมูลอุปกรณ์",
        en: "As a service provider, we are required to keep computer traffic data under section 26 of the Computer-Related Crime Act, including usage times, IP addresses, user accounts and device information.",
      },
      {
        th: "เราเก็บคำสั่งที่ใช้สร้างและผลงานที่ได้ ผูกกับบัญชีที่สร้างเสมอ — ไม่มีการสร้างผลงานแบบไม่ระบุตัวตนบนแพลตฟอร์มนี้",
        en: "We keep the prompts used and the resulting work, always linked to the account that created them — there is no anonymous creation on this platform.",
      },
      {
        th: "ข้อมูลยืนยันตัวตน (KYC) เช่น ภาพบัตรประชาชนและข้อมูลบัญชีธนาคาร จัดเก็บและดูแลโดย XMAN Studio ไม่ได้เก็บซ้ำในระบบนี้ เราทราบเพียงว่าบัญชีนั้นยืนยันตัวตนผ่านแล้วหรือยัง",
        en: "Identity verification (KYC) data, such as images of your ID card and your bank account details, is stored and managed by XMAN Studio and is not kept again in this system. We only know whether or not an account has passed verification.",
      },
      {
        th: "เราไม่นำข้อมูล KYC มารวมกับประวัติการสร้างผลงานในรายงาน การส่งออกข้อมูล หรือการวิเคราะห์ใด ๆ การเชื่อมโยงสองส่วนนี้จะทำเฉพาะเมื่อมีคำสั่งที่ชอบด้วยกฎหมายเท่านั้น",
        en: "We do not combine KYC data with creation history in any report, data export or analysis. The two are linked only when there is a lawful order.",
      },
      {
        th: "เมื่อได้รับหมายศาล คำสั่งพนักงานเจ้าหน้าที่ หรือคำร้องขอที่ชอบด้วยกฎหมาย เราจะส่งมอบข้อมูลทั้งหมดที่มีอยู่ให้เจ้าหน้าที่โดยไม่มีข้อยกเว้น และในบางกรณีอาจไม่สามารถแจ้งให้เจ้าของบัญชีทราบล่วงหน้าได้หากกฎหมายห้ามไว้",
        en: "On receiving a court warrant, an order from a competent official, or any other lawful request, we will hand over all the data we hold to the authorities without exception, and in some cases may be unable to tell the account owner in advance if the law forbids it.",
      },
      {
        th: "นอกเหนือจากกรณีข้างต้น เราไม่เปิดเผยข้อมูลของคุณให้บุคคลภายนอก",
        en: "Apart from the cases above, we do not disclose your information to third parties.",
      },
    ],
  },
  {
    h: { th: "5. ความปลอดภัย", en: "5. Security" },
    body: [
      {
        th: "API key ของระบบถูกเข้ารหัสด้วย AES-256-GCM ก่อนจัดเก็บ",
        en: "The system's API keys are encrypted with AES-256-GCM before they are stored.",
      },
      {
        th: "รหัสผ่านถูกแฮชด้วย bcrypt และจัดการโดยระบบบัญชีของ XMAN Studio",
        en: "Passwords are hashed with bcrypt and handled by XMAN Studio's account system.",
      },
    ],
  },
  {
    h: { th: "6. สิทธิ์ของคุณ", en: "6. Your rights" },
    body: [
      {
        th: "คุณสามารถขอเข้าถึง แก้ไข หรือลบข้อมูลบัญชีได้ผ่าน XMAN Studio",
        en: "You can ask to access, correct or delete your account information through XMAN Studio.",
      },
      {
        th: "การลบบัญชีจะลบผลงานและประวัติที่เกี่ยวข้องในแพลตฟอร์มนี้",
        en: "Deleting your account deletes the related work and history on this platform.",
      },
    ],
  },
];

export default async function PrivacyPage() {
  const locale = await getLocale();
  const t = translator(locale);
  return (
    <>
      <PageHero
        image="/showcase/cta-weave.jpg"
        eyebrow={t("· เอกสารทางกฎหมาย", "· Legal")}
        title={t("นโยบาย", "Privacy")}
        emphasis={t("ความเป็นส่วนตัว", "policy")}
        hue={160}
        size="slim"
        sub={t("ปรับปรุงล่าสุด: กันยายน 2026", "Last updated: September 2026")}
      />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px 80px", color: "#e2e8f0" }}>
      {/* English only: the Thai is the original, so it needs no such line. */}
      {locale === "en" && (
        <p style={{ margin: "0 0 20px", fontSize: 13, lineHeight: 1.6, color: "#94a3b8" }}>
          This English version is provided for convenience. If it differs from the Thai version, the Thai version governs.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {SECTIONS.map((s, i) => (
          <section key={i} style={{ padding: 24, borderRadius: 16, background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(18px)" }}>
            <h2 style={{ fontSize: 18, color: "#fff", fontWeight: 500, marginTop: 0, marginBottom: 12 }}>{t(s.h)}</h2>
            {s.body.map((p, j) => (
              <p key={j} style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(203,213,225,0.85)", margin: "0 0 10px" }}>{t(p)}</p>
            ))}
          </section>
        ))}
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: "#94a3b8" }}>
        {t("ต้องการจัดการข้อมูลบัญชี? ไปที่", "Want to manage your account information? Go to")} <a href={XMAN_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>XMAN Studio</a>
        {" "}{t("หรือดู", "or see the")} <Link href="/terms" style={{ color: "#a5f3fc", textDecoration: "none" }}>{t("ข้อกำหนดการใช้งาน", "terms of use")}</Link>
      </p>
      </div>
    </>
  );
}
