"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, Search, Coins, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  aiCredits: { balance: number; totalBought: number; totalUsed: number; totalBonus: number } | null;
  _count: { aiGenerations: number };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [adjust, setAdjust] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fetchUsers = useCallback((p: number, q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "20" });
    if (q) params.set("search", q);
    fetch(`/api/admin/users?${params}`)
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setPages(d.pages || 1); setTotal(d.total || 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(page, search); }, [page, fetchUsers]);

  const onSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchUsers(1, search); };

  const submitAdjust = async () => {
    if (!adjust) return;
    setSaving(true); setErr("");
    const res = await fetch(`/api/admin/users/${adjust.id}/credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseInt(amount, 10), description: desc }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(data.error || "ปรับเครดิตไม่สำเร็จ"); return; }
    setAdjust(null); setAmount(""); setDesc("");
    fetchUsers(page, search);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary-light" /> ผู้ใช้ &amp; เครดิต
          </h1>
          <p className="text-sm text-muted mt-1">ดูสมาชิกและปรับเครดิต AI ({total.toLocaleString()} คน)</p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={onSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ/อีเมล"
                className="pl-9 pr-3 py-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>
          </form>
          <button onClick={() => fetchUsers(page, search)} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">ผู้ใช้</th>
              <th className="text-center p-3 text-muted font-medium">บทบาท</th>
              <th className="text-center p-3 text-muted font-medium">คงเหลือ</th>
              <th className="text-center p-3 text-muted font-medium">ซื้อ / ใช้ / โบนัส</th>
              <th className="text-center p-3 text-muted font-medium">ผลงาน</th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">กำลังโหลด...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">ไม่พบผู้ใช้</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                  <td className="p-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${u.role === "user" ? "bg-surface-light" : "bg-primary/20 text-primary-light"}`}>{u.role}</span>
                    {!u.isActive && <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-error/20 text-error">ปิด</span>}
                  </td>
                  <td className="p-3 text-center font-semibold text-success">{(u.aiCredits?.balance ?? 0).toLocaleString()}</td>
                  <td className="p-3 text-center text-xs text-muted">
                    {(u.aiCredits?.totalBought ?? 0).toLocaleString()} / {(u.aiCredits?.totalUsed ?? 0).toLocaleString()} / {(u.aiCredits?.totalBonus ?? 0).toLocaleString()}
                  </td>
                  <td className="p-3 text-center">{u._count.aiGenerations.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => { setAdjust(u); setAmount(""); setDesc(""); setErr(""); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-xs font-medium">
                      <Coins className="w-3.5 h-3.5" /> ปรับเครดิต
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-2 rounded-lg glass-light disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-muted">หน้า {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-2 rounded-lg glass-light disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}

      {/* Adjust modal */}
      {adjust && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAdjust(null)}>
          <motion.div className="glass rounded-2xl p-6 w-full max-w-md" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">ปรับเครดิต</h3>
            <p className="text-sm text-muted mb-4">{adjust.name} · คงเหลือ {(adjust.aiCredits?.balance ?? 0).toLocaleString()}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">จำนวน (ลบ = หัก)</label>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="เช่น 100 หรือ -50"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">หมายเหตุ</label>
                <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="เหตุผลในการปรับ"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              {err && <div className="text-xs text-error">{err}</div>}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setAdjust(null)} className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground">ยกเลิก</button>
              <button onClick={submitAdjust} disabled={saving || !amount} className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium disabled:opacity-50">
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
