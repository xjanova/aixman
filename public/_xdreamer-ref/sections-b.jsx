// Additional sections: Gallery, Features, HowItWorks, Footer

const { FiberGlyph } = window;

// ===================== GALLERY =====================
const GALLERY_ITEMS = [
  { title: 'ปราสาทในหมอกจันทรา', author: 'นภาลัย', hue: 270, ratio: '3/4', mode: 'image' },
  { title: 'Dream Loop · 12s', author: 'kairos', hue: 200, ratio: '1/1', mode: 'video' },
  { title: 'ผืนป่าความคิด', author: 'จิตรา', hue: 160, ratio: '3/4', mode: 'image' },
  { title: 'Whisper of the Loom', author: 'Theo', hue: 290, ratio: '4/5', mode: 'audio' },
  { title: 'เส้นใยดวงดาว', author: 'พิรุณ', hue: 230, ratio: '3/4', mode: 'image' },
  { title: 'Citadel · 3D scan', author: 'arc_ot', hue: 180, ratio: '1/1', mode: '3d' },
  { title: 'มโนทัศน์สีมรกต', author: 'สิริกาญจน์', hue: 150, ratio: '4/5', mode: 'image' },
  { title: 'Violet Thread Study', author: 'nine', hue: 280, ratio: '3/4', mode: 'image' },
];

const GalleryCard = ({ item, hueShift = 0 }) => {
  const h1 = (item.hue + hueShift) % 360;
  const h2 = (h1 + 50) % 360;
  return (
    <div style={{
      position: 'relative', borderRadius: 18, overflow: 'hidden',
      aspectRatio: item.ratio,
      background: `linear-gradient(135deg, hsl(${h1}, 65%, 14%), hsl(${h2}, 65%, 8%))`,
      border: '1px solid rgba(255,255,255,0.06)',
      cursor: 'pointer',
      transition: 'transform 400ms cubic-bezier(0.4,0,0.2,1), box-shadow 400ms',
      boxShadow: '0 10px 30px -10px rgba(0,0,0,0.6)',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 25px 50px -15px hsla(${h1},80%,55%,0.4)`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 10px 30px -10px rgba(0,0,0,0.6)'; }}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id={`gg${item.hue}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${h1}, 85%, 65%)`} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`hsl(${h2}, 85%, 70%)`} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {Array.from({ length: 18 }).map((_, i) => (
          <path key={i}
            d={`M${-5 + (i * 7) % 110} ${110 + Math.sin(i) * 5} Q${30 + Math.cos(i * 1.3) * 40} ${50 + Math.sin(i * 0.7) * 30} ${105 - (i * 6) % 110} ${-5 + Math.cos(i) * 5}`}
            stroke={`url(#gg${item.hue})`}
            strokeWidth={0.3 + (i % 4) * 0.25}
            fill="none"
            opacity={0.35 + (i % 3) * 0.2}
          />
        ))}
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.7) 100%)',
      }} />
      <div style={{ position: 'absolute', top: 12, left: 14, display: 'flex', gap: 6 }}>
        <span style={{
          fontSize: 10, padding: '3px 8px', borderRadius: 999,
          background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
          color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>{item.mode}</span>
      </div>
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14, color: '#fff' }}>
        <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.2 }}>{item.title}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4, letterSpacing: '0.02em' }}>@{item.author}</div>
      </div>
    </div>
  );
};

