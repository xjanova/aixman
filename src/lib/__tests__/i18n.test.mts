/**
 * The site's two languages: which one a visitor gets, the translator, and
 * messages stored on a row in both languages.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/i18n.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCredits, formatDate, formatThb, localeFromCookieHeader, negotiateLocale, pick, requestLocale, translator,
} from '@/lib/i18n/locale';
import {
  UserMessageError, messageFor, packMsg, packMsgWithin, readStoredMessage, registerStoredMsgs,
} from '@/lib/i18n/messages';
import { OrderRefusedError } from '@/lib/services/order-refusal';

test('a first visit follows Accept-Language, else Thai', () => {
  assert.equal(negotiateLocale(null), 'th');
  assert.equal(negotiateLocale(''), 'th');
  assert.equal(negotiateLocale('en-US,en;q=0.9'), 'en');
  assert.equal(negotiateLocale('th-TH,th;q=0.9,en;q=0.8'), 'th');
  assert.equal(negotiateLocale('en-US;q=0.8, th;q=0.9'), 'th');
  assert.equal(negotiateLocale('ja,en;q=0.5'), 'en');
  assert.equal(negotiateLocale('ja,zh;q=0.5'), 'th');
  assert.equal(negotiateLocale('en;q=0'), 'th');
  // Equal weight: the one listed first.
  assert.equal(negotiateLocale('en, th'), 'en');
});

test('the cookie names the choice; anything else is ignored', () => {
  assert.equal(localeFromCookieHeader('a=1; aixman-locale=en; b=2'), 'en');
  assert.equal(localeFromCookieHeader('aixman-locale=th'), 'th');
  assert.equal(localeFromCookieHeader('aixman-locale=fr'), null);
  assert.equal(localeFromCookieHeader('x-aixman-locale=en'), null);
  assert.equal(localeFromCookieHeader(null), null);
});

test('an API answers in the cookie language, then X-Locale, else Thai — never Accept-Language', () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
  assert.equal(requestLocale(req({ cookie: 'aixman-locale=en' })), 'en');
  assert.equal(requestLocale(req({ 'x-locale': 'EN' })), 'en');
  assert.equal(requestLocale(req({ cookie: 'aixman-locale=th', 'x-locale': 'en' })), 'th');
  // The mobile app: no cookie, a device header — keeps its Thai.
  assert.equal(requestLocale(req({ 'accept-language': 'en-US' })), 'th');
});

test('the translator takes a pair or two arguments', () => {
  const th = translator('th');
  const en = translator('en');
  assert.equal(th('ภาพ', 'Image'), 'ภาพ');
  assert.equal(en('ภาพ', 'Image'), 'Image');
  assert.equal(en({ th: 'ภาพ', en: 'Image' }), 'Image');
  assert.equal(en('XMAN'), 'XMAN');
  // An empty English is still an answer, not a missing one.
  assert.equal(en('ภาพ', ''), '');
  assert.equal(pick({ th: 1, en: 2 }, 'en'), 2);
});

test('formats: Thai keeps the Buddhist year, English the Gregorian', () => {
  const day = new Date('2026-10-29T12:00:00Z');
  assert.match(formatDate(day, 'th'), /2569/);
  assert.match(formatDate(day, 'en'), /29 Oct 2026/);
  assert.equal(formatCredits(1, 'en'), '1 credit');
  assert.equal(formatCredits(1500, 'en'), '1,500 credits');
  assert.equal(formatCredits(1500, 'th'), '1,500 เครดิต');
  assert.equal(formatThb(399, 'en'), '฿399');
  assert.equal(formatThb(12.5, 'th'), '฿12.50');
});

test('an error a customer reads answers in their language', () => {
  const pair = { th: 'ใส่ข้อความก่อน', en: 'Type the text first' };
  assert.equal(messageFor(new UserMessageError(pair), 'en'), 'Type the text first');
  assert.equal(new UserMessageError(pair).message, 'ใส่ข้อความก่อน');
  const refused = new OrderRefusedError(pair, 'missing-text', 422);
  assert.equal(refused.message, 'ใส่ข้อความก่อน');
  assert.equal(messageFor(refused, 'en'), 'Type the text first');
  assert.equal(messageFor(new Error('Insufficient credits'), 'th'), 'Insufficient credits');
});

test('a stored message carries both languages and survives a column cut', () => {
  const pair = { th: 'ระบบขัดข้อง กรุณาลองใหม่', en: 'Something went wrong. Please try again.' };
  const packed = packMsg(pair);
  assert.equal(readStoredMessage(packed, 'th'), pair.th);
  assert.equal(readStoredMessage(packed, 'en'), pair.en);
  const cut = packMsgWithin({ th: 'ก'.repeat(800), en: 'e'.repeat(800) }, 1000);
  assert.ok(cut.length <= 1000);
  assert.match(readStoredMessage(cut, 'en') ?? '', /^e+$/);
  assert.match(readStoredMessage(cut, 'th') ?? '', /^ก+$/);
  assert.equal(readStoredMessage(null, 'en'), null);
});

test('an old Thai-only row is translated when its message is known', () => {
  registerStoredMsgs(
    { th: 'ใช้เวลานานเกินกำหนด', en: 'It took too long.' },
    { th: '(คืนเครดิตแล้ว)', en: '(credits refunded)' },
  );
  assert.equal(readStoredMessage('ใช้เวลานานเกินกำหนด', 'en'), 'It took too long.');
  assert.equal(readStoredMessage('ใช้เวลานานเกินกำหนด (คืนเครดิตแล้ว)', 'en'), 'It took too long. (credits refunded)');
  assert.equal(readStoredMessage('ใช้เวลานานเกินกำหนด (คืนเครดิตแล้ว)', 'th'), 'ใช้เวลานานเกินกำหนด (คืนเครดิตแล้ว)');
  // Unknown text (a vendor's raw reason) is left as it is.
  assert.equal(readStoredMessage('upstream said no', 'en'), 'upstream said no');
});

test('credit packages typed in Thai read in English', async () => {
  const { packageFeatures, packageLabel, packageTextEn } = await import('@/lib/i18n/package-text');
  // What the live packages hold (GET /api/packages, 2026-10-29).
  const live = [
    '20 เครดิตฟรี', 'ภาพ ~5-7 ภาพ', 'วิดีโอ ~1 คลิป', 'สำหรับสมาชิกใหม่', '100 เครดิต', 'ภาพ ~25-33 ภาพ', 'วิดีโอ ~5-8 คลิป',
    'ไม่มีวันหมดอายุ', '500 + 50 โบนัส เครดิต', 'ภาพ ~137 ภาพ', 'ประหยัด 20%', '1,500 + 250 โบนัส เครดิต', 'ภาพ ~1,625 ภาพ', 'ซัพพอร์ตพิเศษ',
  ];
  for (const line of live) assert.notEqual(packageTextEn(line), null, line);
  assert.equal(packageTextEn('20 เครดิตฟรี'), '20 free credits');
  assert.equal(packageTextEn('500 + 50 โบนัส เครดิต'), '500 + 50 bonus credits');
  assert.equal(packageTextEn('ภาพ ~25-33 ภาพ'), '~25-33 images');
  assert.equal(packageTextEn('วิดีโอ ~433 คลิป'), '~433 videos');
  assert.equal(packageTextEn('ประหยัด 33%'), 'Save 33%');
  assert.equal(packageLabel('ทดลองใช้', 'en'), 'Trial');
  assert.equal(packageLabel('Creator', 'en'), 'Creator');
  assert.equal(packageLabel('ยอดนิยม', 'th'), 'ยอดนิยม');
  assert.equal(packageLabel(null, 'en'), null);
  // A line nobody taught it is dropped from the English page, kept on the Thai.
  assert.deepEqual(packageFeatures(['ไม่มีวันหมดอายุ', 'สิทธิ์พิเศษลับ'], 'en'), ['Never expires']);
  assert.deepEqual(packageFeatures(['สิทธิ์พิเศษลับ'], 'th'), ['สิทธิ์พิเศษลับ']);
});

test('package counts read singular for one', async () => {
  const { packageTextEn } = await import('@/lib/i18n/package-text');
  assert.equal(packageTextEn('วิดีโอ ~1 คลิป'), '~1 video');
  assert.equal(packageTextEn('ภาพ ~1 ภาพ'), '~1 image');
  assert.equal(packageTextEn('1 เครดิต'), '1 credit');
  assert.equal(packageTextEn('วิดีโอ ~5-8 คลิป'), '~5-8 videos');
});

test('every Thai refusal GenerationService throws as a literal has an English', async () => {
  const { readFileSync } = await import('node:fs');
  const { hasRefusalEn } = await import('@/lib/i18n/refusal-en');
  const source = readFileSync('src/lib/services/generation.ts', 'utf8');
  const thai = /[฀-๿]/;
  const missing: string[] = [];
  for (const call of source.matchAll(/OrderRefusedError\(\s*([^;]*?),\s*(?:'[a-z-]+'|[\w.]+),\s*\d{3}\s*\)/g)) {
    for (const literal of call[1].matchAll(/'([^'\n]+)'/g)) {
      if (thai.test(literal[1]) && !hasRefusalEn(literal[1])) missing.push(literal[1]);
    }
  }
  assert.deepEqual(missing, [], 'add these to src/lib/i18n/refusal-en.ts, or throw a { th, en } pair');
});

test('every refusal the Suno tools give before charging has an English', async () => {
  const { hasRefusalEn } = await import('@/lib/i18n/refusal-en');
  const { checkSunoSource, sunoMissingSource } = await import('@/lib/providers/kie-suno');
  const tools = ['song', 'cover', 'extend', 'add-vocals', 'add-instrumental', 'stems', 'sounds'] as const;
  const shapes = [
    { seconds: 0, bytes: 1 }, // unreadable
    { seconds: 60, bytes: 30 * 1024 * 1024 }, // too large to split
    { seconds: 9 * 60 + 5, bytes: 1 }, // too long
    { seconds: 1, bytes: 1 }, // too short to extend
  ];
  const missing: string[] = [];
  for (const tool of tools) {
    if (!hasRefusalEn(sunoMissingSource(tool))) missing.push(sunoMissingSource(tool));
    for (const facts of shapes) {
      const check = checkSunoSource(tool, facts, {});
      if (!check.ok && !hasRefusalEn(check.message)) missing.push(check.message);
    }
  }
  assert.deepEqual(missing, [], 'add these to src/lib/i18n/refusal-en.ts');
});

test('a Thai refusal answers in English by its text, its figures, else its code', () => {
  const en = (message: string, code: string) => messageFor(new OrderRefusedError(message, code, 422), 'en');
  assert.equal(en('ต้องอัปโหลดภาพที่จะแก้ก่อน', 'missing-image'), 'Upload the picture to edit first.');
  assert.equal(en('โมเดลนี้รับภาพอ้างอิงได้สูงสุด 4 ภาพ', 'too-many-references'), 'This model takes at most 4 reference pictures.');
  assert.equal(
    en('ข้อความยาวเกินไป (5,200 ตัวอักษร) — โมเดลนี้อ่านได้ครั้งละไม่เกิน 5,000 ตัวอักษร', 'text-too-long'),
    'The text is too long (5,200 characters) — this model reads at most 5,000 characters at a time.'
  );
  assert.equal(en('ข้อความใหม่ที่ยังไม่มีคำแปล', 'missing-audio'), 'Upload the audio this model needs first.');
  assert.equal(en('ข้อความใหม่ที่ยังไม่มีคำแปล', 'no-such-code'), 'ข้อความใหม่ที่ยังไม่มีคำแปล');
  assert.equal(messageFor(new OrderRefusedError('ต้องอัปโหลดภาพที่จะแก้ก่อน', 'missing-image', 422), 'th'), 'ต้องอัปโหลดภาพที่จะแก้ก่อน');
});
