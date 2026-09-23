/**
 * What every row of `ai_settings` means — for the admin Settings page, and
 * for the settings API so it can refuse edits that page must not make.
 *
 * Checked against the code on 2026-09-13: 28 of the keys the seed route
 * creates are read by nothing (`unused`). They are shown as such, because a
 * switch that looks live but does nothing — "maintenance_mode", "nsfw filter"
 * — is worse than no switch: the admin believes something is protected.
 *
 * Keys edited elsewhere (`managedAt`) are shown read-only with a link: the GPU
 * caps have bounds enforced by /admin/gpu, and the Telegram token must go
 * through the code that encrypts it. Client-safe: no server imports.
 */

export type SettingInput = 'text' | 'number' | 'boolean' | 'json';

export type CategoryId =
  | 'general'
  | 'credits'
  | 'storage'
  | 'gpu'
  | 'notify'
  | 'mobile'
  | 'generation'
  | 'workflows'
  | 'rate_limit'
  | 'integration'
  | 'system'
  | 'other';

export interface SettingCategory {
  id: CategoryId;
  label: string;
  description: string;
}

export interface SettingMeta {
  label: string;
  /** What it does, what changing it does, and a sensible value. */
  tip: string;
  category: CategoryId;
  input: SettingInput;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Written by the system itself; shown for information only. */
  readOnly?: boolean;
  /** Stored encrypted; the value never leaves the server. */
  secret?: boolean;
  /** Edited on another page, which validates it. */
  managedAt?: { href: string; label: string };
  /** Seeded, but nothing in the code reads it — changing it has no effect. */
  unused?: boolean;
}

export const SETTING_CATEGORIES: SettingCategory[] = [
  { id: 'general', label: 'ทั่วไป', description: 'ข้อมูลเว็บไซต์และสถานะการติดตั้ง' },
  { id: 'credits', label: 'เครดิตและสมาชิก', description: 'เครดิตที่แจกและกติกาการใช้เครดิต' },
  { id: 'storage', label: 'ไฟล์และการเก็บรักษา', description: 'ไฟล์ผลงานเก็บนานแค่ไหน และรูปแบบไฟล์' },
  { id: 'gpu', label: 'GPU เช่า', description: 'เพดานค่าใช้จ่ายและเวลาของเครื่องที่เช่ามาเรนเดอร์ (SimplePod, RunPod, Vast.ai, Verda) — แก้ได้ที่หน้า GPU' },
  { id: 'notify', label: 'การแจ้งเตือน', description: 'Telegram แจ้งยอดเงินและรายงานประจำวัน' },
  { id: 'mobile', label: 'แอปมือถือ', description: 'บังคับอัปเดตแอป XDreamer' },
  { id: 'generation', label: 'การสร้างงาน', description: 'ค่าเริ่มต้นของสตูดิโอ (ส่วนใหญ่ยังไม่ได้เชื่อมกับระบบ)' },
  { id: 'workflows', label: 'Workflow และผู้ช่วยพรอมต์', description: 'ค่าปรับแต่ง workflow ComfyUI และผู้ช่วยเขียนพรอมต์ AI — แก้ได้ที่หน้า Workflow ComfyUI' },
  { id: 'rate_limit', label: 'จำกัดการใช้งาน', description: 'เพดานความถี่ (ยังไม่ได้เชื่อมกับระบบ)' },
  { id: 'integration', label: 'เชื่อมต่อภายนอก', description: 'บริการภายนอก (ยังไม่ได้เชื่อมกับระบบ)' },
  { id: 'system', label: 'ข้อมูลระบบ', description: 'ค่าที่ระบบบันทึกเอง — ดูได้อย่างเดียว' },
  { id: 'other', label: 'อื่น ๆ', description: 'ค่าที่ไม่อยู่ในแคตตาล็อก แก้เป็นข้อความดิบ' },
];

const GPU_PAGE = { href: '/admin/gpu', label: 'แก้ที่หน้า GPU' };
const WORKFLOW_PAGE = { href: '/admin/workflows', label: 'แก้ที่หน้า Workflow ComfyUI' };
const UNUSED_TIP = 'ยังไม่มีโค้ดส่วนไหนอ่านค่านี้ — เปลี่ยนแล้วไม่มีผลกับระบบ';

