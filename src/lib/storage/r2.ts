import { randomBytes } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';

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
 *
 * Optional: R2_ENDPOINT — another S3-compatible server instead of Cloudflare's
 * (see endpointConfig). R2_ACCOUNT_ID is still required, so a half-configured
 * server never looks configured.
 *
 * Optional: R2_KEY_PREFIX — a folder this app owns inside a *shared* bucket
 * (production shares Thaiprompt's `fortune-voice`). Every key written gets it,
 * and only keys under it are ever treated as ours. That second half is the one
 * that matters: the retention sweep deletes whatever `keyFromPublicUrl` claims,
 * and without the prefix a customer who pasted a URL from the other app as an
 * input would have that app's file deleted when this one's retention ran out.
 */

let cachedClient: S3Client | null = null;

/** `aixman/` for R2_KEY_PREFIX=aixman, empty when unset. */
function keyPrefix(): string {
  const raw = process.env.R2_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, '');
  return raw ? `${raw}/` : '';
}

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
}

/**
 * Where the S3 API is. Cloudflare's, from the account id, unless R2_ENDPOINT
 * names another S3-compatible server — a local stand-in for the end-to-end
 * sandbox, or staging's own bucket — so that no test has to write to the
 * production bucket to see a render delivered. Such a server has no
 * per-bucket hostnames, so it is addressed path-style.
 */
function endpointConfig(): { endpoint: string; forcePathStyle?: true } {
  const custom = process.env.R2_ENDPOINT?.trim().replace(/\/+$/, '');
  if (custom) return { endpoint: custom, forcePathStyle: true };
  return { endpoint: `https://${process.env.R2_ACCOUNT_ID!}.r2.cloudflarestorage.com` };
}

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: 'auto',
    ...endpointConfig(),
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
  const fullKey = `${keyPrefix()}${key}`;
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: fullKey,
      Body: buffer,
      ContentType: contentType,
    })
  );
  const base = process.env.R2_PUBLIC_URL!.replace(/\/+$/, '');
  return `${base}/${fullKey}`;
}

/**
 * Recover the object key from a public URL we handed out.
 *
 * Returns null for anything not served from our bucket — a provider URL that
 * was stored before R2 was configured, say — and, when the bucket is shared,
 * for anything outside our prefix. The retention sweep relies on that to avoid
 * deleting objects it does not own.
 */
export function keyFromPublicUrl(url: string): string | null {
  const base = process.env.R2_PUBLIC_URL?.replace(/\/+$/, '');
  if (!base || !url?.startsWith(`${base}/`)) return null;
  const key = url.slice(base.length + 1).split('?')[0];
  if (key.length === 0) return null;
  const prefix = keyPrefix();
  return prefix && !key.startsWith(prefix) ? null : key;
}

/**
 * Delete objects from R2, in batches of 1000 (the API's limit).
 *
 * Reports counts rather than throwing on partial failure: a retention sweep
 * that aborts halfway would keep re-deleting the same first few keys on every
 * run and never reach the rest.
 */
export async function deleteObjects(keys: string[]): Promise<{ deleted: number; failed: number }> {
  if (!isStorageConfigured() || keys.length === 0) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const res = await getClient().send(
        new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET!,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
      failed += res.Errors?.length ?? 0;
      deleted += batch.length - (res.Errors?.length ?? 0);
    } catch (error) {
      console.error('[retention] R2 batch delete failed:', (error as Error).message);
      failed += batch.length;
    }
  }

  return { deleted, failed };
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
