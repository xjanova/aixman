import { NextResponse } from 'next/server';

/**
 * Shared helpers for admin API routes — consistent id parsing, field
 * whitelisting (avoids mass-assignment), and Prisma error → HTTP mapping.
 */

/** Parse a positive integer route param; returns null if invalid. */
export function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Keep only the allowed fields from a request body (prevents mass-assignment). */
export function pick(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (body && body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

/**
 * Map a known Prisma error to an appropriate HTTP response.
 * Returns null when the error isn't a recognised case (caller should 500).
 */
export function prismaErrorResponse(error: unknown): NextResponse | null {
  const code = (error as { code?: string })?.code;
  if (code === 'P2025') return NextResponse.json({ error: 'ไม่พบรายการที่ต้องการ' }, { status: 404 });
  if (code === 'P2002') return NextResponse.json({ error: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' }, { status: 409 });
  if (code === 'P2003') return NextResponse.json({ error: 'ลบไม่ได้ — มีข้อมูลอื่นอ้างอิงอยู่' }, { status: 409 });
  return null;
}

/** Normalise a package `features` value to a string[] (column is JSON). */
export function normalizeFeatures(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // not JSON — treat as a single feature line
      return value.trim() ? [value] : null;
    }
  }
  return null;
}
