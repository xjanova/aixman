"use client";

/**
 * /admin/generations — moderation desk for everything users have generated.
 *
 * An admin needs three things a user's own gallery never offers: to *see* the
 * piece properly (a muted thumbnail says nothing about a video), to take it off
 * the public showcase without destroying someone's work, and to delete it when
 * it has to go. Everything here is built around those three, plus the numbers
 * that explain a piece — what it cost, how long it took, whether its credits
 * went back, and whether the file still exists at all.
 */

import { useState, useEffect, useCallback } from "react";
import {
  ImageIcon,
  Search,
  RefreshCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Play,
  X,
  Copy,
  Download,
  ExternalLink,
  CheckSquare,
  Square,
} from "lucide-react";
import { AudioCover } from "@/components/xdreamer/audio";

interface AdminGen {
  id: number;
  type: string;
  status: string;
  prompt: string | null;
  negativePrompt: string | null;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  creditsUsed: number;
  creditsRefunded: number;
  costUsd: number;
  processingMs: number | null;
  errorMessage: string | null;
  providerJobId: string | null;
  /** On the public showcase. Admins take a piece off it without deleting it. */
  isPublic: boolean;
  expiresAt: string | null;
  /** Set once the stored file is gone — the row stays, the media does not. */
  mediaDeletedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  user: { id: number; name: string; email: string };
  model: { name: string; provider: { name: string } };
}

const STATUS_COLORS: Record<string, string> = {
  completed: "text-success", failed: "text-error", processing: "text-warning", pending: "text-muted", cancelled: "text-muted",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "สำเร็จ", failed: "ล้มเหลว", processing: "กำลังทำ", pending: "รอคิว", cancelled: "ยกเลิก",
};

const TYPE_LABEL: Record<string, string> = { image: "ภาพ", video: "วิดีโอ", edit: "แก้ไขภาพ", audio: "เพลง" };

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });

/*
 * The helpers below own the try/catch their callers inside the component
 * cannot have — React Compiler gives up on a whole component that contains one
 * — and hand back errors as values instead.
 */

