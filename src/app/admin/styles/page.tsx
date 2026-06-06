"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Palette, Plus, RefreshCw, Trash2, Edit2, ToggleLeft, ToggleRight } from "lucide-react";

interface Style {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  promptSuffix: string | null;
  isActive: boolean;
  sortOrder: number;
}

type Draft = { id?: number; name: string; slug: string; description: string; promptSuffix: string; sortOrder: string };
const EMPTY: Draft = { name: "", slug: "", description: "", promptSuffix: "", sortOrder: "0" };

export default function AdminStylesPage() {
  const [styles, setStyles] = useState<Style[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fetchStyles = () => {
    setLoading(true);
    fetch("/api/admin/styles").then((r) => r.json()).then((d) => { setStyles(d.styles || []); setLoading(false); }).catch(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchStyles(); }, []);

  const toggle = async (s: Style) => {
    await fetch(`/api/admin/styles/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !s.isActive }) });
    fetchStyles();
  };

  const remove = async (id: number) => {
    if (!confirm("ลบสไตล์นี้?")) return;
    await fetch(`/api/admin/styles/${id}`, { method: "DELETE" });
    fetchStyles();
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr("");
    const isEdit = !!editing.id;
    const res = await fetch(isEdit ? `/api/admin/styles/${editing.id}` : "/api/admin/styles", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name, slug: editing.slug, description: editing.description,
        promptSuffix: editing.promptSuffix, sortOrder: parseInt(editing.sortOrder, 10) || 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(data.error || "บันทึกไม่สำเร็จ"); return; }
    setEditing(null); fetchStyles();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Palette className="w-6 h-6 text-primary-light" /> สไตล์ (Styles)</h1>
          <p className="text-sm text-muted mt-1">สไตล์ที่ผู้ใช้เลือกได้ในหน้าสร้างผลงาน (เติมท้าย prompt)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchStyles} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => { setEditing({ ...EMPTY }); setErr(""); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium">
            <Plus className="w-4 h-4" /> เพิ่มสไตล์
          </button>
        </div>
      </div>

      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">สถานะ</th>
              <th className="text-left p-3 text-muted font-medium">ชื่อ</th>
              <th className="text-left p-3 text-muted font-medium">Slug</th>
              <th className="text-left p-3 text-muted font-medium">Prompt suffix</th>
              <th className="text-center p-3 text-muted font-medium">ลำดับ</th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">กำลังโหลด...</td></tr>
            ) : styles.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">ยังไม่มีสไตล์ — กด &quot;เพิ่มสไตล์&quot; เพื่อเริ่ม</td></tr>
            ) : (
              styles.map((s) => (
                <tr key={s.id} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                  <td className="p-3">
                    <button onClick={() => toggle(s)} title={s.isActive ? "ปิด" : "เปิด"}>
                      {s.isActive ? <ToggleRight className="w-5 h-5 text-success" /> : <ToggleLeft className="w-5 h-5 text-muted" />}
                    </button>
                  </td>
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 text-muted text-xs font-mono">{s.slug}</td>
                  <td className="p-3 text-muted text-xs max-w-[260px] truncate">{s.promptSuffix || "—"}</td>
                  <td className="p-3 text-center">{s.sortOrder}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditing({ id: s.id, name: s.name, slug: s.slug, description: s.description || "", promptSuffix: s.promptSuffix || "", sortOrder: String(s.sortOrder) })}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all" title="แก้ไข"><Edit2 className="w-4 h-4 text-primary-light" /></button>
                      <button onClick={() => remove(s.id)} className="p-1.5 rounded-lg hover:bg-surface-light transition-all" title="ลบ"><Trash2 className="w-4 h-4 text-error" /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <motion.div className="glass rounded-2xl p-6 w-full max-w-md" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editing.id ? "แก้ไขสไตล์" : "เพิ่มสไตล์"}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">ชื่อ</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Slug</label>
                <input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="เช่น cinematic" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Prompt suffix (เติมท้าย prompt)</label>
                <input value={editing.promptSuffix} onChange={(e) => setEditing({ ...editing, promptSuffix: e.target.value })} placeholder="เช่น cinematic lighting, 8k" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">คำอธิบาย</label>
                  <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">ลำดับ</label>
                  <input value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value })} type="number" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
              </div>
              {err && <div className="text-xs text-error">{err}</div>}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground">ยกเลิก</button>
              <button onClick={save} disabled={saving || !editing.name || !editing.slug} className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-50">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
