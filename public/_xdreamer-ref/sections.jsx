// Sections for the AI generation platform landing

const { FiberThreads, FiberGlyph } = window;

// ===================== NAV =====================
const Nav = ({ brand = 'AETHER', page = 'home', onNav, loggedIn, user, onLogout }) => {
  const links = [
    { id: 'studio', label: 'สตูดิโอ' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'docs', label: 'Docs' },
    { id: 'about', label: 'About' },
  ];
  return (
    <nav className="rp-nav" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      padding: '20px 48px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      backdropFilter: 'blur(18px) saturate(1.3)',
      WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
      background: 'linear-gradient(180deg, rgba(3,6,18,0.65), rgba(3,6,18,0.25))',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => onNav && onNav('home')}>
        <img src="xdreamer-logo.png" alt={brand} style={{
          width: 38, height: 38, borderRadius: 10, objectFit: 'cover',
          boxShadow: '0 0 20px rgba(139,92,246,0.45)',
        }} />
        <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, letterSpacing: '0.22em', fontSize: 14, color: '#fff' }}>
          {brand}
        </div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: '#94a3b8', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, marginLeft: 6 }}>
          v4 · LIVE
        </div>
      </div>
      <div className="rp-nav-links" style={{ display: 'flex', gap: 28, fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
        {links.map(l => (
          <a key={l.id} onClick={() => onNav && onNav(l.id)} style={{
            color: page === l.id ? '#fff' : 'inherit',
            textDecoration: 'none', cursor: 'pointer', position: 'relative',
            paddingBottom: 2,
            borderBottom: page === l.id ? '1px solid rgba(165,243,252,0.6)' : '1px solid transparent',
          }}>{l.label}</a>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {loggedIn ? (
          <UserMenu user={user} onLogout={onLogout} onNav={onNav} />
        ) : (
          <>
            <button onClick={() => onNav && onNav('login')} style={{
              background: 'transparent', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.15)',
              padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>เข้าสู่ระบบ</button>
            <button onClick={() => onNav && onNav('signup')} style={{
              background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)',
              color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 8px 24px -8px rgba(139,92,246,0.6)',
            }}>เริ่มสร้างฟรี</button>
          </>
        )}
      </div>
    </nav>
  );
};

// ===================== HERO =====================
const PROMPT_SAMPLES = [
  { th: 'ปราสาทลอยฟ้าที่ทอด้วยเส้นใยแสง, ออโรร่าไหลผ่าน, โทนเขียวหยก', en: 'Floating castle woven from threads of light, aurora flowing through, jade tones' },
  { th: 'เส้นใยความคิดของมนุษย์ในวันฝันกลางวัน, สีม่วงนุ่ม, เรืองรองอ่อน', en: 'Fibers of a daydreaming mind, soft violet, gentle glow' },
  { th: 'ป่าลึกใต้น้ำที่มีเงาแสงสีฟ้าเต้นระบำ, ฟิล์มแนว cinematic', en: 'Deep underwater forest with dancing blue light, cinematic' },
  { th: 'เมืองแห่งความฝันที่สร้างจากเส้นด้ายจักรวาล, เขียวมรกต + ไวโอเลต', en: 'Dream city built of cosmic threads, emerald + violet' },
];

const Hero = ({ hueShift, noCanvas }) => {
  const [promptIdx, setPromptIdx] = React.useState(0);
  const [typed, setTyped] = React.useState('');
  const [generating, setGenerating] = React.useState(false);
  const [mode, setMode] = React.useState('image'); // image / video / audio / 3d
  const [promptValue, setPromptValue] = React.useState(PROMPT_SAMPLES[0].th);

  // auto-cycle prompts
  React.useEffect(() => {
    const id = setInterval(() => setPromptIdx(i => (i + 1) % PROMPT_SAMPLES.length), 5200);
    return () => clearInterval(id);
  }, []);

  // "type" the current sample
  React.useEffect(() => {
    const target = PROMPT_SAMPLES[promptIdx].th;
    setPromptValue(target);
    setTyped('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [promptIdx]);

  // simulate generating pulse
  React.useEffect(() => {
    const id = setInterval(() => {
      setGenerating(true);
      setTimeout(() => setGenerating(false), 1800);
    }, 5200);
    return () => clearInterval(id);
  }, []);

  const modes = [
    { id: 'image', label: 'Image', icon: '▧' },
    { id: 'video', label: 'Video', icon: '▶' },
    { id: 'audio', label: 'Audio', icon: '◎' },
    { id: '3d', label: '3D Scene', icon: '◈' },
  ];

  return (
    <section style={{ position: 'relative', minHeight: '100vh', paddingTop: 120, paddingBottom: 80, overflow: 'hidden' }}>
      {!noCanvas && <FiberThreads density={70} speed={1} hueShift={hueShift} opacity={0.55} />}

      {/* Soft vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 40%, transparent 0%, rgba(3,6,18,0.5) 70%, rgba(3,6,18,0.95) 100%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '0 48px' }}>
        {/* Floating logo mark — upper right of hero */}
        <div className="rp-hero-logo-wrap" style={{
          position: 'absolute', top: -20, right: 48, zIndex: 2,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            position: 'relative',
            animation: 'floatY 6s ease-in-out infinite',
          }}>
            <div style={{
              position: 'absolute', inset: -20, borderRadius: '50%',
              background: `radial-gradient(circle, hsla(${270+hueShift},80%,55%,0.45), transparent 65%)`,
              filter: 'blur(20px)',
            }} />
            <img className="rp-hero-logo" src="xdreamer-logo.png" alt="X-DREAMER" style={{
              position: 'relative',
              width: 180, height: 180, borderRadius: 28, objectFit: 'cover',
              boxShadow: `0 30px 60px -15px hsla(${270+hueShift},70%,40%,0.6), 0 0 0 1px rgba(255,255,255,0.08)`,
            }} />
          </div>
          <div style={{ fontSize: 10, letterSpacing: '0.24em', color: '#a5f3fc', textTransform: 'uppercase' }}>
            AI Video Generation
          </div>
        </div>
        {/* eyebrow */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '6px 14px', borderRadius: 999,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc',
          textTransform: 'uppercase',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 999, background: '#34d399',
            boxShadow: '0 0 8px #34d399', animation: 'pulse 2s infinite',
          }} />
          GENERATIVE FABRIC · REAL-TIME
        </div>

        <h1 style={{
          marginTop: 28,
          fontSize: 'clamp(56px, 8.5vw, 128px)',
          fontWeight: 300,
          lineHeight: 0.95,
          letterSpacing: '-0.03em',
          color: '#fff',
          textWrap: 'balance',
        }}>
          ทอ<span style={{
            fontStyle: 'italic', fontWeight: 200,
            background: `linear-gradient(120deg, hsl(${160 + hueShift}, 80%, 65%) 0%, hsl(${200 + hueShift}, 85%, 70%) 45%, hsl(${270 + hueShift}, 80%, 72%) 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}> ความฝัน </span>
          <br />
          <span style={{ fontWeight: 700 }}>จากเส้นใย</span>
          <span style={{ fontWeight: 200, opacity: 0.6 }}>แห่งความคิด</span>
        </h1>

        <p style={{
          marginTop: 28, maxWidth: 640, fontSize: 19, lineHeight: 1.55,
          color: 'rgba(226,232,240,0.78)', fontWeight: 300,
        }}>
          แพลตฟอร์ม AI generate สำหรับศิลปินและนักฝัน — สร้างภาพ วิดีโอ เสียง และฉาก 3 มิติจากประโยคเดียว
          ด้วยโมเดลที่เรียนรู้จากผืนผ้าความหมายของจักรวาลทั้งมวล
        </p>

        {/* Prompt studio */}
        <div style={{
          marginTop: 48,
          maxWidth: 820,
          background: 'rgba(15,23,42,0.45)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 24,
          padding: 6,
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}>
          {/* mode tabs */}
          <div style={{ display: 'flex', padding: '10px 14px 4px', gap: 4 }}>
            {modes.map(m => (
              <button key={m.id}
                onClick={() => setMode(m.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: mode === m.id
                    ? `linear-gradient(135deg, hsla(${160 + hueShift},70%,55%,0.25), hsla(${270 + hueShift},70%,60%,0.25))`
                    : 'transparent',
                  color: mode === m.id ? '#fff' : 'rgba(226,232,240,0.55)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: mode === m.id ? 'inset 0 0 0 1px rgba(255,255,255,0.1)' : 'none',
                }}>
                <span style={{ fontSize: 13 }}>{m.icon}</span>
                {m.label}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', padding: '10px 8px', letterSpacing: '0.08em' }}>
              MODEL · loom-v4.2
            </div>
          </div>

          {/* prompt input row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '18px 20px 18px 22px',
            background: 'rgba(2,6,23,0.5)',
            borderRadius: 20,
            margin: 4,
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: 999,
              background: generating ? '#fbbf24' : '#34d399',
              boxShadow: generating ? '0 0 12px #fbbf24' : '0 0 8px #34d399',
              flexShrink: 0,
              animation: generating ? 'pulse 0.8s infinite' : 'pulse 2s infinite',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.12em', marginBottom: 4 }}>PROMPT</div>
              <div style={{
                fontSize: 17, color: '#f1f5f9', lineHeight: 1.4,
                fontWeight: 400,
                minHeight: 24,
              }}>
                {typed}
                <span style={{
                  display: 'inline-block', width: 8, height: 20, background: '#a5f3fc',
                  marginLeft: 3, verticalAlign: 'middle',
                  animation: 'blink 1s step-end infinite',
                }} />
              </div>
            </div>
            <button style={{
              background: `linear-gradient(135deg, hsl(${160 + hueShift},70%,50%), hsl(${270 + hueShift},70%,60%))`,
              color: '#fff', border: 'none', padding: '12px 22px', borderRadius: 12,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: `0 10px 24px -8px hsl(${270 + hueShift},70%,50%)`,
              flexShrink: 0,
            }}>
              {generating ? 'กำลังทอ...' : 'ทอเลย'} <span style={{ fontSize: 16 }}>→</span>
            </button>
          </div>

          {/* generation tray — 4 live frames */}
          <div style={{
            padding: '10px 10px 12px',
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
          }}>
            {[0, 1, 2, 3].map(i => (
              <GenFrame key={i} index={i} generating={generating} hueShift={hueShift} mode={mode} />
            ))}
          </div>
        </div>

        {/* stat strip */}
        <div style={{ display: 'flex', gap: 48, marginTop: 56, flexWrap: 'wrap' }}>
          {[
            { v: '2.4M+', l: 'ความฝันถูกทอทุกวัน' },
            { v: '48', l: 'โมเดลเฉพาะทาง' },
            { v: '<2s', l: 'เวลาสร้างเฉลี่ย' },
            { v: '99.2%', l: 'uptime ปีที่ผ่านมา' },
          ].map((s, i) => (
            <div key={i}>
              <div style={{
                fontSize: 36, fontWeight: 300, color: '#fff',
                background: `linear-gradient(180deg, #fff 0%, hsl(${180 + hueShift + i * 30}, 70%, 75%) 100%)`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>{s.v}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, letterSpacing: '0.05em' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// Live generation frame with "weaving" effect
const GenFrame = ({ index, generating, hueShift, mode }) => {
  const [progress, setProgress] = React.useState(40 + index * 15);
  React.useEffect(() => {
    if (generating) {
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
    }
  }, [generating, index]);

  const hue1 = (140 + index * 35 + hueShift) % 360;
  const hue2 = (hue1 + 60) % 360;

  return (
    <div style={{
      aspectRatio: '1 / 1.15',
      borderRadius: 14,
      position: 'relative',
      overflow: 'hidden',
      background: `linear-gradient(135deg, hsl(${hue1}, 60%, 12%), hsl(${hue2}, 60%, 8%))`,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* woven fiber pattern */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 115">
        <defs>
          <linearGradient id={`g${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue1}, 85%, 65%)`} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`hsl(${hue2}, 85%, 70%)`} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {Array.from({ length: 12 }).map((_, i) => {
          const reveal = progress > (i / 12) * 100;
          return (
            <path
              key={i}
              d={`M${-5 + i * 9} ${115 + i * 3} Q${50 + Math.sin(i) * 30} ${60 + i * 2} ${105 - i * 6} ${-5 + i * 4}`}
              stroke={`url(#g${index})`}
              strokeWidth={0.4 + (i % 3) * 0.3}
              fill="none"
              opacity={reveal ? 0.7 : 0}
              style={{ transition: 'opacity 0.4s ease' }}
            />
          );
        })}
      </svg>

      {/* mode overlay icon when complete */}
      {progress >= 100 && mode === 'video' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: 'rgba(255,255,255,0.85)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 999,
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(8px)',
            display: 'grid', placeItems: 'center',
            fontSize: 14, paddingLeft: 3,
          }}>▶</div>
        </div>
      )}

      {/* progress bar */}
      <div style={{
        position: 'absolute', left: 10, right: 10, bottom: 10,
        height: 2, borderRadius: 999,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${progress}%`,
          background: `linear-gradient(90deg, hsl(${hue1}, 85%, 60%), hsl(${hue2}, 85%, 70%))`,
          transition: 'width 0.1s linear',
          boxShadow: `0 0 8px hsl(${hue1}, 85%, 60%)`,
        }} />
      </div>

      {/* label */}
      <div style={{
        position: 'absolute', top: 8, left: 10,
        fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em',
        fontFamily: 'ui-monospace, Menlo, monospace',
      }}>#{String(index + 1).padStart(2, '0')} · {progress < 100 ? 'weaving' : 'ready'}</div>
    </div>
  );
};

// User menu shown in nav when logged in
const UserMenu = ({ user, onLogout, onNav }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const initial = (user?.name || 'X')[0];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px 6px 6px',
        borderRadius: 999, background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'conic-gradient(from 180deg, #10b981, #06b6d4, #8b5cf6, #10b981)',
          display: 'grid', placeItems: 'center',
          fontSize: 13, fontWeight: 700, color: '#030612',
        }}>{initial}</div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{user?.name || 'User'}</span>
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 220,
          background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          padding: 6, boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5)',
          zIndex: 60,
        }}>
          <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{user?.email}</div>
          </div>
          {[
            { id: 'dashboard', l: 'Dashboard', i: '◈' },
            { id: 'studio', l: 'สตูดิโอ', i: '✦' },
            { id: 'gallery', l: 'Gallery', i: '▧' },
          ].map(it => (
            <button key={it.id} onClick={() => { onNav(it.id); setOpen(false); }} style={{
              width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 8,
              background: 'transparent', border: 'none', color: '#e2e8f0',
              fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 10,
            }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            ><span style={{ color: '#a5f3fc', width: 14 }}>{it.i}</span>{it.l}</button>
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />
          <button onClick={() => { onLogout(); setOpen(false); }} style={{
            width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 8,
            background: 'transparent', border: 'none', color: '#fca5a5',
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 10,
          }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          ><span style={{ width: 14 }}>⎋</span>ออกจากระบบ</button>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { Nav, Hero, GenFrame, UserMenu });
