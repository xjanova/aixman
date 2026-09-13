"use client";

/**
 * /admin/settings — every row of `ai_settings`, explained.
 *
 * Grouped into category cards from settings-catalog.ts. Each setting shows a
 * Thai label, its raw key, a tip, and one of four states:
 *   - editable here, with bounds checked by the API;
 *   - owned by another page (GPU caps, Telegram) — shown with a link;
 *   - written by the system itself — shown for information;
 *   - seeded but read by nothing — flagged "ยังไม่มีผล", so no one trusts a
 *     switch (maintenance mode, NSFW filter) that does nothing.
 * Keys the catalogue does not know land in "อื่น ๆ" with the raw editor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Coins,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  Globe,
  HardDrive,
  Info,
  Lock,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  SETTING_CATEGORIES,
  settingMeta,
  type CategoryId,
  type SettingMeta,
} from "@/lib/settings-catalog";

interface AiSetting {
  id: number;
  key: string;
  value: string | null;
  type: string;
  group: string;
  /** The API withheld the value (stored encrypted). */
  redacted?: boolean;
}

type Kind = "editable" | "managed" | "system" | "secret" | "unused" | "raw";

interface Row {
  setting: AiSetting;
  meta: SettingMeta | null;
  kind: Kind;
  category: CategoryId;
}

const CATEGORY_ICON: Record<CategoryId, LucideIcon> = {
  general: Globe,
  credits: Coins,
  storage: HardDrive,
  gpu: Cpu,
  notify: Bell,
  mobile: Smartphone,
  generation: Wand2,
  rate_limit: Gauge,
  integration: Plug,
  system: Database,
  other: SlidersHorizontal,
};

const CATEGORY_COLOR: Record<CategoryId, string> = {
  general: "#60a5fa",
  credits: "#fbbf24",
  storage: "#34d399",
  gpu: "#a78bfa",
  notify: "#f472b6",
  mobile: "#22d3ee",
  generation: "#94a3b8",
  rate_limit: "#94a3b8",
  integration: "#94a3b8",
  system: "#64748b",
  other: "#94a3b8",
};

function kindOf(setting: AiSetting, meta: SettingMeta | null): Kind {
  if (!meta) return setting.type === "encrypted" || setting.redacted ? "secret" : "raw";
  if (meta.secret || setting.redacted) return "secret";
  if (meta.readOnly) return "system";
  if (meta.managedAt) return "managed";
  if (meta.unused) return "unused";
  return "editable";
}

/** A system value in words: timestamps as Thai time, the balance as money. */
function formatValue(row: Row): string {
  const { setting, meta } = row;
  const v = setting.value ?? "";
  if (v === "") return "—";
  if (setting.key === "gpu_provider_balance") {
    try {
      const b = JSON.parse(v) as { usd?: number; checkedAt?: number };
      const when = b.checkedAt ? new Date(b.checkedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "";
      return `$${Number(b.usd ?? 0).toFixed(2)}${when ? ` · อ่านเมื่อ ${when}` : ""}`;
    } catch {
      return v;
    }
  }
  if (/^\d{12,14}$/.test(v)) {
    return new Date(Number(v)).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  }
  if (meta?.input === "boolean") return v === "true" ? "เปิด" : "ปิด";
  if (meta?.unit === "USD") return `$${Number(v).toFixed(2)}`;
  return meta?.unit ? `${v} ${meta.unit}` : v;
}

// Network helpers live outside the component: React Compiler gives up on a
// component with `try` around value blocks, and says nothing (see the note in
// admin/gpu/page.tsx). These hand errors back as values instead.

async function loadSettings(): Promise<{ ok: true; settings: AiSetting[] } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/settings");
    if (!res.ok) return { ok: false, error: res.status === 403 ? "ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ" : `HTTP ${res.status}` };
    const body = (await res.json()) as { settings?: AiSetting[] };
    return { ok: true, settings: body.settings ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" };
  }
}

