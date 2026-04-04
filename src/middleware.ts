import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const token = await getToken({ req: request, secret });
  const isLoggedIn = !!token;
  const role = token?.role as string | undefined;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const path = request.nextUrl.pathname;

  // Admin routes require admin role
  if (path.startsWith('/admin') && !isAdmin) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Protected routes require authentication
  if (
    (path.startsWith('/generate') ||
      path.startsWith('/gallery') ||
      path.startsWith('/profile')) &&
    !isLoggedIn
  ) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/generate/:path*',
    '/gallery/:path*',
    '/profile/:path*',
  ],
};
