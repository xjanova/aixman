// Additional pages: Studio, Dashboard, Pricing-detail, Gallery-detail, About, Auth
const { FiberThreads, Nav, FooterCTA } = window;

// ============ STUDIO / WORKSPACE ============
const StudioPage = ({ hueShift }) => {
  const [prompt, setPrompt] = React.useState('ปราสาทลอยฟ้าที่ทอด้วยเส้นใยแสง, ออโรร่าไหลผ่าน');
  const [style, setStyle] = React.useState('dreamy');
  const [aspect, setAspect] = React.useState('1:1');
  const [model, setModel] = React.useState('loom-v4.2');
  const [steps, setSteps] = React.useState(42);
  const [guidance, setGuidance] = React.useState(7.5);
  const [seed, setSeed] = React.useState(18234);
  const [generating, setGenerating] = React.useState(false);
  const [results, setResults] = React.useState([0, 1, 2, 3]);

  const generate = () => {
    setGenerating(true);
    setTimeout(() => { setGenerating(false); setResults(results.map(() => Math.random())); }, 2400);
  };

  const styles = ['dreamy', 'mystical', 'cinematic', 'painterly', 'concept art', 'anime', 'photoreal'];
  const aspects = ['1:1', '16:9', '9:16', '4:5', '21:9'];
  const models = ['loom-v4.2', 'loom-pro', 'loom-fast', 'loom-video', 'loom-3d'];

  return (
    <div className="rp-studio" style={{ paddingTop: 80, minHeight: '100vh', display: 'grid', gridTemplateColumns: '320px 1fr 340px', gap: 0, background: '#030612' }}>
      {/* LEFT: prompt & controls */}
      <aside style={{
        borderRight: '1px solid rgba(255,255,255,0.06)',
        padding: 24,
        display: 'flex', flexDirection: 'column', gap: 20,
        background: 'rgba(15,23,42,0.25)',
        height: 'calc(100vh - 80px)', overflowY: 'auto',
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#a5f3fc', marginBottom: 10, textTransform: 'uppercase' }}>Prompt</div>
          <textarea
            value={prompt} onChange={e => setPrompt(e.target.value)}
            rows={5}
            style={{
              width: '100%', padding: 14, borderRadius: 12,
              background: 'rgba(2,6,23,0.6)', color: '#f1f5f9',
              border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {['cinematic lighting', '8k', 'volumetric', 'aurora', 'jade'].map(t => (
              <button key={t} style={{
                padding: '5px 10px', borderRadius: 999, fontSize: 11,
                background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
                border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
              }}>+ {t}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#a5f3fc', marginBottom: 10, textTransform: 'uppercase' }}>Negative prompt</div>
          <input placeholder="blurry, low quality, text..." style={{
            width: '100%', padding: 12, borderRadius: 10,
            background: 'rgba(2,6,23,0.6)', color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.1)',
            fontSize: 13, fontFamily: 'inherit', outline: 'none',
          }} />
        </div>

        <ControlGroup label="Style">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {styles.map(s => (
              <button key={s} onClick={() => setStyle(s)} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12,
                background: style === s ? `hsla(${220+hueShift},60%,50%,0.3)` : 'rgba(255,255,255,0.04)',
                color: style === s ? '#fff' : '#94a3b8',
                border: style === s ? `1px solid hsla(${220+hueShift},70%,60%,0.5)` : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}>{s}</button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup label="Aspect ratio">
          <div style={{ display: 'flex', gap: 6 }}>
            {aspects.map(a => (
              <button key={a} onClick={() => setAspect(a)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12,
                background: aspect === a ? `hsla(${220+hueShift},60%,50%,0.3)` : 'rgba(255,255,255,0.04)',
                color: aspect === a ? '#fff' : '#94a3b8',
                border: aspect === a ? `1px solid hsla(${220+hueShift},70%,60%,0.5)` : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}>{a}</button>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup label="Model">
          <select value={model} onChange={e => setModel(e.target.value)} style={{
            width: '100%', padding: 10, borderRadius: 10,
            background: 'rgba(2,6,23,0.6)', color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
          }}>
            {models.map(m => <option key={m} value={m} style={{ background: '#0f172a' }}>{m}</option>)}
          </select>
        </ControlGroup>

        <SliderCtrl label="Steps" value={steps} min={10} max={80} onChange={setSteps} />
        <SliderCtrl label="Guidance" value={guidance} min={1} max={20} step={0.5} onChange={setGuidance} />

        <ControlGroup label="Seed">
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={seed} onChange={e => setSeed(+e.target.value || 0)} style={{
              flex: 1, padding: 10, borderRadius: 10,
              background: 'rgba(2,6,23,0.6)', color: '#f1f5f9',
              border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, fontFamily: 'ui-monospace, monospace', outline: 'none',
            }} />
            <button onClick={() => setSeed(Math.floor(Math.random() * 99999))} style={{
              padding: '0 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
            }}>↻</button>
          </div>
        </ControlGroup>

        <button onClick={generate} disabled={generating} style={{
          marginTop: 'auto', padding: '16px', borderRadius: 12,
          background: `linear-gradient(135deg, hsl(${160+hueShift},70%,45%), hsl(${280+hueShift},70%,55%))`,
          color: '#fff', border: 'none', fontSize: 15, fontWeight: 600, cursor: generating ? 'wait' : 'pointer',
          boxShadow: `0 10px 24px -8px hsla(${270+hueShift},70%,50%,0.5)`,
          opacity: generating ? 0.7 : 1,
        }}>{generating ? '⟳ กำลังทอ...' : 'ทอ ✦ 4 ภาพ · 12 credits'}</button>
      </aside>

      {/* CENTER: canvas */}
      <main style={{ padding: 24, overflowY: 'auto', height: 'calc(100vh - 80px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['ภาพ 4 ใบ', 'Variations', 'Upscale', 'Inpaint', 'History'].map((t, i) => (
              <button key={t} style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12,
                background: i === 0 ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: i === 0 ? '#fff' : '#94a3b8',
                border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
              }}>{t}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
            session · weaver_42 · {new Date().toLocaleTimeString('th-TH')}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {results.map((r, i) => <StudioFrame key={i} index={i} seed={r} hueShift={hueShift} generating={generating} aspect={aspect} />)}
        </div>

        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.1em', marginBottom: 12, textTransform: 'uppercase' }}>· รุ่นก่อนหน้า (history)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} style={{
                aspectRatio: '1',
                borderRadius: 8,
                background: `linear-gradient(135deg, hsl(${(i*23+hueShift)%360}, 50%, 15%), hsl(${(i*23+60+hueShift)%360}, 50%, 8%))`,
                border: '1px solid rgba(255,255,255,0.05)',
                cursor: 'pointer',
              }} />
            ))}
          </div>
        </div>
      </main>

      {/* RIGHT: layers / reference */}
      <aside style={{
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        padding: 24,
        background: 'rgba(15,23,42,0.25)',
        height: 'calc(100vh - 80px)', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#a5f3fc', marginBottom: 14, textTransform: 'uppercase' }}>Reference images</div>
        <div style={{
          height: 140, borderRadius: 12,
          border: '1.5px dashed rgba(255,255,255,0.15)',
          display: 'grid', placeItems: 'center',
          color: '#64748b', fontSize: 13, cursor: 'pointer', marginBottom: 24,
          background: 'rgba(2,6,23,0.3)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>↑</div>
            ลาก &amp; วางภาพ ที่นี่
          </div>
        </div>

        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: '#a5f3fc', marginBottom: 14, textTransform: 'uppercase' }}>Concept threads</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { n: 'castle · dreamy', w: 85, h: 270 },
            { n: 'aurora light', w: 72, h: 200 },
            { n: 'jade palette', w: 90, h: 155 },
            { n: 'volumetric fog', w: 64, h: 220 },
            { n: 'floating', w: 55, h: 240 },
          ].map((c, i) => (
            <div key={i} style={{
              padding: 12, borderRadius: 10,
              background: 'rgba(2,6,23,0.4)',
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 6, height: 28, borderRadius: 3,
                background: `hsl(${c.h + hueShift}, 70%, 60%)`,
                boxShadow: `0 0 8px hsl(${c.h + hueShift}, 70%, 50%)`,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: '#f1f5f9' }}>{c.n}</div>
                <div style={{
                  marginTop: 4, height: 2, borderRadius: 2,
                  background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${c.w}%`, height: '100%',
                    background: `hsl(${c.h + hueShift}, 70%, 60%)`,
                  }} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>{c.w}%</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28, fontSize: 11, letterSpacing: '0.14em', color: '#a5f3fc', marginBottom: 14, textTransform: 'uppercase' }}>Credits</div>
        <div style={{
          padding: 14, borderRadius: 12,
          background: `linear-gradient(135deg, hsla(${220+hueShift},60%,25%,0.4), hsla(${280+hueShift},60%,20%,0.4))`,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 28, fontWeight: 300, color: '#fff' }}>2,847</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>/ 5,000</div>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>credits ที่เหลือเดือนนี้</div>
          <div style={{ marginTop: 10, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '57%', background: `linear-gradient(90deg, hsl(${160+hueShift},70%,55%), hsl(${280+hueShift},70%,60%))` }} />
          </div>
          <button style={{
            width: '100%', marginTop: 14, padding: '8px', borderRadius: 8,
            background: 'rgba(255,255,255,0.08)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)', fontSize: 12, cursor: 'pointer',
          }}>+ เติม credits</button>
        </div>
      </aside>
    </div>
  );
};

const ControlGroup = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, letterSpacing: '0.04em' }}>{label}</div>
    {children}
  </div>
);

const SliderCtrl = ({ label, value, min, max, step = 1, onChange }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', color: '#e2e8f0' }}>{value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(+e.target.value)}
      style={{ width: '100%', accentColor: '#8b5cf6' }} />
  </div>
);

const StudioFrame = ({ index, seed, hueShift, generating, aspect }) => {
  const hue1 = (140 + index * 35 + hueShift + seed * 360) % 360;
  const hue2 = (hue1 + 60) % 360;
  const [hovered, setHovered] = React.useState(false);
  const ratios = { '1:1': '1/1', '16:9': '16/9', '9:16': '9/16', '4:5': '4/5', '21:9': '21/9' };
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        aspectRatio: ratios[aspect] || '1/1',
        borderRadius: 14,
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(135deg, hsl(${hue1}, 60%, 14%), hsl(${hue2}, 60%, 8%))`,
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
      }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id={`sg${index}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue1}, 85%, 65%)`} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`hsl(${hue2}, 85%, 70%)`} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {Array.from({ length: 20 }).map((_, i) => (
          <path key={i}
            d={`M${-5 + i*6} ${110+Math.sin(i+seed*10) * 8} Q${40 + Math.sin(i+seed*5) * 35} ${50 + Math.cos(i) * 25} ${105 - i*5} ${-5 + Math.cos(i) * 8}`}
            stroke={`url(#sg${index})`}
            strokeWidth={0.3 + (i%4)*0.25}
            fill="none" opacity={0.45 + (i%3)*0.15}
          />
        ))}
      </svg>
      {generating && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(4px)',
          display: 'grid', placeItems: 'center',
          color: '#fff', fontSize: 12, letterSpacing: '0.1em',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8, animation: 'spin 2s linear infinite' }}>⟳</div>
            WEAVING...
          </div>
        </div>
      )}
      {/* toolbar on hover */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        display: 'flex', gap: 4,
        opacity: hovered ? 1 : 0, transition: 'opacity 200ms',
      }}>
        {['✦', '↻', '↓', '⤢'].map((i, k) => (
          <button key={k} style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
            color: '#fff', border: '1px solid rgba(255,255,255,0.15)',
            fontSize: 13, cursor: 'pointer',
          }}>{i}</button>
        ))}
      </div>
      <div style={{
        position: 'absolute', left: 12, bottom: 10,
        fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.08em',
        fontFamily: 'ui-monospace, monospace',
      }}>#{String(index + 1).padStart(2, '0')} · seed {Math.floor(seed * 99999)}</div>
    </div>
  );
};

// ============ DASHBOARD ============
const DashboardPage = ({ hueShift }) => {
  return (
    <div style={{ paddingTop: 110, maxWidth: 1400, margin: '0 auto', padding: '110px 48px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 8 }}>
            · สวัสดี, ฝนทิพย์
          </div>
          <h1 style={{ fontSize: 48, fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>
            ปราสาทแห่งความคิด <span style={{ fontStyle: 'italic', color: '#c4b5fd' }}>ของคุณ</span>
          </h1>
        </div>
        <button style={{
          padding: '12px 20px', borderRadius: 12,
          background: `linear-gradient(135deg, hsl(${160+hueShift},70%,50%), hsl(${270+hueShift},70%,60%))`,
          color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>+ เริ่มงานใหม่</button>
      </div>

      {/* stat cards */}
      <div className="rp-stat-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 40 }}>
        {[
          { l: 'ผลงานทั้งหมด', v: '1,284', d: '+48 สัปดาห์นี้', hue: 160 },
          { l: 'Credits เหลือ', v: '2,847', d: 'รีเซตใน 14 วัน', hue: 200 },
          { l: 'ยอดวิว Gallery', v: '12.4K', d: '+22% เดือนนี้', hue: 250 },
          { l: 'ผู้ติดตาม', v: '347', d: '+18 สัปดาห์นี้', hue: 290 },
        ].map((s, i) => {
          const h = (s.hue + hueShift) % 360;
          return (
            <div key={i} style={{
              padding: 22, borderRadius: 16, position: 'relative', overflow: 'hidden',
              background: 'rgba(15,23,42,0.5)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{
                position: 'absolute', top: 0, right: 0, width: 80, height: 80,
                background: `radial-gradient(circle, hsla(${h},70%,55%,0.35), transparent 70%)`,
                filter: 'blur(10px)',
              }} />
              <div style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.05em' }}>{s.l}</div>
              <div style={{ fontSize: 36, fontWeight: 300, color: '#fff', marginTop: 6, letterSpacing: '-0.02em' }}>{s.v}</div>
              <div style={{ fontSize: 11, color: `hsl(${h},70%,65%)`, marginTop: 4 }}>{s.d}</div>
            </div>
          );
        })}
      </div>

      <div className="rp-dash-main" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24 }}>
        {/* Recent works */}
        <div style={{
          padding: 24, borderRadius: 20,
          background: 'rgba(15,23,42,0.5)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 15, color: '#fff', fontWeight: 500 }}>ผลงานล่าสุด</div>
            <a style={{ fontSize: 12, color: '#a5f3fc' }}>ดูทั้งหมด →</a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{
                aspectRatio: '1',
                borderRadius: 10,
                background: `linear-gradient(135deg, hsl(${(i*41+hueShift)%360}, 55%, 16%), hsl(${(i*41+60+hueShift)%360}, 55%, 9%))`,
                border: '1px solid rgba(255,255,255,0.06)',
                position: 'relative', overflow: 'hidden',
              }}>
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <path key={j}
                      d={`M${-5 + j*14} 110 Q${30 + Math.sin(j+i)*30} 50 ${105 - j*12} -5`}
                      stroke={`hsl(${(i*41 + j*10 + hueShift)%360}, 80%, 65%)`}
                      strokeWidth="0.5" fill="none" opacity="0.7"
                    />
                  ))}
                </svg>
              </div>
            ))}
          </div>
        </div>

        {/* Usage chart */}
        <div style={{
          padding: 24, borderRadius: 20,
          background: 'rgba(15,23,42,0.5)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: 15, color: '#fff', fontWeight: 500, marginBottom: 6 }}>การใช้งาน 30 วัน</div>
          <div style={{ fontSize: 28, fontWeight: 300, color: '#fff' }}>2,153 <span style={{ fontSize: 13, color: '#64748b' }}>งาน</span></div>
          <svg width="100%" height="140" viewBox="0 0 300 140" style={{ marginTop: 16 }}>
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={`hsl(${220+hueShift},80%,60%)`} stopOpacity="0.4" />
                <stop offset="100%" stopColor={`hsl(${220+hueShift},80%,60%)`} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={'M0,110 ' + Array.from({ length: 30 }).map((_, i) => `L${i*10},${100 - (Math.sin(i*0.4)*20 + Math.sin(i*0.15)*30 + 50)}`).join(' ') + ' L300,140 L0,140 Z'}
              fill="url(#chart-fill)"
            />
            <path
              d={'M0,110 ' + Array.from({ length: 30 }).map((_, i) => `L${i*10},${100 - (Math.sin(i*0.4)*20 + Math.sin(i*0.15)*30 + 50)}`).join(' ')}
              stroke={`hsl(${220+hueShift},80%,65%)`} strokeWidth="1.5" fill="none"
            />
          </svg>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>การแบ่งใช้งาน</div>
            {[
              { l: 'Image', v: 68, hue: 160 },
              { l: 'Video', v: 22, hue: 220 },
              { l: 'Audio', v: 7, hue: 270 },
              { l: '3D', v: 3, hue: 290 },
            ].map(r => (
              <div key={r.l} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12 }}>
                <div style={{ width: 60, color: '#94a3b8' }}>{r.l}</div>
                <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ width: `${r.v}%`, height: '100%', background: `hsl(${r.hue+hueShift},70%,60%)` }} />
                </div>
                <div style={{ width: 36, textAlign: 'right', color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }}>{r.v}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Collections */}
      <div style={{ marginTop: 40 }}>
        <div style={{ fontSize: 15, color: '#fff', fontWeight: 500, marginBottom: 20 }}>ปราสาทย่อยของคุณ (collections)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { n: 'ฝันกลางวันของเดือนเมษา', c: 48, hue: 160 },
            { n: 'Dream City series', c: 24, hue: 220 },
            { n: 'เส้นใยสีไวโอเลต', c: 67, hue: 280 },
          ].map((c, i) => {
            const h = (c.hue + hueShift) % 360;
            return (
              <div key={i} style={{
                padding: 20, borderRadius: 16,
                background: `linear-gradient(160deg, hsla(${h},50%,20%,0.5), hsla(${h+30},50%,10%,0.5))`,
                border: `1px solid hsla(${h},60%,40%,0.3)`,
                cursor: 'pointer',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 14 }}>
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} style={{
                      aspectRatio: '1', borderRadius: 6,
                      background: `linear-gradient(135deg, hsl(${h + j*20}, 70%, 55%), hsl(${h + j*20 + 30}, 70%, 45%))`,
                      opacity: 0.8 - j*0.15,
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 500 }}>{c.n}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{c.c} ผลงาน</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============ GALLERY DETAIL ============
const GalleryDetailPage = ({ hueShift }) => {
  const [filter, setFilter] = React.useState('ทั้งหมด');
  const [sort, setSort] = React.useState('trending');
  const items = Array.from({ length: 24 }).map((_, i) => ({
    title: ['ปราสาทหมอกจันทรา', 'Dream Loop', 'เส้นใยดวงดาว', 'Whisper Loom', 'มโนทัศน์มรกต', 'Violet Study'][i % 6] + ' #' + (i+1),
    author: ['นภาลัย', 'kairos', 'Theo', 'จิตรา', 'nine', 'arc_ot'][i % 6],
    hue: (i * 37) % 360,
    likes: Math.floor(Math.random() * 2000) + 50,
    mode: ['image', 'video', 'audio', '3d'][i % 4],
  }));
  return (
    <div style={{ paddingTop: 110, maxWidth: 1500, margin: '0 auto', padding: '110px 48px 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 14 }}>· สำรวจชุมชน</div>
        <h1 style={{ fontSize: 'clamp(48px, 6vw, 80px)', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.05, margin: 0 }}>
          ปราสาท<span style={{ fontStyle: 'italic', color: '#c4b5fd' }}> สาธารณะ</span>
        </h1>
        <p style={{ marginTop: 18, color: 'rgba(203,213,225,0.7)', fontSize: 17, fontWeight: 300 }}>
          2.4 ล้านความฝัน ทอขึ้นจากชุมชน 67,000 คน
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['ทั้งหมด', 'Image', 'Video', 'Audio', '3D', 'Collections'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '8px 16px', borderRadius: 999, fontSize: 13,
              background: filter === f ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: filter === f ? '#fff' : '#94a3b8',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
            }}>{f}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['trending', 'ใหม่ล่าสุด', 'top week'].map(s => (
            <button key={s} onClick={() => setSort(s)} style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12,
              background: sort === s ? 'rgba(139,92,246,0.15)' : 'transparent',
              color: sort === s ? '#fff' : '#94a3b8',
              border: `1px solid ${sort === s ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer',
            }}>{s}</button>
          ))}
        </div>
      </div>

      {/* Masonry-ish grid */}
      <div className="rp-gallery-mason" style={{ columnCount: 4, columnGap: 14 }}>
        {items.map((item, i) => {
          const h1 = (item.hue + hueShift) % 360;
          const h2 = (h1 + 60) % 360;
          const ratio = [1.2, 0.8, 1.4, 1, 1.3, 0.9][i % 6];
          return (
            <div key={i} style={{
              breakInside: 'avoid', marginBottom: 14,
              borderRadius: 14, overflow: 'hidden', position: 'relative',
              background: `linear-gradient(135deg, hsl(${h1}, 60%, 14%), hsl(${h2}, 60%, 8%))`,
              border: '1px solid rgba(255,255,255,0.06)',
              cursor: 'pointer',
            }}>
              <div style={{ paddingBottom: `${ratio * 100}%`, position: 'relative' }}>
                <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id={`gd${i}`} x1="0" x2="1" y1="0" y2="1">
                      <stop offset="0%" stopColor={`hsl(${h1}, 85%, 65%)`} />
                      <stop offset="100%" stopColor={`hsl(${h2}, 85%, 70%)`} />
                    </linearGradient>
                  </defs>
                  {Array.from({ length: 14 }).map((_, j) => (
                    <path key={j}
                      d={`M${-5 + j*8} ${110+Math.sin(j+i)*5} Q${30 + Math.cos(j*1.3+i*0.7)*40} ${50 + Math.sin(j*0.8)*25} ${105 - j*7} ${-5 + Math.cos(j+i)*5}`}
                      stroke={`url(#gd${i})`} strokeWidth={0.3 + (j%4)*0.2}
                      fill="none" opacity={0.4 + (j%3)*0.2}
                    />
                  ))}
                </svg>
              </div>
              <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>@{item.author}</div>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>♡ {item.likes}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <button style={{
          padding: '14px 28px', borderRadius: 12,
          background: 'rgba(255,255,255,0.06)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.12)', fontSize: 14, cursor: 'pointer',
        }}>โหลดเพิ่ม ({items.length} / 2.4M)</button>
      </div>
    </div>
  );
};

// ============ ABOUT ============
const AboutPage = ({ hueShift }) => {
  return (
    <div style={{ paddingTop: 140, paddingBottom: 80 }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 48px' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 14 }}>
          · manifesto
        </div>
        <h1 style={{ fontSize: 'clamp(48px, 7vw, 96px)', fontWeight: 200, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, margin: 0 }}>
          เราเชื่อว่า<br />
          <span style={{ fontStyle: 'italic', background: `linear-gradient(120deg, hsl(${160+hueShift},80%,70%), hsl(${280+hueShift},80%,75%))`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>จินตนาการ</span><br />
          ไม่มีเส้นเขตแดน
        </h1>
        <div style={{ marginTop: 48, fontSize: 19, lineHeight: 1.7, color: 'rgba(203,213,225,0.85)', fontWeight: 300 }}>
          <p>
            AETHER เกิดขึ้นในปี 2024 ที่เชียงใหม่ จากคำถามหนึ่ง — ถ้าเครื่องมือที่ทรงพลังที่สุดในการสร้างภาพ
            ไม่ใช่การวาด แต่เป็นการ "ทอ" ล่ะ? ทอเส้นใยของความคิด ความรู้สึก ความฝัน เข้าด้วยกันจนกลายเป็นภาพเดียว
          </p>
          <p>
            เราไม่ได้สร้างแค่เครื่องมือ AI — เราสร้างภาษาใหม่สำหรับการสื่อสารกับจินตนาการ
            ภาษาที่ศิลปิน นักเขียน นักออกแบบ และเด็กวัย 10 ขวบ ใช้ได้เท่าเทียมกัน
          </p>
          <p style={{ fontStyle: 'italic', fontSize: 22, padding: '24px 0', color: '#c4b5fd', borderLeft: `2px solid hsl(${270+hueShift},70%,60%)`, paddingLeft: 24, marginTop: 40 }}>
            "ทุกความฝันควรมีผืนผ้าที่จะถูกทอ"
          </p>
        </div>

        <div className="rp-grid-3" style={{ marginTop: 80, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
          {[
            { n: 'ฝนทิพย์ ศ.', r: 'Founder / AI research' },
            { n: 'อารียา ก.', r: 'Design / Product' },
            { n: 'ปัณณวิชญ์ ท.', r: 'Engineering' },
          ].map((p, i) => {
            const h = (160 + i * 60 + hueShift) % 360;
            return (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{
                  width: 120, height: 120, borderRadius: '50%', margin: '0 auto 16px',
                  background: `conic-gradient(from ${i*60}deg, hsl(${h},70%,55%), hsl(${h+60},70%,60%), hsl(${h+120},70%,55%), hsl(${h},70%,55%))`,
                  padding: 3,
                }}>
                  <div style={{
                    width: '100%', height: '100%', borderRadius: '50%',
                    background: `linear-gradient(135deg, hsl(${h},50%,20%), hsl(${h+60},50%,10%))`,
                    display: 'grid', placeItems: 'center',
                    fontSize: 36, color: `hsl(${h},70%,75%)`, fontWeight: 300,
                  }}>{p.n[0]}</div>
                </div>
                <div style={{ fontSize: 16, color: '#fff', fontWeight: 500 }}>{p.n}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{p.r}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ============ LOGIN / SIGNUP ============
const AuthPage = ({ hueShift, mode = 'login', onAuth }) => {
  return (
    <div style={{ paddingTop: 110, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '110px 24px 40px' }}>
      <div style={{
        width: '100%', maxWidth: 440,
        padding: 40, borderRadius: 24,
        background: 'rgba(15,23,42,0.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(18px)',
        boxShadow: '0 40px 80px -20px rgba(0,0,0,0.7)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="xdreamer-logo.png" alt="X-DREAMER" style={{
            width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px', display: 'block',
            boxShadow: `0 0 40px hsla(${270+hueShift},70%,50%,0.5)`, objectFit: 'cover',
          }} />
          <div style={{ fontSize: 22, color: '#fff', fontWeight: 300 }}>
            {mode === 'login' ? 'ยินดีต้อนรับกลับ' : 'เริ่มทอความฝันแรก'}
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
            {mode === 'login' ? 'เข้าสู่ปราสาทของคุณ' : 'ฟรีตลอดชีพ · 50 งาน/เดือน'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'signup' && (
            <InputField label="ชื่อที่จะแสดง" placeholder="ฝันทิพย์" />
          )}
          <InputField label="อีเมล" placeholder="you@example.com" type="email" />
          <InputField label="รหัสผ่าน" placeholder="••••••••" type="password" />

          <button onClick={() => onAuth && onAuth()} style={{
            marginTop: 12, padding: '14px', borderRadius: 12,
            background: `linear-gradient(135deg, hsl(${160+hueShift},70%,50%), hsl(${270+hueShift},70%,55%))`,
            color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 8px', color: '#64748b', fontSize: 11 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            หรือ
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>

          {['Continue with Google', 'Continue with Apple', 'Continue with LINE'].map(s => (
            <button key={s} onClick={() => onAuth && onAuth()} style={{
              padding: '12px', borderRadius: 12,
              background: 'rgba(255,255,255,0.04)', color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, cursor: 'pointer',
            }}>{s}</button>
          ))}

          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#94a3b8' }}>
            {mode === 'login' ? 'ยังไม่มีบัญชี? ' : 'มีบัญชีแล้ว? '}
            <a href={`#${mode === 'login' ? 'signup' : 'login'}`} style={{ color: '#a5f3fc', textDecoration: 'none' }}>
              {mode === 'login' ? 'สมัครฟรี' : 'เข้าสู่ระบบ'}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

const InputField = ({ label, type = 'text', placeholder }) => (
  <div>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{label}</div>
    <input type={type} placeholder={placeholder} style={{
      width: '100%', padding: '12px 14px', borderRadius: 10,
      background: 'rgba(2,6,23,0.5)', color: '#f1f5f9',
      border: '1px solid rgba(255,255,255,0.1)', fontSize: 14,
      fontFamily: 'inherit', outline: 'none',
    }} />
  </div>
);

// ============ DOCS ============
const DocsPage = ({ hueShift }) => {
  const [active, setActive] = React.useState('Getting started');
  const sections = [
    { group: 'Intro', items: ['Getting started', 'Concepts', 'Your first weave'] },
    { group: 'Models', items: ['loom-v4.2', 'loom-pro', 'loom-fast', 'loom-video', 'loom-3d'] },
    { group: 'API', items: ['Authentication', 'Generate endpoint', 'Webhooks', 'Rate limits', 'Errors'] },
    { group: 'Guides', items: ['Prompt crafting', 'Negative prompts', 'Seeds & reproducibility'] },
  ];
  return (
    <div className="rp-docs" style={{ paddingTop: 80, minHeight: '100vh', display: 'grid', gridTemplateColumns: '260px 1fr 240px' }}>
      <aside style={{
        borderRight: '1px solid rgba(255,255,255,0.06)', padding: 32,
        height: 'calc(100vh - 80px)', overflowY: 'auto',
      }}>
        <input placeholder="ค้นหา docs..." style={{
          width: '100%', padding: '10px 12px', borderRadius: 10, marginBottom: 24,
          background: 'rgba(2,6,23,0.5)', color: '#f1f5f9',
          border: '1px solid rgba(255,255,255,0.1)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
        }} />
        {sections.map(s => (
          <div key={s.group} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>{s.group}</div>
            {s.items.map(it => (
              <div key={it} onClick={() => setActive(it)} style={{
                padding: '7px 10px', borderRadius: 8, fontSize: 13,
                color: active === it ? '#fff' : '#94a3b8',
                background: active === it ? `hsla(${220+hueShift},60%,50%,0.15)` : 'transparent',
                borderLeft: active === it ? `2px solid hsl(${220+hueShift},70%,60%)` : '2px solid transparent',
                cursor: 'pointer',
              }}>{it}</div>
            ))}
          </div>
        ))}
      </aside>

      <main style={{ padding: '48px 60px', maxWidth: 820, height: 'calc(100vh - 80px)', overflowY: 'auto' }}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Intro / {active}</div>
        <h1 style={{ fontSize: 44, fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', margin: '0 0 20px' }}>{active}</h1>
        <p style={{ fontSize: 17, color: 'rgba(203,213,225,0.85)', lineHeight: 1.7, fontWeight: 300 }}>
          ยินดีต้อนรับสู่ AETHER — แพลตฟอร์มทอความฝันด้วย AI
          คู่มือนี้จะพาคุณผ่านการทอเส้นใยแรก ตั้งแต่การเขียน prompt จนถึงการ export ผลงานออกมาใช้จริง
        </p>

        <h2 style={{ fontSize: 24, fontWeight: 500, color: '#fff', marginTop: 48, marginBottom: 16 }}>ติดตั้ง</h2>
        <p style={{ color: 'rgba(203,213,225,0.8)', lineHeight: 1.7 }}>
          ใช้ผ่านเว็บได้ทันที หรือเรียกผ่าน API:
        </p>
        <pre style={{
          padding: 20, borderRadius: 12, marginTop: 12,
          background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(255,255,255,0.08)',
          fontSize: 13, fontFamily: 'ui-monospace, monospace', color: '#a5f3fc',
          overflowX: 'auto',
        }}>{`npm install @aether/loom

import { weave } from '@aether/loom'

const result = await weave({
  prompt: 'ปราสาทลอยฟ้าจากเส้นใยแสง',
  model: 'loom-v4.2',
  aspect: '16:9',
})`}</pre>

        <h2 style={{ fontSize: 24, fontWeight: 500, color: '#fff', marginTop: 48, marginBottom: 16 }}>แนวคิดพื้นฐาน</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginTop: 16 }}>
          {[
            { t: 'Thread', d: 'หน่วยย่อยของแนวคิด — คำ, สี, mood' },
            { t: 'Weave', d: 'กระบวนการทอ thread หลายเส้นเป็นผืน' },
            { t: 'Fabric', d: 'ผลลัพธ์สุดท้าย: ภาพ วิดีโอ เสียง หรือ 3D' },
            { t: 'Citadel', d: 'ที่เก็บผลงานของคุณในระบบ' },
          ].map(c => (
            <div key={c.t} style={{
              padding: 16, borderRadius: 12,
              background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: 13, color: '#a5f3fc', fontWeight: 500 }}>{c.t}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </main>

      <aside style={{
        borderLeft: '1px solid rgba(255,255,255,0.06)', padding: 32,
        height: 'calc(100vh - 80px)', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12 }}>On this page</div>
        {['ติดตั้ง', 'แนวคิดพื้นฐาน', 'ตัวอย่าง', 'Next steps'].map((t, i) => (
          <div key={t} style={{
            padding: '6px 0', fontSize: 12,
            color: i === 0 ? '#fff' : '#94a3b8', cursor: 'pointer',
          }}>{t}</div>
        ))}
      </aside>
    </div>
  );
};

Object.assign(window, { StudioPage, DashboardPage, GalleryDetailPage, AboutPage, AuthPage, DocsPage });
