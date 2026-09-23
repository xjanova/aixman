import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { listWorkflows } from '@/lib/gpu/workflow-admin';

/** Every ComfyUI workflow the site renders with, for /admin/workflows. */
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json({ workflows: await listWorkflows() });
  } catch (error) {
    console.error('Failed to list workflows:', error);
    return NextResponse.json({ error: 'โหลดรายการ workflow ไม่สำเร็จ' }, { status: 500 });
  }
}
