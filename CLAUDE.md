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

## Git workflow

- **Commit straight to `main`.** Don't create feature branches or open PRs. The owner decided this on 2026-09-13.
- A push to `main` runs CI ("CI - Build & Quality Checks"), then auto-deploys to production. So before every push, run `npx tsc --noEmit`, eslint on the files you changed, and `npm run build`, and push only deployable states.
- CI commits `chore: release vX.Y.Z` to `main` after each push. Pull (or rebase) before pushing.

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

## KIE.ai — the primary API provider (one key, provider `kie`)

Since 2026-10-29 the owner's chosen main provider: one key reaches image, edit,
video, lip-sync and music models. Code: `src/lib/providers/kie{,-catalog,-pricing,-sync}.ts`,
`/api/admin/providers/kie`, the card on Admin → ผู้ให้บริการ (paste key → checked
against the free `/api/v1/chat/credit` → encrypted pool row, daily quota 0 → rows synced).
- **The catalogue is the model list.** Each `kie-catalog.ts` entry is a row
  (`model_id` = `kie/…`, never renamed) with its USD prices, reference cap, frames
  and `build()` → `{model, input}`. GenerationService refuses a `kie` row with no
  entry (it would reach KIE as an unknown model after charging). Retire a model by
  moving its key to `RETIRED_KIE_KEYS`; "ซิงก์โมเดล/ราคา" switches its row off.
- **Price = a credits table**, `defaultParams.kie` (tier × sold length, per voice
  second, per extra picture), written by the sync at twice cost at the cheapest
  package rate. `/api/models` sends `defaultParams` to anyone — **never put USD in
  it**. The studio and GenerationService both price with `kieQuote`; the adapter
  sends the tier and length GenerationService stored, never the raw request.
- Every KIE order runs deferred (`after()` + poll, ApiOrderSweep after 60 min).
  Errors arrive as HTTP 200 with a `code`. **`ProviderResponse.orderFault`**: a
  refused prompt, a failed render, a timeout or a bad input is the order's, not the
  key's — counted, five customers' bad prompts would disable the one key every
  KIE model shares. 401/402 do count; 402 raises `kie-balance`. Re-pasting the
  same key reactivates it.
- Inputs: our R2 https URLs as they are; data: URIs go through KIE's base64 upload.
- Not yet exercised against the live API (no key on 2026-10-29): input field
  names come from docs.kie.ai — a family that 422s needs its `build()` fixed.

## Self-Hosted GPU (SimplePod · RunPod · Vast.ai · Verda · Google Cloud → MiniMax H3)

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
  The in-process scheduler (`gpu-scheduler.ts`) runs one loop: the full tick
  once a minute and, between them, a **fast lane** every 10 s
  (`GpuQueue.fastTick`) that only collects finished renders and feeds idle
  machines — it never rents, reaps or sweeps. Keep both on the one loop: a
  second timer could hold the lock when the reaping tick is due.
- **Cost = uptime × hourly price + download fees** (`rental-cost.ts
  rentalCostUsd`, behind `accruedCostUsd`, `todaySpendUsd`, the daily report).
  A Vast host bills each GB downloaded (`inet_down_cost`); the rate and a full
  boot's GB are stored at rent (`metadata.ingress`), charged in full once the
  machine is ready, else for the bytes on its disk. Still a floor (pip and the
  image pull are not measured) — the vendor balance is the backstop.
- Budget caps live in `ai_settings` group `gpu` and are read fresh every tick:
  `gpu_daily_budget_usd`, `gpu_max_concurrent_workers`, `gpu_idle_timeout_minutes`,
  `gpu_max_worker_lifetime_minutes` (absolute kill switch).
- Scaling (`GpuQueue.dispatchQueued` → `GpuWorkerManager.addCapacity`): models
  are served oldest-job-first; every idle booted machine of a model takes a
  job; another machine is rented only when the **work plan** says so
  (`gpu-scaler.ts planBacklog`): the backlog is played out job by job on the
  machines the model has (each free after its render or boot) and on 1, 2 …
  more, and the option with the least extra cost plus customers' wait
  (`gpu_wait_value_usd_per_hour`) wins, fewer machines on a tie. An added
  machine's cost (`addedMachineUsd`) is its boot + the model's mean download
  fee, divided by the chance it boots (prior 0.15 fails), + the plain idle
  timeout: four cheap-boot machines that finish sooner for cents are rented,
  extras that each pay a 40 GB Vast download are not. The
  latest plan per model shows on Admin → GPU (`/api/admin/gpu/machines`,
  in process). Models run side by side up to the cap; at the cap
  a model with no machine, or whose backlog has outgrown its machines, may
  take an *idle* other-model machine's slot (one with nothing queued for it),
  but not one just used or open in a customer's studio for the first 90 s
  (anti ping-pong). A model with *no* machine that has waited 10 min at the
  cap with no idle machine anywhere gets a **hand-over** (`pickHandover`,
  `metadata.handOverTo`): one machine of a model that has ≥ 2 takes no new
  job (`handoverHolds`) and is released when its current one ends — a long
  backlog never goes idle, so idle-release alone starved a song behind a
  60-shot film. One promise at a time; withdrawn when nothing waits for it.
  An idle machine closes after the idle timeout, except the model's **warmest**
  (`isWarmestIdle`: none of its machines busy or used more recently; ties to
  the lower id), which waits its **keep-warm** time (`rental-cost.ts
  keepWarmMinutes`): longer when its own boot was dear — until the idle minutes
  would cost more than booting again (its boot minutes + the host's download
  fees; ski-rental break-even), at most 20 min. An LTX film ordered in waves
  had rented 17 machines, each pulling 40 GB again; an MV's lip-sync extras all
  idling out their keep-warm was the opposite waste. Only the warmest gets the
  studio-presence grace on top.
- Pre-warm (`GpuQueue.prewarm`, `gpu_prewarm_cooldown_minutes`, default 30,
  0 = off): a customer whose credits cover the model's smallest order *arriving*
  on the studio (from 25 s on the model — the studio auto-selects and pings on
  every switch, so click-throughs must not count — until 3 min into the visit;
  a tab left open never asks again) gets a machine rented before they order,
  so the boot overlaps the prompt.
  Only for a model with no machine and nothing queued, only into a free slot
  (never evicts), not while the balance is low or the budget spent, one per
  tick, and not again for that model within the cooldown after a pre-warmed
  machine closed unused (`metadata.pick.prewarm`, no job ever assigned).
