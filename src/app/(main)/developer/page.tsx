"use client";

/**
 * /developer — API keys for the LLM API (/api/v1, OpenAI-compatible).
 *
 * Make and revoke keys, see the price list and the last 30 days of use. A new
 * key is shown once; only its hash is stored.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHero } from "@/components/xdreamer/page-hero";
import { useToast } from "@/components/ui/toast-provider";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatDateTime, formatNumber, type Locale, type Translate } from "@/lib/i18n/locale";
import { loginHref } from "@/lib/safe-callback";

interface ApiKeyRow {
  id: number;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  dailyLimitCredits: number | null;
  monthlyLimitCredits: number | null;
  spentToday: number;
  spentThisMonth: number;
}

interface ApiModel {
  id: string;
  name: string;
  description: string | null;
  context_length: number;
  pricing: {
    credits_per_million_input_tokens: number;
    credits_per_million_output_tokens: number;
    credits_per_million_cached_input_tokens: number;
    off_peak?: { start_utc: string; end_utc: string; price_factor: number };
  };
}

interface Usage {
  days: number;
  balance: number;
  byModel: { model: string; requests: number; promptTokens: number; completionTokens: number; credits: number }[];
  recent: { id: number; model: string; promptTokens: number; completionTokens: number; credits: number; status: string; latencyMs: number; createdAt: string }[];
  models: ApiModel[];
}

const card: React.CSSProperties = {
  padding: 24,
  borderRadius: 18,
  background: "rgba(15,23,42,0.5)",
  border: "1px solid rgba(255,255,255,0.06)",
  backdropFilter: "blur(18px)",
};
const btn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
};
const mono: React.CSSProperties = { fontFamily: "ui-monospace,monospace" };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", color: "#94a3b8", fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid rgba(255,255,255,0.05)" };

const fmt = (n: number, locale: Locale, digits = 0) => formatNumber(n, locale, { maximumFractionDigits: digits });

/* Network calls return failures as values — see the React Compiler note in referral/page.tsx. */
async function getJson<T>(t: Translate, url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json();
    return res.ok ? { ok: true, data: data as T } : { ok: false, error: String(data.error || t("ไม่สำเร็จ", "Something went wrong")) };
  } catch {
    return { ok: false, error: t("เชื่อมต่อไม่ได้", "Couldn't connect") };
  }
}

/** "12.5 / 100" — spent against a cap, or just spent when there is none. */
function spentOf(spent: number, limit: number | null, locale: Locale): string {
  return limit === null ? fmt(spent, locale, 2) : `${fmt(spent, locale, 2)} / ${fmt(limit, locale)}`;
}

/** UTC "HH:MM" as Bangkok time (UTC+7). */
function bkk(utc: string): string {
  const m = (Number(utc.slice(0, 2)) * 60 + Number(utc.slice(3, 5)) + 7 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A key's own caps, edited in place. Empty = no cap. */
function KeyLimitsEditor({ k, onSaved }: { k: ApiKeyRow; onSaved: (ok: boolean, message: string) => void }) {
  const t = useT();
  const [daily, setDaily] = useState(k.dailyLimitCredits === null ? "" : String(k.dailyLimitCredits));
  const [monthly, setMonthly] = useState(k.monthlyLimitCredits === null ? "" : String(k.monthlyLimitCredits));
  const [saving, setSaving] = useState(false);
  const field: React.CSSProperties = { width: 72, padding: "5px 8px", borderRadius: 8, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "inherit" };
  const save = async () => {
    setSaving(true);
    const r = await getJson(t, "/api/developer/keys/" + k.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLimitCredits: daily, monthlyLimitCredits: monthly }),
    });
    setSaving(false);
    onSaved(r.ok, r.ok ? t("บันทึกเพดานแล้ว", "Caps saved") : r.error);
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input style={field} inputMode="numeric" placeholder={t("ไม่จำกัด", "No cap")} value={daily} onChange={(e) => setDaily(e.target.value.replace(/[^0-9]/g, ""))} title={t("เครดิตต่อวัน (เวลาไทย)", "Credits per day (Bangkok time)")} />
      <span style={{ color: "#94a3b8" }}>{t("/วัน", "/day")}</span>
      <input style={field} inputMode="numeric" placeholder={t("ไม่จำกัด", "No cap")} value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/[^0-9]/g, ""))} title={t("เครดิตต่อเดือน", "Credits per month")} />
      <span style={{ color: "#94a3b8" }}>{t("/เดือน", "/month")}</span>
      <button style={{ ...btn, padding: "5px 10px" }} disabled={saving} onClick={save}>{t("บันทึก", "Save")}</button>
    </div>
  );
}

