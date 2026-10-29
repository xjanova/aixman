/**
 * A name for each file an order delivered, when it names them — a stem
 * split's "เสียงร้อง", "กลอง" … (kie-suno.ts). GenerationService keeps them in
 * the order's `params.outputLabels`, beside `result_urls`, since the files go
 * to R2 under random names. Null when there are none or they do not line up.
 */
export function outputLabels(params: unknown, urls: unknown): string[] | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const labels = (params as Record<string, unknown>).outputLabels;
  if (!Array.isArray(labels) || !Array.isArray(urls) || labels.length !== urls.length) return null;
  return labels.every((l) => typeof l === 'string') ? (labels as string[]).map((l) => l.slice(0, 80)) : null;
}
