import { randomBytes } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Cloudflare R2 storage (S3-compatible).
 *
 * Provider output URLs are temporary (Replicate ~1h, OpenAI/Stability return
 * base64, fal/Luma/Runway/Kling signed URLs) — so generated assets MUST be
 * persisted to durable storage we control. R2 is used because it has zero egress
 * fees (cheap to serve media) and lives off the app server's disk.
 *
 * Required env:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
 * R2_PUBLIC_URL is the bucket's public base (r2.dev URL or a custom domain).
 */

let cachedClient: S3Client | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = process.env.R2_ACCOUNT_ID!;
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return cachedClient;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function extFromMime(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] || 'bin';
}

interface FetchedAsset {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

/** Resolve a data: URI or remote URL into raw bytes. */
async function resolveAsset(src: string): Promise<FetchedAsset> {
  if (src.startsWith('data:')) {
    const match = src.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (!match) throw new Error('Invalid data URI');
    const contentType = match[1];
    return { buffer: Buffer.from(match[2], 'base64'), contentType, ext: extFromMime(contentType) };
  }

  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to fetch asset (${res.status})`);
  const contentType = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType, ext: extFromMime(contentType) };
}

/** Upload raw bytes to R2 and return the public URL. */
export async function uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
  if (!isStorageConfigured()) throw new Error('R2 storage is not configured');
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  const base = process.env.R2_PUBLIC_URL!.replace(/\/+$/, '');
  return `${base}/${key}`;
}

/**
 * Persist a provider asset (data URI or remote URL) to R2 under keyPrefix and
 * return the durable public URL.
 */
export async function persistAsset(src: string, keyPrefix: string): Promise<string> {
  const { buffer, contentType, ext } = await resolveAsset(src);
  const key = `${keyPrefix}/${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
  return uploadBuffer(buffer, key, contentType);
}

/**
 * Best-effort persistence: persist to R2 when configured, otherwise return the
 * original source unchanged (so base64/temporary URLs still work in dev). Never
 * throws — on failure it logs and returns the original src as a fallback.
 */
export async function persistAssetSafe(src: string, keyPrefix: string): Promise<string> {
  if (!src || !isStorageConfigured()) return src;
  try {
    return await persistAsset(src, keyPrefix);
  } catch (err) {
    console.error('R2 persistAsset failed, keeping original URL:', (err as Error).message);
    return src;
  }
}
