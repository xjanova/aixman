import { NextRequest, NextResponse } from 'next/server';
import { previewWorkflow } from '@/lib/gpu/workflow-admin';
import { getLastGraph, getStoredWorkflow } from '@/lib/gpu/workflow-overrides';
import { adminEntry } from '../../_shared';

export const dynamic = 'force-dynamic';

/**
 * Download a workflow as a file:
 *
 *  - `template` — the vendored UI workflow; opens in ComfyUI as-is.
 *  - `api`      — the API-format graph for the default order, with the saved
 *                 override applied (what "Export (API)" would give).
 *  - `last`     — the graph a real worker last received for this model.
 *  - `override` — the saved override itself.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await adminEntry(params);
  if ('response' in ctx) return ctx.response;
  const kind = request.nextUrl.searchParams.get('kind') ?? 'template';

  let body: unknown;
  let name: string;
  switch (kind) {
    case 'template':
      body = ctx.entry.template;
      name = ctx.entry.source?.file && !ctx.entry.source.file.startsWith('(') ? ctx.entry.source.file : `${ctx.entry.key}.json`;
      break;
    case 'api': {
      const stored = await getStoredWorkflow(ctx.entry.key);
      const preview = await previewWorkflow(ctx.entry, stored?.override ?? null);
      if (!preview.graph) {
        return NextResponse.json({ error: preview.error ?? 'สร้างกราฟไม่ได้' }, { status: 422 });
      }
      body = preview.graph;
      name = `${ctx.entry.key}-api.json`;
      break;
    }
    case 'last': {
      const last = await getLastGraph(ctx.entry.key);
      if (!last) return NextResponse.json({ error: 'ยังไม่มีงานจริงที่ส่งเข้าเครื่องหลังจากอัปเดตนี้' }, { status: 404 });
      body = last.graph;
      name = `${ctx.entry.key}-last-job-${last.generationId}.json`;
      break;
    }
    case 'override': {
      const stored = await getStoredWorkflow(ctx.entry.key);
      if (!stored) return NextResponse.json({ error: 'ยังไม่มีการปรับแต่ง' }, { status: 404 });
      body = stored;
      name = `${ctx.entry.key}-override-v${stored.version}.json`;
      break;
    }
    default:
      return NextResponse.json({ error: 'ชนิดไฟล์ไม่ถูกต้อง' }, { status: 400 });
  }

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'cache-control': 'no-store',
    },
  });
}
