"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  User,
  Coins,
  Image as ImageIcon,
  History,
  CreditCard,
  ArrowRight,
} from "lucide-react";

interface CreditInfo {
  balance: number;
  totalBought: number;
  totalUsed: number;
  totalBonus: number;
}

interface Generation {
  id: number;
  type: string;
  status: string;
  prompt: string;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  model: { name: string; provider: { name: string } };
  creditsUsed: number;
  createdAt: string;
}

interface Transaction {
  id: number;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

const transactionTypeLabels: Record<string, string> = {
  purchase: "ซื้อเครดิต",
  usage: "ใช้เครดิต",
  bonus: "โบนัส",
  admin_adjust: "ปรับโดยแอดมิน",
  refund: "คืนเครดิต",
};

const transactionTypeColors: Record<string, string> = {
  purchase: "text-success",
  usage: "text-error",
  bonus: "text-primary-light",
  admin_adjust: "text-warning",
  refund: "text-success",
};

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(true);
  const [loadingGens, setLoadingGens] = useState(true);
  const [loadingTxns, setLoadingTxns] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;

    // Fetch credit balance
    fetch("/api/credits")
      .then((r) => r.json())
      .then((data) => {
        setCredits(data);
        setLoadingCredits(false);
      })
      .catch(() => setLoadingCredits(false));

    // Fetch recent generations
    fetch("/api/gallery?limit=6")
      .then((r) => r.json())
      .then((data) => {
        setGenerations(data.data || []);
        setLoadingGens(false);
      })
      .catch(() => setLoadingGens(false));

    // Fetch transaction history
    fetch("/api/credits/history")
      .then((r) => r.json())
      .then((data) => {
        setTransactions(data.data || []);
        setLoadingTxns(false);
      })
      .catch(() => setLoadingTxns(false));
  }, [status]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20">
        <div className="flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const user = session?.user;
  const initial = user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <User className="w-7 h-7 text-primary-light" />
          โปรไฟล์
        </h1>
        <p className="text-muted mt-1">จัดการบัญชีและดูสถิติการใช้งาน</p>
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-1 space-y-6">
          {/* User Card */}
          <motion.div
            className="glass rounded-2xl p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4">
                <span className="text-3xl font-bold text-white">{initial}</span>
              </div>
              <h2 className="text-xl font-bold">{user?.name || "ผู้ใช้"}</h2>
              <p className="text-sm text-muted mt-1">{user?.email}</p>
            </div>

            <div className="mt-6 space-y-2">
              <Link
                href="/generate"
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl glass-light hover:bg-surface-light transition-all text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-primary-light" />
                  สร้างภาพ
                </span>
                <ArrowRight className="w-4 h-4 text-muted" />
              </Link>
              <Link
                href="/pricing"
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl glass-light hover:bg-surface-light transition-all text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary-light" />
                  ซื้อเครดิต
                </span>
                <ArrowRight className="w-4 h-4 text-muted" />
              </Link>
            </div>
          </motion.div>

          {/* Credit Stats */}
          <motion.div
            className="glass rounded-2xl p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <Coins className="w-5 h-5 text-primary-light" />
              เครดิตของคุณ
            </h3>

            {loadingCredits ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-xl animate-shimmer" />
                ))}
              </div>
            ) : credits ? (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20">
                  <p className="text-xs text-muted mb-1">ยอดคงเหลือ</p>
                  <p className="text-3xl font-bold gradient-text">
                    {credits.balance.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted mt-1">เครดิต</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 rounded-xl glass-light text-center">
                    <p className="text-lg font-bold text-success">
                      {credits.totalBought.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted">ซื้อแล้ว</p>
                  </div>
                  <div className="p-3 rounded-xl glass-light text-center">
                    <p className="text-lg font-bold text-error">
                      {credits.totalUsed.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted">ใช้ไป</p>
                  </div>
                  <div className="p-3 rounded-xl glass-light text-center">
                    <p className="text-lg font-bold text-primary-light">
                      {credits.totalBonus.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted">โบนัส</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">ไม่สามารถโหลดข้อมูลเครดิตได้</p>
            )}
          </motion.div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recent Generations */}
          <motion.div
            className="glass rounded-2xl p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-primary-light" />
                ผลงานล่าสุด
              </h3>
              <Link
                href="/gallery"
                className="text-sm text-primary-light hover:underline flex items-center gap-1"
              >
                ดูทั้งหมด <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {loadingGens ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-xl animate-shimmer" />
                ))}
              </div>
            ) : generations.length === 0 ? (
              <div className="text-center py-12">
                <ImageIcon className="w-12 h-12 text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-muted mb-3">ยังไม่มีผลงาน</p>
                <Link
                  href="/generate"
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium hover:shadow-lg hover:shadow-primary/30 transition-all"
                >
                  เริ่มสร้าง <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {generations.map((gen, i) => (
                  <motion.div
                    key={gen.id}
                    className="group relative aspect-square rounded-xl overflow-hidden glass-light"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 + i * 0.05 }}
                  >
                    {gen.resultUrl || gen.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={gen.thumbnailUrl || gen.resultUrl || ""}
                        alt={gen.prompt || ""}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-muted/30" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <p className="text-xs text-white/80 line-clamp-2">{gen.prompt}</p>
                        <p className="text-xs text-white/50 mt-1">
                          {gen.model?.name} &middot; {gen.creditsUsed} เครดิต
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Transaction History */}
          <motion.div
            className="glass rounded-2xl p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
              <History className="w-5 h-5 text-primary-light" />
              ประวัติเครดิต
            </h3>

            {loadingTxns ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-xl animate-shimmer" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-8">
                <History className="w-12 h-12 text-muted/30 mx-auto mb-3" />
                <p className="text-sm text-muted">ยังไม่มีรายการ</p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.slice(0, 10).map((txn) => (
                  <div
                    key={txn.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl glass-light"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {transactionTypeLabels[txn.type] || txn.type}
                        </span>
                      </div>
                      <p className="text-xs text-muted truncate mt-0.5">
                        {txn.description || "-"}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p
                        className={`text-sm font-bold ${
                          transactionTypeColors[txn.type] || "text-foreground"
                        }`}
                      >
                        {txn.amount > 0 ? "+" : ""}
                        {txn.amount.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(txn.createdAt).toLocaleDateString("th-TH", {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