- Which card (`offer-picker.ts`, `gpu-specs.ts`): **any card that can run the
  model competes** — VRAM from the catalogue, architecture from the name
  (Ampere+ for H3/Qwen, Turing+ for ACE-Step; unknown names are refused; an
  admin allow-list in `gpu_worker_profiles` still overrides). Ranked by rental
  cost (boot at the host's speed + expected jobs + idle tail + disk) **plus
  customers' waiting** priced at `gpu_wait_value_usd_per_hour` (default $2) —
  without that term the cheapest 24 GB card always wins. Untried cards are
  priced from a paper-speed prior (half of any speed-up believed, VRAM short of
  the weights assumed to swap) and blended with real history by card family.
  A rental that cannot afford boot + one job within today's budget is not made.
- **Each machine's own record** (`host-record.ts`, from `ai_gpu_workers`, 30
  days, no table): keyed by the vendor's physical id (`GpuOffer.machineId`,
  Vast `machine_id` → `vast:m<id>`, stored as `metadata.machineKey`), else the
  offer id (rows from before fall back to `provider:offerId`). It keeps the
  download rate measured during its boots (`bootProgress.bytesAt`), its render
  speed per model (`GpuEta.renderProfile.statsByMachine`), and how often it
  failed to boot on its own account (`isHostFailure`). The picker uses the
  measured rate over the listed one, the machine's render speed over its
  family's, and prices the chance of a failed boot (prior 0.15). A machine at
  ≥ 40 % (`UNRELIABLE_FAILURE_CHANCE`) is ranked after every other — a last
  resort, not banned; one good boot brings it back.
- Memory (`ai_settings`): `gpu_offer_penalties` — hosts that refused an order
  (30 min), had no usable CUDA or never became ready (3 h); a refused order
  tries the next offer in the same tick. `gpu_card_penalties` — a card family
  that failed a model with OOM/no-kernel before ever completing it is kept off
  that model for 24 h, and the failure does not count against the model. A
  family that has completed the model's work is never banned.
- Boot watch (`boot-watch.ts`, `metadata.bootProgress`): a booting machine is
  judged against its own estimate (`metadata.pick.bootSeconds`, else the
  model's median) and its progress, not only the flat warmup limit. Past
  max(15 min, 3 × estimate) with nothing moving for 8 min (15 in the
  `starting` stage) → ended, host avoided 3 h, the scaler rents a replacement.
  A download whose measured rate cannot finish inside the limit is ended at
  once. A boot that keeps moving is never cut early. Network faults during a
  boot (pip ProtocolError, DNS…) are the host's (`isHostFault`): that host is
  avoided, the model is not paused for 10 min. A boot nobody needs any more
  is **cancelled** (`bootStillNeeded`): nothing of its model queued and no
  order in the last 2 min — the machines already up cleared the backlog. Kept:
  admin test rentals, pre-warms, and the model's only machine while a
  customer is on its studio. Not a host failure; never applies to `llm-*`.
- The orphan sweep only terminates instances named `aixman-*`. Never name an
  unrelated SimplePod instance with that prefix.
- Results **must** go to R2 before the worker is reaped — the tunnel URL dies
  with the machine, so `persistAssetSafe` is wrong here (it would return a URL
  that breaks minutes later).
- The container port is publicly reachable and ComfyUI has no auth of its own.
  Each worker gets `AIXMAN_WORKER_TOKEN`; the image is expected to enforce it.

**Setup is one vendor credential plus R2.** Admin → GPU ที่เช่า → a card per
vendor: paste its key (Verda: Client ID + Secret, stored as `id:secret`). That
verifies it, creates the vendor's provider row + encrypted credential, adds it
to `gpu_providers`, writes the budget caps, and activates the models. The
models always live on the **`simplepod` provider row** whichever vendor was set
up — that row marks them as rented-GPU models (`getGpuProvider(slug)` in
generation.ts); the vendor is chosen per machine. R2 (`R2_*` in `.env`) must
also be set: without it the queue refuses to rent and refunds, because a
render dies with the machine. Each card has "ทดสอบการเชื่อมต่อ" (read-only:
balance + free machines per model) and "เช่าเครื่องทดสอบ" (a real rental at
that vendor under every guardrail except the scaling rule, taken under the
tick lock).

**Vendors** (`src/lib/gpu/{simplepod,runpod,vast,verda,gce}.ts`, all behind
`GpuRentalProvider`). `addCapacity` asks every enabled vendor at once
(`gatherMarkets`, 25 s timeout each) — **machine first, never vendor first**:
all free machines are ranked together, then each must be paid for by its own
vendor's credit (`fundedOffers`: planned work × 1.5), then the daily budget.
One vendor's outage, sold-out market or empty wallet only removes its machines.
No key anywhere throws (refund); anything else is a reason for the next tick.

| Vendor | Reached by | Traps |
|---|---|---|
| SimplePod | vendor HTTPS tunnel | start script runs line by line → gzip+base64 one-liner |
| RunPod | `https://{pod}-{port}.proxy.runpod.net` | REST **v2** only (v1 retires 2026-11-15, its field names 422 on v2); balance only via GraphQL (retires early 2027 → `unknown`, RunPod's 402 does the job); 400 = no capacity; `GET` returns env incl. the token — never log pods |
| Vast.ai | **own tunnel** | ports are plain TCP; hosts charge `inet_down_cost` per GB (priced in); `stopped` still bills storage → treated as error and destroyed; `/users/current` returns the API key |
| Verda | **own tunnel** | whole VMs: first-boot script starts our container; scripts are readable via API and hold the token → deleted once running; `offline` bills → error; delete **must name the OS volume** or it keeps billing; ids come back as plain text |
| Google Cloud (gce) | **own tunnel** | Compute Engine VMs, credential = service-account **JSON key** (setup form textarea, JWT signed in-process). **Not Colab** — consumer Colab has no runtime API and its terms forbid serving third parties. No balance API → `unknown`; daily budget is the only cap. **GPU quota** (`GPUS_ALL_REGIONS` + per-region, e.g. `NVIDIA_L4_GPUS`) is the usual blocker: offers only where quota is free, setup warns via `readiness()`. Prices from a static table (us-central1, non-US ×1.25). Every card on demand **and Spot** (H100 a3-highgpu-1g Spot-only); all VMs `instanceTerminationAction: DELETE` + `maxRunDuration` 12 h (Google-side kill switch); stockouts fail the *operation*, so `rent` waits ≤20 s on it; ids are `zone/name`; logs = serial port 1 |

Tunnel mode (`GpuExposure 'tunnel'`): the proxy stays on loopback, the boot
downloads cloudflared, the proxy opens a quick tunnel and POSTs its URL to
`/api/gpu/tunnel/[callbackId]` with the worker token (URL must be
`*.trycloudflare.com`; needs an https `NEXTAUTH_URL`). Reconcile never writes
back an endpoint the vendor did not report — the callback could land mid-tick.
A tunnel-mode worker with no URL after 15 min is terminated.
**Named tunnels** (`src/lib/gpu/cf-tunnel.ts`, `CF_TUNNEL_*` in `.env`) replace
that when configured: the tunnel + proxied CNAME `aixman-gpu-<hex>.<domain>` are
made *before* the rent, the hostname is the endpoint from the start, and the
worker runs `cloudflared tunnel run` with `AIXMAN_TUNNEL_TOKEN` (passed to
cloudflared as `TUNNEL_TOKEN` env, never argv; kept out of vendor templates by
`SECRET_ENV`). Nothing is reported back. "Never came up" = our proxy never once
answered through it in 15 min (`metadata.tunnelUpAt`); a 403 there is our own
zone's WAF, so the host is not penalised. Removed in `markTerminated` (after the
machine, never before) and on a failed rent; `sweepOrphanTunnels` removes
`aixman-gpu-*` tunnels/records no live row claims after 15 min. A Cloudflare API
failure at rent time falls back to a quick tunnel (alert `named-tunnel`).
Nothing else is required because:

- **No custom Docker image.** A stock `pytorch/pytorch` **CUDA 13.0** image is
  booted and `src/lib/gpu/provision.ts` installs ComfyUI, pulls the weights, and
  starts a token-gated proxy. cu130 is required, not a preference: ComfyUI
  disables comfy-kitchen's CUDA kernels below it, and those run the int8_convrot
  / nvfp4 weights in the catalogue. Minimum host CUDA follows (`DEFAULT_MIN_CUDA`).
- **ComfyUI is pinned** (`COMFYUI_REF`). Templates are converted against node
  signatures, which change between releases. Bump it only after submitting all
  catalogue graphs to that version's own `/prompt` validator (a CPU-only
  ComfyUI with zero-byte weight stubs is enough — it fails at model load, which
  is the pass condition).