export const SETTINGS_CATALOG: Record<string, SettingMeta> = {
  // ── ทั่วไป ────────────────────────────────────────────────────────────
  site_name: { label: 'ชื่อเว็บไซต์', tip: `บันทึกไว้ตอนติดตั้งครั้งแรก (/setup) · ${UNUSED_TIP} (ชื่อบนหน้าเว็บมาจากโค้ด)`, category: 'general', input: 'text', unused: true },
  site_description: { label: 'คำอธิบายเว็บไซต์', tip: `บันทึกไว้ตอนติดตั้งครั้งแรก · ${UNUSED_TIP}`, category: 'general', input: 'text', unused: true },
  site_url: { label: 'URL เว็บไซต์', tip: `${UNUSED_TIP} — URL จริงมาจาก NEXT_PUBLIC_APP_URL ใน .env`, category: 'general', input: 'text', unused: true },
  default_language: { label: 'ภาษาเริ่มต้น', tip: UNUSED_TIP, category: 'general', input: 'text', unused: true },
  maintenance_mode: { label: 'โหมดปิดปรับปรุง', tip: `${UNUSED_TIP} — เว็บไม่ได้ปิดจริงเมื่อเปิดสวิตช์นี้ ถ้าต้องหยุดงาน GPU ใช้ปุ่ม "หยุดทั้งหมด" ที่หน้า GPU`, category: 'general', input: 'boolean', unused: true },

  // ── เครดิต ────────────────────────────────────────────────────────────
  new_user_free_credits: {
    label: 'เครดิตฟรีสำหรับผู้ใช้ใหม่',
    tip: 'แจกครั้งเดียวตอนระบบสร้างบัญชีเครดิตให้ผู้ใช้ (ครั้งแรกที่ใช้งาน) · ไม่ย้อนหลังให้ผู้ใช้เดิม · 0 = ไม่แจก',
    category: 'credits',
    input: 'number',
    unit: 'เครดิต',
    min: 0,
    max: 100_000,
    step: 1,
  },
  max_credits_per_generation: { label: 'เครดิตสูงสุดต่อการสร้าง 1 ครั้ง', tip: `${UNUSED_TIP} — ราคาต่องานมาจากโมเดล (หน้าโมเดล) และความยาวคลิป`, category: 'credits', input: 'number', unit: 'เครดิต', unused: true },
  credit_expiry_days: { label: 'อายุเครดิต', tip: `${UNUSED_TIP} — เครดิตไม่มีวันหมดอายุ`, category: 'credits', input: 'number', unit: 'วัน', unused: true },
  referral_bonus_credits: { label: 'โบนัสแนะนำเพื่อน', tip: `${UNUSED_TIP} — โบนัสจริงกำหนดในโค้ด (referral.ts): ผู้ชวน 50 · ผู้ถูกชวน 20 เครดิต · ค่าคอม 10% ของเครดิตที่ซื้อ`, category: 'credits', input: 'number', unit: 'เครดิต', unused: true },

  // ── ไฟล์ ──────────────────────────────────────────────────────────────
  media_retention_days: {
    label: 'เก็บไฟล์ผลงาน',
    tip: 'ไฟล์ผลงานถูกลบอัตโนมัติเมื่อครบกำหนด (ลบเฉพาะไฟล์ ประวัติและเครดิตยังอยู่) · ลูกค้าเห็นวันหมดอายุบนทุกผลงาน · วันหมดอายุถูกกำหนดตอนงานเสร็จ เปลี่ยนค่านี้ไม่ย้อนแก้ของเดิม · 0 = เก็บตลอด',
    category: 'storage',
    input: 'number',
    unit: 'วัน',
    min: 0,
    max: 3650,
    step: 1,
  },
  storage_driver: { label: 'ที่เก็บไฟล์', tip: `${UNUSED_TIP} — ใช้ Cloudflare R2 ตามค่า R2_* ใน .env`, category: 'storage', input: 'text', unused: true },
  max_file_size_mb: { label: 'ขนาดไฟล์อัปโหลดสูงสุด', tip: `${UNUSED_TIP} — เพดานจริงอยู่ในโค้ด (ภาพ 12 MB)`, category: 'storage', input: 'number', unit: 'MB', unused: true },
  image_output_format: { label: 'รูปแบบไฟล์ภาพ', tip: UNUSED_TIP, category: 'storage', input: 'text', unused: true },
  image_quality: { label: 'คุณภาพภาพ', tip: UNUSED_TIP, category: 'storage', input: 'number', unit: '%', unused: true },
  thumbnail_width: { label: 'ความกว้างรูปย่อ', tip: UNUSED_TIP, category: 'storage', input: 'number', unit: 'px', unused: true },

  // ── GPU ───────────────────────────────────────────────────────────────
  gpu_enabled: {
    label: 'เปิดการเช่า GPU',
    tip: 'ปิดแล้ว: เครื่องที่ว่างถูกปิดทันที ไม่เช่าเครื่องใหม่ และโมเดลที่ใช้ GPU เช่าจะถูกซ่อนจากลูกค้า · ถ้ามีงานค้างให้ใช้ "หยุดทั้งหมด" ที่หน้า GPU เพื่อคืนเครดิตด้วย',
    category: 'gpu', input: 'boolean', managedAt: GPU_PAGE,
  },
  gpu_max_concurrent_workers: {
    label: 'เครื่องพร้อมกันสูงสุด',
    tip: 'ระบบเช่าเพิ่มเองเมื่อคิวยาวจนเครื่องใหม่ช่วยให้เสร็จเร็วกว่า และแยกเครื่องต่อโมเดล · ใช้คิดเกณฑ์เตือนยอดเงินด้วย (ราคาสูงสุด × จำนวนเครื่อง) · MV 36 คลิปบน 3 เครื่องเสร็จใน ~2 ชม.',
    category: 'gpu', input: 'number', unit: 'เครื่อง', managedAt: GPU_PAGE,
  },
  gpu_max_price_per_hour_usd: {
    label: 'ราคาเช่าสูงสุดต่อชั่วโมง',
    tip: 'ไม่เช่าเครื่องที่แพงกว่านี้ ไม่ว่าเจ้าไหน · เป็นเกณฑ์ "ยอดเงินไม่พอเช่า" ด้วย (ยอดของเจ้าที่มีเงินมากสุด ≤ ค่านี้ = เช่าไม่ได้ ปิดรับงาน) · A100 40GB ราว $0.50/ชม. (ก.ย. 2569)',
    category: 'gpu', input: 'number', unit: 'USD', managedAt: GPU_PAGE,
  },
  gpu_daily_budget_usd: {
    label: 'งบค่าเครื่องต่อวัน',
    tip: 'ใช้ครบแล้วปิดเครื่องที่ว่างทันทีและหยุดเช่าใหม่จนเที่ยงคืน · นับทุกนาทีที่เครื่องเปิด รวมบูตและเวลาว่าง · วันเจน MV 37 คลิปใช้ $3.46',
    category: 'gpu', input: 'number', unit: 'USD', managedAt: GPU_PAGE,
  },
  gpu_idle_timeout_minutes: {
    label: 'ปิดเครื่องเมื่อว่างเกิน',
    tip: 'สั้น = ประหยัด แต่งานถัดไปต้องรอบูตใหม่ (~2 นาที, ~$0.02) · ยาว = เริ่มงานต่อทันทีแต่จ่ายค่าเครื่องว่าง · แนะนำ 2–5 นาที',
    category: 'gpu', input: 'number', unit: 'นาที', managedAt: GPU_PAGE,
  },
  gpu_presence_extension_minutes: {
    label: 'รอเพิ่มเมื่อลูกค้ายังเปิดสตูดิโอ',
    tip: 'ต่อเวลาจาก "ปิดเมื่อว่าง" เฉพาะตอนมีลูกค้าอยู่หน้าสร้างงานของโมเดลนั้น ให้สั่งต่อได้โดยไม่ต้องรอบูต · 0 = ปิด · สูงสุด 30',
    category: 'gpu', input: 'number', unit: 'นาที', managedAt: GPU_PAGE,
  },
  gpu_prewarm_cooldown_minutes: {
    label: 'เปิดเครื่องรอลูกค้า — พักหลังเปิดเก้อ',
    tip: 'ลูกค้าที่มีเครดิตพอสั่งงานเพิ่งเข้าหน้าสร้างงานของโมเดลที่ไม่มีเครื่องเปิดอยู่ → เช่าเครื่องทันที ให้บูตระหว่างลูกค้าพิมพ์พรอมต์ · ถ้าเครื่องนั้นปิดไปโดยไม่มีงาน จะไม่เปิดรอให้โมเดลนั้นอีกจนครบเวลานี้ · ไม่เปิดตอนยอดเงินใกล้หมด เครื่องเต็มเพดาน หรืองบวันหมด · เปิดเก้อ 1 ครั้ง ≈ บูต + เวลาว่าง (~15 นาที, A100 ≈ $0.12) · 0 = ปิด',
    category: 'gpu', input: 'number', unit: 'นาที', managedAt: GPU_PAGE,
  },
  gpu_wait_value_usd_per_hour: {
    label: 'มูลค่าเวลาที่ลูกค้ารอ',
    tip: 'ใช้ชั่งการ์ดถูกแต่ช้ากับแพงแต่เร็ว: ที่ $2/ชม. การ์ดต้องประหยัดได้ 1 เซ็นต์ต่อทุก ~18 วินาทีที่ลูกค้ารอนานขึ้นจึงจะถูกเลือก · 0 = ดูแค่ค่าเช่า',
    category: 'gpu', input: 'number', unit: 'USD/ชม.', managedAt: GPU_PAGE,
  },
  gpu_providers: {
    label: 'ผู้ให้เช่าที่ระบบเลือกเช่าได้',
    tip: 'รายชื่อคั่นจุลภาค (simplepod, runpod, vast, verda) · ระบบดูเครื่องว่างจากทุกเจ้าในรายการแล้วเลือกเครื่องที่คุ้มสุดที่บัญชีเจ้านั้นมีเงินพอ · เจ้าที่ไม่อยู่ในรายการยังถูกตรวจและปิดเครื่องตกค้างตามปกติ · เปิด/ปิดแต่ละเจ้าที่หน้า GPU',
    category: 'gpu', input: 'text', managedAt: GPU_PAGE,
  },
  gpu_max_worker_lifetime_minutes: {
    label: 'อายุเครื่องสูงสุด',
    tip: 'ตัวกันสุดท้าย: เครื่องถูกปิดเมื่อเปิดครบเวลานี้แม้ยังมีงาน (งานที่ถูกตัดส่งไปเครื่องใหม่) · กันเครื่องที่หลุดการติดตามคิดเงินค้าง',
    category: 'gpu', input: 'number', unit: 'นาที', managedAt: GPU_PAGE,
  },
  gpu_warmup_timeout_minutes: {
    label: 'รอเครื่องพร้อมสูงสุด',
    tip: 'เวลาให้เครื่องใหม่ติดตั้ง ComfyUI และโหลดโมเดล (H3 ~42 GB) ถ้าเกินจะปิดทิ้งแล้วเช่าใหม่ · ที่วัดได้จริงบูตเสร็จ ~2 นาที',
    category: 'gpu', input: 'number', unit: 'นาที', managedAt: GPU_PAGE,
  },
  gpu_job_timeout_minutes: {
    label: 'เรนเดอร์นานสุดต่องาน',
    tip: 'เกินแล้วยกเลิกงานนั้นและคืนเครดิต · H3 คลิป 15 วิ 720p ใช้ ~10 นาที · 1080p 15 วิคาดว่า 34–37 นาที (เกิน 30)',
    category: 'gpu', input: 'number', unit: 'นาที', managedAt: GPU_PAGE,
  },
  gpu_provider: { label: 'ผู้ให้เช่าเจ้าแรกที่ตั้งค่า', tip: 'ค่าจากตอนที่มีผู้ให้เช่าเจ้าเดียว — ใช้แทนรายชื่อผู้ให้เช่าเมื่อยังไม่มี gpu_providers · รายชื่อที่ระบบเช่าได้จริงดูที่ gpu_providers', category: 'gpu', input: 'text', readOnly: true },
  gpu_region: {
    label: 'จำกัดภูมิภาคของเครื่อง',
    tip: 'เว้นว่าง = เลือกจากทุกภูมิภาค (ถูกสุดที่ผ่านเงื่อนไข) · ใส่เมื่ออยากได้เครื่องในภูมิภาคที่กำหนดเท่านั้น — ตัวเลือกน้อยลงอาจเช่าไม่ได้',
    category: 'gpu',
    input: 'text',
  },
  gpu_worker_profiles: {
    label: 'ค่าเครื่องเฉพาะโมเดล (ขั้นสูง)',
    tip: 'JSON ทับค่าเริ่มต้นของแต่ละโมเดล (image, tag, env, workflow) · ปกติให้เป็น {} เพราะค่าเริ่มต้นใช้งานได้อยู่แล้ว · JSON ผิดรูปแบบจะบันทึกไม่ได้',
    category: 'gpu',
    input: 'json',
  },

  // ── แจ้งเตือน ──────────────────────────────────────────────────────────
  notify_telegram_bot_token: {
    label: 'Bot token ของ Telegram',
    tip: 'เก็บแบบเข้ารหัส ไม่แสดงและแก้ที่หน้านี้ไม่ได้ — ตั้งค่าที่การ์ด "แจ้งเตือนผ่าน Telegram" หน้า GPU',
    category: 'notify', input: 'text', secret: true, managedAt: GPU_PAGE,
  },
  notify_telegram_chat_id: {
    label: 'Chat ID ที่รับแจ้งเตือน',
    tip: 'เลขแชทผู้รับ (กลุ่มขึ้นต้นด้วย -) หลายที่คั่นด้วยจุลภาค · แก้พร้อมทดสอบส่งได้ที่หน้า GPU',
    category: 'notify', input: 'text', managedAt: GPU_PAGE,
  },
  notify_daily_report_last: { label: 'ส่งรายงานประจำวันล่าสุด', tip: 'วันที่ (เวลาไทย) ที่ส่งรายงาน 09:00 สำเร็จล่าสุด — ระบบบันทึกเอง', category: 'notify', input: 'text', readOnly: true },
  notify_alert_state: { label: 'ประวัติการส่งแจ้งเตือนด่วน', tip: 'เวลาที่ส่งแจ้งเตือนแต่ละเรื่องล่าสุด ใช้กันส่งเรื่องเดิมซ้ำถี่ ๆ (เช่น ปิดเครื่องไม่ได้ แจ้งชั่วโมงละครั้ง) — ระบบบันทึกเอง เก็บ 7 วัน', category: 'notify', input: 'json', readOnly: true },

  // ── แอปมือถือ ──────────────────────────────────────────────────────────
  mobile_min_supported_version: {
    label: 'เวอร์ชันแอปต่ำสุดที่ใช้ได้',
    tip: 'แอปที่เก่ากว่านี้จะถูกบังคับให้อัปเดตก่อนใช้งาน — ใช้ถอดบิลด์ที่มีปัญหาออกจากเครื่องลูกค้าได้โดยไม่ต้องออกเวอร์ชันใหม่ · รูปแบบ 1.4.0 · เว้นว่าง = ไม่บังคับ',
    category: 'mobile',
    input: 'text',
  },

  // ── Workflow และผู้ช่วยพรอมต์ ─────────────────────────────────────────
  prompt_enhancer_provider: { label: 'ผู้ช่วยพรอมต์ · ผู้ให้บริการ', tip: 'auto = ใช้เจ้าแรกที่มีคีย์ (OpenAI → MiniMax → BytePlus) · off = ใช้กฎพื้นฐานอย่างเดียว', category: 'workflows', input: 'text', managedAt: WORKFLOW_PAGE },
  prompt_enhancer_model: { label: 'ผู้ช่วยพรอมต์ · ชื่อโมเดล', tip: 'เว้นว่าง = ใช้ค่าเริ่มต้นของผู้ให้บริการ', category: 'workflows', input: 'text', managedAt: WORKFLOW_PAGE },
  prompt_enhancer_h3_context_ir: { label: 'ผู้ช่วยพรอมต์ · ใช้ H3-Context-IR ของ MiniMax', tip: 'สำหรับ MiniMax H3 ที่เช่าเครื่องรันเอง ใช้ระบบเรียบเรียงพรอมต์ทางการของ MiniMax (ต้องมีคีย์ MiniMax)', category: 'workflows', input: 'boolean', managedAt: WORKFLOW_PAGE },
  prompt_enhancer_hourly_limit: { label: 'ผู้ช่วยพรอมต์ · จำกัดต่อคนต่อชั่วโมง', tip: '0 = ปิดสำหรับลูกค้า (แอดมินใช้ได้เสมอ)', category: 'workflows', input: 'number', managedAt: WORKFLOW_PAGE },
  prompt_enhancer_instructions_image: { label: 'ผู้ช่วยพรอมต์ · คำสั่งสำหรับภาพ', tip: 'เว้นว่าง = ใช้คำสั่งในตัว', category: 'workflows', input: 'text', managedAt: WORKFLOW_PAGE },
  prompt_enhancer_instructions_video: { label: 'ผู้ช่วยพรอมต์ · คำสั่งสำหรับวิดีโอ', tip: 'เว้นว่าง = ใช้คำสั่งในตัว', category: 'workflows', input: 'text', managedAt: WORKFLOW_PAGE },
  prompt_enhancer_instructions_audio: { label: 'ผู้ช่วยพรอมต์ · คำสั่งสำหรับเพลง', tip: 'เว้นว่าง = ใช้คำสั่งในตัว', category: 'workflows', input: 'text', managedAt: WORKFLOW_PAGE },

  // ── การสร้างงาน (ยังไม่ได้เชื่อม) ─────────────────────────────────────
  max_prompt_length: { label: 'ความยาวพรอมต์สูงสุด', tip: `${UNUSED_TIP} — เพดานจริง 10,000 ตัวอักษรอยู่ในโค้ด`, category: 'generation', input: 'number', unit: 'ตัวอักษร', unused: true },
  max_concurrent_generations: { label: 'สร้างพร้อมกันสูงสุดต่อคน', tip: UNUSED_TIP, category: 'generation', input: 'number', unused: true },
  max_generations_per_day: { label: 'สร้างสูงสุดต่อวันต่อคน', tip: UNUSED_TIP, category: 'generation', input: 'number', unused: true },
  default_image_model: { label: 'โมเดลภาพเริ่มต้น', tip: UNUSED_TIP, category: 'generation', input: 'text', unused: true },
  default_video_model: { label: 'โมเดลวิดีโอเริ่มต้น', tip: UNUSED_TIP, category: 'generation', input: 'text', unused: true },
  auto_save_to_gallery: { label: 'บันทึกลงแกลเลอรีอัตโนมัติ', tip: `${UNUSED_TIP} — ผลงานถูกบันทึกทุกชิ้นอยู่แล้ว`, category: 'generation', input: 'boolean', unused: true },
  nsfw_filter_enabled: { label: 'ตัวกรองเนื้อหาไม่เหมาะสม', tip: `${UNUSED_TIP} — สวิตช์นี้ไม่ได้กรองอะไร`, category: 'generation', input: 'boolean', unused: true },
  watermark_enabled: { label: 'ลายน้ำ', tip: `${UNUSED_TIP} — ไม่มีการใส่ลายน้ำ`, category: 'generation', input: 'boolean', unused: true },

  // ── จำกัดการใช้งาน (ยังไม่ได้เชื่อม) ──────────────────────────────────
  rate_limit_per_minute: { label: 'จำกัดต่อนาที', tip: `${UNUSED_TIP} — เพดานจริงอยู่ในโค้ดของแต่ละ API`, category: 'rate_limit', input: 'number', unused: true },
  rate_limit_per_hour: { label: 'จำกัดต่อชั่วโมง', tip: UNUSED_TIP, category: 'rate_limit', input: 'number', unused: true },
  cooldown_after_errors: { label: 'พักคีย์หลังผิดพลาด', tip: `${UNUSED_TIP} — ตั้งต่อคีย์ได้ที่หน้า Pool`, category: 'rate_limit', input: 'number', unit: 'วินาที', unused: true },
  max_consecutive_errors: { label: 'ผิดพลาดติดกันสูงสุด', tip: UNUSED_TIP, category: 'rate_limit', input: 'number', unused: true },

  // ── เชื่อมต่อภายนอก (ยังไม่ได้เชื่อม) ─────────────────────────────────
  xman_webhook_enabled: { label: 'Webhook ไป XMAN', tip: UNUSED_TIP, category: 'integration', input: 'boolean', unused: true },
  google_drive_enabled: { label: 'Google Drive', tip: UNUSED_TIP, category: 'integration', input: 'boolean', unused: true },
  google_analytics_id: { label: 'Google Analytics ID', tip: UNUSED_TIP, category: 'integration', input: 'text', unused: true },

  // ── ข้อมูลระบบ ─────────────────────────────────────────────────────────
  setup_completed: { label: 'ติดตั้งระบบเสร็จแล้ว', tip: 'ระบบตั้งเป็นเปิดหลังติดตั้งครั้งแรกเสร็จ — ใช้กันหน้า /setup ถูกเปิดซ้ำ', category: 'system', input: 'boolean', readOnly: true },
  seed_version: { label: 'เวอร์ชันข้อมูลตั้งต้น', tip: 'เวอร์ชันของชุดข้อมูลที่ seed ลงฐานข้อมูล', category: 'system', input: 'text', readOnly: true },
  gpu_last_sweep_at: { label: 'กวาดเครื่องตกค้างล่าสุด', tip: 'เวลาที่ระบบค้นหาเครื่องที่หลุดการติดตามครั้งล่าสุด (ทุก 30 นาทีตอนว่าง)', category: 'system', input: 'text', readOnly: true },
  gpu_provider_balance: { label: 'ยอดเงินผู้ให้เช่าล่าสุด', tip: 'ยอดที่อ่านจากทุกเจ้าที่มีคีย์ล่าสุด (อ่านทุก ≤5 นาที) และสถานะการแจ้งเตือน — ปิดรับงานเฉพาะเมื่อไม่มีเจ้าไหนมีเงินพอเช่า', category: 'system', input: 'json', readOnly: true },
  gpu_offer_penalties: { label: 'เครื่องที่ระบบเลี่ยงชั่วคราว', tip: 'ข้อเสนอเครื่องที่บูตไม่ขึ้นหรือถูกผู้ให้เช่าปฏิเสธ ระบบเลี่ยงไว้ชั่วคราวแล้วหมดอายุเอง — ระบบบันทึกเอง', category: 'system', input: 'json', readOnly: true },
  gpu_card_penalties: { label: 'รุ่นการ์ดที่เลี่ยงต่อโมเดล', tip: 'รุ่นการ์ดที่เรนเดอร์โมเดลนั้นไม่ได้ (เช่น VRAM ไม่พอ) ระบบเลี่ยงไว้ 1 วัน — ระบบบันทึกเอง', category: 'system', input: 'json', readOnly: true },
  gpu_pending_rentals: { label: 'คำสั่งเช่าที่ยังยืนยันไม่ได้', tip: 'ผู้ให้เช่ารับคำสั่งแล้วแต่ระบบยังหาเครื่องไม่เจอ — รอบกวาดจะตามหาและปิดเครื่องนั้นเอง · ระบบบันทึกเอง', category: 'system', input: 'json', readOnly: true },
  gpu_tick_lock: { label: 'ล็อกรอบทำงาน GPU', tip: 'กันรอบจัดคิวและเช่าเครื่องทำงานซ้อนกัน หมดอายุเอง — ระบบบันทึกเอง ห้ามแก้', category: 'system', input: 'text', readOnly: true },
};

