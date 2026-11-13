-- Phase 1: character voices, audio-first Thai dubbing, film dialogue lip-sync.
-- Additive, ai_ tables only. Apply BEFORE deploying the updated Prisma client.
ALTER TABLE ai_story_shots
  ADD COLUMN delivery VARCHAR(30) NOT NULL DEFAULT 'neutral',
  ADD COLUMN dub_status VARCHAR(20) NULL,
  ADD COLUMN dub_generation_id INT NULL,
  ADD COLUMN dub_text TEXT NULL,
  ADD COLUMN dub_voice_id VARCHAR(100) NULL,
  ADD COLUMN dub_seconds DECIMAL(8,3) NULL,
  ADD COLUMN dub_error TEXT NULL,
  ADD COLUMN dub_started_at DATETIME(3) NULL,
  ADD COLUMN lipsync_audio_url MEDIUMTEXT NULL;
