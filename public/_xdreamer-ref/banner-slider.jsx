// ===================== BANNER SLIDER =====================
// Auto-rotating hero banner showcasing models & features
// Uses CSS/SVG animation as video placeholder — swap `videoSrc` later

const BANNER_SLIDES = [
  {
    id: 'seedance',
    badge: 'NEW MODEL',
    title: 'Seedance 2.0',
    subtitle: 'โมเดลวิดีโอรุ่นใหม่',
    desc: 'สร้างวิดีโอ 10 วินาที 1080p จากข้อความ พร้อม motion ที่สมจริงและควบคุมกล้องได้',
    cta: 'ลองใช้เลย',
    stats: [
      { k: '1080p', l: 'ความละเอียด' },
      { k: '10s', l: 'ความยาวสูงสุด' },
      { k: '60fps', l: 'ลื่นไหล' },
    ],
    hues: [200, 260, 300],
    pattern: 'waves',
    videoSrc: null, // e.g. '/videos/seedance-demo.mp4'
    poster: null,
  },
  {
    id: 'voxel',
    badge: '3D STUDIO',
    title: 'Voxel Forge',
    subtitle: 'ปั้นโลก 3D จากคำบรรยาย',
    desc: 'ปราสาท ดินแดน หรือตัวละคร — สร้างโมเดล 3D พร้อม texture ในไม่กี่นาที',
    cta: 'เข้าสู่ Voxel Forge',
    stats: [
      { k: '.GLB', l: 'ส่งออกมาตรฐาน' },
      { k: 'PBR', l: 'Material' },
      { k: '4K', l: 'Texture' },
    ],
    hues: [160, 180, 220],
    pattern: 'voxel',
  },
  {
    id: 'loom-live',
    badge: 'LIVE COLLAB',
    title: 'Loom Live',
    subtitle: 'ทอความฝันร่วมกัน · real-time',
    desc: 'เชิญเพื่อนมาทอ prompt พร้อมกัน เห็น cursor, เห็น thread, แก้พร้อมกัน',
    cta: 'เปิดห้องใหม่',
    stats: [
      { k: '8', l: 'ผู้ร่วมงาน' },
      { k: '0ms', l: 'sync latency' },
      { k: '∞', l: 'ประวัติ versioning' },
    ],
    hues: [280, 320, 200],
    pattern: 'threads',
  },
  {
    id: 'audio-muse',
    badge: 'AUDIO · BETA',
    title: 'Muse Audio v3',
    subtitle: 'เสียงประกอบ · เพลง · บรรยากาศ',
    desc: 'จากข้อความสู่ score ภาพยนตร์ · ambient · foley — มี stem แยกสำหรับตัดต่อ',
    cta: 'ฟังตัวอย่าง',
    stats: [
      { k: '48kHz', l: 'คุณภาพสตูดิโอ' },
      { k: '4 stems', l: 'แยก track' },
      { k: '3 min', l: 'ความยาว' },
    ],
    hues: [30, 340, 280],
    pattern: 'audio',
  },
  {
    id: 'workflow',
    badge: 'AUTOMATION',
    title: 'Workflow Nodes',
    subtitle: 'ร้อยโมเดลเป็น pipeline ของคุณ',
    desc: 'Prompt → Image → Upscale → Video → Audio — ลาก connect ต่อเป็น workflow แบบ node-based',
    cta: 'ดู workflows',
    stats: [
      { k: '40+', l: 'Nodes พร้อมใช้' },
      { k: 'JSON', l: 'Export / Import' },
      { k: 'API', l: 'Trigger' },
    ],
    hues: [220, 180, 260],
    pattern: 'nodes',
  },
];

// ─── Visual patterns (stand-in for real video) ───
const WavesPattern = ({ hues, t }) => (
  <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <defs>
      <linearGradient id="bgw" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={`hsl(${hues[0]},70%,12%)`} />
        <stop offset="100%" stopColor={`hsl(${hues[1]},70%,6%)`} />
      </linearGradient>
    </defs>
    <rect width="600" height="400" fill="url(#bgw)" />
    {Array.from({ length: 12 }).map((_, i) => {
      const phase = t * 0.6 + i * 0.5;
      const y = 200 + Math.sin(phase) * (40 + i * 5);
      const h = (hues[i % hues.length] + t * 6) % 360;
      return (
        <path key={i}
          d={`M 0 ${y} Q 150 ${y + Math.cos(phase) * 60} 300 ${y} T 600 ${y + Math.sin(phase + 1) * 50}`}
          fill="none" stroke={`hsl(${h},80%,65%)`} strokeWidth={1.2} opacity={0.35 + (i % 3) * 0.12} strokeLinecap="round"
        />
      );
    })}
  </svg>
);

