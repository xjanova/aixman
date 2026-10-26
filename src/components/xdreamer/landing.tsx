"use client";

/**
 * X-DREAMER landing.
 *
 * Leads with real output: the hero is a clip made on the platform, every
 * frame on the wall carries the prompt and model that produced it (see
 * @/lib/showcase), and the prices are the packages in the DB. The six tools
 * are shown with the same plates as the studio's own menu, so the page and
 * the product look like one thing.
 *
 * The hero's prompt bar is real: it opens the studio on that tab with that
 * prompt (the studio reads ?tab= and ?prompt= — see readLinkIntent there).
 *
 * The fiber-thread background comes from the global AmbientBackground in the
 * root layout; sections stay translucent so it shows between them.
 */

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

import { MediaTile } from "./media";
import { XdreamerLockup } from "./logo";
import { FAQ_ITEMS, HERO_MEDIA, PROVIDERS, SHOWCASE_ITEMS, type ShowcaseItem } from "@/lib/showcase";

export type Tier = {
  slug: string;
  name: string;
  badge: string | null;
  /** "ฟรี" or "฿399" */
  price: string;
  /** "500 + 50 โบนัส" */
  credits: string;
  feats: string[];
  featured: boolean;
  free: boolean;
};

// ─── content ─────────────────────────────────────────────────────────────

function work(key: string): ShowcaseItem {
  const item = SHOWCASE_ITEMS.find((i) => i.key === key);
  if (!item) throw new Error(`showcase item ${key} is missing`);
  return item;
}

type ToolKey = "image" | "video" | "edit" | "lipsync" | "audio" | "model3d";

interface Tool {
  key: ToolKey;
  label: string;
  en: string;
  plate: string;
  href: string;
  desc: string;
  specs: { k: string; l: string }[];
  cta: string;
}

const TOOLS: Tool[] = [
  {
    key: "image", label: "สร้างภาพ", en: "Text → Image", plate: "/studio-tabs/tab-image-v3.png", href: "/generate?tab=image",
    desc: "พิมพ์สิ่งที่คิด ได้ภาพความละเอียดสูงในไม่กี่วินาที เลือกโมเดลเองหรือให้ระบบเลือกให้",
    specs: [{ k: "4K", l: "ความละเอียดสูงสุด" }, { k: "~10s", l: "ต่อภาพ" }],
    cta: "เริ่มสร้างภาพ",
  },
  {
    key: "video", label: "สร้างวิดีโอ", en: "Text / Image → Video", plate: "/studio-tabs/tab-video-v3.png", href: "/generate?tab=video",
    desc: "เปลี่ยนข้อความหรือภาพนิ่งให้เคลื่อนไหว กำหนดมุมกล้องและความยาวได้ พร้อมเสียงในตัวบางโมเดล",
    specs: [{ k: "1080p", l: "ความละเอียด" }, { k: "15s", l: "ความยาวสูงสุด" }],
    cta: "สร้างวิดีโอ",
  },
  {
    key: "edit", label: "แก้ไขภาพ", en: "Edit & Upscale", plate: "/studio-tabs/tab-edit-v3.png", href: "/generate?tab=edit",
    desc: "ปรับแก้ภาพเดิมด้วย prompt หรือขยายความละเอียดให้คมขึ้นหลายเท่า โดยรักษารายละเอียดต้นฉบับไว้",
    specs: [{ k: "2–4×", l: "ขยายภาพ" }, { k: "img2img", l: "แก้ด้วย prompt" }],
    cta: "ลองแก้ไขภาพ",
  },
  {
    key: "lipsync", label: "ลิปซิงค์", en: "Portrait + Voice → Video", plate: "/studio-tabs/tab-lipsync-v3.png", href: "/generate?tab=lipsync",
    desc: "อัปโหลดภาพใบหน้าและไฟล์เสียงพูดภาษาใดก็ได้ ได้คลิปคนในภาพพูดตามเสียงนั้น ความยาวและราคาคิดตามความยาวเสียงจริง",
    specs: [{ k: "1–15s", l: "ความยาวเสียง" }, { k: "ทุกภาษา", l: "ปากขยับตามเสียง" }],
    cta: "ลองลิปซิงค์",
  },
  {
    key: "audio", label: "สร้างเพลง", en: "Lyrics → Song", plate: "/studio-tabs/tab-music-v3.png", href: "/generate?tab=audio",
    desc: "บอกแนวเพลงและใส่เนื้อร้อง ได้เพลงพร้อมเสียงร้อง หรือวางเพลงต้นฉบับเพื่อทำเวอร์ชันคัฟเวอร์",
    specs: [{ k: "Vocal", l: "ร้องจากเนื้อที่ใส่" }, { k: "Cover", l: "จากเพลงต้นฉบับ" }],
    cta: "แต่งเพลง",
  },
  {
    key: "model3d", label: "สร้างโมเดล 3D", en: "Image → 3D Model", plate: "/studio-tabs/tab-model3d-v3.png", href: "/generate/3d",
    desc: "อัปโหลดภาพวัตถุหรือตัวละครหนึ่งภาพ ได้โมเดล 3D พร้อมพื้นผิว PBR เป็นไฟล์ GLB หมุนดูในเว็บได้ทันที และใช้ต่อใน Blender, Godot หรือ Unity ได้",
    specs: [{ k: "GLB", l: "ไฟล์พร้อมพื้นผิว" }, { k: "3–6 min", l: "ต่อโมเดล" }],
    cta: "เปิด 3D Studio",
  },
];

/** What the hero's prompt bar can start, with a real prompt as each placeholder. */
const PROMPT_TABS = [
  { key: "image", label: "ภาพ", example: work("food") },
  { key: "video", label: "วิดีโอ", example: work("dancer") },
] as const;
type PromptTab = (typeof PROMPT_TABS)[number]["key"];

/** Bar heights for the waveform drawn in the voice and song examples. */
const WAVE = [28, 46, 70, 52, 34, 62, 84, 58, 40, 72, 90, 64, 44, 30, 56, 80, 66, 48, 36, 60, 86, 70, 50, 38];

// ─── page ────────────────────────────────────────────────────────────────

