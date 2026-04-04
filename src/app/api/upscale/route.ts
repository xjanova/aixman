import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GenerationService } from "@/lib/services/generation";

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }

    const body = await req.json();
    const { generationId, modelId } = body;

    if (!generationId) {
      return NextResponse.json({ error: "กรุณาระบุ generationId" }, { status: 400 });
    }

    // Fetch the original generation
    const original = await prisma.aiGeneration.findFirst({
      where: { id: generationId, userId },
      include: { model: { include: { provider: true } } },
    });

    if (!original || !original.resultUrl) {
      return NextResponse.json({ error: "ไม่พบผลงานต้นฉบับ" }, { status: 404 });
    }

    // Find an upscale model - use specified or auto-select
    let upscaleModel;
    if (modelId) {
      upscaleModel = await prisma.aiModel.findFirst({
        where: { id: modelId, isActive: true },
        include: { provider: true },
      });
    } else {
      // Auto-select: find upscale models
      upscaleModel = await prisma.aiModel.findFirst({
        where: {
          isActive: true,
          OR: [
            { subcategory: "upscale" },
            { name: { contains: "upscale" } },
          ],
        },
        orderBy: { creditsPerUnit: "asc" },
        include: { provider: true },
      });
    }

    if (!upscaleModel) {
      return NextResponse.json({ error: "ไม่พบโมเดล Upscale ที่ใช้ได้" }, { status: 404 });
    }

    // Use the generation service to upscale
    const result = await GenerationService.generate(userId, {
      modelId: upscaleModel.id,
      type: "edit",
      prompt: original.prompt || "upscale image",
      inputImage: original.resultUrl,
      params: {
        width: (original.params as Record<string, number>)?.width ? (original.params as Record<string, number>).width * 2 : 2048,
        height: (original.params as Record<string, number>)?.height ? (original.params as Record<string, number>).height * 2 : 2048,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Upscale error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "เกิดข้อผิดพลาดในการ Upscale" },
      { status: 500 }
    );
  }
}