- **No workflow to paste.** Each catalogue entry vendors an official Comfy-Org
  template; `comfy-convert.ts` flattens subgraphs, drops editor-only nodes
  (MarkdownNote, PrimitiveNode, Reroute, bypassed), expands V3 dynamic combos
  (`format.codec`), then prunes whatever no output depends on. `comfy-validate.ts`
  checks the result against the worker's live `/object_info` and fills required
  inputs the template predates — ComfyUI's server fills nothing.
- **"Ready" means weights on disk.** The worker's health path is the proxy's
  `/aixman/ready`: 503 while downloading, 500 once the boot failed (the worker
  is released at once), 200 only when every file is in place and ComfyUI answers.
  ComfyUI itself is up long before 40 GB of weights land.
- **Weights download 3 at a time** (`FETCH_PARALLEL`, catalogue lists the
  largest first), `hf_xet` high-performance mode only with ≥ 48 GB of container
  memory (cgroup limit, else MemTotal). Completion is judged by the files on
  disk, not exit codes — a download killed for memory writes no failure itself.
- **Render progress is real.** The proxy listens on ComfyUI's websocket (stdlib
  only) and serves `/aixman/progress`; ComfyUI sends a prompt's events only to
  the client id it was submitted under, so the proxy relabels `/prompt` bodies
  with its own. `render-progress.ts` folds sampler steps into one fraction
  (loading 2–8%, sampling 8–85%, finishing 85–98%, saving 99%); a machine booted
  before this existed answers 404 and the customer sees a time-based bar. Any
  change to the proxy's Python must stay unable to break `/prompt` — test it
  against a fake ComfyUI, it is the machine's only entrance.
- **The start script travels gzipped + base64** (`asSingleLine`): SimplePod
  documents no length limit and only ~13 KB is proven.
- **No crontab.** `src/instrumentation.ts` starts an in-process scheduler.

Gotchas that will bite if changed carelessly:
- Frame count must satisfy `length % 17 === 5` (latent temporal compression) —
  `frameLengthFor()` handles it, at H3's native 24 fps. The template computes
  it with `ComfyMathExpression`; binding `length` orphans that node and the
  prune drops it.
- Bindings can be *valid and wrong*: Qwen-Image's template ships its Lightning
  switch off, which ComfyUI happily renders undercooked. Check a new model's
  converted graph by eye, not just by whether `/prompt` accepts it.
- Weights are ~42.5 GB, so warmup is 20–40 min on a fresh host. The client
  poller must outlast `warmupTimeout + jobTimeout` or it tells users a healthy
  job failed and they pay twice.
- 2K output is not offered — it needs 4× H100 (123.6 GB VRAM), which this
  marketplace does not carry. 1344×768 matches the official template.

