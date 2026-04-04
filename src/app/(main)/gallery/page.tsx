"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  Heart,
  Download,
  Search,
  Filter,
  Image as ImageIcon,
  Video,
  Clock,
  X,
} from "lucide-react";

interface Generation {
  id: number;
  type: string;
  status: string;
  prompt: string;
  resultUrl: string;
  thumbnailUrl: string;
  model: { name: string; provider: { name: string } };
  creditsUsed: number;
  createdAt: string;
  isFavorited: boolean;
}

export default function GalleryPage() {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<Generation | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch(`/api/gallery?filter=${filter}&search=${search}`)
      .then((r) => r.json())
      .then((data) => {
        setGenerations(data.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session, filter, search]);

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

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา prompt..."
              className="pl-9 pr-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg glass-light">
            {[
              { id: "all", label: "ทั้งหมด", icon: Filter },
              { id: "image", label: "ภาพ", icon: ImageIcon },
              { id: "video", label: "วิดีโอ", icon: Video },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as typeof filter)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  filter === f.id ? "bg-primary/20 text-primary-light" : "text-muted hover:text-foreground"
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
          <h3 className="text-lg font-medium text-muted mb-2">ยังไม่มีผลงาน</h3>
          <p className="text-sm text-muted/60">เริ่มสร้างภาพหรือวิดีโอ AI กันเลย!</p>
          <a href="/generate" className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium mt-4 hover:shadow-lg hover:shadow-primary/30 transition-all">
            เริ่มสร้าง
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {generations.map((gen, i) => (
            <motion.div
              key={gen.id}
              className="group relative aspect-square rounded-xl overflow-hidden cursor-pointer glass"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedItem(gen)}
            >
              {gen.type === "video" ? (
                <video
                  src={gen.thumbnailUrl || gen.resultUrl}
                  className="w-full h-full object-cover"
                  muted
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={gen.thumbnailUrl || gen.resultUrl}
                  alt={gen.prompt}
                  className="w-full h-full object-cover"
                />
              )}

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-xs text-white/80 line-clamp-2">{gen.prompt}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-white/60">{gen.model?.provider?.name}</span>
                    <div className="flex items-center gap-2">
                      <button className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
                        <Heart className={`w-3.5 h-3.5 ${gen.isFavorited ? "text-red-400 fill-red-400" : "text-white/60"}`} />
                      </button>
                      <button className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
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
            </motion.div>
          ))}
        </div>
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
              className="glass rounded-2xl p-4 max-w-4xl w-full max-h-[90vh] overflow-auto"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-muted flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {new Date(selectedItem.createdAt).toLocaleString("th-TH")}
                </div>
                <button onClick={() => setSelectedItem(null)} className="p-1 rounded-lg hover:bg-surface-light">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {selectedItem.type === "video" ? (
                <video src={selectedItem.resultUrl} controls className="w-full rounded-xl" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedItem.resultUrl} alt={selectedItem.prompt} className="w-full rounded-xl" />
              )}

              <div className="mt-4">
                <p className="text-sm mb-2">{selectedItem.prompt}</p>
                <div className="flex items-center gap-4 text-xs text-muted">
                  <span>{selectedItem.model?.name}</span>
                  <span>{selectedItem.model?.provider?.name}</span>
                  <span>{selectedItem.creditsUsed} เครดิต</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
