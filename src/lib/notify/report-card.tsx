import { ImageResponse } from 'next/og';

/**
 * Picture cards for admin alerts on Telegram — the owner asked for reports
 * that look good at a glance, not a wall of text.
 *
 * Rendered with next/og (Satori + resvg), so there is no browser to run and no
 * new dependency. Its bundled font has no Thai, so Kanit (Thai and Latin, OFL)
 * is fetched from Google Fonts for exactly the characters on the card and kept
 * in memory. If the font or the render fails, the caller falls back to text.
 *
 * Satori lays out with flexbox only: every element with more than one child
 * needs `display: flex`, and there is no grid.
 */

const W = 1200;
const H = 675;
const FONT = 'Kanit';

const C = {
  bgFrom: '#070b1a',
  bgTo: '#1c1038',
  text: '#e2e8f0',
  muted: '#94a3b8',
  faint: 'rgba(255,255,255,0.07)',
  line: 'rgba(255,255,255,0.12)',
  ok: '#34d399',
  low: '#fbbf24',
  bad: '#f87171',
  accent: '#a78bfa',
  spend: '#f59e0b',
};

/** Always requested, so numbers render whatever the card says. */
const BASE_CHARS = '0123456789$฿.,-+−%:/()·—–<>≤ ';

const fontCache = new Map<string, ArrayBuffer>();

async function loadKanit(weight: 400 | 700, text: string): Promise<ArrayBuffer> {
  const chars = [...new Set(text + BASE_CHARS)].sort().join('');
  const key = `${weight}:${chars}`;
  const hit = fontCache.get(key);
  if (hit) return hit;

  const cssUrl = `https://fonts.googleapis.com/css2?family=${FONT}:wght@${weight}&text=${encodeURIComponent(chars)}`;
  const css = await fetch(cssUrl, { signal: AbortSignal.timeout(10_000) }).then((r) => {
    if (!r.ok) throw new Error(`Google Fonts CSS HTTP ${r.status}`);
    return r.text();
  });
  const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
  if (!src) throw new Error('Google Fonts returned no TrueType source for Kanit');
  const data = await fetch(src, { signal: AbortSignal.timeout(15_000) }).then((r) => {
    if (!r.ok) throw new Error(`Kanit font HTTP ${r.status}`);
    return r.arrayBuffer();
  });

  if (fontCache.size > 40) fontCache.clear();
  fontCache.set(key, data);
  return data;
}

