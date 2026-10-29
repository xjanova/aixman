# Pricing page artwork

Decoration for `/pricing` (`src/app/(main)/pricing/page.tsx`). Every file here was
generated with **ChatGPT image generation** in the site owner's own ChatGPT account on
2026-10-29, made for this site, then converted to WebP. The emblems and the corner were
drawn on pure black; their black was turned into real transparency (alpha = the brightest
channel), so they sit on any dark background without a plate.

| File | What it is | ChatGPT original |
|---|---|---|
| hero-v1.webp | Hero band: crystal tokens woven from light over an obsidian floor | 1536×1024 PNG |
| tier-1.webp … tier-6.webp | Tier emblems, rising in prestige (seed of light → gold medallion), cut from one 3×2 sheet, 300 px square | 1536×1024 PNG sheet |
| corner-v1.webp | Gold-and-light filigree corner; the page mirrors it into all four corners of the recommended card | 1254×1254 PNG |

The page picks emblems by a package's rank by price (free → tier-1, the dearest → tier-6),
never by its slug, so new or renamed packages still get one. Replace a picture by
overwriting its file at the same size.
