import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { getBearerUserId } from '@/lib/mobile-auth';
import { consumeTicket } from '@/lib/xman-sso';

/**
 * NextAuth configuration
 * Shares the same users table as xmanstudio (Laravel)
 * Password hash is compatible with Laravel's bcrypt ($2y$ -> $2a$)
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Explicit `select`, never a bare findUnique. `users` is owned by
        // xmanstudio and its columns move without warning here; Prisma names
        // every column in its SELECT, so one stale field in schema.prisma turns
        // into P2022 and takes down every login on the site. Naming only what we
        // use keeps a dropped column a Prisma-schema chore, not an outage.
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            role: true,
            isActive: true,
            password: true,
          },
        });

        if (!user || !user.isActive) return null;

        // Laravel uses $2y$ prefix, bcryptjs uses $2a$ — they're compatible
        const passwordHash = user.password.replace(/^\$2y\$/, '$2a$');
        const isValid = await bcrypt.compare(credentials.password as string, passwordHash);

        if (!isValid) return null;

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          image: user.avatar,
          role: user.role,
        };
      },
    }),

    /**
     * "Sign in with XMAN ID" — the browser hands back a ticket that
     * /api/auth/xman/callback minted after xmanstudio vouched for the user
     * server-to-server.
     *
     * No password is involved and none is accepted: the only input is a ticket
     * this process issued itself, single-use and valid for a minute. Everything
     * that authenticates the customer already happened at xman4289.com.
     */
    CredentialsProvider({
      id: 'xman-sso',
      name: 'XMAN ID',
      credentials: {
        ticket: { label: 'Ticket', type: 'text' },
      },
      async authorize(credentials) {
        const ticket = typeof credentials?.ticket === 'string' ? credentials.ticket : '';
        if (!ticket) return null;

        const userId = consumeTicket(ticket);
        if (userId === null) return null;

        // Re-read rather than trusting the id carried on the ticket: the account
        // could have been deactivated in the seconds since the exchange.
        // Explicit select, for the same reason as the password provider above.
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, avatar: true, role: true, isActive: true },
        });
        if (!user || !user.isActive) return null;

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          image: user.avatar,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role || 'user';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { role: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
});

/**
 * Resolve the caller's user id from either supported credential.
 *
 * The web app sends a NextAuth session cookie; the native mobile app sends
 * `Authorization: Bearer <access token>` because it has no cookie jar and cannot
 * complete NextAuth's CSRF flow. Bearer is checked first — it is only ever
 * present when a mobile client deliberately sent it, so it never shadows a
 * browser session.
 *
 * This returns a *claimed* id only. Both callers below re-check it against the
 * DB; do not use it directly.
 */
async function resolveUserId(): Promise<number | null> {
  const fromBearer = await getBearerUserId();
  if (fromBearer !== null) return fromBearer;

  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = parseInt(session.user.id, 10);
  return Number.isInteger(userId) ? userId : null;
}

/**
 * Get current user ID (for API routes).
 * Re-validates against the DB so a long-lived (30-day) JWT cannot outlive a
 * deactivated account — xmanstudio owns the users table and may disable users.
 * This is also the only revocation path mobile bearer tokens have, so it must
 * stay a live DB read.
 */
export async function getCurrentUserId(): Promise<number | null> {
  const userId = await resolveUserId();
  if (userId === null) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  if (!user || !user.isActive) return null;
  return userId;
}

/**
 * Check if current user is admin — reads the live role from the DB rather than
 * trusting the role baked into the JWT at login time.
 */
export async function isAdmin(): Promise<boolean> {
  const userId = await resolveUserId();
  if (userId === null) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  return !!user && user.isActive && (user.role === 'admin' || user.role === 'super_admin');
}
