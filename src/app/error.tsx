"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <AlertCircle className="w-16 h-16 text-error mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">{t("เกิดข้อผิดพลาด", "Something went wrong")}</h2>
        <p className="text-muted mb-6">{t("มีบางอย่างผิดปกติ กรุณาลองอีกครั้ง", "An unexpected error occurred. Please try again.")}</p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-medium hover:shadow-lg transition-all"
        >
          <RotateCcw className="w-4 h-4" /> {t("ลองอีกครั้ง", "Try again")}
        </button>
      </div>
    </div>
  );
}