async function render(element: React.ReactElement, text: string): Promise<Buffer> {
  const [regular, bold] = await Promise.all([loadKanit(400, text), loadKanit(700, text)]);
  const res = new ImageResponse(element, {
    width: W,
    height: H,
    fonts: [
      { name: FONT, data: regular, weight: 400, style: 'normal' },
      { name: FONT, data: bold, weight: 700, style: 'normal' },
    ],
  });
  return Buffer.from(await res.arrayBuffer());
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;
const thb = (n: number) => `${n < 0 ? '−' : ''}฿${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

function bangkokTime(at: Date): string {
  return at.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: W,
        height: H,
        display: 'flex',
        flexDirection: 'column',
        padding: 52,
        backgroundImage: `linear-gradient(135deg, ${C.bgFrom} 0%, ${C.bgTo} 100%)`,
        color: C.text,
        fontFamily: FONT,
      }}
    >
      {children}
    </div>
  );
}

function Header({ left, pill, pillColor }: { left: string; pill: string; pillColor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 14, height: 14, borderRadius: 7, background: pillColor, marginRight: 14 }} />
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: C.muted }}>{left}</div>
      </div>
      <div
        style={{
          display: 'flex',
          padding: '8px 24px',
          borderRadius: 999,
          border: `2px solid ${pillColor}`,
          color: pillColor,
          fontSize: 26,
          fontWeight: 700,
        }}
      >
        {pill}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        flexBasis: 0,
        padding: '18px 22px',
        borderRadius: 18,
        background: C.faint,
        border: `1px solid ${C.line}`,
        marginRight: 16,
      }}
    >
      <div style={{ fontSize: 22, color: C.muted }}>{label}</div>
      {/* Four tiles share 1100 px: a long value like "$3.46 / $10.00" wraps
          at the tile's usual size, so it steps down instead. */}
      <div style={{ fontSize: value.length > 9 ? 28 : 38, fontWeight: 700, color: color ?? C.text, marginTop: value.length > 9 ? 8 : 0 }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance alert
// ---------------------------------------------------------------------------

export interface BalanceCardInput {
  state: 'ok' | 'low' | 'insufficient';
  usd: number;
  lowBelowUsd: number;
  insufficientAtOrBelowUsd: number;
  queued: number;
  liveWorkers: number;
  spentTodayUsd: number;
  dailyBudgetUsd: number;
  /** Hours left at the current burn, when anything is burning. */
  runwayHours: number | null;
  at: Date;
}

const STATE_LOOK = {
  ok: { color: C.ok, pill: 'กลับมาปกติ' },
  low: { color: C.low, pill: 'ยอดเงินใกล้หมด' },
  insufficient: { color: C.bad, pill: 'ไม่พอเช่าเครื่อง' },
} as const;

export async function renderBalanceCard(d: BalanceCardInput): Promise<Buffer> {
  const look = STATE_LOOK[d.state];
  // Scale the gauge so both thresholds sit well inside it.
  const max = Math.max(d.lowBelowUsd * 2, d.usd * 1.15, 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  const labels = {
    // The best-funded vendor's balance (gpu-balance.ts): what a rental can draw on.
    title: 'ยอดเงินผู้ให้เช่า GPU',
    insufficient: `เช่าไม่ได้ ≤ ${usd(d.insufficientAtOrBelowUsd)}`,
    low: `เตือน < ${usd(d.lowBelowUsd)}`,
  };
  const stats: [string, string][] = [
    ['งานรอคิว', String(d.queued)],
    ['เครื่องที่เปิด', String(d.liveWorkers)],
    ['ใช้ไปวันนี้', `${usd(d.spentTodayUsd)} / ${usd(d.dailyBudgetUsd)}`],
    ['พอใช้อีก', d.runwayHours != null ? `${d.runwayHours} ชม.` : '—'],
  ];
  const footer = [bangkokTime(d.at), 'ai.xman4289.com/admin/gpu'];

  const element = (
    <Frame>
      <Header left="AIXMAN · GPU" pill={look.pill} pillColor={look.color} />

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34 }}>
        <div style={{ fontSize: 30, color: C.muted }}>{labels.title}</div>
        <div style={{ fontSize: 150, fontWeight: 700, color: look.color, lineHeight: 1.05 }}>{usd(d.usd)}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22 }}>
        <div style={{ position: 'relative', display: 'flex', height: 24, borderRadius: 12, background: C.faint }}>
          <div
            style={{
              width: `${pct(d.usd)}%`,
              height: 24,
              borderRadius: 12,
              backgroundImage: `linear-gradient(90deg, ${look.color}, ${C.accent})`,
            }}
          />
          <div style={{ position: 'absolute', left: `${pct(d.insufficientAtOrBelowUsd)}%`, top: -8, width: 4, height: 40, background: C.bad }} />
          <div style={{ position: 'absolute', left: `${pct(d.lowBelowUsd)}%`, top: -8, width: 4, height: 40, background: C.low }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 12, fontSize: 22 }}>
          <div style={{ width: 4, height: 22, background: C.bad, marginRight: 10 }} />
          <div style={{ color: C.bad, marginRight: 36 }}>{labels.insufficient}</div>
          <div style={{ width: 4, height: 22, background: C.low, marginRight: 10 }} />
          <div style={{ color: C.low }}>{labels.low}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexGrow: 1 }} />

      <div style={{ display: 'flex' }}>
        {stats.map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, fontSize: 20, color: C.muted }}>
        <div>{footer[0]}</div>
        <div>{footer[1]}</div>
      </div>
    </Frame>
  );

  const text = [look.pill, 'AIXMAN · GPU', labels.title, labels.insufficient, labels.low, ...stats.flat(), ...footer].join('');
  return render(element, text);
}

// ---------------------------------------------------------------------------
// Daily report
// ---------------------------------------------------------------------------

export interface DailyPoint {
  /** YYYY-MM-DD */
  date: string;
  jobs: number;
  failed: number;
  spendUsd: number;
  revenueThb: number;
  credits: number;
}

export interface DailyCardInput {
  day: DailyPoint;
  /** Oldest first; the last one is `day` or today. */
  series: DailyPoint[];
  usdToThb: number;
  balanceUsd: number | null;
  balanceState: 'ok' | 'low' | 'insufficient' | 'unknown';
  queued: number;
  at: Date;
}

function thaiDate(key: string, withYear: boolean): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

function thaiWeekday(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'short' });
}

export async function renderDailyCard(d: DailyCardInput): Promise<Buffer> {
  const costThb = d.day.spendUsd * d.usdToThb;
  const profit = d.day.revenueThb - costThb;
  const balanceColor =
    d.balanceState === 'insufficient' ? C.bad : d.balanceState === 'low' ? C.low : d.balanceState === 'ok' ? C.ok : C.muted;

  const tiles: [string, string, string, string?][] = [
    ['คลิปสำเร็จ', String(d.day.jobs), `ล้ม ${d.day.failed}`],
    ['ค่าเครื่อง GPU', usd(d.day.spendUsd), thb(costThb)],
    ['รายได้', thb(d.day.revenueThb), `${d.day.credits.toLocaleString('en-US')} เครดิต`],
    ['กำไร', thb(profit), profit >= 0 ? 'บวก' : 'ติดลบ', profit >= 0 ? C.ok : C.bad],
  ];

  const maxJobs = Math.max(1, ...d.series.map((p) => p.jobs));
  const maxSpend = Math.max(0.01, ...d.series.map((p) => p.spendUsd));
  const CHART_H = 170;
  const bars = d.series.map((p) => ({
    key: p.date,
    jobs: p.jobs,
    spend: p.spendUsd,
    jobsH: Math.round((p.jobs / maxJobs) * CHART_H),
    spendH: Math.round((p.spendUsd / maxSpend) * CHART_H),
    label: `${thaiWeekday(p.date)} ${new Date(`${p.date}T00:00:00`).getDate()}`,
  }));

  const title = `รายงานประจำวัน · ${thaiDate(d.day.date, true)}`;
  const legend = ['คลิป', 'ค่าเครื่อง $', '7 วันล่าสุด'];
  const footerLeft = `ยอดเงิน GPU ${d.balanceUsd != null ? usd(d.balanceUsd) : '—'} · งานรอคิว ${d.queued}`;
  const footerRight = bangkokTime(d.at);

  const element = (
    <Frame>
      <Header left="AIXMAN · GPU" pill={title} pillColor={C.accent} />

      <div style={{ display: 'flex', marginTop: 30 }}>
        {tiles.map(([label, value, sub, color]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              flexBasis: 0,
              padding: '18px 22px',
              borderRadius: 18,
              background: C.faint,
              border: `1px solid ${C.line}`,
              marginRight: 16,
            }}
          >
            <div style={{ fontSize: 22, color: C.muted }}>{label}</div>
            <div style={{ fontSize: 46, fontWeight: 700, color: color ?? C.text, lineHeight: 1.1 }}>{value}</div>
            <div style={{ fontSize: 20, color: C.muted }}>{sub}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          marginTop: 22,
          padding: '16px 24px',
          borderRadius: 18,
          background: C.faint,
          border: `1px solid ${C.line}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: C.muted }}>
          <div>{legend[2]}</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: C.accent, marginRight: 8 }} />
            <div style={{ marginRight: 22 }}>{legend[0]}</div>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: C.spend, marginRight: 8 }} />
            <div>{legend[1]}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', flexGrow: 1, marginTop: 8 }}>
          {bars.map((b) => (
            <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: 6 }}>
                  <div style={{ fontSize: 18, color: C.text }}>{String(b.jobs)}</div>
                  <div style={{ width: 34, height: Math.max(3, b.jobsH), borderRadius: 8, background: C.accent }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 18, color: C.spend }}>{b.spend.toFixed(1)}</div>
                  <div style={{ width: 34, height: Math.max(3, b.spendH), borderRadius: 8, background: C.spend }} />
                </div>
              </div>
              <div style={{ fontSize: 18, color: C.muted, marginTop: 6 }}>{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 22 }}>
        <div style={{ color: balanceColor }}>{footerLeft}</div>
        <div style={{ color: C.muted }}>{footerRight}</div>
      </div>
    </Frame>
  );

  const text = [
    'AIXMAN · GPU',
    title,
    ...tiles.flatMap(([a, b, c]) => [a, b, c]),
    ...legend,
    ...bars.map((b) => b.label),
    footerLeft,
    footerRight,
  ].join('');
  return render(element, text);
}
