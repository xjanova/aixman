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

## Self-Hosted GPU (SimplePod · RunPod · Vast.ai · Verda → MiniMax H3)

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
- Budget caps live in `ai_settings` group `gpu` and are read fresh every tick:
  `gpu_daily_budget_usd`, `gpu_max_concurrent_workers`, `gpu_idle_timeout_minutes`,
  `gpu_max_worker_lifetime_minutes` (absolute kill switch).
- Scaling (`GpuQueue.dispatchQueued` → `GpuWorkerManager.addCapacity`): models
  are served oldest-job-first; every idle booted machine of a model takes a
  job; another machine is rented only when the backlog per machine exceeds
  `1 + boot/render` (`gpu-scaler.ts`, boot from that model's own history —
  H3 ≈ 3 waiting, Qwen ≈ 6). Models run side by side up to the cap; at the cap
  a model with no machine, or whose backlog has outgrown its machines, may
  take an *idle* other-model machine's slot (one with nothing queued for it),
  but not one just used or open in a customer's studio for the first 90 s
  (anti ping-pong). Extra machines close on the plain idle timeout; only the
  warmest idle machine per model gets the studio-presence grace.
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
- Memory (`ai_settings`): `gpu_offer_penalties` — hosts that refused an order
  (30 min), had no usable CUDA or never became ready (3 h); a refused order
  tries the next offer in the same tick. `gpu_card_penalties` — a card family
  that failed a model with OOM/no-kernel before ever completing it is kept off
  that model for 24 h, and the failure does not count against the model. A
  family that has completed the model's work is never banned.
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

**Vendors** (`src/lib/gpu/{simplepod,runpod,vast,verda}.ts`, all behind
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

Tunnel mode (`GpuExposure 'tunnel'`): the proxy stays on loopback, the boot
downloads cloudflared, the proxy opens a quick tunnel and POSTs its URL to
`/api/gpu/tunnel/[callbackId]` with the worker token (URL must be
`*.trycloudflare.com`; needs an https `NEXTAUTH_URL`). Reconcile never writes
back an endpoint the vendor did not report — the callback could land mid-tick.
A tunnel-mode worker with no URL after 15 min is terminated.
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

## Prompt assistant (✨ in the studio)

`/api/studio/enhance-prompt` → `services/prompt-enhancer.ts`. Order: MiniMax's
own **H3-Context-IR API** for self-hosted H3 when a MiniMax key is in the pool
(H3-Base was trained on its output format and has no substitute) → a chat model
from the account pool (`auto`: OpenAI → MiniMax → BytePlus; Pollinations only
when chosen — it is a third party) → model-aware rules, so it never fails. Free
to customers, limited per hour (`prompt_enhancer_hourly_limit`); settings and a
test button live on the same admin page. Thinking models get
`reasoning_effort: low` — Pollinations' free tier caps output at 1,500 tokens
and spent all of it reasoning over the H3 brief (empty answer) without it.

**Studio orders overlap** (tray above the canvas, `MAX_PARALLEL_JOBS` = 3). The
old page-wide lock was what stopped double orders; now a 1.5 s guard does —
keep it. A history item opens on the canvas; "ใช้การตั้งค่านี้" restores the
order from the gallery API's whitelisted `remix` fields (never upload URLs).

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
