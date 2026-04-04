"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/components/ui/toast-provider";
import {
  LayoutGrid,
  Heart,
  Download,
  Search,
  Image as ImageIcon,
  Video,
  Wand2,
  Clock,
  X,
  Coins,
  Sparkles,
  ChevronDown,
  Loader2,
} from "lucide-react";

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
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<Generation | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const searchTimeout = useRef<NodeJS.Timeout>(undefined);

  // Redirect if not logged in
  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  // Debounce search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]);

  // Fetch generations
  const fetchData = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!session) return;
    if (!append) setLoading(true);
    else setLoadingMore(true);

    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("limit", "20");
    if (filter === "favorites") {
      params.set("favorites", "true");
    } else if (filter !== "all") {
      params.set("type", filter);
    }
    if (debouncedSearch) params.set("search", debouncedSearch);

    try {
      const res = await fetch(`/api/gallery?${params}`);
      const data = await res.json();
      if (append) {
        setGenerations((prev) => [...prev, ...(data.data || [])]);
      } else {
        setGenerations(data.data || []);
      }
      setTotalPages(data.pages || 1);
      setPage(pageNum);
    } catch {}
    setLoading(false);
    setLoadingMore(false);
  }, [session, filter, debouncedSearch]);

  useEffect(() => {
    setPage(1);
    fetchData(1);
  }, [fetchData]);

  // Toggle favorite
  const toggleFavorite = async (gen: Generation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if (gen.isFavorited) {
        await fetch("/api/favorites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: gen.id }),
        });
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: gen.id }),
        });
      }
      // Update local state
      setGenerations((prev) =>
        prev.map((g) => g.id === gen.id ? { ...g, isFavorited: !g.isFavorited } : g)
      );
      if (selectedItem?.id === gen.id) {
        setSelectedItem({ ...gen, isFavorited: !gen.isFavorited });
      }
    } catch {
      toast("error", "เกิดข้อผิดพลาด");
    }
  };

  // Download
  const handleDownload = async (gen: Generation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!gen.resultUrl) return;
    try {
      const res = await fetch(gen.resultUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `xman-ai-${gen.id}.${gen.type === "video" ? "mp4" : "webp"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("success", "ดาวน์โหลดสำเร็จ");
    } catch {
      toast("error", "ดาวน์โหลดไม่สำเร็จ");
    }
  };

  // Keyboard close lightbox
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!session) return null;

  const filterTabs = [
    { key: "all" as const, label: "ทั้งหมด", icon: LayoutGrid },
    { key: "image" as const, label: "ภาพ", icon: ImageIcon },
    { key: "video" as const, label: "วิดีโอ", icon: Video },
    { key: "favorites" as const, label: "รายการโปรด", icon: Heart },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <LayoutGrid className="w-7 h-7 text-primary-light" />
            แกลเลอรี
          </h1>
          <p className="text-muted mt-1">ผลงานที่คุณสร้างทั้งหมด</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา prompt..."
              className="pl-9 pr-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
            />
          </div>

          <div className="flex items-center gap-1 p-0.5 rounded-lg glass-light">
            {filterTabs.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  filter === f.key ? "bg-primary/20 text-primary-light" : "text-muted hover:text-foreground"
                }`}
              >
                <f.icon className="w-3 h-3" />
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl animate-shimmer" />
          ))}
        </div>
      ) : generations.length === 0 ? (
        <div className="text-center py-20">
          <LayoutGrid className="w-16 h-16 text-muted/30 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-muted mb-2">
            {filter === "favorites" ? "ยังไม่มีรายการโปรด" : "ยังไม่มีผลงาน"}
          </h3>
          <p className="text-sm text-muted/60">
            {filter === "favorites" ? "กดหัวใจเพื่อบันทึกผลงานที่ชอบ" : "เริ่มสร้างภาพหรือวิดีโอ AI กันเลย!"}
          </p>
          <a href="/generate" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium mt-4 hover:shadow-lg hover:shadow-primary/30 transition-all">
            <Sparkles className="w-4 h-4" /> เริ่มสร้าง
          </a>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {generations.map((gen, i) => (
              <motion.div
                key={gen.id}
                className="group relative aspect-square rounded-xl overflow-hidden cursor-pointer glass"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 12) * 0.03 }}
                onClick={() => setSelectedItem(gen)}
              >
                {gen.type === "video" ? (
                  <video src={gen.thumbnailUrl || gen.resultUrl} className="w-full h-full object-cover" muted />
                ) : (
                  <img src={gen.thumbnailUrl || gen.resultUrl} alt={gen.prompt} className="w-full h-full object-cover" />
                )}

                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-xs text-white/80 line-clamp-2">{gen.prompt}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-white/60">{gen.model?.provider}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => toggleFavorite(gen, e)}
                          className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all"
                        >
                          <Heart className={`w-3.5 h-3.5 ${gen.isFavorited ? "text-red-400 fill-red-400" : "text-white/60"}`} />
                        </button>
                        <button
                          onClick={(e) => handleDownload(gen, e)}
                          className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all"
                        >
                          <Download className="w-3.5 h-3.5 text-white/60" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Type badge */}
                {gen.type === "video" && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 text-xs text-white flex items-center gap-1">
                    <Video className="w-3 h-3" /> Video
                  </div>
                )}
                {gen.type === "edit" && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 text-xs text-white flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> Edit
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Load More */}
          {page < totalPages && (
            <div className="text-center mt-8">
              <button
                onClick={() => fetchData(page + 1, true)}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl glass-light hover:bg-surface-light font-medium text-sm transition-all disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
              </button>
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              className="glass rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span className="px-2 py-0.5 rounded-full bg-surface-light text-xs">{selectedItem.model?.provider}</span>
                  <span>{selectedItem.model?.name}</span>
                </div>
                <button onClick={() => setSelectedItem(null)} className="p-1 rounded-lg hover:bg-surface-light">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Media */}
              {selectedItem.type === "video" ? (
                <video src={selectedItem.resultUrl} controls autoPlay className="w-full rounded-xl" />
              ) : (
                <img src={selectedItem.resultUrl} alt={selectedItem.prompt} className="w-full rounded-xl max-h-[60vh] object-contain" />
              )}

              {/* Prompt */}
              <div className="mt-4">
                <p className="text-sm mb-3">{selectedItem.prompt}</p>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> {selectedItem.creditsUsed} เครดิต</span>
                  {selectedItem.processingMs && (
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {(selectedItem.processingMs / 1000).toFixed(1)}s</span>
                  )}
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(selectedItem.createdAt).toLocaleString("th-TH")}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => handleDownload(selectedItem)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm transition-all"
                  >
                    <Download className="w-4 h-4" /> ดาวน์โหลด
                  </button>
                  <button
                    onClick={() => toggleFavorite(selectedItem)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light hover:bg-surface-light text-sm transition-all ${selectedItem.isFavorited ? "text-error" : ""}`}
                  >
                    <Heart className={`w-4 h-4 ${selectedItem.isFavorited ? "fill-current" : ""}`} />
                    {selectedItem.isFavorited ? "บันทึกแล้ว" : "บันทึก"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
