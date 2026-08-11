import prisma from '@/lib/db';

/**
 * Release metadata for the X-DREAMER Android app.
 *
 * The APK is distributed as a GitHub Release asset on `xjanova/xdreamerapp`,
 * not through Play Store, so the app self-updates: it asks this endpoint what
 * the newest build is, downloads it, and hands it to the system installer.
 *
 * GitHub is queried **server-side**. That is the whole point — a private repo
 * needs a token to read, and a token compiled into an APK is a token anybody
 * can extract with `apktool`. The phone never sees it.
 */

const GITHUB_API = 'https://api.github.com';

/** GitHub's rate limit is 60/hour unauthenticated. One fetch per 10 minutes. */
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface AppRelease {
  latestVersion: string;
  latestBuild: number;
  minSupportedVersion: string;
  releaseNotes: string;
  apkUrl: string;
  apkSizeBytes: number;
  /** Hex digest from the release's SHA256SUMS.txt, when the CI published one. */
  sha256: string | null;
  publishedAt: string | null;
  /** True when the APK has to be streamed through this server to be readable. */
  proxied: boolean;
}

interface CacheEntry {
  value: AppRelease | null;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

function repoSlug(): string {
  return process.env.MOBILE_APP_REPO || 'xjanova/xdreamerapp';
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'aixman-mobile-release-check',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** `v0.1.3` and `0.1.3` both mean 0.1.3. */
function normaliseVersion(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

/**
 * Read the digest for the APK out of the SHA256SUMS.txt the release workflow
 * uploads. Returns null when the file is absent — the app then skips
 * verification rather than refusing to update, because an unverifiable update
 * is still better than a stuck one and Android checks the signing key anyway.
 */
async function readDigest(url: string, apkName: string, token: string | undefined): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'aixman-mobile-release-check',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'follow',
    });
    if (!response.ok) return null;

    const text = await response.text();
    for (const line of text.split('\n')) {
      const [digest, name] = line.trim().split(/\s+/);
      if (name?.replace(/^\*/, '') === apkName && /^[a-f0-9]{64}$/i.test(digest ?? '')) {
        return digest.toLowerCase();
      }
    }
  } catch {
    // Network hiccup reading an optional file — not worth failing the check.
  }
  return null;
}

/**
 * The floor below which the app must refuse to run.
 *
 * Kept in `ai_settings` rather than derived from the release so a bad build can
 * be forced off phones without cutting a new one. Absent means "never force".
 */
async function minSupportedVersion(): Promise<string> {
  try {
    const setting = await prisma.aiSetting.findUnique({
      where: { key: 'mobile_min_supported_version' },
    });
    const value = setting?.value?.trim();
    return value && /^\d+(\.\d+)*$/.test(normaliseVersion(value))
      ? normaliseVersion(value)
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function getLatestAppRelease(): Promise<AppRelease | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  let release: AppRelease | null = null;

  try {
    const response = await fetch(`${GITHUB_API}/repos/${repoSlug()}/releases/latest`, {
      headers: githubHeaders(),
      // Next would otherwise cache this at the fetch layer too, on its own clock.
      cache: 'no-store',
    });

    if (response.ok) {
      const data = (await response.json()) as {
        tag_name?: string;
        name?: string;
        body?: string;
        draft?: boolean;
        prerelease?: boolean;
        published_at?: string;
        assets?: Array<{ name: string; size: number; browser_download_url: string; url: string }>;
      };

      const assets = data.assets ?? [];
      const apk = assets.find((asset) => asset.name.toLowerCase().endsWith('.apk'));

      if (apk && !data.draft) {
        const sums = assets.find((asset) => asset.name.toUpperCase().startsWith('SHA256SUMS'));
        const token = process.env.GITHUB_TOKEN;
        // A private release asset is only readable with a token, so the phone
        // has to come back through us for the bytes.
        const proxied = Boolean(token);

        release = {
          latestVersion: normaliseVersion(data.tag_name ?? '0.0.0'),
          // Not published by GitHub; the app compares by version string.
          latestBuild: 0,
          minSupportedVersion: await minSupportedVersion(),
          releaseNotes: (data.body ?? '').trim(),
          apkUrl: proxied ? '/api/mobile/app-version/download' : apk.browser_download_url,
          apkSizeBytes: apk.size,
          sha256: sums ? await readDigest(sums.url, apk.name, token) : null,
          publishedAt: data.published_at ?? null,
          proxied,
        };
      }
    }
  } catch {
    // Leave `release` null — the client treats "no answer" as "up to date"
    // rather than nagging about an update it cannot describe.
  }

  cache = { value: release, expiresAt: now + CACHE_TTL_MS };
  return release;
}

/** The GitHub asset URL to stream from, for the proxied download route. */
export async function getApkAssetUrl(): Promise<string | null> {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${repoSlug()}/releases/latest`, {
      headers: githubHeaders(),
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      assets?: Array<{ name: string; url: string }>;
    };
    return data.assets?.find((asset) => asset.name.toLowerCase().endsWith('.apk'))?.url ?? null;
  } catch {
    return null;
  }
}
