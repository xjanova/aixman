import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { GpuWorkerManager } from '@/lib/services/gpu-worker';

/**
 * A rented worker reporting its own HTTPS tunnel.
 *
 * Vendors that give only a bare IP and port (GpuExposure 'tunnel') would have
 * us send the worker's bearer token and customers' prompts over plain HTTP.
 * Instead the worker opens a Cloudflare quick tunnel and posts its URL here,
 * authenticated with that same token, over our own HTTPS — so a network
 * observer can neither read the token nor slip us a URL of their own.
 *
 * `id` is the random callback id the worker was booted with, not its row id.
 * Answers 404 until the row exists (the machine can boot faster than the rent
 * call returns), and the worker retries.
 */

export const dynamic = 'force-dynamic';

/** The only URLs a worker may point us at — anything else could aim our fetches inside our own network. */
const TUNNEL_URL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const CALLBACK_ID = /^[a-f0-9]{24}$/;
const LIVE = ['provisioning', 'warming', 'ready', 'busy'];

const digest = (value: string) => createHash('sha256').update(value).digest();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // A worker reports once per tunnel, retrying every 10 s; this is generous.
  const limited = rateLimit(`gpu-tunnel:${clientIp(request.headers)}`, 30, 60_000);
  if (!limited.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });

  const { id } = await params;
  if (!CALLBACK_ID.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
  if (!TUNNEL_URL.test(url)) return NextResponse.json({ error: 'bad url' }, { status: 400 });

  const worker = await prisma.aiGpuWorker.findFirst({
    where: { metadata: { path: '$.callbackId', equals: id } },
  });
  if (!worker) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Compared as digests: equal length, constant time.
  const expected = GpuWorkerManager.readAuthToken(worker);
  if (!expected || !timingSafeEqual(digest(token), digest(expected))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (worker.terminatedAt || !LIVE.includes(worker.status)) {
    return NextResponse.json({ error: 'released' }, { status: 410 });
  }

  if (worker.endpoint !== url) {
    await prisma.aiGpuWorker.update({ where: { id: worker.id }, data: { endpoint: url } });
    console.log(`[gpu] worker #${worker.id} reported its tunnel`);
  }
  return NextResponse.json({ ok: true });
}
