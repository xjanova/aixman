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
import { PageHero } from "@/components/xdreamer/page-hero";
import { useToast } from "@/components/ui/toast-provider";
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

const fmt = (n: number, digits = 0) => n.toLocaleString("th-TH", { maximumFractionDigits: digits });

/* Network calls return failures as values — see the React Compiler note in referral/page.tsx. */
async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json();
    return res.ok ? { ok: true, data: data as T } : { ok: false, error: String(data.error || "ไม่สำเร็จ") };
  } catch {
    return { ok: false, error: "เชื่อมต่อไม่ได้" };
  }
}

/** "12.5 / 100" — spent against a cap, or just spent when there is none. */
function spentOf(spent: number, limit: number | null): string {
  return limit === null ? fmt(spent, 2) : `${fmt(spent, 2)} / ${fmt(limit)}`;
}

/** UTC "HH:MM" as Bangkok time (UTC+7). */
function bkk(utc: string): string {
  const m = (Number(utc.slice(0, 2)) * 60 + Number(utc.slice(3, 5)) + 7 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A key's own caps, edited in place. Empty = no cap. */
function KeyLimitsEditor({ k, onSaved }: { k: ApiKeyRow; onSaved: (ok: boolean, message: string) => void }) {
  const [daily, setDaily] = useState(k.dailyLimitCredits === null ? "" : String(k.dailyLimitCredits));
  const [monthly, setMonthly] = useState(k.monthlyLimitCredits === null ? "" : String(k.monthlyLimitCredits));
  const [saving, setSaving] = useState(false);
  const field: React.CSSProperties = { width: 72, padding: "5px 8px", borderRadius: 8, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "inherit" };
  const save = async () => {
    setSaving(true);
    const r = await getJson("/api/developer/keys/" + k.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyLimitCredits: daily, monthlyLimitCredits: monthly }),
    });
    setSaving(false);
    onSaved(r.ok, r.ok ? "บันทึกเพดานแล้ว" : r.error);
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input style={field} inputMode="numeric" placeholder="ไม่จำกัด" value={daily} onChange={(e) => setDaily(e.target.value.replace(/[^0-9]/g, ""))} title="เครดิตต่อวัน (เวลาไทย)" />
      <span style={{ color: "#94a3b8" }}>/วัน</span>
      <input style={field} inputMode="numeric" placeholder="ไม่จำกัด" value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/[^0-9]/g, ""))} title="เครดิตต่อเดือน" />
      <span style={{ color: "#94a3b8" }}>/เดือน</span>
      <button style={{ ...btn, padding: "5px 10px" }} disabled={saving} onClick={save}>บันทึก</button>
    </div>
  );
}

