-- Migration: model readiness state on ai_models
-- Date: 2026-08-09
-- Reason: Self-hosted models (SimplePod-rented GPU) cannot be trusted to work
--         until they have actually rendered something on this deployment —
--         the weights, the ComfyUI workflow and the GPU all have to line up,
--         and none of that is provable from code review alone.
--
--         Rather than letting a customer spend credits discovering a model is
--         broken, an unproven model sits in 'tuning': visible, clearly marked
--         "กำลังปรับแต่ง", and not orderable. An admin can still run it to
--         prove it out; the first success promotes it to 'ready', and a run of
--         failures demotes it back.
--
--         API-backed models (BytePlus, OpenAI, …) default to 'ready' because
--         they were already working before this column existed.
--
-- Apply on prod:  mysql -u <user> -p <db> < 20260809c_model_readiness.sql

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_models'
             AND column_name = 'readiness');
SET @ddl := IF(@c = 0,
  "ALTER TABLE ai_models ADD COLUMN readiness VARCHAR(20) NOT NULL DEFAULT 'ready'",
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_models'
             AND column_name = 'readiness_note');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_models ADD COLUMN readiness_note TEXT NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'ai_models'
             AND column_name = 'failure_streak');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ai_models ADD COLUMN failure_streak INT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Every model served by a GPU-rental provider starts unproven, including any
-- that were seeded before this migration. Models with a completed generation
-- already on record are left alone — they have proven themselves.
UPDATE ai_models m
   JOIN ai_providers p ON p.id = m.provider_id
    SET m.readiness = 'tuning',
        m.readiness_note = 'ยังไม่เคยสร้างงานสำเร็จบนระบบนี้ — รอทดสอบ'
  WHERE p.slug = 'simplepod'
    AND m.readiness = 'ready'
    AND NOT EXISTS (
      SELECT 1 FROM ai_generations g
       WHERE g.model_id = m.id AND g.status = 'completed'
    );
