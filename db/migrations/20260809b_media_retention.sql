-- Migration: media retention + explicit refund amount on ai_generations
-- Date: 2026-08-09
-- Reason:
--   1. Rendered media is kept on R2 indefinitely, which grows without bound and
--      leaves users with no idea how long their files will be there. Record an
--      expiry per generation so the UI can tell them plainly and prompt a
--      download, and so a sweep can reclaim the storage.
--   2. Failed generations are auto-refunded, but the only trace in the UI was a
--      Thai suffix inside the error string. Store the refunded amount so the
--      gallery can state it without re-deriving it from ai_credit_transactions.
--
-- Backfill: existing rows get expires_at = created_at + the configured
-- retention window. Done in SQL so nothing is left NULL and treated as
-- "never expires" by accident.
--
-- Apply on prod:  mysql -u <user> -p <db> < 20260809b_media_retention.sql

-- MySQL has no ADD COLUMN IF NOT EXISTS, so each column is guarded.
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_generations'
             AND column_name = 'credits_refunded');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_generations ADD COLUMN credits_refunded INT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_generations'
             AND column_name = 'expires_at');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_generations ADD COLUMN expires_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_generations'
             AND column_name = 'media_deleted_at');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_generations ADD COLUMN media_deleted_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'ai_generations'
             AND index_name = 'ai_generations_expires_at_media_deleted_at_idx');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_generations ADD INDEX ai_generations_expires_at_media_deleted_at_idx (expires_at, media_deleted_at)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Seed the retention setting if the deployment has never had one.
INSERT INTO ai_settings (`key`, `value`, `type`, `group`, created_at, updated_at)
SELECT 'media_retention_days', '30', 'number', 'storage', NOW(3), NOW(3)
WHERE NOT EXISTS (SELECT 1 FROM ai_settings WHERE `key` = 'media_retention_days');

-- Backfill existing completed generations using that window. Rows already
-- carrying an expiry are left alone so re-running cannot shorten anyone's
-- retention.
SET @days := (SELECT CAST(`value` AS UNSIGNED) FROM ai_settings WHERE `key` = 'media_retention_days');
SET @days := IFNULL(NULLIF(@days, 0), 30);

UPDATE ai_generations
   SET expires_at = DATE_ADD(created_at, INTERVAL @days DAY)
 WHERE expires_at IS NULL
   AND status = 'completed';