async function patchVisibility(id: number, isPublic: boolean): Promise<string | null> {
  try {
    const res = await fetch(`/api/admin/generations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `บันทึกไม่สำเร็จ (HTTP ${res.status})`;
  } catch {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  }
}

async function deleteGeneration(id: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/admin/generations/${id}`, { method: "DELETE" });
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `ลบไม่สำเร็จ (HTTP ${res.status})`;
  } catch {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The media itself — the only place a video or a song actually plays. */
function Media({ gen, full }: { gen: AdminGen; full: boolean }) {
  const src = full ? gen.resultUrl || gen.thumbnailUrl : gen.thumbnailUrl || gen.resultUrl;
  if (gen.mediaDeletedAt) {
    return (
      <div className="w-full h-full grid place-items-center text-center text-xs text-muted p-4">
        ไฟล์ถูกลบตามกำหนดเก็บรักษา
        <br />
        {dateTime(gen.mediaDeletedAt)}
      </div>
    );
  }
  if (!src) {
    return (
      <div className="w-full h-full grid place-items-center text-3xl text-muted">
        {gen.status === "failed" ? "✕" : "▧"}
      </div>
    );
  }
  if (gen.type === "audio") {
    return (
      <>
        <AudioCover seed={gen.prompt || ""} bars={full ? 24 : 9} label={false} style={{ width: "100%", height: full ? "260px" : "100%" }} />
        <audio
          src={gen.resultUrl || gen.thumbnailUrl || ""}
          controls
          preload={full ? "auto" : "none"}
          className={full ? "w-full mt-3" : "absolute left-2 right-2 bottom-9 h-8 w-[calc(100%-1rem)]"}
        />
      </>
    );
  }
  if (gen.type === "video") {
    return (
      <video
        src={src}
        poster={gen.thumbnailUrl && full ? gen.thumbnailUrl : undefined}
        controls={full}
        autoPlay={full}
        muted={!full}
        playsInline
        preload="metadata"
        className={full ? "max-h-[70vh] w-auto mx-auto rounded-lg" : "w-full h-full object-cover"}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={gen.prompt || ""}
      className={full ? "max-h-[70vh] w-auto mx-auto rounded-lg" : "w-full h-full object-cover"}
    />
  );
}

/** One labelled figure in the detail panel. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-muted">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

export default function AdminGenerationsPage() {
  const [items, setItems] = useState<AdminGen[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [visibility, setVisibility] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  /** Index into `items` of the piece open in the viewer, or null. */
  const [viewing, setViewing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const fetchData = useCallback((p: number, st: string, ty: string, vis: string, q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "24" });
    if (st) params.set("status", st);
    if (ty) params.set("type", ty);
    if (vis) params.set("visibility", vis);
    if (q) params.set("search", q);
    fetch(`/api/admin/generations?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.data || []);
        setPages(d.pages || 1);
        setTotal(d.total || 0);
        setLoading(false);
        // A selection that survived a reload would act on rows no longer shown.
        setSelected([]);
      })
      .catch(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(page, status, type, visibility, search); }, [page, status, type, visibility, fetchData]);

  // The viewer is keyboard-first: an admin reviewing a page of work should not
  // have to reach for the mouse between pieces.
  useEffect(() => {
    if (viewing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewing(null);
      if (e.key === "ArrowLeft") setViewing((i) => (i === null ? null : Math.max(0, i - 1)));
      if (e.key === "ArrowRight") setViewing((i) => (i === null ? null : Math.min(items.length - 1, i + 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, items.length]);

  const reload = () => fetchData(page, status, type, visibility, search);
  const onSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchData(1, status, type, visibility, search); };

  const toggleSelect = (id: number) =>
    setSelected((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));

  const setVisible = async (ids: number[], isPublic: boolean) => {
    setBusy(true);
    const results = await Promise.all(ids.map((id) => patchVisibility(id, isPublic)));
    const failed = results.filter(Boolean).length;
    // Only the rows the server accepted are flipped locally; the rest keep
    // showing what they really are, so a failure cannot hide behind the UI.
    const changed = ids.filter((_, i) => results[i] === null);
    setItems((all) => all.map((g) => (changed.includes(g.id) ? { ...g, isPublic } : g)));
    setBusy(false);
    setMessage(
      failed
        ? { kind: "err", text: `${failed} ชิ้นบันทึกไม่สำเร็จ — กดรีเฟรชเพื่อดูสถานะจริง` }
        : { kind: "ok", text: isPublic ? `เผยแพร่ ${ids.length} ชิ้นแล้ว` : `ซ่อน ${ids.length} ชิ้นจากสาธารณะแล้ว` }
    );
  };

  const remove = async (ids: number[]) => {
    const many = ids.length > 1;
    if (!confirm(many ? `ลบผลงาน ${ids.length} ชิ้นถาวร?\n\nกู้คืนไม่ได้ และไฟล์ของผู้ใช้จะหายไปด้วย` : "ลบผลงานนี้ถาวร?\n\nกู้คืนไม่ได้")) return;
    setBusy(true);
    const results = await Promise.all(ids.map((id) => deleteGeneration(id)));
    const gone = ids.filter((_, i) => results[i] === null);
    const failed = ids.length - gone.length;
    setItems((all) => all.filter((g) => !gone.includes(g.id)));
    setSelected([]);
    setViewing(null);
    setTotal((t) => Math.max(0, t - gone.length));
    setBusy(false);
    setMessage(
      failed
        ? { kind: "err", text: `ลบไม่สำเร็จ ${failed} ชิ้น` }
        : { kind: "ok", text: `ลบแล้ว ${gone.length} ชิ้น` }
    );
  };

  const open = viewing !== null ? items[viewing] : null;
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-primary-light" /> ผลงานทั้งหมด
          </h1>
          <p className="text-sm text-muted mt-1">ดูแล/ตรวจสอบผลงานของผู้ใช้ ({total.toLocaleString()} ชิ้น)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="py-2 px-3 rounded-lg bg-surface-light text-sm focus:outline-none">
            <option value="">สถานะทั้งหมด</option>
            <option value="completed">สำเร็จ</option>
            <option value="failed">ล้มเหลว</option>
            <option value="processing">กำลังทำ</option>
            <option value="pending">รอคิว</option>
            <option value="cancelled">ยกเลิก</option>
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="py-2 px-3 rounded-lg bg-surface-light text-sm focus:outline-none">
            <option value="">ทุกประเภท</option>
            <option value="image">ภาพ</option>
            <option value="video">วิดีโอ</option>
            <option value="edit">แก้ไขภาพ</option>
            <option value="audio">เพลง</option>
          </select>
          <select value={visibility} onChange={(e) => { setVisibility(e.target.value); setPage(1); }} className="py-2 px-3 rounded-lg bg-surface-light text-sm focus:outline-none">
            <option value="">ทั้งเผยแพร่และซ่อน</option>
            <option value="public">เฉพาะที่เผยแพร่</option>
            <option value="hidden">เฉพาะที่ซ่อน</option>
          </select>
          <form onSubmit={onSearch} className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา prompt (กด Enter)"
              className="pl-9 pr-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </form>
          <button onClick={reload} title="รีเฟรช" className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl p-3 text-sm flex items-center justify-between gap-3 ${message.kind === "ok" ? "bg-success/10 text-success" : "bg-error/10 text-error"}`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4 text-sm">
          <button
            onClick={() => setSelected(allSelected ? [] : items.map((g) => g.id))}
            className="px-3 py-1.5 rounded-lg glass-light flex items-center gap-2 text-xs"
          >
            {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {allSelected ? "ล้างการเลือก" : "เลือกทั้งหน้า"}
          </button>
          {selected.length > 0 && (
            <>
              <span className="text-xs text-muted">เลือก {selected.length} ชิ้น</span>
              <button onClick={() => void setVisible(selected, false)} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-warning/15 text-warning text-xs flex items-center gap-1.5 disabled:opacity-40">
                <EyeOff className="w-3.5 h-3.5" /> ซ่อนจากสาธารณะ
              </button>
              <button onClick={() => void setVisible(selected, true)} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-success/15 text-success text-xs flex items-center gap-1.5 disabled:opacity-40">
                <Eye className="w-3.5 h-3.5" /> เผยแพร่
              </button>
              <button onClick={() => void remove(selected)} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-error/15 text-error text-xs flex items-center gap-1.5 disabled:opacity-40">
                <Trash2 className="w-3.5 h-3.5" /> ลบถาวร
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-muted">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-muted">ไม่พบผลงานตามเงื่อนไขนี้</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((g, index) => (
            <div key={g.id} className={`glass rounded-xl overflow-hidden group relative ${selected.includes(g.id) ? "ring-2 ring-primary" : ""}`}>
              <div className={`aspect-square bg-surface-light relative ${g.isPublic ? "" : "opacity-75"}`}>
                <Media gen={g} full={false} />

                {/* Click the picture to view it properly — a muted thumbnail is
                    not enough to moderate a video by. Audio already has its own
                    controls on the card, and an overlay would swallow them. */}
                {g.type !== "audio" && (
                  <button
                    onClick={() => setViewing(index)}
                    title="เปิดดู / เล่น"
                    className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Play className="w-10 h-10 text-white" />
                  </button>
                )}

                <button
                  onClick={() => toggleSelect(g.id)}
                  title="เลือก"
                  className={`absolute top-2 left-2 p-1.5 rounded-lg bg-black/60 transition-opacity ${selected.includes(g.id) ? "opacity-100 text-primary-light" : "opacity-0 group-hover:opacity-100 text-white"}`}
                >
                  {selected.includes(g.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                </button>

                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => void setVisible([g.id], !g.isPublic)} disabled={busy}
                    title={g.isPublic ? "ซ่อนจากสาธารณะ" : "เผยแพร่สู่สาธารณะ"}
                    className="p-1.5 rounded-lg bg-black/60 text-white disabled:opacity-40">
                    {g.isPublic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => void remove([g.id])} disabled={busy} title="ลบถาวร"
                    className="p-1.5 rounded-lg bg-black/60 text-error disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <span className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] bg-black/60 ${STATUS_COLORS[g.status] || "text-muted"}`}>
                  {STATUS_LABEL[g.status] ?? g.status}
                </span>
                {!g.isPublic && (
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[10px] bg-black/60 text-muted flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> ซ่อน
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="text-xs line-clamp-2 min-h-[2rem]">{g.prompt || g.errorMessage || "—"}</div>
                <div className="text-[10px] text-muted mt-2 truncate">{g.user.name} · {g.model.name}</div>
                <div className="text-[10px] text-muted">{dateTime(g.createdAt)} · ✦{g.creditsUsed}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-2 rounded-lg glass-light disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-muted">หน้า {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-2 rounded-lg glass-light disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-auto" onClick={() => setViewing(null)}>
          <div className="max-w-5xl mx-auto my-6 glass rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-bold flex items-center gap-2 flex-wrap">
                  #{open.id} · {TYPE_LABEL[open.type] ?? open.type}
                  <span className={`text-xs ${STATUS_COLORS[open.status] || "text-muted"}`}>{STATUS_LABEL[open.status] ?? open.status}</span>
                  {!open.isPublic && <span className="text-xs text-muted flex items-center gap-1"><EyeOff className="w-3.5 h-3.5" /> ซ่อนอยู่</span>}
                </h2>
                <p className="text-xs text-muted mt-1">
                  {open.user.name} ({open.user.email}) · {open.model.name} · {open.model.provider.name}
                </p>
              </div>
              <button onClick={() => setViewing(null)} title="ปิด (Esc)" className="p-2 rounded-lg glass-light"><X className="w-4 h-4" /></button>
            </div>

            <div className="relative">
              <Media gen={open} full />
              {items.length > 1 && (
                <>
                  <button
                    onClick={() => setViewing((i) => (i === null ? null : Math.max(0, i - 1)))}
                    disabled={viewing === 0}
                    title="ก่อนหน้า (←)"
                    className="absolute left-0 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 disabled:opacity-20"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setViewing((i) => (i === null ? null : Math.min(items.length - 1, i + 1)))}
                    disabled={viewing === items.length - 1}
                    title="ถัดไป (→)"
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 disabled:opacity-20"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
              <Fact label="เครดิตที่ใช้" value={`✦${open.creditsUsed}${open.creditsRefunded > 0 ? ` (คืน ${open.creditsRefunded})` : ""}`} />
              <Fact label="ต้นทุนจริง" value={open.costUsd > 0 ? `$${open.costUsd.toFixed(4)}` : "–"} />
              <Fact label="เวลาที่ใช้" value={open.processingMs ? `${(open.processingMs / 1000).toFixed(1)} วิ` : "–"} />
              <Fact label="สร้างเมื่อ" value={dateTime(open.createdAt)} />
              {open.expiresAt && <Fact label="ไฟล์หมดอายุ" value={dateTime(open.expiresAt)} />}
              {open.mediaDeletedAt && <Fact label="ไฟล์ถูกลบแล้ว" value={dateTime(open.mediaDeletedAt)} />}
              {open.providerJobId && <Fact label="รหัสงานฝั่งผู้ให้บริการ" value={<span className="text-xs break-all">{open.providerJobId}</span>} />}
            </div>

            {open.prompt && (
              <div className="mt-4">
                <div className="text-[10px] text-muted mb-1">Prompt</div>
                <p className="text-sm whitespace-pre-wrap break-words max-h-40 overflow-auto">{open.prompt}</p>
              </div>
            )}
            {open.negativePrompt && (
              <div className="mt-3">
                <div className="text-[10px] text-muted mb-1">Negative prompt</div>
                <p className="text-sm whitespace-pre-wrap break-words">{open.negativePrompt}</p>
              </div>
            )}
            {open.errorMessage && (
              <div className="mt-3 rounded-lg bg-error/10 text-error text-sm p-3 break-words">{open.errorMessage}</div>
            )}

            <div className="flex items-center gap-2 flex-wrap mt-5">
              <button onClick={() => void setVisible([open.id], !open.isPublic)} disabled={busy}
                className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-40 ${open.isPublic ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>
                {open.isPublic ? <><EyeOff className="w-4 h-4" /> ซ่อนจากสาธารณะ</> : <><Eye className="w-4 h-4" /> เผยแพร่สู่สาธารณะ</>}
              </button>
              {open.prompt && (
                <button
                  onClick={() => void copyText(open.prompt ?? "").then((ok) => setMessage({ kind: ok ? "ok" : "err", text: ok ? "คัดลอก prompt แล้ว" : "คัดลอกไม่สำเร็จ" }))}
                  className="px-3 py-2 rounded-lg glass-light text-sm flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" /> คัดลอก prompt
                </button>
              )}
              {open.resultUrl && !open.mediaDeletedAt && (
                <>
                  <a href={open.resultUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg glass-light text-sm flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" /> เปิดไฟล์ต้นฉบับ
                  </a>
                  {/* Through our own origin, not the storage URL: a browser
                      ignores `download` cross-origin and opens the clip in a
                      tab instead of saving it. */}
                  <a href={`/api/admin/generations/${open.id}/file`} download className="px-3 py-2 rounded-lg glass-light text-sm flex items-center gap-2">
                    <Download className="w-4 h-4" /> ดาวน์โหลด
                  </a>
                </>
              )}
              <button onClick={() => void remove([open.id])} disabled={busy}
                className="px-3 py-2 rounded-lg bg-error/15 text-error text-sm flex items-center gap-2 ml-auto disabled:opacity-40">
                <Trash2 className="w-4 h-4" /> ลบถาวร
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
