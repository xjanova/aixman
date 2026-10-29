import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { ReferralService } from "@/lib/services/referral";
import { requestLocale, translator } from "@/lib/i18n/locale";

const referralService = new ReferralService();

// GET — Get my referral code and stats
export async function GET(request: NextRequest) {
  const locale = requestLocale(request);
  const t = translator(locale);
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: t("กรุณาเข้าสู่ระบบ", "Please sign in.") }, { status: 401 });

    const stats = await referralService.getStats(userId, locale);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Referral GET error:", error);
    return NextResponse.json({ error: t("เกิดข้อผิดพลาด", "Something went wrong.") }, { status: 500 });
  }
}

// POST — Apply a referral code
export async function POST(req: NextRequest) {
  const t = translator(requestLocale(req));
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: t("กรุณาเข้าสู่ระบบ", "Please sign in.") }, { status: 401 });

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: t("กรุณาระบุรหัสชวนเพื่อน", "Please enter a referral code.") }, { status: 400 });
    }

    const result = await referralService.applyCode(userId, code.trim().toUpperCase());

    if (!result.success) {
      return NextResponse.json({ error: t(result.error) }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: t("ใช้รหัสชวนเพื่อนสำเร็จ! คุณได้รับเครดิตโบนัส", "Referral code applied! You've received bonus credits."),
    });
  } catch (error) {
    console.error("Referral POST error:", error);
    return NextResponse.json({ error: t("เกิดข้อผิดพลาด", "Something went wrong.") }, { status: 500 });
  }
}
