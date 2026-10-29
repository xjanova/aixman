/**
 * /docs — the developer guide: API keys, the language-model API (OpenAI and
 * Anthropic formats), the MCP server and its tools, connecting Claude Code /
 * Cursor / Claude Desktop / BrainX / CluadeX, billing and error codes.
 *
 * Static and public (no session, no database): what it says must match the
 * code it describes — src/lib/llm/* for the API, src/lib/mcp/server.ts and
 * src/app/api/mcp/route.ts for MCP. Change one, change the other.
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHero } from "@/components/xdreamer/page-hero";
import type { Msg, Translate } from "@/lib/i18n/locale";
import { getT } from "@/lib/i18n/server";
import { Code, Tabs } from "./parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("คู่มือนักพัฒนา — API และ MCP | X-DREAMER", "Developer guide — API and MCP | X-DREAMER"),
    description: t(
      "เชื่อม X-DREAMER เข้ากับโค้ดและผู้ช่วย AI ของคุณ: API โมเดลภาษาแบบ OpenAI/Anthropic, MCP สำหรับสร้างภาพ วิดีโอ เพลง เสียงพูด และวิธีต่อกับ Claude Code, Cursor, BrainX, CluadeX",
      "Connect X-DREAMER to your code and AI assistants: a language-model API in OpenAI/Anthropic format, MCP for creating images, video, music and speech, and how to set up Claude Code, Cursor, BrainX and CluadeX."
    ),
  };
}

/** Production address: the guide is read by people pasting it into their tools. */
const ORIGIN = "https://ai.xman4289.com";
const KEY: Msg = { th: "axm-คีย์ของคุณ", en: "axm-your-key" };
const MODEL = "deepseek-v4.1-flash";

const START: Msg = { th: "เริ่มต้น", en: "Get started" };
const REFERENCE: Msg = { th: "อ้างอิง", en: "Reference" };
const API: Msg = { th: "API", en: "API" };
const MCP: Msg = { th: "MCP", en: "MCP" };

const SECTIONS: { id: string; label: Msg; group: Msg }[] = [
  { id: "start", label: { th: "เริ่มต้นใน 3 นาที", en: "Start in 3 minutes" }, group: START },
  { id: "keys", label: { th: "คีย์และความปลอดภัย", en: "Keys and security" }, group: START },
  { id: "api", label: { th: "API โมเดลภาษา", en: "Language-model API" }, group: API },
  { id: "streaming", label: { th: "Streaming", en: "Streaming" }, group: API },
  { id: "anthropic", label: { th: "รูปแบบ Anthropic / Claude Code", en: "Anthropic format / Claude Code" }, group: API },
  { id: "mcp", label: { th: "MCP คืออะไร", en: "What is MCP?" }, group: MCP },
  { id: "tools", label: { th: "เครื่องมือทั้งหมด", en: "All tools" }, group: MCP },
  { id: "workflow", label: { th: "ลำดับการทำงาน", en: "Workflow" }, group: MCP },
  { id: "clients", label: { th: "เชื่อมต่อโปรแกรม", en: "Connect your tools" }, group: MCP },
  { id: "billing", label: { th: "เครดิตและการคิดเงิน", en: "Credits and billing" }, group: REFERENCE },
  { id: "limits", label: { th: "ขีดจำกัด", en: "Limits" }, group: REFERENCE },
  { id: "errors", label: { th: "รหัสข้อผิดพลาด", en: "Error codes" }, group: REFERENCE },
];

// ─── small building blocks ────────────────────────────────────────────────

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <div className="docs-eyebrow">{eyebrow}</div>
      <h2 className="docs-h2">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="docs-p">{children}</p>;
}

function C({ children }: { children: ReactNode }) {
  return <code className="docs-inline">{children}</code>;
}