/** Keys the system writes per model: `gpu_presence_<model>` (studio-presence.ts). */
export const PRESENCE_PREFIX = 'gpu_presence_';

/** `gpu_prewarm_demand_<model>`: a customer with credits just arrived (studio-presence.ts). */
export const PREWARM_DEMAND_PREFIX = 'gpu_prewarm_demand_';

/** Keys /admin/workflows writes per model (workflow-overrides.ts). */
const WORKFLOW_KEY_LABELS: [prefix: string, label: string, tip: string, readOnly: boolean][] = [
  ['wf_override_', 'ค่าปรับแต่ง workflow', 'ค่าที่แอดมินปรับให้ workflow ComfyUI ของโมเดลนี้ (มีเวอร์ชันและย้อนกลับได้)', false],
  ['wf_history_', 'ประวัติการปรับ workflow', 'เวอร์ชันก่อนหน้าของค่าปรับแต่ง เก็บ 20 เวอร์ชันล่าสุดไว้ย้อนกลับ', false],
  ['wf_schema_', 'schema โหนดจากเครื่องจริง', 'รายการโหนดของ ComfyUI ที่เครื่องเช่าส่งมา ใช้ตรวจกราฟก่อนบันทึกโดยไม่ต้องเช่าเครื่อง — ระบบบันทึกเอง', true],
  ['wf_last_graph_', 'กราฟล่าสุดที่ส่งเข้าเครื่อง', 'กราฟ API ที่งานล่าสุดของโมเดลนี้ส่งเข้า ComfyUI จริง — ระบบบันทึกเอง', true],
];