export default function DeveloperPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
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
    const [k, u] = await Promise.all([getJson<{ keys: ApiKeyRow[] }>("/api/developer/keys"), getJson<Usage>("/api/developer/usage")]);
    if (k.ok) setKeys(k.data.keys);
    if (u.ok) setUsage(u.data);
  }, []);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    load();
  }, [session, load]);

  const create = async () => {
    setBusy(true);
    const r = await getJson<{ secret: string }>("/api/developer/keys", {
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
    if (!confirm(`ลบคีย์ "${k.name}"? โปรแกรมที่ใช้คีย์นี้จะหยุดทำงานทันที`)) return;
    const r = await getJson("/api/developer/keys/" + k.id, { method: "DELETE" });
    if (!r.ok) toast("error", r.error);
    load();
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast("success", "คัดลอกแล้ว");
  };

  if (!session) return null;

  const firstModel = usage?.models[0]?.id ?? "deepseek-v4.1-flash";
  const example = `curl ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer $AIXMAN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${firstModel}", "messages": [{"role": "user", "content": "เขียนฟังก์ชัน fibonacci ใน Python"}], "stream": true}'`;

  const keyHint = secret ?? "axm-คีย์ของคุณ";
  const connect: { id: string; title: string; note: string; code: string }[] = [
    {
      id: "claude-code-mcp",
      title: "Claude Code — ใช้เครื่องมือสร้างภาพ/วิดีโอ/เพลง (MCP)",
      note: "รันคำสั่งนี้ครั้งเดียว แล้วสั่ง Claude ได้เลย เช่น \"สร้างภาพโลโก้ร้านกาแฟ แล้วทำเป็นวิดีโอ 5 วินาที\"",
      code: `claude mcp add --transport http xdreamer ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${keyHint}"`,
    },
    {
      id: "cursor-mcp",
      title: "Cursor / Windsurf / Cline — MCP",
      note: "ใส่ในไฟล์ .cursor/mcp.json (หรือการตั้งค่า MCP ของโปรแกรมนั้น)",
      code: JSON.stringify({ mcpServers: { xdreamer: { url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${keyHint}` } } } }, null, 2),
    },
    {
      id: "claude-desktop-mcp",
      title: "Claude Desktop — MCP (ผ่าน mcp-remote)",
      note: "ใส่ใน claude_desktop_config.json แล้วเปิดโปรแกรมใหม่ (ต้องมี Node.js)",
      code: JSON.stringify(
        { mcpServers: { xdreamer: { command: "npx", args: ["-y", "mcp-remote", `${origin}/api/mcp`, "--header", `Authorization:Bearer ${keyHint}`] } } },
        null,
        2
      ),
    },
    {
      id: "claude-code-models",
      title: "Claude Code — ใช้โมเดลของเราเขียนโค้ดแทน (รูปแบบ API ของ Anthropic)",
      note: "ตั้งค่าตัวแปรก่อนเปิด claude · ตัดเครดิตตาม token เหมือน API ปกติ · ตั้งเพดานต่อคีย์ไว้ด้วยจะปลอดภัยกว่า",
      code: `export ANTHROPIC_BASE_URL=${origin}/api\nexport ANTHROPIC_AUTH_TOKEN=${keyHint}\nexport ANTHROPIC_MODEL=${firstModel}\nexport ANTHROPIC_SMALL_FAST_MODEL=${firstModel}\nclaude`,
    },
  ];

  return (
    <>
      <PageHero
        image="/showcase/admin-room.jpg"
        eyebrow="· API สำหรับนักพัฒนา"
        title="โมเดลเขียนโค้ด"
        emphasis="ผ่าน API"
        hue={190}
        size="slim"
        sub="เรียกใช้ได้แบบเดียวกับ OpenAI API · ใช้กับ Cursor, Continue, Cline หรือโค้ดของคุณเอง · ตัดเครดิตตามจำนวน token ที่ใช้จริง"
      />

      <div style={{ padding: "0 48px 80px", maxWidth: 1100, margin: "0 auto", color: "#f1f5f9", display: "flex", flexDirection: "column", gap: 24 }}>
        {secret && (
          <div style={{ ...card, border: "1px solid rgba(52,211,153,0.5)" }}>
            <div style={{ fontWeight: 500, marginBottom: 8 }}>คีย์ใหม่ของคุณ — คัดลอกเก็บไว้ตอนนี้ ระบบจะไม่แสดงอีก</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <code style={{ ...mono, flex: 1, minWidth: 0, overflowWrap: "anywhere", padding: 12, borderRadius: 10, background: "rgba(2,6,23,0.6)" }}>{secret}</code>
              <button style={btn} onClick={() => copy(secret)}>คัดลอก</button>
              <button style={btn} onClick={() => setSecret(null)}>เก็บแล้ว</button>
            </div>
          </div>
        )}

        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>API keys</div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>เครดิตคงเหลือ {fmt(usage?.balance ?? 0)} ✦</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ชื่อคีย์ เช่น laptop, cursor"
              maxLength={100}
              style={{ flex: 1, minWidth: 180, padding: "9px 12px", borderRadius: 10, background: "rgba(2,6,23,0.55)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "inherit" }}
            />
            <button style={{ ...btn, background: "linear-gradient(120deg,#10b981,#06b6d4)", border: "none" }} disabled={busy} onClick={create}>
              + สร้างคีย์
            </button>
          </div>
          {keys.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>ยังไม่มีคีย์</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>ชื่อ</th>
                    <th style={th}>คีย์</th>
                    <th style={th}>ใช้วันนี้</th>
                    <th style={th}>ใช้เดือนนี้</th>
                    <th style={th}>เพดานการใช้ (เครดิต)</th>
                    <th style={th}>ใช้ล่าสุด</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td style={td}>{k.name}</td>
                      <td style={{ ...td, ...mono }}>{k.keyPrefix}…</td>
                      <td style={td}>{spentOf(k.spentToday, k.dailyLimitCredits)}</td>
                      <td style={td}>{spentOf(k.spentThisMonth, k.monthlyLimitCredits)}</td>
                      <td style={td}>
                        <KeyLimitsEditor k={k} onSaved={(ok, message) => { toast(ok ? "success" : "error", message); if (ok) load(); }} />
                      </td>
                      <td style={td}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("th-TH") : "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button style={{ ...btn, color: "#fca5a5", padding: "5px 12px" }} onClick={() => revoke(k)}>ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>โมเดลและราคา</div>
          {!usage || usage.models.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>ยังไม่มีโมเดลเปิดให้บริการ</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>model</th>
                    <th style={th}>รายละเอียด</th>
                    <th style={{ ...th, textAlign: "right" }}>Context</th>
                    <th style={{ ...th, textAlign: "right" }}>Input / 1M token</th>
                    <th style={{ ...th, textAlign: "right" }}>Input ซ้ำ (cache)</th>
                    <th style={{ ...th, textAlign: "right" }}>Output / 1M token</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.models.map((m) => (
                    <tr key={m.id}>
                      <td style={{ ...td, ...mono }}>{m.id}</td>
                      <td style={td}>{m.description || m.name}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(m.context_length)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(m.pricing.credits_per_million_input_tokens, 1)} ✦</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(m.pricing.credits_per_million_cached_input_tokens, 1)} ✦</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {fmt(m.pricing.credits_per_million_output_tokens, 1)} ✦
                        {m.pricing.off_peak && (
                          <div style={{ fontSize: 11, color: "#6ee7b7" }}>
                            ลด {Math.round((1 - m.pricing.off_peak.price_factor) * 100)}% ช่วง {bkk(m.pricing.off_peak.start_utc)}–{bkk(m.pricing.off_peak.end_utc)} น.
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
            <div style={{ fontSize: 16, fontWeight: 500 }}>วิธีเรียกใช้</div>
            <button style={btn} onClick={() => copy(example)}>คัดลอก</button>
          </div>
          <pre style={{ ...mono, fontSize: 12, padding: 16, borderRadius: 12, background: "rgba(2,6,23,0.6)", overflowX: "auto", margin: 0 }}>{example}</pre>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 12, lineHeight: 1.7 }}>
            ใช้กับไลบรารี OpenAI ได้เลย: ตั้ง <code style={mono}>base_url</code> เป็น <code style={mono}>{origin}/api/v1</code> และ{" "}
            <code style={mono}>api_key</code> เป็นคีย์ของคุณ · ก่อนเริ่มแต่ละคำขอ ระบบกันเครดิตตามจำนวนสูงสุดที่ใช้ได้ไว้ก่อน
            แล้วคืนส่วนที่ไม่ได้ใช้เมื่อจบ · ถ้า <code style={mono}>max_tokens</code> สูง ต้องมีเครดิตพอสำหรับกรณีที่ใช้ครบ · ตั้งเพดานต่อคีย์ได้ในตารางด้านบน
            กันโปรแกรมเอเจนต์วนเรียกจนเครดิตหมด · ข้อความที่ส่งซ้ำ (เช่น ไฟล์เดิมในบทสนทนา) คิดราคา input ที่ cache ซึ่งถูกกว่า
          </p>
        </div>

        <div style={card}>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>เชื่อมต่อกับ Claude, Cursor และเครื่องมือ AI อื่น</div>
          <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 16px", lineHeight: 1.7 }}>
            ผ่าน MCP ผู้ช่วย AI ของคุณสั่งสร้างภาพ วิดีโอ เพลง ติดตามงาน และเรียกโมเดลภาษาของเราได้เอง ด้วยคีย์และเครดิตเดียวกัน
            {secret ? " · ตัวอย่างด้านล่างใส่คีย์ที่เพิ่งสร้างให้แล้ว" : " · สร้างคีย์ด้านบนก่อน แล้วแทนที่ axm-คีย์ของคุณ"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {connect.map((c) => (
              <div key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{c.title}</div>
                  <button style={{ ...btn, padding: "5px 12px" }} onClick={() => copy(c.code)}>คัดลอก</button>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>{c.note}</div>
                <pre style={{ ...mono, fontSize: 12, padding: 14, borderRadius: 12, background: "rgba(2,6,23,0.6)", overflowX: "auto", margin: 0 }}>{c.code}</pre>
              </div>
            ))}
          </div>
        </div>

        {usage && (
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>การใช้งาน {usage.days} วันล่าสุด</div>
            {usage.byModel.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>ยังไม่มีการใช้งาน</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>model</th>
                      <th style={{ ...th, textAlign: "right" }}>คำขอ</th>
                      <th style={{ ...th, textAlign: "right" }}>Input token</th>
                      <th style={{ ...th, textAlign: "right" }}>Output token</th>
                      <th style={{ ...th, textAlign: "right" }}>เครดิต</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byModel.map((u) => (
                      <tr key={u.model}>
                        <td style={{ ...td, ...mono }}>{u.model}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.requests)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.promptTokens)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.completionTokens)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{fmt(u.credits, 2)}</td>
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
