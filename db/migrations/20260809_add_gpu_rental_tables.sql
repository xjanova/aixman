-- Migration: add ai_gpu_workers + ai_gpu_jobs
-- Date: 2026-08-09
-- Reason: GPU-rental support (SimplePod → self-hosted MiniMax H3). SimplePod is
--         a machine marketplace, not an inference API, so we rent a container,
--         run ComfyUI inside it, and track the machine's whole billed lifetime.
--         `ai_gpu_workers` is that lifetime; `ai_gpu_jobs` is the FIFO queue,
--         because one GPU renders exactly one video at a time.
--
--         Applied to prod by hand on 2026-08-09 before this file existed; it is
--         committed so a fresh environment (or a rebuild) gets the same tables.
--         `prisma db push` is NOT usable here: schema.prisma also maps the
--         Laravel-owned users/wallets/wallet_transactions tables and push would
--         try to ALTER them.
--
-- Type notes:
--   ai_generations.id is INT(11) → ai_gpu_jobs.generation_id must be INT.
--   auth_token holds the per-worker bearer token ENCRYPTED at rest (the
--   container's port is published on a public Cloudflare tunnel and ComfyUI has
--   no auth of its own, so this token is what keeps strangers off our GPU).
--
-- Apply on prod:  mysql -u <user> -p <db> < 20260809_add_gpu_rental_tables.sql

CREATE TABLE IF NOT EXISTS ai_gpu_workers (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  provider_slug      VARCHAR(50)  NOT NULL,
  external_id        VARCHAR(100) NOT NULL,
  support_id         VARCHAR(100) NULL,
  status             VARCHAR(50)  NOT NULL DEFAULT 'provisioning',
  model_key          VARCHAR(100) NOT NULL,
  endpoint           VARCHAR(500) NULL,
  auth_token         TEXT NULL,
  gpu_model          VARCHAR(100) NULL,
  gpu_count          INT NOT NULL DEFAULT 1,
  gpu_memory_mb      INT NULL,
  price_per_hour_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  jobs_completed     INT NOT NULL DEFAULT 0,
  jobs_failed        INT NOT NULL DEFAULT 0,
  total_cost_usd     DECIMAL(12,6) NOT NULL DEFAULT 0,
  last_error         TEXT NULL,
  rented_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ready_at           DATETIME(3) NULL,
  last_job_at        DATETIME(3) NULL,
  terminated_at      DATETIME(3) NULL,
  metadata           JSON NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- Stops a retried rental from being recorded twice as two billable machines.
  UNIQUE KEY ai_gpu_workers_provider_slug_external_id_key (provider_slug, external_id),
  KEY ai_gpu_workers_status_model_key_idx (status, model_key),
  KEY ai_gpu_workers_terminated_at_idx (terminated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_gpu_jobs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  generation_id   INT NOT NULL,
  worker_id       INT NULL,
  model_key       VARCHAR(100) NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'queued',
  priority        INT NOT NULL DEFAULT 50,
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 2,
  payload         JSON NOT NULL,
  external_job_id VARCHAR(255) NULL,
  result_url      MEDIUMTEXT NULL,
  error_message   TEXT NULL,
  gpu_seconds     INT NOT NULL DEFAULT 0,
  cost_usd        DECIMAL(10,6) NOT NULL DEFAULT 0,
  queued_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at      DATETIME(3) NULL,
  completed_at    DATETIME(3) NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- One job per generation: the atomic claim in GpuQueue relies on this to make
  -- double dispatch impossible even if two ticks overlap.
  UNIQUE KEY ai_gpu_jobs_generation_id_key (generation_id),
  KEY ai_gpu_jobs_status_priority_queued_at_idx (status, priority, queued_at),
  KEY ai_gpu_jobs_worker_id_status_idx (worker_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Foreign keys added separately: MySQL has no "ADD CONSTRAINT IF NOT EXISTS",
-- so each is guarded against information_schema to keep the file replayable.
SET @fk_gen := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name        = 'ai_gpu_jobs'
    AND constraint_name   = 'ai_gpu_jobs_generation_id_fkey'
);
SET @ddl := IF(
  @fk_gen = 0,
  'ALTER TABLE ai_gpu_jobs ADD CONSTRAINT ai_gpu_jobs_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES ai_generations(id) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- SET NULL rather than CASCADE: when a worker row is removed its finished jobs
-- must survive, otherwise the cost history behind the profit report disappears.
SET @fk_worker := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name        = 'ai_gpu_jobs'
    AND constraint_name   = 'ai_gpu_jobs_worker_id_fkey'
);
SET @ddl := IF(
  @fk_worker = 0,
  'ALTER TABLE ai_gpu_jobs ADD CONSTRAINT ai_gpu_jobs_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES ai_gpu_workers(id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
