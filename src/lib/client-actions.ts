/**
 * Small browser-side actions shared by the studio and the gallery.
 *
 * Each one owns its try/catch and returns failure as a value, so the pages
 * that call them need none. That is not style: React Compiler cannot compile a
 * component whose try/catch contains a value block (`||`, `??`, `?.`, a
 * ternary) or a `throw`, and it gives up on the whole component silently —
 * no memoization, and every compiler-based lint rule stops checking it.
 * `react-hooks/todo` in eslint.config.mjs is what now reports that.
 */

/** Fetch a file and hand it to the browser as a download. */
export async function downloadAs(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    // An error page saved under the file's name is worse than no download.
    if (!res.ok) return false;
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(href);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save one of a generation's results. A file on another origin — our R2
 * bucket, a provider's CDN — cannot be read by the page (R2 sends no CORS
 * headers), so it is fetched through our own `/api/generate/[id]/download`.
 * `index` picks an entry of `resultUrls` when there are several.
 */
export async function downloadGeneration(generationId: number, url: string, filename: string, index = -1): Promise<boolean> {
  const href = pageCanRead(url) ? url : `/api/generate/${generationId}/download${index >= 0 ? `?i=${index}` : ""}`;
  return downloadAs(href, filename);
}

function pageCanRead(url: string): boolean {
  if (/^(data|blob):/i.test(url)) return true;
  try { return new URL(url, location.href).origin === location.origin; } catch { return false; }
}

/**
 * Extension to save `url` under, read from its path — a song is FLAC, a render
 * may be PNG — or `fallback` when the path has none. Guessing from the
 * generation type alone named songs `.webp`, which no player will open.
 */
export function extensionOf(url: string, fallback: string): string {
  let path = url;
  try { path = new URL(url, "https://x.invalid").pathname; } catch { /* keep the raw string */ }
  return /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase() ?? fallback;
}

/**
 * Add (`favorited`) or remove a favourite. Any HTTP answer counts as done,
 * as it always has in both pages — only a failed request does not.
 */
export async function saveFavorite(generationId: number, favorited: boolean): Promise<boolean> {
  try {
    await fetch("/api/favorites", {
      method: favorited ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId }),
    });
    return true;
  } catch {
    return false;
  }
}
