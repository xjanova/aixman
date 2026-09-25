-- Migration: community (GPUxMINE) earnings — what a job was, for its ledger row
-- Date: 2026-09-25
-- Reason: A completed community job paid nobody: nothing wrote gpu_job_earnings,
--         and the facts a payout needs were never recorded on the job. These
--         are stamped when a community machine claims the job, in the same
--         conditional update, so the earning written after delivery settles
--         the job as it was dispatched (src/lib/services/gpux-ledger.ts):
--
--   ai_gpu_jobs.free_share     this job is the node's free share (owner decision
--                              D6: the node is paid 0 and the job's value is
--                              recorded as donated). Decided by aixman from the
--                              node's 30-day ledger against its freeSharePct —
--                              never by the node.
--   ai_gpu_jobs.pro            the node's owner held Pro when it claimed the job.
--   ai_gpu_jobs.owner_user_id  who owned the machine at claim time (users.id is
--                              BIGINT UNSIGNED; a snapshot, so no foreign key).
--   ai_gpu_jobs.review_reason  the render was delivered but looked wrong (too
--                              fast for its lane, a blank or tiny file): its
--                              earning is written as 'review' for an admin.
--
-- Rented claims write false/false/NULL. Defaults are what every job before this
-- file was: not free-shared, not Pro, owner unknown, nothing odd. Additive only.
-- Apply BEFORE the code that reads them starts (Prisma selects every mapped
-- column; the deploy workflow applies db/migrations/*.sql before `npm run build`).
-- gpu_job_earnings and gpu_nodes are xmanstudio's tables and are NOT touched here:
-- their columns come from xmanstudio's 2026_09_25_* migrations.
-- Apply on prod:  mysql -u <user> -p <db> < 20260925c_gpu_ledger.sql

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'free_share');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN free_share TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'pro');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN pro TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'owner_user_id');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN owner_user_id BIGINT UNSIGNED NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'review_reason');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN review_reason VARCHAR(255) NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