const Gallery = ({ hueShift }) => {
  return (
    <section style={{ position: 'relative', padding: '140px 48px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 56, flexWrap: 'wrap', gap: 24 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 14 }}>
            · ผืนผ้าที่ถูกทอในวันนี้
          </div>
          <h2 style={{ fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.05, maxWidth: 720 }}>
            ความฝันที่ <span style={{ fontStyle: 'italic', fontWeight: 200, color: '#c4b5fd' }}>ชุมชนของเรา</span><br />
            ทอขึ้นในช่วง 24 ชั่วโมง
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {['ทั้งหมด', 'Image', 'Video', 'Audio', '3D'].map((t, i) => (
            <button key={t} style={{
              padding: '8px 16px', borderRadius: 999,
              background: i === 0 ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: i === 0 ? '#fff' : 'rgba(226,232,240,0.55)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontSize: 13, cursor: 'pointer',
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div className="rp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {GALLERY_ITEMS.map((item, i) => <GalleryCard key={i} item={item} hueShift={hueShift} />)}
      </div>
    </section>
  );
};

// ===================== FEATURES =====================
const FEATURES = [
  {
    eyebrow: '01 · FABRIC',
    title: 'เส้นใยเจตจำนง',
    desc: 'ควบคุม prompt ผ่านเส้นใยที่ลากต่อเนื่อง — ปรับแสง, อารมณ์, และเรื่องราวได้แบบ real-time โดยไม่ต้องเริ่มใหม่',
    hue: 160,
  },
  {
    eyebrow: '02 · LOOM',
    title: 'ทอแบบข้ามสื่อ',
    desc: 'เริ่มจากภาพแล้วเปลี่ยนเป็นวิดีโอ, เริ่มจากเสียงแล้วแปลงเป็นฉาก 3D โมเดลของเราไหลข้ามสื่อได้เป็นธรรมชาติ',
    hue: 200,
  },
  {
    eyebrow: '03 · DREAM CITADEL',
    title: 'ปราสาทแห่งแนวคิด',
    desc: 'เก็บจินตนาการของคุณเป็นห้องสมุดที่มีชีวิต — แต่ละแนวคิดทอติดกันด้วยเส้นใยความสัมพันธ์ที่ AI มองเห็น',
    hue: 270,
  },
];

const Features = ({ hueShift }) => {
  return (
    <section style={{ position: 'relative', padding: '120px 48px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 72, maxWidth: 720 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 14 }}>
          · สามหลักการ
        </div>
        <h2 style={{ fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          เครื่องทอ<span style={{ fontStyle: 'italic', fontWeight: 200, color: '#6ee7b7' }}> ที่เข้าใจ</span><br />
          ว่าจินตนาการไม่ใช่เส้นตรง
        </h2>
      </div>
      <div className="rp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
        {FEATURES.map((f, i) => {
          const h1 = (f.hue + hueShift) % 360;
          return (
            <div key={i} style={{
              position: 'relative', padding: 32, borderRadius: 22,
              background: 'rgba(15,23,42,0.45)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(18px)',
              overflow: 'hidden',
              transition: 'all 400ms',
              cursor: 'default',
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = `hsla(${h1},70%,60%,0.5)`}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
            >
              <svg width="100%" height="120" style={{ position: 'absolute', top: -20, left: 0, right: 0, opacity: 0.5 }} viewBox="0 0 400 120" preserveAspectRatio="none">
                {Array.from({ length: 14 }).map((_, j) => (
                  <path key={j}
                    d={`M${-20 + j * 30} 130 Q${150 + Math.sin(j) * 50} ${40 + j * 3} ${420 - j * 28} ${-10}`}
                    stroke={`hsl(${h1 + j * 4}, 80%, 65%)`}
                    strokeWidth={0.5 + (j % 3) * 0.3}
                    fill="none" opacity={0.5}
                  />
                ))}
              </svg>
              <div style={{ position: 'relative', marginTop: 90 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.16em', color: `hsl(${h1}, 70%, 70%)`, marginBottom: 14 }}>{f.eyebrow}</div>
                <h3 style={{ fontSize: 28, fontWeight: 500, color: '#fff', marginBottom: 14, letterSpacing: '-0.01em' }}>{f.title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'rgba(203,213,225,0.75)', fontWeight: 300 }}>{f.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ===================== HOW IT WORKS =====================
const HowItWorks = ({ hueShift }) => {
  const steps = [
    { n: '01', t: 'ทอเส้นใยแรก', d: 'เขียน prompt หรือ sketch — ระบบทอเป็นโครงแนวคิด', hue: 160 },
    { n: '02', t: 'เลือกผืนผ้า', d: 'เลือกจาก 4 รูปแบบ — ภาพ, วิดีโอ, เสียง, หรือฉาก 3D', hue: 200 },
    { n: '03', t: 'ปรับผืนผ้า', d: 'ลากเส้นใยเพื่อปรับอารมณ์ สี องค์ประกอบ ได้แบบ live', hue: 240 },
    { n: '04', t: 'ส่งต่อความฝัน', d: 'Export 8K, แชร์ในชุมชน, หรือเก็บในปราสาทส่วนตัว', hue: 280 },
  ];
  return (
    <section style={{ padding: '120px 48px', maxWidth: 1400, margin: '0 auto', position: 'relative' }}>
      <div style={{ marginBottom: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 24 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 14 }}>
            · วิธีการทำงาน
          </div>
          <h2 style={{ fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.05, maxWidth: 720 }}>
            จากความคิด<span style={{ fontStyle: 'italic', fontWeight: 200, color: '#a5b4fc' }}>...สู่ปราสาท</span><br />
            ในสี่จังหวะ
          </h2>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        {/* connecting thread */}
        <svg width="100%" height="4" style={{ position: 'absolute', top: 22, left: 0, right: 0 }} preserveAspectRatio="none" viewBox="0 0 100 4">
          <line x1="0" y1="2" x2="100" y2="2" stroke="url(#thread-grad)" strokeWidth="0.5" strokeDasharray="0.5 1" />
          <defs>
            <linearGradient id="thread-grad" x1="0" x2="1">
              <stop offset="0%" stopColor={`hsl(${160 + hueShift}, 80%, 65%)`} />
              <stop offset="50%" stopColor={`hsl(${220 + hueShift}, 80%, 70%)`} />
              <stop offset="100%" stopColor={`hsl(${285 + hueShift}, 80%, 70%)`} />
            </linearGradient>
          </defs>
        </svg>
        <div className="rp-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 }}>
          {steps.map((s, i) => {
            const h = (s.hue + hueShift) % 360;
            return (
              <div key={i} style={{ position: 'relative' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 999,
                  background: `radial-gradient(circle at 30% 30%, hsl(${h}, 80%, 65%), hsl(${h + 30}, 70%, 45%))`,
                  boxShadow: `0 0 24px hsla(${h}, 80%, 60%, 0.6), inset 0 0 8px rgba(255,255,255,0.3)`,
                  display: 'grid', placeItems: 'center',
                  fontSize: 14, fontWeight: 700, color: '#fff',
                  marginBottom: 24,
                  border: '1px solid rgba(255,255,255,0.2)',
                }}>{s.n}</div>
                <h3 style={{ fontSize: 22, fontWeight: 500, color: '#fff', marginBottom: 10, letterSpacing: '-0.01em' }}>{s.t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(203,213,225,0.7)', fontWeight: 300 }}>{s.d}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// ===================== PRICING =====================
const Pricing = ({ hueShift }) => {
  const tiers = [
    { name: 'ผู้เริ่มฝัน', price: 'ฟรี', note: 'ตลอดชีพ', feats: ['50 งาน/เดือน', 'ความละเอียด 1K', 'ชุมชนสาธารณะ', 'รุ่น loom-mini'], hue: 160 },
    { name: 'นักทอ', price: '฿490', note: '/ เดือน', feats: ['ไม่จำกัดจำนวน', '8K resolution', 'ปราสาทส่วนตัว 500 ชิ้น', 'รุ่น loom-v4.2', 'Video สูงสุด 30 วินาที'], hue: 220, pop: true },
    { name: 'สตูดิโอ', price: '฿2,490', note: '/ เดือน', feats: ['ทุกอย่างใน นักทอ', 'API + webhooks', 'ทีมสูงสุด 10 คน', 'รุ่น loom-pro', 'Commercial license', 'Priority queue'], hue: 280 },
  ];
  return (
    <section style={{ padding: '120px 48px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 64 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.16em', color: '#a5f3fc', textTransform: 'uppercase', marginBottom: 14 }}>· แผนการใช้งาน</div>
        <h2 style={{ fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          เริ่มฟรี — <span style={{ fontStyle: 'italic', fontWeight: 200, color: '#c4b5fd' }}>จ่ายเมื่อความฝันใหญ่ขึ้น</span>
        </h2>
      </div>
      <div className="rp-grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, maxWidth: 1100, margin: '0 auto' }}>
        {tiers.map((t, i) => {
          const h = (t.hue + hueShift) % 360;
          return (
            <div key={i} style={{
              padding: 36, borderRadius: 22, position: 'relative',
              background: t.pop
                ? `linear-gradient(160deg, hsla(${h},60%,20%,0.65), hsla(${h+40},60%,12%,0.65))`
                : 'rgba(15,23,42,0.45)',
              border: t.pop ? `1px solid hsla(${h}, 70%, 55%, 0.5)` : '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(18px)',
              boxShadow: t.pop ? `0 30px 60px -20px hsla(${h}, 70%, 50%, 0.35)` : 'none',
            }}>
              {t.pop && (
                <div style={{
                  position: 'absolute', top: -12, left: 24,
                  padding: '4px 12px', borderRadius: 999,
                  background: `linear-gradient(90deg, hsl(${h}, 80%, 60%), hsl(${h+40}, 80%, 65%))`,
                  fontSize: 11, fontWeight: 600, color: '#fff', letterSpacing: '0.08em',
                }}>ยอดนิยม</div>
              )}
              <div style={{ fontSize: 14, color: '#a5f3fc', letterSpacing: '0.08em', marginBottom: 18 }}>{t.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 28 }}>
                <div style={{ fontSize: 44, fontWeight: 300, color: '#fff', letterSpacing: '-0.02em' }}>{t.price}</div>
                <div style={{ fontSize: 14, color: '#64748b' }}>{t.note}</div>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px' }}>
                {t.feats.map(f => (
                  <li key={f} style={{ fontSize: 14, color: 'rgba(226,232,240,0.8)', marginBottom: 10, display: 'flex', gap: 10, fontWeight: 300 }}>
                    <span style={{ color: `hsl(${h}, 80%, 70%)`, flexShrink: 0 }}>✦</span> {f}
                  </li>
                ))}
              </ul>
              <button style={{
                width: '100%', padding: '14px', borderRadius: 12,
                background: t.pop ? `linear-gradient(135deg, hsl(${h},70%,50%), hsl(${h+40},70%,60%))` : 'rgba(255,255,255,0.05)',
                color: '#fff', border: t.pop ? 'none' : '1px solid rgba(255,255,255,0.15)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>{t.pop ? 'เริ่มทอเลย' : 'เลือกแผนนี้'}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ===================== FOOTER CTA =====================
const FooterCTA = ({ hueShift }) => {
  return (
    <section style={{ padding: '140px 48px 80px', position: 'relative', textAlign: 'center' }}>
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600, borderRadius: '50%',
        background: `radial-gradient(circle, hsla(${220 + hueShift}, 80%, 50%, 0.25), transparent 60%)`,
        filter: 'blur(40px)', pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ fontSize: 'clamp(48px, 7vw, 96px)', fontWeight: 200, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1 }}>
          เริ่มทอความฝัน<br />
          <span style={{ fontStyle: 'italic', background: `linear-gradient(120deg, hsl(${160+hueShift},80%,70%), hsl(${280+hueShift},80%,75%))`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ของคุณวันนี้</span>
        </h2>
        <p style={{ marginTop: 28, fontSize: 18, color: 'rgba(203,213,225,0.75)', fontWeight: 300 }}>
          ฟรี 50 งานทุกเดือน · ไม่ต้องใช้บัตรเครดิต · เริ่มได้ภายใน 30 วินาที
        </p>
        <div style={{ marginTop: 40, display: 'flex', gap: 14, justifyContent: 'center' }}>
          <button style={{
            padding: '16px 32px', borderRadius: 14,
            background: `linear-gradient(135deg, hsl(${160+hueShift}, 70%, 50%) 0%, hsl(${220+hueShift}, 70%, 55%) 50%, hsl(${280+hueShift}, 70%, 60%) 100%)`,
            color: '#fff', border: 'none',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
            boxShadow: `0 20px 40px -10px hsla(${220+hueShift}, 70%, 50%, 0.6)`,
          }}>สร้างบัญชีฟรี  →</button>
          <button style={{
            padding: '16px 28px', borderRadius: 14,
            background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)',
            fontSize: 15, fontWeight: 500, cursor: 'pointer',
          }}>ดู Gallery ทั้งหมด</button>
        </div>
      </div>
      <div style={{
        marginTop: 120, paddingTop: 40, borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 13,
        maxWidth: 1300, marginLeft: 'auto', marginRight: 'auto', flexWrap: 'wrap', gap: 20,
      }}>
        <div>© 2026 AETHER Loom · ทอด้วย ♥ ในเชียงใหม่</div>
        <div style={{ display: 'flex', gap: 24 }}>
          <a style={{ color: 'inherit' }}>Terms</a>
          <a style={{ color: 'inherit' }}>Privacy</a>
          <a style={{ color: 'inherit' }}>Status</a>
          <a style={{ color: 'inherit' }}>Docs</a>
          <a style={{ color: 'inherit' }}>GitHub</a>
        </div>
      </div>
    </section>
  );
};

Object.assign(window, { Gallery, GalleryCard, Features, HowItWorks, Pricing, FooterCTA });