/** Metadata for a key, including the generated presence keys. Null for unknown keys. */
export function settingMeta(key: string): SettingMeta | null {
  const known = SETTINGS_CATALOG[key];
  if (known) return known;
  for (const [prefix, label, tip, readOnly] of WORKFLOW_KEY_LABELS) {
    if (key.startsWith(prefix)) {
      return {
        label: `${label} · ${key.slice(prefix.length)}`,
        tip,
        category: 'workflows',
        input: 'json',
        ...(readOnly ? { readOnly: true } : { managedAt: WORKFLOW_PAGE }),
      };
    }
  }
  if (key.startsWith(PRESENCE_PREFIX)) {
    return {
      label: `ลูกค้าเปิดสตูดิโอล่าสุด · ${key.slice(PRESENCE_PREFIX.length)}`,
      tip: 'เวลาล่าสุดที่มีลูกค้าเปิดหน้าสร้างงานของโมเดลนี้ — ใช้ยืดเวลาปิดเครื่องที่ว่าง',
      category: 'system',
      input: 'text',
      readOnly: true,
    };
  }
  if (key.startsWith(PREWARM_DEMAND_PREFIX)) {
    return {
      label: `ลูกค้ามีเครดิตเพิ่งเข้าสตูดิโอ · ${key.slice(PREWARM_DEMAND_PREFIX.length)}`,
      tip: 'เวลาล่าสุดที่ลูกค้าที่มีเครดิตพอสั่งงานเพิ่งเข้าหน้าสร้างงานของโมเดลนี้ — ใช้ตัดสินใจเปิดเครื่องรอก่อนสั่ง',
      category: 'system',
      input: 'text',
      readOnly: true,
    };
  }
  return null;
}

