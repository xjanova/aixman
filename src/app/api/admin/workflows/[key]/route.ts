import { NextRequest, NextResponse } from 'next/server';
import { previewWorkflow, workflowDetail } from '@/lib/gpu/workflow-admin';
import { EMPTY_OVERRIDE, sanitizeOverride, saveWorkflow } from '@/lib/gpu/workflow-overrides';
import { adminEntry } from '../_shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

/** Everything /admin/workflows shows for one workflow. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const ctx = await adminEntry(params);
  if ('response' in ctx) return ctx.response;
  try {
    return NextResponse.json(await workflowDetail(ctx.entry));
  } catch (error) {
    console.error(`Failed to load workflow ${ctx.entry.key}:`, error);
    return NextResponse.json({ error: 'โหลดข้อมูล workflow ไม่สำเร็จ' }, { status: 500 });
  }
}

/**
 * Save a new version of the override.
 *
 * The override is checked twice: field by field (`sanitizeOverride`), then by
 * building the graph it would send and validating it against the stored
 * schema — the same check a worker runs before it renders. A graph that fails
 * is refused unless the admin insists (`force`), because the next customer
 * order would fail the same way and three of those demote the model.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const ctx = await adminEntry(params);
  if ('response' in ctx) return ctx.response;

  const body = (await request.json().catch(() => null)) as { override?: unknown; note?: unknown; force?: unknown } | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }, { status: 400 });
  }

  const { override, errors } = sanitizeOverride(ctx.entry, body.override);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const dryRun = await previewWorkflow(ctx.entry, override);
  if (!dryRun.ok && body.force !== true) {
    return NextResponse.json(
      {
        error: 'กราฟที่ได้จากค่านี้ไม่ผ่านการตรวจของ ComfyUI — ยังไม่ได้บันทึก',
        errors: [dryRun.error ?? 'ไม่ทราบสาเหตุ'],
        canForce: true,
      },
      { status: 422 }
    );
  }

  try {
    const stored = await saveWorkflow(ctx.entry.key, override, {
      by: ctx.by,
      note: typeof body.note === 'string' ? body.note : null,
    });
    return NextResponse.json({ stored, preview: dryRun });
  } catch (error) {
    console.error(`Failed to save workflow ${ctx.entry.key}:`, error);
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ' }, { status: 500 });
  }
}

/** Back to the catalogue as shipped — saved as a new version, so it can be undone too. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const ctx = await adminEntry(params);
  if ('response' in ctx) return ctx.response;
  try {
    const stored = await saveWorkflow(
      ctx.entry.key,
      { ...EMPTY_OVERRIDE, rollout: 'all' },
      { by: ctx.by, note: 'คืนค่าเริ่มต้นของแคตตาล็อก' }
    );
    return NextResponse.json({ stored });
  } catch (error) {
    console.error(`Failed to reset workflow ${ctx.entry.key}:`, error);
    return NextResponse.json({ error: 'คืนค่าไม่สำเร็จ' }, { status: 500 });
  }
}
