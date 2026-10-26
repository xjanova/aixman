-- Migration: per-key spending caps, and cached prompt tokens on API usage
-- Date: 2026-10-26
-- Reason: Agent tools can call a model thousands of times overnight; a customer
--         sets a daily/monthly cap per key so a loop cannot empty the balance
--         (src/lib/llm/key-limits.ts). NULL = no cap. DeepSeek bills prompt
--         tokens served from its cache at a fraction; ai_api_usage records
--         how many there were, so the usage page and the margin can show it.
-- Additive only, idempotent. Apply BEFORE the code that reads the columns
-- starts (Prisma selects every mapped column; the deploy applies
-- db/migrations/*.sql before `npm run build`).
-- Apply on prod:  mysql -u <user> -p <db> < 20261026b_api_key_limits.sql

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_api_keys'
             AND column_name = 'daily_limit_credits');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_api_keys ADD COLUMN daily_limit_credits INT NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_api_keys'
             AND column_name = 'monthly_limit_credits');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_api_keys ADD COLUMN monthly_limit_credits INT NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_api_usage'
             AND column_name = 'cached_tokens');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_api_usage ADD COLUMN cached_tokens INT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
