/**
 * /terms — ข้อกำหนดการใช้งาน (Terms of Service)
 *
 * นโยบายเนื้อหาสำหรับผู้ใหญ่ (ข้อ 5–8) เขียนตามที่เจ้าของแพลตฟอร์มกำหนด:
 * สร้างได้ · ไม่โชว์สาธารณะ · เก็บแยกหมวด · เตือนเมื่อเสี่ยง · ผู้สร้างรับผิดเอง ·
 * ส่งข้อมูลให้เจ้าหน้าที่เมื่อมีคำสั่งที่ชอบด้วยกฎหมาย
 *
 * ข้อ 6 (เนื้อหาที่ห้ามเด็ดขาด) ไม่ใช่ทางเลือกเชิงนโยบาย — เป็นความผิดอาญาที่
 * ข้อสัญญายกเว้นความรับผิดให้ผู้ให้บริการไม่ได้ จึงต้องปิดกั้นด้วยระบบ ไม่ใช่
 * ด้วยข้อความในหน้านี้เพียงอย่างเดียว
 */
import type { Metadata } from "next";
import Link from "next/link";

import { PageHero } from "@/components/xdreamer/page-hero";
import { getLocale, getT } from "@/lib/i18n/server";
import { translator, type Msg } from "@/lib/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("ข้อกำหนดการใช้งาน · X-DREAMER", "Terms of use · X-DREAMER"),
    description: t("ข้อกำหนดและเงื่อนไขการใช้งานแพลตฟอร์ม AI ของ X-DREAMER", "The terms and conditions for using the X-DREAMER AI platform"),
  };
}

const XMAN_URL = process.env.NEXT_PUBLIC_XMAN_URL || "https://xman4289.com";

type Tone = "danger" | "notice";

