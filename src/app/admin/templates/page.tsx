"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { LayoutTemplate, Plus, RefreshCw, Trash2, Edit2, ToggleLeft, ToggleRight, Star } from "lucide-react";

interface Template {
  id: number;
  name: string;
  description: string | null;
  category: string;
  prompt: string;
  negativePrompt: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  usageCount: number;
}

type Draft = {
  id?: number; name: string; category: string; description: string;
  prompt: string; negativePrompt: string; sortOrder: string; isFeatured: boolean;
};
const EMPTY: Draft = { name: "", category: "image", description: "", prompt: "", negativePrompt: "", sortOrder: "0", isFeatured: false };

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fetchTemplates = () => {
    setLoading(true);
    fetch("/api/admin/templates").then((r) => r.json()).then((d) => { setTemplates(d.templates || []); setLoading(false); }).catch(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchTemplates(); }, []);

  const toggle = async (t: Template, field: "isActive" | "isFeatured") => {
    await fetch(`/api/admin/templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: !t[field] }) });
    fetchTemplates();
  };

  const remove = async (id: number) => {
    if (!confirm("ลบเทมเพลตนี้?")) return;
    await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
    fetchTemplates();
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true); setErr("");
    const isEdit = !!editing.id;
    const res = await fetch(isEdit ? `/api/admin/templates/${editing.id}` : "/api/admin/templates", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name, category: editing.category, description: editing.description,
        prompt: editing.prompt, negativePrompt: editing.negativePrompt,
        isFeatured: editing.isFeatured, sortOrder: parseInt(editing.sortOrder, 10) || 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(data.error || "บันทึกไม่สำเร็จ"); return; }
    setEditing(null); fetchTemplates();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutTemplate className="w-6 h-6 text-primary-light" /> เทมเพลต (Templates)</h1>
          <p className="text-sm text-muted mt-1">prompt สำเร็จรูปให้ผู้ใช้กดเลือกในหน้าสร้างผลงาน</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchTemplates} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => { setEditing({ ...EMPTY }); setErr(""); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium">
            <Plus className="w-4 h-4" /> เพิ่มเทมเพลต
          </button>
        </div>
      </div>

      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">สถานะ</th>
              <th className="text-left p-3 text-muted font-medium">ชื่อ</th>
              <th className="text-left p-3 text-muted font-medium">หมวด</th>
              <th className="text-left p-3 text-muted font-medium">Prompt</th>
              <th className="text-center p-3 text-muted font-medium">ใช้แล้ว</th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">กำลังโหลด...</td></tr>
            ) : templates.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">ยังไม่มีเทมเพลต — กด &quot;เพิ่มเทมเพลต&quot; เพื่อเริ่ม</td></tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggle(t, "isActive")} title={t.isActive ? "ปิด" : "เปิด"}>
                        {t.isActive ? <ToggleRight className="w-5 h-5 text-success" /> : <ToggleLeft className="w-5 h-5 text-muted" />}
                      </button>
                      <button onClick={() => toggle(t, "isFeatured")} title="แนะนำ">
                        <Star className={`w-4 h-4 ${t.isFeatured ? "text-warning fill-warning" : "text-muted"}`} />
                      </button>
                    </div>
                  </td>
                  <td className="p-3 font-medium">{t.name}</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded-full bg-surface-light text-xs">{t.category}</span></td>
                  <td className="p-3 text-muted text-xs max-w-[280px] truncate">{t.prompt}</td>
                  <td className="p-3 text-center">{t.usageCount}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditing({ id: t.id, name: t.name, category: t.category, description: t.description || "", prompt: t.prompt, negativePrompt: t.negativePrompt || "", sortOrder: String(t.sortOrder), isFeatured: t.isFeatured })}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all" title="แก้ไข"><Edit2 className="w-4 h-4 text-primary-light" /></button>
                      <button onClick={() => remove(t.id)} className="p-1.5 rounded-lg hover:bg-surface-light transition-all" title="ลบ"><Trash2 className="w-4 h-4 text-error" /></button>
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
          <motion.div className="glass rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">{editing.id ? "แก้ไขเทมเพลต" : "เพิ่มเทมเพลต"}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">ชื่อ</label>
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">หมวดหมู่</label>
                  <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none">
                    <option value="image">image</option>
                    <option value="video">video</option>
                    <option value="portrait">portrait</option>
                    <option value="art">art</option>
                    <option value="photo">photo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Prompt</label>
                <textarea value={editing.prompt} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} rows={3} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Negative prompt</label>
                <textarea value={editing.negativePrompt} onChange={(e) => setEditing({ ...editing, negativePrompt: e.target.value })} rows={2} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
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
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={editing.isFeatured} onChange={(e) => setEditing({ ...editing, isFeatured: e.target.checked })} />
                แนะนำ (featured)
              </label>
              {err && <div className="text-xs text-error">{err}</div>}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground">ยกเลิก</button>
              <button onClick={save} disabled={saving || !editing.name || !editing.prompt} className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-50">{saving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
