# CLAUDE.md — AIXMAN (AI Generation Platform)

## Project Overview

AIXMAN is an AI image and video generation platform at **https://ai.xman4289.com**. It provides a unified interface for multiple AI providers (BytePlus, OpenAI, Stability AI, Runway, Replicate, fal.ai, Kling, Luma, Leonardo) with an Account Pool system for API key rotation and load balancing.

## CRITICAL: Cross-Project Relationship

**This project shares a MySQL database with xmanstudio (xman4289.com).**

- **xmanstudio repo:** https://github.com/xjanova/xmanstudio (Laravel 11)
- **aixman repo:** https://github.com/xjanova/aixman (Next.js 15)
- **Shared tables (owned by xmanstudio, READ-ONLY here):** `users`, `wallets`, `wallet_transactions`, `orders`, `affiliates`, `affiliate_commissions`
- **AIXMAN tables (owned by this project, prefixed `ai_`):** `ai_settings`, `ai_providers`, `ai_account_pools`, `ai_models`, `ai_credit_packages`, `ai_user_credits`, `ai_credit_transactions`, `ai_generations`, `ai_templates`, `ai_styles`, `ai_favorites`, `ai_usage_logs`

### Integration Points:
1. **Auth:** Users log in with same credentials as xmanstudio (Laravel bcrypt hashes, `$2y$` → `$2a$` compatible)
2. **Wallet → Credits:** Users buy AI credit packages via xmanstudio checkout. After payment, xmanstudio calls `POST /api/webhooks/xman-credit` to add credits
3. **Credit Packages:** `ai_credit_packages` table is the single source of truth for pricing. xmanstudio reads this for billing/affiliate. `GET /api/packages` is the public endpoint
4. **Affiliate:** Orders for AI credits go through xmanstudio's order/affiliate system

### NEVER:
- Run `prisma migrate` on shared tables (users, wallets, etc.) — managed by Laravel
- Modify shared table structures without coordinating with xmanstudio
- Store secrets in ai_ tables without encryption

## Tech Stack

- **Framework:** Next.js 15 (App Router) + React 19
- **3D/UI:** React Three Fiber + drei + Framer Motion
- **Styling:** Tailwind CSS v4
- **ORM:** Prisma (shared MySQL)
- **Auth:** NextAuth.js v5 (credentials, shared users table)
- **State:** Zustand
- **Deploy:** PM2 + GitHub Actions → /home/admin/domains/ai.xman4289.com

## Directory Structure

```
src/
  app/
    page.tsx                      # 3D Landing page
    login/page.tsx                # Login (shared accounts)
    (main)/                       # Public pages with navbar
      generate/page.tsx           # AI generation UI
      gallery/page.tsx            # User gallery/history
      pricing/page.tsx            # Credit packages
      profile/page.tsx            # User profile
    admin/                        # Admin panel (admin role required)
      page.tsx                    # Dashboard
      setup/page.tsx              # First-time setup wizard
      providers/                  # Provider management
      pools/                      # Account pool management
      models/                     # AI model management
      packages/                   # Credit package management
      settings/                   # Site settings
      analytics/                  # Usage analytics
    api/
      auth/[...nextauth]/         # NextAuth
      generate/                   # Generation endpoint
      gallery/                    # Gallery history
      credits/                    # User credits
      packages/                   # Public packages (for xman sync)
      webhooks/xman-credit/       # xmanstudio payment webhook
      admin/                      # Admin APIs
  components/
    layout/                       # Navbar, footer, providers
    three/                        # React Three Fiber 3D components
    ui/                           # Reusable UI components
  lib/
    auth.ts                       # NextAuth config
    db.ts                         # Prisma client
    providers/                    # 9 AI provider adapters
    services/
      account-pool.ts             # Pool rotation (3 modes)
      generation.ts               # Orchestrator
      credits.ts                  # Credit management
    store/app-store.ts            # Zustand
    utils/                        # cn, encryption
  types/index.ts                  # TypeScript types
```

## Common Commands

```bash
npm run dev          # Dev server
npm run build        # Production build
npx prisma generate  # Generate Prisma client
npx prisma db push   # Push schema (ai_ tables only!)
```

## Account Pool Rotation Modes

1. **Round Robin** — เวียนไปเรื่อยๆ ใช้ตัวที่นานสุดที่ไม่ได้ใช้
2. **Balanced** — เฉลี่ยเท่ากัน ใช้ตัวที่ usage น้อยสุด
3. **Quota First** — ใช้ตัวที่เหลือ quota เยอะสุดก่อน

Auto-cooldown on rate limit (5 min), auto-disable after 5 consecutive errors.

## Credit System

- Separate from wallet, stored in `ai_user_credits`
- Buy via xmanstudio checkout → webhook adds credits
- Generation deducts credits; failures auto-refund
- `ai_credit_packages` shared for price sync + affiliate

## Coding Conventions

- UI text: Thai, code: English
- Dark mode only, glassmorphism theme
- CSS utilities: `glass`, `glass-light`, `gradient-text`, `glow`
- Auth: `getCurrentUserId()`, `isAdmin()` from `@/lib/auth`
- API keys encrypted via `encrypt()`/`decrypt()` from `@/lib/utils/encryption`
