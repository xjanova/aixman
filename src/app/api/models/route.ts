import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { ModelReadiness, TUNING_MESSAGE } from '@/lib/services/model-readiness';

export async function GET() {
  const [models, admin] = await Promise.all([
    prisma.aiModel.findMany({
      where: { isActive: true },
      include: { provider: { select: { name: true, slug: true, logo: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    isAdmin(),
  ]);

  return NextResponse.json({
    models: models.map((m) => ({
      ...m,
      // A model still being proven out stays listed, so customers can see it is
      // coming — but it is clearly marked and cannot be ordered. Admins can,
      // which is how it gets proven.
      canOrder: ModelReadiness.canOrder(m.readiness, admin),
      tuningMessage: m.readiness === 'tuning' ? TUNING_MESSAGE : null,
    })),
  });
}