export default function DeveloperPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const { locale } = useLocale();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("https://ai.xman4289.com");

  useEffect(() => {
    if (session === null) router.push(loginHref());
  }, [session, router]);

  const load = useCallback(async () => {
    const [k, u] = await Promise.all([getJson<{ keys: ApiKeyRow[] }>(t, "/api/developer/keys"), getJson<Usage>(t, "/api/developer/usage")]);
    if (k.ok) setKeys(k.data.keys);
    if (u.ok) setUsage(u.data);
  }, [t]);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    load();
  }, [session, load]);

  const create = async () => {
    setBusy(true);
    const r = await getJson<{ secret: string }>(t, "/api/developer/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!r.ok) {
      toast("error", r.error);
      return;
    }
    setSecret(r.data.secret);
    setName("");
    load();
  };

  const revoke = async (k: ApiKeyRow) => {
    if (!confirm(t(`ลบคีย์ "${k.name}"? โปรแกรมที่ใช้คีย์นี้จะหยุดทำงานทันที`, `Delete the key "${k.name}"? Programs using it will stop working immediately.`))) return;
    const r = await getJson(t, "/api/developer/keys/" + k.id, { method: "DELETE" });
    if (!r.ok) toast("error", r.error);
    load();
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast("success", t("คัดลอกแล้ว", "Copied"));
  };

  if (!session) return null;

  const firstModel = usage?.models[0]?.id ?? "deepseek-v4.1-flash";
  const example = `curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer $AIXMAN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${firstModel}", "messages": [{"role": "user", "content": "${t("เขียนฟังก์ชัน fibonacci ใน Python", "Write a fibonacci function in Python")}"}], "stream": true}'`;

  const keyHint = secret ?? t("axm-คีย์ของคุณ", "axm-your-key");
  const connect: { id: string; title: string; note: string; code: string }[] = [
    {
      id: "claude-code-mcp",
      title: t("Claude Code — ใช้เครื่องมือสร้างภาพ/วิดีโอ/เพลง (MCP)", "Claude Code — image, video and music tools (MCP)"),
      note: t(
        "รันคำสั่งนี้ครั้งเดียว แล้วสั่ง Claude ได้เลย เช่น \"สร้างภาพโลโก้ร้านกาแฟ แล้วทำเป็นวิดีโอ 5 วินาที\"",
        "Run this once, then just ask Claude, e.g. \"Create a coffee shop logo, then turn it into a 5-second video\""
      ),
      code: `claude mcp add --transport http xdreamer ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${keyHint}"`,
    },
    {
      id: "cursor-mcp",
      title: "Cursor / Windsurf / Cline — MCP",
      note: t("ใส่ในไฟล์ .cursor/mcp.json (หรือการตั้งค่า MCP ของโปรแกรมนั้น)", "Put this in .cursor/mcp.json (or in that app's MCP settings)"),
      code: JSON.stringify({ mcpServers: { xdreamer: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${keyHint}` } } } }, null, 2),
    },
    {
      id: "claude-desktop-mcp",
      title: t("Claude Desktop — MCP (ผ่าน mcp-remote)", "Claude Desktop — MCP (via mcp-remote)"),
      note: t(
        "ใส่ใน claude_desktop_config.json แล้วเปิดโปรแกรมใหม่ (ต้องมี Node.js · คีย์อยู่ใน env เพราะ Windows ตัดช่องว่างใน args)",
        "Add this to claude_desktop_config.json and restart the app (needs Node.js · the key sits in env because Windows splits args at spaces)"
      ),
      code: JSON.stringify(
        {
          mcpServers: {
            xdreamer: {
              command: "npx",
              args: ["-y", "mcp-remote", `${origin}/api/mcp`, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: `Bearer ${keyHint}` },
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: "brainx-cluadex",
      title: t("BrainX / CluadeX — มีปุ่มเชื่อมต่อในตัว", "BrainX / CluadeX — built-in connect button"),
      note: t(
        "BrainX: Settings → XDREAMER · CluadeX: Setup → การเชื่อมต่อ → XDREAMER — วางคีย์แล้วกดบันทึก เอเจนต์ทุกตัวที่ต่อกับ BrainX ใช้ร่วมกันได้",
        "BrainX: Settings → XDREAMER · CluadeX: Setup → Connections → XDREAMER — paste your key and save. Every agent connected to BrainX can use it."
      ),
      code: secret ?? t("axm-…  (วางคีย์นี้ในช่อง XDREAMER ของโปรแกรม)", "axm-…  (paste this key into the app's XDREAMER field)"),
    },
    {
      id: "claude-code-models",
      title: t("Claude Code — ใช้โมเดลของเราเขียนโค้ดแทน (รูปแบบ API ของ Anthropic)", "Claude Code — write code with our models instead (Anthropic API format)"),
      note: t(
        "ตั้งค่าตัวแปรก่อนเปิด claude · ตัดเครดิตตาม token เหมือน API ปกติ · ตั้งเพดานต่อคีย์ไว้ด้วยจะปลอดภัยกว่า",
        "Set these before starting claude · billed per token like the regular API · a per-key cap makes it safer"
      ),
      code: `export ANTHROPIC_BASE_URL=${origin}/api\nexport ANTHROPIC_AUTH_TOKEN=${keyHint}\nexport ANTHROPIC_MODEL=${firstModel}\nexport ANTHROPIC_SMALL_FAST_MODEL=${firstModel}\nclaude`,
    },
  ];

  return (
    <>
      <PageHero
        image="/showcase/admin-room.jpg"
        eyebrow={t("· API สำหรับนักพัฒนา", "· API for developers")}
        title={t("โมเดลเขียนโค้ด", "Coding models")}
        emphasis={t("ผ่าน API", "via API")}
        hue={190}
        size="slim"
        sub={t(
          "เรียกใช้ได้แบบเดียวกับ OpenAI API · ใช้กับ Cursor, Continue, Cline หรือโค้ดของคุณเอง · ตัดเครดิตตามจำนวน token ที่ใช้จริง",
          "Call it just like the OpenAI API · works with Cursor, Continue, Cline or your own code · credits charged by the tokens you actually use"
        )}
      >
        <Link href="/docs" style={{ display: "inline-flex", marginTop: 14, padding: "9px 16px", borderRadius: 10, fontSize: 13, color: "#fff", textDecoration: "none", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)" }}>
          {t("อ่านคู่มือ API และ MCP →", "Read the API and MCP guide →")}
        </Link>
      </PageHero>

      <div style={{ padding: "0 48px 80px", maxWidth: 1100, margin: "0 auto", color: "#f1f5f9", display: "flex", flexDirection: "column", gap: 24 }}>
        {secret && (
          <div style={{ ...card, border: "1px solid rgba(52,211,153,0.5)" }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>{t("คีย์ใหม่ของคุณ — คัดลอกเก็บไว้ตอนนี้ ระบบจะไม่แสดงอีก", "Your new key — copy it now, it won't be shown again")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <code style={{ ...mono, flex: 1, minWidth: 0, overflowWrap: "anywhere", padding: 12, borderRadius: 10, background: "rgba(2,6,23,0.6)" }}>{secret}</code>
              <button style={btn} onClick={() => copy(secret)}>{t("คัดลอก", "Copy")}</button>
              <button style={btn} onClick={() => setSecret(null)}>{t("เก็บแล้ว", "I've saved it")}</button>
            </div>
          </div>
        )}

        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{t("คีย์ API", "API keys")}</div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>{t("เครดิตคงเหลือ", "Balance:")} {fmt(usage?.balance ?? 0, locale)} ✦</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ชื่อคีย์ เช่น laptop, cursor", "Key name, e.g. laptop, cursor")}
              maxLength={100}
              style={{ flex: 1, minWidth: 180, padding: "9px 12px", borderRadius: 10, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "inherit" }}
            />
            <button style={{ ...btn, background: "linear-gradient(120deg,#10b981,#06b6d4)", border: "none" }} disabled={busy} onClick={create}>
              {t("+ สร้างคีย์", "+ Create key")}
            </button>
          </div>
          {keys.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("ยังไม่มีคีย์", "No keys yet")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>{t("ชื่อ", "Name")}</th>
                    <th style={th}>{t("คีย์", "Key")}</th>
                    <th style={th}>{t("ใช้วันนี้", "Used today")}</th>
                    <th style={th}>{t("ใช้เดือนนี้", "Used this month")}</th>
                    <th style={th}>{t("เพดานการใช้ (เครดิต)", "Usage caps (credits)")}</th>
                    <th style={th}>{t("ใช้ล่าสุด", "Last used")}</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td style={td}>{k.name}</td>
                      <td style={{ ...td, ...mono }}>{k.keyPrefix}…</td>
                      <td style={td}>{spentOf(k.spentToday, k.dailyLimitCredits, locale)}</td>
                      <td style={td}>{spentOf(k.spentThisMonth, k.monthlyLimitCredits, locale)}</td>
                      <td style={td}>
                        <KeyLimitsEditor k={k} onSaved={(ok, message) => { toast(ok ? "success" : "error", message); if (ok) load(); }} />
                      </td>
                      <td style={td}>{k.lastUsedAt ? formatDateTime(k.lastUsedAt, locale) : "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button style={{ ...btn, color: "#fca5a5", padding: "5px 12px" }} onClick={() => revoke(k)}>{t("ลบ", "Delete")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>{t("โมเดลและราคา", "Models and prices")}</div>
          {!usage || usage.models.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("ยังไม่มีโมเดลเปิดให้บริการ", "No models available yet")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>model</th>
                    <th style={th}>{t("รายละเอียด", "Description")}</th>
                    <th style={{ ...th, textAlign: "right" }}>Context</th>
                    <th style={{ ...th, textAlign: "right" }}>{t("Input / 1M token", "Input / 1M tokens")}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t("Input ซ้ำ (cache)", "Cached input")}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t("Output / 1M token", "Output / 1M tokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.models.map((m) => (
                    <tr key={m.id}>
                      <td style={{ ...td, ...mono }}>{m.id}</td>
                      <td style={td}>{m.description || m.name}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(m.context_length, locale)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(m.pricing.credits_per_million_input_tokens, locale, 1)} ✦</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(m.pricing.credits_per_million_cached_input_tokens, locale, 1)} ✦</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {fmt(m.pricing.credits_per_million_output_tokens, locale, 1)} ✦
                        {m.pricing.off_peak && (
                          <div style={{ fontSize: 11, color: "#6ee7b7" }}>
                            {t(
                              `ลด ${Math.round((1 - m.pricing.off_peak.price_factor) * 100)}% ช่วง ${bkk(m.pricing.off_peak.start_utc)}–${bkk(m.pricing.off_peak.end_utc)} น.`,
                              `${Math.round((1 - m.pricing.off_peak.price_factor) * 100)}% off ${bkk(m.pricing.off_peak.start_utc)}–${bkk(m.pricing.off_peak.end_utc)} Bangkok time`
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{t("วิธีเรียกใช้", "How to call it")}</div>
            <button style={btn} onClick={() => copy(example)}>{t("คัดลอก", "Copy")}</button>
          </div>
          <pre style={{ ...mono, fontSize: 12, padding: 16, borderRadius: 12, background: "rgba(2,6,23,0.6)", overflowX: "auto", margin: 0 }}>{example}</pre>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 12, lineHeight: 1.7 }}>
            {t(
              <>
                ใช้กับไลบรารี OpenAI ได้เลย: ตั้ง <code style={mono}>base_url</code> เป็น <code style={mono}>{origin}/api/v1</code> และ{" "}
                <code style={mono}>api_key</code> เป็นคีย์ของคุณ · ก่อนเริ่มแต่ละคำขอ ระบบกันเครดิตตามจำนวนสูงสุดที่ใช้ได้ไว้ก่อน
                แล้วคืนส่วนที่ไม่ได้ใช้เมื่อจบ · ถ้า <code style={mono}>max_tokens</code> สูง ต้องมีเครดิตพอสำหรับกรณีที่ใช้ครบ · ตั้งเพดานต่อคีย์ได้ในตารางด้านบน
                กันโปรแกรมเอเจนต์วนเรียกจนเครดิตหมด · ข้อความที่ส่งซ้ำ (เช่น ไฟล์เดิมในบทสนทนา) คิดราคา input ที่ cache ซึ่งถูกกว่า
              </>,
              <>
                Works with the OpenAI library as it is: set <code style={mono}>base_url</code> to <code style={mono}>{origin}/api/v1</code> and{" "}
                <code style={mono}>api_key</code> to your key · before each request starts, credits for the most it could use are held,
                and whatever goes unused is returned when it ends · with a high <code style={mono}>max_tokens</code> you need enough credits for the full amount · set a per-key cap in the table above
                so a looping agent can&apos;t drain your credits · repeated input (e.g. the same file earlier in a conversation) is billed at the cheaper cached-input price
              </>
            )}
          </p>
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>{t("เชื่อมต่อกับ Claude, Cursor และเครื่องมือ AI อื่น", "Connect Claude, Cursor and other AI tools")}</div>
          <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 16px", lineHeight: 1.7 }}>
            {t(
              "ผ่าน MCP ผู้ช่วย AI ของคุณสั่งสร้างภาพ วิดีโอ เพลง ติดตามงาน และเรียกโมเดลภาษาของเราได้เอง ด้วยคีย์และเครดิตเดียวกัน",
              "Through MCP, your AI assistant can create images, video and music, track jobs and call our language models on its own — with the same key and credits"
            )}
            {secret
              ? t(" · ตัวอย่างด้านล่างใส่คีย์ที่เพิ่งสร้างให้แล้ว", " · the examples below already contain the key you just created")
              : t(" · สร้างคีย์ด้านบนก่อน แล้วแทนที่ axm-คีย์ของคุณ", " · create a key above first, then replace axm-your-key")}
            {" · "}<Link href="/docs#clients" style={{ color: "#67e8f9" }}>{t("วิธีตั้งค่าทุกโปรแกรม", "Setup for every app")}</Link>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {connect.map((c) => (
              <div key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{c.title}</div>
                  <button style={{ ...btn, padding: "5px 12px" }} onClick={() => copy(c.code)}>{t("คัดลอก", "Copy")}</button>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>{c.note}</div>
                <pre style={{ ...mono, fontSize: 12, padding: 14, borderRadius: 12, background: "rgba(2,6,23,0.6)", overflowX: "auto", margin: 0 }}>{c.code}</pre>
              </div>
            ))}
          </div>
        </div>

        {usage && (
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>{t(`การใช้งาน ${usage.days} วันล่าสุด`, `Usage, last ${usage.days} days`)}</div>
            {usage.byModel.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("ยังไม่มีการใช้งาน", "No usage yet")}</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>model</th>
                      <th style={{ ...th, textAlign: "right" }}>{t("คำขอ", "Requests")}</th>
                      <th style={{ ...th, textAlign: "right" }}>{t("Input token", "Input tokens")}</th>
                      <th style={{ ...th, textAlign: "right" }}>{t("Output token", "Output tokens")}</th>
                      <th style={{ ...th, textAlign: "right" }}>{t("เครดิต", "Credits")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byModel.map((u) => (
                      <tr key={u.model}>
                        <td style={{ ...td, ...mono }}>{u.model}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.requests, locale)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.promptTokens, locale)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.completionTokens, locale)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.credits, locale, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