const SECTIONS: { h: Msg; body: Msg[]; tone?: Tone }[] = [
  {
    h: { th: "1. การยอมรับข้อกำหนดและคุณสมบัติผู้ใช้", en: "1. Acceptance of terms and user eligibility" },
    body: [
      {
        th: "การเข้าใช้งาน X-DREAMER ถือว่าคุณยอมรับข้อกำหนดเหล่านี้ทั้งหมด หากไม่ยอมรับ กรุณางดใช้งานบริการ",
        en: "By using X-DREAMER, you accept all of these terms. If you do not accept them, please do not use the service.",
      },
      {
        th: "ผู้ใช้ต้องมีอายุไม่ต่ำกว่า 18 ปีบริบูรณ์ การใช้บัญชีของผู้อื่นหรือแจ้งอายุอันเป็นเท็จถือเป็นการละเมิดข้อกำหนดอย่างร้ายแรง และเป็นเหตุให้ระงับบัญชีได้ทันทีโดยไม่คืนเครดิต",
        en: "You must be at least 18 years old. Using someone else's account or giving a false age is a serious breach of these terms and grounds for immediate account suspension without a refund of credits.",
      },
      {
        th: "บัญชีผู้ใช้เป็นบัญชีเดียวกับ XMAN Studio (xman4289.com) — การสมัคร การชำระเงิน และการจัดการบัญชีดำเนินการผ่าน XMAN Studio",
        en: "Your account is the same account as on XMAN Studio (xman4289.com) — sign-up, payment and account management are all handled through XMAN Studio.",
      },
      {
        th: "บริการบางส่วนต้องผ่านการยืนยันตัวตน (KYC) ที่ XMAN Studio ก่อน ได้แก่ การสร้างเนื้อหาสำหรับผู้ใหญ่ตามข้อ 5 และการรับเงินค่าตอบแทนหรือถอนเงินออกจากระบบ — การยืนยันใช้บัตรประชาชนและข้อมูลบัญชีธนาคารของเจ้าของบัญชีเอง",
        en: "Some services require identity verification (KYC) at XMAN Studio first: creating adult content under section 5, and receiving payments or withdrawing money from the system. Verification uses the account owner's own national ID card and bank account details.",
      },
    ],
  },
  {
    h: { th: "2. เครดิตและการชำระเงิน", en: "2. Credits and payment" },
    body: [
      {
        th: "การสร้างผลงานแต่ละครั้งจะหักเครดิตตามอัตราของแต่ละโมเดล หากการสร้างล้มเหลว ระบบจะคืนเครดิตให้อัตโนมัติ",
        en: "Each creation deducts credits at the rate of the model used. If a creation fails, the system refunds your credits automatically.",
      },
      {
        th: "เครดิตซื้อผ่าน XMAN Studio ไม่มีวันหมดอายุ และไม่สามารถขอคืนเป็นเงินสดได้ เว้นแต่กรณีที่กฎหมายกำหนด",
        en: "Credits are bought through XMAN Studio, never expire, and cannot be refunded as cash, except where the law requires it.",
      },
      {
        th: "ราคาแพ็กเกจและอัตราเครดิตอาจปรับเปลี่ยนได้ โดยจะมีผลกับการซื้อครั้งถัดไปเท่านั้น",
        en: "Package prices and credit rates may change; any change applies only to future purchases.",
      },
      {
        th: "เครดิตที่ถูกหักไปกับงานที่ระบบปฏิเสธเพราะผิดข้อกำหนด จะไม่ได้รับคืน",
        en: "Credits deducted for a job that the system refuses for breaching these terms are not refunded.",
      },
    ],
  },
  {
    h: { th: "3. การใช้งานที่ยอมรับได้", en: "3. Acceptable use" },
    body: [
      {
        th: "ห้ามใช้บริการเพื่อละเมิดลิขสิทธิ์ เครื่องหมายการค้า หรือสิทธิ์ในทรัพย์สินทางปัญญาของผู้อื่น",
        en: "You may not use the service to infringe anyone else's copyright, trademarks or other intellectual property rights.",
      },
      {
        th: "ห้ามใช้บริการเพื่อสร้างเนื้อหาที่แอบอ้างเป็นบุคคลอื่นโดยมิชอบ เนื้อหาหลอกลวง หรือเนื้อหาที่ใช้ประกอบการฉ้อโกง",
        en: "You may not use the service to create content that wrongfully impersonates someone else, deceptive content, or content used to commit fraud.",
      },
      {
        th: "ห้ามใช้เครื่องมืออัตโนมัติเพื่อดึงทรัพยากรเกินสมควร เจาะระบบ หรือหลบเลี่ยงกลไกตรวจสอบเนื้อหา",
        en: "You may not use automated tools to take an unreasonable share of resources, break into the system, or get around the content-checking mechanisms.",
      },
      {
        th: "ห้ามขายต่อ ให้เช่า หรือเปิดให้บุคคลภายนอกใช้บัญชีของคุณสร้างผลงาน — คุณยังคงรับผิดชอบทุกอย่างที่เกิดจากบัญชีของคุณ",
        en: "You may not resell, rent out, or let third parties use your account to create work — you remain responsible for everything that comes from your account.",
      },
    ],
  },
  {
    h: { th: "4. สิทธิ์ในผลงานและการนำไปใช้", en: "4. Rights in your work and its use" },
    body: [
      {
        th: "ผลงานที่คุณสร้างขึ้นเป็นของคุณภายใต้ขอบเขตที่ผู้ให้บริการโมเดลต้นทางอนุญาต",
        en: "The work you create is yours, to the extent that the provider of the underlying model allows.",
      },
      {
        th: "เราเก็บผลงานไว้ในแกลเลอรีส่วนตัวของคุณเพื่อให้เข้าถึงย้อนหลังได้ และไม่นำผลงานของคุณไปใช้ในสื่อการตลาดโดยไม่ได้รับอนุญาต",
        en: "We keep your work in your private gallery so you can come back to it, and we do not use your work in marketing materials without your permission.",
      },
      {
        th: "การนำผลงานออกไปใช้ เผยแพร่ หรือหาประโยชน์ในเชิงพาณิชย์ เป็นการตัดสินใจและความรับผิดชอบของคุณเอง",
        en: "Taking your work out to use, publish or exploit commercially is your own decision and your own responsibility.",
      },
    ],
  },
  {
    h: { th: "5. เนื้อหาสำหรับผู้ใหญ่ (18+) — สร้างได้ แต่ไม่เผยแพร่", en: "5. Adult content (18+) — may be created, but is never published" },
    tone: "notice",
    body: [
      {
        th: "แพลตฟอร์มอนุญาตให้ผู้ใช้ที่บรรลุนิติภาวะสร้างเนื้อหาสำหรับผู้ใหญ่เพื่อการใช้งานส่วนตัวได้ โดยอยู่ภายใต้เงื่อนไขในข้อนี้และข้อ 6 อย่างเคร่งครัด",
        en: "The platform allows users who have come of legal age to create adult content for personal use, strictly subject to the conditions in this section and in section 6.",
      },
      {
        th: "การเข้าถึงหมวดนี้ต้องผ่านการยืนยันตัวตน (KYC) ที่ XMAN Studio ให้เสร็จสมบูรณ์ก่อน โดยใช้บัตรประชาชนและข้อมูลบัญชีธนาคารของเจ้าของบัญชีเอง บัญชีที่ยังไม่ยืนยันตัวตนจะไม่สามารถสร้างเนื้อหาในหมวดนี้ได้",
        en: "Access to this category requires completing identity verification (KYC) at XMAN Studio first, using the account owner's own national ID card and bank account details. Accounts that have not been verified cannot create content in this category.",
      },
      {
        th: "การยืนยันตัวตนทำให้ผลงานทุกชิ้นในหมวดนี้ผูกกับตัวบุคคลที่ระบุตัวได้ตามกฎหมาย ซึ่งเป็นเงื่อนไขที่ทำให้ความรับผิดตามข้อ 7 มีผลบังคับได้จริง",
        en: "Identity verification ties every work in this category to a legally identifiable person, which is what makes the liability under section 7 genuinely enforceable.",
      },
      {
        th: "ผลงานกลุ่มนี้ถูกจัดเก็บแยกหมวดอย่างชัดเจน เข้าถึงได้เฉพาะเจ้าของบัญชีที่ยืนยันตัวตนแล้วเท่านั้น",
        en: "Work in this category is stored in a clearly separate category and can be accessed only by its verified account owner.",
      },
      {
        th: "ผลงานกลุ่มนี้จะไม่ปรากฏในแกลเลอรีสาธารณะ หน้าแรก ผลงานแนะนำ ผลการค้นหา หรือสื่อการตลาดใด ๆ ของแพลตฟอร์มทั้งสิ้น",
        en: "Work in this category never appears in the platform's public gallery, home page, featured work, search results or any of its marketing material.",
      },
      {
        th: "ฟังก์ชันแชร์ ลิงก์สาธารณะ การฝังผลงาน และการส่งต่อภายในระบบ ถูกปิดสำหรับหมวดนี้",
        en: "Sharing, public links, embedding and forwarding within the system are turned off for this category.",
      },
      {
        th: "เมื่อระบบตรวจพบว่าคำสั่งสร้างมีความเสี่ยงทางกฎหมาย จะแสดงคำเตือนก่อนดำเนินการทุกครั้ง การกดยืนยันเพื่อสร้างต่อ ถือว่าคุณรับทราบและยอมรับความเสี่ยงนั้นด้วยตนเอง",
        en: "Whenever the system detects that a prompt carries legal risk, it shows a warning before going ahead. By confirming to continue, you acknowledge and accept that risk yourself.",
      },
    ],
  },
  {
    h: { th: "6. เนื้อหาที่ห้ามเด็ดขาด", en: "6. Strictly prohibited content" },
    tone: "danger",
    body: [
      {
        th: "ข้อห้ามต่อไปนี้ไม่ใช่ทางเลือกเชิงนโยบายของแพลตฟอร์ม แต่เป็นความผิดอาญาตามกฎหมายไทย ระบบจะปฏิเสธคำสั่งสร้างที่เข้าข่าย และการพยายามหลบเลี่ยงกลไกตรวจสอบถือเป็นการละเมิดร้ายแรงที่นำไปสู่การระงับบัญชีถาวรและการส่งข้อมูลให้เจ้าหน้าที่",
        en: "The prohibitions below are not a policy choice of the platform; they are criminal offences under Thai law. The system refuses any prompt that falls under them, and any attempt to get around the checking mechanisms is a serious violation that leads to permanent account suspension and to your information being passed to the authorities.",
      },
      {
        th: "๑. สื่อลามกอนาจารเด็ก หรือเนื้อหาทางเพศที่ทำให้เข้าใจได้ว่าเป็นผู้เยาว์ ไม่ว่าจะเป็นบุคคลจริง สร้างขึ้นทั้งหมดด้วย AI หรือดัดแปลงมา — เป็นความผิดตามประมวลกฎหมายอาญา มาตรา 287/1 และ 287/2 ซึ่งครอบคลุมทั้งการผลิต ครอบครอง และส่งต่อ",
        en: "(1) Child pornography, or sexual content that could be understood to depict a minor — whether of a real person, entirely AI-generated, or altered — an offence under sections 287/1 and 287/2 of the Criminal Code, which cover producing, possessing and passing it on.",
      },
      {
        th: "๒. เนื้อหาทางเพศของบุคคลจริงที่ระบุตัวตนได้ โดยไม่ได้รับความยินยอม รวมถึงการตัดต่อใบหน้าหรือเสียง — เป็นความผิดตาม พ.ร.บ.ว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ มาตรา 16 และอาจเข้าข่ายหมิ่นประมาทด้วย",
        en: "(2) Sexual content of a real, identifiable person without their consent, including edited faces or voices — an offence under section 16 of the Computer-Related Crime Act, and possibly defamation as well.",
      },
      {
        th: "๓. เนื้อหาที่สร้างขึ้นเพื่อข่มขู่ กรรโชกทรัพย์ แก้แค้น ประจาน หรือทำให้ผู้อื่นเสียหาย",
        en: "(3) Content created to threaten, extort, take revenge on, publicly shame, or harm others.",
      },
      {
        th: "๔. เนื้อหาที่แสดงความรุนแรงต่อบุคคลจริง เนื้อหาสนับสนุนการก่อการร้าย หรือคำแนะนำเชิงปฏิบัติในการก่ออาชญากรรม",
        en: "(4) Content showing violence against real people, content supporting terrorism, or practical instructions for committing crimes.",
      },
      {
        th: "๕. การนำเนื้อหาสำหรับผู้ใหญ่ที่สร้างจากแพลตฟอร์มนี้ออกไปเผยแพร่ต่อสาธารณะ — เป็นความผิดตาม พ.ร.บ.คอมพิวเตอร์ฯ มาตรา 14(4) และประมวลกฎหมายอาญา มาตรา 287",
        en: "(5) Publishing adult content created on this platform to the public — an offence under section 14(4) of the Computer-Related Crime Act and section 287 of the Criminal Code.",
      },
    ],
  },
  {
    h: { th: "7. ความรับผิดของผู้สร้างผลงาน", en: "7. The creator's liability" },
    tone: "danger",
    body: [
      {
        th: "คุณเป็นผู้กำหนดคำสั่งและเป็นผู้สร้างผลงาน ความรับผิดทั้งทางแพ่งและทางอาญาอันเกิดจากผลงานและการนำผลงานไปใช้ เป็นของคุณแต่เพียงผู้เดียวในทุกกรณี",
        en: "You write the prompts and you are the creator of the work. All civil and criminal liability arising from the work and from its use rests with you alone, in every case.",
      },
      {
        th: "แพลตฟอร์มเป็นเพียงเครื่องมือประมวลผลตามคำสั่งของคุณ ไม่ได้ร่วมกำหนดเนื้อหา และไม่รับผิดต่อการกระทำของผู้ใช้",
        en: "The platform is only a tool that processes your instructions. It takes no part in deciding the content and is not liable for users' actions.",
      },
      {
        th: "หากแพลตฟอร์ม ผู้บริหาร หรือพนักงาน ถูกร้องเรียน ฟ้องร้อง หรือเรียกค่าเสียหาย อันเนื่องมาจากผลงานหรือการกระทำของคุณ คุณตกลงชดใช้ค่าเสียหาย ค่าปรับ และค่าทนายความที่เกิดขึ้นทั้งหมด",
        en: "If the platform, its executives or its staff receive a complaint, are sued, or face a claim for damages because of your work or your actions, you agree to pay all resulting damages, fines and legal fees.",
      },
      {
        th: "โปรดพิจารณาให้รอบคอบก่อนนำผลงานออกจากบัญชีของคุณ: ในทางกฎหมาย การสร้างเก็บไว้ดูเองกับการนำออกเผยแพร่เป็นคนละเรื่องกัน และความผิดส่วนใหญ่เกิดขึ้นเมื่อมีการเผยแพร่ เมื่อผลงานออกจากระบบของเราไปแล้ว เราไม่มีทางช่วยเหลือหรือเรียกคืนได้",
        en: "Please think carefully before taking work out of your account: in law, creating something to keep for yourself and publishing it are different matters, and most offences are committed when something is published. Once work has left our system, we have no way to help or to recall it.",
      },
    ],
  },
  {
    h: { th: "8. การบันทึกข้อมูลและการเปิดเผยต่อเจ้าหน้าที่", en: "8. Record keeping and disclosure to the authorities" },
    tone: "notice",
    body: [
      {
        th: "แพลตฟอร์มบันทึกคำสั่งที่ใช้สร้าง ผลงานที่ได้ เวลา บัญชีผู้ใช้ หมายเลข IP และข้อมูลอุปกรณ์ ตามหน้าที่ของผู้ให้บริการในการเก็บข้อมูลจราจรทางคอมพิวเตอร์ตาม พ.ร.บ.คอมพิวเตอร์ฯ มาตรา 26",
        en: "The platform records the prompts used, the resulting work, times, user accounts, IP addresses and device information, as part of a service provider's duty to keep computer traffic data under section 26 of the Computer-Related Crime Act.",
      },
      {
        th: "เมื่อได้รับหมายศาล คำสั่งพนักงานเจ้าหน้าที่ หรือคำร้องขอที่ชอบด้วยกฎหมาย แพลตฟอร์มจะส่งมอบข้อมูลทั้งหมดที่มีอยู่ให้เจ้าหน้าที่โดยไม่มีข้อยกเว้น และในบางกรณีอาจไม่สามารถแจ้งให้เจ้าของบัญชีทราบล่วงหน้าได้หากกฎหมายห้ามไว้",
        en: "On receiving a court warrant, an order from a competent official, or any other lawful request, the platform will hand over all the data it holds to the authorities without exception, and in some cases may be unable to tell the account owner in advance if the law forbids it.",
      },
      {
        th: "ไม่มีการสร้างผลงานแบบไม่ระบุตัวตนบนแพลตฟอร์มนี้ — ผลงานทุกชิ้นสาวกลับถึงบัญชีที่สร้างได้เสมอ",
        en: "There is no anonymous creation on this platform — every work can always be traced back to the account that created it.",
      },
    ],
  },
  {
    h: { th: "9. การประมวลผลและเครือข่ายที่ใช้", en: "9. Processing and the networks used" },
    body: [
      {
        th: "งานสร้างผลงานอาจประมวลผลบนบริการของผู้ให้บริการโมเดลภายนอก บน GPU ที่แพลตฟอร์มเช่าจากศูนย์ข้อมูล หรือบนเครือข่ายเครื่องของผู้ร่วมแบ่งปันกำลังประมวลผล (GPUxMINE) แล้วแต่ประเภทงาน",
        en: "Depending on the type of job, a creation may be processed on an external model provider's service, on GPUs the platform rents from data centres, or on the network of machines belonging to people who share their computing power (GPUxMINE).",
      },
      {
        th: "เนื้อหาหมวดผู้ใหญ่ และงานที่มีภาพบุคคลหรือข้อมูลส่วนบุคคล จะประมวลผลบนเครื่องที่แพลตฟอร์มควบคุมเองเท่านั้น และจะไม่ถูกส่งไปยังเครื่องของผู้ร่วมแบ่งปันไม่ว่ากรณีใด",
        en: "Adult content, and jobs that contain pictures of people or personal data, are processed only on machines the platform controls itself, and are never sent to those shared machines under any circumstances.",
      },
      {
        th: "ข้อมูลงานถูกเข้ารหัสระหว่างส่ง และถูกลบออกจากเครื่องประมวลผลเมื่องานเสร็จสิ้น",
        en: "Job data is encrypted in transit and deleted from the processing machine when the job is finished.",
      },
    ],
  },
  {
    h: { th: "10. การระงับบัญชีและการบังคับใช้", en: "10. Account suspension and enforcement" },
    body: [
      {
        th: "เราขอสงวนสิทธิ์ระงับหรือยุติบัญชีที่ละเมิดข้อกำหนดโดยไม่คืนเครดิต และในกรณีที่เข้าข่ายข้อ 6 อาจระงับทันทีโดยไม่ต้องแจ้งเตือนล่วงหน้า",
        en: "We reserve the right to suspend or close accounts that breach these terms without refunding credits, and in cases that fall under section 6 we may suspend an account immediately without prior notice.",
      },
      {
        th: "คุณสามารถอุทธรณ์การระงับบัญชีได้ผ่านหน้าติดต่อ เราจะพิจารณาและแจ้งผลกลับ เว้นแต่กรณีที่อยู่ระหว่างกระบวนการทางกฎหมาย",
        en: "You can appeal a suspension through the contact page. We will review it and let you know the outcome, except in cases that are going through legal proceedings.",
      },
      {
        th: "การละเมิดข้อ 6 จะถูกบันทึกและอาจถูกรายงานต่อเจ้าหน้าที่ตามที่กฎหมายกำหนด",
        en: "Violations of section 6 are recorded and may be reported to the authorities as required by law.",
      },
    ],
  },
  {
    h: { th: "11. ข้อจำกัดความรับผิด", en: "11. Limitation of liability" },
    body: [
      {
        th: "บริการให้ตามสภาพ (as-is) ผลลัพธ์จาก AI อาจไม่สมบูรณ์หรือคลาดเคลื่อน เราไม่รับประกันความเหมาะสมต่อวัตถุประสงค์เฉพาะ",
        en: "The service is provided as is. AI output may be incomplete or inaccurate, and we do not guarantee that it is fit for any particular purpose.",
      },
      {
        th: "เราไม่รับผิดต่อความเสียหายทางอ้อม การสูญเสียโอกาสทางธุรกิจ หรือความเสียหายที่เกิดจากการที่ผู้ใช้นำผลงานไปเผยแพร่",
        en: "We are not liable for indirect damage, lost business opportunities, or damage resulting from a user publishing their work.",
      },
      {
        th: "ความรับผิดรวมสูงสุดของเราต่อผู้ใช้รายหนึ่ง จำกัดไม่เกินมูลค่าเครดิตที่ผู้ใช้รายนั้นชำระในรอบ 3 เดือนย้อนหลัง",
        en: "Our total liability to any one user is limited to the value of the credits that user paid for in the preceding 3 months.",
      },
      {
        th: "ข้อจำกัดในข้อนี้ไม่ตัดสิทธิ์ผู้บริโภคตามที่กฎหมายคุ้มครองผู้บริโภคกำหนดไว้",
        en: "The limits in this section do not take away any consumer rights under consumer protection law.",
      },
    ],
  },
  {
    h: { th: "12. กฎหมายที่ใช้บังคับและการเปลี่ยนแปลงข้อกำหนด", en: "12. Governing law and changes to these terms" },
    body: [
      {
        th: "ข้อกำหนดนี้อยู่ภายใต้กฎหมายไทย และให้ศาลไทยเป็นผู้มีเขตอำนาจในการพิจารณาข้อพิพาท",
        en: "These terms are governed by Thai law, and the Thai courts have jurisdiction over any dispute.",
      },
      {
        th: "เราอาจปรับปรุงข้อกำหนดนี้ได้ โดยจะแจ้งบนหน้านี้พร้อมวันที่ปรับปรุง การใช้งานต่อหลังวันที่มีผลถือเป็นการยอมรับฉบับใหม่",
        en: "We may update these terms, and will announce any update on this page together with its date. Continuing to use the service after the effective date means you accept the new version.",
      },
      {
        th: "หากข้อใดข้อหนึ่งตกเป็นโมฆะหรือบังคับใช้ไม่ได้ ข้ออื่นยังคงมีผลบังคับต่อไป",
        en: "If any provision is void or unenforceable, the remaining provisions stay in force.",
      },
    ],
  },
];

