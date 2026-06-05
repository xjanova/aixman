"use client";

import { useState, useEffect, useCallback } from "react";
import { ImageIcon, Search, RefreshCw, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

interface AdminGen {
  id: number;
  type: string;
  status: string;
  prompt: string | null;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  creditsUsed: number;
  errorMessage: string | null;
  createdAt: string;
  user: { id: number; name: string; email: string };
  model: { name: string; provider: { name: string } };
}

const STATUS_COLORS: Record<string, string> = {
  completed: "text-success", failed: "text-error", processing: "text-warning", pending: "text-muted", cancelled: "text-muted",
};

export default function AdminGenerationsPage() {
  const [items, setItems] = useState<AdminGen[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");

  const fetchData = useCallback((p: number, st: string, ty: string, q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "24" });
    if (st) params.set("status", st);
    if (ty) params.set("type", ty);
    if (q) params.set("search", q);
    fetch(`/api/admin/generations?${params}`)
      .then((r) => r.json())
      .then((d) => { setItems(d.data || []); setPages(d.pages || 1); setTotal(d.total || 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(page, status, type, search); }, [page, status, type, fetchData]);

  const onSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchData(1, status, type, search); };

  const remove = async (id: number) => {
    if (!confirm("ลบผลงานนี้ถาวร?")) return;
    const res = await fetch(`/api/admin/generations/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((g) => g.id !== id));
  };

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
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="py-2 px-3 rounded-lg bg-surface-light text-sm focus:outline-none">
            <option value="">ทุกประเภท</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="edit">Edit</option>
          </select>
          <form onSubmit={onSearch} className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา prompt"
              className="pl-9 pr-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </form>
          <button onClick={() => fetchData(page, status, type, search)} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-muted">ไม่พบผลงาน</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((g) => (
            <div key={g.id} className="glass rounded-xl overflow-hidden group relative">
              <div className="aspect-square bg-surface-light relative">
                {g.thumbnailUrl || g.resultUrl ? (
                  g.type === "video" ? (
                    <video src={g.thumbnailUrl || g.resultUrl || ""} muted className="w-full h-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.thumbnailUrl || g.resultUrl || ""} alt={g.prompt || ""} className="w-full h-full object-cover" />
                  )
                ) : (
                  <div className="w-full h-full grid place-items-center text-3xl text-muted">▧</div>
                )}
                <button onClick={() => remove(g.id)} title="ลบ"
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-error opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-4 h-4" />
                </button>
                <span className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] bg-black/60 ${STATUS_COLORS[g.status] || "text-muted"}`}>{g.status}</span>
              </div>
              <div className="p-3">
                <div className="text-xs line-clamp-2 min-h-[2rem]">{g.prompt || g.errorMessage || "—"}</div>
                <div className="text-[10px] text-muted mt-2 truncate">{g.user.name} · {g.model.name}</div>
                <div className="text-[10px] text-muted">{new Date(g.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })} · ✦{g.creditsUsed}</div>
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
    </div>
  );
}
