"use client";

/**
 * X-DREAMER Landing — full landing page (Hero + Banner Slider + Features +
 * Gallery + How It Works + Pricing + Footer CTA). Mirrors xmanstudio's
 * /xdreamer page, ported from React reference template at:
 * design_handoff_xdreamer/{sections,banner-slider,sections-b}.jsx
 *
 * Uses inline styles (matching template) + canvas-based fiber threads /
 * banner patterns. Auth state derived from NextAuth session.
 *
 * No external deps beyond next/image and next-auth/react.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

const HUE = 70; // base hueShift

// ─── PROMPT SAMPLES ────────────────────────────────────────────────────
const PROMPT_SAMPLES = [
  "ปราสาทลอยฟ้าที่ทอด้วยเส้นใยแสง, ออโรร่าไหลผ่าน, โทนเขียวหยก",
  "เส้นใยความคิดของมนุษย์ในวันฝันกลางวัน, สีม่วงนุ่ม, เรืองรองอ่อน",
  "ป่าลึกใต้น้ำที่มีเงาแสงสีฟ้าเต้นระบำ, ฟิล์มแนว cinematic",
  "เมืองแห่งความฝันที่สร้างจากเส้นด้ายจักรวาล, เขียวมรกต + ไวโอเลต",
];

type Slide = {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  desc: string;
  cta: string;
  stats: { k: string; l: string }[];
  hues: [number, number, number];
  pattern: "waves" | "voxel" | "threads" | "audio" | "nodes";
};

const BANNER_SLIDES: Slide[] = [
  {
    id: "seedance",
    badge: "NEW MODEL",
    title: "Seedance 2.0",
    subtitle: "โมเดลวิดีโอรุ่นใหม่",
    desc: "สร้างวิดีโอ 10 วินาที 1080p จากข้อความ พร้อม motion ที่สมจริงและควบคุมกล้องได้",
    cta: "ลองใช้เลย",
    stats: [
      { k: "1080p", l: "ความละเอียด" },
      { k: "10s", l: "ความยาวสูงสุด" },
      { k: "60fps", l: "ลื่นไหล" },
    ],
    hues: [200, 260, 300],
    pattern: "waves",
  },
  {
    id: "voxel",
    badge: "3D STUDIO",
    title: "Voxel Forge",
    subtitle: "ปั้นโลก 3D จากคำบรรยาย",
    desc: "ปราสาท ดินแดน หรือตัวละคร — สร้างโมเดล 3D พร้อม texture ในไม่กี่นาที",
    cta: "เข้าสู่ Voxel Forge",
    stats: [
      { k: ".GLB", l: "ส่งออกมาตรฐาน" },
      { k: "PBR", l: "Material" },
      { k: "4K", l: "Texture" },
    ],
    hues: [160, 180, 220],
    pattern: "voxel",
  },
  {
    id: "loom-live",
    badge: "LIVE COLLAB",
    title: "Loom Live",
    subtitle: "ทอความฝันร่วมกัน · real-time",
    desc: "เชิญเพื่อนมาทอ prompt พร้อมกัน เห็น cursor, เห็น thread, แก้พร้อมกัน",
    cta: "เปิดห้องใหม่",
    stats: [
      { k: "8", l: "ผู้ร่วมงาน" },
      { k: "0ms", l: "sync latency" },
      { k: "∞", l: "ประวัติ versioning" },
    ],
    hues: [280, 320, 200],
    pattern: "threads",
  },
  {
    id: "audio-muse",
    badge: "AUDIO · BETA",
    title: "Muse Audio v3",
    subtitle: "เสียงประกอบ · เพลง · บรรยากาศ",
    desc: "จากข้อความสู่ score ภาพยนตร์ · ambient · foley — มี stem แยกสำหรับตัดต่อ",
    cta: "ฟังตัวอย่าง",
    stats: [
      { k: "48kHz", l: "คุณภาพสตูดิโอ" },
      { k: "4 stems", l: "แยก track" },
      { k: "3 min", l: "ความยาว" },
    ],
    hues: [30, 340, 280],
    pattern: "audio",
  },
  {
    id: "workflow",
    badge: "AUTOMATION",
    title: "Workflow Nodes",
    subtitle: "ร้อยโมเดลเป็น pipeline ของคุณ",
    desc: "Prompt → Image → Upscale → Video → Audio — ลาก connect ต่อเป็น workflow แบบ node-based",
    cta: "ดู workflows",
    stats: [
      { k: "40+", l: "Nodes พร้อมใช้" },
      { k: "JSON", l: "Export / Import" },
      { k: "API", l: "Trigger" },
    ],
    hues: [220, 180, 260],
    pattern: "nodes",
  },
];

const FEATURES = [
  { eyebrow: "01 · FABRIC", title: "เส้นใยเจตจำนง", desc: "ควบคุม prompt ผ่านเส้นใยที่ลากต่อเนื่อง — ปรับแสง, อารมณ์, และเรื่องราวได้แบบ real-time โดยไม่ต้องเริ่มใหม่", hue: 160 },
  { eyebrow: "02 · LOOM", title: "ทอแบบข้ามสื่อ", desc: "เริ่มจากภาพแล้วเปลี่ยนเป็นวิดีโอ, เริ่มจากเสียงแล้วแปลงเป็นฉาก 3D โมเดลของเราไหลข้ามสื่อได้เป็นธรรมชาติ", hue: 200 },
  { eyebrow: "03 · DREAM CITADEL", title: "ปราสาทแห่งแนวคิด", desc: "เก็บจินตนาการของคุณเป็นห้องสมุดที่มีชีวิต — แต่ละแนวคิดทอติดกันด้วยเส้นใยความสัมพันธ์ที่ AI มองเห็น", hue: 270 },
];

const GALLERY_ITEMS = [
  { title: "ปราสาทในหมอกจันทรา", author: "นภาลัย", hue: 270, ratio: "3/4", mode: "image" },
  { title: "Dream Loop · 12s", author: "kairos", hue: 200, ratio: "1/1", mode: "video" },
  { title: "ผืนป่าความคิด", author: "จิตรา", hue: 160, ratio: "3/4", mode: "image" },
  { title: "Whisper of the Loom", author: "Theo", hue: 290, ratio: "4/5", mode: "audio" },
  { title: "เส้นใยดวงดาว", author: "พิรุณ", hue: 230, ratio: "3/4", mode: "image" },
  { title: "Citadel · 3D scan", author: "arc_ot", hue: 180, ratio: "1/1", mode: "3d" },
  { title: "มโนทัศน์สีมรกต", author: "สิริกาญจน์", hue: 150, ratio: "4/5", mode: "image" },
  { title: "Violet Thread Study", author: "nine", hue: 280, ratio: "3/4", mode: "image" },
];

const STEPS = [
  { n: "01", t: "ทอเส้นใยแรก", d: "เขียน prompt หรือ sketch — ระบบทอเป็นโครงแนวคิด", hue: 160 },
  { n: "02", t: "เลือกผืนผ้า", d: "เลือกจาก 4 รูปแบบ — ภาพ, วิดีโอ, เสียง, หรือฉาก 3D", hue: 200 },
  { n: "03", t: "ปรับผืนผ้า", d: "ลากเส้นใยเพื่อปรับอารมณ์ สี องค์ประกอบ ได้แบบ live", hue: 240 },
  { n: "04", t: "ส่งต่อความฝัน", d: "Export 8K, แชร์ในชุมชน, หรือเก็บในปราสาทส่วนตัว", hue: 280 },
];

type Tier = {
  slug: string;
  name: string;
  price: string;
  note: string;
  feats: string[];
  hue: number;
  pop: boolean;
};

// ─── FIBER THREADS CANVAS ──────────────────────────────────────────────
function FiberThreads({ density = 70, speed = 1, hueShift = HUE, opacity = 0.55, interactive = true }: {
  density?: number; speed?: number; hueShift?: number; opacity?: number; interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palettes = useMemo(() => {
    const base: [number, number, number][] = [
      [160, 85, 55], [180, 80, 60], [210, 90, 65],
      [250, 75, 68], [275, 70, 65], [295, 65, 68],
    ];
    return base.map(([h, s, l]) => [(h + hueShift) % 360, s, l] as [number, number, number]);
  }, [hueShift]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let visible = true;
    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const mouse = { x: -9999, y: -9999, active: false };
    let threads: {
      x0: number; y0: number; cx1: number; cy1: number; cx2: number; cy2: number;
      x1: number; y1: number; f1: number; f2: number; f3: number; phase: number;
      thick: number; hue: number; sat: number; lit: number; alpha: number;
    }[] = [];

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width; h = rect.height;
      if (w === 0 || h === 0) return;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn();
    }
    function spawn() {
      threads = [];
      for (let i = 0; i < density; i++) {
        const p = palettes[Math.floor(Math.random() * palettes.length)];
        threads.push({
          x0: Math.random() * w, y0: Math.random() * h,
          cx1: Math.random() * w, cy1: Math.random() * h,
          cx2: Math.random() * w, cy2: Math.random() * h,
          x1: Math.random() * w, y1: Math.random() * h,
          f1: 0.0004 + Math.random() * 0.0008,
          f2: 0.0003 + Math.random() * 0.0007,
          f3: 0.0002 + Math.random() * 0.0006,
          phase: Math.random() * Math.PI * 2,
          thick: 0.3 + Math.random() * 1.4,
          hue: p[0], sat: p[1], lit: p[2],
          alpha: 0.25 + Math.random() * 0.55,
        });
      }
    }
    function onMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }
    function onLeave() { mouse.active = false; }

    resize();
    window.addEventListener("resize", resize);
    if (interactive) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
    }
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    const t0 = performance.now();
    let lastFrame = 0;
    const frameMs = 1000 / 30;
    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      if (now - lastFrame < frameMs) return;
      lastFrame = now;
      const t = (now - t0) * speed;
      ctx!.globalCompositeOperation = "source-over";
      ctx!.fillStyle = "rgba(3,6,18,0.08)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.globalCompositeOperation = "lighter";

      for (const th of threads) {
        const a = Math.sin(t * th.f1 + th.phase);
        const b = Math.cos(t * th.f2 + th.phase * 1.3);
        const c = Math.sin(t * th.f3 + th.phase * 0.7);
        const d = Math.cos(t * th.f1 + th.phase * 2.1);
        let cx1 = th.cx1 + c * 200, cy1 = th.cy1 + d * 200;
        let cx2 = th.cx2 + b * 200, cy2 = th.cy2 + a * 200;
        const x0 = th.x0 + a * 120, y0 = th.y0 + b * 120;
        const x1 = th.x1 + d * 120, y1 = th.y1 + c * 120;
        if (mouse.active && interactive) {
          const dx = mouse.x - (cx1 + cx2) / 2;
          const dy = mouse.y - (cy1 + cy2) / 2;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const pull = Math.max(0, 180 - dist) / 180;
          cx1 += dx * pull * 0.35; cy1 += dy * pull * 0.35;
          cx2 += dx * pull * 0.25; cy2 += dy * pull * 0.25;
        }
        const g = ctx!.createLinearGradient(x0, y0, x1, y1);
        const h1 = th.hue, h2 = (th.hue + 40) % 360;
        g.addColorStop(0, `hsla(${h1},${th.sat}%,${th.lit}%,0)`);
        g.addColorStop(0.15, `hsla(${h1},${th.sat}%,${th.lit}%,${th.alpha * opacity})`);
        g.addColorStop(0.5, `hsla(${(h1 + 20) % 360},${th.sat}%,${th.lit + 5}%,${th.alpha * opacity * 1.1})`);
        g.addColorStop(0.85, `hsla(${h2},${th.sat}%,${th.lit}%,${th.alpha * opacity})`);
        g.addColorStop(1, `hsla(${h2},${th.sat}%,${th.lit}%,0)`);
        ctx!.strokeStyle = g;
        ctx!.lineWidth = th.thick;
        ctx!.beginPath();
        ctx!.moveTo(x0, y0);
        ctx!.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        ctx!.stroke();
      }
    }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [density, speed, palettes, interactive, opacity]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}

// ─── BANNER PATTERN RENDERERS (canvas) ─────────────────────────────────
function withScale(ctx: CanvasRenderingContext2D, w: number, h: number, fn: () => void) {
  ctx.save(); ctx.scale(w / 600, h / 400); fn(); ctx.restore();
}
function drawWaves(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, hues: number[]) {
  withScale(ctx, w, h, () => {
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const phase = t * 0.6 + i * 0.5;
      const y = 200 + Math.sin(phase) * (40 + i * 5);
      const hue = (hues[i % 3] + t * 6) % 360;
      ctx.strokeStyle = `hsla(${hue},80%,65%,${0.35 + (i % 3) * 0.12})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(150, y + Math.cos(phase) * 60, 300, y);
      ctx.quadraticCurveTo(450, y + Math.sin(phase + 1) * 50 * 0.5, 600, y + Math.sin(phase + 1) * 50);
      ctx.stroke();
    }
  });
}
function drawVoxel(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, hues: number[]) {
  withScale(ctx, w, h, () => {
    ctx.save();
    ctx.translate(300, 220);
    ctx.rotate((t * 4) * Math.PI / 180);
    for (let layer = 0; layer < 5; layer++) {
      ctx.save();
      ctx.translate(0, -layer * 22);
      ctx.transform(1, 0, Math.tan(-20 * Math.PI / 180), 1, 0, 0);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        if (!((x + y + layer) % 2 === 0 && (x !== 2 || y !== 2))) continue;
        const hue = (hues[(x + layer) % 3] + t * 3) % 360;
        ctx.fillStyle = `hsla(${hue},70%,${45 + layer * 5}%,${0.6 + layer * 0.08})`;
        ctx.strokeStyle = `hsl(${hue},85%,70%)`;
        ctx.lineWidth = 0.4;
        const px = (x - 2) * 28 + (y - 2) * 14;
        const py = (y - 2) * 28 - (x - 2) * 14;
        ctx.fillRect(px, py, 26, 26);
        ctx.strokeRect(px, py, 26, 26);
      }
      ctx.restore();
    }
    ctx.restore();
  });
}
function drawThreads(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, hues: number[]) {
  withScale(ctx, w, h, () => {
    ctx.lineCap = "round";
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + t * 0.03;
      const x1 = 300 + Math.cos(a) * 80, y1 = 200 + Math.sin(a) * 80;
      const x2 = 300 + Math.cos(a + t * 0.02) * 180, y2 = 200 + Math.sin(a + t * 0.02) * 180;
      const hue = (hues[i % 3] + t * 4) % 360;
      ctx.strokeStyle = `hsla(${hue},80%,65%,0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const a = t * 0.08 + i * 2.1;
      const x = 300 + Math.cos(a) * 140, y = 200 + Math.sin(a) * 140;
      ctx.fillStyle = `hsla(${hues[i]},90%,70%,0.9)`;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  });
}
function drawAudio(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, hues: number[]) {
  withScale(ctx, w, h, () => {
    for (let i = 0; i < 48; i++) {
      const x = 20 + i * 12;
      const bh = Math.abs(Math.sin(t * 0.3 + i * 0.4) * Math.cos(t * 0.1 + i * 0.08)) * 180 + 20;
      const hue = (hues[i % 3] + t * 3) % 360;
      ctx.fillStyle = `hsla(${hue},75%,${55 + (i % 5) * 4}%,0.75)`;
      roundRect(ctx, x, 200 - bh / 2, 8, bh, 2);
      ctx.fill();
    }
  });
}
function drawNodes(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, hues: number[]) {
  withScale(ctx, w, h, () => {
    const nodes = [
      { x: 120, y: 130, label: "Prompt" }, { x: 280, y: 90, label: "Image" },
      { x: 280, y: 200, label: "Style" }, { x: 440, y: 130, label: "Video" },
      { x: 440, y: 270, label: "Audio" },
    ];
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4]] as [number, number][];
    edges.forEach((e, i) => {
      const a = nodes[e[0]], b = nodes[e[1]];
      const hue = (hues[i % 3] + t * 4) % 360;
      ctx.strokeStyle = `hsla(${hue},70%,50%,0.45)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const p = (t * 0.02 + i * 0.2) % 1;
      const dotX = a.x + (b.x - a.x) * p, dotY = a.y + (b.y - a.y) * p;
      ctx.fillStyle = `hsla(${hue},90%,75%,0.95)`;
      ctx.beginPath(); ctx.arc(dotX, dotY, 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    nodes.forEach((n, i) => {
      const hue = (hues[i % 3] + t * 3) % 360;
      ctx.fillStyle = `hsl(${hue},70%,12%)`;
      ctx.strokeStyle = `hsl(${hue},80%,55%)`;
      ctx.lineWidth = 1;
      roundRect(ctx, n.x - 36, n.y - 16, 72, 32, 8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(n.label, n.x, n.y);
    });
  });
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ─── BANNER SLIDER ─────────────────────────────────────────────────────
function BannerSlider() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const tRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SLIDE_MS = 6000;

  // Auto-advance
  useEffect(() => {
    if (paused) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(0);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(1, elapsed / SLIDE_MS));
      if (elapsed >= SLIDE_MS) {
        clearInterval(id);
        setIdx(i => (i + 1) % BANNER_SLIDES.length);
      }
    }, 40);
    return () => clearInterval(id);
  }, [idx, paused]);

  // Canvas pattern animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0, h = 0, lastFrame = 0;
    const frameMs = 1000 / 30;
    let visible = true;
    let raf = 0;

    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 });
    io.observe(canvas);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      if (now - lastFrame < frameMs) return;
      lastFrame = now;
      if (!w || !h) { resize(); return; }
      if (!paused) tRef.current += 0.4;
      const t = tRef.current;
      const slide = BANNER_SLIDES[idx];
      const hues = slide.hues;
      const h1 = (hues[0] + HUE) % 360;
      const h2 = (hues[1] + HUE) % 360;
      const h3 = (hues[2] + HUE) % 360;
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, `hsl(${h1},65%,10%)`);
      bg.addColorStop(1, `hsl(${h2},65%,6%)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const tri = [h1, h2, h3];
      if (slide.pattern === "waves") drawWaves(ctx, w, h, t, tri);
      else if (slide.pattern === "voxel") drawVoxel(ctx, w, h, t, tri);
      else if (slide.pattern === "threads") drawThreads(ctx, w, h, t, tri);
      else if (slide.pattern === "audio") drawAudio(ctx, w, h, t, tri);
      else if (slide.pattern === "nodes") drawNodes(ctx, w, h, t, tri);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", resize); };
  }, [idx, paused]);

  const slide = BANNER_SLIDES[idx];
  const h1 = (slide.hues[0] + HUE) % 360;
  const h2 = (slide.hues[1] + HUE) % 360;
  const h3 = (slide.hues[2] + HUE) % 360;

  return (
    <section style={{ position: "relative", padding: "0 0 80px" }}>
      <div className="rp-container" style={{ maxWidth: 1280, margin: "0 auto", padding: "0 48px" }}>
        <div
          className="rp-banner"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          style={{
            position: "relative", height: 420, borderRadius: 28, overflow: "hidden",
            background: `linear-gradient(135deg, hsl(${h1},65%,10%) 0%, hsl(${h2},65%,6%) 100%)`,
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: `0 40px 80px -30px hsla(${h1},70%,30%,0.6), 0 0 0 1px rgba(255,255,255,0.04)`,
          }}
        >
          <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.85, display: "block" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(3,6,18,0.85) 0%, rgba(3,6,18,0.55) 50%, rgba(3,6,18,0.2) 100%)" }} />
          <div className="rp-banner-content" key={slide.id} style={{ position: "relative", height: "100%", padding: "56px 64px", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 32, alignItems: "center", animation: "bannerIn 600ms cubic-bezier(0.4,0,0.2,1)" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 999, background: `hsla(${h3},80%,60%,0.15)`, border: `1px solid hsla(${h3},80%,60%,0.35)`, fontSize: 10, letterSpacing: "0.22em", color: `hsl(${h3},90%,80%)`, textTransform: "uppercase", fontWeight: 600, marginBottom: 18 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: `hsl(${h3},90%,65%)`, boxShadow: `0 0 10px hsl(${h3},90%,70%)` }} />
                {slide.badge}
              </div>
              <div style={{ fontSize: 12, letterSpacing: "0.14em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 8 }}>{slide.subtitle}</div>
              <h2 style={{ fontSize: "clamp(36px, 4.8vw, 64px)", fontWeight: 200, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0, fontFamily: "var(--font-inter), sans-serif" }}>
                <span className="xdr-italic-th" style={{ background: `linear-gradient(120deg, hsl(${h1},80%,75%) 0%, hsl(${h2},85%,72%) 50%, hsl(${h3},80%,78%) 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingBottom: "0.1em", display: "inline-block" }}>{slide.title}</span>
              </h2>
              <p style={{ marginTop: 18, fontSize: 16, color: "rgba(203,213,225,0.8)", fontWeight: 300, lineHeight: 1.55, maxWidth: 520 }}>{slide.desc}</p>
              <div style={{ marginTop: 28, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Link href="/generate" style={{ background: `linear-gradient(135deg, hsl(${h1},75%,55%) 0%, hsl(${h2},75%,55%) 50%, hsl(${h3},75%,55%) 100%)`, color: "#fff", border: "none", padding: "12px 22px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: `0 12px 30px -10px hsla(${h2},80%,50%,0.7)`, textDecoration: "none" }}>
                  {slide.cta} →
                </Link>
                <button style={{ background: "rgba(255,255,255,0.06)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.15)", padding: "11px 20px", borderRadius: 12, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>เรียนรู้เพิ่มเติม</button>
              </div>
            </div>
            <div className="rp-banner-stats" style={{ display: "flex", flexDirection: "column", gap: 14, padding: 24, borderRadius: 18, background: "rgba(3,6,18,0.45)", backdropFilter: "blur(14px)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#94a3b8", textTransform: "uppercase" }}>· ข้อมูลจำเพาะ</div>
              {slide.stats.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: i < slide.stats.length - 1 ? 12 : 0, borderBottom: i < slide.stats.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                  <div style={{ fontSize: 13, color: "rgba(203,213,225,0.75)" }}>{s.l}</div>
                  <div style={{ fontSize: 22, fontWeight: 300, color: "#fff", fontFamily: "Inter", letterSpacing: "-0.01em" }}>{s.k}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div style={{ width: `${progress * 100}%`, background: `linear-gradient(90deg, hsl(${h1},85%,65%), hsl(${h3},85%,70%))`, boxShadow: `0 0 12px hsl(${h2},80%,60%)`, height: "100%", transition: "width 60ms linear" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 20, alignItems: "center" }}>
          {BANNER_SLIDES.map((s, i) => (
            <button key={s.id} onClick={() => setIdx(i)} aria-label={`Go to slide ${i + 1}`} style={{
              width: i === idx ? 28 : 8, height: 8, borderRadius: 999,
              background: i === idx ? `linear-gradient(90deg, hsl(${h1},85%,65%), hsl(${h3},85%,70%))` : "rgba(255,255,255,0.18)",
              border: "none", cursor: "pointer", padding: 0,
              transition: "width 300ms cubic-bezier(0.4,0,0.2,1), background 300ms",
            }} />
          ))}
          <div style={{ fontSize: 11, color: "#64748b", marginLeft: 12, letterSpacing: "0.1em" }}>
            {String(idx + 1).padStart(2, "0")} / {String(BANNER_SLIDES.length).padStart(2, "0")}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── HERO ──────────────────────────────────────────────────────────────
function Hero() {
  const [promptIdx, setPromptIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<"image" | "video" | "audio" | "3d">("image");

  useEffect(() => {
    const target = PROMPT_SAMPLES[promptIdx];
    setTyped("");
    let i = 0;
    const id = setInterval(() => {
      i++; setTyped(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [promptIdx]);

  useEffect(() => {
    const id = setInterval(() => setPromptIdx(i => (i + 1) % PROMPT_SAMPLES.length), 5200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setGenerating(true);
      setTimeout(() => setGenerating(false), 1800);
    }, 5200);
    return () => clearInterval(id);
  }, []);

  const modes: { id: typeof mode; label: string; icon: string }[] = [
    { id: "image", label: "Image", icon: "▧" },
    { id: "video", label: "Video", icon: "▶" },
    { id: "audio", label: "Audio", icon: "◎" },
    { id: "3d", label: "3D Scene", icon: "◈" },
  ];

  return (
    <section style={{ position: "relative", minHeight: "100vh", paddingTop: 120, paddingBottom: 80, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 40%, transparent 0%, rgba(3,6,18,0.5) 70%, rgba(3,6,18,0.95) 100%)", pointerEvents: "none" }} />
      <div className="rp-container" style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: "0 48px" }}>
        <div className="rp-hero-logo-wrap" style={{ position: "absolute", top: -20, right: 48, zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", animation: "floatY 6s ease-in-out infinite" }}>
            <div style={{ position: "absolute", inset: -20, borderRadius: "50%", background: `radial-gradient(circle, hsla(${270 + HUE},80%,55%,0.45), transparent 65%)`, filter: "blur(20px)" }} />
            <Image className="rp-hero-logo" src="/xdreamer-logo.png" alt="X-DREAMER" width={180} height={180}
              style={{ position: "relative", borderRadius: 28, objectFit: "cover", boxShadow: `0 30px 60px -15px hsla(${270 + HUE},70%,40%,0.6), 0 0 0 1px rgba(255,255,255,0.08)` }} />
          </div>
          <div style={{ fontSize: 10, letterSpacing: "0.24em", color: "#a5f3fc", textTransform: "uppercase" }}>AI Video Generation</div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "6px 14px", borderRadius: 999, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399", boxShadow: "0 0 8px #34d399", animation: "pulse 2s infinite" }} />
          GENERATIVE FABRIC · REAL-TIME
        </div>
        <h1 className="rp-hero-h1" style={{ marginTop: 28, fontSize: "clamp(56px, 8.5vw, 128px)", fontWeight: 300, lineHeight: 0.95, letterSpacing: "-0.03em", color: "#fff", textWrap: "balance" as const }}>
          ทอ<span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, background: `linear-gradient(120deg, hsl(${160 + HUE},80%,65%) 0%, hsl(${200 + HUE},85%,70%) 45%, hsl(${270 + HUE},80%,72%) 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}> ความฝัน </span>
          <br />
          <span style={{ fontWeight: 700 }}>จากเส้นใย</span>
          <span style={{ fontWeight: 200, opacity: 0.6 }}>แห่งความคิด</span>
        </h1>
        <p style={{ marginTop: 28, maxWidth: 640, fontSize: 19, lineHeight: 1.55, color: "rgba(226,232,240,0.78)", fontWeight: 300 }}>
          แพลตฟอร์ม AI generate สำหรับศิลปินและนักฝัน — สร้างภาพ วิดีโอ เสียง และฉาก 3 มิติจากประโยคเดียว
          ด้วยโมเดลที่เรียนรู้จากผืนผ้าความหมายของจักรวาลทั้งมวล
        </p>
        <div style={{ marginTop: 48, maxWidth: 820, background: "rgba(15,23,42,0.45)", backdropFilter: "blur(20px) saturate(1.4)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: 6, boxShadow: "0 40px 80px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
          <div className="rp-mode-tabs" style={{ display: "flex", padding: "10px 14px 4px", gap: 4 }}>
            {modes.map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                padding: "8px 16px", borderRadius: 10, border: "none",
                background: mode === m.id ? `linear-gradient(135deg, hsla(${160 + HUE},70%,55%,0.25), hsla(${270 + HUE},70%,60%,0.25))` : "transparent",
                color: mode === m.id ? "#fff" : "rgba(226,232,240,0.55)",
                fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                boxShadow: mode === m.id ? "inset 0 0 0 1px rgba(255,255,255,0.1)" : "none",
              }}><span style={{ fontSize: 13 }}>{m.icon}</span>{m.label}</button>
            ))}
            <div style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", padding: "10px 8px", letterSpacing: "0.08em" }}>MODEL · loom-v4.2</div>
          </div>
          <div className="rp-prompt-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 20px 18px 22px", background: "rgba(2,6,23,0.5)", borderRadius: 20, margin: 4, border: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ width: 10, height: 10, borderRadius: 999, background: generating ? "#fbbf24" : "#34d399", boxShadow: generating ? "0 0 12px #fbbf24" : "0 0 8px #34d399", flexShrink: 0, animation: generating ? "pulse 0.8s infinite" : "pulse 2s infinite" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.12em", marginBottom: 4 }}>PROMPT</div>
              <div style={{ fontSize: 17, color: "#f1f5f9", lineHeight: 1.4, fontWeight: 400, minHeight: 24 }}>
                {typed}<span style={{ display: "inline-block", width: 8, height: 20, background: "#a5f3fc", marginLeft: 3, verticalAlign: "middle", animation: "blink 1s step-end infinite" }} />
              </div>
            </div>
            <Link href="/generate" style={{ background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${270 + HUE},70%,60%))`, color: "#fff", border: "none", padding: "12px 22px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: `0 10px 24px -8px hsl(${270 + HUE},70%,50%)`, flexShrink: 0, textDecoration: "none" }}>
              {generating ? "กำลังทอ..." : "ทอเลย"} <span style={{ fontSize: 16 }}>→</span>
            </Link>
          </div>
          <div className="rp-gen-tray" style={{ padding: "10px 10px 12px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[0, 1, 2, 3].map(i => <GenFrame key={i} index={i} generating={generating} mode={mode} />)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 48, marginTop: 56, flexWrap: "wrap" }}>
          {[
            { v: "2.4M+", l: "ความฝันถูกทอทุกวัน" },
            { v: "48", l: "โมเดลเฉพาะทาง" },
            { v: "<2s", l: "เวลาสร้างเฉลี่ย" },
            { v: "99.2%", l: "uptime ปีที่ผ่านมา" },
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 36, fontWeight: 300, color: "#fff", background: `linear-gradient(180deg, #fff 0%, hsl(${180 + HUE + i * 30},70%,75%) 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{s.v}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, letterSpacing: "0.05em" }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GenFrame({ index, generating, mode }: { index: number; generating: boolean; mode: string }) {
  const [progress, setProgress] = useState(40 + index * 15);
  useEffect(() => {
    if (!generating) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(0);
    const start = Date.now();
    const delay = index * 180;
    const id = setInterval(() => {
      const t = Date.now() - start - delay;
      if (t < 0) return;
      const p = Math.min(100, (t / 1400) * 100);
      setProgress(p);
      if (p >= 100) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [generating, index]);
  const hue1 = (140 + index * 35 + HUE) % 360;
  const hue2 = (hue1 + 60) % 360;
  return (
    <div style={{ aspectRatio: "1 / 1.15", borderRadius: 14, position: "relative", overflow: "hidden", background: `linear-gradient(135deg, hsl(${hue1},60%,12%), hsl(${hue2},60%,8%))`, border: "1px solid rgba(255,255,255,0.06)" }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 115">
        <defs>
          <linearGradient id={`hg${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue1}, 85%, 65%)`} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`hsl(${hue2}, 85%, 70%)`} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {Array.from({ length: 12 }).map((_, j) => {
          const cx = 50 + Math.sin(j) * 30;
          const cy = 60 + j * 2;
          const sx = -5 + j * 9, sy = 115 + j * 3;
          const ex = 105 - j * 6, ey = -5 + j * 4;
          const sw = 0.4 + (j % 3) * 0.3;
          return (
            <path key={j}
              d={`M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`}
              stroke={`url(#hg${index})`} strokeWidth={sw} fill="none"
              style={{ opacity: progress > (j / 12) * 100 ? 0.7 : 0, transition: "opacity 0.4s ease" }} />
          );
        })}
      </svg>
      {progress >= 100 && mode === "video" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.85)" }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", fontSize: 14, paddingLeft: 3 }}>▶</div>
        </div>
      )}
      <div style={{ position: "absolute", left: 10, right: 10, bottom: 10, height: 2, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg, hsl(${hue1},85%,60%), hsl(${hue2},85%,70%))`, transition: "width 0.1s linear", boxShadow: `0 0 8px hsl(${hue1},85%,60%)` }} />
      </div>
      <div style={{ position: "absolute", top: 8, left: 10, fontSize: 9, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", fontFamily: "ui-monospace, Menlo, monospace" }}>
        #{String(index + 1).padStart(2, "0")} · {progress < 100 ? "weaving" : "ready"}
      </div>
    </div>
  );
}

// ─── NAV ────────────────────────────────────────────────────────────────
function Nav() {
  const { data: session } = useSession();
  const links = [
    { id: "studio", label: "สตูดิโอ", href: "/generate" },
    { id: "gallery", label: "Gallery", href: "/gallery" },
    { id: "pricing", label: "Pricing", href: "/pricing" },
    { id: "profile", label: "Dashboard", href: "/profile" },
  ];
  return (
    <nav className="rp-nav" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, padding: "20px 48px", display: "flex", alignItems: "center", justifyContent: "space-between", backdropFilter: "blur(18px) saturate(1.3)", background: "linear-gradient(180deg, rgba(3,6,18,0.65), rgba(3,6,18,0.25))", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", cursor: "pointer" }}>
        <Image src="/xdreamer-logo.png" alt="X-DREAMER" width={38} height={38} style={{ borderRadius: 10, objectFit: "cover", boxShadow: "0 0 20px rgba(139,92,246,0.45)" }} />
        <div className="rp-nav-brand" style={{ fontFamily: "var(--font-inter), sans-serif", fontWeight: 900, letterSpacing: "0.22em", fontSize: 14, color: "#fff" }}>X-DREAMER</div>
        <div className="rp-nav-badge" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#94a3b8", padding: "3px 8px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 999, marginLeft: 6 }}>v4 · LIVE</div>
      </Link>
      <div className="rp-nav-links" style={{ display: "flex", gap: 28, fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
        {links.map(l => (
          <Link key={l.id} href={l.href} style={{ color: "inherit", textDecoration: "none", cursor: "pointer", paddingBottom: 2, borderBottom: "1px solid transparent" }}>{l.label}</Link>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {session ? (
          <UserMenu name={session.user?.name || "User"} email={session.user?.email || ""} />
        ) : (
          <>
            <Link href="/login" className="rp-nav-cta-ghost" style={{ background: "transparent", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", textDecoration: "none" }}>เข้าสู่ระบบ</Link>
            <Link href="/login?signup=1" className="rp-nav-cta-primary" style={{ background: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "none", boxShadow: "0 8px 24px -8px rgba(139,92,246,0.6)" }}>เริ่มสร้างฟรี</Link>
          </>
        )}
      </div>
    </nav>
  );
}

function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 6px", borderRadius: 999, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer" }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "conic-gradient(from 180deg, #10b981, #06b6d4, #8b5cf6, #10b981)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#030612" }}>{(name[0] || "X").toUpperCase()}</div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 220, background: "rgba(15,23,42,0.95)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 6, boxShadow: "0 20px 40px -10px rgba(0,0,0,0.5)", zIndex: 60 }}>
          <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 13, color: "#fff", fontWeight: 500 }}>{name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{email}</div>
          </div>
          {[
            { href: "/profile", l: "Dashboard", i: "◈" },
            { href: "/generate", l: "สตูดิโอ", i: "✦" },
            { href: "/gallery", l: "Gallery", i: "▧" },
          ].map(it => (
            <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="xdr-menu-item">
              <span style={{ color: "#a5f3fc", width: 14, display: "inline-block" }}>{it.i}</span>{it.l}
            </Link>
          ))}
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "6px 0" }} />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="xdr-menu-item" style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", color: "#fca5a5", fontFamily: "inherit", cursor: "pointer" }}>
            <span style={{ width: 14, display: "inline-block" }}>⎋</span>ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SECTIONS ──────────────────────────────────────────────────────────
function Features() {
  return (
    <section className="rp-section" style={{ position: "relative", padding: "120px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 72, maxWidth: 720 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· สามหลักการ</div>
        <h2 className="rp-h2" style={{ fontSize: "clamp(40px, 5vw, 64px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
          เครื่องทอ<span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#6ee7b7" }}> ที่เข้าใจ</span><br />
          ว่าจินตนาการไม่ใช่เส้นตรง
        </h2>
      </div>
      <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
        {FEATURES.map((f, i) => {
          const h1 = (f.hue + HUE) % 360;
          return (
            <div key={i} style={{ position: "relative", padding: 32, borderRadius: 22, background: "rgba(15,23,42,0.45)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(18px)", overflow: "hidden", transition: "all 400ms" }}>
              <svg width="100%" height="120" style={{ position: "absolute", top: -20, left: 0, right: 0, opacity: 0.5 }} viewBox="0 0 400 120" preserveAspectRatio="none">
                {Array.from({ length: 14 }).map((_, j) => {
                  const hh = h1 + j * 4;
                  const sw = 0.5 + (j % 3) * 0.3;
                  const cx = 150 + Math.sin(j) * 50, cy = 40 + j * 3;
                  const sx = -20 + j * 30, ex = 420 - j * 28;
                  return <path key={j} d={`M${sx} 130 Q${cx} ${cy} ${ex} -10`} stroke={`hsl(${hh}, 80%, 65%)`} strokeWidth={sw} fill="none" opacity={0.5} />;
                })}
              </svg>
              <div style={{ position: "relative", marginTop: 90 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.16em", color: `hsl(${h1}, 70%, 70%)`, marginBottom: 14 }}>{f.eyebrow}</div>
                <h3 style={{ fontSize: 28, fontWeight: 500, color: "#fff", marginBottom: 14, letterSpacing: "-0.01em" }}>{f.title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(203,213,225,0.75)", fontWeight: 300 }}>{f.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Gallery() {
  return (
    <section className="rp-section" style={{ position: "relative", padding: "140px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 56, flexWrap: "wrap", gap: 24 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· ผืนผ้าที่ถูกทอในวันนี้</div>
          <h2 className="rp-h2" style={{ fontSize: "clamp(40px, 5vw, 64px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, maxWidth: 720 }}>
            ความฝันที่ <span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#c4b5fd" }}>ชุมชนของเรา</span><br />
            ทอขึ้นในช่วง 24 ชั่วโมง
          </h2>
        </div>
        <div className="rp-filter-row" style={{ display: "flex", gap: 10 }}>
          {["ทั้งหมด", "Image", "Video", "Audio", "3D"].map((t, i) => (
            <button key={t} style={{ padding: "8px 16px", borderRadius: 999, background: i === 0 ? "rgba(255,255,255,0.1)" : "transparent", color: i === 0 ? "#fff" : "rgba(226,232,240,0.55)", border: "1px solid rgba(255,255,255,0.1)", fontSize: 13, cursor: "pointer" }}>{t}</button>
          ))}
        </div>
      </div>
      <div className="rp-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        {GALLERY_ITEMS.map((item, i) => {
          const h1 = (item.hue + HUE) % 360;
          const h2 = (h1 + 50) % 360;
          return (
            <div key={i} style={{ position: "relative", borderRadius: 18, overflow: "hidden", aspectRatio: item.ratio, background: `linear-gradient(135deg, hsl(${h1},65%,14%), hsl(${h2},65%,8%))`, border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", transition: "transform 400ms cubic-bezier(0.4,0,0.2,1), box-shadow 400ms", boxShadow: "0 10px 30px -10px rgba(0,0,0,0.6)" }}>
              <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id={`gg${item.hue}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={`hsl(${h1}, 85%, 65%)`} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={`hsl(${h2}, 85%, 70%)`} stopOpacity="0.9" />
                  </linearGradient>
                </defs>
                {Array.from({ length: 18 }).map((_, j) => {
                  const sx = -5 + (j * 7) % 110;
                  const sy = 110 + Math.sin(j) * 5;
                  const cx = 30 + Math.cos(j * 1.3) * 40;
                  const cy = 50 + Math.sin(j * 0.7) * 30;
                  const ex = 105 - (j * 6) % 110;
                  const ey = -5 + Math.cos(j) * 5;
                  const sw = 0.3 + (j % 4) * 0.25;
                  const op = 0.35 + (j % 3) * 0.2;
                  return <path key={j} d={`M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`} stroke={`url(#gg${item.hue})`} strokeWidth={sw} fill="none" opacity={op} />;
                })}
              </svg>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.7) 100%)" }} />
              <div style={{ position: "absolute", top: 12, left: 14, display: "flex", gap: 6 }}>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>{item.mode}</span>
              </div>
              <div style={{ position: "absolute", left: 16, right: 16, bottom: 14, color: "#fff" }}>
                <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.2 }}>{item.title}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 4 }}>@{item.author}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="rp-section" style={{ padding: "120px 48px", maxWidth: 1400, margin: "0 auto", position: "relative" }}>
      <div style={{ marginBottom: 64, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· วิธีการทำงาน</div>
          <h2 className="rp-h2" style={{ fontSize: "clamp(40px, 5vw, 64px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, maxWidth: 720 }}>
            จากความคิด<span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#a5b4fc" }}>...สู่ปราสาท</span><br />
            ในสี่จังหวะ
          </h2>
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <svg width="100%" height="4" style={{ position: "absolute", top: 22, left: 0, right: 0 }} preserveAspectRatio="none" viewBox="0 0 100 4">
          <line x1="0" y1="2" x2="100" y2="2" stroke="url(#thread-grad)" strokeWidth="0.5" strokeDasharray="0.5 1" />
          <defs>
            <linearGradient id="thread-grad" x1="0" x2="1">
              <stop offset="0%" stopColor={`hsl(${160 + HUE}, 80%, 65%)`} />
              <stop offset="50%" stopColor={`hsl(${220 + HUE}, 80%, 70%)`} />
              <stop offset="100%" stopColor={`hsl(${285 + HUE}, 80%, 70%)`} />
            </linearGradient>
          </defs>
        </svg>
        <div className="rp-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32 }}>
          {STEPS.map((s, i) => {
            const h = (s.hue + HUE) % 360;
            return (
              <div key={i} style={{ position: "relative" }}>
                <div style={{ width: 44, height: 44, borderRadius: 999, background: `radial-gradient(circle at 30% 30%, hsl(${h},80%,65%), hsl(${h + 30},70%,45%))`, boxShadow: `0 0 24px hsla(${h},80%,60%,0.6), inset 0 0 8px rgba(255,255,255,0.3)`, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 24, border: "1px solid rgba(255,255,255,0.2)" }}>{s.n}</div>
                <h3 style={{ fontSize: 22, fontWeight: 500, color: "#fff", marginBottom: 10, letterSpacing: "-0.01em" }}>{s.t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(203,213,225,0.7)", fontWeight: 300 }}>{s.d}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Pricing({ tiers }: { tiers: Tier[] }) {
  return (
    <section className="rp-section" style={{ padding: "120px 48px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 64 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· แผนการใช้งาน</div>
        <h2 className="rp-h2" style={{ fontSize: "clamp(40px, 5vw, 64px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
          เริ่มฟรี — <span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#c4b5fd" }}>จ่ายเมื่อความฝันใหญ่ขึ้น</span>
        </h2>
      </div>
      <div className="rp-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, maxWidth: 1100, margin: "0 auto" }}>
        {tiers.slice(0, 3).map((t, i) => {
          const h = (t.hue + HUE) % 360;
          const isFree = t.price === "ฟรี";
          const href = isFree ? "/login?signup=1" : `https://xman4289.com/checkout/ai-credits/${t.slug}?ref=ai`;
          const label = isFree ? "เริ่มฟรี" : t.pop ? "เริ่มทอเลย" : "เลือกแผนนี้";
          return (
            <div key={i} style={{
              padding: 36, borderRadius: 22, position: "relative",
              background: t.pop
                ? `linear-gradient(160deg, hsla(${h},60%,20%,0.65), hsla(${h + 40},60%,12%,0.65))`
                : "rgba(15,23,42,0.45)",
              border: t.pop ? `1px solid hsla(${h},70%,55%,0.5)` : "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(18px)",
              boxShadow: t.pop ? `0 30px 60px -20px hsla(${h},70%,50%,0.35)` : "none",
            }}>
              {t.pop && (
                <div style={{ position: "absolute", top: -12, left: 24, padding: "4px 12px", borderRadius: 999, background: `linear-gradient(90deg, hsl(${h}, 80%, 60%), hsl(${h + 40}, 80%, 65%))`, fontSize: 11, fontWeight: 600, color: "#fff", letterSpacing: "0.08em" }}>ยอดนิยม</div>
              )}
              <div style={{ fontSize: 14, color: "#a5f3fc", letterSpacing: "0.08em", marginBottom: 18 }}>{t.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 28 }}>
                <div style={{ fontSize: 44, fontWeight: 300, color: "#fff", letterSpacing: "-0.02em" }}>{t.price}</div>
                <div style={{ fontSize: 14, color: "#64748b" }}>{t.note}</div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px" }}>
                {t.feats.map(f => (
                  <li key={f} style={{ fontSize: 14, color: "rgba(226,232,240,0.8)", marginBottom: 10, display: "flex", gap: 10, fontWeight: 300 }}>
                    <span style={{ color: `hsl(${h},80%,70%)`, flexShrink: 0 }}>✦</span> {f}
                  </li>
                ))}
              </ul>
              <a href={href} style={{
                display: "block", textAlign: "center", width: "100%", padding: 14, borderRadius: 12,
                background: t.pop ? `linear-gradient(135deg, hsl(${h},70%,50%), hsl(${h + 40},70%,60%))` : "rgba(255,255,255,0.05)",
                color: "#fff", border: t.pop ? "none" : "1px solid rgba(255,255,255,0.15)",
                fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "none",
              }}>{label}</a>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FooterCTA() {
  return (
    <section style={{ padding: "140px 48px 80px", position: "relative", textAlign: "center" }}>
      <div style={{ position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, hsla(${220 + HUE}, 80%, 50%, 0.25), transparent 60%)`, filter: "blur(40px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", maxWidth: 900, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(48px, 7vw, 96px)", fontWeight: 200, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>
          เริ่มทอความฝัน<br />
          <span className="xdr-italic-th" style={{ fontStyle: "italic", background: `linear-gradient(120deg, hsl(${160 + HUE},80%,70%), hsl(${280 + HUE},80%,75%))`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>ของคุณวันนี้</span>
        </h2>
        <p style={{ marginTop: 28, fontSize: 18, color: "rgba(203,213,225,0.75)", fontWeight: 300 }}>
          ฟรี 50 งานทุกเดือน · ไม่ต้องใช้บัตรเครดิต · เริ่มได้ภายใน 30 วินาที
        </p>
        <div style={{ marginTop: 40, display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/login?signup=1" style={{ padding: "16px 32px", borderRadius: 14, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%) 0%, hsl(${220 + HUE},70%,55%) 50%, hsl(${280 + HUE},70%,60%) 100%)`, color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer", textDecoration: "none", boxShadow: `0 20px 40px -10px hsla(${220 + HUE},70%,50%,0.6)` }}>สร้างบัญชีฟรี →</Link>
          <Link href="/gallery" style={{ padding: "16px 28px", borderRadius: 14, background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", fontSize: 15, fontWeight: 500, cursor: "pointer", textDecoration: "none" }}>ดู Gallery ทั้งหมด</Link>
        </div>
      </div>
      <div style={{ marginTop: 120, paddingTop: 40, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 13, maxWidth: 1300, marginLeft: "auto", marginRight: "auto", flexWrap: "wrap", gap: 20 }}>
        <div>© {new Date().getFullYear()} X-DREAMER · ทอด้วย ♥ ในเชียงใหม่ · powered by <a href="https://xman4289.com" style={{ color: "inherit" }}>XMAN STUDIO</a></div>
        <div style={{ display: "flex", gap: 24 }}>
          <Link href="/pricing" style={{ color: "inherit", textDecoration: "none" }}>Pricing</Link>
          <Link href="/gallery" style={{ color: "inherit", textDecoration: "none" }}>Gallery</Link>
          <Link href="/profile" style={{ color: "inherit", textDecoration: "none" }}>Dashboard</Link>
        </div>
      </div>
    </section>
  );
}

// ─── ROOT EXPORT ───────────────────────────────────────────────────────
export default function XdreamerLanding({ tiers }: { tiers: Tier[] }) {
  // Toggle "home" body data flag for the global bg layer's hero-boost behavior
  useEffect(() => {
    document.body.dataset.xdrPage = "home";
    return () => { delete document.body.dataset.xdrPage; };
  }, []);

  return (
    <>
      {/* Global stylesheet — keeps inline-style components self-contained */}
      <style jsx global>{`
        html, body { background: #030612; color: #f1f5f9; font-family: 'Noto Sans Thai', 'Inter', system-ui, sans-serif; }
        body { overflow-x: hidden; }
        @keyframes pulse { 0%,100% {opacity:1;} 50% {opacity:0.5;} }
        @keyframes blink { 0%,50% {opacity:1;} 50.01%,100% {opacity:0;} }
        @keyframes floatY { 0%,100% {transform:translateY(0);} 50% {transform:translateY(-12px);} }
        @keyframes bannerIn { from {opacity:0;transform:translateX(20px);} to {opacity:1;transform:translateX(0);} }
        h1 span[style*="italic"], h2 span[style*="italic"], .xdr-italic-th { padding-bottom:0.15em;padding-right:0.08em;display:inline-block; }
        .xdr-menu-item { display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;font-size:13px;color:#e2e8f0;text-decoration:none;background:transparent;border:none;cursor:pointer;transition:background 150ms; }
        .xdr-menu-item:hover { background:rgba(255,255,255,0.05);color:#fff; }
        @media (max-width:1024px) {
          .rp-nav { padding:14px 20px !important; }
          .rp-nav-links { gap:16px !important;font-size:12px !important; }
          .rp-nav-badge { display:none !important; }
          .rp-nav-brand { font-size:12px !important; }
          .rp-nav-cta-primary, .rp-nav-cta-ghost { padding:8px 14px !important;font-size:12px !important;white-space:nowrap !important; }
          .rp-hero-logo-wrap { position:static !important;flex-direction:row !important;justify-content:flex-end !important;margin-bottom:24px !important; }
          .rp-hero-logo { width:80px !important;height:80px !important;border-radius:18px !important; }
          .rp-container { padding:0 24px !important; }
          .rp-grid-4 { grid-template-columns:repeat(2,1fr) !important; }
          .rp-grid-3 { grid-template-columns:repeat(2,1fr) !important; }
        }
        @media (max-width:720px) {
          .rp-nav { padding:14px 18px !important; }
          .rp-nav-links { display:none !important; }
          .rp-hero-logo-wrap { position:static !important;margin:0 auto 24px !important; }
          .rp-hero-logo { width:100px !important;height:100px !important; }
          .rp-container { padding:0 18px !important; }
          .rp-grid-4, .rp-grid-3 { grid-template-columns:1fr !important; }
          .rp-prompt-row { flex-wrap:wrap !important; }
          .rp-gen-tray { grid-template-columns:repeat(2,1fr) !important; }
          .rp-hero-h1 { font-size:48px !important; }
          .rp-h2 { font-size:36px !important; }
          .rp-mode-tabs { flex-wrap:wrap !important; }
          .rp-section { padding-left:18px !important;padding-right:18px !important;padding-top:64px !important;padding-bottom:64px !important; }
        }
        @media (max-width:900px) {
          .rp-banner { height:auto !important;min-height:520px; }
          .rp-banner-content { grid-template-columns:1fr !important;padding:40px 28px !important; }
        }
      `}</style>

      {/* Background fiber-threads + frosted overlay are rendered by the
          global AmbientBackground (root layout). It also handles the
          scroll-fade behaviour on / so we don't double-render here. */}

      <div style={{ position: "relative", zIndex: 1 }}>
        <Nav />
        <Hero />
        <BannerSlider />
        <Features />
        <Gallery />
        <HowItWorks />
        <Pricing tiers={tiers} />
        <FooterCTA />
      </div>
    </>
  );
}
