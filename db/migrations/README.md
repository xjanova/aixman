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
