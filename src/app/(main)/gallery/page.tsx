"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LayoutGrid,
  Heart,
  Download,
  Search,
  Image as ImageIcon,
  Video,
  Wand2,
  Clock,
  Coins,
  Sparkles,
  ChevronDown,
  ZoomIn,
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

  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]);

  const fetchData = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!session) return;
    if (!append) setLoading(true);
    else setLoadingMore(true);

    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("limit", "20");
    if (filter === "favorites") params.set("favorites", "true");
    else if (filter !== "all") params.set("type", filter);
    if (debouncedSearch) params.set("search", debouncedSearch);

    try {
      const res = await fetch(`/api/gallery?${params}`);
      const data = await res.json();
      if (append) setGenerations((prev) => [...prev, ...(data.data || [])]);
      else setGenerations(data.data || []);
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

  const toggleFavorite = async (gen: Generation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if (gen.isFavorited) {
        await fetch("/api/favorites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: gen.id }) });
      } else {
        await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: gen.id }) });
      }
      setGenerations((prev) => prev.map((g) => g.id === gen.id ? { ...g, isFavorited: !g.isFavorited } : g));
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
      a.download = `xman-ai-${gen.id}.${gen.type === "video" ? "mp4" : "webp"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("success", "ดาวน์โหลดสำเร็จ");
    } catch { toast("error", "ดาวน์โหลดไม่สำเร็จ"); }
  };

  const handleUpscale = async (gen: Generation) => {
    try {
      const res = await fetch("/api/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: gen.id }),
      });
      const data = await res.json();
      if (!res.ok) { toast("error", "Upscale ไม่สำเร็จ", data.error); return; }
      toast("info", "กำลัง Upscale...", "ผลลัพธ์จะปรากฏในแกลเลอรี");
    } catch { toast("error", "Upscale ไม่สำเร็จ"); }
  };

  if (!session) return null;

  const filterTabs = [
    { key: "all" as const, label: "ทั้งหมด", icon: LayoutGrid },
    { key: "image" as const, label: "ภาพ", icon: ImageIcon },
    { key: "video" as const, label: "วิดีโอ", icon: Video },
    { key: "favorites" as const, label: "รายการโปรด", icon: Heart },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <LayoutGrid className="w-7 h-7 text-primary-light" /> แกลเลอรี
          </h1>
          <p className="text-muted mt-1">ผลงานที่คุณสร้างทั้งหมด</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหา prompt..." leftIcon={<Search className="w-4 h-4" />} className="w-48" />
          <div className="flex items-center gap-1 p-1 rounded-xl neu-inset-sm bg-surface/60">
            {filterTabs.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${filter === f.key ? "bg-gradient-to-r from-primary to-secondary text-white neu-raised-sm" : "text-muted hover:text-foreground"}`}>
                <f.icon className="w-3 h-3" /> {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (<div key={i} className="aspect-square rounded-xl animate-shimmer" />))}
        </div>
      ) : generations.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-2xl bg-surface-light/50 flex items-center justify-center mx-auto mb-4 neu-raised-sm">
            <LayoutGrid className="w-10 h-10 text-muted/30" />
          </div>
          <h3 className="text-lg font-medium text-muted mb-2">{filter === "favorites" ? "ยังไม่มีรายการโปรด" : "ยังไม่มีผลงาน"}</h3>
          <p className="text-sm text-muted/60 mb-4">{filter === "favorites" ? "กดหัวใจเพื่อบันทึกผลงานที่ชอบ" : "เริ่มสร้างภาพหรือวิดีโอ AI กันเลย!"}</p>
          <Button onClick={() => router.push("/generate")} leftIcon={<Sparkles className="w-4 h-4" />}>เริ่มสร้าง</Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {generations.map((gen, i) => (
              <motion.div key={gen.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                <div className="card-interactive aspect-square rounded-2xl overflow-hidden cursor-pointer group relative" onClick={() => setSelectedItem(gen)}>
                  {gen.type === "video" ? (
                    <video src={gen.thumbnailUrl || gen.resultUrl} className="w-full h-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={gen.thumbnailUrl || gen.resultUrl} alt={gen.prompt} className="w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="text-xs text-white/80 line-clamp-2">{gen.prompt}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-white/60">{gen.model?.provider}</span>
                        <div className="flex items-center gap-2">
                          <button onClick={(e) => { e.stopPropagation(); toggleFavorite(gen, e); }} className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all cursor-pointer">
                            <Heart className={`w-3.5 h-3.5 ${gen.isFavorited ? "text-red-400 fill-red-400" : "text-white/60"}`} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDownload(gen, e); }} className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all cursor-pointer">
                            <Download className="w-3.5 h-3.5 text-white/60" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {gen.type === "video" && <Badge variant="glass" size="sm" className="absolute top-2 right-2"><Video className="w-3 h-3" /> Video</Badge>}
                  {gen.type === "edit" && <Badge variant="glass" size="sm" className="absolute top-2 right-2"><Wand2 className="w-3 h-3" /> Edit</Badge>}
                </div>
              </motion.div>
            ))}
          </div>
          {page < totalPages && (
            <div className="text-center mt-8">
              <Button variant="secondary" onClick={() => fetchData(page + 1, true)} loading={loadingMore} leftIcon={<ChevronDown className="w-4 h-4" />}>
                {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!selectedItem} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        {selectedItem && (
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <Badge variant="glass">{selectedItem.model?.provider}</Badge>
                <DialogTitle className="text-base">{selectedItem.model?.name}</DialogTitle>
              </div>
            </DialogHeader>
            {selectedItem.type === "video" ? (
              <video src={selectedItem.resultUrl} controls autoPlay className="w-full rounded-xl" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedItem.resultUrl} alt={selectedItem.prompt} className="w-full rounded-xl max-h-[60vh] object-contain" />
            )}
            <p className="text-sm mt-2">{selectedItem.prompt}</p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted mt-2">
              <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> {selectedItem.creditsUsed} เครดิต</span>
              {selectedItem.processingMs && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {(selectedItem.processingMs / 1000).toFixed(1)}s</span>}
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(selectedItem.createdAt).toLocaleString("th-TH")}</span>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button variant="secondary" size="sm" onClick={() => handleDownload(selectedItem)} leftIcon={<Download className="w-4 h-4" />}>ดาวน์โหลด</Button>
              <Button variant="secondary" size="sm" onClick={() => toggleFavorite(selectedItem)} className={selectedItem.isFavorited ? "text-error" : ""} leftIcon={<Heart className={`w-4 h-4 ${selectedItem.isFavorited ? "fill-current" : ""}`} />}>
                {selectedItem.isFavorited ? "บันทึกแล้ว" : "บันทึก"}
              </Button>
              {selectedItem.type !== "video" && (
                <Button variant="outline" size="sm" onClick={() => handleUpscale(selectedItem)} leftIcon={<ZoomIn className="w-4 h-4" />}>Upscale</Button>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
