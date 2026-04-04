"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Database,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Trash2,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Server,
} from "lucide-react";

interface PoolAccount {
  id: number;
  label: string;
  provider: string;
  providerSlug: string;
  isActive: boolean;
  priority: number;
  rotationMode: string;
  usageToday: number;
  dailyQuota: number;
  monthlyQuota: number;
  usageThisMonth: number;
  totalUsage: number;
  consecutiveErrors: number;
  errorCount: number;
  cooldownUntil?: string;
  lastUsedAt?: string;
  lastError?: string;
}

export default function PoolsPage() {
  const [accounts, setAccounts] = useState<PoolAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAccount, setNewAccount] = useState({ providerId: "", label: "", apiKey: "", apiSecret: "", dailyQuota: "1000", priority: "50", rotationMode: "round_robin" });

  const fetchPools = () => {
    setLoading(true);
    fetch("/api/admin/pools")
      .then((r) => r.json())
      .then((data) => { setAccounts(data.accounts || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchPools(); }, []);

  const toggleAccount = async (id: number, active: boolean) => {
    await fetch(`/api/admin/pools/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !active }),
    });
    fetchPools();
  };

  const resetErrors = async (id: number) => {
    await fetch(`/api/admin/pools/${id}/reset`, { method: "POST" });
    fetchPools();
  };

  const handleAdd = async () => {
    await fetch("/api/admin/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAccount),
    });
    setShowAddModal(false);
    setNewAccount({ providerId: "", label: "", apiKey: "", apiSecret: "", dailyQuota: "1000", priority: "50", rotationMode: "round_robin" });
    fetchPools();
  };

  const getStatusColor = (acc: PoolAccount) => {
    if (!acc.isActive) return "text-muted";
    if (acc.cooldownUntil && new Date(acc.cooldownUntil) > new Date()) return "text-warning";
    if (acc.consecutiveErrors >= 3) return "text-error";
    return "text-success";
  };

  const getStatusIcon = (acc: PoolAccount) => {
    if (!acc.isActive) return <ToggleLeft className="w-4 h-4 text-muted" />;
    if (acc.cooldownUntil && new Date(acc.cooldownUntil) > new Date()) return <Clock className="w-4 h-4 text-warning" />;
    if (acc.consecutiveErrors >= 3) return <AlertCircle className="w-4 h-4 text-error" />;
    return <CheckCircle2 className="w-4 h-4 text-success" />;
  };

  const rotationModeLabel: Record<string, string> = {
    round_robin: "Round Robin",
    balanced: "Balanced",
    quota_first: "Quota First",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-6 h-6 text-primary-light" />
            Account Pools
          </h1>
          <p className="text-sm text-muted mt-1">จัดการ API accounts สำหรับแต่ละ provider</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchPools} className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium">
            <Plus className="w-4 h-4" /> เพิ่ม Account
          </button>
        </div>
      </div>

      {/* Rotation Mode Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Round Robin = เวียนไปเรื่อยๆ</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Balanced = เฉลี่ยเท่ากัน</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Quota First = เหลือเยอะก่อน</span>
      </div>

      {/* Accounts table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">สถานะ</th>
              <th className="text-left p-3 text-muted font-medium">Account</th>
              <th className="text-left p-3 text-muted font-medium">Provider</th>
              <th className="text-center p-3 text-muted font-medium">โหมด</th>
              <th className="text-center p-3 text-muted font-medium">Priority</th>
              <th className="text-center p-3 text-muted font-medium">Usage วันนี้</th>
              <th className="text-center p-3 text-muted font-medium">Errors</th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted">กำลังโหลด...</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted">ยังไม่มี account pools — กด &quot;เพิ่ม Account&quot; เพื่อเริ่มต้น</td></tr>
            ) : (
              accounts.map((acc) => (
                <tr key={acc.id} className="border-b border-border/50 hover:bg-surface-light/30 transition-colors">
                  <td className="p-3">{getStatusIcon(acc)}</td>
                  <td className="p-3 font-medium">{acc.label}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-surface-light text-xs">{acc.provider}</span>
                  </td>
                  <td className="p-3 text-center text-xs">{rotationModeLabel[acc.rotationMode] || acc.rotationMode}</td>
                  <td className="p-3 text-center">{acc.priority}</td>
                  <td className="p-3 text-center">
                    <span className={getStatusColor(acc)}>
                      {acc.usageToday}{acc.dailyQuota > 0 ? `/${acc.dailyQuota}` : ""}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {acc.consecutiveErrors > 0 && (
                      <span className="text-error">{acc.consecutiveErrors}</span>
                    )}
                    {acc.consecutiveErrors === 0 && <span className="text-muted">0</span>}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleAccount(acc.id, acc.isActive)}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title={acc.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                      >
                        {acc.isActive ? <ToggleRight className="w-4 h-4 text-success" /> : <ToggleLeft className="w-4 h-4 text-muted" />}
                      </button>
                      {acc.consecutiveErrors > 0 && (
                        <button onClick={() => resetErrors(acc.id)} className="p-1.5 rounded-lg hover:bg-surface-light transition-all" title="รีเซ็ต errors">
                          <RefreshCw className="w-3.5 h-3.5 text-warning" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <motion.div
            className="glass rounded-2xl p-6 w-full max-w-md"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">เพิ่ม Account Pool</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Label</label>
                <input value={newAccount.label} onChange={(e) => setNewAccount({...newAccount, label: e.target.value})} placeholder="เช่น BytePlus Account #1" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">API Key</label>
                <input value={newAccount.apiKey} onChange={(e) => setNewAccount({...newAccount, apiKey: e.target.value})} type="password" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Rotation Mode</label>
                <select value={newAccount.rotationMode} onChange={(e) => setNewAccount({...newAccount, rotationMode: e.target.value})} className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50">
                  <option value="round_robin">Round Robin (เวียนไปเรื่อยๆ)</option>
                  <option value="balanced">Balanced (เฉลี่ย)</option>
                  <option value="quota_first">Quota First (เหลือเยอะก่อน)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Daily Quota</label>
                  <input value={newAccount.dailyQuota} onChange={(e) => setNewAccount({...newAccount, dailyQuota: e.target.value})} type="number" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">Priority (1-100)</label>
                  <input value={newAccount.priority} onChange={(e) => setNewAccount({...newAccount, priority: e.target.value})} type="number" className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground">ยกเลิก</button>
              <button onClick={handleAdd} className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium">บันทึก</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