/**
 * Why the generic settings API must not write this key, in Thai, or null if it
 * may. Secrets and managed keys go through their own validated paths.
 */
export function settingWriteBlock(key: string, type?: string | null): string | null {
  const meta = settingMeta(key);
  if (type === 'encrypted' || meta?.secret) return 'ค่านี้เก็บแบบเข้ารหัส แก้ได้ที่หน้าที่ตั้งค่านั้นเท่านั้น';
  if (meta?.readOnly) return 'ค่านี้ระบบบันทึกเอง แก้ไม่ได้';
  if (meta?.managedAt) return `ค่านี้${meta.managedAt.label} (${meta.managedAt.href})`;
  return null;
}

/** Validate a value for a known key. Returns Thai error text, or null when fine. */
export function validateSettingValue(key: string, value: string | null): string | null {
  const meta = settingMeta(key);
  if (!meta || value == null || value === '') return null;
  if (meta.input === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return `${meta.label}: ต้องเป็นตัวเลข`;
    if (meta.min != null && n < meta.min) return `${meta.label}: ต่ำสุด ${meta.min}`;
    if (meta.max != null && n > meta.max) return `${meta.label}: สูงสุด ${meta.max}`;
  }
  if (meta.input === 'boolean' && value !== 'true' && value !== 'false') return `${meta.label}: ต้องเป็น true หรือ false`;
  if (meta.input === 'json') {
    try {
      JSON.parse(value);
    } catch {
      return `${meta.label}: JSON ไม่ถูกต้อง`;
    }
  }
  if (key === 'mobile_min_supported_version' && !/^\d+(\.\d+)*$/.test(value.trim())) {
    return `${meta.label}: ใช้ตัวเลขคั่นจุด เช่น 1.4.0`;
  }
  return null;
}
