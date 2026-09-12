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
