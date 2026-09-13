import prisma from '@/lib/db';
import { decrypt, encrypt } from '@/lib/utils/encryption';

/**
 * Admin alerts over Telegram.
 *
 * The owner's choice (2026-09-13): a bot can send as many messages as we need,
 * with no monthly push quota to run out of. Alerts are best-effort — a failed
 * send is logged and never breaks the caller, which is usually the GPU tick.
 *
 * The bot token is a secret. It is stored encrypted in `ai_settings` (the
 * project forbids plaintext secrets in `ai_` tables), never returned by any
 * API, and scrubbed from every error — Telegram puts it in the request URL.
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID in the environment are the fallback.
 */

const TOKEN_KEY = 'notify_telegram_bot_token';
const CHAT_KEY = 'notify_telegram_chat_id';
const SETTING_GROUP = 'notify';
const SEND_TIMEOUT_MS = 10_000;
/** Telegram rejects a message over 4096 characters. */
const MAX_TEXT = 4000;

/** BotFather's format: the bot's numeric id, a colon, then the secret part. */
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
/** A user or group id (groups are negative), or a public @channel. */
const CHAT_RE = /^(-?\d{5,}|@[A-Za-z][A-Za-z0-9_]{4,})$/;

export interface TelegramStatus {
  configured: boolean;
  source: 'settings' | 'env' | null;
  /** A token is saved on this page — so the admin knows only the chat is missing. */
  tokenSaved: boolean;
  /** Where alerts go. Not secret — an id is useless without the token. */
  chatIds: string[];
}

interface TelegramConfig {
  token: string;
  chatIds: string[];
  source: 'settings' | 'env';
}

function parseChatIds(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => CHAT_RE.test(s));
}

function scrub(text: string, token: string): string {
  return token ? text.split(token).join('<token>') : text;
}

async function loadConfig(): Promise<TelegramConfig | null> {
  const rows = await prisma.aiSetting.findMany({ where: { key: { in: [TOKEN_KEY, CHAT_KEY] } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const stored = map.get(TOKEN_KEY);
  const storedChats = parseChatIds(map.get(CHAT_KEY));
  if (stored && storedChats.length > 0) {
    try {
      return { token: decrypt(stored), chatIds: storedChats, source: 'settings' };
    } catch {
      // ENCRYPTION_KEY rotated since it was saved. Say so without the value.
      console.error('[telegram] the saved bot token cannot be decrypted — save it again on /admin/gpu');
    }
  }

  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const envChats = parseChatIds(process.env.TELEGRAM_CHAT_ID);
  if (envToken && envChats.length > 0) return { token: envToken, chatIds: envChats, source: 'env' };
  return null;
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  const [cfg, saved] = await Promise.all([
    loadConfig().catch(() => null),
    prisma.aiSetting.findMany({ where: { key: { in: [TOKEN_KEY, CHAT_KEY] } } }),
  ]);
  const tokenSaved = saved.some((r) => r.key === TOKEN_KEY && Boolean(r.value));
  if (cfg) return { configured: true, source: cfg.source, tokenSaved, chatIds: cfg.chatIds };
  const chatIds = parseChatIds(saved.find((r) => r.key === CHAT_KEY)?.value);
  return { configured: false, source: null, tokenSaved, chatIds };
}

/**
 * Send `text` to every configured chat. Resolves with the outcome instead of
 * throwing, so an alert can never take its caller down with it.
 */
export async function sendTelegram(text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cfg = await loadConfig().catch(() => null);
  if (!cfg) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Telegram' };

  const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  const errors: string[] = [];
  for (const chatId of cfg.chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: body, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Telegram's own words, e.g. "Unauthorized" or "Bad Request: chat not found".
        const data = (await res.json().catch(() => ({}))) as { description?: string };
        errors.push(`${chatId}: HTTP ${res.status} ${data.description ?? ''}`.trim());
      }
    } catch (error) {
      errors.push(`${chatId}: ${(error as Error).message}`);
    }
  }
  return errors.length > 0 ? { ok: false, error: scrub(errors.join('; '), cfg.token) } : { ok: true };
}

/** Fire-and-log wrapper for alerts: true when every chat received it. */
export async function notifyAdmins(text: string): Promise<boolean> {
  const result = await sendTelegram(text);
  if (!result.ok && result.error !== 'ยังไม่ได้ตั้งค่า Telegram') {
    console.error('[telegram] alert not delivered:', result.error);
  }
  return result.ok;
}

/**
 * Save the bot token and/or chat ids from the admin page. An omitted token
 * keeps the saved one (the page never sees it to send back); an empty string
 * removes it.
 */
export async function saveTelegramConfig(input: { botToken?: unknown; chatId?: unknown }): Promise<TelegramStatus> {
  if (typeof input.botToken === 'string') {
    const token = input.botToken.trim();
    if (token === '') {
      await prisma.aiSetting.deleteMany({ where: { key: TOKEN_KEY } });
    } else {
      if (!TOKEN_RE.test(token)) {
        throw new Error('Bot token ไม่ถูกต้อง — ต้องเป็นรูปแบบ 123456789:ABC... ที่ได้จาก @BotFather');
      }
      const value = encrypt(token);
      await prisma.aiSetting.upsert({
        where: { key: TOKEN_KEY },
        update: { value },
        create: { key: TOKEN_KEY, value, type: 'encrypted', group: SETTING_GROUP },
      });
    }
  }

  if (typeof input.chatId === 'string') {
    const raw = input.chatId.trim();
    const ids = parseChatIds(raw);
    const given = raw.split(/[\s,]+/).filter(Boolean);
    if (given.length !== ids.length) {
      throw new Error('Chat ID ไม่ถูกต้อง — ใช้ตัวเลข (กลุ่มขึ้นต้นด้วย -) หรือ @ชื่อแชนแนล คั่นหลายค่าด้วยจุลภาค');
    }
    const value = ids.join(',');
    await prisma.aiSetting.upsert({
      where: { key: CHAT_KEY },
      update: { value },
      create: { key: CHAT_KEY, value, type: 'string', group: SETTING_GROUP },
    });
  }

  return getTelegramStatus();
}
