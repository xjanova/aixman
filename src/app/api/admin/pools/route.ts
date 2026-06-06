import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { AccountPoolManager } from '@/lib/services/account-pool';
import { encrypt } from '@/lib/utils/encryption';
import { prismaErrorResponse } from '@/lib/utils/admin';
import prisma from '@/lib/db';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const accounts = await AccountPoolManager.getPoolStatus();
  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    const providerId = parseInt(body.providerId, 10);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      return NextResponse.json({ error: 'providerId ไม่ถูกต้อง' }, { status: 400 });
    }
    if (!body.apiKey || typeof body.apiKey !== 'string') {
      return NextResponse.json({ error: 'ต้องระบุ API key' }, { status: 400 });
    }
    if (!body.label || typeof body.label !== 'string') {
      return NextResponse.json({ error: 'ต้องระบุชื่อ (label)' }, { status: 400 });
    }

    // Use ?? so a legitimate 0 (priority / unlimited daily quota) is honoured.
    const priority = Number.isFinite(parseInt(body.priority, 10)) ? parseInt(body.priority, 10) : 50;
    const dailyQuota = Number.isFinite(parseInt(body.dailyQuota, 10)) ? parseInt(body.dailyQuota, 10) : 1000;

    const account = await prisma.aiAccountPool.create({
      data: {
        providerId,
        label: body.label,
        apiKey: encrypt(body.apiKey),
        apiSecret: body.apiSecret ? encrypt(body.apiSecret) : null,
        priority,
        dailyQuota,
        rotationMode: body.rotationMode || 'round_robin',
      },
    });

    return NextResponse.json({ id: account.id }, { status: 201 });
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
    console.error('Failed to create pool:', error);
    return NextResponse.json({ error: 'Failed to create pool' }, { status: 500 });
  }
}
