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