const TONE_STYLE: Record<Tone, { bg: string; border: string; heading: string }> = {
  danger: { bg: "rgba(69,10,10,0.42)", border: "rgba(248,113,113,0.34)", heading: "#fecaca" },
  notice: { bg: "rgba(69,50,10,0.34)", border: "rgba(251,191,36,0.28)", heading: "#fde68a" },
};

const BASE_STYLE = { bg: "rgba(15,23,42,0.5)", border: "rgba(255,255,255,0.06)", heading: "#fff" };

export default async function TermsPage() {
  const locale = await getLocale();
  const t = translator(locale);
  return (
    <>
      <PageHero
        image="/showcase/cta-weave.jpg"
        eyebrow={t("· เอกสารทางกฎหมาย", "· Legal")}
        title={t("ข้อกำหนด", "Terms")}
        emphasis={t("การใช้งาน", "of use")}
        hue={200}
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
        {SECTIONS.map((s, i) => {
          const tone = s.tone ? TONE_STYLE[s.tone] : BASE_STYLE;
          return (
            <section
              key={i}
              style={{
                padding: 24,
                borderRadius: 16,
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                backdropFilter: "blur(18px)",
              }}
            >
              <h2 style={{ fontSize: 18, color: tone.heading, fontWeight: 500, marginTop: 0, marginBottom: 12 }}>{t(s.h)}</h2>
              {s.body.map((p, j) => (
                <p key={j} style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(203,213,225,0.85)", margin: "0 0 10px" }}>{t(p)}</p>
              ))}
            </section>
          );
        })}
      </div>

      <p style={{ marginTop: 28, fontSize: 13, color: "#94a3b8" }}>
        {t("มีคำถามเกี่ยวกับข้อกำหนด? ดูที่", "Questions about these terms? See the")} <Link href="/contact" style={{ color: "#a5f3fc", textDecoration: "none" }}>{t("หน้าติดต่อ", "contact page")}</Link> {t("หรือ", "or")}
        {" "}<a href={XMAN_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#a5f3fc", textDecoration: "none" }}>XMAN Studio</a>
        {" "}· {t("ดูเพิ่มที่", "See also the")} <Link href="/privacy" style={{ color: "#a5f3fc", textDecoration: "none" }}>{t("นโยบายความเป็นส่วนตัว", "privacy policy")}</Link>
      </p>
      </div>
    </>
  );
}
