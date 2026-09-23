"use client";

/**
 * /admin/workflows — every ComfyUI workflow the site renders with.
 *
 * One card per catalogue entry. Opening one shows what it is (template,
 * weights, hardware, price, how it has been doing), exactly what it sends to a
 * worker (a dry run against the stored schema — nothing is rented), and lets
 * an admin tune it: the entry's own knobs, quality modes and their prices,
 * prompt affixes, raw node inputs, or a whole custom graph. Every save is a
 * version that can be rolled back, and a new one starts as "admins only" so a
 * bad value costs one test render, not a customer's.
 *
 * No try/catch in any component here: React Compiler gives up on a component
 * that has one with a value block inside, so every request goes through `api`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Eye,
  FlaskConical,
  History,
  Layers,
  Music,
  Image as ImageIcon,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  Wand2,
  Workflow,
  XCircle,
} from "lucide-react";

// ─── Types (mirroring /api/admin/workflows) ────────────────────────────

type TunableValue = number | string | boolean;
type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

interface Tunable {
  id: string;
  label: string;
  help: string;
  type: "int" | "float" | "bool" | "choice" | "text";
  default: TunableValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  maxLength?: number;
  group?: "quality" | "prompt" | "sampler" | "advanced";
  risky?: boolean;
  value: TunableValue;
  overridden: boolean;
}

interface QualityMode {
  id: string;
  label: string;
  description: string;
  creditsMultiplier: number;
  isDefault?: boolean;
  adminOnly?: boolean;
}

interface NodeInputOverride {
  nodeId: string;
  input: string;
  value: unknown;
  note?: string;
}

interface WorkflowOverride {
  enabled: boolean;
  rollout: "admin" | "all";
  tuning?: Record<string, TunableValue>;
  nodeInputs?: NodeInputOverride[];
  promptPrefix?: string;
  promptSuffix?: string;
  quality?: Record<string, { creditsMultiplier?: number; public?: boolean }>;
  customGraph?: { enabled: boolean; graph: ApiGraph } | null;
}

interface StoredWorkflow {
  override: WorkflowOverride;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  note: string | null;
}

interface Summary {
  key: string;
  name: string;
  kind: "video" | "image" | "audio" | "lipsync";
  outputKind: "video" | "image" | "audio";
  description: string;
  source: { file: string; title: string; url?: string } | null;
  nodeCount: number;
  classes: string[];
  weightsGb: number;
  minVramGb: number;
  diskGb: number;
  minArch: string | null;
  customNodes: { repo: string; ref?: string }[];
  pricing: { creditsPerUnit: number; costPerUnit: number; durationCurve?: { unitSeconds: number; exponent: number } };
  qualityModes: QualityMode[];
  tunableCount: number;
  models: { id: number; name: string; isActive: boolean; readiness: string; readinessNote: string | null; failureStreak: number; creditsPerUnit: number }[];
  override: {
    version: number;
    updatedAt: string;
    updatedBy: string | null;
    note: string | null;
    enabled: boolean;
    rollout: "admin" | "all";
    tuned: number;
    nodeInputs: number;
    prompt: boolean;
    customGraph: boolean;
  } | null;
  stats: {
    completed30d: number;
    failed30d: number;
    running: number;
    queued: number;
    avgGpuSeconds: number | null;
    lastRunAt: string | null;
    lastError: string | null;
  };
  lastGraphAt: string | null;
  comfyRef: string;
}

interface TemplateNode {
  id: string;
  type: string;
  title: string | null;
  mode: number;
  widgets: unknown[];
  editorOnly: boolean;
  group: string | null;
}

interface BindingRow {
  nodeId: string;
  input: string;
  value: unknown;
  source: "job" | "tunable" | "fixed";
  optional: boolean;
  link: boolean;
}

interface SchemaInfo {
  source: "worker" | "baseline";
  capturedAt: string;
  comfyVersion: string;
  gpuModel: string | null;
  classCount: number;
}

interface Preview {
  ok: boolean;
  graph: ApiGraph | null;
  warnings: string[];
  error: string | null;
  custom: boolean;
  schema: SchemaInfo;
  job: { prompt: string; width: number; height: number; durationSeconds: number; quality?: string; resolution?: string; firstFrame: boolean; lastFrame: boolean };
  fieldErrors?: string[];
}

interface LastGraph {
  capturedAt: string;
  generationId: number;
  jobId: number;
  workerId: number;
  gpuModel: string | null;
  overrideVersion: number | null;
  adminRun: boolean;
  custom: boolean;
  warnings: string[];
  graph: ApiGraph;
}

interface Detail {
  summary: Summary;
  tunables: Tunable[];
  stored: StoredWorkflow | null;
  history: StoredWorkflow[];
  templateNodes: TemplateNode[];
  bindings: BindingRow[];
  injected: { id: string; classType: string; inputs: Record<string, unknown> }[];
  downloads: { repo: string; file: string; dest: string; bytes: number; as?: string }[];
  lastGraph: LastGraph | null;
  preview: Preview;
  video: { firstFrame?: boolean; lastFrame?: boolean; resolutions?: { id: string; label: string; aspects: string[]; isDefault?: boolean; adminOnly?: boolean }[] } | null;
  needsAudio: boolean;
}

// ─── Requests (errors as values — see the note at the top) ─────────────

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body: Record<string, unknown> | null };

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    return { ok: false, status: 0, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", body: null };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const error = typeof body?.error === "string" ? body.error : `ผิดพลาด (HTTP ${res.status})`;
    return { ok: false, status: res.status, error, body };
  }
  return { ok: true, data: body as T };
}

// ─── Draft (the editable form of an override) ──────────────────────────

interface Draft {
  enabled: boolean;
  rollout: "admin" | "all";
  tuning: Record<string, string | boolean>;
  quality: Record<string, { creditsMultiplier: string; public: boolean }>;
  promptPrefix: string;
  promptSuffix: string;
  nodeInputs: { nodeId: string; input: string; value: string; note: string }[];
  customEnabled: boolean;
  customGraph: string;
  note: string;
}

function valueText(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** A typed value from what was typed: JSON when it parses (0.9, true, ["76_3",0]), text otherwise. */
function parseValue(text: string): unknown {
  const t = text.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

function draftFrom(detail: Detail): Draft {
  const o = detail.stored?.override;
  return {
    enabled: o?.enabled ?? true,
    rollout: o?.rollout ?? "admin",
    tuning: Object.fromEntries(detail.tunables.map((t) => [t.id, typeof t.value === "boolean" ? t.value : String(t.value)])),
    quality: Object.fromEntries(
      detail.summary.qualityModes.map((m) => [m.id, { creditsMultiplier: String(m.creditsMultiplier), public: !m.adminOnly }])
    ),
    promptPrefix: o?.promptPrefix ?? "",
    promptSuffix: o?.promptSuffix ?? "",
    nodeInputs: (o?.nodeInputs ?? []).map((r) => ({ nodeId: r.nodeId, input: r.input, value: valueText(r.value), note: r.note ?? "" })),
    customEnabled: o?.customGraph?.enabled ?? false,
    customGraph: o?.customGraph?.graph ? JSON.stringify(o.customGraph.graph, null, 2) : "",
    note: "",
  };
}

function overrideFrom(draft: Draft, tunables: Tunable[]): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    rollout: draft.rollout,
    tuning: Object.fromEntries(
      tunables.map((t) => {
        const raw = draft.tuning[t.id];
        return [t.id, t.type === "int" || t.type === "float" ? (raw === "" ? "" : Number(raw)) : raw];
      })
    ),
    quality: Object.fromEntries(
      Object.entries(draft.quality).map(([id, q]) => [id, { creditsMultiplier: Number(q.creditsMultiplier), public: q.public }])
    ),
    promptPrefix: draft.promptPrefix,
    promptSuffix: draft.promptSuffix,
    nodeInputs: draft.nodeInputs
      .filter((r) => r.nodeId.trim() || r.input.trim())
      .map((r) => ({ nodeId: r.nodeId.trim(), input: r.input.trim(), value: parseValue(r.value), note: r.note })),
    customGraph: draft.customGraph.trim() ? { enabled: draft.customEnabled, graph: draft.customGraph } : null,
  };
}

// ─── Small pieces ──────────────────────────────────────────────────────

