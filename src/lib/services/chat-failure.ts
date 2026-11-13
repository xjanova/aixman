import type { Msg } from '@/lib/i18n/locale';

/** The words that depend on what the customer was asking the AI to write. */
export interface ChatFailureWords {
  /** The model answered with nothing usable. */
  noAnswer: Msg;
  /** No engine has a key. */
  notConnected: Msg;
}

/**
 * Why a chat engine gave no answer, in words for the customer. The chat layer's
 * own text names providers and quotes their replies, so it stays in the server
 * log; the customer is still always told the reason. Several engines answer at
 * once here, and the last ones in `auto` usually just have no key, so the real
 * failures are looked for before "no key".
 */
export function chatFailure(reason: string, words: ChatFailureWords): Msg {
  if (reason.includes('ปิดผู้ช่วย AI')) return { th: 'ผู้ดูแลปิดผู้ช่วย AI ไว้ในขณะนี้', en: 'An admin has switched the AI assistant off for now.' };
  if (/abort|timed? ?out/i.test(reason)) return { th: 'AI ตอบช้าเกินเวลาที่รอได้ ลองกดใหม่อีกครั้ง', en: 'The AI took too long to answer. Try again.' };
  if (/ran out of tokens|empty answer|no song sections/i.test(reason)) return words.noAnswer;
  if (/HTTP 429/.test(reason)) return { th: 'มีคนใช้ AI เต็มในขณะนี้ รอสักครู่แล้วลองใหม่', en: 'The AI is at capacity. Wait a moment and try again.' };
  if (/HTTP 40[123]/.test(reason)) return { th: 'บัญชี AI ของระบบใช้งานไม่ได้ในขณะนี้ ผู้ดูแลต้องตรวจคีย์หรือยอดเงิน', en: "The platform's AI account isn't working right now. An admin needs to check its key or balance." };
  if (/no active \w+ key|no chat engine/i.test(reason)) return words.notConnected;
  return { th: 'เชื่อมต่อ AI ไม่สำเร็จ ลองใหม่อีกครั้ง', en: "Couldn't reach the AI. Try again." };
}

/** Why ✨ on the prompt box fell back on the rules. */
export function enhanceFailure(reason: string): Msg {
  return chatFailure(reason, {
    noAnswer: { th: 'AI เขียนพรอมต์ไม่จบ ลองกดใหม่ หรือย่อพรอมต์ให้สั้นลง', en: "The AI couldn't finish the prompt. Try again, or shorten it." },
    notConnected: { th: 'ระบบยังไม่ได้เชื่อมต่อ AI สำหรับปรับพรอมต์', en: "The AI for improving prompts isn't connected yet." },
  });
}
