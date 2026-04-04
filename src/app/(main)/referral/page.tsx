"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Copy,
  Share2,
  Gift,
  Coins,
  TrendingUp,
  Clock,
  Check,
} from "lucide-react";

interface ReferralStats {
  referralCode: string;
  totalReferred: number;
  totalCommission: number;
  pendingCommission: number;
  commissionRate: number;
  referrals: {
    id: number;
    referredName: string;
    referredEmail: string;
    joinedAt: string;
    totalCommission: number;
    bonusCredits: number;
  }[];
}

export default function ReferralPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyCode, setApplyCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (session === null) router.push("/login");
  }, [session, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/referral")
      .then((r) => r.json())
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [session]);

  const copyCode = async () => {
    if (!stats?.referralCode) return;
    await navigator.clipboard.writeText(stats.referralCode);
    setCopied(true);
    toast("success", "คัดลอกรหัสแล้ว!");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!stats?.referralCode) return;
    const url = `${window.location.origin}?ref=${stats.referralCode}`;
    if (navigator.share) {
      try { await navigator.share({ title: "XMAN AI - ชวนเพื่อนได้เครดิตฟรี!", url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast("success", "คัดลอกลิงก์แล้ว!");
    }
  };

  const handleApplyCode = async () => {
    if (!applyCode.trim()) return;
    setApplying(true);
    try {
      const res = await fetch("/api/referral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: applyCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast("error", data.error || "ไม่สามารถใช้รหัสได้");
      } else {
        toast("success", data.message || "ใช้รหัสสำเร็จ!");
        setApplyCode("");
        // Refresh stats
        const statsRes = await fetch("/api/referral");
        const newStats = await statsRes.json();
        setStats(newStats);
      }
    } catch { toast("error", "เกิดข้อผิดพลาด"); }
    setApplying(false);
  };

  if (!session) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <motion.div className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="w-7 h-7 text-accent-light" /> ชวนเพื่อน
        </h1>
        <p className="text-muted mt-1">ชวนเพื่อนมาใช้ XMAN AI รับเครดิตฟรีทั้งคู่!</p>
      </motion.div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (<div key={i} className="h-32 rounded-2xl animate-shimmer" />))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Referral Code */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card variant="elevated" className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Gift className="w-5 h-5 text-accent-light" /> รหัสชวนเพื่อนของคุณ
              </h3>
              <div className="flex items-center gap-3">
                <div className="flex-1 p-4 rounded-xl neu-inset text-center">
                  <span className="text-2xl font-mono font-bold tracking-widest gradient-text">
                    {stats?.referralCode || "---"}
                  </span>
                </div>
                <Button variant="secondary" size="icon" onClick={copyCode}>
                  {copied ? <Check className="w-5 h-5 text-success" /> : <Copy className="w-5 h-5" />}
                </Button>
                <Button variant="secondary" size="icon" onClick={shareLink}>
                  <Share2 className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-xs text-muted mt-3 text-center">
                แชร์รหัสนี้ให้เพื่อน เมื่อเพื่อนสมัครและซื้อเครดิต คุณจะได้รับค่าคอมมิชชั่น {stats?.commissionRate || 10}%
              </p>
            </Card>
          </motion.div>

          {/* Stats */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "ชวนแล้ว", value: stats?.totalReferred || 0, icon: Users, color: "text-accent-light" },
                { label: "คอมมิชชั่นรวม", value: stats?.totalCommission || 0, icon: TrendingUp, color: "text-success" },
                { label: "รอดำเนินการ", value: stats?.pendingCommission || 0, icon: Clock, color: "text-warning" },
              ].map((stat) => (
                <Card key={stat.label} variant="default" className="p-4 text-center">
                  <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value.toLocaleString()}</p>
                  <p className="text-xs text-muted mt-1">{stat.label}</p>
                </Card>
              ))}
            </div>
          </motion.div>

          {/* Apply Code */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Coins className="w-5 h-5 text-warning" /> มีรหัสชวนเพื่อน?
              </h3>
              <div className="flex gap-3">
                <Input
                  value={applyCode}
                  onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                  placeholder="กรอกรหัสชวนเพื่อน"
                  className="font-mono tracking-widest"
                />
                <Button onClick={handleApplyCode} loading={applying} disabled={!applyCode.trim()}>
                  ใช้รหัส
                </Button>
              </div>
            </Card>
          </motion.div>

          {/* Referral List */}
          {stats?.referrals && stats.referrals.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <Card variant="elevated" className="p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary-light" /> เพื่อนที่ชวนแล้ว
                </h3>
                <div className="space-y-2">
                  {stats.referrals.map((ref) => (
                    <div key={ref.id} className="flex items-center justify-between px-4 py-3 rounded-xl neu-inset-sm">
                      <div>
                        <p className="text-sm font-medium">{ref.referredName}</p>
                        <p className="text-xs text-muted">{new Date(ref.joinedAt).toLocaleDateString("th-TH")}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="success" size="sm">
                          <Coins className="w-3 h-3" /> +{ref.totalCommission + ref.bonusCredits}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* How it works */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <Card className="p-6">
              <h3 className="text-lg font-bold mb-4">วิธีการทำงาน</h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { step: "1", title: "แชร์รหัส", desc: "ส่งรหัสชวนเพื่อนให้คนที่สนใจ" },
                  { step: "2", title: "เพื่อนสมัคร", desc: "เพื่อนกรอกรหัส ทั้งคู่ได้เครดิตฟรี" },
                  { step: "3", title: "รับคอมมิชชั่น", desc: `เมื่อเพื่อนซื้อเครดิต คุณได้ ${stats?.commissionRate || 10}% ทุกครั้ง` },
                ].map((item) => (
                  <div key={item.step} className="text-center">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center mx-auto mb-3 neu-raised-sm">
                      <span className="text-white font-bold">{item.step}</span>
                    </div>
                    <h4 className="font-semibold mb-1">{item.title}</h4>
                    <p className="text-xs text-muted">{item.desc}</p>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      )}
    </div>
  );
}
