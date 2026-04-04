<p align="center">
  <img src="public/xmanailogo.png" alt="XMAN AI Studio" width="200" />
</p>

<h1 align="center">XMAN AI Studio</h1>

<p align="center">
  <strong>AI Image & Video Generation Platform</strong><br/>
  <a href="https://ai.xman4289.com">ai.xman4289.com</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.2-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss" alt="Tailwind" />
</p>

---

## Overview

XMAN AI Studio is a full-featured AI generation platform that aggregates **9 AI providers** and **40+ models** into a single interface with unified credit billing, account pool rotation, and an admin dashboard. Built with Next.js App Router and deployed on a DirectAdmin server with PM2 + Apache reverse proxy.

**Live:** https://ai.xman4289.com
**Parent project:** [XMAN Studio](https://xman4289.com) (Laravel) — shared database & auth

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

### Generation
- Text-to-Image, Text-to-Video, Image-to-Video, Image Editing
- 40+ AI models with per-model credit pricing
- 15 style presets (Photorealistic, Anime, Cyberpunk, Cinematic, etc.)
- Prompt templates for quick start
- Async generation with real-time polling
- Auto-refund on generation failure

### Credit System
- Atomic credit deduction (prevents double-spend via raw SQL)
- 5 packages: Free trial (20 credits) to Enterprise (6,500 credits)
- Transaction history with full audit trail
- Webhook integration with XMAN Studio for purchases

### Account Pool
- Multi-account rotation per provider (round robin, balanced, quota-first)
- Daily/monthly quota tracking
- Auto-cooldown after rate limits
- Auto-disable after 5 consecutive errors
- Encrypted API key storage (AES-256-GCM)

### Admin Dashboard
- Provider management (CRUD + toggle active)
- Model management (40+ models, categories, pricing)
- Account pool monitoring (status, usage, errors)
- Credit package management
- Analytics (daily generations, top models, revenue)
- System settings (30+ configurable keys)
- One-click seed data for initial setup

### Frontend
- Dreamy 3D hero with React Three Fiber + Bloom postprocessing
- Ambient floating gradient orbs background
- Glassmorphism UI with blue/purple/cyan theme
- Mobile responsive with bottom navigation
- PWA support (manifest, service worker, app icons)
- Toast notifications
- Gallery with search, filters, favorites, download
- Dynamic pricing page from database

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16.2 (App Router, Turbopack) |
| **Language** | TypeScript 5, React 19 |
| **Database** | MySQL (shared with XMAN Studio via Prisma 7) |
| **ORM** | Prisma 7 with `@prisma/adapter-mariadb` |
| **Auth** | NextAuth v5 (beta) — JWT, credentials provider, Laravel bcrypt compatible |
| **Styling** | Tailwind CSS v4, Framer Motion |
| **3D** | React Three Fiber, drei, postprocessing |
| **State** | Zustand |
| **UI** | Radix UI primitives, Lucide icons |
| **Encryption** | Node.js native crypto (AES-256-GCM) |
| **Deploy** | PM2, Apache reverse proxy, GitHub Actions CI/CD |

---

## Project Structure

```
src/
  app/
    (main)/           # Public pages (generate, gallery, pricing, profile)
    admin/            # Admin panel (dashboard, providers, models, packages, etc.)
    api/
      admin/          # Admin APIs (CRUD, analytics, seed, settings)
      auth/           # NextAuth handlers
      credits/        # Credit balance & history
      favorites/      # User favorites
      gallery/        # Generation gallery with filtering
      generate/       # Generation submit & status polling
      models/         # Public model listing
      packages/       # Credit packages
      styles/         # Style presets
      webhooks/       # XMAN Studio credit webhook
    login/            # Login page
    page.tsx          # Homepage with 3D hero
    layout.tsx        # Root layout (PWA, ambient bg, toast)
    error.tsx         # Error boundary
  components/
    ambient/          # Floating gradient orbs background
    layout/           # Navbar, mobile nav, session provider
    pwa/              # Service worker registration
    three/            # 3D hero scene (R3F + bloom)
    ui/               # Toast provider
  lib/
    providers/        # 9 AI provider adapters + base class
    services/         # Generation, credits, account pool
    store/            # Zustand app store
    utils/            # Encryption, cn utility
    auth.ts           # NextAuth configuration
    db.ts             # Prisma client
  types/              # TypeScript definitions
prisma/
  schema.prisma       # 14 models (shared users + AI tables)
public/
  manifest.json       # PWA manifest
  sw.js               # Service worker
  icons/              # PWA icons (72-512px)
  logo.webp           # Logo (WebP)
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

Login as admin, go to `/admin`, click **"สร้างข้อมูลเริ่มต้น"** to seed:
- 9 providers, 40+ models, 5 packages, 15 styles, 8 templates, 30+ settings

---

## Deployment (CI/CD)

Automated via GitHub Actions:

1. **CI** (`ci.yml`): Build + TypeScript check on every push to `main`
2. **Auto Release** (`ci.yml`): Patch version bump + GitHub Release after CI passes
3. **Auto Deploy** (`auto-deploy.yml`): SSH deploy after CI, runs `npm ci` + `prisma generate` + `npm run build` + `pm2 restart`

Production: PM2 on port 3001, Apache reverse proxy to `https://ai.xman4289.com`

---

## Cross-Project Integration

AIXMAN shares the `users` and `wallets` tables with [XMAN Studio](https://xman4289.com) (Laravel):

- **Auth**: Same email/password, bcrypt `$2y$` compatible
- **Credit Purchase**: XMAN Studio checkout calls webhook `POST /api/webhooks/xman-credit`
- **Checkout URL**: `https://xman4289.com/checkout/ai-credits/{packageSlug}?ref=ai`

---

## Security

- AES-256-GCM encryption for API keys in database
- Atomic credit deduction prevents race conditions
- Constant-time webhook secret comparison (`crypto.timingSafeEqual`)
- Input validation and sanitization on all endpoints
- No secrets in client-side code
- Auto-refund on generation failure

---

## License

Private. All rights reserved. XMAN Studio.