Adding another vendor: implement `GpuRentalProvider` (declare `exposure` and
`credential`; turn "sold out/unfunded" into `RentRefusedError`, "may have been
created" into `RentUnconfirmedError`; name instances `aixman-…`), add its slug
to `GpuProviderSlug`, register it in `src/lib/gpu/index.ts`, and add a row to
`VENDOR_ROWS` (setup route) and `VENDOR_INFO` (admin page). Test it against a
mocked `fetch` built from the vendor's documented responses before a real key.

`/admin/gpu` is the control room: balance, live burn rate, budget caps,
utilisation, and profit. Profit uses *worker uptime* cost, not per-job cost —
warmup and idle are real spend that no single job carries.

## GPUxMINE community pool (home PCs, provider `gpuxmine`, exposure `pool-relay`)

Home PCs dial out to the relay (`GPUXMINE_RELAY_URL`, prod
`https://relay.xman4289.com:8443`); xmanstudio pushes each node to
`POST /api/gpux/nodes` (contract C1: endpoint `{relay}/w/{id}`, tunnel token,
assessment). Rules that must not regress (`src/lib/gpu/community-dispatch.ts`,
`community-push.ts`, tests in `src/lib/gpu/__tests__/community-*.test.mts`):
- **No rental reaper applies.** `reconcileCommunity` never terminates on
  lifetime, warmup, idle, budget or draining. It probes `/aixman/ready` with the
  row's own token: warming rows every tick, ready rows every 3 min, rows with a
  job never. 200 → ready, 503+stage / silence → warming, relay 401/403 →
  terminated (only a *new* token revives it). Only xmanstudio's DELETE, an admin
  retire, or a refused token end a row. **No relay admin key is needed**; the
  key in Admin → GPU only adds the live "who is connected" list.
- Community rows hold **no rental slot** (`gpu_max_concurrent_workers`) and are
  never released, pre-warmed or counted in vendor balances.
- Catalogue `pools`: a node is matched only to `community` entries
  (`sdxl-community`); the queue never gives a `rented`-only model's job to one.
- Dispatch: machine reserved ready→busy (conditional) before the claim; full
  lane before slow, then the priority band (`gpux-ledger.ts communityPriority`:
  owner's 30-day cooperation, node success rate, lane), then least recently
  given work (`rankCommunityCandidates`); one pass in ten is a lottery that
  shuffles each lane. A node's "not now"
  (503 with a stage, 409 busy — C5) requeues **without spending an attempt**;
  any other failure sends the retry elsewhere (`ai_gpu_jobs.avoid_worker_ids`).
  The relay's own pushback (503 `{error:'relay-busy'}`, any 429 — stage
  `relay-busy`) never reached the node: requeued without an attempt, the node
  goes straight back to `ready`, not on the avoid list — parked `warming` only
  after `RELAY_PUSHBACK_PARK_AFTER` (3) in a row without a submit getting
  through.
- A push never downgrades `ready`/`busy` while the node is eligible and online,
  never changes a busy node's model, sets `rentedAt=now` on revival, and never
  revives `metadata.adminRetired` (admin → เครื่องชุมชน → ปลดเครื่อง / คืนสถานะ).
- `GET /api/admin/gpu/community/health` is the go-live check (webhook secret,
  R2, relay reachable, sdxl-community readiness, per-node lastError).
- **Content gate (D4, `src/lib/safety/content-tier.ts`).** Every order's words
  (prompt, negative, style suffix, lyrics) are classified before charging:
  `general | adult | blocked | unknown`, stored on `ai_generations` and
  `ai_gpu_jobs.content_tier` (+ `has_input_media`). `blocked` (terms §6: minors,
  real people, sexual violence, …) is refused for *every* model with a Thai
  `OrderRefusedError` (422). A community row is only ever handed
  `general` + no upload — the claim filters on the columns and re-checks the
  payload. Lexicon, deliberately one-sided: a false "adult" only keeps a job
  off home PCs. Sexual words in the *negative* prompt never make an order adult;
  clothes in it do — the generic words *and every garment by name* (shirt,
  pants, dress, bikini, towel, เสื้อ, กางเกง …), since SDXL follows it.
- **Community-only models (D5, `pools: ['community']`).** Never rented
  (`addCapacity`, pre-warm, test rental all refuse). The order is refused
  before charging when it is not community-safe or no community row for the
  model is ready/busy/warming (and not held — a warming PC that XMAN Studio or
  the relay says is offline, and that served nothing within the grace, does
  not count); a queued job no node takes is refunded after
  `GPUXMINE_COMMUNITY_QUEUE_GRACE_MIN` (default 5), counted from when its pool
  last had a ready/busy machine (`communityLastServingAt`), not from the order.
- **A modified node cannot hurt the server.** Every read of a community node's
  answer is capped in size and time (`worker-client.ts readCapped`,
  `COMMUNITY_BODY_LIMITS`); its files are fetched one at a time, at most
  `MAX_COMMUNITY_OUTPUTS`, within `MAX_COMMUNITY_OUTPUT_BYTES` per job (checked
  on Content-Length and on every chunk). From an image model, a flat, tiny or
  sub-1 KB picture is *rejected* (job moves to another node), not delivered.
- **Retired stays retired.** Worker status writes after an `await` are guarded
  (`updateMany … status: 'busy', terminatedAt: null`) and every "ready"/"serving"
  query filters `terminatedAt: null`, so a retire or suspend landing during a
  submit or a download is never undone. The relay's 403 `worker-disabled` is a
  reversible "not now" (warming / NodeRefusedError), never a dead token; only a
  401 records `metadata.rejectedTokenHash`, and a 200 probe or an admin restore
  clears it.
- **Purge (C5).** After the R2 copy and the delivery transaction, aixman calls
  `POST /aixman/purge {prompt_id}` then `POST /history {delete:[id]}` on the
  node (purge first — the node finds the files through its history). Never
  awaited by delivery; `ai_gpu_jobs.node_purged_at` records the confirmation,
  and the tick retries unconfirmed jobs (last 24 h, nodes ready/busy, 10 a tick).

- **Earnings (C2, `src/lib/services/gpux-ledger.ts`).** A delivered community
  job writes one `gpu_job_earnings` row (xmanstudio's table, mirrored in Prisma
  as `GpuJobEarning`, never migrated from here) *after* the delivery
  transaction, never inside it: `INSERT … ON DUPLICATE KEY UPDATE id = id` on
  `job_id = 'aix-gpu-job-' + ai_gpu_jobs.id` (the node's `prompt_id` has its
  own column). Never throws into delivery; failures alert (`gpux-earning`) and
  the tick's sweep retries completed community jobs of the last
  `GPUXMINE_EARNINGS_SWEEP_DAYS` (default 30) with no row — only jobs a row can
  be written for (owner known, generation exists; decided in SQL, not process
  memory), and not at all while no credit package prices a credit. Jobs 24 h
  from leaving the window unwritten raise `gpux-earning-expiring` (critical).
  **Deploy order:** aixman first, then xmanstudio (code + its
  `2026_09_25_100000…300000` migrations) in the same window — never
  xmanstudio first: its first sync pushes every node, and the aixman on
  `main` flips busy rows to warming. Until xmanstudio migrates, earning writes
  fail with `gpux-earning` and the sweep backfills them (see
  `db/migrations/README.md`).
  A claim while the ledger cannot be read is stamped paid (100% share: free),
  never decided from empty sums. The money is `gpux-settlement.ts settleJob` on what the customer was
  actually charged (`creditsUsed − creditsRefunded`) at `pricingBasis()`
  stored `toFixed(6)`; integer satang, half-up, no float. Owner = `gpu_nodes`
  by `worker_id` (soft-deleted too) → the job's claim-time `owner_user_id` →
  metadata; no owner = alert, no row. Referral (D8) only from
  `gpu_nodes.referrer_user_id` with an **active** `affiliates` row, never self,
  12 months from the owner's first `paired_at`. Free share (D6) and Pro are
  stamped on `ai_gpu_jobs` at claim in the same conditional update
  (`shouldFreeShare` over the node's 30-day sums vs `freeSharePct`); a
  free-share job pays 0 and records the pool as `donated_value_satang`.
  Rows start `pending` (xmanstudio clears/pays after the hold) or `review`.
- **Results check (`src/lib/gpu/community-plausibility.ts`).** A home PC's file
  is stored as its *sniffed* type, never the node's Content-Type. Not the
  model's media (empty, HTML, archive, undecodable, wrong kind) → not delivered,
  job retried elsewhere, node unpaid, `gpux-output-rejected` alert. Delivered
  but odd (tiny, one flat colour, faster than its lane allows) →
  `ai_gpu_jobs.review_reason` → earning written as `review`.

`npm test` runs every `__tests__/*.test.mts` under plain Node 22.7+
(`--experimental-transform-types` + `scripts/alias-loader.mjs`, which also
resolves extensionless imports and unattributed JSON). CI runs it after the
build (on Node 22), so a failing suite blocks the auto-deploy.

## Workflow control room (`/admin/workflows`) — graphs editable without a deploy

**One builder.** `workflow-build.ts#buildJobGraph` turns entry + order into the
graph ComfyUI gets. Workers call it with their live `/object_info`; the admin
dry run calls it with the stored schema (a live worker's `wf_schema_<model>`,
captured on submit, laid over the vendored `workflows/schema/baseline-v0.36.0.json`).
Never build a graph any other way — the dry run would stop telling the truth.

- **Tunables** (`tunables.ts`): each catalogue entry declares its knobs; its own
  `bind`/`inject` reads them via `tunableReader`, and every default is what
  shipped before (a test pins this). Stored values are always coerced — out of
  range falls back to the default, never reaches ComfyUI.
- **Overrides live in `ai_settings`** (group `workflows`: `wf_override_<model>`,
  `wf_history_<model>` = 20 versions), not a table: a skipped migration must not
  stop renders. Rollback saves a *new* version.
- **Rollout is the safety catch.** A saved override starts `admin`: only orders
  an admin placed (`payload.adminRun`, set server-side from `isAdmin`) render
  with it; `all` is a separate step. Three failures in a row demote a model.
- Save = sanitize + dry-run validate; refused with 422 unless forced. Admin node
  inputs bind *after* the catalogue's and only warn when they miss (catalogue
  bindings still throw). A custom API graph that fails validation on a real
  worker falls back to the catalogue graph and raises `workflow-fallback`.
- Every submit stores the exact graph sent (`wf_last_graph_<model>`, has the
  customer's prompt — admin-only).
- **Quality modes** (`qualityModes`, e.g. Qwen เร็ว/คุณภาพสูง): price is
  `ceil(base × multiplier)` in both GenerationService and the studio. A mode
  flagged `adminOnly` is invisible *and* unorderable for customers
  (`pickQualityMode`) until an admin makes it public on the page.
- Model facts the catalogue now applies (sources in the code): Qwen-Image renders
  at its native canvas per shape + the README's positive-magic suffix; its
  quality mode is the template's own non-Lightning branch (20 steps, cfg 4).
  H3 gets the keyframe instruction line MiniMax's prompting guide requires for
  first/last-frame orders, rebuilt from the frames the order actually has.
- When `COMFYUI_REF` moves: `npx tsx scripts/validate-graphs.ts` (every quality
  mode, every tunable moved, every frame mode) and regenerate the baseline with
  `scripts/dump-baseline-schema.ts`. Offline: `npx tsx --test src/lib/gpu/__tests__/workflows.test.mts`.

## LTX-2.5 — video with native audio, `ltx-2.5`

Text or a first frame → a clip with its own sound (Lightricks, 22B distilled,
int8; ~39.7 GB of weights, 32 GB VRAM). Rented GPU only, ComfyUI v0.36.0 core
nodes — no pack. Replaced the LTX-2.3 talking portrait (`ltx-2.3-talking`),
which is gone: its key is in `RETIRED_CATALOG_KEYS`, GenerationService refuses
it (a key with no entry would rent an H3 machine), and "ซิงก์โมเดล" turns its
row off. A voice + clip dub is still `latentsync-1.6` / the fal rows.
- **Template:** Comfy-Org `video_ltx2_5_i2v` (subgraph 398). Without a first
  frame both `LTXVImgToVideoInplace` nodes are bound out of the latent path
  (the template's own t2v switch only bypasses them and still loads an image);
  the prompt goes straight to `398_364`, so the template's Gemma prompt
  enhancer and its second text encoder are pruned and never downloaded.
- **Gated weights.** `Lightricks/LTX-2.5` requires accepting its licence on
  Hugging Face; the account behind the HF token must have done so, or every
  boot fails at the first download (HF 401). The token is pasted on Admin →
  GPU (`hf-token.ts`, encrypted `ai_settings.gpu_hf_token`, `GPU_HF_TOKEN` env
  as fallback); "ทดสอบโทเค็น" lists catalogue repos it still cannot read. Community licence: free under $10M ARR.
- **Shape** `ltxFrame`: 9:16, 3:4, 1:1, 4:3, 16:9 on a 64 px grid (the first
  pass runs at half size on LTX's 32 px latent grid). Length is whole seconds,
  so seconds × 24 + 1 is always LTX's 8k+1 frames.
- Price and `baselineSecondsPerUnit` are estimates until real rentals report.
  After deploy: Admin → GPU → "ซิงก์โมเดล"; it starts `tuning` until an
  admin's order renders.
- **First + last frame** uses Comfy-Org `video_ltx2_5_flf2v` (subgraph 251,
  one pass, guides at frame 0 and −1) on the same weights and machines:
  `CatalogEntry.templateFor` picks the template per order, `extraTemplates`
  lists it for the schema baseline. Admin workflow pages show the i2v one.
- `comfy-validate` understands V3 autogrow inputs (`values.a` …).

## Video lip-sync (พากย์ทับคลิป) — a clip re-dubbed with an uploaded voice

Three routes, all on the studio's lip-sync tab (subcategory `lipsync`; a
portrait model is `lipsync-portrait`):
- **API rows** (`fal-ai/kling-video/lipsync/audio-to-video`, `fal-ai/latentsync`;
  need a fal key in the pool). Their limits and billing live in
  `src/lib/lipsync-rules.ts`: Kling takes a 2–10 s, 720–1920 px MP4/MOV and a
  voice no longer than the clip, and bills `creditsPerUnit` per started 5 s of
  *clip*. GenerationService checks the stored clip (`video-probe.ts`,
  header-only, range reads) and voice before charging — Kling refuses after
  charging us. These orders run after the response (`after()`, the studio polls
  for up to 35 min); `api-order-sweep.ts` fails and refunds any non-GPU order
  still unfinished after 60 min, and every final status write is conditional
  on `processing`, so the two cannot both settle one order.
- **Self-hosted `latentsync-1.6`** (rented GPU, ≥24 GB, Ampere+). vinavfx's
  fork of the wrapper, pinned, with `requirements: false` (its list pins
  insightface). The setup script writes two files on the worker: a
  `face_detector.py` built on face-alignment (BSD-3) over the pack's
  InsightFace one (buffalo_l is non-commercial), and the `AixmanLoadVideo25`
  node (ffmpeg at 25 fps, only as many seconds as the voice, long side capped —
  core LoadVideo would hand over every frame as float32). Priced and rendered
  by the voice's length (≤ 20 s); a clip shorter than the voice is played back
  and forth. A clip with a frame without a face fails with "Face not detected":
  `input-fault.ts` makes that a refund with a Thai reason, not a retry on
  another machine.

## LLM API (`/api/v1`) — language models resold by the token

OpenAI-compatible `POST /api/v1/chat/completions` (streamed or not) and
`GET /api/v1/models`, authenticated by customer keys (`axm-…`, made on
`/developer`, stored as SHA-256 in `ai_api_keys`). Code: `src/lib/llm/`.
- **A model is an `ai_models` row with category `text`**; its prices and
  upstream id live in `defaultParams` (`LlmModelConfig`, read only through
  `parseLlmConfig`). Such rows are kept out of the studio (`/api/models`) and
  refused by GenerationService. Admin → API โมเดลภาษา (`/admin/llm`) edits
  them; "เพิ่ม DeepSeek" creates the `deepseek` provider + V4.1 Flash / V4 Pro
  at twice cost. The provider key goes in Account Pools with daily quota 0 —
  the pool's request quota (default 1,000/day) would otherwise stop the API.
- **Money:** credits are whole numbers, so everything is millicredits. Before a
  request runs, its worst case (prompt bytes as a token ceiling + its whole
  `max_tokens`) is held from the balance with the conditional update; after,
  `settleRequest` charges the real cost through the key's
  `carry_millicredits`, returns the rest, writes one `api-usage` credit
  transaction per whole credit charged and one `ai_api_usage` row. Every path
  that held credits settles exactly once (stream end, error, client hang-up,
  5-min stream idle). Never bill from anything but the upstream's `usage`
  except an interrupted stream (`tokensFromChars`).
- Only whitelisted fields reach the upstream (`FORWARDED`), `n` must be 1,
  streams always ask for `include_usage`, and the response's `model` is our id.
- Per-key rate limit `ai_settings.llm_api_rate_per_minute` (default 60), in
  process like `rate-limit.ts`.
- **Customer caps per key** (`key-limits.ts`, `ai_api_keys.daily_limit_credits`
  / `monthly_limit_credits`, Bangkok day/month, NULL = none): checked before
  the hold against settled spend + the key's running holds (`keyHolds`, in
  process) + this request's worst case → 402 `key_limit_reached`.
- **Cache hits and off-peak** (`LlmModelConfig`): cached prompt tokens
  (`prompt_cache_hit_tokens` or `prompt_tokens_details.cached_tokens`) are
  priced at `cachedInput*PerMTok` (null = full input price); a UTC
  `offPeakStart/EndUtc` window multiplies cost by `offPeakCostFactor` and price
  by `offPeakPriceFactor` (1 = keep the saving), priced at request start. A
  hold never assumes either discount.
- **Alerts:** `llm-upstream` (5 failures in a row per provider or GPU model),
  `no-accounts` (key `llm:<slug>`), `llm-budget` (80%/100% of the API GPU budget).
- **Backend is picked before credits are held** (`openTarget`): an upstream
  account from the pool, or one of our machines (`gpu-target.ts`, least
  in-flight). No machine ready → 503 `model_warming` + Retry-After, nothing
  held, demand noted.

- **Anthropic format** (`/api/v1/messages`, `/messages/count_tokens`,
  `anthropic.ts`): for Claude Code (`ANTHROPIC_BASE_URL=…/api`, our key as
  `ANTHROPIC_AUTH_TOKEN`). The body is translated to OpenAI chat and run
  through `chatCompletion` — same holds, caps, billing — then translated back,
  streamed or not. Tool use carries both ways (tool_result → `tool` messages
  right after the call); thinking blocks are dropped; server tools with no
  schema are dropped.

### MCP server (`/api/mcp`, `src/lib/mcp/server.ts`)
Stateless JSON-RPC over Streamable HTTP (POST only; GET 405), authenticated by
the same `axm-…` key. Tools: list_models, get_credits, generate_image /
generate_video / generate_music (→ `GenerationService.generate`, the studio's
path: content gate, readiness, price, refunds), get_generation (waits ≤45 s),
list_generations, upload_image (base64 → R2), chat (→ the gateway). A frame
URL must be ours (`keyFromPublicUrl`) — never fetch a stranger's URL. Tool
failures are `isError` results, not protocol errors. 60 tool calls/min per
key. Connection snippets (Claude Code, Cursor, Claude Desktop via mcp-remote)
are on `/developer`.

### Self-hosted language models (vLLM on rented GPUs, `llm-*` worker keys)
`src/lib/gpu/llm-catalog.ts` (Qwen3.8-27B FP8, Devstral Small 2, Qwen3-Coder-
Next FP8), `llm-policy.ts`, `provision-llm.ts`, `services/llm-fleet.ts`,
admin section on `/admin/llm` (`/api/admin/llm/gpu`).
- **A worker whose `modelKey` starts with `llm-` is an API machine.** It holds
  no render slot (`NOT_LLM` on every slot count and on
  `releaseIdleWorkerForOtherModel`), spends its own budget
  (`todaySpendUsd('llm')` vs `llm_gpu_config.dailyBudgetUsd`; the render budget
  and its alerts use `'media'`), and skips `gpu_max_worker_lifetime_minutes`
  — its budget is its kill switch. Never let a render path count or reap one.
- **Uptime policy** (`llm_gpu_policies`, per model): `off` | `on-demand` |
  `schedule` (Asia/Bangkok, a window past midnight belongs to the day it
  opened) | `always`. Every mode but `off` answers demand: a request with no
  ready machine writes `llm_gpu_demand`, `LlmFleet.tick` (end of the GPU tick)
  rents; a request that finds every machine at `BUSY_INFLIGHT` asks for one
  more, up to `maxMachines`. The baseline (oldest machines) is never idle-
  reaped; others close after `idleMinutes` (`reapLlmIfDone`). The gateway
  stamps `lastJobAt`. Only models with an active `text` row (`backend: 'gpu'`,
  `upstreamModel` = the key, on the `simplepod` provider row) are rented for.
- **Boot:** same stock image, port 8189 proxy and `/aixman/ready` contract as
  ComfyUI. vLLM (`VLLM_VERSION`, 0.31.0) goes in its own venv via
  `uv pip install --torch-backend=cu129` (its wheels are CUDA 12.9 and pin
  their torch); weights by `snapshot_download`; vLLM on 127.0.0.1:8188.
  The vLLM image is not used: its entrypoint is `vllm serve` and every
  vendor runs our script as the container command.
- **The proxy is shared** (`proxySource`): `AIXMAN_UPSTREAM`,
  `AIXMAN_HEALTH_PATH`, `AIXMAN_PROXY_MODE=llm` (no ComfyUI websocket),
  `AIXMAN_UPSTREAM_TIMEOUT`; `text/event-stream` is relayed with `read1` and
  flushed per chunk. ComfyUI defaults are unchanged — test any change against
  a fake ComfyUI *and* a fake SSE server.
- Untested on a real GPU as of 2026-10-26: VRAM fit at 131k context, boot
  time, throughput, and the `uv` resolve of vLLM 0.31.0 on the cu130 image.

## Movie & MV mode (`/movie`, phase 1)

A project (`ai_story_projects`) is a story or a song cut into shots
(`ai_story_shots`), each rendered as an ordinary studio order through
`GenerationService.generate` (content gate, readiness, price, refunds) on the
model the customer picks per shot — `MOVIE_MODEL_KEYS` (`ltx-2.5`, `minimax-h3`).
Code: `src/lib/story/{cinematic,service,http}.ts`, `/api/story/*`.
- **Same face every shot:** the shot's opening picture (below) when it has one
  and the customer keeps it (`keyframe_use`), else its first character's
  uploaded picture, is the first frame. A character-led wide/full shot never pushes in (`safeCamera`) —
  that is where faces were replaced. Pictures must be the user's own uploads
  (`uploads/<userId>/image/…`, `isOwnUpload`).
- **Reference library** (`library.ts` pure + tests, migration
  `20261028_story_structure.sql`): `ai_story_characters` rows with `kind`
  character (≤ 8) | prop (≤ 12, weapons, vehicles) | location (≤ 12), each with
  up to 4 pictures (`reference_url` = main, `images` = other angles) — the
  customer's own uploads, or an AI picture ordered from its description
  (`/api/story/[id]/assets` `picture`, a studio order, 60/h per customer).
  Shots name `characterIds`, `propIds`, `locationId` (null = its scene's).
- **Acts → scenes → shots** (`ai_story_acts`, `ai_story_scenes`, shot
  `scene_id`). A film's plan is a structure call first (acts, scenes, places,
  times, and new places/props it needs — created in the save transaction,
  origin `planned`; negative ids until then), then scene groups of about
  `FILM_PART_SECONDS` (60) planned at once (`structure.ts`). Structure fails →
  the old outline/parts planner (`planLongFilm`) → one call → the rules. An
  MV's scenes are its song's sections. Every plan runs after the response
  (`plan-jobs.ts`, in process, 202 + `planning`) — Apache in front would cut a
  minutes-long request. `{sceneIds}` on `/plan` re-plans only those scenes
  (an act = its scenes): their shots are replaced in place (`spliceScene`),
  the rest of the film is untouched. Acts and scenes are edited by hand on
  `/structure`; `+ ช็อตในฉาก` inserts after the scene's last shot.
- **Opening picture (keyframe)** (`keyframes.ts`, `/api/story/[id]/keyframes`):
  an image model that takes several references composes the shot's
  characters, props and place (`pickReferences`: every item's main picture,
  characters first, then extra angles up to the model's cap) into the clip's
  first frame; `keyframePrompt` says which image is which. A studio order with
  `referenceImages` (`deferApi`: runs after the response, ApiOrderSweep
  settles). The project picks the model (`script_json.pictures`); every image
  model is listed with what it takes. Without a model that takes references
  the clip starts from the lead's photo as before. A shot whose picture is
  rendering cannot be rendered, re-planned or deleted (`isBusyShot`;
  `keyframe_status` is nullable — a Prisma `not` alone skips NULL rows).
- **How many references a model takes** (`src/lib/reference-caps.ts`,
  `/api/models` `references`, shown on every picker): what *our adapter*
  forwards, not what the vendor advertises — Seedream 4+ 10 (≤ 14 by
  `defaultParams.maxReferenceImages`), gpt-image 16, SeedEdit/DALL·E 2/Kontext/
  img2img 1, everything else 0; a video model says first / first+last frame.
  `GenerationService.checkReferences` refuses more than the cap and any URL
  that is not ours (`keyFromPublicUrl`).
- **Retention never deletes a story's pictures** (`retention.ts`): keys under
  `story/` and every key a library picture or keyframe points to are skipped,
  even when an old generation's params name them. Shot clips (`generations/…`)
  still expire with their generation.
- **Film length** (`FILM_LENGTHS`: auto, 1/3/5/10 min, `script_json.targetSeconds`;
  60 shots, cut ≤ `LIMITS.maxFilmSeconds` 600).
- **MV timing is ours, not the LLM's:** `songTimeline` lays the lyrics over the
  song's length (read server-side from the file, ≤ 6 min); the planner model
  only writes pictures. Any planner failure falls back to `planFromRules`.
- Every LTX prompt forbids subtitles, yet LTX still burns fake ones in; the
  phase-2 assembly (one file, blurred band + real Thai subs, music) must cover them.
- A shot is claimed with a conditional update (→ `rendering`, unlinked from
  its old order) before ordering; replanning, editing and deleting refuse
  rendering shots (and shots whose opening picture is rendering). A claim with no order after 10 min is released as failed.
- **Phase 2 — one film** (`edit.ts` pure + tests, `assemble.ts`,
  `/api/story/[id]/{assemble,music}`). Every part is the customer's switch,
  stored in `script_json.edit` (no column): clip sound, music (MV: its song;
  film: an ACE-Step instrumental ordered and charged like any music order,
  `script_json.music`), ducking, Thai subs (ASS, bundled `assets/fonts/Sarabun-Bold.ttf`,
  OFL), blur over LTX's fake-sub band (only LTX shots; done on the *source*
  frame before the fit), fades, title card. The customer picks separate shot
  files (free) or the joined film, charged per started minute (`assemblePrice`,
  ai_settings `story_assemble_credits_per_minute` 4 / `story_assemble_min_credits` 3);
  the charge rides the claim transaction, the refund the one that ends a
  failed cut. Assembly runs on the web
  server with the host's own ffmpeg (`~/bin/ffmpeg`, 7.0.2 static, not on PATH; `FFMPEG_PATH` overrides), niced, one film at a
  time in process (PM2 single instance), `status = 'assembling'` claimed
  conditionally; a claim older than 30 min may be retaken. Shot/plan writes
  never overwrite `assembling`. Customer text in ASS is escaped (`assEscape`:
  braces, backslashes, control chars).
- **MV lip-sync** (`sing.ts` pure + tests, `vocals.ts`, `media.ts`,
  `/api/story/[id]/{vocals,lipsync}`, migration `20261027b_story_lipsync.sql`).
  The lead vocal is separated once per project on **our server's CPU** —
  Demucs htdemucs (MIT) in `~/venvs/demucs` (torch 2.5.1+cpu, torchaudio
  2.5.1, demucs 4.0.1, soundfile; `DEMUCS_PYTHON` / `DEMUCS_THREADS` override;
  weights in `~/.cache/torch/hub`). Free; ~2.5 min and ~1.9 GB for a 4-min
  song on 8 threads, `nice 15`, run with `python -I` from the temp dir. Or the
  customer uploads a vocal stem (±2 s of the song). Separation and the cut
  share one in-process queue (`enqueueJob`). Each dub: the shot's own window
  of the song (`startSec`, ≤ 20 s) sliced by ffmpeg, refused uncharged when
  silent (mean < −45 dB), then an ordinary `latentsync-1.6` order (video = the
  shot's clip, audio = the slice), placed in `after()` once the shots are
  claimed. `lipsync_source_url` pins the clip the dub came from: a re-render
  makes it stale and the cut falls back to the clip. The cut uses a dub only
  when `edit.lipsync` and the shot's own `lipsync_use` are on.

## Developer guide (`/docs`)
Public, static (`src/app/(main)/docs/page.tsx`, interactive bits in `parts.tsx`):
keys, `/api/v1` (OpenAI + Anthropic formats), MCP tools, client setup (Claude
Code, Cursor, Claude Desktop via mcp-remote with the key in `env`, BrainX,
CluadeX), billing, limits, error codes. `/docs/mcp` is a 307 to `/docs#mcp` —
BrainX (Settings ▸ XDREAMER, MCP ≥ 2.10) and CluadeX (Setup ▸ Connections ▸
XDREAMER, ≥ 3.0.189) link there. It restates facts from `src/lib/llm/*`,
`src/lib/mcp/server.ts` and `src/app/api/mcp/route.ts` (forwarded fields,
aspect ratios, rate limits, error codes): change those, change the page.

## Prompt assistant (✨ in the studio)

`/api/studio/enhance-prompt` → `services/prompt-enhancer.ts`. Order: MiniMax's
own **H3-Context-IR API** for self-hosted H3 when a MiniMax key is in the pool
(H3-Base was trained on its output format and has no substitute) → a chat model
from the account pool (`auto`: DeepSeek → OpenAI → MiniMax → BytePlus; Pollinations only
when chosen — it is a third party) → model-aware rules, so it never fails. Free
to customers, limited per hour (`prompt_enhancer_hourly_limit`); settings and a
test button live on the same admin page. Thinking models get
`reasoning_effort: low` — Pollinations' free tier caps output at 1,500 tokens
and spent all of it reasoning over the H3 brief (empty answer) without it.

**Studio orders overlap** (tray above the canvas, `MAX_PARALLEL_JOBS` = 3). The
old page-wide lock was what stopped double orders; now a 1.5 s guard does —
keep it. A history item opens on the canvas *and* puts its order back on its
own tab (`openHistory`; lip-sync from the model's `subcategory`, since the
server calls it 'video'): prompt and settings from the gallery API's
whitelisted `remix` fields, uploads from `GET /api/gallery/[id]/inputs`
(owner only; `order-inputs.ts` returns only what `/api/generate` accepts back).
The order button waits while those load; "↶ กลับไปร่างเดิม" restores the draft
from before the first open.

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
