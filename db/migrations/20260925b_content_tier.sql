-- Migration: content tier + privacy for community (GPUxMINE) machines
-- Date: 2026-09-25
-- Reason: The privacy page promises that adult content and anything carrying a
--         customer's own photo or voice never runs on a stranger's PC, and that
--         a job is deleted from the machine that ran it. Nothing recorded what a
--         job contained, so dispatch could not keep that promise (owner
--         decision D4, 2026-09-18).
--
--   ai_generations.content_tier  general | adult | blocked | unknown, set from
--                                the order's words before charging
--                                (src/lib/safety/content-tier.ts).
--   ai_gpu_jobs.content_tier     the same value, for the queue's claim filter.
--   ai_gpu_jobs.has_input_media  the customer attached an image, frame, song or
--                                clip. Such a job never goes to a community node.
--   ai_gpu_jobs.node_purged_at   when a community node confirmed it deleted the
--                                job's files and history (contract C5); the tick
--                                retries for a day while it is NULL.
--   INDEX (status, completed_at) for that retry sweep.
--
-- Defaults are the safe reading of a row written before this file: 'unknown'
-- is never sent to a community machine. Additive only; code that predates it
-- never reads the columns. Must be applied before the code that reads them
-- starts (the deploy workflow applies db/migrations/*.sql before `npm run build`).
-- Apply on prod:  mysql -u <user> -p <db> < 20260925b_content_tier.sql

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_generations'
             AND column_name = 'content_tier');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_generations ADD COLUMN content_tier VARCHAR(16) NOT NULL DEFAULT ''unknown''',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'content_tier');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN content_tier VARCHAR(16) NOT NULL DEFAULT ''unknown''',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'has_input_media');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN has_input_media TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'node_purged_at');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN node_purged_at DATETIME(3) NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND index_name = 'ai_gpu_jobs_status_completed_at_idx');
SET @ddl := IF(@c = 0,
  'CREATE INDEX ai_gpu_jobs_status_completed_at_idx ON ai_gpu_jobs (status, completed_at)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
