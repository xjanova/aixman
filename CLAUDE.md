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
1. **Auth:** Two ways in, both landing on the same shared `users` row:
   - **Password** — same credentials as xmanstudio (Laravel bcrypt hashes, `$2y$` → `$2a$` compatible)
   - **"Sign in with XMAN ID" (SSO)** — `src/lib/xman-sso.ts` + `/api/auth/xman/{start,callback}` for the web, `/api/mobile/auth/xman-exchange` for the app. PKCE; the verifier stays server-side in an httpOnly cookie, the code comes back through the browser. The callback trades it server-to-server, then hands the browser a single-use ticket that the `xman-sso` NextAuth provider redeems.
   - **`XMAN_SSO_SECRET` must equal xmanstudio's `XDREAMER_SSO_SECRET`** (different variable name, same value). Missing on either side → exchange answers 503 and SSO is dead; the UI shows `?xman_error=unavailable` rather than failing silently.
   - The ticket store in `xman-sso.ts` is in-process, like `rate-limit.ts`. It is correct only because `ecosystem.config.cjs` runs `instances: 1` — under cluster mode a redeem can land on a different worker and sign-ins fail at random.
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
    providers/                    # 9 AI provider adapters (inference APIs)
    gpu/                          # GPU *rental* adapters (not inference APIs)
      types.ts                    # GpuRentalProvider interface
      simplepod.ts                # SimplePod.ai marketplace
      config.ts                   # Budget caps + worker profiles (ai_settings)
      worker-client.ts            # HTTP client for the container (ComfyUI)
    services/
      account-pool.ts             # Pool rotation (3 modes)
      generation.ts               # Orchestrator
      credits.ts                  # Credit management
      gpu-worker.ts               # Rent / health / reap rented machines
      gpu-queue.ts                # FIFO job queue, 1 render per GPU
      gpu-lock.ts                 # Cross-process tick lease
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

## Self-Hosted GPU (SimplePod → MiniMax H3)

**SimplePod is a GPU rental marketplace, NOT an inference API.** There is no
`/generate` endpoint and no model list — it rents a Docker container on a GPU
host and publishes its ports over a Cloudflare tunnel. We run the model
ourselves and call the server inside the container.

Flow: `/api/generate` → credits deducted → `ai_gpu_jobs` row → cron tick rents a
GPU → container warms up → render → copied to R2 → generation completed.

**Billing is per second of uptime, not per request.** A worker burns money from
the moment it is rented until it is terminated, whether or not anyone is
generating. Consequences that must never be regressed:

- `/api/cron/gpu-tick` **must run every minute** — it is what reaps machines.
  If it stops, rented GPUs bill forever. Schedule alongside `reset-counters`.
- Budget caps live in `ai_settings` group `gpu` and are read fresh every tick:
  `gpu_daily_budget_usd`, `gpu_max_concurrent_workers`, `gpu_idle_timeout_minutes`,
  `gpu_max_worker_lifetime_minutes` (absolute kill switch).
- The orphan sweep only terminates instances named `aixman-*`. Never name an
  unrelated SimplePod instance with that prefix.
- Results **must** go to R2 before the worker is reaped — the tunnel URL dies
  with the machine, so `persistAssetSafe` is wrong here (it would return a URL
  that breaks minutes later).
- The container port is publicly reachable and ComfyUI has no auth of its own.
  Each worker gets `AIXMAN_WORKER_TOKEN`; the image is expected to enforce it.

**Setup is API-key-only.** Admin → GPU ที่เช่า → paste the SimplePod key. That
verifies it, creates the provider + encrypted credential, writes the budget
caps, and activates the model. Nothing else is required because:

- **No custom Docker image.** A stock `pytorch/pytorch` CUDA 12.8 image is
  booted and `src/lib/gpu/provision.ts` installs ComfyUI, pulls the weights, and
  starts a token-gated proxy. CUDA 12.8 is deliberate: first release with
  Blackwell (5090) support that still runs on common host drivers.
- **No workflow to paste.** `src/lib/gpu/workflows/minimax-h3.ts` is the official
  Comfy-Org `video_minimax_h3_t2v` template flattened out of its subgraph into
  API format. `comfy-validate.ts` checks it against the worker's live
  `/object_info` before each submit, which also catches half-downloaded weights.
- **No crontab.** `src/instrumentation.ts` starts an in-process scheduler.

Gotchas that will bite if changed carelessly:
- Frame count must satisfy `length % 17 === 5` (latent temporal compression) —
  `frameLengthFor()` handles it. The official template does this with
  `ComfyMathExpression`, a custom node we deliberately do not depend on.
- Weights are ~42.5 GB, so warmup is 20–40 min on a fresh host. The client
  poller must outlast `warmupTimeout + jobTimeout` or it tells users a healthy
  job failed and they pay twice.
- 2K output is not offered — it needs 4× H100 (123.6 GB VRAM), which this
  marketplace does not carry. 1344×768 matches the official template.

Adding another vendor (RunPod, Vast.ai): implement `GpuRentalProvider` and
register it in `src/lib/gpu/index.ts`. Nothing else changes.

`/admin/gpu` is the control room: balance, live burn rate, budget caps,
utilisation, and profit. Profit uses *worker uptime* cost, not per-job cost —
warmup and idle are real spend that no single job carries.

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
