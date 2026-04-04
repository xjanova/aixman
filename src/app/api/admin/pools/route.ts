import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { AccountPoolManager } from '@/lib/services/account-pool';
import { encrypt } from '@/lib/utils/encryption';
import prisma from '@/lib/db';

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const accounts = await AccountPoolManager.getPoolStatus();
  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();

  const account = await prisma.aiAccountPool.create({
    data: {
      providerId: parseInt(body.providerId, 10),
      label: body.label,
      apiKey: encrypt(body.apiKey),
      apiSecret: body.apiSecret ? encrypt(body.apiSecret) : null,
      priority: parseInt(body.priority, 10) || 50,
      dailyQuota: parseInt(body.dailyQuota, 10) || 1000,
      rotationMode: body.rotationMode || 'round_robin',
    },
  });

  return NextResponse.json({ id: account.id });
}
