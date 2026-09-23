import { NextRequest, NextResponse } from 'next/server';
import { previewWorkflow, type PreviewInput } from '@/lib/gpu/workflow-admin';
import { getStoredWorkflow, sanitizeOverride } from '@/lib/gpu/workflow-overrides';
import { adminEntry } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * Dry run: the exact graph a job would send, built and validated against the
 * stored schema — nothing is rented. With `override` it shows an unsaved edit;
 * without, the saved one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await adminEntry(params);
  if ('response' in ctx) return ctx.response;

  const body = (await request.json().catch(() => ({}))) as { override?: unknown; params?: PreviewInput };
  let override = null;
  let errors: string[] = [];
  if (body.override !== undefined) {
    const sanitized = sanitizeOverride(ctx.entry, body.override);
    override = sanitized.override;
    errors = sanitized.errors;
  } else {
    override = (await getStoredWorkflow(ctx.entry.key))?.override ?? null;
  }

  const preview = await previewWorkflow(ctx.entry, override, body.params ?? {});
  return NextResponse.json({ ...preview, fieldErrors: errors });
}
