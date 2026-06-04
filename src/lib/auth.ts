import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';

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

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
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
 * Get current session user ID (for API routes).
 * Re-validates against the DB so a long-lived (30-day) JWT cannot outlive a
 * deactivated account — xmanstudio owns the users table and may disable users.
 */
export async function getCurrentUserId(): Promise<number | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = parseInt(session.user.id, 10);
  if (!Number.isInteger(userId)) return null;

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
  const session = await auth();
  if (!session?.user?.id) return false;
  const userId = parseInt(session.user.id, 10);
  if (!Number.isInteger(userId)) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  return !!user && user.isActive && (user.role === 'admin' || user.role === 'super_admin');
}
