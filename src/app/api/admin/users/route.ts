import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';

/**
 * Admin user list — read-only view of the shared users table joined with their
 * AI credit balance. (The users table is owned by xmanstudio; we never write to
 * it here — admins can only adjust AI credits, which are ours.)
 */
export async function GET(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(sp.get('limit') || '20', 10) || 20));
    const search = sp.get('search')?.trim();

    const where = search
      ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
          aiCredits: { select: { balance: true, totalBought: true, totalUsed: true, totalBonus: true } },
          _count: { select: { aiGenerations: true } },
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({ users, total, pages: Math.ceil(total / limit), page });
  } catch (error) {
    console.error('Failed to list users:', error);
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}
