# Manual DB Migrations

This folder tracks SQL applied manually to production when `prisma db push`
would be unsafe (e.g. would drop legacy tables that still hold data).

## How

1. Write SQL idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER ... ADD COLUMN IF NOT EXISTS`).
2. Apply on prod via `mysql -u <user> -p <db> < <file>.sql`.
3. Commit the file so dev/staging can replay.

## Files

- `20260524_add_ai_referrals.sql` — add `ai_referrals` + `ai_referral_commissions`
  tables that were in `schema.prisma` but never created on prod.
- `20260619_storage_and_idempotency.sql` — widen generation media columns to
  MEDIUMTEXT; UNIQUE index on `xman_order_id` to close a webhook double-credit race.
- `20260809_add_gpu_rental_tables.sql` — add `ai_gpu_workers` + `ai_gpu_jobs`
  for GPU rental (SimplePod → self-hosted MiniMax H3).
- `20260925_gpu_community_dispatch.sql` — `ai_gpu_jobs.avoid_worker_ids` (JSON):
  community machines a job already failed on, so its retry goes elsewhere.
- `20260925b_content_tier.sql` — `content_tier` on `ai_generations` and
  `ai_gpu_jobs` (general | adult | blocked | unknown, default `unknown`),
  `ai_gpu_jobs.has_input_media` and `ai_gpu_jobs.node_purged_at`, plus an index
  on `ai_gpu_jobs (status, completed_at)`. Community machines only ever get
  `general` jobs with nothing uploaded; a delivered community job is purged
  from the node. Apply before the code that reads the columns starts.
