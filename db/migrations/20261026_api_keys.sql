-- Migration: customer API keys + per-request usage for the LLM API
-- Date: 2026-10-26
-- Reason: Customers call language models through /api/v1 (OpenAI-compatible)
--         with their own key and pay in AI credits per token. Two tables:
--
--   ai_api_keys   one row per key. Only the SHA-256 of the key is stored; the
--                 key itself is shown once, at creation. `carry_millicredits`
--                 is the fraction of a credit already used but not yet taken
--                 from the balance (credits are whole numbers, a short request
--                 costs a fraction of one).
--   ai_api_usage  one row per request: tokens, what it cost the customer and
--                 us, and how it ended. Read by the customer's usage page and
--                 the admin page.
--
-- users.id is BIGINT UNSIGNED on the shared (Laravel) table; user_id here is a
-- plain snapshot with no foreign key, like ai_gpu_jobs.owner_user_id.
-- Additive only. Apply on prod:  mysql -u <user> -p <db> < 20261026_api_keys.sql

CREATE TABLE IF NOT EXISTS ai_api_keys (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT UNSIGNED NOT NULL,
  name                VARCHAR(100) NOT NULL,
  key_prefix          VARCHAR(16)  NOT NULL,
  key_hash            CHAR(64)     NOT NULL,
  carry_millicredits  INT NOT NULL DEFAULT 0,
  last_used_at        DATETIME(3) NULL,
  revoked_at          DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ai_api_keys_key_hash_key (key_hash),
  KEY ai_api_keys_user_id_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_api_usage (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  api_key_id         INT NOT NULL,
  model              VARCHAR(255) NOT NULL,
  backend            VARCHAR(50)  NOT NULL,
  prompt_tokens      INT NOT NULL DEFAULT 0,
  completion_tokens  INT NOT NULL DEFAULT 0,
  millicredits       INT NOT NULL DEFAULT 0,
  cost_usd           DECIMAL(12,6) NOT NULL DEFAULT 0,
  status             VARCHAR(20)  NOT NULL,
  error              VARCHAR(500) NULL,
  latency_ms         INT NOT NULL DEFAULT 0,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ai_api_usage_user_id_created_at_idx (user_id, created_at),
  KEY ai_api_usage_api_key_id_created_at_idx (api_key_id, created_at),
  KEY ai_api_usage_created_at_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
