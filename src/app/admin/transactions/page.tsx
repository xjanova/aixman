"use client";

import { useState, useEffect, useCallback } from "react";
import { Receipt, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

interface Txn {
  id: number;
  userId: number;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
  package: { name: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  purchase: "ซื้อ", usage: "ใช้", refund: "คืน", bonus: "โบนัส", admin_adjust: "ปรับโดยแอดมิน",
};
const TYPE_COLOR: Record<string, string> = {
  purchase: "text-success", bonus: "text-primary-light", refund: "text-warning", usage: "text-muted", admin_adjust: "text-secondary",
};

export default function AdminTransactionsPage() {
  const [items, setItems] = useState<Txn[]>([]);
  const [summary, setSummary] = useState<{ type: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback((p: number, ty: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "30" });
    if (ty) params.set("type", ty);
    fetch(`/api/admin/transactions?${params}`)
      .then((r) => r.json())
      .then((d) => { setItems(d.data || []); setSummary(d.summary || []); setPages(d.pages || 1); setTotal(d.total || 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(page, type); }, [page, type, fetchData]);

  const summaryFor = (t: string) => summary.find((s) => s.type === t)?.amount ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="w-6 h-6 text-primary-light" /> ประวัติเครดิต</h1>
          <p className="text-sm text-muted mt-1">ธุรกรรมเครดิตทั้งหมดในระบบ ({total.toLocaleString()} รายการ)</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="py-2 px-3 rounded-lg bg-surface-light text-sm focus:outline-none">
            <option value="">ทุกประเภท</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={() => fetchData(page, type)} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {["purchase", "bonus", "usage", "refund", "admin_adjust"].map((t) => (
          <div key={t} className="glass rounded-xl p-3">
            <div className="text-xs text-muted">{TYPE_LABEL[t]}</div>
            <div className={`text-lg font-semibold mt-1 ${TYPE_COLOR[t]}`}>{summaryFor(t).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">เวลา</th>
              <th className="text-left p-3 text-muted font-medium">ผู้ใช้</th>
              <th className="text-center p-3 text-muted font-medium">ประเภท</th>
              <th className="text-left p-3 text-muted font-medium">รายละเอียด</th>
              <th className="text-right p-3 text-muted font-medium">จำนวน</th>
              <th className="text-right p-3 text-muted font-medium">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">กำลังโหลด...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">ไม่พบรายการ</td></tr>
            ) : (
              items.map((t) => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                  <td className="p-3 text-xs text-muted whitespace-nowrap">{new Date(t.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="p-3">
                    <div className="text-xs font-medium">{t.user?.name || `#${t.userId}`}</div>
                    <div className="text-[10px] text-muted">{t.user?.email}</div>
                  </td>
                  <td className="p-3 text-center"><span className={`text-xs ${TYPE_COLOR[t.type] || "text-muted"}`}>{TYPE_LABEL[t.type] || t.type}</span></td>
                  <td className="p-3 text-xs text-muted max-w-[260px] truncate">{t.description || t.package?.name || "—"}</td>
                  <td className={`p-3 text-right font-semibold ${t.amount >= 0 ? "text-success" : "text-error"}`}>{t.amount >= 0 ? "+" : ""}{t.amount.toLocaleString()}</td>
                  <td className="p-3 text-right text-muted">{t.balanceAfter.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-2 rounded-lg glass-light disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-muted">หน้า {page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-2 rounded-lg glass-light disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
