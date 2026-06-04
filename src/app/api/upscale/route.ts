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

    const body = await req.json().catch(() => ({}));
    const generationId =
      typeof body.generationId === "number" ? body.generationId : parseInt(String(body.generationId), 10);
    const modelId =
      body.modelId == null ? null : typeof body.modelId === "number" ? body.modelId : parseInt(String(body.modelId), 10);

    if (!Number.isInteger(generationId) || generationId <= 0) {
      return NextResponse.json({ error: "กรุณาระบุ generationId ที่ถูกต้อง" }, { status: 400 });
    }

    // Fetch the original generation (scoped to the requesting user)
    const original = await prisma.aiGeneration.findFirst({
      where: { id: generationId, userId },
      include: { model: { include: { provider: true } } },
    });

    if (!original || !original.resultUrl) {
      return NextResponse.json({ error: "ไม่พบผลงานต้นฉบับ" }, { status: 404 });
    }

    // Find an upscale model - use specified or auto-select
    let upscaleModel;
    if (modelId && Number.isInteger(modelId)) {
      upscaleModel = await prisma.aiModel.findFirst({
        where: { id: modelId, isActive: true },
        include: { provider: true },
      });
    } else {
      // Auto-select: prefer models explicitly tagged as upscale/enhance.
      upscaleModel = await prisma.aiModel.findFirst({
        where: {
          isActive: true,
          provider: { isActive: true },
          OR: [
            { subcategory: "upscale" },
            { name: { contains: "upscale" } },
            { name: { contains: "Upscale" } },
            { modelId: { contains: "upscale" } },
            { modelId: { contains: "esrgan" } },
          ],
        },
        orderBy: { creditsPerUnit: "asc" },
        include: { provider: true },
      });
    }

    if (!upscaleModel) {
      return NextResponse.json(
        { error: "ยังไม่มีโมเดล Upscale ที่ใช้งานได้ กรุณาให้แอดมินเพิ่มโมเดล Upscale ก่อน" },
        { status: 404 }
      );
    }

    // Preserve aspect ratio: scale 2x, capped to the model's max dimensions.
    const orig = (original.params as Record<string, number> | null) || {};
    const params: Record<string, unknown> = { mode: "upscale", scale: 2 };
    if (orig.width && orig.height) {
      params.width = Math.min(orig.width * 2, upscaleModel.maxWidth || 4096);
      params.height = Math.min(orig.height * 2, upscaleModel.maxHeight || 4096);
    }

    // Use the generation service to upscale (edit path with the source image)
    const result = await GenerationService.generate(userId, {
      modelId: upscaleModel.id,
      type: "edit",
      prompt: original.prompt || "enhance details and upscale, high resolution",
      inputImage: original.resultUrl,
      params,
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