function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "ok"; title: string; children: ReactNode }) {
  return (
    <div className={`docs-callout docs-callout-${tone}`}>
      <div className="docs-callout-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="docs-step">
      <div className="docs-step-n">{n}</div>
      <div className="docs-step-body">
        <div className="docs-step-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ─── code samples ─────────────────────────────────────────────────────────

const CURL_MODELS = `curl ${ORIGIN}/api/v1/models \\
  -H "Authorization: Bearer $XDREAMER_API_KEY"`;

const MCP_URL = `${ORIGIN}/api/mcp`;

/**
 * The samples that carry words — comments, example prompts, the key
 * placeholder — in the reader's language. The code itself is the same in both.
 */
function samples(t: Translate) {
  const KEY_HINT = t(KEY);

  const CURL_CHAT = `curl ${ORIGIN}/api/v1/chat/completions \\
  -H "Authorization: Bearer $XDREAMER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL}",
    "messages": [{ "role": "user", "content": "${t("เขียนฟังก์ชัน fibonacci ใน Python", "Write a fibonacci function in Python")}" }]
  }'`;

  const PY_CHAT = `from openai import OpenAI

client = OpenAI(
    base_url="${ORIGIN}/api/v1",
    api_key="${KEY_HINT}",          # ${t(`หรืออ่านจาก os.environ["XDREAMER_API_KEY"]`, `or read it from os.environ["XDREAMER_API_KEY"]`)}
)

reply = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "${t("อธิบาย async/await แบบสั้นๆ", "Explain async/await briefly")}"}],
    max_tokens=800,
)
print(reply.choices[0].message.content)
print(reply.usage)  # ${t("token ที่ใช้จริง — ตัดเครดิตตามนี้", "tokens actually used — this is what you are charged for")}`;

  const JS_CHAT = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${ORIGIN}/api/v1",
  apiKey: process.env.XDREAMER_API_KEY,
});

const reply = await client.chat.completions.create({
  model: "${MODEL}",
  messages: [{ role: "user", content: "${t("เขียน regex ตรวจเบอร์มือถือไทย", "Write a regex that validates Thai mobile numbers")}" }],
});
console.log(reply.choices[0].message.content);`;

  const PY_STREAM = `stream = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "${t("เล่านิทานสั้นๆ", "Tell me a short story")}"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
# ${t("chunk สุดท้ายมี usage เสมอ (เราขอ include_usage ให้อัตโนมัติ)", "the last chunk always carries usage (we ask for include_usage for you)")}`;

  const CLAUDE_CODE_MODELS = `export ANTHROPIC_BASE_URL=${ORIGIN}/api
export ANTHROPIC_AUTH_TOKEN=${KEY_HINT}
export ANTHROPIC_MODEL=${MODEL}
export ANTHROPIC_SMALL_FAST_MODEL=${MODEL}
claude`;

  const ANTHROPIC_SDK = `import anthropic

client = anthropic.Anthropic(base_url="${ORIGIN}/api", api_key="${KEY_HINT}")
msg = client.messages.create(
    model="${MODEL}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "${t("สรุป diff นี้ให้หน่อย", "Summarise this diff")}"}],
)
print(msg.content[0].text)`;

  const CLAUDE_CODE_MCP = `claude mcp add --transport http xdreamer ${MCP_URL} \\
  --header "Authorization: Bearer ${KEY_HINT}"`;

  const CURSOR_MCP = JSON.stringify({ mcpServers: { xdreamer: { url: MCP_URL, headers: { Authorization: `Bearer ${KEY_HINT}` } } } }, null, 2);

  const DESKTOP_MCP = JSON.stringify(
    {
      mcpServers: {
        xdreamer: {
          command: "npx",
          args: ["-y", "mcp-remote", MCP_URL, "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: `Bearer ${KEY_HINT}` },
        },
      },
    },
    null,
    2
  );

  const CLUADEX_JSON = JSON.stringify(
    {
      mcpServers: {
        xdreamer: { type: "http", url: MCP_URL, headers: { Authorization: "Bearer ${XDREAMER_API_KEY}" }, env: { XDREAMER_API_KEY: KEY_HINT } },
      },
    },
    null,
    2
  );

  const GENERIC_MCP = JSON.stringify(
    {
      mcpServers: {
        xdreamer: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${KEY_HINT}` } },
      },
    },
    null,
    2
  );

  const RAW_MCP = `curl ${MCP_URL} \\
  -H "Authorization: Bearer $XDREAMER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"generate_image",
                 "arguments":{"prompt":"${t("ตลาดน้ำยามเช้า หมอกบางๆ ภาพถ่ายฟิล์ม", "Floating market at dawn, light mist, film photo")}","aspect_ratio":"16:9"}}}'`;

  const WORKFLOW = `→ get_credits                          { "balance": 1250 }
→ list_models { "kind": "video" }      [{ "id": "ltx-2.5", "credits": 40, … }, …]
→ generate_image {
     "prompt": "${t("แมวส้มนั่งบนหลังคาวัด แสงเย็น", "An orange cat on a temple roof, evening light")}",
     "aspect_ratio": "16:9" }          { "id": 8812, "status": "processing" }
→ get_generation { "id": 8812, "wait_seconds": 45 }
                                       { "status": "completed", "urls": ["https://…/8812-0.png"] }
→ generate_video {
     "prompt": "${t("กล้องค่อยๆ ซูมเข้า แมวหันมามอง", "Slow push-in, the cat turns to look")}",
     "model": "ltx-2.5", "duration": 5,
     "first_frame_url": "https://…/8812-0.png" }   { "id": 8813, "status": "queued" }
→ get_generation { "id": 8813, "wait_seconds": 45 }   ${t("(ทำซ้ำจนเสร็จ)", "(repeat until done)")}`;

  return {
    KEY_HINT, CURL_CHAT, PY_CHAT, JS_CHAT, PY_STREAM, CLAUDE_CODE_MODELS, ANTHROPIC_SDK, CLAUDE_CODE_MCP,
    CURSOR_MCP, DESKTOP_MCP, CLUADEX_JSON, GENERIC_MCP, RAW_MCP, WORKFLOW,
  };
}

// ─── page ─────────────────────────────────────────────────────────────────

export default async function DocsPage() {
  const t = await getT();
  const {
    KEY_HINT, CURL_CHAT, PY_CHAT, JS_CHAT, PY_STREAM, CLAUDE_CODE_MODELS, ANTHROPIC_SDK, CLAUDE_CODE_MCP,
    CURSOR_MCP, DESKTOP_MCP, CLUADEX_JSON, GENERIC_MCP, RAW_MCP, WORKFLOW,
  } = samples(t);
  const sections = SECTIONS.map((s) => ({ id: s.id, label: t(s.label), group: t(s.group) }));
  const groups = Array.from(new Set(sections.map((s) => s.group)));
  const free = t("ฟรี", "Free");
  const perModel = t("ตามโมเดล", "Per model");
  const forwarded = (
    <>
      <C>messages</C> <C>max_tokens</C> <C>stream</C> <C>temperature</C> <C>top_p</C> <C>stop</C>{" "}
      <C>presence_penalty</C> <C>frequency_penalty</C> <C>tools</C> <C>tool_choice</C> <C>parallel_tool_calls</C>{" "}
      <C>response_format</C> <C>seed</C> <C>logprobs</C> <C>reasoning_effort</C>
    </>
  );

  return (
    <>
      <DocsStyles />
      <PageHero
        image="/showcase/admin-room.jpg"
        eyebrow={t("· คู่มือนักพัฒนา", "· Developer guide")}
        title={t("API และ MCP", "API and MCP")}
        emphasis={t("ของ X-DREAMER", "for X-DREAMER")}
        sub={t(
          "ต่อโค้ด แอป และผู้ช่วย AI ของคุณเข้ากับโมเดลภาษา และเครื่องมือสร้างภาพ วิดีโอ เพลง เสียงพูด — คีย์เดียว เครดิตเดียว",
          "Connect your code, apps and AI assistants to language models and to tools for images, video, music and speech — one key, one credit balance."
        )}
        hue={190}
      >
        <div className="docs-hero-cta">
          <Link href="/developer" className="docs-btn docs-btn-primary">{t("สร้างคีย์ API", "Create an API key")}</Link>
          <a href="#clients" className="docs-btn">{t("เชื่อมต่อ Claude / Cursor / BrainX", "Connect Claude / Cursor / BrainX")}</a>
        </div>
      </PageHero>

      <div className="docs-shell">
        <aside className="docs-toc" aria-label={t("สารบัญ", "Contents")}>
          {groups.map((g) => (
            <div key={g} className="docs-toc-group">
              <div className="docs-toc-head">{g}</div>
              {sections.filter((s) => s.group === g).map((s) => (
                <a key={s.id} href={`#${s.id}`} className="docs-toc-link">{s.label}</a>
              ))}
            </div>
          ))}
          <div className="docs-toc-group">
            <div className="docs-toc-head">{t("ลิงก์", "Links")}</div>
            <Link href="/developer" className="docs-toc-link">{t("คีย์ · ราคา · การใช้งาน", "Keys · prices · usage")}</Link>
            <Link href="/pricing" className="docs-toc-link">{t("เติมเครดิต", "Buy credits")}</Link>
          </div>
        </aside>

        <article className="docs-body">
          <div className="docs-cards">
            {[
              {
                k: "API",
                t: t("โมเดลภาษา", "Language models"),
                d: t("รูปแบบ OpenAI และ Anthropic — ใช้ไลบรารีเดิมได้ เปลี่ยนแค่ base URL", "OpenAI and Anthropic formats — keep your libraries, just change the base URL"),
                href: "#api",
              },
              {
                k: "MCP",
                t: t("สร้างภาพ วิดีโอ เพลง เสียงพูด", "Images, video, music, speech"),
                d: t("ให้ Claude, Cursor หรือ BrainX สั่งงานสตูดิโอของเราเองได้", "Let Claude, Cursor or BrainX drive our Studio for you"),
                href: "#mcp",
              },
              {
                k: "✦",
                t: t("คิดเงินเป็นเครดิต", "Billed in credits"),
                d: t("จ่ายตามจริงต่อ token / ต่องาน · ตั้งเพดานต่อคีย์ได้", "Pay for what you use, per token or per job · set a cap per key"),
                href: "#billing",
              },
            ].map((c) => (
              <a key={c.k} href={c.href} className="docs-card">
                <div className="docs-card-k">{c.k}</div>
                <div className="docs-card-t">{c.t}</div>
                <div className="docs-card-d">{c.d}</div>
              </a>
            ))}
          </div>

          <Section id="start" eyebrow={t(START)} title={t("เริ่มต้นใน 3 นาที", "Start in 3 minutes")}>
            <Step n={1} title={t("สร้างคีย์", "Create a key")}>
              <P>
                {t(
                  <>
                    ล็อกอินแล้วไปที่ <Link href="/developer" className="docs-a">หน้า Developer</Link> → ตั้งชื่อคีย์ → กด สร้างคีย์ คีย์ขึ้นต้นด้วย{" "}
                    <C>axm-</C> และแสดง<strong>ครั้งเดียว</strong> เก็บไว้ในที่ปลอดภัย
                  </>,
                  <>
                    Sign in and go to the <Link href="/developer" className="docs-a">Developer page</Link> → name your key → press Create key. Keys start with{" "}
                    <C>axm-</C> and are shown <strong>only once</strong> — keep yours somewhere safe.
                  </>
                )}
              </P>
            </Step>
            <Step n={2} title={t("ลองเรียก API", "Call the API")}>
              <Code lang="bash" code={CURL_CHAT} />
            </Step>
            <Step n={3} title={t("หรือให้ผู้ช่วย AI ใช้สตูดิโอผ่าน MCP", "Or let your AI assistant use the Studio through MCP")}>
              <Code lang="bash" title="Claude Code" code={CLAUDE_CODE_MCP} />
              <P>
                {t(
                  <>แล้วพิมพ์สั่งได้เลย เช่น “สร้างภาพโลโก้ร้านกาแฟสไตล์มินิมอล แล้วทำเป็นวิดีโอ 5 วินาที” — โปรแกรมอื่นดูที่ <a href="#clients" className="docs-a">เชื่อมต่อโปรแกรม</a></>,
                  <>Then just ask, e.g. “Create a minimalist logo for a coffee shop, then turn it into a 5-second video”. For other apps, see <a href="#clients" className="docs-a">Connect your tools</a>.</>
                )}
              </P>
            </Step>
          </Section>

          <Section id="keys" eyebrow={t(START)} title={t("คีย์และความปลอดภัย", "Keys and security")}>
            <P>
              {t(
                <>
                  ทุกคำขอส่งคีย์ใน header <C>Authorization: Bearer axm-…</C> (API รูปแบบ Anthropic รับ <C>x-api-key</C> ได้ด้วย)
                  เราเก็บเฉพาะค่า hash ของคีย์ — ถ้าทำหายให้ลบแล้วสร้างใหม่ ลบคีย์แล้วโปรแกรมที่ใช้คีย์นั้นหยุดทันที
                </>,
                <>
                  Every request sends the key in the <C>Authorization: Bearer axm-…</C> header (the Anthropic-format API also accepts <C>x-api-key</C>).
                  We store only a hash of your key — if you lose it, delete it and create a new one. Deleting a key stops every program using it at once.
                </>
              )}
            </P>
            <Table
              head={[t("แนวปฏิบัติ", "Practice"), t("เหตุผล", "Why")]}
              rows={[
                [
                  t("หนึ่งคีย์ต่อหนึ่งโปรแกรม/เครื่อง", "One key per program or machine"),
                  t("เห็นยอดใช้แยกกัน และลบทิ้งได้ทีละตัวโดยไม่กระทบตัวอื่น", "You see each one's usage separately, and can delete one without affecting the others"),
                ],
                [
                  t("ตั้งเพดานเครดิตต่อวัน/ต่อเดือน", "Set a daily/monthly credit cap"),
                  t("เอเจนต์ที่วนเรียกซ้ำจะหยุดที่เพดาน (402 key_limit_reached) แทนที่จะใช้เครดิตจนหมด", "An agent stuck in a loop stops at the cap (402 key_limit_reached) instead of spending all your credits"),
                ],
                [
                  t("อย่าใส่คีย์ในโค้ดฝั่งเบราว์เซอร์หรือแอปมือถือ", "Never put a key in browser or mobile-app code"),
                  t("ใครเปิดดูซอร์สก็เห็นคีย์ — เรียกผ่านเซิร์ฟเวอร์ของคุณเอง", "Anyone who views the source sees the key — call through your own server"),
                ],
                [
                  t("เก็บในตัวแปรแวดล้อม เช่น XDREAMER_API_KEY", "Keep it in an environment variable, e.g. XDREAMER_API_KEY"),
                  t("ไม่หลุดเข้า git · BrainX และ CluadeX เก็บคีย์แบบเข้ารหัสในเครื่องให้อยู่แล้ว", "It stays out of git · BrainX and CluadeX already store the key encrypted on your machine"),
                ],
              ]}
            />
          </Section>

          <Section id="api" eyebrow="API" title={t("API โมเดลภาษา (รูปแบบ OpenAI)", "Language-model API (OpenAI format)")}>
            <P>
              {t(
                <>
                  Base URL <C>{ORIGIN}/api/v1</C> — ใช้กับไลบรารี OpenAI ทุกภาษาและเครื่องมือที่ให้ตั้ง “OpenAI-compatible endpoint” ได้เลย
                  ราคาของแต่ละโมเดลดูได้ที่ <Link href="/developer" className="docs-a">หน้า Developer</Link> หรือจาก <C>GET /models</C>
                </>,
                <>
                  Base URL <C>{ORIGIN}/api/v1</C> — works with the OpenAI library in any language and with any tool that lets you set an “OpenAI-compatible endpoint”.
                  Each model&apos;s price is on the <Link href="/developer" className="docs-a">Developer page</Link> or from <C>GET /models</C>.
                </>
              )}
            </P>
            <Table
              head={["Method", "Path", t("ใช้ทำอะไร", "What it does")]}
              rows={[
                [<C key="m">GET</C>, <C key="p">/api/v1/models</C>, t("รายการโมเดลภาษา context และราคา (เครดิตต่อ 1 ล้าน token)", "Language models, their context and prices (credits per 1M tokens)")],
                [<C key="m">POST</C>, <C key="p">/api/v1/chat/completions</C>, t("แชต — รูปแบบ OpenAI รองรับ stream, tools / function calling", "Chat — OpenAI format, with streaming and tools / function calling")],
                [<C key="m">POST</C>, <C key="p">/api/v1/messages</C>, t("แชต — รูปแบบ Anthropic (สำหรับ Claude Code และ Anthropic SDK)", "Chat — Anthropic format (for Claude Code and the Anthropic SDK)")],
                [<C key="m">POST</C>, <C key="p">/api/v1/messages/count_tokens</C>, t("ประมาณจำนวน token ของคำขอ (ไม่คิดเงิน)", "Estimate a request's token count (free)")],
                [<C key="m">POST</C>, <C key="p">/api/mcp</C>, t("MCP server — เครื่องมือสร้างภาพ วิดีโอ เพลง เสียงพูด (ดูหัวข้อ MCP)", "MCP server — tools for images, video, music and speech (see MCP)")],
              ]}
            />
            <Tabs
              tabs={[
                { id: "py", label: "Python", body: <Code lang="python" code={PY_CHAT} /> },
                { id: "js", label: "Node.js", body: <Code lang="javascript" code={JS_CHAT} /> },
                { id: "curl", label: "curl", body: <Code lang="bash" code={CURL_CHAT} /> },
                { id: "models", label: t("รายการโมเดล", "List models"), body: <Code lang="bash" code={CURL_MODELS} /> },
              ]}
            />
            <P>
              {t(
                <>
                  ฟิลด์ที่ส่งต่อให้โมเดล: {forwarded} — ฟิลด์อื่นถูกตัดทิ้ง · <C>n</C> ต้องเป็น 1 ·
                  ฟิลด์ <C>model</C> ในคำตอบเป็นชื่อโมเดลของเราเสมอ
                </>,
                <>
                  Fields passed on to the model: {forwarded} — other fields are dropped · <C>n</C> must be 1 ·
                  the <C>model</C> field in the response is always our model id
                </>
              )}
            </P>
          </Section>

          <Section id="streaming" eyebrow="API" title="Streaming">
            <P>
              {t(
                <>
                  ส่ง <C>{'"stream": true'}</C> แล้วอ่านแบบ Server-Sent Events เหมือน OpenAI ทุกประการ chunk สุดท้ายมี <C>usage</C> เสมอ
                  ถ้าตัดการเชื่อมต่อกลางทาง เราคิดเงินเฉพาะส่วนที่สร้างไปแล้ว และคืนเครดิตที่กันไว้ส่วนที่เหลือ
                </>,
                <>
                  Send <C>{'"stream": true'}</C> and read Server-Sent Events exactly as with OpenAI. The last chunk always carries <C>usage</C>.
                  If you disconnect midway, we charge only for what was already generated and return the rest of the credits we held.
                </>
              )}
            </P>
            <Code lang="python" code={PY_STREAM} />
          </Section>

          <Section id="anthropic" eyebrow="API" title={t("รูปแบบ Anthropic และ Claude Code", "Anthropic format and Claude Code")}>
            <P>
              {t(
                <>
                  <C>/api/v1/messages</C> พูดภาษาเดียวกับ Anthropic Messages API (ข้อความ รูปภาพ tool use และ streaming)
                  จึงใช้ Claude Code ให้เขียนโค้ดด้วยโมเดลของเราได้ โดยตั้งค่าตัวแปรก่อนเปิด <C>claude</C>:
                </>,
                <>
                  <C>/api/v1/messages</C> speaks the Anthropic Messages API (text, images, tool use and streaming),
                  so Claude Code can write code with our models. Set these variables before starting <C>claude</C>:
                </>
              )}
            </P>
            <Code lang="bash" title={t("Claude Code ใช้โมเดลของเรา", "Claude Code on our models")} code={CLAUDE_CODE_MODELS} />
            <Code lang="python" title="Anthropic SDK" code={ANTHROPIC_SDK} />
            <Callout tone="warn" title={t("ข้อควรรู้", "Good to know")}>
              {t(
                <>
                  Thinking blocks และเครื่องมือฝั่งเซิร์ฟเวอร์ของ Anthropic (เช่น web search) ไม่ถูกส่งต่อ · เอเจนต์เรียกโมเดลหลายรอบต่อคำสั่ง
                  — ตั้งเพดานเครดิตของคีย์ไว้ก่อนใช้งานจริง
                </>,
                <>
                  Thinking blocks and Anthropic&apos;s server-side tools (e.g. web search) are not passed on · an agent calls the model many times per instruction
                  — set a credit cap on the key before real use
                </>
              )}
            </Callout>
          </Section>

          <Section id="mcp" eyebrow="MCP" title={t("MCP คืออะไร", "What is MCP?")}>
            <P>
              {t(
                <>
                  Model Context Protocol คือมาตรฐานที่ให้ผู้ช่วย AI ใช้เครื่องมือภายนอกได้ เมื่อต่อ MCP ของเรา Claude, Cursor, BrainX หรือ CluadeX
                  จะสั่งสร้างภาพ วิดีโอ เพลง เสียงพูด ตรวจสถานะงาน และถามโมเดลภาษาได้เอง โดยใช้คีย์และเครดิตเดียวกับ API
                </>,
                <>
                  The Model Context Protocol is a standard that lets AI assistants use outside tools. Connected to our MCP server, Claude, Cursor, BrainX or CluadeX
                  can create images, video, music and speech, check on jobs and ask a language model on their own — with the same key and credits as the API.
                </>
              )}
            </P>
            <Table
              head={["", ""]}
              rows={[
                ["Endpoint", <C key="u">{MCP_URL}</C>],
                ["Transport", t("Streamable HTTP (POST JSON-RPC 2.0) — ไม่เก็บ session, ไม่ต้องเปิด SSE ค้างไว้", "Streamable HTTP (POST JSON-RPC 2.0) — stateless, no long-lived SSE connection")],
                [
                  t("ยืนยันตัวตน", "Authentication"),
                  <span key="a"><C>Authorization: Bearer axm-…</C> — {t("คีย์เดียวกับ API", "the same key as the API")}</span>,
                ],
                ["Protocol", "2025-11-25 · 2025-06-18 · 2025-03-26 · 2024-11-05"],
              ]}
            />
            <Code lang="bash" title={t("เรียกตรงๆ (ทดสอบ) — โปรแกรม MCP ทำขั้นนี้ให้เอง", "Direct call (for testing) — MCP clients do this for you")} code={RAW_MCP} />
          </Section>

          <Section id="tools" eyebrow="MCP" title={t("เครื่องมือทั้งหมด", "All tools")}>
            <Table
              head={[t("เครื่องมือ", "Tool"), t("ทำอะไร", "What it does"), t("พารามิเตอร์หลัก", "Main parameters"), t("เครดิต", "Credits")]}
              rows={[
                [
                  <C key="t">list_models</C>,
                  t("โมเดลที่ใช้ได้ พร้อมราคา", "Available models and their prices"),
                  t(
                    <span key="p"><C>kind</C>: image · video · audio (เพลง) · speech (เสียงพูด: รายชื่อเสียงและจำนวนตัวอักษรสูงสุด) · text</span>,
                    <span key="p"><C>kind</C>: image · video · audio (music) · speech (voices and the character limit) · text</span>
                  ),
                  free,
                ],
                [<C key="t">get_credits</C>, t("ยอดเครดิตคงเหลือ", "Your credit balance"), "—", free],
                [
                  <C key="t">generate_image</C>,
                  t("สร้างภาพจากข้อความ (ไทย/อังกฤษ)", "Create images from text (Thai or English)"),
                  <span key="p"><C>prompt</C>* <C>model</C> <C>aspect_ratio</C> <C>negative_prompt</C> <C>num_outputs</C> (1–4)</span>,
                  perModel,
                ],
                [
                  <C key="t">generate_video</C>,
                  t("สร้างวิดีโอ (หลายโมเดลมีเสียงในตัว) เริ่มจากภาพแรก/จบที่ภาพสุดท้ายได้", "Create video (many models include sound), optionally from a first and/or last frame"),
                  <span key="p"><C>prompt</C>* <C>model</C> <C>duration</C> <C>aspect_ratio</C> <C>resolution</C> <C>first_frame_url</C> <C>last_frame_url</C></span>,
                  t("ตามโมเดล/ความยาว", "Per model and length"),
                ],
                [
                  <C key="t">generate_music</C>,
                  t("สร้างเพลงจากสไตล์ ใส่เนื้อร้องได้", "Create music from a style, with optional lyrics"),
                  <span key="p"><C>prompt</C>* <C>lyrics</C> <C>model</C> <C>duration</C> {t("(10–300 วิ)", "(10–300 s)")}</span>,
                  perModel,
                ],
                [
                  <C key="t">generate_speech</C>,
                  t("อ่านข้อความเป็นเสียงพูด (ไทย/อังกฤษ) เลือกเสียงได้ บางโมเดลกำหนดสไตล์การพูดได้", "Turn text into speech (Thai or English) in a voice you choose; some models also take a speaking style"),
                  <span key="p"><C>text</C>* <C>model</C> <C>voice</C> <C>style</C></span>,
                  t("ต่อ 1,000 ตัวอักษร (คิดตามจริง)", "Per 1,000 characters (pro rata)"),
                ],
                [
                  <C key="t">get_generation</C>,
                  t("สถานะและลิงก์ผลงาน รอให้เสร็จได้สูงสุด 45 วินาทีต่อครั้ง", "A job's status and result links; can wait up to 45 seconds per call for it to finish"),
                  <span key="p"><C>id</C>* <C>wait_seconds</C> (0–45)</span>,
                  free,
                ],
                [<C key="t">list_generations</C>, t("งานล่าสุดของคุณ", "Your latest jobs"), <span key="p"><C>limit</C> (1–20)</span>, free],
                [
                  <C key="t">upload_image</C>,
                  t("อัปโหลดภาพ (PNG/JPEG/WebP base64) เพื่อใช้เป็นเฟรมของวิดีโอ", "Upload a picture (PNG/JPEG/WebP, base64) to use as a video frame"),
                  <span key="p"><C>data_base64</C>*</span>,
                  free,
                ],
                [
                  <C key="t">chat</C>,
                  t("ถามโมเดลภาษาหนึ่งคำตอบ", "Ask a language model for one answer"),
                  <span key="p"><C>model</C>* <C>prompt</C>* <C>system</C> <C>max_tokens</C></span>,
                  t("ต่อ token", "Per token"),
                ],
              ]}
            />
            <P>
              {t(
                <>* = จำเป็น · <C>aspect_ratio</C>: 1:1 · 16:9 · 9:16 · 4:3 · 3:4 · 3:2 · 2:3 · ผู้ช่วย AI อ่านคำอธิบายเครื่องมือเองจาก <C>tools/list</C> ไม่ต้องจำ</>,
                <>* = required · <C>aspect_ratio</C>: 1:1 · 16:9 · 9:16 · 4:3 · 3:4 · 3:2 · 2:3 · AI assistants read the tool descriptions from <C>tools/list</C> themselves — nothing to memorise</>
              )}
            </P>
          </Section>

          <Section id="workflow" eyebrow="MCP" title={t("ลำดับการทำงาน", "Workflow")}>
            <P>
              {t(
                <>
                  งานสร้างภาพ/วิดีโอ/เพลง/เสียงพูดตอบกลับทันทีพร้อมเลข <C>id</C> (ตัดเครดิตตอนสั่ง ถ้างานล้มเหลวคืนเครดิตอัตโนมัติ) แล้วใช้{" "}
                  <C>get_generation</C> พร้อม <C>wait_seconds</C> รอผล — ภาพมักเสร็จในรอบแรก วิดีโอใช้เวลาหลายนาที
                </>,
                <>
                  Image, video, music and speech jobs answer at once with an <C>id</C> (credits are taken when you order and refunded automatically if the job fails). Then call{" "}
                  <C>get_generation</C> with <C>wait_seconds</C> to wait for the result — pictures are usually ready on the first call; video takes several minutes.
                </>
              )}
            </P>
            <Code lang="text" title={t("ตัวอย่างลำดับที่ผู้ช่วย AI ทำให้", "An example run by an AI assistant")} code={WORKFLOW} />
            <Callout tone="info" title={t("ภาพเฟรมแรก/สุดท้าย", "First and last frames")}>
              {t(
                <>
                  <C>first_frame_url</C> และ <C>last_frame_url</C> ต้องเป็นลิงก์ที่อยู่บนระบบเรา — ผลจาก <C>generate_image</C> หรือ <C>upload_image</C> —
                  ลิงก์จากเว็บอื่นจะถูกปฏิเสธ
                </>,
                <>
                  <C>first_frame_url</C> and <C>last_frame_url</C> must be links on our system — results of <C>generate_image</C> or <C>upload_image</C>.
                  Links to other sites are refused.
                </>
              )}
            </Callout>
          </Section>

          <Section id="clients" eyebrow="MCP" title={t("เชื่อมต่อโปรแกรม", "Connect your tools")}>
            <P>
              {t(
                <>เลือกโปรแกรมที่ใช้ แทนที่ <C>{KEY_HINT}</C> ด้วยคีย์จริงจากหน้า Developer</>,
                <>Pick your app and replace <C>{KEY_HINT}</C> with your real key from the Developer page.</>
              )}
            </P>
            <Tabs
              tabs={[
                {
                  id: "claude-code",
                  label: "Claude Code",
                  body: (
                    <>
                      <P>
                        {t(
                          <>รันครั้งเดียว (เพิ่ม <C>--scope user</C> ถ้าต้องการใช้ทุกโปรเจกต์) แล้วตรวจด้วย <C>/mcp</C> ในหน้าจอ Claude Code</>,
                          <>Run this once (add <C>--scope user</C> to use it in every project), then check it with <C>/mcp</C> inside Claude Code.</>
                        )}
                      </P>
                      <Code lang="bash" code={CLAUDE_CODE_MCP} />
                    </>
                  ),
                },
                {
                  id: "brainx",
                  label: "BrainX",
                  badge: t("ในตัว", "Built in"),
                  body: (
                    <>
                      {t(
                        <ol className="docs-ol">
                          <li>เปิด BrainX → <strong>Settings</strong> → การ์ด <strong>XDREAMER</strong></li>
                          <li>วางคีย์ <C>axm-…</C> แล้วกด <strong>บันทึกและทดสอบ</strong> — BrainX ทดสอบกับเซิร์ฟเวอร์และแสดงยอดเครดิตก่อนบันทึก</li>
                          <li>เริ่ม session ใหม่ของเอเจนต์ (Claude, Gemini, Grok, CluadeX ที่ต่อกับ BrainX) — จะเห็นเครื่องมือ <C>xdreamer__generate_image</C>, <C>xdreamer__generate_video</C> …</li>
                        </ol>,
                        <ol className="docs-ol">
                          <li>Open BrainX → <strong>Settings</strong> → the <strong>XDREAMER</strong> card</li>
                          <li>Paste your <C>axm-…</C> key and press <strong>Save and test</strong> — BrainX checks it against our server and shows your credit balance before saving</li>
                          <li>Start a new agent session (Claude, Gemini, Grok or CluadeX connected to BrainX) — you&apos;ll see the tools <C>xdreamer__generate_image</C>, <C>xdreamer__generate_video</C> …</li>
                        </ol>
                      )}
                      <Callout tone="ok" title={t("ทุกเอเจนต์ใช้ร่วมกัน", "Shared by every agent")}>
                        {t(
                          <>
                            คีย์เก็บแบบเข้ารหัส (DPAPI) ในเครื่องนี้ ไม่อยู่ใน vault ที่ sync · ตั้งผ่าน environment ได้ด้วย <C>XDREAMER_API_KEY</C> ·
                            ต้องใช้ BrainX MCP 2.10 ขึ้นไป
                          </>,
                          <>
                            The key is stored encrypted (DPAPI) on this machine, not in the synced vault · it can also be set through the <C>XDREAMER_API_KEY</C> environment variable ·
                            requires BrainX MCP 2.10 or later
                          </>
                        )}
                      </Callout>
                    </>
                  ),
                },
                {
                  id: "cluadex",
                  label: "CluadeX",
                  badge: t("ในตัว", "Built in"),
                  body: (
                    <>
                      {t(
                        <ol className="docs-ol">
                          <li>เปิด CluadeX → <strong>Setup</strong> → กลุ่ม <strong>การเชื่อมต่อ</strong> → <strong>XDREAMER</strong> → เชื่อมต่อ</li>
                          <li>วางคีย์ <C>axm-…</C> — เก็บแบบเข้ารหัสในเครื่อง ไม่ต้องติดตั้ง Node.js</li>
                          <li>ถ้ามี BrainX ในเครื่อง CluadeX จะเพิ่มเป็น bridge ของ BrainX ให้ทุกเอเจนต์ใช้ร่วมกัน ไม่งั้นจะอยู่ในรายการ MCP ของ CluadeX</li>
                        </ol>,
                        <ol className="docs-ol">
                          <li>Open CluadeX → <strong>Setup</strong> → the <strong>Connections</strong> group → <strong>XDREAMER</strong> → Connect</li>
                          <li>Paste your <C>axm-…</C> key — it is stored encrypted on your machine; no Node.js needed</li>
                          <li>If BrainX is on the same machine, CluadeX adds it as a BrainX bridge so every agent can use it; otherwise it goes in CluadeX&apos;s own MCP list</li>
                        </ol>
                      )}
                      <P>
                        {t(
                          <>หรือเพิ่มเองในไฟล์ <C>mcp_servers.json</C> (CluadeX 3.0.189 ขึ้นไปรองรับ server แบบ HTTP) — <C>{"${ชื่อ}"}</C> อ่านจาก env หรือตัวแปรของ Windows:</>,
                          <>Or add it yourself to <C>mcp_servers.json</C> (CluadeX 3.0.189 or later supports HTTP servers) — <C>{"${NAME}"}</C> is read from env or a Windows variable:</>
                        )}
                      </P>
                      <Code lang="json" title="~/.cluadex/mcp_servers.json" code={CLUADEX_JSON} />
                    </>
                  ),
                },
                {
                  id: "cursor",
                  label: "Cursor / Windsurf / Cline",
                  body: (
                    <>
                      <P>
                        {t(
                          <>ใส่ใน <C>.cursor/mcp.json</C> ของโปรเจกต์ หรือ <C>~/.cursor/mcp.json</C> สำหรับทุกโปรเจกต์ (โปรแกรมอื่นใช้รูปแบบเดียวกันในหน้าตั้งค่า MCP)</>,
                          <>Put this in your project&apos;s <C>.cursor/mcp.json</C>, or in <C>~/.cursor/mcp.json</C> for every project (the other apps take the same shape in their MCP settings).</>
                        )}
                      </P>
                      <Code lang="json" title="mcp.json" code={CURSOR_MCP} />
                    </>
                  ),
                },
                {
                  id: "desktop",
                  label: "Claude Desktop",
                  body: (
                    <>
                      <P>
                        {t(
                          <>
                            Settings → Developer → Edit Config แล้วใส่ใน <C>claude_desktop_config.json</C> จากนั้นปิดเปิดโปรแกรมใหม่ — ต้องมี Node.js
                            (<C>mcp-remote</C> ต่อ MCP แบบ HTTP ให้ คีย์อยู่ใน <C>env</C> เพราะ Windows ตัดช่องว่างใน args)
                          </>,
                          <>
                            Settings → Developer → Edit Config, add this to <C>claude_desktop_config.json</C>, then restart the app — Node.js is required
                            (<C>mcp-remote</C> bridges it to HTTP MCP; the key sits in <C>env</C> because Windows splits args at spaces)
                          </>
                        )}
                      </P>
                      <Code lang="json" title="claude_desktop_config.json" code={DESKTOP_MCP} />
                    </>
                  ),
                },
                {
                  id: "other",
                  label: t("อื่นๆ", "Other"),
                  body: (
                    <>
                      <P>
                        {t(
                          <>โปรแกรมที่รองรับ MCP แบบ Streamable HTTP ใช้ค่านี้ได้ทันที โปรแกรมที่รองรับแค่ stdio ใช้รูปแบบ <C>mcp-remote</C> เหมือน Claude Desktop</>,
                          <>Apps that support Streamable HTTP MCP can use this as is. Apps that only support stdio use the <C>mcp-remote</C> setup, like Claude Desktop.</>
                        )}
                      </P>
                      <Code lang="json" code={GENERIC_MCP} />
                    </>
                  ),
                },
              ]}
            />
          </Section>

          <Section id="billing" eyebrow={t(REFERENCE)} title={t("เครดิตและการคิดเงิน", "Credits and billing")}>
            <Table
              head={[t("หัวข้อ", "Topic"), t("รายละเอียด", "Details")]}
              rows={[
                [
                  t("หน่วย", "Unit"),
                  t(
                    "เครดิตเดียวกับสตูดิโอ เติมที่หน้า Pricing · API คิดละเอียดถึง 1/1000 เครดิต ส่วนที่ไม่ครบ 1 เครดิตยกไปรวมกับคำขอถัดไปของคีย์เดียวกัน",
                    "The same credits as the Studio, bought on the Pricing page · the API bills to 1/1000 of a credit; anything short of a whole credit carries over to the same key's next request"
                  ),
                ],
                [
                  t("กันเครดิตก่อน", "Held up front"),
                  t(
                    "ก่อนเริ่มคำขอ ระบบกันเครดิตตามกรณีสูงสุด (ความยาว prompt + max_tokens ทั้งหมด) แล้วคืนส่วนเกินทันทีที่จบ — max_tokens สูงต้องมีเครดิตพอกัน",
                    "Before a request starts, credits for its worst case (prompt length + the whole max_tokens) are held, and the excess is returned the moment it ends — a high max_tokens needs a balance to match"
                  ),
                ],
                [t("คิดตามจริง", "Billed on actual use"), t("ตัดตาม usage ที่โมเดลรายงาน ไม่ใช่ตามที่กันไว้", "Charged by the usage the model reports, not by what was held")],
                [
                  "Cache",
                  t(
                    "ข้อความที่ส่งซ้ำ (เช่น ไฟล์เดิมในบทสนทนา) คิดราคา input แบบ cache ที่ถูกกว่า — ดูคอลัมน์ “Input ซ้ำ” ที่หน้า Developer",
                    "Repeated input (e.g. the same file earlier in a conversation) is billed at the cheaper cached-input price — see the “Cached input” column on the Developer page"
                  ),
                ],
                [
                  t("ช่วงลดราคา", "Off-peak discounts"),
                  t(
                    "บางโมเดลมีช่วง off-peak ราคาถูกลง แสดงไว้ใต้ราคาในหน้า Developer (เวลาไทย)",
                    "Some models are cheaper off-peak; the window is shown under the price on the Developer page (Bangkok time)"
                  ),
                ],
                [
                  t("งานภาพ/วิดีโอ/เพลง", "Image/video/music jobs"),
                  t("ราคาต่องานตาม list_models ตัดตอนสั่ง งานล้มเหลวคืนเครดิตอัตโนมัติ", "A per-job price from list_models, charged when you order; failed jobs are refunded automatically"),
                ],
                [
                  t("เสียงพูด", "Speech"),
                  t(
                    "คิดตามจำนวนตัวอักษรของข้อความ (ราคาต่อ 1,000 ตัวอักษรใน list_models คิดตามสัดส่วน ขั้นต่ำ 1 เครดิต) ตัดตอนสั่ง",
                    "Billed by the length of the text (the per-1,000-character price in list_models, pro rata, minimum 1 credit), charged when you order"
                  ),
                ],
                [t("เพดานต่อคีย์", "Per-key caps"), t("ต่อวัน/ต่อเดือน (เวลากรุงเทพ) ตั้งได้ที่หน้า Developer", "Daily/monthly (Bangkok time), set on the Developer page")],
              ]}
            />
          </Section>

          <Section id="limits" eyebrow={t(REFERENCE)} title={t("ขีดจำกัด", "Limits")}>
            <Table
              head={["", t("ค่า", "Limit")]}
              rows={[
                [
                  t("API โมเดลภาษา", "Language-model API"),
                  t("60 คำขอ/นาที ต่อคีย์ (ค่าเริ่มต้น) — เกินได้ 429 พร้อม Retry-After", "60 requests/minute per key (default) — beyond that you get 429 with Retry-After"),
                ],
                ["MCP", t("60 การเรียกเครื่องมือ/นาที ต่อคีย์ · ขนาดคำขอไม่เกิน 15 MB", "60 tool calls/minute per key · requests up to 15 MB")],
                ["get_generation", t("รอได้สูงสุด 45 วินาทีต่อครั้ง — เรียกซ้ำได้", "Waits up to 45 seconds per call — call it again as often as needed")],
                ["chat (MCP)", <span key="c"><C>max_tokens</C> {t("สูงสุด 32,768", "up to 32,768")}</span>],
              ]}
            />
          </Section>

          <Section id="errors" eyebrow={t(REFERENCE)} title={t("รหัสข้อผิดพลาด", "Error codes")}>
            <P>
              {t(
                <>
                  API ตอบข้อผิดพลาดในรูปแบบ OpenAI: <C>{'{"error": {"message", "type", "code"}}'}</C> (รูปแบบ Anthropic ใช้ <C>{'{"type": "error", "error": {…}}'}</C>)
                  ทุกกรณีที่ขึ้นว่า “nothing was charged” ไม่มีการตัดเครดิต
                </>,
                <>
                  The API returns errors in OpenAI&apos;s shape: <C>{'{"error": {"message", "type", "code"}}'}</C> (the Anthropic format uses <C>{'{"type": "error", "error": {…}}'}</C>).
                  Whenever the message says “nothing was charged”, no credits were taken.
                </>
              )}
            </P>
            <Table
              head={["HTTP", "code", t("ความหมาย / ทำอย่างไร", "Meaning / what to do")]}
              rows={[
                ["401", <C key="c">invalid_api_key</C>, t("ไม่มีคีย์ คีย์ผิด หรือถูกลบแล้ว", "No key, a wrong key, or a deleted one")],
                ["401", <C key="c">account_disabled</C>, t("บัญชีถูกระงับ", "The account is suspended")],
                ["400", <C key="c">model_required</C>, t("ไม่ได้ระบุ model", "No model given")],
                ["400", <C key="c">context_length_exceeded</C>, t("prompt ยาวเกิน context ของโมเดล", "The prompt is longer than the model's context")],
                ["400", <C key="c">upstream_rejected</C>, t("โมเดลปฏิเสธคำขอ (ข้อความในรายละเอียดบอกเหตุผล)", "The model refused the request (the message says why)")],
                ["402", <C key="c">insufficient_credits</C>, t("เครดิตไม่พอสำหรับกรณีสูงสุด — ลด max_tokens หรือเติมเครดิต", "Not enough credits for the worst case — lower max_tokens or buy credits")],
                ["402", <C key="c">key_limit_reached</C>, t("เกินเพดานรายวัน/เดือนของคีย์ — ปรับที่หน้า Developer", "Over the key's daily/monthly cap — change it on the Developer page")],
                ["404", <C key="c">model_not_found</C>, t("ไม่มีโมเดลนี้ หรือปิดอยู่ — ดู GET /api/v1/models", "No such model, or it is switched off — see GET /api/v1/models")],
                ["413", "—", t("คำขอใหญ่เกินกำหนด", "The request is too large")],
                ["429", <C key="c">rate_limited</C>, t("เรียกถี่เกิน — รอตาม Retry-After", "Too many requests — wait as long as Retry-After says")],
                ["502", <C key="c">upstream_error</C>, t("อ่านคำตอบของโมเดลไม่ได้ — ไม่ตัดเครดิต ลองใหม่", "The model's answer could not be read — nothing charged; try again")],
                [
                  "503",
                  <C key="c">model_warming</C>,
                  t(
                    "โมเดลที่รันบน GPU ของเรากำลังเปิดเครื่อง (20–40 นาที) — ลองใหม่ตาม Retry-After ไม่ตัดเครดิต",
                    "A model on our own GPUs is starting up (20–40 minutes) — retry after Retry-After; nothing charged"
                  ),
                ],
                ["503", <C key="c">model_offline</C>, t("โมเดลปิดให้บริการชั่วคราว", "The model is temporarily unavailable")],
                ["503", <C key="c">backend_unavailable</C>, t("ผู้ให้บริการโมเดลไม่ว่าง — ลองใหม่ภายหลัง", "The model's backend is busy — try again later")],
              ]}
            />
            <P>
              {t(
                <>
                  MCP: ข้อผิดพลาดของเครื่องมือ (เช่น เครดิตไม่พอ หรือคำสั่งถูกปฏิเสธตามเงื่อนไขเนื้อหา) กลับมาเป็นผลลัพธ์ที่มี <C>isError: true</C>{" "}
                  พร้อมข้อความอธิบาย ผู้ช่วย AI อ่านแล้วแก้คำสั่งหรือบอกคุณเองได้
                </>,
                <>
                  MCP: tool errors (e.g. not enough credits, or an order refused under the content rules) come back as a result with <C>isError: true</C>{" "}
                  and an explanation, which the AI assistant reads to fix its request or tell you.
                </>
              )}
            </P>
          </Section>

          <div className="docs-end">
            <div>
              <div className="docs-end-t">{t("พร้อมเริ่มแล้ว?", "Ready to start?")}</div>
              <div className="docs-end-d">{t("สร้างคีย์ ตั้งเพดาน แล้วต่อเข้ากับโปรแกรมที่คุณใช้อยู่", "Create a key, set a cap, then connect the tools you already use.")}</div>
            </div>
            <Link href="/developer" className="docs-btn docs-btn-primary">{t("ไปที่หน้า Developer", "Go to the Developer page")}</Link>
          </div>
        </article>
      </div>
    </>
  );
}

function DocsStyles() {
  return (
    <style>{`
      .docs-hero-cta { display:flex; gap:10px; flex-wrap:wrap; margin-top:18px; }
      .docs-btn { display:inline-flex; align-items:center; padding:10px 18px; border-radius:11px; font-size:13.5px; font-weight:500;
        color:#e2e8f0; text-decoration:none; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); transition:background 150ms; }
      .docs-btn:hover { background:rgba(255,255,255,0.1); }
      .docs-btn-primary { color:#fff; border:none; background:linear-gradient(135deg,#10b981 0%,#06b6d4 50%,#8b5cf6 100%);
        box-shadow:0 8px 24px -8px rgba(139,92,246,0.6); }
      .docs-shell { max-width:1180px; margin:0 auto; padding:28px 24px 0; display:grid; grid-template-columns:220px minmax(0,1fr); gap:40px; }
      .docs-toc { position:sticky; top:96px; align-self:start; max-height:calc(100vh - 120px); overflow-y:auto; padding-right:6px; }
      .docs-toc-group { margin-bottom:18px; }
      .docs-toc-head { font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#64748b; margin-bottom:6px; }
      .docs-toc-link { display:block; padding:5px 10px; border-radius:8px; font-size:13px; color:#cbd5e1; text-decoration:none;
        border-left:2px solid transparent; transition:all 150ms; }
      .docs-toc-link:hover { color:#fff; background:rgba(255,255,255,0.04); border-left-color:#22d3ee; }
      .docs-body { min-width:0; }
      .docs-cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:12px; }
      .docs-card { display:block; padding:18px; border-radius:16px; text-decoration:none; background:rgba(15,23,42,0.5);
        border:1px solid rgba(255,255,255,0.07); backdrop-filter:blur(18px); transition:border-color 150ms, transform 150ms; }
      .docs-card:hover { border-color:rgba(34,211,238,0.35); transform:translateY(-2px); }
      .docs-card-k { display:inline-block; font-size:11px; font-weight:600; letter-spacing:0.08em; padding:3px 8px; border-radius:999px;
        color:#a5f3fc; background:rgba(34,211,238,0.1); border:1px solid rgba(34,211,238,0.25); margin-bottom:10px; }
      .docs-card-t { font-size:15px; font-weight:600; color:#fff; margin-bottom:4px; }
      .docs-card-d { font-size:12.5px; color:#94a3b8; line-height:1.6; }
      .docs-section { scroll-margin-top:96px; padding:30px 0 6px; border-bottom:1px solid rgba(255,255,255,0.05); }
      .docs-eyebrow { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#22d3ee; margin-bottom:6px; }
      .docs-h2 { font-size:24px; font-weight:600; color:#fff; margin:0 0 14px; letter-spacing:-0.01em; }
      .docs-p { font-size:14px; line-height:1.85; color:#cbd5e1; margin:0 0 14px; }
      .docs-a { color:#67e8f9; text-decoration:none; border-bottom:1px solid rgba(103,232,249,0.35); }
      .docs-inline { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; padding:1px 6px; border-radius:6px;
        background:rgba(148,163,184,0.12); color:#e2e8f0; white-space:nowrap; }
      .docs-code { margin:0 0 16px; border-radius:14px; overflow:hidden; background:rgba(2,6,23,0.72); border:1px solid rgba(255,255,255,0.07); }
      .docs-code-bar { display:flex; justify-content:space-between; align-items:center; padding:7px 10px 7px 14px; font-size:11.5px;
        color:#64748b; border-bottom:1px solid rgba(255,255,255,0.05); background:rgba(15,23,42,0.6); }
      .docs-code pre { margin:0; padding:14px 16px; font-size:12.5px; line-height:1.7; color:#e2e8f0; overflow-x:auto; white-space:pre; }
      .docs-copy { font:inherit; font-size:11.5px; color:#cbd5e1; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12);
        border-radius:7px; padding:3px 10px; cursor:pointer; }
      .docs-copy:hover { color:#fff; background:rgba(255,255,255,0.1); }
      .docs-table-wrap { overflow-x:auto; margin:0 0 16px; border-radius:14px; border:1px solid rgba(255,255,255,0.07); background:rgba(15,23,42,0.45); }
      .docs-table { width:100%; border-collapse:collapse; font-size:13px; }
      .docs-table th { text-align:left; padding:10px 14px; color:#94a3b8; font-weight:500; font-size:12px; background:rgba(15,23,42,0.6); }
      .docs-table td { padding:10px 14px; color:#cbd5e1; border-top:1px solid rgba(255,255,255,0.05); vertical-align:top; line-height:1.65; }
      .docs-table td .docs-inline { white-space:normal; }
      .docs-step { display:flex; gap:14px; margin-bottom:8px; }
      .docs-step-n { flex:0 0 30px; height:30px; border-radius:999px; display:flex; align-items:center; justify-content:center; font-size:13px;
        font-weight:600; color:#fff; background:linear-gradient(135deg,#06b6d4,#8b5cf6); }
      .docs-step-body { min-width:0; flex:1; }
      .docs-step-title { font-size:15px; font-weight:600; color:#fff; margin:4px 0 10px; }
      .docs-callout { margin:0 0 16px; padding:14px 16px; border-radius:14px; font-size:13.5px; line-height:1.75; color:#cbd5e1; border:1px solid; }
      .docs-callout-title { font-weight:600; color:#fff; margin-bottom:4px; }
      .docs-callout-info { background:rgba(34,211,238,0.06); border-color:rgba(34,211,238,0.22); }
      .docs-callout-warn { background:rgba(251,191,36,0.06); border-color:rgba(251,191,36,0.25); }
      .docs-callout-ok { background:rgba(16,185,129,0.07); border-color:rgba(16,185,129,0.25); }
      .docs-tabs { margin:0 0 16px; }
      .docs-tablist { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
      .docs-tab { font:inherit; font-size:13px; padding:7px 14px; border-radius:999px; cursor:pointer; color:#cbd5e1;
        background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); display:inline-flex; align-items:center; gap:6px; }
      .docs-tab:hover { color:#fff; }
      .docs-tab-on { color:#fff; background:rgba(34,211,238,0.12); border-color:rgba(34,211,238,0.4); }
      .docs-tab-badge { font-size:10px; padding:1px 6px; border-radius:999px; color:#6ee7b7; background:rgba(16,185,129,0.15); }
      .docs-tabpanel[hidden] { display:none; }
      .docs-ol { margin:0 0 14px; padding-left:22px; font-size:14px; line-height:1.9; color:#cbd5e1; list-style:decimal; }
      .docs-ol li::marker { color:#22d3ee; font-weight:600; }
      .docs-end { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; margin:36px 0 0; padding:24px;
        border-radius:18px; background:linear-gradient(135deg,rgba(6,182,212,0.12),rgba(139,92,246,0.12)); border:1px solid rgba(255,255,255,0.08); }
      .docs-end-t { font-size:18px; font-weight:600; color:#fff; }
      .docs-end-d { font-size:13px; color:#94a3b8; margin-top:2px; }
      @media (max-width: 900px) {
        .docs-shell { grid-template-columns:minmax(0,1fr); gap:0; padding:20px 16px 0; }
        .docs-toc { display:none; }
        .docs-cards { grid-template-columns:minmax(0,1fr); }
        .docs-h2 { font-size:21px; }
      }
    `}</style>
  );
}