export default function XdreamerLanding({ tiers }: { tiers: Tier[] }) {
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const freeTier = tiers.find((t) => t.free) ?? null;

  // The global background brightens behind the top of the home page.
  useEffect(() => {
    document.body.dataset.xdrPage = "home";
    return () => { delete document.body.dataset.xdrPage; };
  }, []);

  return (
    <div className="xh">
      <Nav signedIn={signedIn} name={session?.user?.name ?? ""} email={session?.user?.email ?? ""} />
      <Hero signedIn={signedIn} freeTier={freeTier} />
      <Facts />
      <Reveal><Tools /></Reveal>
      <Reveal><Work /></Reveal>
      <Reveal><Steps /></Reveal>
      <Reveal><Pricing tiers={tiers} /></Reveal>
      <Reveal><Faq /></Reveal>
      <Closing signedIn={signedIn} freeTier={freeTier} />
      <style>{CSS}</style>
    </div>
  );
}

/** CSS-only scroll reveal (`.xdr-reveal` in globals.css): content is never left hidden. */
function Reveal({ children }: { children: React.ReactNode }) {
  return <div className="xdr-reveal">{children}</div>;
}

// ─── nav ─────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: "/generate", label: "สตูดิโอ" },
  { href: "/generate/3d", label: "สร้างโมเดล 3D" },
  { href: "/gallery", label: "แกลเลอรี" },
  { href: "/pricing", label: "ราคา" },
];

