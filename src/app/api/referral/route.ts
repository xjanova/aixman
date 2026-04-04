import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { ReferralService } from "@/lib/services/referral";

const referralService = new ReferralService();

// GET — Get my referral code and stats
export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

    const stats = await referralService.getStats(userId);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Referral GET error:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาด" }, { status: 500 });
  }
}

// POST — Apply a referral code
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "กรุณาระบุรหัสชวนเพื่อน" }, { status: 400 });
    }

    const result = await referralService.applyCode(userId, code.trim().toUpperCase());

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "ใช้รหัสชวนเพื่อนสำเร็จ! คุณได้รับเครดิตโบนัส" });
  } catch (error) {
    console.error("Referral POST error:", error);
    return NextResponse.json({ error: "เกิดข้อผิดพลาด" }, { status: 500 });
  }
}
