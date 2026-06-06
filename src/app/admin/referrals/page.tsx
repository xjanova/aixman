"use client";

import { useState, useEffect, useCallback } from "react";
import { Share2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

interface Referral {
  id: number;
  code: string;
  bonusCredits: number;
  joinedAt: string;
  referrer: { id: number; name: string; email: string };
  referred: { id: number; name: string; email: string } | null;
  commissionTotal: number;
  commissionCount: number;
}

interface Summary {
  totalReferred: number;
  totalCommissionCredits: number;
  totalSignupBonusCredits: number;
}

export default function AdminReferralsPage() {
  const [items, setItems] = useState<Referral[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const fetchData = useCallback((p: number) => {
    setLoading(true);
    fetch(`/api/admin/referrals?page=${p}&limit=20`)
      .then((r) => r.json())
      .then((d) => { setItems(d.data || []); setSummary(d.summary || null); setPages(d.pages || 1); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(page); }, [page, fetchData]);

  const cards = [
    { l: "ผู้ถูกชวนทั้งหมด", v: summary?.totalReferred ?? 0 },
    { l: "เครดิตคอมมิชชั่นจ่ายแล้ว", v: summary?.totalCommissionCredits ?? 0 },
    { l: "โบนัสชวนเพื่อนรวม", v: summary?.totalSignupBonusCredits ?? 0 },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Share2 className="w-6 h-6 text-primary-light" /> ชวนเพื่อน (Referral)</h1>
          <p className="text-sm text-muted mt-1">ภาพรวมการชวนเพื่อนและคอมมิชชั่นที่จ่าย</p>
        </div>
        <button onClick={() => fetchData(page)} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {cards.map((c, i) => (
          <div key={i} className="glass rounded-xl p-4">
            <div className="text-xs text-muted">{c.l}</div>
            <div className="text-2xl font-semibold mt-1 text-primary-light">{c.v.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">วันที่</th>
              <th className="text-left p-3 text-muted font-medium">ผู้ชวน</th>
              <th className="text-left p-3 text-muted font-medium">ผู้ถูกชวน</th>
              <th className="text-center p-3 text-muted font-medium">โบนัส</th>
              <th className="text-center p-3 text-muted font-medium">คอมมิชชั่น</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted">กำลังโหลด...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted">ยังไม่มีการชวนเพื่อน</td></tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                  <td className="p-3 text-xs text-muted whitespace-nowrap">{new Date(r.joinedAt).toLocaleDateString("th-TH", { dateStyle: "medium" })}</td>
                  <td className="p-3">
                    <div className="text-xs font-medium">{r.referrer.name}</div>
                    <div className="text-[10px] text-muted">{r.referrer.email}</div>
                  </td>
                  <td className="p-3">
                    <div className="text-xs font-medium">{r.referred?.name || "—"}</div>
                    <div className="text-[10px] text-muted">{r.referred?.email}</div>
                  </td>
                  <td className="p-3 text-center text-primary-light">{r.bonusCredits.toLocaleString()}</td>
                  <td className="p-3 text-center">
                    <span className="text-success font-medium">{r.commissionTotal.toLocaleString()}</span>
                    {r.commissionCount > 0 && <span className="text-[10px] text-muted ml-1">({r.commissionCount})</span>}
                  </td>
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
