/**
 * Renders the X-DREAMER mark into the favicons and app icons in public/.
 *
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning \
 *     --import ./scripts/alias-loader.mjs scripts/render-brand-icons.mts
 *
 * Geometry comes from src/components/xdreamer/logo-paths.ts — the same paths
 * <XdreamerMark> draws — so run this again whenever those change.
 *
 * - favicon.png (32): the full weave on transparent.
 * - favicon-16x16.png: two plain strokes; at 16 px the weave is one blur.
 * - apple-touch-icon.png (180) and icons/icon-*.png: the mark on the site's
 *   ink, inset so a maskable crop (the middle 80%) never clips a thread.
 */
import sharp from "sharp";
import { markSvg } from "@/components/xdreamer/logo-paths";

const INK = "#05070F";
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function render(svg: string, out: string, size: number): Promise<void> {
  // Rasterise at 4x and downscale: librsvg's own antialiasing is soft on thin strokes.
  await sharp(Buffer.from(svg), { density: 72 * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`${out} (${size}x${size})`);
}

await render(markSvg({ size: 32, spark: false }), "public/favicon.png", 32);
await render(markSvg({ size: 16, simple: true }), "public/favicon-16x16.png", 16);
await render(markSvg({ size: 180, tile: INK, inset: 0.16 }), "public/apple-touch-icon.png", 180);
for (const size of ICON_SIZES) {
  await render(markSvg({ size, tile: INK, inset: 0.18 }), `public/icons/icon-${size}x${size}.png`, size);
}