function Nav({ signedIn, name, email }: { signedIn: boolean; name: string; email: string }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  // The bar turns solid once the hero has scrolled under it.
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    const first = requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav className="xh-nav" data-solid={solid || open ? "true" : "false"} aria-label="เมนูหลัก">
      <div className="xh-wrap xh-nav-row">
        <Link href="/" className="xh-brand" aria-label="X-DREAMER หน้าแรก">
          <XdreamerLockup size={36} fontSize={15} />
        </Link>
        <div className="xh-nav-links">
          {NAV_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </div>
        <div className="xh-nav-end">
          {signedIn ? (
            <UserMenu name={name || "สมาชิก"} email={email} />
          ) : (
            <>
              <Link href="/login" className="xh-btn xh-btn-ghost xh-hide-sm">เข้าสู่ระบบ</Link>
              <Link href="/login?signup=1" className="xh-btn xh-btn-light xh-hide-sm">เริ่มสร้างฟรี</Link>
            </>
          )}
          <button type="button" className="xh-burger" aria-label={open ? "ปิดเมนู" : "เปิดเมนู"} aria-expanded={open}
            onClick={() => setOpen((o) => !o)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div className="xh-wrap xh-drawer">
          {NAV_LINKS.map((l) => <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>)}
          {!signedIn && (
            <div className="xh-drawer-cta">
              <Link href="/login" className="xh-btn xh-btn-ghost" onClick={() => setOpen(false)}>เข้าสู่ระบบ</Link>
              <Link href="/login?signup=1" className="xh-btn xh-btn-light" onClick={() => setOpen(false)}>เริ่มสร้างฟรี</Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="xh-user">
      <button type="button" className="xh-user-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="xh-avatar" aria-hidden="true">{(name[0] || "X").toUpperCase()}</span>
        <span className="xh-user-name">{name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="xh-user-menu">
          <div className="xh-user-head">
            <div>{name}</div>
            {email && <small>{email}</small>}
          </div>
          <Link href="/generate" onClick={() => setOpen(false)}>สตูดิโอ</Link>
          <Link href="/profile" onClick={() => setOpen(false)}>Dashboard</Link>
          <Link href="/gallery" onClick={() => setOpen(false)}>แกลเลอรี</Link>
          <button type="button" className="xh-signout" onClick={() => signOut({ callbackUrl: "/" })}>ออกจากระบบ</button>
        </div>
      )}
    </div>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────

function Hero({ signedIn, freeTier }: { signedIn: boolean; freeTier: Tier | null }) {
  return (
    <header className="xh-hero">
      <div className="xh-hero-media" aria-hidden="true">
        {/* The clip was generated from this exact still, so the crossfade
            from poster to video does not show. See @/lib/showcase. */}
        <MediaTile image={HERO_MEDIA.image} video={HERO_MEDIA.video} alt="" policy="eager" priority sizes="100vw" objectPosition="70% 50%" />
        <div className="xh-hero-scrim-x" />
        <div className="xh-hero-scrim-y" />
      </div>

      <div className="xh-wrap xh-hero-grid">
        <div className="xh-hero-copy">
          <div className="xh-live"><span aria-hidden="true" />ภาพ · วิดีโอ · แก้ภาพ · ลิปซิงค์ · เพลง · 3D</div>
          <h1 className="xh-h1">
            ฝันไว้แบบไหน<br />
            ก็<span className="xh-thread-word">ทอออกมา<ThreadUnderline /></span><span className="xh-nowrap">ให้เห็นได้</span>
          </h1>
          <p className="xh-lead">
            สร้างภาพ วิดีโอ เพลง ลิปซิงค์ และโมเดล 3D จากโมเดล AI ชั้นนำหลายเจ้า ด้วยเครดิตชุดเดียว
            งานไหนสร้างไม่สำเร็จ ระบบคืนเครดิตให้อัตโนมัติ
          </p>
          <PromptBar />
          <div className="xh-hero-cta">
            {signedIn ? (
              <Link href="/generate" className="xh-btn xh-btn-light xh-btn-lg">เข้าสตูดิโอ</Link>
            ) : (
              <Link href="/login?signup=1" className="xh-btn xh-btn-light xh-btn-lg">
                {freeTier ? `เริ่มฟรี รับ ${freeTier.credits}` : "เริ่มสร้างฟรี"}
              </Link>
            )}
            <a href="#work" className="xh-btn xh-btn-ghost xh-btn-lg">ดูผลงานจริง</a>
            {!signedIn && <span className="xh-note">ไม่ต้องใช้บัตรเครดิต</span>}
          </div>
        </div>

        <figure className="xh-hero-caption">
          <figcaption>
            <div className="xh-eyebrow">ฉากนี้สร้างบน X-DREAMER</div>
            <p className="xh-mono">“{HERO_MEDIA.prompt}”</p>
            <span className="xh-chip xh-chip-violet">{HERO_MEDIA.model}</span>
          </figcaption>
        </figure>
      </div>
    </header>
  );
}

function ThreadUnderline() {
  return (
    <svg className="xh-thread" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="xh-thread-g" x1="0" x2="1">
          <stop offset="0" stopColor="#10B981" />
          <stop offset="0.5" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <path d="M2 14 C 40 4, 70 22, 110 12 S 180 4, 220 14 S 280 20, 298 8" fill="none" stroke="url(#xh-thread-g)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Opens the studio on the chosen tab with this prompt; empty just opens the tab. */
function PromptBar() {
  const router = useRouter();
  const [tab, setTab] = useState<PromptTab>("image");
  const [text, setText] = useState("");
  const current = PROMPT_TABS.find((t) => t.key === tab) ?? PROMPT_TABS[0];

  const go = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ tab });
    const prompt = text.trim();
    if (prompt) q.set("prompt", prompt.slice(0, 2000));
    router.push(`/generate?${q.toString()}`);
  };

  return (
    <form className="xh-prompt" onSubmit={go}>
      <div className="xh-prompt-tabs" role="radiogroup" aria-label="จะสร้างอะไร">
        {PROMPT_TABS.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={tab === t.key}
            data-active={tab === t.key ? "true" : "false"} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <span className="xh-prompt-model">{current.example.model}</span>
      </div>
      <div className="xh-prompt-row">
        <label htmlFor="xh-prompt-input" className="xh-sr">prompt</label>
        <input
          id="xh-prompt-input"
          className="xh-prompt-input"
          value={text}
          maxLength={2000}
          autoComplete="off"
          placeholder={current.example.prompt}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="xh-btn xh-btn-thread">
          ทอเลย
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </form>
  );
}

// ─── facts ───────────────────────────────────────────────────────────────

function Facts() {
  return (
    <section className="xh-facts-sec" aria-label="ข้อเท็จจริง">
      <div className="xh-wrap">
        <div className="xh-facts">
          <div><b className="xh-num">{TOOLS.length}</b><span>เครื่องมือในสตูดิโอเดียว</span></div>
          <div><b className="xh-num">{PROVIDERS.length}</b><span>แหล่งโมเดล AI รวมเอนจินของเราเอง</span></div>
          <div><b>ไม่หมดอายุ</b><span>เครดิตที่ซื้อแบบจ่ายครั้งเดียว</span></div>
          <div><b>คืนอัตโนมัติ</b><span>เครดิตของงานที่สร้างไม่สำเร็จ</span></div>
        </div>
        <p className="xh-providers">{PROVIDERS.join(" · ")}</p>
      </div>
    </section>
  );
}

// ─── tools ───────────────────────────────────────────────────────────────

function Tools() {
  const [key, setKey] = useState<ToolKey>("image");
  const tool = TOOLS.find((t) => t.key === key) ?? TOOLS[0];
  return (
    <section id="tools" className="xh-section">
      <div className="xh-wrap">
        <SectionHead eyebrow="สตูดิโอ" title="หกเครื่องมือ ในสตูดิโอเดียว"
          lead="ปุ่มชุดเดียวกับเมนูในสตูดิโอจริง กดที่ปุ่มเพื่อดูว่าแต่ละเครื่องมือทำอะไรได้" />
        <div className="xh-tools">
          <div className="xh-rail">
            {TOOLS.map((t) => (
              <button key={t.key} type="button" className="xh-plate" aria-pressed={t.key === key}
                data-active={t.key === key ? "true" : "false"} onClick={() => setKey(t.key)}>
                <Image src={t.plate} alt={t.label} width={440} height={156} sizes="(max-width: 860px) 45vw, 340px" />
              </button>
            ))}
          </div>
          <article className="xh-tool" aria-live="polite">
            <div className="xh-tool-media">
              <ToolExample tool={key} />
            </div>
            <div className="xh-tool-body">
              <div className="xh-eyebrow">{tool.en}</div>
              <h3>{tool.label}</h3>
              <p>{tool.desc}</p>
              <div className="xh-specs">
                {tool.specs.map((s) => <span key={s.l}><b>{s.k}</b>{s.l}</span>)}
              </div>
              <Link href={tool.href} className="xh-btn xh-btn-outline">
                {tool.cta}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/**
 * What each tool makes. Image and video show a real result with its model;
 * the tools with no published result yet show what goes in and what comes
 * out, rather than a frame that would claim to be something it is not.
 */
function ToolExample({ tool }: { tool: ToolKey }) {
  switch (tool) {
    case "image": {
      const w = work("food");
      return (
        <>
          <MediaTile image={w.image} alt={w.title} sizes="(max-width: 860px) 100vw, 760px" />
          <span className="xh-media-tag">{w.title} · {w.model}</span>
        </>
      );
    }
    case "video": {
      const w = work("dancer");
      return (
        <>
          <MediaTile image={w.image} video={w.video} alt={w.title} sizes="(max-width: 860px) 100vw, 760px" />
          <span className="xh-media-tag">{w.title} · {w.model}</span>
        </>
      );
    }
    case "edit":
      return (
        <>
          <MediaTile image="/showcase/macro.jpg" alt="ภาพมาโครสร้างบน X-DREAMER" sizes="(max-width: 860px) 100vw, 760px" />
          <span className="xh-media-tag">แก้ส่วนที่ต้องการด้วย prompt หรือขยายให้คมขึ้น 2–4 เท่า</span>
        </>
      );
    case "lipsync":
      return (
        <Flow output="คลิปที่ปากขยับตามเสียง">
          <FlowCard label="ภาพใบหน้า">
            <Image src={work("portrait").image} alt="" width={120} height={160} className="xh-flow-img" />
          </FlowCard>
          <FlowCard label="เสียงพูด 1–15 วินาที"><Wave /></FlowCard>
        </Flow>
      );
    case "audio":
      return (
        <Flow output="เพลงพร้อมเสียงร้อง">
          <FlowCard label="เนื้อร้อง">
            <p className="xh-flow-lyrics">คืนนี้ดาวเต็มฟ้า<br />ฉันทอฝันไว้รอเธอ</p>
          </FlowCard>
          <FlowCard label="แนวเพลง"><Wave /></FlowCard>
        </Flow>
      );
    case "model3d":
      return (
        <Flow output="ไฟล์ GLB พร้อมพื้นผิว">
          <FlowCard label="ภาพวัตถุ 1 ภาพ">
            <Image src={work("product").image} alt="" width={150} height={150} className="xh-flow-img" />
          </FlowCard>
          <FlowCard label="โมเดล 3D หมุนดูได้"><Cube /></FlowCard>
        </Flow>
      );
  }
}

function Flow({ output, children }: { output: string; children: React.ReactNode }) {
  return (
    <div className="xh-flow">
      <div className="xh-flow-in">{children}</div>
      <div className="xh-flow-out">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        {output}
      </div>
    </div>
  );
}

function FlowCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="xh-flow-card">
      <div className="xh-flow-art">{children}</div>
      <span>{label}</span>
    </div>
  );
}

function Wave() {
  return (
    <div className="xh-wave" aria-hidden="true">
      {WAVE.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
    </div>
  );
}

function Cube() {
  return (
    <div className="xh-cube-scene" aria-hidden="true">
      <div className="xh-cube">
        {["f", "b", "l", "r", "t", "d"].map((s) => <span key={s} data-side={s} />)}
      </div>
    </div>
  );
}

// ─── real work ───────────────────────────────────────────────────────────

function Work() {
  return (
    <section id="work" className="xh-section xh-tint">
      <div className="xh-wrap">
        <div className="xh-head-row">
          <SectionHead eyebrow="ผลงานจริง" title="ทุกภาพมาพร้อม prompt ที่ใช้สร้างจริง" />
          <Link href="/gallery" className="xh-link">เปิดแกลเลอรีทั้งหมด →</Link>
        </div>
        <div className="xh-masonry">
          {SHOWCASE_ITEMS.map((item) => (
            <figure key={item.key} className="xh-work">
              <div className="xh-work-media" style={{ aspectRatio: item.ratio } as CSSProperties}>
                <MediaTile image={item.image} video={item.video} alt={item.title}
                  sizes="(max-width: 480px) 100vw, (max-width: 860px) 50vw, 400px" />
              </div>
              <figcaption>
                <div className="xh-work-top">
                  <span className="xh-work-title">{item.title}</span>
                  <span className="xh-chip">{item.mode === "video" ? "วิดีโอ" : "ภาพ"}</span>
                </div>
                <p className="xh-mono">{item.prompt}</p>
                <span className="xh-work-model">{item.model}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── steps ───────────────────────────────────────────────────────────────

const STEPS = [
  { t: "เลือกเครื่องมือ", d: "ภาพ วิดีโอ แก้ภาพ ลิปซิงค์ เพลง หรือ 3D แต่ละอย่างบอกราคาเป็นเครดิตก่อนกดสั่ง", c: "#34D399" },
  { t: "บอกสิ่งที่ฝัน", d: "พิมพ์ prompt ภาษาไทยหรืออังกฤษ หรืออัปโหลดภาพและเสียง กดปุ่มผู้ช่วยให้ช่วยเขียน prompt ได้ฟรี", c: "#22D3EE" },
  { t: "รับผลงาน", d: "ดาวน์โหลด เก็บในแกลเลอรี หรือสั่งต่อจากงานเดิม ถ้างานล้มเหลว เครดิตกลับเข้าบัญชีทันที", c: "#C084FC" },
];

function Steps() {
  return (
    <section className="xh-section">
      <div className="xh-wrap">
        <SectionHead eyebrow="วิธีใช้" title="สามขั้น จากความคิดถึงไฟล์" />
        <div className="xh-steps-wrap">
          <svg className="xh-steps-thread" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="xh-steps-g" x1="0" x2="1">
                <stop offset="0" stopColor="#10B981" />
                <stop offset="0.5" stopColor="#22D3EE" />
                <stop offset="1" stopColor="#A855F7" />
              </linearGradient>
            </defs>
            <path d="M0 10 C 120 2, 220 18, 340 10 S 560 2, 680 10 S 880 18, 1000 8" fill="none" stroke="url(#xh-steps-g)" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
          </svg>
          <ol className="xh-steps">
            {STEPS.map((s, i) => (
              <li key={s.t}>
                <span className="xh-knot" style={{ background: s.c, boxShadow: `0 0 0 6px var(--xh-ink), 0 0 26px ${s.c}88` }}>{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ─── pricing ─────────────────────────────────────────────────────────────

function Pricing({ tiers }: { tiers: Tier[] }) {
  return (
    <section id="pricing" className="xh-section xh-tint">
      <div className="xh-wrap">
        <div className="xh-head-row">
          <SectionHead eyebrow="แพ็กเกจเครดิต" title="จ่ายครั้งเดียว ใช้ได้ทุกเครื่องมือ" />
          <p className="xh-head-side">เครดิตชุดเดียวใช้ได้ทั้งภาพ วิดีโอ เพลง ลิปซิงค์ และ 3D ไม่มีรายเดือน ไม่มีวันหมดอายุ</p>
        </div>
        <div className="xh-prices">
          {tiers.map((t) => (
            <div key={t.slug} className="xh-price" data-featured={t.featured ? "true" : "false"}>
              <div className="xh-price-top">
                <span className="xh-price-name">{t.name}</span>
                {t.badge && <span className="xh-badge">{t.badge}</span>}
              </div>
              <div className="xh-price-amt">
                {/* Unbounded has no ฿: the sign comes from the Thai heading face */}
                {t.price.startsWith("฿") ? <><span className="xh-baht">฿</span>{t.price.slice(1)}</> : t.price}
              </div>
              <div className="xh-price-credits">{t.credits}</div>
              <ul>
                {t.feats.map((f) => <li key={f}><span aria-hidden="true">✓</span>{f}</li>)}
              </ul>
              {t.free ? (
                <Link href="/login?signup=1" className="xh-btn xh-btn-outline xh-btn-block">เริ่มฟรี</Link>
              ) : (
                <a href={`https://xman4289.com/checkout/ai-credits/${encodeURIComponent(t.slug)}?ref=ai`} className="xh-btn xh-btn-outline xh-btn-block">เลือกแพ็กเกจ</a>
              )}
            </div>
          ))}
        </div>
        <p className="xh-fine">
          ราคาเป็นบาท ชำระผ่าน XMAN STUDIO · จำนวนภาพและคลิปเป็นค่าประมาณ ขึ้นกับโมเดลที่เลือก ·{" "}
          <Link href="/pricing" className="xh-link">ตารางค่าเครดิตทุกโมเดล →</Link>
        </p>
      </div>
    </section>
  );
}

// ─── faq ─────────────────────────────────────────────────────────────────

function Faq() {
  return (
    <section className="xh-section">
      <div className="xh-wrap">
        <SectionHead eyebrow="คำถามที่พบบ่อย" title="ก่อนเริ่มใช้" />
        <div className="xh-faq">
          {FAQ_ITEMS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}<span className="xh-plus" aria-hidden="true">+</span></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── closing + footer ────────────────────────────────────────────────────

function Closing({ signedIn, freeTier }: { signedIn: boolean; freeTier: Tier | null }) {
  const enough = freeTier?.feats.slice(0, 2).join(" หรือ ");
  return (
    <section className="xh-closing">
      <div className="xh-closing-media" aria-hidden="true">
        <Image src="/showcase/cta-weave.jpg" alt="" fill sizes="100vw" style={{ objectFit: "cover", opacity: 0.55 }} />
        <div className="xh-closing-scrim" />
      </div>
      <div className="xh-wrap xh-closing-inner">
        <h2 className="xh-h2">เริ่มทอความฝันของคุณวันนี้</h2>
        {!signedIn && freeTier && (
          <p className="xh-lead">สมัครแล้วรับ {freeTier.credits}ฟรี{enough ? ` พอสำหรับ${enough}` : ""}</p>
        )}
        <div className="xh-closing-cta">
          {signedIn ? (
            <Link href="/generate" className="xh-btn xh-btn-thread xh-btn-lg">เข้าสตูดิโอ</Link>
          ) : (
            <Link href="/login?signup=1" className="xh-btn xh-btn-thread xh-btn-lg">สร้างบัญชีฟรี</Link>
          )}
          <Link href="/gallery" className="xh-btn xh-btn-ghost xh-btn-lg">ดูแกลเลอรี</Link>
        </div>

        <footer className="xh-footer">
          <div className="xh-footer-brand">
            <XdreamerLockup size={26} fontSize={12} />
            <span>© {new Date().getFullYear()} · โดย <a href="https://xman4289.com">XMAN STUDIO</a></span>
          </div>
          <nav aria-label="ลิงก์ท้ายหน้า" className="xh-footer-links">
            <Link href="/pricing">ราคา</Link>
            <Link href="/gallery">แกลเลอรี</Link>
            <Link href="/about">เกี่ยวกับ</Link>
            <Link href="/docs">นักพัฒนา</Link>
            <Link href="/contact">ติดต่อ</Link>
            <Link href="/terms">ข้อกำหนด</Link>
            <Link href="/privacy">ความเป็นส่วนตัว</Link>
          </nav>
        </footer>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="xh-head">
      <div className="xh-eyebrow">{eyebrow}</div>
      <h2 className="xh-h2">{title}</h2>
      {lead && <p className="xh-lead">{lead}</p>}
    </div>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────

const CSS = `
.xh {
  --xh-ink: #05070F;
  --xh-raised: #0A0F1E;
  --xh-line: rgba(148,163,184,0.14);
  --xh-text: #E8ECF7;
  --xh-soft: #B6C0D6;
  --xh-muted: #93A0B8;
  --xh-cyan: #22D3EE;
  --xh-sky: #7DD3FC;
  --xh-thread: linear-gradient(120deg, #10B981, #22D3EE 50%, #A855F7);
  --xh-heading: var(--font-heading), var(--font-noto-sans-thai), sans-serif;
  --xh-reading: var(--font-reading), var(--font-noto-sans-thai), sans-serif;
  --xh-display: var(--font-unbounded), var(--font-heading), var(--font-inter), sans-serif;
  --xh-mono: var(--font-geist-mono), ui-monospace, monospace;
  color: var(--xh-text);
  font-family: var(--xh-reading);
  font-size: 16px;
  line-height: 1.65;
  overflow-x: clip;
}
.xh *, .xh *::before, .xh *::after { box-sizing: border-box; }
.xh a { color: inherit; }
.xh-wrap { max-width: 1240px; margin: 0 auto; padding-inline: 32px; }
.xh-nowrap { white-space: nowrap; }
.xh-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* type */
.xh-h1 { margin: 22px 0 0; font-family: var(--xh-heading); font-weight: 700; font-size: clamp(40px, 5.6vw, 78px); line-height: 1.13; letter-spacing: -0.01em; color: #F8FAFC; text-wrap: balance; }
.xh-h2 { margin: 14px 0 0; font-family: var(--xh-heading); font-weight: 700; font-size: clamp(32px, 3.8vw, 52px); line-height: 1.18; color: #F8FAFC; text-wrap: balance; }
.xh-lead { margin: 18px 0 0; max-width: 36em; font-size: 18px; line-height: 1.75; color: #C2CBDD; }
.xh-eyebrow { font-family: var(--xh-display); font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--xh-sky); }
.xh-mono { margin: 0; font-family: var(--xh-mono); font-size: 12.5px; line-height: 1.65; color: #9AA6BF; }
.xh-num { font-family: var(--xh-display); font-weight: 600; }
.xh-link { color: var(--xh-sky) !important; text-decoration: none; white-space: nowrap; }
.xh-link:hover { color: #E0F2FE !important; }
.xh-fine { margin: 22px 0 0; font-size: 14px; color: var(--xh-muted); }
.xh-chip { flex-shrink: 0; display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; color: #CFFAFE; border: 1px solid rgba(34,211,238,0.42); }
.xh-chip-violet { color: #E9D5FF; border-color: rgba(168,85,247,0.5); }

/* buttons */
.xh-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 18px; border-radius: 12px; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid transparent; font-family: inherit; transition: transform 160ms ease, background 160ms ease, border-color 160ms ease; white-space: nowrap; }
.xh-btn:hover { transform: translateY(-1px); }
.xh-btn:focus-visible, .xh-plate:focus-visible, .xh a:focus-visible, .xh summary:focus-visible, .xh button:focus-visible { outline: 2px solid var(--xh-cyan); outline-offset: 3px; }
.xh-btn-lg { padding: 14px 24px; font-size: 16px; border-radius: 13px; }
.xh-btn-block { width: 100%; }
.xh-btn-light { background: #F8FAFC; color: #05070F !important; }
.xh-btn-ghost { border-color: rgba(203,213,225,0.28); color: #E2E8F0 !important; background: rgba(5,7,15,0.35); }
.xh-btn-ghost:hover { border-color: rgba(203,213,225,0.55); }
.xh-btn-outline { border-color: rgba(34,211,238,0.5); color: #CFFAFE !important; background: transparent; }
.xh-btn-outline:hover { background: rgba(34,211,238,0.08); }
.xh-btn-thread { background: var(--xh-thread); color: #04060D !important; font-weight: 700; }

/* nav */
.xh-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; padding-top: env(safe-area-inset-top, 0px); transition: background 250ms ease, border-color 250ms ease; border-bottom: 1px solid transparent; background: linear-gradient(180deg, rgba(5,7,15,0.7), rgba(5,7,15,0)); }
.xh-nav[data-solid="true"] { background: rgba(5,7,15,0.92); border-bottom-color: var(--xh-line); }
.xh-nav-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-block: 16px; }
.xh-brand { text-decoration: none; display: inline-flex; }
.xh-nav-links { display: flex; gap: 30px; font-size: 15px; font-weight: 500; }
.xh-nav-links a { color: #CBD5E1; text-decoration: none; }
.xh-nav-links a:hover { color: #fff; }
.xh-nav-end { display: flex; align-items: center; gap: 10px; }
.xh-nav-end .xh-btn { padding: 9px 16px; font-size: 14px; }
.xh-burger { display: none; width: 42px; height: 42px; border-radius: 11px; align-items: center; justify-content: center; color: #fff; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); cursor: pointer; }
.xh-drawer { display: flex; flex-direction: column; gap: 4px; padding-bottom: 16px; }
.xh-drawer a { padding: 12px 14px; border-radius: 10px; color: #E2E8F0; text-decoration: none; background: rgba(255,255,255,0.04); }
.xh-drawer-cta { display: flex; gap: 10px; margin-top: 6px; }
.xh-drawer-cta .xh-btn { flex: 1; }
.xh-user { position: relative; }
.xh-user-btn { display: flex; align-items: center; gap: 9px; padding: 5px 12px 5px 5px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff; cursor: pointer; font-family: inherit; }
.xh-avatar { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #04060D; background: var(--xh-thread); }
.xh-user-name { font-size: 13.5px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xh-user-menu { position: absolute; top: calc(100% + 8px); right: 0; width: 230px; padding: 6px; border-radius: 14px; background: #0B1020; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 40px -10px rgba(0,0,0,0.6); display: flex; flex-direction: column; }
.xh-user-head { padding: 10px 12px; border-bottom: 1px solid var(--xh-line); margin-bottom: 4px; font-size: 13.5px; }
.xh-user-head small { display: block; color: var(--xh-muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; }
.xh-user-menu a, .xh-signout { padding: 9px 12px; border-radius: 9px; font-size: 13.5px; color: #E2E8F0; text-decoration: none; text-align: left; background: transparent; border: 0; cursor: pointer; font-family: inherit; }
.xh-user-menu a:hover, .xh-signout:hover { background: rgba(255,255,255,0.05); }
.xh-signout { color: #FCA5A5; margin-top: 4px; border-top: 1px solid var(--xh-line); border-radius: 0 0 9px 9px; }

/* hero */
.xh-hero { position: relative; overflow: hidden; border-bottom: 1px solid var(--xh-line); background: var(--xh-ink); }
.xh-hero-media { position: absolute; inset: 0; }
.xh-hero-scrim-x { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5,7,15,0.94) 0%, rgba(5,7,15,0.72) 42%, rgba(5,7,15,0.18) 78%); }
.xh-hero-scrim-y { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(5,7,15,0.55) 0%, rgba(5,7,15,0) 22%, rgba(5,7,15,0) 70%, #05070F 100%); }
.xh-hero-grid { position: relative; display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 0.75fr); gap: 48px; align-items: end; padding-top: 168px; padding-bottom: 84px; }
.xh-hero-copy { min-width: 0; }
.xh-live { display: inline-flex; align-items: center; gap: 10px; padding: 6px 13px; border-radius: 999px; border: 1px solid rgba(125,211,252,0.3); background: rgba(5,7,15,0.55); font-size: 13.5px; color: #BAE6FD; }
.xh-live span { width: 7px; height: 7px; border-radius: 50%; background: #34D399; box-shadow: 0 0 10px #34D399; }
.xh-thread-word { position: relative; display: inline-block; }
.xh-thread { position: absolute; left: -2%; bottom: -0.12em; width: 104%; height: 0.22em; overflow: visible; }
.xh-hero-cta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 26px; }
.xh-note { font-size: 14px; color: var(--xh-muted); }
.xh-hero-caption { margin: 0; justify-self: end; max-width: 360px; padding: 16px 18px; border-radius: 16px; background: rgba(5,7,15,0.78); border: 1px solid rgba(148,163,184,0.2); }
.xh-hero-caption .xh-mono { margin: 10px 0 12px; color: #CBD5E1; }

/* prompt bar */
.xh-prompt { margin-top: 30px; max-width: 640px; border-radius: 18px; padding: 14px 14px 14px 18px; background: rgba(10,15,30,0.88); border: 1px solid rgba(125,211,252,0.28); box-shadow: 0 0 0 1px rgba(168,85,247,0.14), 0 24px 60px -24px rgba(34,211,238,0.45); }
.xh-prompt-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.xh-prompt-tabs button { padding: 4px 12px; border-radius: 999px; font-size: 13px; font-family: inherit; color: #A5B0C6; background: transparent; border: 1px solid rgba(148,163,184,0.28); cursor: pointer; }
.xh-prompt-tabs button[data-active="true"] { color: #CFFAFE; background: rgba(34,211,238,0.16); border-color: rgba(34,211,238,0.55); }
.xh-prompt-model { margin-left: auto; font-family: var(--xh-mono); font-size: 12px; color: #8C98B0; }
.xh-prompt-row { display: flex; align-items: center; gap: 12px; }
.xh-prompt-input { flex: 1; min-width: 0; padding: 10px 0; border: 0; outline: none; background: transparent; color: #F1F5F9; font-family: var(--xh-mono); font-size: 14.5px; }
.xh-prompt-input::placeholder { color: #7C889F; }
.xh-prompt:focus-within { border-color: rgba(34,211,238,0.6); }

/* facts */
.xh-facts-sec { border-bottom: 1px solid var(--xh-line); background: rgba(5,7,15,0.6); }
.xh-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.xh-facts > div { padding: 30px 24px; border-right: 1px solid var(--xh-line); display: flex; flex-direction: column; gap: 6px; }
.xh-facts > div:first-child { padding-left: 0; }
.xh-facts > div:last-child { border-right: 0; }
.xh-facts b { font-family: var(--xh-heading); font-weight: 700; font-size: 30px; line-height: 1.25; color: #F8FAFC; }
.xh-facts b.xh-num { font-family: var(--xh-display); font-weight: 600; font-size: 38px; line-height: 1.15; }
.xh-facts span { color: #A5B0C6; font-size: 15px; }
.xh-providers { margin: 0; padding: 16px 0 22px; border-top: 1px solid rgba(148,163,184,0.1); font-size: 13.5px; letter-spacing: 0.05em; color: #8391AA; }

/* sections */
.xh-section { padding-block: 110px; }
.xh-tint { background: rgba(7,10,22,0.62); border-block: 1px solid rgba(148,163,184,0.1); }
.xh-head { max-width: 720px; margin-bottom: 44px; }
.xh-head .xh-lead { font-size: 17.5px; }
.xh-head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 44px; }
.xh-head-row .xh-head { margin-bottom: 0; }
.xh-head-side { margin: 0; max-width: 360px; color: #A5B0C6; font-size: 15.5px; line-height: 1.7; }

/* tools */
.xh-tools { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 44px; align-items: start; }
.xh-rail { display: flex; flex-direction: column; gap: 8px; }
.xh-plate { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; line-height: 0; border-radius: 14px; filter: saturate(0.85) brightness(0.82); transition: filter 200ms ease, transform 200ms ease; }
.xh-plate img { width: 100%; height: auto; display: block; }
.xh-plate:hover { filter: saturate(1.05) brightness(1); transform: translateY(-1px); }
.xh-plate[data-active="true"] { filter: saturate(1.15) brightness(1.12) drop-shadow(0 0 16px rgba(168,85,247,0.55)); }
.xh-tool { min-width: 0; border-radius: 22px; overflow: hidden; background: var(--xh-raised); border: 1px solid rgba(148,163,184,0.16); }
.xh-tool-media { position: relative; aspect-ratio: 16 / 10; max-width: 100%; background: #070B18; overflow: hidden; }
.xh-media-tag { position: absolute; left: 14px; bottom: 14px; z-index: 2; padding: 5px 11px; border-radius: 999px; background: rgba(5,7,15,0.8); border: 1px solid rgba(148,163,184,0.22); font-size: 12.5px; color: #CBD5E1; }
.xh-tool-body { padding: 26px 30px 30px; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
.xh-tool-body h3 { margin: 0; font-family: var(--xh-heading); font-weight: 700; font-size: 32px; line-height: 1.2; color: #F8FAFC; }
.xh-tool-body p { margin: 0; max-width: 60ch; color: var(--xh-soft); font-size: 17px; line-height: 1.75; }
.xh-specs { display: flex; flex-wrap: wrap; gap: 10px; }
.xh-specs span { display: inline-flex; align-items: baseline; gap: 8px; padding: 7px 13px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(148,163,184,0.18); font-size: 14px; color: #A5B0C6; }
.xh-specs b { color: #F1F5F9; font-family: var(--xh-display); font-weight: 600; font-size: 13.5px; }
.xh-flow { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 22px; padding: 24px; flex-wrap: wrap; background: radial-gradient(ellipse at 50% 60%, rgba(34,211,238,0.12), rgba(7,11,24,0) 65%); }
.xh-flow-in { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.xh-flow-card { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 13px; color: var(--xh-soft); }
.xh-flow-art { width: 150px; height: 160px; border-radius: 16px; overflow: hidden; display: grid; place-items: center; background: rgba(255,255,255,0.03); border: 1px solid rgba(148,163,184,0.2); }
.xh-flow-img { width: 100% !important; height: 100% !important; object-fit: cover; }
.xh-flow-lyrics { margin: 0; padding: 0 14px; font-family: var(--xh-heading); font-weight: 600; font-size: 16px; line-height: 1.6; color: #E9D5FF; text-align: center; }
.xh-flow-out { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 12px; font-weight: 600; color: #CFFAFE; background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.4); }
.xh-wave { display: flex; align-items: center; gap: 3px; height: 70%; width: 85%; }
.xh-wave span { flex: 1; border-radius: 3px; background: linear-gradient(180deg, #22D3EE, #A855F7); opacity: 0.85; }
.xh-cube-scene { width: 80px; height: 80px; perspective: 400px; }
.xh-cube { position: relative; width: 80px; height: 80px; transform-style: preserve-3d; animation: xh-spin 9s linear infinite; }
.xh-cube span { position: absolute; inset: 0; border: 1.5px solid rgba(34,211,238,0.85); background: rgba(34,211,238,0.08); box-shadow: inset 0 0 16px rgba(168,85,247,0.35); }
.xh-cube span[data-side="f"] { transform: translateZ(40px); }
.xh-cube span[data-side="b"] { transform: rotateY(180deg) translateZ(40px); }
.xh-cube span[data-side="l"] { transform: rotateY(-90deg) translateZ(40px); }
.xh-cube span[data-side="r"] { transform: rotateY(90deg) translateZ(40px); }
.xh-cube span[data-side="t"] { transform: rotateX(90deg) translateZ(40px); }
.xh-cube span[data-side="d"] { transform: rotateX(-90deg) translateZ(40px); }
@keyframes xh-spin { from { transform: rotateX(-22deg) rotateY(0deg); } to { transform: rotateX(-22deg) rotateY(360deg); } }

/* work */
.xh-masonry { columns: 3; column-gap: 20px; }
.xh-work { break-inside: avoid; margin: 0 0 20px; border-radius: 18px; overflow: hidden; background: #0B1020; border: 1px solid rgba(148,163,184,0.14); }
.xh-work-media { position: relative; width: 100%; max-width: 100%; }
.xh-work figcaption { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.xh-work-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.xh-work-title { font-family: var(--xh-heading); font-weight: 600; font-size: 17px; color: #F1F5F9; }
.xh-work .xh-mono { font-size: 12px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.xh-work-model { font-size: 12.5px; color: #C4B5FD; }

/* steps */
.xh-steps-wrap { position: relative; }
.xh-steps-thread { position: absolute; left: 0; right: 0; top: 18px; width: 100%; height: 20px; }
.xh-steps { list-style: none; margin: 0; padding: 0; position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
.xh-steps li { display: flex; flex-direction: column; gap: 12px; }
.xh-knot { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font-family: var(--xh-display); font-weight: 600; font-size: 16px; color: #04060D; }
.xh-steps h3 { margin: 8px 0 0; font-family: var(--xh-heading); font-weight: 600; font-size: 25px; color: #F8FAFC; }
.xh-steps p { margin: 0; color: #A5B0C6; font-size: 16px; line-height: 1.75; }

/* pricing */
.xh-prices { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
.xh-price { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 24px 20px 22px; border-radius: 18px; background: #0B1020; border: 1px solid rgba(148,163,184,0.16); }
.xh-price[data-featured="true"] { border-color: var(--xh-cyan); box-shadow: 0 0 0 1px rgba(168,85,247,0.35), 0 24px 50px -20px rgba(34,211,238,0.5); }
.xh-price-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 26px; }
.xh-price-name { font-size: 16px; font-weight: 600; color: #E2E8F0; }
.xh-badge { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #04060D; background: #A5F3FC; white-space: nowrap; }
.xh-price-amt { font-family: var(--xh-display); font-weight: 600; font-size: 32px; line-height: 1.1; color: #F8FAFC; font-variant-numeric: tabular-nums; }
.xh-baht { font-family: var(--xh-heading); font-weight: 700; margin-right: 2px; }
.xh-price-credits { font-size: 15px; color: #67E8F9; font-weight: 500; }
.xh-price ul { list-style: none; margin: 4px 0 6px; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14.5px; color: #A5B0C6; flex: 1; }
.xh-price li { display: flex; gap: 8px; }
.xh-price li span { color: var(--xh-cyan); }

/* faq */
.xh-faq { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 32px; align-items: start; }
.xh-faq details { border-bottom: 1px solid rgba(148,163,184,0.16); padding: 18px 0; }
.xh-faq summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; font-family: var(--xh-heading); font-weight: 600; font-size: 19px; color: #F1F5F9; }
.xh-faq summary::-webkit-details-marker { display: none; }
.xh-plus { flex-shrink: 0; color: var(--xh-sky); font-size: 22px; line-height: 1; transition: transform 200ms ease; }
.xh-faq details[open] .xh-plus { transform: rotate(45deg); }
.xh-faq p { margin: 12px 0 0; color: #A5B0C6; font-size: 16px; line-height: 1.75; }

/* closing */
.xh-closing { position: relative; overflow: hidden; border-top: 1px solid rgba(148,163,184,0.1); background: var(--xh-ink); }
.xh-closing-media { position: absolute; inset: 0; }
.xh-closing-scrim { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 40%, rgba(5,7,15,0.35) 0%, rgba(5,7,15,0.85) 60%, #05070F 100%); }
.xh-closing-inner { position: relative; padding-top: 130px; padding-bottom: 48px; text-align: center; }
.xh-closing-inner .xh-h2 { font-size: clamp(36px, 5vw, 64px); max-width: 820px; margin-inline: auto; }
.xh-closing-inner .xh-lead { margin-inline: auto; }
.xh-closing-cta { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 30px; }
.xh-footer { margin-top: 120px; padding-top: 26px; border-top: 1px solid rgba(148,163,184,0.14); display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; text-align: left; font-size: 14px; color: #8391AA; }
.xh-footer-brand { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.xh-footer a { color: inherit; text-decoration: none; }
.xh-footer a:hover { color: #E2E8F0; }
.xh-footer-links { display: flex; gap: 20px; flex-wrap: wrap; }

@media (max-width: 1100px) {
  .xh-tools { grid-template-columns: 280px minmax(0, 1fr); gap: 28px; }
}
@media (max-width: 860px) {
  .xh-wrap { padding-inline: 18px; }
  .xh-nav-links, .xh-hide-sm { display: none !important; }
  .xh-burger { display: inline-flex; }
  .xh-hero-grid { grid-template-columns: minmax(0, 1fr); padding-top: 120px; padding-bottom: 56px; gap: 28px; }
  .xh-hero-caption { justify-self: stretch; max-width: none; }
  .xh-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .xh-facts > div { padding: 22px 16px; border-bottom: 1px solid var(--xh-line); }
  .xh-facts > div:nth-child(2n) { border-right: 0; }
  .xh-facts > div:nth-child(2n+1) { padding-left: 0; }
  .xh-section { padding-block: 72px; }
  .xh-tools { grid-template-columns: minmax(0, 1fr); }
  .xh-rail { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .xh-tool-media { aspect-ratio: 4 / 3; }
  .xh-flow-art { width: 120px; height: 128px; }
  .xh-tool-body { padding: 22px 20px 24px; }
  .xh-masonry { columns: 2; }
  .xh-steps { grid-template-columns: minmax(0, 1fr); }
  .xh-steps-thread { display: none; }
  .xh-faq { grid-template-columns: minmax(0, 1fr); }
  .xh-prompt-row { flex-wrap: wrap; }
  .xh-prompt-row .xh-btn { width: 100%; }
}
@media (max-width: 480px) {
  .xh-masonry { columns: 1; }
  .xh-facts b { font-size: 24px; }
  .xh-facts b.xh-num { font-size: 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .xh-cube { animation: none; transform: rotateX(-22deg) rotateY(35deg); }
  .xh-btn, .xh-plate, .xh-plus { transition: none; }
  .xh-btn:hover, .xh-plate:hover { transform: none; }
}
`;
