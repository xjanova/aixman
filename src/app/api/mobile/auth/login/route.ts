import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { issueTokenPair } from '@/lib/mobile-auth';
import { buildMobileSession } from '@/lib/services/mobile-session';
import { rateLimit, resetRateLimit, clientIp } from '@/lib/rate-limit';

/**
 * POST /api/mobile/auth/login
 *
 * Password login for the native app. Same credentials, same users table and the
 * same Laravel-bcrypt compatibility as the web login in `src/lib/auth.ts` — the
 * only difference is that this hands back bearer tokens instead of setting a
 * session cookie.
 */

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 200;

const WINDOW_MS = 15 * 60 * 1000;
/** Per source IP: stops one host spraying many accounts. */
const IP_ATTEMPTS = 20;
/**
 * Per email: stops a botnet rotating IPs against one account. Generous, and it
 * only ever returns 429 with a Retry-After — it never locks the account, so it
 * cannot be used to deny a real customer their login for longer than a window.
 */
const EMAIL_ATTEMPTS = 10;

/**
 * A real bcrypt hash of a value nobody can supply, used to burn the same ~60ms
 * on "no such user" as on "wrong password". Without it, response time leaks
 * which email addresses have accounts. Built lazily so a cold start is not
 * charged for it, and cached because hashing is the expensive part.
 */
let decoyHash: string | null = null;
function getDecoyHash(): string {
  if (!decoyHash) decoyHash = bcrypt.hashSync('xdreamer-timing-decoy', 10);
  return decoyHash;
}

/** One message for every credential failure — never reveal which half was wrong. */
const INVALID_CREDENTIALS = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);

  const ipLimit = rateLimit(`mobile-login:ip:${ip}`, IP_ATTEMPTS, WINDOW_MS);
  if (!ipLimit.ok) {
    return tooManyAttempts(ipLimit.retryAfter);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' }, { status: 400 });
  }
  // Bounded before anything touches the DB or bcrypt: an unbounded password is
  // free CPU for an attacker.
  if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const emailLimit = rateLimit(`mobile-login:email:${email}`, EMAIL_ATTEMPTS, WINDOW_MS);
  if (!emailLimit.ok) {
    return tooManyAttempts(emailLimit.retryAfter);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true, isActive: true },
  });

  if (!user) {
    await bcrypt.compare(password, getDecoyHash());
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  // Laravel writes $2y$, bcryptjs expects $2a$ — the formats are identical.
  const passwordHash = user.password.replace(/^\$2y\$/, '$2a$');
  const isValid = await bcrypt.compare(password, passwordHash);

  if (!isValid) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  // Checked after the password so a disabled account is not distinguishable
  // from a wrong password by anyone who does not already know the password.
  if (!user.isActive) {
    return NextResponse.json(
      { error: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบริการลูกค้า' },
      { status: 403 }
    );
  }

  const session = await buildMobileSession(user.id);
  if (!session) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  // A correct password clears the counters — a customer who mistyped four times
  // then got it right should not be near a limit.
  resetRateLimit(`mobile-login:ip:${ip}`);
  resetRateLimit(`mobile-login:email:${email}`);

  const tokens = await issueTokenPair(user.id);

  return NextResponse.json({ ...tokens, ...session });
}

function tooManyAttempts(retryAfter: number) {
  return NextResponse.json(
    { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}
