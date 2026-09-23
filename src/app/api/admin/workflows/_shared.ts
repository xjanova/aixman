import { NextResponse } from 'next/server';
import { auth, isAdmin } from '@/lib/auth';
import { getCatalogEntry, type CatalogEntry } from '@/lib/gpu/catalog';

/**
 * Auth and lookup shared by the /api/admin/workflows/[key] handlers. Returns
 * either the catalogue entry and who is acting, or the response to send.
 */
export async function adminEntry(
  params: Promise<{ key: string }>
): Promise<{ entry: CatalogEntry; by: string | null } | { response: NextResponse }> {
  if (!(await isAdmin())) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  const { key } = await params;
  const entry = getCatalogEntry(decodeURIComponent(key));
  if (!entry) {
    return { response: NextResponse.json({ error: 'ไม่พบ workflow นี้ในแคตตาล็อก' }, { status: 404 }) };
  }
  const session = await auth();
  const by = session?.user?.email ?? session?.user?.name ?? null;
  return { entry, by };
}
