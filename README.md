<p align="center">
  <img src="public/xdreamer-logo.png" alt="X-DREAMER" width="160" />
</p>

<h1 align="center">X-DREAMER</h1>

<p align="center">
  <strong>ทอความฝันจากเส้นใยแห่งความคิด</strong><br/>
  AI generation platform — image, video, edit, audio<br/>
  <a href="https://ai.xman4289.com">ai.xman4289.com</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.2-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Theme-X--DREAMER-8b5cf6?logo=stylelint" alt="X-DREAMER theme" />
</p>

---

## Overview

**X-DREAMER** (formerly XMAN AI Studio) is a full-featured AI generation
platform that aggregates **9 AI providers** and **40+ models** into a single
interface with unified credit billing, account-pool rotation, an admin
dashboard, and a community gallery — all wrapped in the X-DREAMER design
language ("ทอความฝันจากเส้นใยแห่งความคิด").

Built with Next.js App Router and deployed on a DirectAdmin server via
PM2 + Apache reverse proxy. Shares its database and authentication with
the parent project at [XMAN Studio](https://xman4289.com) (Laravel).

- **Live:** https://ai.xman4289.com
- **Marketing landing (Laravel mirror):** https://xman4289.com/xdreamer
- **Theme reference:** [/_xdreamer-ref/index.html](https://ai.xman4289.com/_xdreamer-ref/index.html) (vendored design handoff)

---

## Design — X-DREAMER theme

Every route ships the same identity:

- **Palette:** near-black bg (`#030612`), glass surfaces (rgba-15/23/42),
  fiber-thread accents in cyan / violet / emerald, hue-shift parameter
  (default 70°) so the entire palette can be re-keyed in one change.
- **Typography:** Inter for Latin (200..900) + Noto Sans Thai for Thai
  glyphs (200..700), loaded via `next/font/google`.
  - H1: `clamp(48px, 6vw, 80px)`, weight 300, `letter-spacing -0.02em`
  - Italic emphasis spans use weight 200 + a violet/cyan gradient
- **Background:** canvas-based fiber-threads animation (DPR cap 1.5,
  30fps, IntersectionObserver-paused) + frosted radial overlay that
  fades up near the hero on `/` and settles into a calm baseline on
  every other route.
- **Inline styles** match the reference template's pixel values exactly —
  primitives live in `src/components/xdreamer/shared.tsx`
  (`FiberThreads`, `XdrThemeStyles`, `XdrNav`, `UserMenu`, `XdrPageShell`).

---

## AI Providers

| Provider | Capabilities | Notable Models |
|----------|-------------|----------------|
| **BytePlus** | Image, Video, Edit | Seedream 5.0, Seedance 2.0 |
| **OpenAI** | Image, Video | GPT Image 1, DALL-E 3, Sora 2 |
| **Stability AI** | Image, Edit | Stable Image Ultra, SD 3.5, Upscale, Inpaint |
| **Replicate** | Image, Video, Edit | FLUX 1.1 Pro, FLUX Schnell, FLUX Pro Ultra |
| **fal.ai** | Image, Video, Edit | FLUX (fast), Recraft V3, Creative Upscaler |
| **Runway ML** | Image, Video | Gen-4 Turbo, Gen-3 Alpha Turbo |
| **Kling AI** | Image, Video | Kling 2.5 Pro, Kolors |
| **Luma AI** | Image, Video | Ray 2, Ray 2 Flash |
| **Leonardo.ai** | Image | Phoenix 1.0, Kino XL |

---

## Features

### Generation studio (`/generate`)
3-column workspace inspired by the X-DREAMER `StudioPage`:
left rail (prompt + model + style + aspect + batch + img2img + advanced),
centre canvas (4-frame batch grid + result + action toolbar — download,
favorite, share, upscale, regenerate), right rail (credit balance +
prompt tips + quick links).

- Text-to-Image, Text-to-Video, Image-to-Video, Image Editing
- 40+ AI models with per-model credit pricing
- 15 style presets (Photorealistic, Anime, Cyberpunk, Cinematic, …)
- Async generation with real-time polling, auto-refund on failure
- Img2img with strength slider + side-by-side comparison
- Batch generation up to 4 images/run

### Gallery (`/gallery`)
Masonry layout (4 → 3 → 2 cols) with filter chips, sort, debounced
search, paginated load-more, click-to-detail modal with download +
favorite + upscale.

### Dashboard (`/profile`)
Avatar header, 4 hue-mapped stat cards (credits / works / used / bonus),
recent works grid, credit balance with usage bar, quick menu, full
transaction history.

### Pricing (`/pricing`)
Live tiers from `ai_credit_packages` (currency toggle THB/USD), credit
cost table from `ai_models`, wallet hint linking back to xman4289.com
checkout.

### Auth (`/login`)
Centered glass card on the X-DREAMER fiber background — NextAuth
credentials, redirects to `/generate` on success.

### Referral (`/referral`)
Code display + copy/share, 3 stat cards, apply-code form, list of
referred users, 3-step "วิธีการทำงาน" with hue-glow numbered nodes.

### Admin (`/admin/*`)
Glass sidebar with hue-mapped active links + back-to-app + user chip.
Pages:
- **Dashboard** — 8 hue-mapped stat cards + seed-data action + 6 quick actions
- **Providers** — glass table + status dots + capability chips + dark modal CRUD forms (force-dynamic to bypass ISR cache)
- *(others on the legacy neumorphism shell — being ported)*

### Cross-project integration
Pricing CTAs route to
`https://xman4289.com/checkout/ai-credits/{slug}?ref=ai`. After payment
clears, `xmanstudio` fires a webhook back to
`POST /api/webhooks/xman-credit` (with `x-webhook-secret` header) and
this side credits the user's account. Idempotent via metadata flag.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16.2 (App Router, Turbopack) |
| **Language** | TypeScript 5, React 19 |
| **Database** | MySQL (shared with XMAN Studio via Prisma 7) |
| **ORM** | Prisma 7 with `@prisma/adapter-mariadb` |
| **Auth** | NextAuth v5 (beta) — JWT, credentials provider, Laravel bcrypt compatible |
| **Styling** | Tailwind CSS v4, inline-style X-DREAMER primitives, Framer Motion |
| **Fonts** | Inter (200..900) + Noto Sans Thai (200..700) via `next/font/google` |
| **Animation** | Canvas (fiber-threads, banner patterns), 30fps cap, IntersectionObserver pause |
| **State** | Zustand |
| **UI** | Radix UI primitives, Lucide icons (legacy admin), inline X-DREAMER spec |
| **Encryption** | Node.js native crypto (AES-256-GCM) |
| **Deploy** | PM2, Apache reverse proxy, GitHub Actions CI/CD |

---

## Project Structure

```
src/
  app/
    (main)/             # Authenticated app routes — all on X-DREAMER theme
      generate/         # StudioPage 3-col workspace
      gallery/          # GalleryDetailPage masonry
      pricing/          # X-DREAMER pricing tiers + cost table
      profile/          # DashboardPage
      referral/         # X-DREAMER glass cards
      layout.tsx        # XdrThemeStyles + XdrNav wrapper
    admin/
      page.tsx          # Admin DashboardPage (8 stat cards + seed + actions)
      layout.tsx        # X-DREAMER glass sidebar
      providers/        # Provider CRUD (dynamic-rendered, glass table + modals)
      pools/ models/ packages/ analytics/ settings/ setup/   # Legacy neumorphism (to port)
    api/
      admin/            # Admin APIs (CRUD, analytics, seed, settings)
      auth/             # NextAuth handlers
      credits/          # Credit balance & history
      favorites/        # User favorites
      gallery/          # Generation gallery with filtering
      generate/         # Generation submit & status polling
      models/           # Public model listing
      packages/         # Credit packages
      styles/           # Style presets
      webhooks/         # XMAN Studio credit webhook
    login/              # AuthPage centered card
    page.tsx            # Server: load packages → <XdreamerLanding>
    layout.tsx          # Root layout (Inter + Noto Sans Thai, AmbientBackground, providers)
  components/
    xdreamer/
      shared.tsx        # FiberThreads, XdrThemeStyles, XdrNav, UserMenu, XdrPageShell
      landing.tsx       # Full landing (Hero + BannerSlider + Features + Gallery + HowItWorks + Pricing + FooterCTA)
    ambient/            # AmbientBackground — global fiber bg + scroll-fade
    layout/             # SessionProvider (legacy nav/mobile-nav still present, unused)
    pwa/                # Service worker registration
    three/              # Legacy 3D hero (unused on X-DREAMER landing)
    ui/                 # Toast provider, Radix-based primitives (used by some legacy pages)
  lib/
    providers/          # 9 AI provider adapters + base class
    services/           # Generation, credits, account pool
    store/              # Zustand app store
    utils/              # Encryption, cn utility
    auth.ts             # NextAuth configuration
    db.ts               # Prisma client
  types/                # TypeScript definitions
prisma/
  schema.prisma         # 14 models (shared users + AI tables)
public/
  xdreamer-logo.png     # X-DREAMER brand mark
  manifest.json         # PWA manifest
  sw.js                 # Service worker
  icons/                # PWA icons (72-512px)
  _xdreamer-ref/        # Vendored design handoff (visual parity reference)
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- MySQL database (shared with XMAN Studio)

### Installation

```bash
git clone https://github.com/xjanova/aixman.git
cd aixman
npm install
```

### Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL="mysql://user:pass@localhost:3306/xmanstudio"
AUTH_SECRET=your-secret-key-min-32-chars
NEXTAUTH_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_XMAN_URL=https://xman4289.com
ENCRYPTION_KEY=your-32-char-encryption-key
```

### Database

```bash
npx prisma generate
npx prisma db push
```

### Run

```bash
npm run dev        # Development (port 3000)
npm run build      # Production build
npm start          # Production server
```

### Seed Data

Login as admin, go to `/admin`, click **"✦ สร้างข้อมูลเริ่มต้น"** to seed:
- 9 providers, 40+ models, 5 packages, 15 styles, 8 templates, 30+ settings

---

## Deployment (CI/CD)

Automated via GitHub Actions:

1. **CI** (`ci.yml`): Build + TypeScript check on every push to `main`
2. **Auto Release** (`ci.yml`): Patch version bump + GitHub Release after CI passes
3. **Auto Deploy** (`auto-deploy.yml`): SSH deploy after CI, runs `npm ci` + `prisma generate` + `npm run build` + `pm2 restart`

Production: PM2 on port 3001, Apache reverse proxy to `https://ai.xman4289.com`.

---

## Cross-Project Integration

AIXMAN shares the `users` and `wallets` tables with
[XMAN Studio](https://xman4289.com) (Laravel):

- **Auth** — same email/password (bcrypt `$2y$` compatible).
- **Pricing CTAs** — paid tiers redirect to
  `https://xman4289.com/checkout/ai-credits/{packageSlug}?ref=ai`.
- **Credit purchase webhook** — XMAN Studio's `StripeWebhookController`
  (or PromptPay/bank-transfer success handler) calls
  `POST https://ai.xman4289.com/api/webhooks/xman-credit` with header
  `x-webhook-secret`. Body:
  ```json
  {
    "userId": 12,
    "packageId": "creator",
    "orderId": "8421",
    "credits": 500,
    "bonusCredits": 50
  }
  ```
  Webhook is idempotent — replays on the same `orderId` are no-ops.

---

## Security

- AES-256-GCM encryption for API keys in database
- Atomic credit deduction prevents race conditions
- Constant-time webhook secret comparison (`crypto.timingSafeEqual`)
- Input validation and sanitization on all endpoints
- No secrets in client-side code
- Auto-refund on generation failure
- Admin routes gated by NextAuth role check (`admin` / `super_admin`)

---

## License

Private. All rights reserved. XMAN Studio.
