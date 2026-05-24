-- Migration: add ai_referrals + ai_referral_commissions
-- Date: 2026-05-24
-- Reason: Prisma schema had AiReferral / AiReferralCommission models but tables
--         were never created in production. Prisma client kept throwing P2021
--         (TableDoesNotExist), which broke any admin page that touched the
--         referral widget. Applied manually on prod via SQL because `prisma db
--         push` would have dropped legacy ai_crawl_logs (1407 rows) and
--         ai_crawl_settings that are no longer in schema.prisma.
--
-- FK type notes:
--   users.id is BIGINT(20) UNSIGNED (managed by Laravel/xmanstudio).
--   ai_credit_transactions.id is INT(11) (managed here by Prisma).
--   referrer_id / referred_id must match users.id → BIGINT UNSIGNED.
--   transaction_id must match ai_credit_transactions.id → INT.

CREATE TABLE IF NOT EXISTS ai_referrals (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  referrer_id     BIGINT UNSIGNED NOT NULL,
  referred_id     BIGINT UNSIGNED NULL,
  referral_code   VARCHAR(20) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  bonus_credits   INT NOT NULL DEFAULT 0,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY ai_referrals_referral_code_key (referral_code),
  KEY ai_referrals_referrer_id_idx (referrer_id),
  KEY ai_referrals_referred_id_idx (referred_id),
  CONSTRAINT ai_referrals_referrer_id_fkey
    FOREIGN KEY (referrer_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_referrals_referred_id_fkey
    FOREIGN KEY (referred_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_referral_commissions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  referral_id      INT NOT NULL,
  transaction_id   INT NOT NULL,
  commission_rate  DECIMAL(5,2) NOT NULL,
  credit_amount    INT NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  credited_at      DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ai_referral_commissions_referral_id_idx (referral_id),
  KEY ai_referral_commissions_status_idx (status),
  CONSTRAINT ai_referral_commissions_referral_id_fkey
    FOREIGN KEY (referral_id) REFERENCES ai_referrals(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_referral_commissions_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES ai_credit_transactions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
