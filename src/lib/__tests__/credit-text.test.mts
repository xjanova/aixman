/**
 * Credit-history lines in the visitor's language (src/lib/i18n/credit-text.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/credit-text.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditDescription } from '@/lib/i18n/credit-text';

test('the lines our code writes read in English', () => {
  const en = (s: string) => creditDescription(s, 'en');
  assert.equal(en('เครดิตฟรีต้อนรับสมาชิกใหม่'), 'Welcome credits for new members');
  assert.equal(en('ซื้อเครดิต 1000 จาก XMAN Studio'), 'Bought 1,000 credits from XMAN Studio');
  assert.equal(en('โบนัสเครดิต 1 จากการซื้อแพ็กเกจ'), '1 bonus credit with your package');
  assert.equal(en('โบนัส 50 เครดิต'), '50 bonus credits');
  assert.equal(en('ซื้อเครดิต 500 จากกระเป๋า Wallet (ทดลองใช้)'), 'Bought 500 credits with your wallet (Trial)');
  assert.equal(en('โบนัสชวนเพื่อน (รหัส: AB23CD)'), 'Referral bonus (code: AB23CD)');
  assert.equal(en('โบนัสจากรหัสชวนเพื่อน: AB23CD'), 'Bonus for using referral code AB23CD');
  assert.equal(en('ค่าคอมมิชชั่น 10% จากการซื้อของเพื่อนที่ชวน'), '10% commission on a friend’s purchase');
  assert.equal(en('ปรับเครดิตโดยแอดมิน'), 'Adjusted by an admin');
  assert.equal(en('Seedream 4.0 - image generation'), 'Seedream 4.0 - image generation');
  assert.equal(en('ตัดต่อหนัง: รักแรก'), 'Film edit: รักแรก');
  assert.equal(en('คืนเครดิต: ตัดต่อหนังไม่สำเร็จ'), 'Refund: film edit failed');
});

test('Thai keeps what was written, and English-only lines get their Thai', () => {
  const th = (s: string) => creditDescription(s, 'th');
  assert.equal(th('ซื้อเครดิต 1000 จาก XMAN Studio'), 'ซื้อเครดิต 1000 จาก XMAN Studio');
  assert.equal(th('ตัดต่อหนัง: รักแรก'), 'ตัดต่อหนัง: รักแรก');
  assert.equal(th('Purchased 100 credits'), 'ซื้อ 100 เครดิต');
  assert.equal(th('Seedream 4.0 - video generation'), 'Seedream 4.0 - สร้างวิดีโอ');
  assert.equal(th('Auto-refund: generation failed'), 'คืนเครดิตอัตโนมัติ: สร้างงานไม่สำเร็จ');
});

test('anything else is shown as it is', () => {
  assert.equal(creditDescription('ชดเชยระบบล่ม 2 ชม.', 'en'), 'ชดเชยระบบล่ม 2 ชม.');
  assert.equal(creditDescription('API DeepSeek V4 Pro', 'en'), 'API DeepSeek V4 Pro');
  assert.equal(creditDescription('Model - weird generation', 'th'), 'Model - weird generation');
  assert.equal(creditDescription(null, 'en'), null);
  assert.equal(creditDescription('', 'th'), null);
});
