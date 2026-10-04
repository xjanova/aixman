import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import prisma from '@/lib/db';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import { NO_ORDER_INPUTS, orderInputs } from '@/lib/order-inputs';

/**
 * The uploads one of the caller's orders was made from, for the studio to put
 * back when the piece is reopened (order-inputs.ts).
 *
 * Its own request rather than a field of GET /api/gallery: a start frame is
 * usually a base64 data URL of several megabytes, and the list would carry one
 * per item to every page that shows a gallery.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const generationId = parseInt(id, 10);
  if (isNaN(generationId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const generation = await prisma.aiGeneration.findFirst({
    where: { id: generationId, userId },
    select: { inputImage: true, params: true, mediaDeletedAt: true },
  });
  if (!generation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The retention sweep marks the row first and strips `params` row by row
  // after it, so a sweep cut off in between leaves URLs to deleted objects.
  if (generation.mediaDeletedAt) {
    return NextResponse.json({ ...NO_ORDER_INPUTS, mediaDeleted: true });
  }

  return NextResponse.json({
    ...orderInputs(generation, (url) => keyFromPublicUrl(url) !== null),
    mediaDeleted: false,
  });
}