const VoxelPattern = ({ hues, t }) => (
  <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <rect width="600" height="400" fill={`hsl(${hues[0]},60%,8%)`} />
    <g transform={`translate(300,220) rotate(${t * 4})`}>
      {Array.from({ length: 5 }).map((_, layer) => (
        <g key={layer} transform={`translate(0, ${-layer * 22}) skewX(-20)`}>
          {Array.from({ length: 5 }).map((_, x) =>
            Array.from({ length: 5 }).map((_, y) => {
              const show = (x + y + layer) % 2 === 0 && (x !== 2 || y !== 2);
              if (!show) return null;
              const h = (hues[(x + layer) % hues.length] + t * 3) % 360;
              return (
                <rect key={`${x}-${y}`} x={(x - 2) * 28 + (y - 2) * 14} y={(y - 2) * 28 - (x - 2) * 14}
                  width={26} height={26} fill={`hsl(${h},70%,${45 + layer * 5}%)`}
                  opacity={0.6 + layer * 0.08} stroke={`hsl(${h},85%,70%)`} strokeWidth={0.4}
                />
              );
            })
          )}
        </g>
      ))}
    </g>
  </svg>
);

const ThreadsPattern = ({ hues, t }) => (
  <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <rect width="600" height="400" fill={`hsl(${hues[0]},60%,6%)`} />
    {Array.from({ length: 24 }).map((_, i) => {
      const a = (i / 24) * Math.PI * 2 + t * 0.03;
      const r1 = 80, r2 = 180;
      const x1 = 300 + Math.cos(a) * r1, y1 = 200 + Math.sin(a) * r1;
      const x2 = 300 + Math.cos(a + t * 0.02) * r2, y2 = 200 + Math.sin(a + t * 0.02) * r2;
      const h = (hues[i % hues.length] + t * 4) % 360;
      return (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={`hsl(${h},80%,65%)`} strokeWidth={1} opacity={0.5} strokeLinecap="round" />
      );
    })}
    {/* cursors */}
    {[0, 1, 2].map(i => {
      const a = t * 0.08 + i * 2.1;
      const x = 300 + Math.cos(a) * 140, y = 200 + Math.sin(a) * 140;
      const h = hues[i];
      return <circle key={i} cx={x} cy={y} r={5} fill={`hsl(${h},90%,70%)`} opacity={0.9} />;
    })}
  </svg>
);

const AudioPattern = ({ hues, t }) => (
  <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <rect width="600" height="400" fill={`hsl(${hues[0]},60%,7%)`} />
    {Array.from({ length: 48 }).map((_, i) => {
      const x = 20 + i * 12;
      const h = Math.abs(Math.sin(t * 0.3 + i * 0.4) * Math.cos(t * 0.1 + i * 0.08)) * 180 + 20;
      const hue = (hues[i % hues.length] + t * 3) % 360;
      return (
        <rect key={i} x={x} y={200 - h / 2} width={8} height={h} rx={2}
          fill={`hsl(${hue},75%,${55 + (i % 5) * 4}%)`} opacity={0.75}
        />
      );
    })}
  </svg>
);

