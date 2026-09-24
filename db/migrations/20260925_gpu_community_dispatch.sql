-- Migration: community (GPUxMINE) dispatch — remember where a job failed
-- Date: 2026-09-25
-- Reason: A job that failed on a home PC was retried on the same PC. A failed
--         submit left the machine 'ready' and made it the most recently used,
--         so the queue's own ordering chose it again, and the customer's
--         second (last) attempt died the same way while other nodes sat idle.
--
--         avoid_worker_ids is a JSON array of ai_gpu_workers.id the job must
--         not be offered to again (bounded to 20 in code). NULL = none. The
--         stale-queue refund also ignores those machines when deciding
--         whether anything can still serve the job.
--
-- Additive and nullable: code that predates it never reads it.
-- Apply on prod:  mysql -u <user> -p <db> < 20260925_gpu_community_dispatch.sql

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_gpu_jobs'
             AND column_name = 'avoid_worker_ids');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_gpu_jobs ADD COLUMN avoid_worker_ids JSON NULL AFTER external_job_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
