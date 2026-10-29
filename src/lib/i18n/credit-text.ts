import { formatCredits, formatNumber, type Locale, type Msg } from '@/lib/i18n/locale';
import { packageLabel } from '@/lib/i18n/package-text';

/**
 * Credit-history lines (`ai_credit_transactions.description`) in the visitor's
 * language. Each line is written once, in one language, by the code that moved
 * the credits — credits.ts, the xmanstudio webhook, wallet top-ups, referrals,
 * GenerationService, story assembly — and the table is shared with xmanstudio,
 * so it stays as written. The shapes that code writes are matched here, both
 * ways; anything else (an admin's own note, rows from older code) is shown as
 * it is. Pure: the profile page and tests use it.
 */

const GEN_TYPE: Record<string, Msg> = {
  image: { th: 'สร้างภาพ', en: 'image generation' },
  video: { th: 'สร้างวิดีโอ', en: 'video generation' },
  edit: { th: 'แก้ไขภาพ', en: 'image edit' },
  audio: { th: 'สร้างเสียง', en: 'audio generation' },
  model3d: { th: 'สร้างโมเดล 3D', en: '3D generation' },
};

const credits = (n: string) => formatCredits(Number(n), 'en');
const bonusCredits = (n: string) => `${formatNumber(Number(n), 'en')} bonus ${n === '1' ? 'credit' : 'credits'}`;

const SHAPES: [RegExp, (m: RegExpMatchArray) => Msg | null][] = [
  // credits.ts — sign-up gift, a grant's defaults
  [/^เครดิตฟรีต้อนรับสมาชิกใหม่$/, () => ({ th: 'เครดิตฟรีต้อนรับสมาชิกใหม่', en: 'Welcome credits for new members' })],
  [/^Added (\d+) credits$/, (m) => ({ th: `เพิ่ม ${m[1]} เครดิต`, en: `Added ${credits(m[1])}` })],
  [/^Purchased (\d+) credits$/, (m) => ({ th: `ซื้อ ${m[1]} เครดิต`, en: `Bought ${credits(m[1])}` })],
  [/^โบนัส (\d+) เครดิต$/, (m) => ({ th: m[0], en: bonusCredits(m[1]) })],
  // xmanstudio checkout webhook
  [/^ซื้อเครดิต (\d+) จาก XMAN Studio$/, (m) => ({ th: m[0], en: `Bought ${credits(m[1])} from XMAN Studio` })],
  [/^โบนัสเครดิต (\d+) จากการซื้อแพ็กเกจ$/, (m) => ({ th: m[0], en: `${bonusCredits(m[1])} with your package` })],
  // wallet.ts — bought with the shared wallet
  [/^ซื้อเครดิต (\d+) จากกระเป๋า Wallet \(([\s\S]*)\)$/, (m) => ({ th: m[0], en: `Bought ${credits(m[1])} with your wallet (${packageLabel(m[2], 'en')})` })],
  // referral.ts
  [/^โบนัสชวนเพื่อน \(รหัส: (.+)\)$/, (m) => ({ th: m[0], en: `Referral bonus (code: ${m[1]})` })],
  [/^โบนัสจากรหัสชวนเพื่อน: (.+)$/, (m) => ({ th: m[0], en: `Bonus for using referral code ${m[1]}` })],
  [/^ค่าคอมมิชชั่น ([\d.]+)% จากการซื้อของเพื่อนที่ชวน$/, (m) => ({ th: m[0], en: `${m[1]}% commission on a friend’s purchase` })],
  // admin adjustment with no note
  [/^ปรับเครดิตโดยแอดมิน$/, () => ({ th: 'ปรับเครดิตโดยแอดมิน', en: 'Adjusted by an admin' })],
  // GenerationService — the charge and the automatic refund
  [/^([\s\S]+) - ([a-z0-9]+) generation$/, (m) => {
    const kind = GEN_TYPE[m[2]];
    return kind ? { th: `${m[1]} - ${kind.th}`, en: `${m[1]} - ${kind.en}` } : null;
  }],
  [/^Auto-refund: generation failed$/, () => ({ th: 'คืนเครดิตอัตโนมัติ: สร้างงานไม่สำเร็จ', en: 'Auto-refund: creation failed' })],
  // story/assemble.ts — joining a film, and its refund
  [/^ตัดต่อหนัง: ([\s\S]*)$/, (m) => ({ th: m[0], en: `Film edit: ${m[1]}` })],
  [/^คืนเครดิต: ตัดต่อหนังไม่สำเร็จ$/, () => ({ th: 'คืนเครดิต: ตัดต่อหนังไม่สำเร็จ', en: 'Refund: film edit failed' })],
];

/** A credit transaction's description in `locale`; a line of no known shape is returned as it is. */
export function creditDescription(text: string | null | undefined, locale: Locale): string | null {
  if (!text) return null;
  for (const [re, to] of SHAPES) {
    const m = text.match(re);
    if (!m) continue;
    const msg = to(m);
    if (msg) return msg[locale];
  }
  return text;
}
