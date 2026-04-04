import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Skip middleware for login page to prevent redirect loop
  if (path === '/login') {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

  // If no secret configured, skip middleware (don't block users)
  if (!secret) {
    return NextResponse.next();
  }

  try {
    // NextAuth v5 uses 'authjs.session-token' cookie name by default
    const token = await getToken({
      req: request,
      secret,
      cookieName: process.env.NODE_ENV === 'production'
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
    });

    const isLoggedIn = !!token;
    const role = token?.role as string | undefined;
    const isAdmin = role === 'admin' || role === 'super_admin';

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
  } catch {
    // If token parsing fails, allow access rather than blocking
    // The pages themselves have their own auth checks
    return NextResponse.next();
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
