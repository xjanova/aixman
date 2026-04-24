"use client";

/**
 * /gallery — community/personal gallery (X-DREAMER themed)
 *
 * Layout follows the X-DREAMER `GalleryDetailPage` reference: filter chips
 * + sort, masonry grid (4 cols → 3 → 2 responsive), tap-to-detail dialog.
 *
 * Preserves all features from the previous gallery page:
 *   filter (all/image/video/favorites), debounced search,
 *   pagination/load-more, favorite toggle, download, upscale, detail modal.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast-provider";

const HUE = 70;

interface Generation {
  id: number;
  type: string;
  status: string;
  prompt: string;
  resultUrl: string;
  thumbnailUrl: string;
  creditsUsed: number;
  processingMs: number | null;
  isFavorited: boolean;
  model: { name: string; provider: string; providerSlug: string };
  createdAt: string;
}

export default function GalleryPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "image" | "video" | "favorites">("all");
  const [sort, setSort] = useState<"trending" | "newest" | "top">("newest");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<Generation | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const searchTimeout = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => { if (session === null) router.push("/login"); }, [session, router]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]);

  const fetchData = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!session) return;
    if (!append) setLoading(true); else setLoadingMore(true);
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("limit", "20");
    if (filter === "favorites") params.set("favorites", "true");
    else if (filter !== "all") params.set("type", filter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    try {
      const res = await fetch(`/api/gallery?${params}`);
      const data = await res.json();
      if (append) setGenerations(prev => [...prev, ...(data.data || [])]);
      else setGenerations(data.data || []);
      setTotalPages(data.pages || 1);
      setPage(pageNum);
    } catch {}
    setLoading(false); setLoadingMore(false);
  }, [session, filter, debouncedSearch]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); fetchData(1); }, [fetchData]);

  const toggleFavorite = async (gen: Generation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if (gen.isFavorited) {
        await fetch("/api/favorites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: gen.id }) });
      } else {
        await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: gen.id }) });
      }
      setGenerations(prev => prev.map(g => g.id === gen.id ? { ...g, isFavorited: !g.isFavorited } : g));
      if (selectedItem?.id === gen.id) setSelectedItem({ ...gen, isFavorited: !gen.isFavorited });
    } catch { toast("error", "เกิดข้อผิดพลาด"); }
  };

  const handleDownload = async (gen: Generation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!gen.resultUrl) return;
    try {
      const res = await fetch(gen.resultUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xdreamer-${gen.id}.${gen.type === "video" ? "mp4" : "webp"}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("success", "ดาวน์โหลดสำเร็จ");
    } catch { toast("error", "ดาวน์โหลดไม่สำเร็จ"); }
  };

  const handleUpscale = async (gen: Generation) => {
    try {
      const res = await fetch("/api/upscale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: gen.id }) });
      const data = await res.json();
      if (!res.ok) { toast("error", "Upscale ไม่สำเร็จ", data.error); return; }
      toast("info", "กำลัง Upscale...", "ผลลัพธ์จะปรากฏในแกลเลอรี");
    } catch { toast("error", "Upscale ไม่สำเร็จ"); }
  };

  if (!session) return null;

  const filterOpts = [
    { key: "all" as const, label: "ทั้งหมด" },
    { key: "image" as const, label: "Image" },
    { key: "video" as const, label: "Video" },
    { key: "favorites" as const, label: "♥ โปรด" },
  ];
  const sortOpts = [
    { key: "newest" as const, label: "ใหม่ล่าสุด" },
    { key: "trending" as const, label: "trending" },
    { key: "top" as const, label: "top week" },
  ];

  return (
    <div style={{ padding: "30px 48px 80px", maxWidth: 1500, margin: "0 auto", color: "#f1f5f9" }}>
      {/* Hero header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 14 }}>· แกลเลอรี</div>
        <h1 style={{ fontSize: "clamp(48px, 6vw, 80px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0 }}>
          ปราสาท<span className="xdr-italic-th" style={{ fontStyle: "italic", color: "#c4b5fd" }}> ของคุณ</span>
        </h1>
        <p style={{ marginTop: 18, color: "rgba(203,213,225,0.7)", fontSize: 17, fontWeight: 300 }}>
          ผลงานทั้งหมดที่คุณทอขึ้น · สำรวจ บันทึก แชร์
        </p>
      </div>

      {/* Filter + sort + search */}
      <div className="rp-filter-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filterOpts.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                padding: "8px 16px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                background: filter === f.key ? "rgba(255,255,255,0.12)" : "transparent",
                color: filter === f.key ? "#fff" : "#94a3b8",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>{f.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา prompt..."
            style={{ width: 220, padding: "8px 14px", borderRadius: 10, background: "rgba(2,6,23,0.5)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
          {sortOpts.map(s => (
            <button key={s.key} onClick={() => setSort(s.key)}
              style={{
                padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                background: sort === s.key ? `hsla(${270 + HUE},60%,50%,0.15)` : "transparent",
                color: sort === s.key ? "#fff" : "#94a3b8",
                border: `1px solid ${sort === s.key ? `hsla(${270 + HUE},60%,55%,0.4)` : "rgba(255,255,255,0.08)"}`,
              }}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* Content states */}
      {loading ? (
        <div className="rp-gallery-mason" style={{ columnCount: 4, columnGap: 14 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{
              breakInside: "avoid", marginBottom: 14, borderRadius: 14, overflow: "hidden",
              background: `linear-gradient(135deg, hsla(${(i * 30 + HUE) % 360},40%,15%,0.4), hsla(${(i * 30 + 60 + HUE) % 360},40%,8%,0.4))`,
              border: "1px solid rgba(255,255,255,0.04)", aspectRatio: i % 3 === 0 ? "3/4" : i % 3 === 1 ? "1/1" : "4/5",
              animation: "pulse 1.6s ease-in-out infinite",
            }} />
          ))}
        </div>
      ) : generations.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ width: 110, height: 110, borderRadius: 28, margin: "0 auto 28px", background: `linear-gradient(135deg, hsla(${160 + HUE},60%,20%,0.4), hsla(${280 + HUE},60%,15%,0.4))`, border: "1px solid rgba(255,255,255,0.08)", display: "grid", placeItems: "center", fontSize: 44, color: `hsl(${220 + HUE},70%,75%)` }}>
            ▧
          </div>
          <h3 style={{ fontSize: 24, fontWeight: 300, color: "#fff", marginBottom: 8 }}>
            {filter === "favorites" ? "ยังไม่มีรายการโปรด" : "ยังไม่มีผลงาน"}
          </h3>
          <p style={{ fontSize: 13, color: "rgba(203,213,225,0.6)", marginBottom: 24 }}>
            {filter === "favorites" ? "กดหัวใจในผลงานเพื่อบันทึก" : "เริ่มทอความฝันแรกของคุณ"}
          </p>
          <button onClick={() => router.push("/generate")}
            style={{ padding: "14px 28px", borderRadius: 12, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", boxShadow: `0 12px 30px -10px hsla(${270 + HUE},80%,50%,0.6)` }}>
            ✦ เริ่มสร้างเลย
          </button>
        </div>
      ) : (
        <>
          <div className="rp-gallery-mason" style={{ columnCount: 4, columnGap: 14 }}>
            {generations.map(gen => {
              const hue = (gen.id * 37 + HUE) % 360;
              const h2 = (hue + 50) % 360;
              return (
                <div key={gen.id} onClick={() => setSelectedItem(gen)}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 25px 50px -15px hsla(${hue},80%,55%,0.4)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 10px 30px -10px rgba(0,0,0,0.6)"; }}
                  style={{
                    breakInside: "avoid", marginBottom: 14, borderRadius: 14, overflow: "hidden", position: "relative",
                    background: `linear-gradient(135deg, hsl(${hue},60%,14%), hsl(${h2},60%,8%))`,
                    border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer",
                    transition: "transform 400ms cubic-bezier(0.4,0,0.2,1), box-shadow 400ms",
                    boxShadow: "0 10px 30px -10px rgba(0,0,0,0.6)",
                  }}>
                  <div style={{ position: "relative" }}>
                    {gen.type === "video" ? (
                      <video src={gen.thumbnailUrl || gen.resultUrl} muted style={{ width: "100%", display: "block", objectFit: "cover" }} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={gen.thumbnailUrl || gen.resultUrl} alt={gen.prompt} style={{ width: "100%", display: "block", objectFit: "cover" }} />
                    )}
                    {gen.type !== "image" && (
                      <span style={{ position: "absolute", top: 10, right: 10, padding: "3px 8px", borderRadius: 999, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", fontSize: 9, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        {gen.type === "video" ? "▶ video" : "✦ edit"}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: "10px 14px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gen.prompt}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>@{gen.model?.provider}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
                      <button onClick={(e) => toggleFavorite(gen, e)}
                        style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)", color: gen.isFavorited ? "#fca5a5" : "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 12 }}>
                        {gen.isFavorited ? "♥" : "♡"}
                      </button>
                      <button onClick={(e) => handleDownload(gen, e)}
                        style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 12 }}>
                        ↓
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {page < totalPages && (
            <div style={{ textAlign: "center", marginTop: 40 }}>
              <button onClick={() => fetchData(page + 1, true)} disabled={loadingMore}
                style={{ padding: "14px 28px", borderRadius: 12, background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: 14, cursor: loadingMore ? "wait" : "pointer", opacity: loadingMore ? 0.6 : 1 }}>
                {loadingMore ? "⟳ กำลังโหลด..." : "โหลดเพิ่ม ↓"}
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      {selectedItem && (
        <div onClick={() => setSelectedItem(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(2,6,23,0.85)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 880, maxHeight: "90vh", overflowY: "auto", borderRadius: 22, padding: 28, background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 50px 100px -20px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, background: `hsla(${220 + HUE},60%,50%,0.2)`, color: "#a5f3fc", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {selectedItem.model?.provider}
                </span>
                <div style={{ fontSize: 18, color: "#fff", fontWeight: 500, marginTop: 6 }}>{selectedItem.model?.name}</div>
              </div>
              <button onClick={() => setSelectedItem(null)} style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>

            <div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 16, border: "1px solid rgba(255,255,255,0.06)" }}>
              {selectedItem.type === "video" ? (
                <video src={selectedItem.resultUrl} controls autoPlay style={{ width: "100%", display: "block" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedItem.resultUrl} alt={selectedItem.prompt} style={{ width: "100%", display: "block", maxHeight: "60vh", objectFit: "contain" }} />
              )}
            </div>

            <p style={{ fontSize: 14, color: "rgba(203,213,225,0.85)", lineHeight: 1.55, margin: "0 0 12px" }}>{selectedItem.prompt}</p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11, color: "#64748b", marginBottom: 18 }}>
              <span>✦ {selectedItem.creditsUsed} เครดิต</span>
              {selectedItem.processingMs && <span>⌚ {(selectedItem.processingMs / 1000).toFixed(1)}s</span>}
              <span>📅 {new Date(selectedItem.createdAt).toLocaleString("th-TH")}</span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => handleDownload(selectedItem)}
                style={{ padding: "10px 18px", borderRadius: 10, background: `linear-gradient(135deg, hsl(${160 + HUE},70%,50%), hsl(${280 + HUE},70%,55%))`, color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                ↓ ดาวน์โหลด
              </button>
              <button onClick={() => toggleFavorite(selectedItem)}
                style={{ padding: "10px 18px", borderRadius: 10, background: "rgba(255,255,255,0.06)", color: selectedItem.isFavorited ? "#fca5a5" : "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                {selectedItem.isFavorited ? "♥ บันทึกแล้ว" : "♡ บันทึก"}
              </button>
              {selectedItem.type !== "video" && (
                <button onClick={() => handleUpscale(selectedItem)}
                  style={{ padding: "10px 18px", borderRadius: 10, background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                  ⤢ Upscale
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
