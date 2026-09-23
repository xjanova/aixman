import { NextRequest, NextResponse } from 'next/server';
import { getStoredWorkflow, getWorkflowHistory, saveWorkflow } from '@/lib/gpu/workflow-overrides';
import { adminEntry } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * Put an earlier version back. It is saved as a *new* version with a note
 * naming the one it restored, so the rollback itself can be rolled back.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await adminEntry(params);
  if ('response' in ctx) return ctx.response;

  const body = (await request.json().catch(() => ({}))) as { version?: unknown };
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: 'เลขเวอร์ชันไม่ถูกต้อง' }, { status: 400 });
  }

  const [current, history] = await Promise.all([getStoredWorkflow(ctx.entry.key), getWorkflowHistory(ctx.entry.key)]);
  const target = [current, ...history].find((s) => s?.version === version);
  if (!target) {
    return NextResponse.json({ error: `ไม่พบเวอร์ชัน ${version} ในประวัติ` }, { status: 404 });
  }
  if (current?.version === version) {
    return NextResponse.json({ error: 'เวอร์ชันนี้ใช้อยู่แล้ว' }, { status: 409 });
  }

  try {
    const stored = await saveWorkflow(ctx.entry.key, target.override, {
      by: ctx.by,
      note: `ย้อนกลับเป็นเวอร์ชัน ${version}${target.note ? ` (${target.note})` : ''}`,
    });
    return NextResponse.json({ stored });
  } catch (error) {
    console.error(`Failed to roll back workflow ${ctx.entry.key}:`, error);
    return NextResponse.json({ error: 'ย้อนกลับไม่สำเร็จ' }, { status: 500 });
  }
}
