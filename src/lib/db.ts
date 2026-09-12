import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Options for a short transaction that must not fail on a slow moment of the
 * shared MySQL. Prisma's defaults (2 s to start, 5 s to finish) are tighter
 * than it guarantees: one stall of 9.2 s expired a paid order, another of
 * 12.8 s re-queued a render the GPU kept working on.
 *
 * Interactive transactions only. With this driver adapter the array form of
 * `$transaction([...])` runs under the same 5 s limit and takes no timeout,
 * so anything that has to survive a stall is written as a callback.
 */
export const SLOW_DB_TX = { maxWait: 5_000, timeout: 15_000 } as const;

export default prisma;
