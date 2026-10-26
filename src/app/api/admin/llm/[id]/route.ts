import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { LLM_CATEGORY, parseLlmConfig } from '@/lib/llm/pricing';

export const dynamic = 'force-dynamic';

async function find(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id)) return null;
  return prisma.aiModel.findFirst({ where: { id, category: LLM_CATEGORY } });
}

/** Edit a language model: copy, on/off, order, and its config (merged, then re-read through parseLlmConfig). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const model = await find((await params).id);
  if (!model) return NextResponse.json({ error: 'ไม่พบโมเดล' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 255);
  if (typeof body.description === 'string') data.description = body.description.slice(0, 2000);
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  if (body.sortOrder !== undefined && Number.isInteger(Number(body.sortOrder))) data.sortOrder = Number(body.sortOrder);
  if (body.config && typeof body.config === 'object') {
    const cfg = parseLlmConfig({ ...parseLlmConfig(model.defaultParams), ...(body.config as object) });
    data.defaultParams = cfg;
    data.costPerUnit = cfg.outputUsdPerMTok;
    data.creditsPerUnit = Math.ceil(cfg.outputCreditsPerMTok);
  }
  const updated = await prisma.aiModel.update({ where: { id: model.id }, data });
  return NextResponse.json({ model: { ...updated, config: parseLlmConfig(updated.defaultParams) } });
}

/** Remove a language model. Its usage rows keep its id as text. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const model = await find((await params).id);
  if (!model) return NextResponse.json({ error: 'ไม่พบโมเดล' }, { status: 404 });
  await prisma.aiModel.delete({ where: { id: model.id } });
  return NextResponse.json({ ok: true });
}
