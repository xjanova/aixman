"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    } else {
      router.push("/generate");
    }
  };

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center p-4">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center neu-raised-sm">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text">XMAN AI</span>
          </Link>
        </div>

        <Card variant="elevated" className="p-8">
          <h1 className="text-2xl font-bold text-center mb-2">เข้าสู่ระบบ</h1>
          <p className="text-center text-muted text-sm mb-6">
            ใช้บัญชีเดียวกับ <a href="https://xman4289.com" className="text-primary-light underline" target="_blank" rel="noopener noreferrer">xman4289.com</a>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted mb-1.5 block">อีเมล</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label className="text-sm text-muted mb-1.5 block">รหัสผ่าน</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-error text-center">{error}</p>
            )}

            <Button
              type="submit"
              loading={loading}
              className="w-full"
              size="lg"
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              เข้าสู่ระบบ
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted">
            ยังไม่มีบัญชี?{" "}
            <a
              href="https://xman4289.com/register"
              className="text-primary-light underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              สมัครที่ XMAN Studio
            </a>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
