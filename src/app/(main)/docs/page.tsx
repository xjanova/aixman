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
import { Code, Tabs } from "./parts";

export const metadata: Metadata = {
  title: "คู่มือนักพัฒนา — API และ MCP | X-DREAMER",
  description:
    "เชื่อม X-DREAMER เข้ากับโค้ดและผู้ช่วย AI ของคุณ: API โมเดลภาษาแบบ OpenAI/Anthropic, MCP สำหรับสร้างภาพ วิดีโอ เพลง และวิธีต่อกับ Claude Code, Cursor, BrainX, CluadeX",
};

/** Production address: the guide is read by people pasting it into their tools. */
const ORIGIN = "https://ai.xman4289.com";
const KEY = "axm-คีย์ของคุณ";
const MODEL = "deepseek-v4.1-flash";

const SECTIONS: { id: string; label: string; group: string }[] = [
  { id: "start", label: "เริ่มต้นใน 3 นาที", group: "เริ่มต้น" },
  { id: "keys", label: "คีย์และความปลอดภัย", group: "เริ่มต้น" },
  { id: "api", label: "API โมเดลภาษา", group: "API" },
  { id: "streaming", label: "Streaming", group: "API" },
  { id: "anthropic", label: "รูปแบบ Anthropic / Claude Code", group: "API" },
  { id: "mcp", label: "MCP คืออะไร", group: "MCP" },
  { id: "tools", label: "เครื่องมือทั้งหมด", group: "MCP" },
  { id: "workflow", label: "ลำดับการทำงาน", group: "MCP" },
  { id: "clients", label: "เชื่อมต่อโปรแกรม", group: "MCP" },
  { id: "billing", label: "เครดิตและการคิดเงิน", group: "อ้างอิง" },
  { id: "limits", label: "ขีดจำกัด", group: "อ้างอิง" },
  { id: "errors", label: "รหัสข้อผิดพลาด", group: "อ้างอิง" },
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

const CURL_CHAT = `curl ${ORIGIN}/api/v1/chat/completions \\
  -H "Authorization: Bearer $XDREAMER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL}",
    "messages": [{ "role": "user", "content": "เขียนฟังก์ชัน fibonacci ใน Python" }]
  }'`;

const PY_CHAT = `from openai import OpenAI

client = OpenAI(
    base_url="${ORIGIN}/api/v1",
    api_key="${KEY}",          # หรืออ่านจาก os.environ["XDREAMER_API_KEY"]
)

reply = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "อธิบาย async/await แบบสั้นๆ"}],
    max_tokens=800,
)
print(reply.choices[0].message.content)
print(reply.usage)  # token ที่ใช้จริง — ตัดเครดิตตามนี้`;

const JS_CHAT = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${ORIGIN}/api/v1",
  apiKey: process.env.XDREAMER_API_KEY,
});

const reply = await client.chat.completions.create({
  model: "${MODEL}",
  messages: [{ role: "user", content: "เขียน regex ตรวจเบอร์มือถือไทย" }],
});
console.log(reply.choices[0].message.content);`;

const CURL_MODELS = `curl ${ORIGIN}/api/v1/models \\
  -H "Authorization: Bearer $XDREAMER_API_KEY"`;

const PY_STREAM = `stream = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "เล่านิทานสั้นๆ"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
# chunk สุดท้ายมี usage เสมอ (เราขอ include_usage ให้อัตโนมัติ)`;

const CLAUDE_CODE_MODELS = `export ANTHROPIC_BASE_URL=${ORIGIN}/api
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=${MODEL}
export ANTHROPIC_SMALL_FAST_MODEL=${MODEL}
claude`;

const ANTHROPIC_SDK = `import anthropic

client = anthropic.Anthropic(base_url="${ORIGIN}/api", api_key="${KEY}")
msg = client.messages.create(
    model="${MODEL}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "สรุป diff นี้ให้หน่อย"}],
)
print(msg.content[0].text)`;

const MCP_URL = `${ORIGIN}/api/mcp`;