async function send(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const KIND_BADGE: Partial<Record<Kind, { text: string; className: string; icon: LucideIcon }>> = {
  managed: { text: "แก้ที่หน้าอื่น", className: "bg-primary/15 text-primary-light", icon: ExternalLink },
  system: { text: "ระบบบันทึกเอง", className: "bg-surface-light text-muted", icon: Database },
  secret: { text: "เข้ารหัส", className: "bg-success/15 text-success", icon: ShieldCheck },
  unused: { text: "ยังไม่มีผล", className: "bg-warning/15 text-warning", icon: CircleSlash },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AiSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<CategoryId | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [showUnused, setShowUnused] = useState<Set<CategoryId>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSetting, setNewSetting] = useState({ key: "", value: "", type: "string", group: "general" });

  const refresh = useCallback(async () => {
    const result = await loadSettings();
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setSettings(result.settings);
  }, []);

  useEffect(() => {
    // `refresh` first sets state after awaiting the network; the rule cannot
    // see through the await (same as admin/gpu/page.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const rows = useMemo<Row[]>(
    () =>
      settings.map((setting) => {
        const meta = settingMeta(setting.key);
        return { setting, meta, kind: kindOf(setting, meta), category: meta?.category ?? "other" };
      }),
    [settings],
  );

  const q = query.trim().toLowerCase();
  const matches = (r: Row) =>
    !q ||
    r.setting.key.toLowerCase().includes(q) ||
    (r.meta?.label.toLowerCase().includes(q) ?? false) ||
    (r.meta?.tip.toLowerCase().includes(q) ?? false);

  const byCategory = SETTING_CATEGORIES.map((c) => ({
    category: c,
    rows: rows.filter((r) => r.category === c.id && matches(r)),
  })).filter((g) => g.rows.length > 0);

  const counts = {
    live: rows.filter((r) => r.kind === "editable" || r.kind === "managed" || r.kind === "secret").length,
    unused: rows.filter((r) => r.kind === "unused").length,
    system: rows.filter((r) => r.kind === "system").length,
  };

  const valueOf = (s: AiSetting) => (s.key in changes ? changes[s.key] : s.value);
  const setValue = (key: string, value: string | null) => setChanges((prev) => ({ ...prev, [key]: value }));
  const pendingIn = (cat: CategoryId) => rows.filter((r) => r.category === cat && r.setting.key in changes);

  const saveCategory = async (cat: CategoryId) => {
    const pending = pendingIn(cat);
    if (pending.length === 0) return;
    setSaving(cat);
    setMessage(null);
    // The API saves one DB group per call; a category can span several.
    const groups = new Map<string, Record<string, string | null>>();
    for (const r of pending) {
      const g = groups.get(r.setting.group) ?? {};
      g[r.setting.key] = changes[r.setting.key];
      groups.set(r.setting.group, g);
    }
    for (const [group, values] of groups) {
      const result = await send("POST", "/api/admin/settings", { group, settings: values });
      if (!result.ok) {
        setMessage({ kind: "err", text: result.error });
        setSaving(null);
        return;
      }
    }
    setChanges((prev) => {
      const next = { ...prev };
      for (const r of pending) delete next[r.setting.key];
      return next;
    });
    setMessage({ kind: "ok", text: `บันทึก ${pending.length} รายการแล้ว` });
    await refresh();
    setSaving(null);
  };

  const discardCategory = (cat: CategoryId) =>
    setChanges((prev) => {
      const next = { ...prev };
      for (const r of pendingIn(cat)) delete next[r.setting.key];
      return next;
    });

  const handleAdd = async () => {
    const result = await send("PUT", "/api/admin/settings", newSetting);
    if (!result.ok) {
      setMessage({ kind: "err", text: result.error });
      return;
    }
    setShowAddModal(false);
    setNewSetting({ key: "", value: "", type: "string", group: "general" });
    setMessage({ kind: "ok", text: "เพิ่มการตั้งค่าแล้ว" });
    await refresh();
  };

  const handleDelete = async (row: Row) => {
    if (!confirm(`ลบการตั้งค่า "${row.setting.key}" ?\n\nลบแล้วระบบจะใช้ค่าเริ่มต้น (ถ้ามี) และย้อนกลับไม่ได้`)) return;
    const result = await send("DELETE", `/api/admin/settings/${row.setting.id}`);
    setMessage(result.ok ? { kind: "ok", text: `ลบ ${row.setting.key} แล้ว` } : { kind: "err", text: result.error });
    if (result.ok) await refresh();
  };

  const toggleUnused = (cat: CategoryId) =>
    setShowUnused((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const editor = (row: Row) => {
    const { setting, meta } = row;
    const value = valueOf(setting) ?? "";
    const input = meta?.input ?? (setting.type === "number" ? "number" : setting.type === "boolean" ? "boolean" : setting.type === "json" ? "json" : "text");
    const base = "w-full px-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50";

    if (input === "boolean") {
      const on = value === "true";
      return (
        <button
          type="button"
          onClick={() => setValue(setting.key, on ? "false" : "true")}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${on ? "bg-success/15 text-success" : "bg-surface-light text-muted"}`}
        >
          {on ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
          {on ? "เปิด" : "ปิด"}
        </button>
      );
    }
    if (input === "json") {
      return (
        <textarea
          value={value}
          onChange={(e) => setValue(setting.key, e.target.value)}
          rows={4}
          spellCheck={false}
          className={`${base} font-mono text-xs resize-y`}
        />
      );
    }
    return (
      <div className="flex items-center gap-2">
        <input
          type={input === "number" ? "number" : "text"}
          value={value}
          min={meta?.min}
          max={meta?.max}
          step={meta?.step ?? (input === "number" ? "any" : undefined)}
          onChange={(e) => setValue(setting.key, e.target.value)}
          className={base}
        />
        {meta?.unit && <span className="text-xs text-muted whitespace-nowrap">{meta.unit}</span>}
      </div>
    );
  };

  const settingRow = (row: Row) => {
    const { setting, meta, kind } = row;
    const badge = KIND_BADGE[kind];
    const changed = setting.key in changes;
    return (
      <div key={setting.id} className={`p-4 rounded-xl border transition-colors ${changed ? "border-primary/40 bg-primary/5" : "border-white/5 bg-surface-light/20"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{meta?.label ?? setting.key}</span>
              {badge && (
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ${badge.className}`}>
                  <badge.icon className="w-3 h-3" /> {badge.text}
                </span>
              )}
              {changed && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/20 text-primary-light">ยังไม่บันทึก</span>}
            </div>
            <div className="text-[11px] text-muted font-mono mt-0.5 truncate" title={setting.key}>{setting.key}</div>
          </div>
          {kind === "raw" && (
            <button onClick={() => void handleDelete(row)} className="shrink-0 p-1.5 rounded-lg hover:bg-surface-light" title="ลบ">
              <Trash2 className="w-3.5 h-3.5 text-error" />
            </button>
          )}
        </div>

        <div className="mt-3">
          {kind === "editable" || kind === "unused" || kind === "raw" ? (
            editor(row)
          ) : kind === "secret" ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-light text-sm text-muted">
              <Lock className="w-4 h-4" /> เก็บแบบเข้ารหัส — ไม่แสดงค่า
            </div>
          ) : (
            <div className="px-3 py-2 rounded-lg bg-surface-light/60 text-sm font-medium break-all">{formatValue(row)}</div>
          )}
        </div>

        {meta?.tip && (
          <p className="flex gap-1.5 text-xs text-muted mt-2 leading-relaxed">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary-light/70" />
            <span>{meta.tip}</span>
          </p>
        )}
        {meta?.managedAt && (
          <a href={meta.managedAt.href} className="inline-flex items-center gap-1 text-xs text-primary-light hover:underline mt-2">
            {meta.managedAt.label} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary-light" />
            ตั้งค่าระบบ
          </h1>
          <p className="text-sm text-muted mt-1">
            ค่าคอนฟิกทั้งหมดของ AIXMAN จัดเป็นหมวด พร้อมคำอธิบายว่าแต่ละค่าทำอะไร และปรับแล้วมีผลอย่างไร
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refresh()} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all" title="รีเฟรช">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> เพิ่มการตั้งค่า
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl p-3 text-sm flex items-center gap-2 ${message.kind === "ok" ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
          {message.kind === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 p-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">กำลังโหลดการตั้งค่า...</p>
        </div>
      ) : loadError ? (
        <div className="glass rounded-xl p-8 text-center">
          <AlertCircle className="w-8 h-8 text-warning mx-auto mb-3" />
          <p className="font-bold mb-1">โหลดการตั้งค่าไม่สำเร็จ</p>
          <p className="text-sm text-muted mb-4">{loadError}</p>
          <button onClick={() => void refresh()} className="px-4 py-2 rounded-lg bg-primary/20 text-primary-light text-sm">ลองใหม่</button>
        </div>
      ) : settings.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted">ยังไม่มีการตั้งค่า — กด &quot;เพิ่มการตั้งค่า&quot; เพื่อเริ่มต้น</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <div className="glass rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <div>
                <div className="text-lg font-bold">{counts.live}</div>
                <div className="text-xs text-muted">ค่าที่มีผลกับระบบจริง</div>
              </div>
            </div>
            <div className="glass rounded-xl p-4 flex items-center gap-3">
              <CircleSlash className="w-5 h-5 text-warning" />
              <div>
                <div className="text-lg font-bold">{counts.unused}</div>
                <div className="text-xs text-muted">ยังไม่มีผล (ยังไม่มีโค้ดอ่านค่า)</div>
              </div>
            </div>
            <div className="glass rounded-xl p-4 flex items-center gap-3">
              <Database className="w-5 h-5 text-muted" />
              <div>
                <div className="text-lg font-bold">{counts.system}</div>
                <div className="text-xs text-muted">ระบบบันทึกเอง (ดูอย่างเดียว)</div>
              </div>
            </div>
          </div>

          {/* Search + category jump */}
          <div className="glass rounded-xl p-3 mb-6 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อ คีย์ หรือคำอธิบาย…"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {byCategory.map(({ category, rows: catRows }) => {
                const Icon = CATEGORY_ICON[category.id];
                return (
                  <a
                    key={category.id}
                    href={`#cat-${category.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-light/60 hover:bg-surface-light text-xs transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: CATEGORY_COLOR[category.id] }} />
                    {category.label}
                    <span className="text-muted">{catRows.length}</span>
                  </a>
                );
              })}
            </div>
          </div>

          {byCategory.length === 0 && <div className="glass rounded-xl p-8 text-center text-muted">ไม่พบการตั้งค่าที่ตรงกับ “{query}”</div>}

          {/* Category cards */}
          <div className="grid xl:grid-cols-2 gap-5 items-start">
            {byCategory.map(({ category, rows: catRows }) => {
              const Icon = CATEGORY_ICON[category.id];
              const color = CATEGORY_COLOR[category.id];
              const live = catRows.filter((r) => r.kind !== "unused");
              const unused = catRows.filter((r) => r.kind === "unused");
              const pending = pendingIn(category.id).length;
              const unusedOpen = showUnused.has(category.id) || (q !== "" && unused.length > 0) || live.length === 0;
              return (
                <motion.section
                  key={category.id}
                  id={`cat-${category.id}`}
                  className="glass rounded-2xl overflow-hidden scroll-mt-24"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="p-5 border-b border-white/5 flex items-start justify-between gap-3" style={{ background: `linear-gradient(135deg, ${color}14, transparent 60%)` }}>
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22`, color }}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <div>
                        <h2 className="font-bold">{category.label}</h2>
                        <p className="text-xs text-muted mt-0.5">{category.description}</p>
                      </div>
                    </div>
                    {pending > 0 && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => discardCategory(category.id)} className="px-2.5 py-1.5 rounded-lg text-xs text-muted hover:text-foreground">
                          ยกเลิก
                        </button>
                        <button
                          onClick={() => void saveCategory(category.id)}
                          disabled={saving !== null}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-xs font-medium disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {saving === category.id ? "กำลังบันทึก..." : `บันทึก ${pending} รายการ`}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    {live.map(settingRow)}
                    {unused.length > 0 && (
                      <div>
                        {live.length > 0 && (
                          <button
                            onClick={() => toggleUnused(category.id)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-warning/5 text-xs text-warning hover:bg-warning/10"
                          >
                            <span className="flex items-center gap-1.5">
                              <CircleSlash className="w-3.5 h-3.5" /> ค่าที่ยังไม่มีผลกับระบบ ({unused.length})
                            </span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${unusedOpen ? "rotate-180" : ""}`} />
                          </button>
                        )}
                        {unusedOpen && <div className="space-y-3 mt-3 opacity-80">{unused.map(settingRow)}</div>}
                      </div>
                    )}
                  </div>
                </motion.section>
              );
            })}
          </div>
        </>
      )}

      {/* Add Setting Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <motion.div
            className="glass rounded-2xl p-6 w-full max-w-md"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-1">เพิ่มการตั้งค่า</h3>
            <p className="text-xs text-muted mb-4">
              สำหรับค่าที่ยังไม่มีในรายการ — ค่าที่ระบบรู้จักอยู่แล้วให้แก้ในการ์ดของมัน ส่วน token หรือคีย์ต้องตั้งจากหน้าที่ใช้งาน (จะถูกเข้ารหัส)
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Key</label>
                <input
                  value={newSetting.key}
                  onChange={(e) => setNewSetting({ ...newSetting, key: e.target.value })}
                  placeholder="เช่น my_feature_flag"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Value</label>
                <input
                  value={newSetting.value}
                  onChange={(e) => setNewSetting({ ...newSetting, value: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Type</label>
                  <select
                    value={newSetting.type}
                    onChange={(e) => setNewSetting({ ...newSetting, type: e.target.value })}
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="text">Text (multi-line)</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">Group</label>
                  <input
                    value={newSetting.group}
                    onChange={(e) => setNewSetting({ ...newSetting, group: e.target.value })}
                    placeholder="general"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground">
                ยกเลิก
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={!newSetting.key.trim()}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-40"
              >
                บันทึก
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
