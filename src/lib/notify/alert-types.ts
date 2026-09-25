/**
 * Every alert AIXMAN sends admins on Telegram — listed on /admin/gpu so the
 * owner knows what to expect, and used by alerts.ts to format them.
 *
 * Client-safe: no imports.
 */

export type AlertLevel = 'critical' | 'warning' | 'info' | 'resolved';

export interface AlertType {
  id: string;
  level: AlertLevel;
  /** What happened, in Thai. */
  title: string;
  /** When it is sent, and how often at most. */
  when: string;
  /** Sent as a picture card rather than text. */
  card?: boolean;
}

export const ALERT_ICON: Record<AlertLevel, string> = {
  critical: '🔴',
  warning: '🟠',
  info: 'ℹ️',
  resolved: '✅',
};

export const ALERT_LABEL: Record<AlertLevel, string> = {
  critical: 'ด่วน',
  warning: 'เตือน',
  info: 'แจ้ง',
  resolved: 'กลับมาปกติ',
};

export const ALERT_TYPES: AlertType[] = [
  // Money is burning or customers are blocked — act now.
  { id: 'balance', level: 'critical', title: 'ยอดเงินผู้ให้เช่า GPU ใกล้หมด / ไม่พอเช่า / กลับมาปกติ', when: 'เมื่อเปลี่ยนสถานะ และเตือนซ้ำทุก 6 ชม. ถ้ายังไม่เติม', card: true },
  { id: 'terminate-failed', level: 'critical', title: 'ปิดเครื่องไม่สำเร็จ — เครื่องอาจยังคิดเงินอยู่', when: 'เมื่อผู้ให้เช่าปฏิเสธคำสั่งปิด (ซ้ำได้ทุก 1 ชม. จนกว่าจะปิดได้)' },
  { id: 'rent-unconfirmed', level: 'critical', title: 'สั่งเช่าแล้วยืนยันไม่ได้ — อาจมีเครื่องคิดเงินที่ไม่มีใครใช้', when: 'ทันที' },
  { id: 'model-demoted', level: 'critical', title: 'โมเดลถูกปิดรับงาน เพราะล้มติดกัน 3 ครั้ง', when: 'ทันที · และแจ้งอีกครั้งเมื่อเปิดรับงานคืน' },
  { id: 'config-error', level: 'critical', title: 'ตั้งค่าระบบเช่าผิด (R2 หาย / ไม่มีคีย์ / โปรไฟล์เครื่องผิด) — คืนเครดิตทั้งคิว', when: 'ทันที (ซ้ำได้ทุก 1 ชม.)' },
  { id: 'no-accounts', level: 'critical', title: 'ผู้ให้บริการ AI ไม่มีคีย์ที่ใช้ได้ — ลูกค้าสั่งงานโมเดลนั้นไม่ได้', when: 'ครั้งแรกที่ลูกค้าโดนปฏิเสธ (ซ้ำได้ทุก 1 ชม.)' },
  { id: 'gpux-earning-expiring', level: 'critical', title: 'รายได้ของงานเครื่องชุมชน (GPUxMINE) ยังไม่ถูกบันทึก และจะหลุดจากรอบตรวจภายใน 24 ชม.', when: 'ทุก 6 ชม. ขณะยังมีงานใกล้หลุด' },
  // Something went wrong and was handled, but deserves a look.
  { id: 'budget', level: 'warning', title: 'งบค่าเครื่องวันนี้ใช้ถึง 80% / หมดแล้ว (หยุดเช่าใหม่จนขึ้นวันใหม่)', when: 'วันละครั้งต่อระดับ' },
  { id: 'boot-failed', level: 'warning', title: 'เครื่องบูตไม่สำเร็จ / บูตไม่เสร็จในเวลา', when: 'ทุกเครื่องที่บูตพัง' },
  { id: 'render-unrecorded', level: 'warning', title: 'ส่งงานเข้าเครื่องแล้วบันทึกฐานข้อมูลไม่ได้ — ปิดเครื่องนั้น ส่งงานไปเครื่องอื่น', when: 'ทันที' },
  { id: 'stuck-refund', level: 'warning', title: 'งานรอเครื่องนานเกินกำหนด — ยกเลิกและคืนเครดิต', when: 'เมื่อมีงานถูกคืนเครดิต (สรุปไม่เกินชั่วโมงละครั้ง)' },
  { id: 'failure-burst', level: 'warning', title: 'งานล้มตั้งแต่ 3 งานขึ้นไปใน 30 นาที', when: 'ซ้ำได้ทุก 1 ชม.' },
  { id: 'orphans', level: 'warning', title: 'พบเครื่องตกค้างที่ระบบไม่ได้ติดตาม — ปิดให้แล้ว', when: 'ทุกครั้งที่กวาดเจอ' },
  { id: 'content-blocked', level: 'warning', title: 'ปฏิเสธคำสั่งที่เข้าข่ายเนื้อหาต้องห้าม (ข้อกำหนด ข้อ 6) — ไม่หักเครดิต ไม่เก็บคำสั่ง', when: 'ต่อบัญชี ไม่เกินทุก 1 ชม.' },
  { id: 'gpux-earning', level: 'warning', title: 'บันทึกรายได้ของเครื่องชุมชน (GPUxMINE) ไม่ได้ — ระบบลองใหม่เองภายใน 30 วัน (GPUXMINE_EARNINGS_SWEEP_DAYS)', when: 'ต่อสาเหตุ ไม่เกินทุก 1 ชม.' },
  { id: 'gpux-output-rejected', level: 'warning', title: 'เครื่องชุมชนส่งไฟล์ที่ไม่ใช่ผลงาน — ไม่ส่งให้ลูกค้า ส่งงานไปเครื่องอื่น ไม่จ่ายเงินเครื่องนั้น', when: 'ต่อเครื่อง ไม่เกินทุก 1 ชม.' },
  { id: 'workflow-fallback', level: 'warning', title: 'กราฟ ComfyUI ที่แอดมินแก้ใช้กับเครื่องจริงไม่ได้ — ใช้ workflow มาตรฐานแทน (ลูกค้าไม่เสียงาน)', when: 'ต่อโมเดล ไม่เกินทุก 6 ชม.' },
  // For the record.
  { id: 'emergency-stop', level: 'info', title: 'แอดมินกด "หยุดทั้งหมด"', when: 'ทุกครั้ง' },
  { id: 'daily-report', level: 'info', title: 'รายงานประจำวัน', when: 'ทุกเช้า 09:00 (เวลาไทย)', card: true },
];

/** The Telegram text for an alert: level, title, one bullet per detail line. */
export function formatAlert(level: AlertLevel, title: string, lines: (string | null | undefined)[] = [], link?: string): string {
  const body = lines
    .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
    .map((l) => `• ${l.length > 300 ? `${l.slice(0, 299)}…` : l}`);
  return [`${ALERT_ICON[level]} AIXMAN · ${ALERT_LABEL[level]} — ${title}`, ...body, ...(link ? [link] : [])].join('\n');
}
