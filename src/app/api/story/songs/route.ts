import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { keyFromPublicUrl } from '@/lib/storage/r2';

/**
 * GET /api/story/songs — songs the caller made on the site, for an MV. Only
 * finished ones still in our bucket; the lyrics they were made with come along
 * so the MV form can fill them in.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const rows = await prisma.aiGeneration.findMany({
    where: { userId, type: 'audio', status: 'completed', resultUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { id: true, prompt: true, params: true, resultUrl: true, createdAt: true },
  });
  return NextResponse.json({
    songs: rows
      .filter((r) => r.resultUrl && keyFromPublicUrl(r.resultUrl))
      .map((r) => {
        const params = (r.params ?? {}) as Record<string, unknown>;
        const lyrics = typeof params.lyrics === 'string' ? params.lyrics : '';
        return {
          id: r.id,
          title: (r.prompt ?? '').slice(0, 80) || `เพลง #${r.id}`,
          url: r.resultUrl,
          lyrics,
          createdAt: r.createdAt,
        };
      }),
  });
}
