/**
 * Renders the X-DREAMER mark into the favicons and app icons in public/.
 *
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning \
 *     --import ./scripts/alias-loader.mjs scripts/render-brand-icons.mts
 *
 * Geometry comes from src/components/xdreamer/logo-paths.ts — the same paths
 * <XdreamerMark> draws — so run this again whenever those change.
 *
 * - src/app/favicon.ico (16, 32, 48, 256): what browsers fetch first.
 * - favicon.png (32): the full weave on transparent.
 * - favicon-16x16.png: two plain strokes; at 16 px the weave is one blur.
 * - apple-touch-icon.png (180) and icons/icon-*.png: the mark on the site's
 *   ink, inset so a maskable crop (the middle 80%) never clips a thread.
 */
import { writeFile } from "node:fs/promises";
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

/**
 * A .ico holding PNGs (Vista+ reads them; every current browser does). Next
 * serves src/app/favicon.ico as /favicon.ico, and browsers ask for it first.
 */
async function renderIco(out: string): Promise<void> {
  const sizes = [16, 32, 48, 256];
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(Buffer.from(markSvg({ size, simple: size === 16, spark: size >= 48 })), { density: 72 * 4 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); // no palette
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4); // planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  await writeFile(out, Buffer.concat([header, ...images]));
  console.log(`${out} (${sizes.join(", ")})`);
}

await renderIco("src/app/favicon.ico");
await render(markSvg({ size: 32, spark: false }), "public/favicon.png", 32);
await render(markSvg({ size: 16, simple: true }), "public/favicon-16x16.png", 16);
await render(markSvg({ size: 180, tile: INK, inset: 0.16 }), "public/apple-touch-icon.png", 180);
for (const size of ICON_SIZES) {
  await render(markSvg({ size, tile: INK, inset: 0.18 }), `public/icons/icon-${size}x${size}.png`, size);
}