const NodesPattern = ({ hues, t }) => {
  const nodes = [
    { x: 120, y: 130, label: 'Prompt' },
    { x: 280, y: 90, label: 'Image' },
    { x: 280, y: 200, label: 'Style' },
    { x: 440, y: 130, label: 'Video' },
    { x: 440, y: 270, label: 'Audio' },
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4]];
  return (
    <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <rect width="600" height="400" fill={`hsl(${hues[0]},60%,7%)`} />
      {/* edges with flowing dots */}
      {edges.map(([a, b], i) => {
        const na = nodes[a], nb = nodes[b];
        const h = (hues[i % hues.length] + t * 4) % 360;
        const progress = ((t * 0.02 + i * 0.2) % 1);
        const dotX = na.x + (nb.x - na.x) * progress;
        const dotY = na.y + (nb.y - na.y) * progress;
        return (
          <g key={i}>
            <line x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke={`hsl(${h},70%,50%)`} strokeWidth={1.2} opacity={0.45} />
            <circle cx={dotX} cy={dotY} r={3} fill={`hsl(${h},90%,75%)`} opacity={0.95} />
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const h = (hues[i % hues.length] + t * 3) % 360;
        return (
          <g key={i}>
            <rect x={n.x - 36} y={n.y - 16} width={72} height={32} rx={8}
              fill={`hsl(${h},70%,12%)`} stroke={`hsl(${h},80%,55%)`} strokeWidth={1} />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fill="#fff" fontSize="11" fontFamily="Inter">{n.label}</text>
            <circle cx={n.x - 36} cy={n.y} r={3} fill={`hsl(${h},90%,70%)`} />
            <circle cx={n.x + 36} cy={n.y} r={3} fill={`hsl(${h},90%,70%)`} />
          </g>
        );
      })}
    </svg>
  );
};

const PatternRenderer = ({ pattern, hues, t }) => {
  switch (pattern) {
    case 'voxel': return <VoxelPattern hues={hues} t={t} />;
    case 'threads': return <ThreadsPattern hues={hues} t={t} />;
    case 'audio': return <AudioPattern hues={hues} t={t} />;
    case 'nodes': return <NodesPattern hues={hues} t={t} />;
    case 'waves':
    default: return <WavesPattern hues={hues} t={t} />;
  }
};

