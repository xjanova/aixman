import { getCatalogEntry } from '@/lib/gpu/catalog';
import { getKieEntry } from '@/lib/providers/kie-catalog';

/**
 * How many reference pictures a model takes with one order — a picture's
 * characters, props and places, or a clip's first (and last) frame.
 *
 * Two numbers decide it: what the vendor's model accepts, and what our
 * adapter actually forwards. A model is only as good as the smaller one, so
 * the table lists both and the page shows the result: 0 means the model
 * takes no reference and the movie studio will not offer it for opening
 * pictures. Unknown models answer 0 — a wrong "yes" would charge for a
 * picture that ignored every reference.
 *
 * Vendor limits, as of 2026-10:
 *   - Seedream 4.x / 5.x (BytePlus `image` array): 10 to 14 depending on the
 *     version; 10 is the lower bound across them, an admin may raise a row up
 *     to 14 with `defaultParams.maxReferenceImages`.
 *   - gpt-image-1 / -mini / -1.5 (OpenAI /images/edits `image[]`): 16.
 *     dall-e-2 one, dall-e-3 none.
 *   - fal / Replicate / Stability: our adapters forward a single image, and
 *     only to endpoints that read one.
 *   - Our rented video models take a first frame, some a last frame too.
 *   - KIE.ai rows: what each catalogue entry's builder forwards
 *     (kie-catalog.ts) — 3 to 16 pictures, or a clip's first/last frame.
 */

export interface ReferenceCaps {
  /** Reference pictures the model composes from (0 = none). */
  images: number;
  /** Video: opens on a given picture. */
  firstFrame: boolean;
  /** Video: ends on a given picture. */
  lastFrame: boolean;
}

export interface ReferenceModel {
  providerSlug: string;
  modelId: string;
  category: string;
  defaultParams?: unknown;
}

const NONE: ReferenceCaps = { images: 0, firstFrame: false, lastFrame: false };

/** [default, most our adapter can forward] */
function imageLimits(provider: string, model: string): [number, number] {
  const id = model.toLowerCase();
  switch (provider) {
    case 'byteplus':
      // seedream-3.0 is text-to-image only; seededit takes the one picture it edits.
      if (/seededit/.test(id)) return [1, 1];
      if (/seedream-?[4-9]/.test(id)) return [10, 14];
      return [0, 0];
    case 'openai':
      if (/^gpt-image/.test(id)) return [16, 16];
      if (id === 'dall-e-2') return [1, 1];
      return [0, 0];
    case 'fal':
      // runModel sends `image_url` — only an edit / image-to-image endpoint reads it.
      return /(\/edit\b|kontext|image-to-image|redux)/.test(id) ? [1, 1] : [0, 0];
    case 'replicate':
      return /(kontext|img2img|image-to-image)/.test(id) ? [1, 1] : [0, 0];
    case 'kie': {
      const n = getKieEntry(model)?.references ?? 0;
      return [n, n];
    }
    case 'stability':
      // editImage is SD3.5 image-to-image whatever the row.
      return /^sd3/.test(id) ? [1, 1] : [0, 0];
    default:
      return [0, 0];
  }
}

function adminOverride(defaultParams: unknown): number | null {
  const n = Number((defaultParams as { maxReferenceImages?: unknown } | null)?.maxReferenceImages);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function referenceCaps(model: ReferenceModel): ReferenceCaps {
  if (model.category === 'video') {
    // Only our rented models and KIE's are wired for frames end to end
    // (frame-input.ts, kie.ts).
    const video =
      model.providerSlug === 'simplepod'
        ? getCatalogEntry(model.modelId)?.video
        : model.providerSlug === 'kie'
          ? getKieEntry(model.modelId)
          : undefined;
    return video ? { images: 0, firstFrame: video.firstFrame === true, lastFrame: video.lastFrame === true } : NONE;
  }
  if (model.category !== 'image') return NONE;
  const [fallback, most] = imageLimits(model.providerSlug, model.modelId);
  const wanted = adminOverride(model.defaultParams) ?? fallback;
  return { images: Math.max(0, Math.min(wanted, most)), firstFrame: false, lastFrame: false };
}

/** What the page says about a model's references, in Thai. */
export function referenceLabel(caps: ReferenceCaps): string {
  if (caps.images > 0) return `รับภาพอ้างอิงได้ ${caps.images} ภาพ`;
  if (caps.firstFrame && caps.lastFrame) return 'รับภาพเฟรมแรกและเฟรมสุดท้าย';
  if (caps.firstFrame) return 'รับภาพเฟรมแรก 1 ภาพ';
  return 'ไม่รับภาพอ้างอิง';
}
