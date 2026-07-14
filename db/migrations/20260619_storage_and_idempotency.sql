-- Migration: durable-storage columns + webhook idempotency guard
-- Date: 2026-06-19
-- Reason:
--   1. ai_generations.result_url/thumbnail_url were VARCHAR(1000). Providers that
--      return base64 (Stability always; OpenAI when b64_json) overflowed the column
--      so those generations failed on write every time. input_image (base64 from the
--      UI) was VARCHAR(500) and silently truncated. Widen all three to MEDIUMTEXT.
--      (When R2 storage is configured we store short URLs; MEDIUMTEXT is the safe
--       fallback so a base64 result never breaks the write.)
--   2. ai_credit_transactions.xman_order_id had no UNIQUE constraint, so the credit
--      webhook's app-level idempotency check had a TOCTOU race — two concurrent
--      retries of the same order could double-credit. Add a UNIQUE index (MySQL
--      permits multiple NULLs, so non-purchase rows are unaffected).
--
-- Shared tables (wallets, wallet_transactions) are NOT touched — AIXMAN writes
-- 'payment' rows into the existing Laravel-managed wallet_transactions table.
--
-- Apply on prod:  mysql -u <user> -p <db> < 20260619_storage_and_idempotency.sql

-- 1. Widen generation media columns (idempotent — re-running MODIFY is a no-op)
ALTER TABLE ai_generations
  MODIFY result_url   MEDIUMTEXT NULL,
  MODIFY thumbnail_url MEDIUMTEXT NULL,
  MODIFY input_image  MEDIUMTEXT NULL;

-- 2. Add UNIQUE index on xman_order_id only if it doesn't already exist.
--    NOTE: if duplicate non-null xman_order_id rows already exist, de-duplicate
--    them first or this ALTER will fail.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name   = 'ai_credit_transactions'
    AND index_name   = 'ai_credit_transactions_xman_order_id_key'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE ai_credit_transactions ADD UNIQUE INDEX ai_credit_transactions_xman_order_id_key (xman_order_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