const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, lipsync: Video } as const;
const KIND_LABEL = { video: "วิดีโอ", image: "ภาพ", audio: "เพลง/เสียง", lipsync: "ลิปซิงค์" } as const;
const GROUP_LABEL: Record<string, string> = {
  quality: "คุณภาพและความเร็ว",
  prompt: "พรอมต์",
  sampler: "Sampler",
  advanced: "ขั้นสูง (ค่าที่ LoRA ถูกกลั่นมา)",
};
const SOURCE_STYLE: Record<BindingRow["source"] | "admin", { label: string; cls: string }> = {
  job: { label: "จากออเดอร์", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-400/30" },
  tunable: { label: "ปรับได้", cls: "bg-violet-500/15 text-violet-300 border-violet-400/30" },
  fixed: { label: "คงที่", cls: "bg-slate-500/15 text-slate-300 border-slate-400/20" },
  admin: { label: "แอดมินตั้ง", cls: "bg-amber-500/15 text-amber-300 border-amber-400/30" },
};

function Pill({ children, cls = "" }: { children: React.ReactNode; cls?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${cls || "bg-surface-light text-muted border-border"}`}>{children}</span>;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function short(v: unknown, max = 90): string {
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
  if (s === undefined) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function isLink(v: unknown): v is [string, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
}

function Section({ title, icon, children, right }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function OverrideBadge({ o }: { o: Summary["override"] }) {
  if (!o || (!o.tuned && !o.nodeInputs && !o.prompt && !o.customGraph)) {
    return <Pill>ค่าเริ่มต้นของแคตตาล็อก</Pill>;
  }
  if (!o.enabled) return <Pill cls="bg-slate-500/15 text-slate-300 border-slate-400/20">ปิดการปรับแต่ง · v{o.version}</Pill>;
  return (
    <Pill cls={o.rollout === "all" ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" : "bg-amber-500/15 text-amber-300 border-amber-400/30"}>
      {o.customGraph ? "กราฟกำหนดเอง" : "ปรับแล้ว"} · v{o.version} · {o.rollout === "all" ? "ใช้กับทุกคน" : "ทดลองเฉพาะแอดมิน"}
    </Pill>
  );
}

function ReadinessPill({ readiness }: { readiness: string }) {
  if (readiness === "ready") return <Pill cls="bg-emerald-500/15 text-emerald-300 border-emerald-400/30">พร้อมขาย</Pill>;
  if (readiness === "tuning") return <Pill cls="bg-amber-500/15 text-amber-300 border-amber-400/30">กำลังปรับแต่ง</Pill>;
  return <Pill cls="bg-slate-500/15 text-slate-300 border-slate-400/20">{readiness}</Pill>;
}

// ─── Page ──────────────────────────────────────────────────────────────

type DetailTab = "overview" | "nodes" | "tune" | "graph" | "history";

export default function AdminWorkflowsPage() {
  const [pageTab, setPageTab] = useState<"workflows" | "assistant">("workflows");
  const [list, setList] = useState<Summary[] | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [tab, setTab] = useState<DetailTab>("overview");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<string>("");

  const loadList = useCallback(async () => {
    setListError("");
    const r = await api<{ workflows: Summary[] }>("/api/admin/workflows");
    if (r.ok) setList(r.data.workflows);
    else setListError(r.error);
  }, []);

  const loadDetail = useCallback(async (key: string) => {
    setDetailError("");
    const r = await api<Detail>(`/api/admin/workflows/${encodeURIComponent(key)}`);
    if (!r.ok) {
      setDetailError(r.error);
      return;
    }
    setDetail(r.data);
    const d = draftFrom(r.data);
    setDraft(d);
    setBaseline(JSON.stringify(d));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadList(); }, [loadList]);

  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  const open = (key: string) => {
    if (key === selected) return;
    if (dirty && !confirm("มีค่าที่แก้ไว้แต่ยังไม่ได้บันทึก — ทิ้งการแก้ไขแล้วเปิด workflow อื่น?")) return;
    setSelected(key);
    setDetail(null);
    setDraft(null);
    setTab("overview");
    loadDetail(key);
  };

  const refresh = () => {
    loadList();
    if (selected) loadDetail(selected);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="w-6 h-6 text-primary-light" /> Workflow ComfyUI
          </h1>
          <p className="text-sm text-muted mt-1 max-w-3xl">
            ทุก workflow ที่ใช้เรนเดอร์ภาพ วิดีโอ และเพลงบนเว็บ — ดูกราฟที่ส่งเข้าเครื่องจริง ปรับค่า ทดลองกับงานของแอดมินก่อน แล้วค่อยเปิดให้ลูกค้า
            ทุกการบันทึกเป็นเวอร์ชันที่ย้อนกลับได้ ไม่ต้อง deploy
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-border">
            {([
              { key: "workflows" as const, label: "Workflow", icon: <Layers className="w-4 h-4" /> },
              { key: "assistant" as const, label: "ผู้ช่วยพรอมต์ AI", icon: <Sparkles className="w-4 h-4" /> },
            ]).map((t) => (
              <button key={t.key} onClick={() => setPageTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm ${pageTab === t.key ? "bg-primary/20 text-white" : "text-muted hover:bg-surface-light"}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
          <button onClick={refresh} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all" title="โหลดใหม่">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {pageTab === "assistant" ? (
        <AssistantPanel workflows={list ?? []} />
      ) : (
        <>
          {listError && <div className="glass rounded-xl p-4 text-sm text-error mb-4">{listError}</div>}
          {!list && !listError && <div className="glass rounded-xl p-8 text-center text-muted">กำลังโหลด…</div>}

          {list && (
            <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}>
              {list.map((w) => (
                <WorkflowCard key={w.key} w={w} active={selected === w.key} onOpen={() => open(w.key)} />
              ))}
            </div>
          )}

          {selected && detailError && <div className="glass rounded-xl p-4 text-sm text-error">{detailError}</div>}
          {selected && !detail && !detailError && <div className="glass rounded-xl p-8 text-center text-muted">กำลังโหลดรายละเอียด…</div>}

          {detail && draft && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-lg font-semibold flex items-center gap-2">
                    {detail.summary.name}
                    <span className="font-mono text-xs text-muted">{detail.summary.key}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <OverrideBadge o={detail.summary.override} />
                    {dirty && <Pill cls="bg-amber-500/15 text-amber-300 border-amber-400/30">มีการแก้ไขที่ยังไม่บันทึก</Pill>}
                  </div>
                </div>
                <div className="flex rounded-lg overflow-hidden border border-border">
                  {([
                    { key: "overview" as const, label: "ภาพรวม", icon: <Eye className="w-4 h-4" /> },
                    { key: "nodes" as const, label: "โหนดและการเชื่อม", icon: <Boxes className="w-4 h-4" /> },
                    { key: "tune" as const, label: "ปรับแต่ง", icon: <Wand2 className="w-4 h-4" /> },
                    { key: "graph" as const, label: "กราฟกำหนดเอง", icon: <Layers className="w-4 h-4" /> },
                    { key: "history" as const, label: "ประวัติ", icon: <History className="w-4 h-4" /> },
                  ]).map((t) => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-sm ${tab === t.key ? "bg-primary/20 text-white" : "text-muted hover:bg-surface-light"}`}>
                      {t.icon}{t.label}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "overview" && <OverviewTab d={detail} />}
              {tab === "nodes" && <NodesTab d={detail} draft={draft} />}
              {(tab === "tune" || tab === "graph") && (
                <EditTabs
                  mode={tab}
                  d={detail}
                  draft={draft}
                  setDraft={setDraft}
                  dirty={dirty}
                  onSaved={() => { loadList(); loadDetail(detail.summary.key); }}
                />
              )}
              {tab === "history" && (
                <HistoryTab d={detail} onChanged={() => { loadList(); loadDetail(detail.summary.key); }} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Cards ─────────────────────────────────────────────────────────────

function WorkflowCard({ w, active, onOpen }: { w: Summary; active: boolean; onOpen: () => void }) {
  const Icon = KIND_ICON[w.kind];
  const total = w.stats.completed30d + w.stats.failed30d;
  const rate = total > 0 ? Math.round((w.stats.completed30d / total) * 100) : null;
  return (
    <button onClick={onOpen}
      className={`text-left glass rounded-xl p-4 transition-all hover:bg-surface-light/40 ${active ? "ring-1 ring-primary/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/15 grid place-items-center shrink-0"><Icon className="w-4 h-4 text-primary-light" /></div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{w.name}</div>
            <div className="text-[11px] text-muted font-mono truncate">{w.key}</div>
          </div>
        </div>
        <Pill>{KIND_LABEL[w.kind]}</Pill>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {w.models.length === 0 ? <Pill cls="bg-slate-500/15 text-slate-300 border-slate-400/20">ยังไม่มีแถวโมเดล</Pill> : w.models.map((m) => <ReadinessPill key={m.id} readiness={m.isActive ? m.readiness : "ปิดอยู่"} />)}
        <OverrideBadge o={w.override} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted">
        <div><div className="text-foreground text-sm font-semibold">{w.nodeCount}</div>โหนด</div>
        <div><div className="text-foreground text-sm font-semibold">{w.weightsGb} GB</div>น้ำหนัก</div>
        <div><div className="text-foreground text-sm font-semibold">{w.minVramGb} GB</div>VRAM ขั้นต่ำ</div>
      </div>
      <div className="mt-3 text-[11px] text-muted">
        30 วัน: สำเร็จ {w.stats.completed30d} · ล้ม {w.stats.failed30d}
        {rate !== null && <> · <span className={rate >= 90 ? "text-success" : rate >= 60 ? "text-warning" : "text-error"}>{rate}%</span></>}
        {w.stats.avgGpuSeconds !== null && <> · เฉลี่ย {w.stats.avgGpuSeconds}s</>}
        {(w.stats.running > 0 || w.stats.queued > 0) && <> · กำลังทำ {w.stats.running} รอ {w.stats.queued}</>}
      </div>
    </button>
  );
}

// ─── Overview ──────────────────────────────────────────────────────────

function OverviewTab({ d }: { d: Detail }) {
  const s = d.summary;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
      <Section title="เกี่ยวกับ workflow นี้" icon={<Workflow className="w-4 h-4 text-primary-light" />}>
        <p className="text-sm text-muted leading-relaxed">{s.description}</p>
        <div className="mt-3 text-sm space-y-1.5">
          <div><span className="text-muted">เทมเพลต:</span> {s.source?.title ?? "—"}</div>
          {s.source?.url && (
            <div><a href={s.source.url} target="_blank" rel="noreferrer" className="text-primary-light hover:underline text-xs break-all">{s.source.url}</a></div>
          )}
          <div><span className="text-muted">ComfyUI ที่ปักเวอร์ชันไว้:</span> <span className="font-mono">{s.comfyRef}</span></div>
          <div><span className="text-muted">ปรับได้:</span> {s.tunableCount} ค่า{s.qualityModes.length > 0 ? ` · โหมดคุณภาพ ${s.qualityModes.length} แบบ` : ""}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.classes.map((c) => <span key={c} className="px-1.5 py-0.5 rounded bg-surface-light text-[10.5px] font-mono text-muted">{c}</span>)}
        </div>
      </Section>

      <Section title="เครื่องและน้ำหนักโมเดล" icon={<Cpu className="w-4 h-4 text-primary-light" />}>
        <div className="grid grid-cols-3 gap-3 text-sm mb-3">
          <div><div className="text-muted text-xs">VRAM ขั้นต่ำ</div>{s.minVramGb} GB</div>
          <div><div className="text-muted text-xs">ดิสก์</div>{s.diskGb} GB</div>
          <div><div className="text-muted text-xs">สถาปัตยกรรม</div>{s.minArch ?? "ampere"}+</div>
        </div>
        <table className="w-full text-xs">
          <thead><tr className="text-muted border-b border-border"><th className="text-left py-1.5">ไฟล์</th><th className="text-left py-1.5">ปลายทาง</th><th className="text-right py-1.5">ขนาด</th></tr></thead>
          <tbody>
            {d.downloads.map((f) => (
              <tr key={`${f.repo}/${f.file}`} className="border-b border-border/40">
                <td className="py-1.5 pr-2"><div className="font-mono break-all">{f.as ?? f.file.split("/").pop()}</div><div className="text-muted">{f.repo}</div></td>
                <td className="py-1.5 font-mono">{f.dest}</td>
                <td className="py-1.5 text-right whitespace-nowrap">{gb(f.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.customNodes.length > 0 && (
          <div className="mt-2 text-xs text-muted">custom nodes: {s.customNodes.map((c) => c.repo).join(", ")}</div>
        )}
      </Section>

      <Section title="ราคาและโหมดคุณภาพ" icon={<Sparkles className="w-4 h-4 text-primary-light" />}>
        <div className="text-sm">
          ฐาน <b>{s.pricing.creditsPerUnit}</b> เครดิต/งาน · ต้นทุนประมาณ ${s.pricing.costPerUnit}
          {s.pricing.durationCurve && <span className="text-muted"> · ราคาโตตามความยาว (ฐาน {s.pricing.durationCurve.unitSeconds}s, ยกกำลัง {s.pricing.durationCurve.exponent})</span>}
        </div>
        {s.qualityModes.length > 0 ? (
          <div className="mt-3 space-y-2">
            {s.qualityModes.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-surface-light/60">
                <div>
                  <div className="text-sm font-medium">{m.label} <span className="text-muted font-mono text-xs">({m.id})</span></div>
                  <div className="text-xs text-muted">{m.description}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm">×{m.creditsMultiplier}</div>
                  {m.adminOnly ? <Pill cls="bg-amber-500/15 text-amber-300 border-amber-400/30">เฉพาะแอดมิน</Pill> : <Pill cls="bg-emerald-500/15 text-emerald-300 border-emerald-400/30">ลูกค้าเห็น</Pill>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted">โมเดลนี้ไม่มีโหมดคุณภาพให้เลือก</div>
        )}
      </Section>

      <Section title="สถานะการใช้งานจริง" icon={<ShieldCheck className="w-4 h-4 text-primary-light" />}>
        <div className="space-y-2">
          {d.summary.models.map((m) => (
            <div key={m.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <div>{m.name} <span className="text-muted text-xs">#{m.id} · {m.creditsPerUnit} เครดิต</span></div>
                {m.readinessNote && <div className="text-xs text-warning mt-0.5">{m.readinessNote}</div>}
                {m.failureStreak > 0 && <div className="text-xs text-error">ล้มติดกัน {m.failureStreak} ครั้ง (3 ครั้งจะถูกปิดรับงาน)</div>}
              </div>
              <ReadinessPill readiness={m.isActive ? m.readiness : "ปิดอยู่"} />
            </div>
          ))}
          {d.summary.models.length === 0 && <div className="text-xs text-muted">ยังไม่ได้สร้างแถวโมเดล — กด &quot;ซิงก์โมเดล&quot; ที่หน้า GPU ที่เช่า</div>}
        </div>
        <div className="mt-3 text-xs text-muted space-y-1">
          <div>30 วันล่าสุด: สำเร็จ {s.stats.completed30d} · ล้ม {s.stats.failed30d}{s.stats.avgGpuSeconds !== null ? ` · ใช้ GPU เฉลี่ย ${s.stats.avgGpuSeconds} วินาที/งาน` : ""}</div>
          <div>สำเร็จล่าสุด: {when(s.stats.lastRunAt)}</div>
          {s.stats.lastError && <div className="text-error break-words">ล้มล่าสุด: {s.stats.lastError}</div>}
        </div>
      </Section>

      <Section title="กราฟล่าสุดที่ส่งเข้าเครื่องจริง" icon={<Play className="w-4 h-4 text-primary-light" />}
        right={d.lastGraph ? <a href={`/api/admin/workflows/${s.key}/export?kind=last`} className="text-xs text-primary-light hover:underline flex items-center gap-1"><Download className="w-3.5 h-3.5" />ดาวน์โหลด</a> : null}>
        {d.lastGraph ? (
          <div className="text-sm space-y-1">
            <div>งาน #{d.lastGraph.generationId} · เครื่อง #{d.lastGraph.workerId} ({d.lastGraph.gpuModel ?? "—"}) · {when(d.lastGraph.capturedAt)}</div>
            <div className="text-xs text-muted">
              {Object.keys(d.lastGraph.graph).length} โหนด · {d.lastGraph.overrideVersion ? `ใช้ค่าปรับแต่ง v${d.lastGraph.overrideVersion}` : "ค่าเริ่มต้นของแคตตาล็อก"}
              {d.lastGraph.adminRun ? " · งานของแอดมิน" : ""}{d.lastGraph.custom ? " · กราฟกำหนดเอง" : ""}
            </div>
            {d.lastGraph.warnings.length > 0 && (
              <ul className="text-xs text-warning list-disc pl-4">{d.lastGraph.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted">ยังไม่มีงานจริงผ่านเข้ามาหลังอัปเดตนี้ — ระบบจะเก็บให้อัตโนมัติเมื่อมีงานแรก</div>
        )}
        <div className="mt-3 text-xs text-muted">
          schema ที่ใช้ตรวจกราฟ: {d.preview.schema.source === "worker" ? `จากเครื่องจริง (${d.preview.schema.gpuModel ?? "—"})` : "ชุดอ้างอิงที่ติดมากับโค้ด"} · ComfyUI {d.preview.schema.comfyVersion} · {d.preview.schema.classCount} คลาส · {when(d.preview.schema.capturedAt)}
        </div>
      </Section>
    </div>
  );
}

// ─── Nodes ─────────────────────────────────────────────────────────────

function bindingIndex(bindings: BindingRow[], draft: Draft): Map<string, BindingRow["source"] | "admin"> {
  const map = new Map<string, BindingRow["source"] | "admin">();
  for (const b of bindings) for (const input of b.input.split("|")) map.set(`${b.nodeId}.${input}`, b.source);
  for (const r of draft.nodeInputs) if (r.nodeId && r.input) map.set(`${r.nodeId}.${r.input}`, "admin");
  return map;
}

function GraphTable({ graph, marks }: { graph: ApiGraph; marks: Map<string, BindingRow["source"] | "admin"> }) {
  const ids = Object.keys(graph).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[720px]">
        <thead>
          <tr className="text-muted border-b border-border">
            <th className="text-left p-2 w-24">โหนด</th>
            <th className="text-left p-2 w-56">คลาส</th>
            <th className="text-left p-2">inputs</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id} className="border-b border-border/40 align-top">
              <td className="p-2 font-mono text-primary-light">{id}</td>
              <td className="p-2 font-mono">{graph[id].class_type}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(graph[id].inputs).map(([k, v]) => {
                    const mark = marks.get(`${id}.${k}`);
                    const style = mark ? SOURCE_STYLE[mark] : null;
                    return (
                      <span key={k} title={mark ? style?.label : undefined}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${style ? style.cls : "border-border text-muted"}`}>
                        <span className="font-mono">{k}</span>
                        <span className="opacity-80 font-mono">{isLink(v) ? `← ${v[0]}:${v[1]}` : `= ${short(v, 70)}`}</span>
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodesTab({ d, draft }: { d: Detail; draft: Draft }) {
  const [showTemplate, setShowTemplate] = useState(false);
  const marks = useMemo(() => bindingIndex(d.bindings, draft), [d.bindings, draft]);
  const key = d.summary.key;
  return (
    <div className="space-y-4">
      <Section title="กราฟที่ระบบจะส่งเข้า ComfyUI (งานตัวอย่าง, ค่าที่บันทึกไว้)" icon={<Boxes className="w-4 h-4 text-primary-light" />}
        right={
          <div className="flex items-center gap-3 text-xs">
            <a href={`/api/admin/workflows/${key}/export?kind=template`} className="text-primary-light hover:underline flex items-center gap-1"><Download className="w-3.5 h-3.5" />เทมเพลต UI (เปิดใน ComfyUI)</a>
            <a href={`/api/admin/workflows/${key}/export?kind=api`} className="text-primary-light hover:underline flex items-center gap-1"><Download className="w-3.5 h-3.5" />กราฟ API</a>
          </div>
        }>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(["job", "tunable", "fixed", "admin"] as const).map((k) => <Pill key={k} cls={SOURCE_STYLE[k].cls}>{SOURCE_STYLE[k].label}</Pill>)}
          <span className="text-[11px] text-muted self-center">สีบอกว่าค่าไหนมาจากออเดอร์ลูกค้า ค่าไหนปรับได้ และค่าไหนแอดมินตั้งทับ</span>
        </div>
        {d.preview.ok && d.preview.graph ? (
          <GraphTable graph={d.preview.graph} marks={marks} />
        ) : (
          <div className="text-sm text-error">สร้างกราฟตัวอย่างไม่ได้: {d.preview.error}</div>
        )}
        {d.preview.warnings.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer">ข้อสังเกตจากการตรวจ ({d.preview.warnings.length})</summary>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">{d.preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
      </Section>

      <Section title="ค่าที่แคตตาล็อกเขียนลงโหนดทุกงาน" icon={<Wand2 className="w-4 h-4 text-primary-light" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[600px]">
            <thead><tr className="text-muted border-b border-border"><th className="text-left p-2">โหนด.input</th><th className="text-left p-2">ที่มา</th><th className="text-left p-2">ค่าในงานตัวอย่าง</th></tr></thead>
            <tbody>
              {d.bindings.map((b) => (
                <tr key={`${b.nodeId}.${b.input}`} className="border-b border-border/40">
                  <td className="p-2 font-mono">{b.nodeId}.{b.input}{b.optional && <span className="text-muted"> (ถ้ามี)</span>}</td>
                  <td className="p-2"><Pill cls={SOURCE_STYLE[b.source].cls}>{SOURCE_STYLE[b.source].label}</Pill></td>
                  <td className="p-2 font-mono break-all">{b.link ? `← ${(b.value as [string, number])[0]}` : short(b.value, 160)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.injected.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-muted mb-1">โหนดที่แคตตาล็อกเพิ่มเข้าไปในเทมเพลต</div>
            <div className="flex flex-wrap gap-1.5">
              {d.injected.map((n) => <Pill key={n.id}><span className="font-mono">{n.id}</span> {n.classType}</Pill>)}
            </div>
          </div>
        )}
      </Section>

      <Section title={`เทมเพลต UI ต้นฉบับ (${d.templateNodes.length} โหนด)`} icon={<Layers className="w-4 h-4 text-primary-light" />}
        right={<button onClick={() => setShowTemplate((v) => !v)} className="text-xs text-primary-light flex items-center gap-1">{showTemplate ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}{showTemplate ? "ซ่อน" : "แสดง"}</button>}>
        {showTemplate ? (
          d.templateNodes.length === 0 ? (
            <div className="text-xs text-muted">workflow นี้เขียนเป็นกราฟ API ในโค้ดโดยตรง ไม่มีเทมเพลต UI — ดูได้ที่ตารางด้านบน</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead><tr className="text-muted border-b border-border"><th className="text-left p-2">id</th><th className="text-left p-2">ชนิด</th><th className="text-left p-2">ค่าในเทมเพลต</th></tr></thead>
                <tbody>
                  {d.templateNodes.map((n) => (
                    <tr key={n.id} className={`border-b border-border/40 align-top ${n.editorOnly || n.mode === 2 ? "opacity-50" : ""}`}>
                      <td className="p-2 font-mono">{n.id}</td>
                      <td className="p-2">
                        <div className="font-mono">{n.type}</div>
                        <div className="text-muted">{n.title ?? ""}{n.group ? ` · ${n.group}` : ""}{n.editorOnly ? " · ใช้ในหน้าจอเท่านั้น" : n.mode === 2 ? " · ปิด (mute)" : n.mode === 4 ? " · bypass" : ""}</div>
                      </td>
                      <td className="p-2 font-mono break-all">{n.widgets.length ? short(n.widgets, 220) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="text-xs text-muted">ไฟล์ workflow ทางการที่ vendored ไว้ในโค้ด — โหนดที่เป็นโน้ต/primitive ถูกตัดออกตอนแปลง</div>
        )}
      </Section>
    </div>
  );
}

// ─── Tune + custom graph ───────────────────────────────────────────────

function TunableField({ t, value, onChange }: { t: Tunable; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const isDefault = typeof value === "boolean" ? value === t.default : value === String(t.default);
  const base = "w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50";
  return (
    <div className="p-3 rounded-lg bg-surface-light/40 border border-border/60">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <label className="text-sm font-medium">{t.label}</label>
        <div className="flex items-center gap-1.5 shrink-0">
          {t.risky && <span title="ค่าเริ่มต้นคือค่าที่โมเดล/LoRA ถูกกลั่นมา — เปลี่ยนเพื่อทดลองเท่านั้น"><AlertTriangle className="w-3.5 h-3.5 text-warning" /></span>}
          {!isDefault && (
            <button onClick={() => onChange(typeof t.default === "boolean" ? t.default : String(t.default))} className="text-[11px] text-primary-light hover:underline">คืนค่าเริ่มต้น</button>
          )}
        </div>
      </div>
      {t.type === "bool" ? (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {value === true ? "เปิด" : "ปิด"}
        </label>
      ) : t.type === "choice" ? (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)} className={base}>
          {(t.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : t.type === "text" ? (
        <textarea value={String(value)} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={t.maxLength} className={`${base} resize-y font-mono text-xs`} />
      ) : (
        <input type="number" value={String(value)} min={t.min} max={t.max} step={t.step ?? (t.type === "int" ? 1 : 0.1)}
          onChange={(e) => onChange(e.target.value)} className={base} />
      )}
      <div className="text-[11px] text-muted mt-1.5 leading-relaxed">
        {t.help}
        <span className="block mt-0.5">ค่าเริ่มต้น: <span className="font-mono">{typeof t.default === "string" ? (t.default === "" ? "(ว่าง)" : t.default) : String(t.default)}</span>{t.min !== undefined && t.max !== undefined ? ` · ช่วง ${t.min}–${t.max}` : ""}</span>
      </div>
    </div>
  );
}

function PreviewBox({ d, draft }: { d: Detail; draft: Draft }) {
  const [params, setParams] = useState({ prompt: "", aspect: d.summary.outputKind === "video" ? "16:9" : "1:1", duration: "5", quality: "", resolution: "", firstFrame: false, lastFrame: false });
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sizes: Record<string, [number, number]> = { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1152, 896], "3:2": [1216, 832] };

  const run = async () => {
    setBusy(true);
    setError("");
    const [w, h] = sizes[params.aspect] ?? [1024, 1024];
    const r = await api<Preview>(`/api/admin/workflows/${d.summary.key}/preview`, {
      method: "POST",
      body: JSON.stringify({
        override: overrideFrom(draft, d.tunables),
        params: {
          prompt: params.prompt || undefined,
          width: w,
          height: h,
          durationSeconds: Number(params.duration) || undefined,
          quality: params.quality || undefined,
          resolution: params.resolution || undefined,
          firstFrame: params.firstFrame,
          lastFrame: params.lastFrame,
        },
      }),
    });
    setBusy(false);
    if (r.ok) setResult(r.data);
    else setError(r.error);
  };

  const input = "p-2 rounded-lg bg-surface-light text-xs focus:outline-none focus:ring-1 focus:ring-primary/50";
  return (
    <Section title="ทดลองสร้างกราฟ (dry run — ไม่เช่าเครื่อง)" icon={<FlaskConical className="w-4 h-4 text-primary-light" />}>
      <div className="flex flex-wrap gap-2 items-end">
        <input value={params.prompt} onChange={(e) => setParams({ ...params, prompt: e.target.value })} placeholder="พรอมต์ทดลอง (เว้นว่าง = ใช้ตัวอย่าง)" className={`${input} flex-1 min-w-[220px]`} />
        {d.summary.outputKind !== "audio" && (
          <select value={params.aspect} onChange={(e) => setParams({ ...params, aspect: e.target.value })} className={input}>
            {Object.keys(sizes).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {d.summary.outputKind === "video" && (
          <select value={params.duration} onChange={(e) => setParams({ ...params, duration: e.target.value })} className={input}>
            {[5, 10, 15].map((s) => <option key={s} value={s}>{s}s</option>)}
          </select>
        )}
        {d.summary.qualityModes.length > 0 && (
          <select value={params.quality} onChange={(e) => setParams({ ...params, quality: e.target.value })} className={input}>
            <option value="">โหมดเริ่มต้น</option>
            {d.summary.qualityModes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        {d.video?.resolutions && (
          <select value={params.resolution} onChange={(e) => setParams({ ...params, resolution: e.target.value })} className={input}>
            <option value="">ความละเอียดเริ่มต้น</option>
            {d.video.resolutions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        )}
        {d.video?.firstFrame && (
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={params.firstFrame} onChange={(e) => setParams({ ...params, firstFrame: e.target.checked, lastFrame: e.target.checked && params.lastFrame })} />ภาพแรก</label>
        )}
        {d.video?.lastFrame && params.firstFrame && (
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={params.lastFrame} onChange={(e) => setParams({ ...params, lastFrame: e.target.checked })} />ภาพสุดท้าย</label>
        )}
        <button onClick={run} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/20 text-sm hover:bg-primary/30 disabled:opacity-50">
          <Eye className="w-4 h-4" />{busy ? "กำลังตรวจ…" : "ดูกราฟที่จะส่ง"}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-error">{error}</div>}
      {result && (
        <div className="mt-3 space-y-2">
          <div className={`flex items-center gap-2 text-sm ${result.ok ? "text-success" : "text-error"}`}>
            {result.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {result.ok ? `ผ่านการตรวจของ ComfyUI ${result.schema.comfyVersion} · ${Object.keys(result.graph ?? {}).length} โหนด${result.custom ? " · กราฟกำหนดเอง" : ""}` : `ไม่ผ่าน: ${result.error}`}
          </div>
          {(result.fieldErrors ?? []).length > 0 && (
            <ul className="text-xs text-error list-disc pl-5">{result.fieldErrors?.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="text-xs text-warning list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {result.graph && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">JSON กราฟ API ({Object.keys(result.graph).length} โหนด)</summary>
              <pre className="mt-2 p-3 rounded-lg bg-black/40 overflow-auto max-h-[420px] text-[11px] leading-relaxed">{JSON.stringify(result.graph, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}

function EditTabs({
  mode, d, draft, setDraft, dirty, onSaved,
}: {
  mode: "tune" | "graph";
  d: Detail;
  draft: Draft;
  setDraft: (d: Draft) => void;
  dirty: boolean;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [canForce, setCanForce] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const groups = useMemo(() => {
    const out = new Map<string, Tunable[]>();
    for (const t of d.tunables) {
      const g = t.group ?? "advanced";
      out.set(g, [...(out.get(g) ?? []), t]);
    }
    return [...out.entries()].sort((a, b) => ["quality", "prompt", "sampler", "advanced"].indexOf(a[0]) - ["quality", "prompt", "sampler", "advanced"].indexOf(b[0]));
  }, [d.tunables]);

  const nodeOptions = useMemo(() => {
    const g = d.preview.graph ?? {};
    return Object.keys(g).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((id) => ({ id, cls: g[id].class_type, inputs: Object.keys(g[id].inputs) }));
  }, [d.preview.graph]);

  const save = async (force: boolean) => {
    if (draft.rollout === "all" && !force && !confirm("บันทึกและใช้กับงานของลูกค้าทุกคนทันที?\n\nแนะนำให้บันทึกแบบ \"ทดลองเฉพาะแอดมิน\" แล้วสั่งงานทดสอบในสตูดิโอก่อน")) return;
    setSaving(true);
    setErrors([]);
    setCanForce(false);
    setSavedMsg("");
    const r = await api<{ stored: StoredWorkflow }>(`/api/admin/workflows/${d.summary.key}`, {
      method: "PUT",
      body: JSON.stringify({ override: overrideFrom(draft, d.tunables), note: draft.note, force }),
    });
    setSaving(false);
    if (!r.ok) {
      const list = Array.isArray(r.body?.errors) ? (r.body?.errors as string[]) : [r.error];
      setErrors(r.status === 422 ? [r.error, ...list] : list);
      setCanForce(r.body?.canForce === true);
      return;
    }
    setSavedMsg(`บันทึกเป็นเวอร์ชัน ${r.data.stored.version} แล้ว`);
    onSaved();
  };

  const loadCurrentGraph = () => {
    if (!d.preview.graph) return;
    if (draft.customGraph.trim() && !confirm("แทนที่กราฟในช่องด้วยกราฟปัจจุบัน?")) return;
    // Start from what the catalogue sends, with the order's values turned back into placeholders.
    const g = JSON.parse(JSON.stringify(d.preview.graph)) as ApiGraph;
    for (const b of d.bindings) {
      if (b.source !== "job") continue;
      const node = g[b.nodeId];
      if (!node) continue;
      for (const input of b.input.split("|")) {
        if (!(input in node.inputs)) continue;
        const name = /seed/.test(input) ? "seed" : /width/.test(input) ? "width" : /height/.test(input) ? "height"
          : /negative/.test(input) || (b.nodeId.endsWith("_7") && input === "text") ? "negative_prompt"
          : /length/.test(input) ? "length" : /lyrics/.test(input) ? "lyrics"
          : /prompt|text|tags|style|caption/.test(input) ? "prompt" : null;
        if (name) node.inputs[input] = `{{${name}}}`;
      }
    }
    set("customGraph", JSON.stringify(g, null, 2));
  };

  const input = "w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50";

  return (
    <div className="space-y-4">
      <Section title="ใช้การปรับแต่งนี้กับใคร" icon={<ShieldCheck className="w-4 h-4 text-primary-light" />}>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            เปิดใช้การปรับแต่ง {draft.enabled ? "" : <span className="text-muted">(ค่าที่บันทึกยังอยู่ แต่เรนเดอร์ตามแคตตาล็อก)</span>}
          </label>
          <div className="flex rounded-lg overflow-hidden border border-border">
            {([
              { v: "admin" as const, label: "ทดลองเฉพาะงานของแอดมิน" },
              { v: "all" as const, label: "ใช้กับลูกค้าทุกคน" },
            ]).map((o) => (
              <button key={o.v} onClick={() => set("rollout", o.v)}
                className={`px-3 py-1.5 text-xs ${draft.rollout === o.v ? (o.v === "all" ? "bg-emerald-500/25 text-white" : "bg-amber-500/25 text-white") : "text-muted hover:bg-surface-light"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-muted mt-2 leading-relaxed">
          ขั้นตอนที่ปลอดภัย: บันทึกแบบ &quot;ทดลองเฉพาะแอดมิน&quot; → เปิดสตูดิโอด้วยบัญชีแอดมินแล้วสั่งงานโมเดลนี้ 1 งาน → ดูผลงานและกราฟล่าสุดที่แท็บภาพรวม → ค่อยเปลี่ยนเป็น &quot;ใช้กับลูกค้าทุกคน&quot;
          (งานที่ล้ม 3 ครั้งติดจะทำให้โมเดลถูกปิดรับงานอัตโนมัติ) · ราคาและการมองเห็นของโหมดคุณภาพมีผลทันทีไม่ขึ้นกับตัวเลือกนี้
        </div>
      </Section>

      {mode === "tune" && (
        <>
          {groups.length === 0 && (
            <div className="glass rounded-xl p-4 text-sm text-muted">workflow นี้ยังไม่มีค่าที่ประกาศให้ปรับ — ใช้ &quot;แก้ค่าโหนดโดยตรง&quot; ด้านล่าง หรือกราฟกำหนดเอง</div>
          )}
          {groups.map(([g, items]) => (
            <Section key={g} title={GROUP_LABEL[g] ?? g} icon={<Wand2 className="w-4 h-4 text-primary-light" />}>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                {items.map((t) => (
                  <TunableField key={t.id} t={t} value={draft.tuning[t.id]} onChange={(v) => set("tuning", { ...draft.tuning, [t.id]: v })} />
                ))}
              </div>
            </Section>
          ))}

          {d.summary.qualityModes.length > 0 && (
            <Section title="โหมดคุณภาพ — ราคาและใครเห็น" icon={<Sparkles className="w-4 h-4 text-primary-light" />}>
              <div className="space-y-2">
                {d.summary.qualityModes.map((m) => {
                  const q = draft.quality[m.id];
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-3 p-2.5 rounded-lg bg-surface-light/40">
                      <div className="flex-1 min-w-[220px]">
                        <div className="text-sm font-medium">{m.label} <span className="text-muted font-mono text-xs">({m.id})</span>{m.isDefault && <span className="text-xs text-muted"> · ค่าเริ่มต้น</span>}</div>
                        <div className="text-xs text-muted">{m.description}</div>
                      </div>
                      <label className="text-xs text-muted flex items-center gap-1.5">ตัวคูณราคา
                        <input type="number" min={0.5} max={10} step={0.1} value={q?.creditsMultiplier ?? "1"}
                          onChange={(e) => set("quality", { ...draft.quality, [m.id]: { ...q, creditsMultiplier: e.target.value } })}
                          className="w-20 p-1.5 rounded bg-surface-light text-sm" />
                      </label>
                      <label className="text-xs flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={q?.public ?? false} disabled={m.isDefault}
                          onChange={(e) => set("quality", { ...draft.quality, [m.id]: { ...q, public: e.target.checked } })} />
                        ลูกค้าเห็นและเลือกได้
                      </label>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="เติมข้อความให้พรอมต์ทุกงาน" icon={<Wand2 className="w-4 h-4 text-primary-light" />}>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              <div>
                <label className="text-xs text-muted mb-1 block">นำหน้า</label>
                <textarea value={draft.promptPrefix} onChange={(e) => set("promptPrefix", e.target.value)} rows={2} className={`${input} resize-y`} placeholder="เช่น Photograph:" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">ต่อท้าย</label>
                <textarea value={draft.promptSuffix} onChange={(e) => set("promptSuffix", e.target.value)} rows={2} className={`${input} resize-y`} placeholder="เช่น masterpiece, sharp focus" />
              </div>
            </div>
            <div className="text-[11px] text-muted mt-2">ใส่ก่อนที่แคตตาล็อกจะจัดรูปพรอมต์ของโมเดลเอง (เช่น magic suffix ของ Qwen, โครงพรอมต์ H3) — ลูกค้าไม่เห็นข้อความนี้</div>
          </Section>

          <Section title="แก้ค่าโหนดโดยตรง (ขั้นสูง)" icon={<Boxes className="w-4 h-4 text-primary-light" />}
            right={<button onClick={() => set("nodeInputs", [...draft.nodeInputs, { nodeId: "", input: "", value: "", note: "" }])} className="flex items-center gap-1 text-xs text-primary-light"><Plus className="w-3.5 h-3.5" />เพิ่มแถว</button>}>
            {draft.nodeInputs.length === 0 ? (
              <div className="text-xs text-muted">ยังไม่มี — ใช้เขียนค่าใดก็ได้ลง input ของโหนดในกราฟ (เขียนทับค่าของแคตตาล็อก) เช่น <span className="font-mono">76_3 · denoise · 0.95</span> · ค่าที่เป็น JSON (ตัวเลข true/false [&quot;โหนด&quot;,0]) จะถูกแปลงชนิดให้</div>
            ) : (
              <div className="space-y-2">
                {draft.nodeInputs.map((row, i) => {
                  const node = nodeOptions.find((n) => n.id === row.nodeId);
                  const update = (patch: Partial<Draft["nodeInputs"][number]>) =>
                    set("nodeInputs", draft.nodeInputs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                  return (
                    <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: "minmax(140px,1.2fr) minmax(120px,1fr) minmax(140px,1.4fr) minmax(120px,1fr) auto" }}>
                      <select value={row.nodeId} onChange={(e) => update({ nodeId: e.target.value, input: "" })} className="p-2 rounded-lg bg-surface-light text-xs font-mono">
                        <option value="">— เลือกโหนด —</option>
                        {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.cls}</option>)}
                        {row.nodeId && !node && <option value={row.nodeId}>{row.nodeId} (ไม่มีในกราฟปัจจุบัน)</option>}
                      </select>
                      <input list={`inputs-${i}`} value={row.input} onChange={(e) => update({ input: e.target.value })} placeholder="input" className="p-2 rounded-lg bg-surface-light text-xs font-mono" />
                      <datalist id={`inputs-${i}`}>{(node?.inputs ?? []).map((n) => <option key={n} value={n} />)}</datalist>
                      <input value={row.value} onChange={(e) => update({ value: e.target.value })} placeholder="ค่า เช่น 0.95 หรือ euler" className="p-2 rounded-lg bg-surface-light text-xs font-mono" />
                      <input value={row.note} onChange={(e) => update({ note: e.target.value })} placeholder="หมายเหตุ" className="p-2 rounded-lg bg-surface-light text-xs" />
                      <button onClick={() => set("nodeInputs", draft.nodeInputs.filter((_, j) => j !== i))} className="p-2 rounded-lg hover:bg-surface-light" title="ลบแถว"><Trash2 className="w-4 h-4 text-error" /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="text-[11px] text-muted mt-2">ถ้าโหนดหรือ input หายไปในอนาคต (เทมเพลตเปลี่ยน) ระบบจะข้ามแถวนั้นและแจ้งเตือน — ไม่ทำให้งานของลูกค้าล้ม</div>
          </Section>
        </>
      )}

      {mode === "graph" && (
        <Section title="กราฟกำหนดเอง (แทนที่ workflow ของแคตตาล็อกทั้งหมด)" icon={<Layers className="w-4 h-4 text-primary-light" />}
          right={d.preview.graph ? <button onClick={loadCurrentGraph} className="text-xs text-primary-light hover:underline">เริ่มจากกราฟปัจจุบัน</button> : null}>
          <div className="text-xs text-muted leading-relaxed mb-3">
            วางกราฟรูปแบบ API ที่ได้จาก ComfyUI (เมนู Workflow → Export (API)) แล้วใส่ตัวแปร <span className="font-mono">{"{{prompt}}"}</span> ตรงที่ต้องการค่าจากออเดอร์
            ระบบตรวจกราฟกับ schema ก่อนบันทึก และถ้าเครื่องจริงรันกราฟนี้ไม่ได้ จะใช้ workflow ของแคตตาล็อกแทนอัตโนมัติพร้อมแจ้งเตือน — ลูกค้าไม่เสียงาน
          </div>
          <label className="flex items-center gap-2 text-sm mb-2 cursor-pointer">
            <input type="checkbox" checked={draft.customEnabled} onChange={(e) => set("customEnabled", e.target.checked)} />
            ใช้กราฟนี้แทนเทมเพลต
          </label>
          <textarea value={draft.customGraph} onChange={(e) => set("customGraph", e.target.value)} rows={18} spellCheck={false}
            placeholder={'{\n  "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "sd_xl_base_1.0.safetensors" } },\n  "2": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["1", 1], "text": "{{prompt}}" } }\n}'}
            className="w-full p-3 rounded-lg bg-black/40 text-[11.5px] font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y" />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted">ตัวแปรที่ใช้ได้</summary>
            <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: "minmax(120px,auto) 1fr" }}>
              {PLACEHOLDERS.map((p) => (
                <div key={p.name} className="contents">
                  <span className="font-mono text-primary-light">{`{{${p.name}}}`}</span>
                  <span className="text-muted">{p.description}</span>
                </div>
              ))}
            </div>
          </details>
        </Section>
      )}

      <PreviewBox d={d} draft={draft} />

      <div className="glass rounded-xl p-4 flex flex-wrap items-center gap-3 sticky bottom-3 z-10">
        <input value={draft.note} onChange={(e) => set("note", e.target.value)} placeholder="บันทึกสั้น ๆ ว่าเปลี่ยนอะไร (แสดงในประวัติ)" className={`${input} flex-1 min-w-[240px]`} maxLength={300} />
        <button onClick={() => save(false)} disabled={saving || !dirty}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-40">
          <Save className="w-4 h-4" />{saving ? "กำลังตรวจและบันทึก…" : "บันทึกเป็นเวอร์ชันใหม่"}
        </button>
        {savedMsg && <span className="text-sm text-success flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{savedMsg}</span>}
        {errors.length > 0 && (
          <div className="w-full text-xs text-error space-y-1">
            {errors.map((e, i) => <div key={i} className="break-words">{e}</div>)}
            {canForce && (
              <button onClick={() => { if (confirm("บันทึกทั้งที่กราฟไม่ผ่านการตรวจ?\n\nงานที่ใช้ค่านี้มีโอกาสล้ม ถ้าตั้งเป็น \"ใช้กับลูกค้าทุกคน\" ลูกค้าจะได้รับเครดิตคืนแต่โมเดลอาจถูกปิดรับงาน")) save(true); }}
                className="mt-1 px-3 py-1.5 rounded-lg bg-error/20 text-error text-xs">บันทึกทั้งที่ไม่ผ่าน</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Mirror of CUSTOM_GRAPH_PLACEHOLDERS (workflow-build.ts), kept client-side so the page needs no server import. */
const PLACEHOLDERS: { name: string; description: string }[] = [
  { name: "prompt", description: "พรอมต์ของลูกค้า (รวมข้อความเติมหน้า/หลังของแอดมินแล้ว)" },
  { name: "negative_prompt", description: "negative prompt ของลูกค้า (ว่างได้)" },
  { name: "width", description: "ความกว้างที่สั่ง (ตัวเลข)" },
  { name: "height", description: "ความสูงที่สั่ง (ตัวเลข)" },
  { name: "seed", description: "seed ของงาน (ตัวเลข)" },
  { name: "steps", description: "สเต็ปที่ผู้สั่งส่งมา (ถ้ามี) ไม่งั้นว่าง" },
  { name: "duration", description: "ความยาวคลิป/เพลง เป็นวินาที" },
  { name: "fps", description: "เฟรมต่อวินาที" },
  { name: "length", description: "จำนวนเฟรมแบบ 17k+5 สำหรับ H3" },
  { name: "first_frame", description: "ชื่อไฟล์ภาพแรกในเครื่อง (ใส่ใน LoadImage)" },
  { name: "last_frame", description: "ชื่อไฟล์ภาพสุดท้ายในเครื่อง" },
  { name: "input_audio", description: "ชื่อไฟล์เสียงที่อัปโหลด (ใส่ใน LoadAudio)" },
  { name: "lyrics", description: "เนื้อเพลง (ว่าง = บรรเลง)" },
  { name: "music_tags", description: "แท็กสไตล์เพลงที่ประกอบจากตัวเลือกของลูกค้า" },
  { name: "quality", description: "โหมดคุณภาพที่ลูกค้าเลือก (id)" },
  { name: "resolution", description: "preset ความละเอียดที่ลูกค้าเลือก (id)" },
];

// ─── History ───────────────────────────────────────────────────────────

function changeSummary(o: WorkflowOverride): string {
  const parts: string[] = [];
  const tuned = Object.keys(o.tuning ?? {}).length;
  if (tuned) parts.push(`ปรับ ${tuned} ค่า`);
  if (o.nodeInputs?.length) parts.push(`แก้โหนด ${o.nodeInputs.length} แถว`);
  if (o.promptPrefix || o.promptSuffix) parts.push("เติมพรอมต์");
  if (o.quality && Object.keys(o.quality).length) parts.push("ปรับโหมดคุณภาพ");
  if (o.customGraph?.enabled) parts.push("กราฟกำหนดเอง");
  if (!parts.length) parts.push("ค่าเริ่มต้นของแคตตาล็อก");
  return `${parts.join(" · ")} · ${o.enabled ? (o.rollout === "all" ? "ใช้กับทุกคน" : "ทดลองเฉพาะแอดมิน") : "ปิดการปรับแต่ง"}`;
}

function HistoryTab({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | "reset" | null>(null);
  const [error, setError] = useState("");
  const versions = [...(d.stored ? [d.stored] : []), ...d.history];

  const rollback = async (version: number) => {
    if (!confirm(`ย้อนกลับไปใช้เวอร์ชัน ${version}?\n\nระบบจะบันทึกเป็นเวอร์ชันใหม่ (ย้อนกลับซ้ำได้)`)) return;
    setBusy(version);
    setError("");
    const r = await api(`/api/admin/workflows/${d.summary.key}/rollback`, { method: "POST", body: JSON.stringify({ version }) });
    setBusy(null);
    if (!r.ok) setError(r.error);
    else onChanged();
  };

  const reset = async () => {
    if (!confirm("คืนค่าเริ่มต้นของแคตตาล็อกให้ workflow นี้?\n\nค่าที่ปรับไว้ทั้งหมดจะไม่ถูกใช้ (ยังย้อนกลับได้จากประวัติ)")) return;
    setBusy("reset");
    setError("");
    const r = await api(`/api/admin/workflows/${d.summary.key}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) setError(r.error);
    else onChanged();
  };

  return (
    <Section title="ประวัติการปรับแต่ง" icon={<History className="w-4 h-4 text-primary-light" />}
      right={
        <div className="flex items-center gap-3">
          {d.stored && <a href={`/api/admin/workflows/${d.summary.key}/export?kind=override`} className="text-xs text-primary-light hover:underline flex items-center gap-1"><Download className="w-3.5 h-3.5" />ส่งออกค่าปัจจุบัน</a>}
          <button onClick={reset} disabled={busy !== null} className="flex items-center gap-1 text-xs text-error disabled:opacity-40"><RotateCcw className="w-3.5 h-3.5" />คืนค่าเริ่มต้นแคตตาล็อก</button>
        </div>
      }>
      {error && <div className="text-xs text-error mb-2">{error}</div>}
      {versions.length === 0 ? (
        <div className="text-sm text-muted">ยังไม่เคยปรับ — workflow นี้เรนเดอร์ตามแคตตาล็อก</div>
      ) : (
        <div className="space-y-2">
          {versions.map((v, i) => (
            <div key={v.version} className={`flex flex-wrap items-start justify-between gap-3 p-3 rounded-lg ${i === 0 && d.stored ? "bg-primary/10 border border-primary/30" : "bg-surface-light/40"}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  เวอร์ชัน {v.version} {i === 0 && d.stored && <span className="text-xs text-primary-light">· ใช้อยู่</span>}
                </div>
                <div className="text-xs text-muted">{when(v.updatedAt)} · {v.updatedBy ?? "—"}</div>
                {v.note && <div className="text-xs mt-1">{v.note}</div>}
                <div className="text-xs text-muted mt-1">{changeSummary(v.override)}</div>
              </div>
              {!(i === 0 && d.stored) && (
                <button onClick={() => rollback(v.version)} disabled={busy !== null}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-light text-xs hover:bg-surface-lighter disabled:opacity-40">
                  <RotateCcw className="w-3.5 h-3.5" />{busy === v.version ? "กำลังย้อนกลับ…" : "ย้อนกลับเป็นเวอร์ชันนี้"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Prompt assistant ──────────────────────────────────────────────────

interface EnhancerConfig {
  provider: "auto" | "openai" | "minimax" | "byteplus" | "pollinations" | "off";
  model: string;
  h3ContextIr: boolean;
  hourlyLimit: number;
  instructions: { image: string; video: string; audio: string };
}

interface EnhancerState {
  config: EnhancerConfig;
  keys: Record<string, boolean>;
  defaults: { config: EnhancerConfig; models: Record<string, string> };
}

const PROVIDER_LABEL: Record<EnhancerConfig["provider"], string> = {
  auto: "อัตโนมัติ (OpenAI → MiniMax → BytePlus ตัวแรกที่มีคีย์)",
  openai: "OpenAI",
  minimax: "MiniMax",
  byteplus: "BytePlus ModelArk",
  pollinations: "Pollinations (ฟรี ไม่ต้องใช้คีย์ — ส่งพรอมต์ไปบุคคลที่สาม)",
  off: "ปิด — ใช้กฎพื้นฐานอย่างเดียว",
};

function AssistantPanel({ workflows }: { workflows: Summary[] }) {
  const [state, setState] = useState<EnhancerState | null>(null);
  const [cfg, setCfg] = useState<EnhancerConfig | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState({ prompt: "แมวส้มนั่งบนหลังคาวัดตอนพระอาทิตย์ตก", kind: "image", modelKey: "", videoMode: "t2v" });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ prompt: string; source: string; engine: string; fallbackReason?: string; ms: number } | null>(null);

  const load = useCallback(async () => {
    const r = await api<EnhancerState>("/api/admin/prompt-enhancer");
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setState(r.data);
    setCfg(r.data.config);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="glass rounded-xl p-4 text-sm text-error">{error}</div>;
  if (!state || !cfg) return <div className="glass rounded-xl p-8 text-center text-muted">กำลังโหลด…</div>;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    const r = await api<{ config: EnhancerConfig }>("/api/admin/prompt-enhancer", { method: "PUT", body: JSON.stringify(cfg) });
    setSaving(false);
    if (!r.ok) setError(r.error);
    else {
      setSaved(true);
      setCfg(r.data.config);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    const r = await api<{ prompt: string; source: string; engine: string; fallbackReason?: string; ms: number }>("/api/admin/prompt-enhancer", {
      method: "POST",
      body: JSON.stringify({ config: cfg, prompt: test.prompt, kind: test.kind, modelKey: test.modelKey || undefined, videoMode: test.videoMode }),
    });
    setTesting(false);
    if (r.ok) setResult(r.data);
    else setError(r.error);
  };

  const input = "w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50";
  const modelDefault = cfg.provider !== "auto" && cfg.provider !== "off" ? state.defaults.models[cfg.provider] : "";

  return (
    <div className="space-y-4">
      <Section title="ผู้ช่วยเขียนพรอมต์ AI (ปุ่ม ✨ ในสตูดิโอ)" icon={<Sparkles className="w-4 h-4 text-primary-light" />}>
        <p className="text-xs text-muted leading-relaxed mb-3">
          ลูกค้าพิมพ์ไอเดียสั้น ๆ แล้วกด ✨ — ระบบเรียบเรียงเป็นพรอมต์ที่โมเดลนั้นเข้าใจดีที่สุด แล้วใส่กลับในช่องให้ลูกค้าอ่าน/แก้ก่อนสั่ง
          สำหรับ MiniMax H3 ที่เช่าเครื่องรันเอง ระบบใช้ H3-Context-IR ของ MiniMax (ขั้นตอนที่ MiniMax บอกว่าสำคัญต่อคุณภาพที่สุดแต่ไม่ได้เปิดซอร์ส) เมื่อมีคีย์ MiniMax
          ถ้าไม่มีคีย์ใดเลยจะใช้กฎพื้นฐานที่รู้จักรูปแบบพรอมต์ของแต่ละโมเดล
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div>
            <label className="text-xs text-muted mb-1 block">ผู้ให้บริการ</label>
            <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value as EnhancerConfig["provider"] })} className={input}>
              {(Object.keys(PROVIDER_LABEL) as EnhancerConfig["provider"][]).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {["openai", "minimax", "byteplus"].map((k) => (
                <Pill key={k} cls={state.keys[k] ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30" : "bg-slate-500/15 text-slate-400 border-slate-400/20"}>
                  {state.keys[k] ? "✓" : "✗"} {k}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">ชื่อโมเดล {cfg.provider === "auto" && <span>(โหมดอัตโนมัติใช้ค่าเริ่มต้นของแต่ละเจ้า)</span>}</label>
            <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} disabled={cfg.provider === "auto" || cfg.provider === "off"}
              placeholder={modelDefault || "—"} className={`${input} font-mono disabled:opacity-40`} />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">จำกัดต่อลูกค้าต่อชั่วโมง (0 = ปิดสำหรับลูกค้า)</label>
            <input type="number" min={0} max={1000} value={cfg.hourlyLimit} onChange={(e) => setCfg({ ...cfg, hourlyLimit: Number(e.target.value) })} className={input} />
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer pt-5">
            <input type="checkbox" checked={cfg.h3ContextIr} onChange={(e) => setCfg({ ...cfg, h3ContextIr: e.target.checked })} className="mt-1" />
            <span>ใช้ H3-Context-IR ทางการของ MiniMax กับ H3 ที่เช่าเครื่อง<span className="block text-[11px] text-muted">{state.keys.minimax ? "มีคีย์ MiniMax แล้ว" : "ยังไม่มีคีย์ MiniMax — จะข้ามไปใช้ AI ตัวอื่น"}</span></span>
          </label>
        </div>

        <details className="mt-4">
          <summary className="text-xs text-muted cursor-pointer">คำสั่งที่ส่งให้ AI (เว้นว่าง = ใช้คำสั่งในตัวที่เขียนตามคู่มือของแต่ละโมเดล)</summary>
          <div className="grid gap-3 mt-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {(["image", "video", "audio"] as const).map((k) => (
              <div key={k}>
                <label className="text-xs text-muted mb-1 block">{k === "image" ? "ภาพ" : k === "video" ? "วิดีโอ (ใช้แทนคู่มือ H3 ด้วย ถ้าใส่)" : "เพลง"}</label>
                <textarea value={cfg.instructions[k]} onChange={(e) => setCfg({ ...cfg, instructions: { ...cfg.instructions, [k]: e.target.value } })} rows={6}
                  className={`${input} font-mono text-xs resize-y`} placeholder="(ใช้คำสั่งในตัว)" />
              </div>
            ))}
          </div>
        </details>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-50">
            <Save className="w-4 h-4" />{saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          {saved && <span className="text-sm text-success flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />บันทึกแล้ว</span>}
        </div>
      </Section>

      <Section title="ทดสอบ (ใช้ค่าในฟอร์ม แม้ยังไม่บันทึก)" icon={<FlaskConical className="w-4 h-4 text-primary-light" />}>
        <div className="flex flex-wrap gap-2 items-end">
          <input value={test.prompt} onChange={(e) => setTest({ ...test, prompt: e.target.value })} className={`${input} flex-1 min-w-[240px]`} />
          <select value={test.kind} onChange={(e) => setTest({ ...test, kind: e.target.value })} className="p-2 rounded-lg bg-surface-light text-sm">
            <option value="image">ภาพ</option>
            <option value="video">วิดีโอ</option>
            <option value="audio">เพลง</option>
            <option value="edit">แก้ไขภาพ</option>
          </select>
          {test.kind === "video" && (
            <>
              <select value={test.modelKey} onChange={(e) => setTest({ ...test, modelKey: e.target.value })} className="p-2 rounded-lg bg-surface-light text-sm">
                <option value="">โมเดลวิดีโอทั่วไป (API)</option>
                {workflows.filter((w) => w.kind === "video").map((w) => <option key={w.key} value={w.key}>{w.name} (เช่าเครื่อง)</option>)}
              </select>
              <select value={test.videoMode} onChange={(e) => setTest({ ...test, videoMode: e.target.value })} className="p-2 rounded-lg bg-surface-light text-sm">
                <option value="t2v">ข้อความ → วิดีโอ</option>
                <option value="i2v">ภาพแรก → วิดีโอ</option>
                <option value="fl2v">ภาพแรก+สุดท้าย</option>
              </select>
            </>
          )}
          <button onClick={runTest} disabled={testing || !test.prompt.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/20 text-sm hover:bg-primary/30 disabled:opacity-50">
            <Sparkles className="w-4 h-4" />{testing ? "กำลังเรียบเรียง… (H3-Context-IR อาจใช้ถึง 1–2 นาที)" : "ทดสอบ"}
          </button>
        </div>
        {result && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-muted">
              ตอบโดย <b className="text-foreground">{result.engine}</b> ({result.source === "context-ir" ? "H3-Context-IR" : result.source === "llm" ? "AI" : "กฎพื้นฐาน"}) · {(result.ms / 1000).toFixed(1)} วินาที
            </div>
            {result.fallbackReason && <div className="text-xs text-warning break-words">ข้ามตัวที่ดีกว่าเพราะ: {result.fallbackReason}</div>}
            <pre className="p-3 rounded-lg bg-black/40 text-xs whitespace-pre-wrap leading-relaxed">{result.prompt}</pre>
          </div>
        )}
      </Section>
    </div>
  );
}
