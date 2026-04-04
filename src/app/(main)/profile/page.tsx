"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Coins,
  Image as ImageIcon,
  History,
  CreditCard,
  ArrowRight,
} from "lucide-react";

interface CreditInfo { balance: number; totalBought: number; totalUsed: number; totalBonus: number; }
interface Generation { id: number; type: string; status: string; prompt: string; resultUrl: string | null; thumbnailUrl: string | null; model: { name: string; provider: { name: string } }; creditsUsed: number; createdAt: string; }
interface Transaction { id: number; type: string; amount: number; balanceAfter: number; description: string | null; createdAt: string; }

const transactionTypeLabels: Record<string, string> = { purchase: "ซื้อเครดิต", usage: "ใช้เครดิต", bonus: "โบนัส", admin_adjust: "ปรับโดยแอดมิน", refund: "คืนเครดิต", referral_commission: "ค่าคอมมิชชั่น" };
const transactionTypeColors: Record<string, string> = { purchase: "text-success", usage: "text-error", bonus: "text-primary-light", admin_adjust: "text-warning", refund: "text-success", referral_commission: "text-accent-light" };

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const [loadingGens, setLoadingGens] = useState(true);
  const [loadingTxns, setLoadingTxns] = useState(true);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/credits").then((r) => r.json()).then((data) => { setCredits(data); setLoadingCredits(false); }).catch(() => setLoadingCredits(false));
    fetch("/api/gallery?limit=6").then((r) => r.json()).then((data) => { setGenerations(data.data || []); setLoadingGens(false); }).catch(() => setLoadingGens(false));
    fetch("/api/credits/history").then((r) => r.json()).then((data) => { setTransactions(data.data || []); setLoadingTxns(false); }).catch(() => setLoadingTxns(false));
  }, [status]);

  if (status === "loading" || status === "unauthenticated") {
    return (<div className="max-w-7xl mx-auto px-4 py-20"><div className="flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></div>);
  }

  const user = session?.user;
  const initial = user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <motion.div className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold flex items-center gap-2"><User className="w-7 h-7 text-primary-light" /> โปรไฟล์</h1>
        <p className="text-muted mt-1">จัดการบัญชีและดูสถิติการใช้งาน</p>
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card variant="elevated" className="p-6">
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4 neu-raised">
                  <span className="text-3xl font-bold text-white">{initial}</span>
                </div>
                <h2 className="text-xl font-bold">{user?.name || "ผู้ใช้"}</h2>
                <p className="text-sm text-muted mt-1">{user?.email}</p>
              </div>
              <div className="mt-6 space-y-2">
                <Link href="/generate">
                  <Button variant="secondary" className="w-full justify-between" rightIcon={<ArrowRight className="w-4 h-4 text-muted" />} leftIcon={<ImageIcon className="w-4 h-4 text-primary-light" />}>
                    สร้างภาพ
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button variant="secondary" className="w-full justify-between" rightIcon={<ArrowRight className="w-4 h-4 text-muted" />} leftIcon={<CreditCard className="w-4 h-4 text-primary-light" />}>
                    ซื้อเครดิต
                  </Button>
                </Link>
                <Link href="/referral">
                  <Button variant="secondary" className="w-full justify-between" rightIcon={<ArrowRight className="w-4 h-4 text-muted" />} leftIcon={<User className="w-4 h-4 text-accent-light" />}>
                    ชวนเพื่อน
                  </Button>
                </Link>
              </div>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card variant="elevated" className="p-6">
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4"><Coins className="w-5 h-5 text-primary-light" /> เครดิตของคุณ</h3>
              {loadingCredits ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-12 rounded-xl animate-shimmer" />))}</div>
              ) : credits ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 neu-raised-sm">
                    <p className="text-xs text-muted mb-1">ยอดคงเหลือ</p>
                    <p className="text-3xl font-bold gradient-text">{credits.balance.toLocaleString()}</p>
                    <p className="text-xs text-muted mt-1">เครดิต</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "ซื้อแล้ว", value: credits.totalBought, color: "text-success" },
                      { label: "ใช้ไป", value: credits.totalUsed, color: "text-error" },
                      { label: "โบนัส", value: credits.totalBonus, color: "text-primary-light" },
                    ].map((stat) => (
                      <div key={stat.label} className="p-3 rounded-xl neu-inset-sm text-center">
                        <p className={`text-lg font-bold ${stat.color}`}>{stat.value.toLocaleString()}</p>
                        <p className="text-xs text-muted">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (<p className="text-sm text-muted">ไม่สามารถโหลดข้อมูลเครดิตได้</p>)}
            </Card>
          </motion.div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card variant="elevated" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2"><ImageIcon className="w-5 h-5 text-primary-light" /> ผลงานล่าสุด</h3>
                <Link href="/gallery" className="text-sm text-primary-light hover:underline flex items-center gap-1">ดูทั้งหมด <ArrowRight className="w-3.5 h-3.5" /></Link>
              </div>
              {loadingGens ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => (<div key={i} className="aspect-square rounded-xl animate-shimmer" />))}</div>
              ) : generations.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-2xl bg-surface-light/50 flex items-center justify-center mx-auto mb-3 neu-raised-sm"><ImageIcon className="w-8 h-8 text-muted/30" /></div>
                  <p className="text-sm text-muted mb-3">ยังไม่มีผลงาน</p>
                  <Link href="/generate"><Button size="sm" leftIcon={<ArrowRight className="w-4 h-4" />}>เริ่มสร้าง</Button></Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {generations.map((gen, i) => (
                    <motion.div key={gen.id} className="group relative aspect-square rounded-xl overflow-hidden card-interactive" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.05 }}>
                      {gen.resultUrl || gen.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={gen.thumbnailUrl || gen.resultUrl || ""} alt={gen.prompt || ""} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-muted/30" /></div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="absolute bottom-0 left-0 right-0 p-2">
                          <p className="text-xs text-white/80 line-clamp-2">{gen.prompt}</p>
                          <p className="text-xs text-white/50 mt-1">{gen.model?.name} &middot; {gen.creditsUsed} เครดิต</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card variant="elevated" className="p-6">
              <h3 className="text-lg font-bold flex items-center gap-2 mb-4"><History className="w-5 h-5 text-primary-light" /> ประวัติเครดิต</h3>
              {loadingTxns ? (
                <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (<div key={i} className="h-14 rounded-xl animate-shimmer" />))}</div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-surface-light/50 flex items-center justify-center mx-auto mb-3 neu-raised-sm"><History className="w-8 h-8 text-muted/30" /></div>
                  <p className="text-sm text-muted">ยังไม่มีรายการ</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.slice(0, 10).map((txn) => (
                    <div key={txn.id} className="flex items-center justify-between px-4 py-3 rounded-xl neu-inset-sm">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{transactionTypeLabels[txn.type] || txn.type}</span>
                        <p className="text-xs text-muted truncate mt-0.5">{txn.description || "-"}</p>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className={`text-sm font-bold ${transactionTypeColors[txn.type] || "text-foreground"}`}>
                          {txn.amount > 0 ? "+" : ""}{txn.amount.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted">{new Date(txn.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