const CLAUDE_CODE_MCP = `claude mcp add --transport http xdreamer ${MCP_URL} \\
  --header "Authorization: Bearer ${KEY}"`;

const CURSOR_MCP = JSON.stringify({ mcpServers: { xdreamer: { url: MCP_URL, headers: { Authorization: `Bearer ${KEY}` } } } }, null, 2);

const DESKTOP_MCP = JSON.stringify(
  {
    mcpServers: {
      xdreamer: {
        command: "npx",
        args: ["-y", "mcp-remote", MCP_URL, "--header", "Authorization:${AUTH_HEADER}"],
        env: { AUTH_HEADER: `Bearer ${KEY}` },
      },
    },
  },
  null,
  2
);

const CLUADEX_JSON = JSON.stringify(
  {
    mcpServers: {
      xdreamer: { type: "http", url: MCP_URL, headers: { Authorization: "Bearer ${XDREAMER_API_KEY}" }, env: { XDREAMER_API_KEY: KEY } },
    },
  },
  null,
  2
);

const GENERIC_MCP = JSON.stringify(
  {
    mcpServers: {
      xdreamer: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${KEY}` } },
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
                 "arguments":{"prompt":"ตลาดน้ำยามเช้า หมอกบางๆ ภาพถ่ายฟิล์ม","aspect_ratio":"16:9"}}}'`;

const WORKFLOW = `→ get_credits                          { "balance": 1250 }
→ list_models { "kind": "video" }      [{ "id": "ltx-2.5", "credits": 40, … }, …]
→ generate_image {
     "prompt": "แมวส้มนั่งบนหลังคาวัด แสงเย็น",
     "aspect_ratio": "16:9" }          { "id": 8812, "status": "processing" }
→ get_generation { "id": 8812, "wait_seconds": 45 }
                                       { "status": "completed", "urls": ["https://…/8812-0.png"] }
→ generate_video {
     "prompt": "กล้องค่อยๆ ซูมเข้า แมวหันมามอง",
     "model": "ltx-2.5", "duration": 5,
     "first_frame_url": "https://…/8812-0.png" }   { "id": 8813, "status": "queued" }
→ get_generation { "id": 8813, "wait_seconds": 45 }   (ทำซ้ำจนเสร็จ)`;

// ─── page ─────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const groups = Array.from(new Set(SECTIONS.map((s) => s.group)));

  return (
    <>
      <DocsStyles />
      <PageHero
        image="/showcase/admin-room.jpg"
        eyebrow="· คู่มือนักพัฒนา"
        title="API และ MCP"
        emphasis="ของ X-DREAMER"
        sub="ต่อโค้ด แอป และผู้ช่วย AI ของคุณเข้ากับโมเดลภาษา และเครื่องมือสร้างภาพ วิดีโอ เพลง — คีย์เดียว เครดิตเดียว"
        hue={190}
      >
        <div className="docs-hero-cta">
          <Link href="/developer" className="docs-btn docs-btn-primary">สร้างคีย์ API</Link>
          <a href="#clients" className="docs-btn">เชื่อมต่อ Claude / Cursor / BrainX</a>
        </div>
      </PageHero>

      <div className="docs-shell">
        <aside className="docs-toc" aria-label="สารบัญ">
          {groups.map((g) => (
            <div key={g} className="docs-toc-group">
              <div className="docs-toc-head">{g}</div>
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <a key={s.id} href={`#${s.id}`} className="docs-toc-link">{s.label}</a>
              ))}
            </div>
          ))}
          <div className="docs-toc-group">
            <div className="docs-toc-head">ลิงก์</div>
            <Link href="/developer" className="docs-toc-link">คีย์ · ราคา · การใช้งาน</Link>
            <Link href="/pricing" className="docs-toc-link">เติมเครดิต</Link>
          </div>
        </aside>

        <article className="docs-body">
          <div className="docs-cards">
            {[
              { k: "API", t: "โมเดลภาษา", d: "รูปแบบ OpenAI และ Anthropic — ใช้ไลบรารีเดิมได้ เปลี่ยนแค่ base URL", href: "#api" },
              { k: "MCP", t: "สร้างภาพ วิดีโอ เพลง", d: "ให้ Claude, Cursor หรือ BrainX สั่งงานสตูดิโอของเราเองได้", href: "#mcp" },
              { k: "✦", t: "คิดเงินเป็นเครดิต", d: "จ่ายตามจริงต่อ token / ต่องาน · ตั้งเพดานต่อคีย์ได้", href: "#billing" },
            ].map((c) => (
              <a key={c.k} href={c.href} className="docs-card">
                <div className="docs-card-k">{c.k}</div>
                <div className="docs-card-t">{c.t}</div>
                <div className="docs-card-d">{c.d}</div>
              </a>
            ))}
          </div>

          <Section id="start" eyebrow="เริ่มต้น" title="เริ่มต้นใน 3 นาที">
            <Step n={1} title="สร้างคีย์">
              <P>
                ล็อกอินแล้วไปที่ <Link href="/developer" className="docs-a">หน้า Developer</Link> → ตั้งชื่อคีย์ → กด สร้างคีย์ คีย์ขึ้นต้นด้วย{" "}
                <C>axm-</C> และแสดง<strong>ครั้งเดียว</strong> เก็บไว้ในที่ปลอดภัย
              </P>
            </Step>
            <Step n={2} title="ลองเรียก API">
              <Code lang="bash" code={CURL_CHAT} />
            </Step>
            <Step n={3} title="หรือให้ผู้ช่วย AI ใช้สตูดิโอผ่าน MCP">
              <Code lang="bash" title="Claude Code" code={CLAUDE_CODE_MCP} />
              <P>แล้วพิมพ์สั่งได้เลย เช่น “สร้างภาพโลโก้ร้านกาแฟสไตล์มินิมอล แล้วทำเป็นวิดีโอ 5 วินาที” — โปรแกรมอื่นดูที่ <a href="#clients" className="docs-a">เชื่อมต่อโปรแกรม</a></P>
            </Step>
          </Section>

          <Section id="keys" eyebrow="เริ่มต้น" title="คีย์และความปลอดภัย">
            <P>
              ทุกคำขอส่งคีย์ใน header <C>Authorization: Bearer axm-…</C> (API รูปแบบ Anthropic รับ <C>x-api-key</C> ได้ด้วย)
              เราเก็บเฉพาะค่า hash ของคีย์ — ถ้าทำหายให้ลบแล้วสร้างใหม่ ลบคีย์แล้วโปรแกรมที่ใช้คีย์นั้นหยุดทันที
            </P>
            <Table
              head={["แนวปฏิบัติ", "เหตุผล"]}
              rows={[
                ["หนึ่งคีย์ต่อหนึ่งโปรแกรม/เครื่อง", "เห็นยอดใช้แยกกัน และลบทิ้งได้ทีละตัวโดยไม่กระทบตัวอื่น"],
                ["ตั้งเพดานเครดิตต่อวัน/ต่อเดือน", "เอเจนต์ที่วนเรียกซ้ำจะหยุดที่เพดาน (402 key_limit_reached) แทนที่จะใช้เครดิตจนหมด"],
                ["อย่าใส่คีย์ในโค้ดฝั่งเบราว์เซอร์หรือแอปมือถือ", "ใครเปิดดูซอร์สก็เห็นคีย์ — เรียกผ่านเซิร์ฟเวอร์ของคุณเอง"],
                ["เก็บในตัวแปรแวดล้อม เช่น XDREAMER_API_KEY", "ไม่หลุดเข้า git · BrainX และ CluadeX เก็บคีย์แบบเข้ารหัสในเครื่องให้อยู่แล้ว"],
              ]}
            />
          </Section>

          <Section id="api" eyebrow="API" title="API โมเดลภาษา (รูปแบบ OpenAI)">
            <P>
              Base URL <C>{ORIGIN}/api/v1</C> — ใช้กับไลบรารี OpenAI ทุกภาษาและเครื่องมือที่ให้ตั้ง “OpenAI-compatible endpoint” ได้เลย
              ราคาของแต่ละโมเดลดูได้ที่ <Link href="/developer" className="docs-a">หน้า Developer</Link> หรือจาก <C>GET /models</C>
            </P>
            <Table
              head={["Method", "Path", "ใช้ทำอะไร"]}
              rows={[
                [<C key="m">GET</C>, <C key="p">/api/v1/models</C>, "รายการโมเดลภาษา context และราคา (เครดิตต่อ 1 ล้าน token)"],
                [<C key="m">POST</C>, <C key="p">/api/v1/chat/completions</C>, "แชต — รูปแบบ OpenAI รองรับ stream, tools / function calling"],
                [<C key="m">POST</C>, <C key="p">/api/v1/messages</C>, "แชต — รูปแบบ Anthropic (สำหรับ Claude Code และ Anthropic SDK)"],
                [<C key="m">POST</C>, <C key="p">/api/v1/messages/count_tokens</C>, "ประมาณจำนวน token ของคำขอ (ไม่คิดเงิน)"],
                [<C key="m">POST</C>, <C key="p">/api/mcp</C>, "MCP server — เครื่องมือสร้างภาพ วิดีโอ เพลง (ดูหัวข้อ MCP)"],
              ]}
            />
            <Tabs
              tabs={[
                { id: "py", label: "Python", body: <Code lang="python" code={PY_CHAT} /> },
                { id: "js", label: "Node.js", body: <Code lang="javascript" code={JS_CHAT} /> },
                { id: "curl", label: "curl", body: <Code lang="bash" code={CURL_CHAT} /> },
                { id: "models", label: "รายการโมเดล", body: <Code lang="bash" code={CURL_MODELS} /> },
              ]}
            />
            <P>
              ฟิลด์ที่ส่งต่อให้โมเดล: <C>messages</C> <C>max_tokens</C> <C>stream</C> <C>temperature</C> <C>top_p</C> <C>stop</C>{" "}
              <C>presence_penalty</C> <C>frequency_penalty</C> <C>tools</C> <C>tool_choice</C> <C>parallel_tool_calls</C>{" "}
              <C>response_format</C> <C>seed</C> <C>logprobs</C> <C>reasoning_effort</C> — ฟิลด์อื่นถูกตัดทิ้ง · <C>n</C> ต้องเป็น 1 ·
              ฟิลด์ <C>model</C> ในคำตอบเป็นชื่อโมเดลของเราเสมอ
            </P>
          </Section>

          <Section id="streaming" eyebrow="API" title="Streaming">
            <P>
              ส่ง <C>{'"stream": true'}</C> แล้วอ่านแบบ Server-Sent Events เหมือน OpenAI ทุกประการ chunk สุดท้ายมี <C>usage</C> เสมอ
              ถ้าตัดการเชื่อมต่อกลางทาง เราคิดเงินเฉพาะส่วนที่สร้างไปแล้ว และคืนเครดิตที่กันไว้ส่วนที่เหลือ
            </P>
            <Code lang="python" code={PY_STREAM} />
          </Section>

          <Section id="anthropic" eyebrow="API" title="รูปแบบ Anthropic และ Claude Code">
            <P>
              <C>/api/v1/messages</C> พูดภาษาเดียวกับ Anthropic Messages API (ข้อความ รูปภาพ tool use และ streaming)
              จึงใช้ Claude Code ให้เขียนโค้ดด้วยโมเดลของเราได้ โดยตั้งค่าตัวแปรก่อนเปิด <C>claude</C>:
            </P>
            <Code lang="bash" title="Claude Code ใช้โมเดลของเรา" code={CLAUDE_CODE_MODELS} />
            <Code lang="python" title="Anthropic SDK" code={ANTHROPIC_SDK} />
            <Callout tone="warn" title="ข้อควรรู้">
              Thinking blocks และเครื่องมือฝั่งเซิร์ฟเวอร์ของ Anthropic (เช่น web search) ไม่ถูกส่งต่อ · เอเจนต์เรียกโมเดลหลายรอบต่อคำสั่ง
              — ตั้งเพดานเครดิตของคีย์ไว้ก่อนใช้งานจริง
            </Callout>
          </Section>

          <Section id="mcp" eyebrow="MCP" title="MCP คืออะไร">
            <P>
              Model Context Protocol คือมาตรฐานที่ให้ผู้ช่วย AI ใช้เครื่องมือภายนอกได้ เมื่อต่อ MCP ของเรา Claude, Cursor, BrainX หรือ CluadeX
              จะสั่งสร้างภาพ วิดีโอ เพลง ตรวจสถานะงาน และถามโมเดลภาษาได้เอง โดยใช้คีย์และเครดิตเดียวกับ API
            </P>
            <Table
              head={["", ""]}
              rows={[
                ["Endpoint", <C key="u">{MCP_URL}</C>],
                ["Transport", "Streamable HTTP (POST JSON-RPC 2.0) — ไม่เก็บ session, ไม่ต้องเปิด SSE ค้างไว้"],
                ["ยืนยันตัวตน", <span key="a"><C>Authorization: Bearer axm-…</C> — คีย์เดียวกับ API</span>],
                ["Protocol", "2025-11-25 · 2025-06-18 · 2025-03-26 · 2024-11-05"],
              ]}
            />
            <Code lang="bash" title="เรียกตรงๆ (ทดสอบ) — โปรแกรม MCP ทำขั้นนี้ให้เอง" code={RAW_MCP} />
          </Section>

          <Section id="tools" eyebrow="MCP" title="เครื่องมือทั้งหมด">
            <Table
              head={["เครื่องมือ", "ทำอะไร", "พารามิเตอร์หลัก", "เครดิต"]}
              rows={[
                [<C key="t">list_models</C>, "โมเดลที่ใช้ได้ พร้อมราคา", <span key="p"><C>kind</C>: image · video · audio · text</span>, "ฟรี"],
                [<C key="t">get_credits</C>, "ยอดเครดิตคงเหลือ", "—", "ฟรี"],
                [<C key="t">generate_image</C>, "สร้างภาพจากข้อความ (ไทย/อังกฤษ)", <span key="p"><C>prompt</C>* <C>model</C> <C>aspect_ratio</C> <C>negative_prompt</C> <C>num_outputs</C> (1–4)</span>, "ตามโมเดล"],
                [<C key="t">generate_video</C>, "สร้างวิดีโอ (หลายโมเดลมีเสียงในตัว) เริ่มจากภาพแรก/จบที่ภาพสุดท้ายได้", <span key="p"><C>prompt</C>* <C>model</C> <C>duration</C> <C>aspect_ratio</C> <C>resolution</C> <C>first_frame_url</C> <C>last_frame_url</C></span>, "ตามโมเดล/ความยาว"],
                [<C key="t">generate_music</C>, "สร้างเพลงจากสไตล์ ใส่เนื้อร้องได้", <span key="p"><C>prompt</C>* <C>lyrics</C> <C>model</C> <C>duration</C> (10–300 วิ)</span>, "ตามโมเดล"],
                [<C key="t">get_generation</C>, "สถานะและลิงก์ผลงาน รอให้เสร็จได้สูงสุด 45 วินาทีต่อครั้ง", <span key="p"><C>id</C>* <C>wait_seconds</C> (0–45)</span>, "ฟรี"],
                [<C key="t">list_generations</C>, "งานล่าสุดของคุณ", <span key="p"><C>limit</C> (1–20)</span>, "ฟรี"],
                [<C key="t">upload_image</C>, "อัปโหลดภาพ (PNG/JPEG/WebP base64) เพื่อใช้เป็นเฟรมของวิดีโอ", <span key="p"><C>data_base64</C>*</span>, "ฟรี"],
                [<C key="t">chat</C>, "ถามโมเดลภาษาหนึ่งคำตอบ", <span key="p"><C>model</C>* <C>prompt</C>* <C>system</C> <C>max_tokens</C></span>, "ต่อ token"],
              ]}
            />
            <P>* = จำเป็น · <C>aspect_ratio</C>: 1:1 · 16:9 · 9:16 · 4:3 · 3:4 · 3:2 · 2:3 · ผู้ช่วย AI อ่านคำอธิบายเครื่องมือเองจาก <C>tools/list</C> ไม่ต้องจำ</P>
          </Section>

          <Section id="workflow" eyebrow="MCP" title="ลำดับการทำงาน">
            <P>
              งานสร้างภาพ/วิดีโอ/เพลงตอบกลับทันทีพร้อมเลข <C>id</C> (ตัดเครดิตตอนสั่ง ถ้างานล้มเหลวคืนเครดิตอัตโนมัติ) แล้วใช้{" "}
              <C>get_generation</C> พร้อม <C>wait_seconds</C> รอผล — ภาพมักเสร็จในรอบแรก วิดีโอใช้เวลาหลายนาที
            </P>
            <Code lang="text" title="ตัวอย่างลำดับที่ผู้ช่วย AI ทำให้" code={WORKFLOW} />
            <Callout tone="info" title="ภาพเฟรมแรก/สุดท้าย">
              <C>first_frame_url</C> และ <C>last_frame_url</C> ต้องเป็นลิงก์ที่อยู่บนระบบเรา — ผลจาก <C>generate_image</C> หรือ <C>upload_image</C> —
              ลิงก์จากเว็บอื่นจะถูกปฏิเสธ
            </Callout>
          </Section>

          <Section id="clients" eyebrow="MCP" title="เชื่อมต่อโปรแกรม">
            <P>เลือกโปรแกรมที่ใช้ แทนที่ <C>{KEY}</C> ด้วยคีย์จริงจากหน้า Developer</P>
            <Tabs
              tabs={[
                {
                  id: "claude-code",
                  label: "Claude Code",
                  body: (
                    <>
                      <P>รันครั้งเดียว (เพิ่ม <C>--scope user</C> ถ้าต้องการใช้ทุกโปรเจกต์) แล้วตรวจด้วย <C>/mcp</C> ในหน้าจอ Claude Code</P>
                      <Code lang="bash" code={CLAUDE_CODE_MCP} />
                    </>
                  ),
                },
                {
                  id: "brainx",
                  label: "BrainX",
                  badge: "ในตัว",
                  body: (
                    <>
                      <ol className="docs-ol">
                        <li>เปิด BrainX → <strong>Settings</strong> → การ์ด <strong>XDREAMER</strong></li>
                        <li>วางคีย์ <C>axm-…</C> แล้วกด <strong>บันทึกและทดสอบ</strong> — BrainX ทดสอบกับเซิร์ฟเวอร์และแสดงยอดเครดิตก่อนบันทึก</li>
                        <li>เริ่ม session ใหม่ของเอเจนต์ (Claude, Gemini, Grok, CluadeX ที่ต่อกับ BrainX) — จะเห็นเครื่องมือ <C>xdreamer__generate_image</C>, <C>xdreamer__generate_video</C> …</li>
                      </ol>
                      <Callout tone="ok" title="ทุกเอเจนต์ใช้ร่วมกัน">
                        คีย์เก็บแบบเข้ารหัส (DPAPI) ในเครื่องนี้ ไม่อยู่ใน vault ที่ sync · ตั้งผ่าน environment ได้ด้วย <C>XDREAMER_API_KEY</C> ·
                        ต้องใช้ BrainX MCP 2.10 ขึ้นไป
                      </Callout>
                    </>
                  ),
                },
                {
                  id: "cluadex",
                  label: "CluadeX",
                  badge: "ในตัว",
                  body: (
                    <>
                      <ol className="docs-ol">
                        <li>เปิด CluadeX → <strong>Setup</strong> → กลุ่ม <strong>การเชื่อมต่อ</strong> → <strong>XDREAMER</strong> → เชื่อมต่อ</li>
                        <li>วางคีย์ <C>axm-…</C> — เก็บแบบเข้ารหัสในเครื่อง ไม่ต้องติดตั้ง Node.js</li>
                        <li>ถ้ามี BrainX ในเครื่อง CluadeX จะเพิ่มเป็น bridge ของ BrainX ให้ทุกเอเจนต์ใช้ร่วมกัน ไม่งั้นจะอยู่ในรายการ MCP ของ CluadeX</li>
                      </ol>
                      <P>หรือเพิ่มเองในไฟล์ <C>mcp_servers.json</C> (CluadeX 3.0.189 ขึ้นไปรองรับ server แบบ HTTP) — <C>{"${ชื่อ}"}</C> อ่านจาก env หรือตัวแปรของ Windows:</P>
                      <Code lang="json" title="~/.cluadex/mcp_servers.json" code={CLUADEX_JSON} />
                    </>
                  ),
                },
                {
                  id: "cursor",
                  label: "Cursor / Windsurf / Cline",
                  body: (
                    <>
                      <P>ใส่ใน <C>.cursor/mcp.json</C> ของโปรเจกต์ หรือ <C>~/.cursor/mcp.json</C> สำหรับทุกโปรเจกต์ (โปรแกรมอื่นใช้รูปแบบเดียวกันในหน้าตั้งค่า MCP)</P>
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
                        Settings → Developer → Edit Config แล้วใส่ใน <C>claude_desktop_config.json</C> จากนั้นปิดเปิดโปรแกรมใหม่ — ต้องมี Node.js
                        (<C>mcp-remote</C> ต่อ MCP แบบ HTTP ให้ คีย์อยู่ใน <C>env</C> เพราะ Windows ตัดช่องว่างใน args)
                      </P>
                      <Code lang="json" title="claude_desktop_config.json" code={DESKTOP_MCP} />
                    </>
                  ),
                },
                {
                  id: "other",
                  label: "อื่นๆ",
                  body: (
                    <>
                      <P>โปรแกรมที่รองรับ MCP แบบ Streamable HTTP ใช้ค่านี้ได้ทันที โปรแกรมที่รองรับแค่ stdio ใช้รูปแบบ <C>mcp-remote</C> เหมือน Claude Desktop</P>
                      <Code lang="json" code={GENERIC_MCP} />
                    </>
                  ),
                },
              ]}
            />
          </Section>

          <Section id="billing" eyebrow="อ้างอิง" title="เครดิตและการคิดเงิน">
            <Table
              head={["หัวข้อ", "รายละเอียด"]}
              rows={[
                ["หน่วย", "เครดิตเดียวกับสตูดิโอ เติมที่หน้า Pricing · API คิดละเอียดถึง 1/1000 เครดิต ส่วนที่ไม่ครบ 1 เครดิตยกไปรวมกับคำขอถัดไปของคีย์เดียวกัน"],
                ["กันเครดิตก่อน", "ก่อนเริ่มคำขอ ระบบกันเครดิตตามกรณีสูงสุด (ความยาว prompt + max_tokens ทั้งหมด) แล้วคืนส่วนเกินทันทีที่จบ — max_tokens สูงต้องมีเครดิตพอกัน"],
                ["คิดตามจริง", "ตัดตาม usage ที่โมเดลรายงาน ไม่ใช่ตามที่กันไว้"],
                ["Cache", "ข้อความที่ส่งซ้ำ (เช่น ไฟล์เดิมในบทสนทนา) คิดราคา input แบบ cache ที่ถูกกว่า — ดูคอลัมน์ “Input ซ้ำ” ที่หน้า Developer"],
                ["ช่วงลดราคา", "บางโมเดลมีช่วง off-peak ราคาถูกลง แสดงไว้ใต้ราคาในหน้า Developer (เวลาไทย)"],
                ["งานภาพ/วิดีโอ/เพลง", "ราคาต่องานตาม list_models ตัดตอนสั่ง งานล้มเหลวคืนเครดิตอัตโนมัติ"],
                ["เพดานต่อคีย์", "ต่อวัน/ต่อเดือน (เวลากรุงเทพ) ตั้งได้ที่หน้า Developer"],
              ]}
            />
          </Section>

          <Section id="limits" eyebrow="อ้างอิง" title="ขีดจำกัด">
            <Table
              head={["", "ค่า"]}
              rows={[
                ["API โมเดลภาษา", "60 คำขอ/นาที ต่อคีย์ (ค่าเริ่มต้น) — เกินได้ 429 พร้อม Retry-After"],
                ["MCP", "60 การเรียกเครื่องมือ/นาที ต่อคีย์ · ขนาดคำขอไม่เกิน 15 MB"],
                ["get_generation", "รอได้สูงสุด 45 วินาทีต่อครั้ง — เรียกซ้ำได้"],
                ["chat (MCP)", <span key="c"><C>max_tokens</C> สูงสุด 32,768</span>],
              ]}
            />
          </Section>

          <Section id="errors" eyebrow="อ้างอิง" title="รหัสข้อผิดพลาด">
            <P>
              API ตอบข้อผิดพลาดในรูปแบบ OpenAI: <C>{'{"error": {"message", "type", "code"}}'}</C> (รูปแบบ Anthropic ใช้ <C>{'{"type": "error", "error": {…}}'}</C>)
              ทุกกรณีที่ขึ้นว่า “nothing was charged” ไม่มีการตัดเครดิต
            </P>
            <Table
              head={["HTTP", "code", "ความหมาย / ทำอย่างไร"]}
              rows={[
                ["401", <C key="c">invalid_api_key</C>, "ไม่มีคีย์ คีย์ผิด หรือถูกลบแล้ว"],
                ["401", <C key="c">account_disabled</C>, "บัญชีถูกระงับ"],
                ["400", <C key="c">model_required</C>, "ไม่ได้ระบุ model"],
                ["400", <C key="c">context_length_exceeded</C>, "prompt ยาวเกิน context ของโมเดล"],
                ["400", <C key="c">upstream_rejected</C>, "โมเดลปฏิเสธคำขอ (ข้อความในรายละเอียดบอกเหตุผล)"],
                ["402", <C key="c">insufficient_credits</C>, "เครดิตไม่พอสำหรับกรณีสูงสุด — ลด max_tokens หรือเติมเครดิต"],
                ["402", <C key="c">key_limit_reached</C>, "เกินเพดานรายวัน/เดือนของคีย์ — ปรับที่หน้า Developer"],
                ["404", <C key="c">model_not_found</C>, "ไม่มีโมเดลนี้ หรือปิดอยู่ — ดู GET /api/v1/models"],
                ["413", "—", "คำขอใหญ่เกินกำหนด"],
                ["429", <C key="c">rate_limited</C>, "เรียกถี่เกิน — รอตาม Retry-After"],
                ["502", <C key="c">upstream_error</C>, "อ่านคำตอบของโมเดลไม่ได้ — ไม่ตัดเครดิต ลองใหม่"],
                ["503", <C key="c">model_warming</C>, "โมเดลที่รันบน GPU ของเรากำลังเปิดเครื่อง (20–40 นาที) — ลองใหม่ตาม Retry-After ไม่ตัดเครดิต"],
                ["503", <C key="c">model_offline</C>, "โมเดลปิดให้บริการชั่วคราว"],
                ["503", <C key="c">backend_unavailable</C>, "ผู้ให้บริการโมเดลไม่ว่าง — ลองใหม่ภายหลัง"],
              ]}
            />
            <P>
              MCP: ข้อผิดพลาดของเครื่องมือ (เช่น เครดิตไม่พอ หรือคำสั่งถูกปฏิเสธตามเงื่อนไขเนื้อหา) กลับมาเป็นผลลัพธ์ที่มี <C>isError: true</C>{" "}
              พร้อมข้อความอธิบาย ผู้ช่วย AI อ่านแล้วแก้คำสั่งหรือบอกคุณเองได้
            </P>
          </Section>

          <div className="docs-end">
            <div>
              <div className="docs-end-t">พร้อมเริ่มแล้ว?</div>
              <div className="docs-end-d">สร้างคีย์ ตั้งเพดาน แล้วต่อเข้ากับโปรแกรมที่คุณใช้อยู่</div>
            </div>
            <Link href="/developer" className="docs-btn docs-btn-primary">ไปที่หน้า Developer</Link>
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