// ─── Banner Slider ───
const BannerSlider = ({ hueShift = 0 }) => {
  const [idx, setIdx] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [t, setT] = React.useState(0);
  const [progress, setProgress] = React.useState(0);
  const SLIDE_MS = 6000;

  // animation ticker for patterns
  React.useEffect(() => {
    let raf;
    const loop = () => {
      setT(v => v + 0.4);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // auto-advance + progress bar
  React.useEffect(() => {
    if (paused) return;
    setProgress(0);
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(1, elapsed / SLIDE_MS));
      if (elapsed >= SLIDE_MS) {
        setIdx(i => (i + 1) % BANNER_SLIDES.length);
      }
    }, 40);
    return () => clearInterval(tick);
  }, [idx, paused]);

  const slide = BANNER_SLIDES[idx];
  const [h1, h2, h3] = slide.hues.map(h => (h + hueShift) % 360);

  return (
    <section style={{ position: 'relative', padding: '0 0 80px' }}>
      <div className="rp-container" style={{ maxWidth: 1280, margin: '0 auto', padding: '0 48px' }}>
        <div
          className="rp-banner"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          style={{
            position: 'relative',
            height: 420,
            borderRadius: 28,
            overflow: 'hidden',
            background: `linear-gradient(135deg, hsl(${h1},65%,10%) 0%, hsl(${h2},65%,6%) 100%)`,
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: `0 40px 80px -30px hsla(${h1},70%,30%,0.6), 0 0 0 1px rgba(255,255,255,0.04)`,
          }}
        >
          {/* Animated pattern background */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.85 }}>
            <PatternRenderer pattern={slide.pattern} hues={[h1, h2, h3]} t={t} />
          </div>

          {/* Video element (hidden placeholder — swap src when you have real video) */}
          {slide.videoSrc && (
            <video
              key={slide.id}
              src={slide.videoSrc}
              poster={slide.poster}
              autoPlay muted loop playsInline
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', opacity: 0.7, mixBlendMode: 'lighten',
              }}
            />
          )}

          {/* Darkening overlay for text legibility */}
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(90deg, rgba(3,6,18,0.85) 0%, rgba(3,6,18,0.55) 50%, rgba(3,6,18,0.2) 100%)`,
          }} />

          {/* Content */}
          <div
            className="rp-banner-content"
            key={slide.id}
            style={{
              position: 'relative', height: '100%', padding: '56px 64px',
              display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 32,
              alignItems: 'center',
              animation: 'bannerIn 600ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '5px 12px', borderRadius: 999,
                background: `hsla(${h3},80%,60%,0.15)`,
                border: `1px solid hsla(${h3},80%,60%,0.35)`,
                fontSize: 10, letterSpacing: '0.22em', color: `hsl(${h3},90%,80%)`,
                textTransform: 'uppercase', fontWeight: 600, marginBottom: 18,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: `hsl(${h3},90%,65%)`, boxShadow: `0 0 10px hsl(${h3},90%,70%)` }} />
                {slide.badge}
              </div>
              <div style={{
                fontSize: 12, letterSpacing: '0.14em', color: '#a5f3fc',
                textTransform: 'uppercase', marginBottom: 8,
              }}>{slide.subtitle}</div>
              <h2 style={{
                fontSize: 'clamp(36px, 4.8vw, 64px)', fontWeight: 200, color: '#fff',
                letterSpacing: '-0.02em', lineHeight: 1.05, margin: 0,
                fontFamily: 'Inter, sans-serif',
              }}>
                <span style={{
                  background: `linear-gradient(120deg, hsl(${h1},80%,75%) 0%, hsl(${h2},85%,72%) 50%, hsl(${h3},80%,78%) 100%)`,
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  paddingBottom: '0.1em', display: 'inline-block',
                }}>{slide.title}</span>
              </h2>
              <p style={{
                marginTop: 18, fontSize: 16, color: 'rgba(203,213,225,0.8)',
                fontWeight: 300, lineHeight: 1.55, maxWidth: 520,
              }}>{slide.desc}</p>

              <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={{
                  background: `linear-gradient(135deg, hsl(${h1},75%,55%) 0%, hsl(${h2},75%,55%) 50%, hsl(${h3},75%,55%) 100%)`,
                  color: '#fff', border: 'none', padding: '12px 22px', borderRadius: 12,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  boxShadow: `0 12px 30px -10px hsla(${h2},80%,50%,0.7)`,
                }}>{slide.cta} →</button>
                <button style={{
                  background: 'rgba(255,255,255,0.06)', color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.15)',
                  padding: '11px 20px', borderRadius: 12, fontSize: 14,
                  fontWeight: 500, cursor: 'pointer',
                }}>เรียนรู้เพิ่มเติม</button>
              </div>
            </div>

            {/* Right stats column */}
            <div className="rp-banner-stats" style={{
              display: 'flex', flexDirection: 'column', gap: 14,
              padding: 24, borderRadius: 18,
              background: 'rgba(3,6,18,0.45)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{ fontSize: 10, letterSpacing: '0.2em', color: '#94a3b8', textTransform: 'uppercase' }}>
                · ข้อมูลจำเพาะ
              </div>
              {slide.stats.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  paddingBottom: i < slide.stats.length - 1 ? 12 : 0,
                  borderBottom: i < slide.stats.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}>
                  <div style={{ fontSize: 13, color: 'rgba(203,213,225,0.75)' }}>{s.l}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 300, color: '#fff',
                    fontFamily: 'Inter', letterSpacing: '-0.01em',
                  }}>{s.k}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
            background: 'rgba(255,255,255,0.06)',
          }}>
            <div style={{
              height: '100%', width: `${progress * 100}%`,
              background: `linear-gradient(90deg, hsl(${h1},85%,65%), hsl(${h3},85%,70%))`,
              transition: 'width 60ms linear',
              boxShadow: `0 0 12px hsl(${h2},80%,60%)`,
            }} />
          </div>
        </div>

        {/* Dots */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20,
          alignItems: 'center',
        }}>
          {BANNER_SLIDES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                width: i === idx ? 28 : 8, height: 8, borderRadius: 999,
                background: i === idx
                  ? `linear-gradient(90deg, hsl(${h1},85%,65%), hsl(${h3},85%,70%))`
                  : 'rgba(255,255,255,0.18)',
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'width 300ms cubic-bezier(0.4,0,0.2,1), background 300ms',
              }}
            />
          ))}
          <div style={{ fontSize: 11, color: '#64748b', marginLeft: 12, letterSpacing: '0.1em' }}>
            {String(idx + 1).padStart(2, '0')} / {String(BANNER_SLIDES.length).padStart(2, '0')}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bannerIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @media (max-width: 900px) {
          .rp-banner { height: auto !important; min-height: 520px; }
          .rp-banner-content { grid-template-columns: 1fr !important; padding: 40px 28px !important; }
          .rp-banner-stats { padding: 18px !important; }
        }
        @media (max-width: 720px) {
          .rp-banner { min-height: 560px; border-radius: 20px !important; }
          .rp-banner-content { padding: 32px 22px !important; gap: 20px !important; }
        }
      `}</style>
    </section>
  );
};

Object.assign(window, { BannerSlider });
