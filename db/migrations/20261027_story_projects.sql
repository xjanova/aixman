-- Migration: movie / MV projects (โหมดหนัง + โหมด MV)
-- Date: 2026-10-27
-- Reason: A film or a music video is a project made of many shots, each its
--         own ai_generations row. Shots must survive partial failure — losing
--         shot 9 must not lose shots 1-8 — so the project and its shots live
--         here, not on ai_generations.
--
--   ai_story_projects    one film or MV: the brief (or the lyrics), the look,
--                        the frame, and for an MV the song and its mood.
--   ai_story_characters  a face that must stay the same in every shot; its
--                        uploaded picture is the first frame of the shots it
--                        leads.
--   ai_story_shots       one shot: what it shows, its framing and camera, its
--                        line, the model chosen for it and the render it got.
--
-- The Prisma models were added in f2c1419 (2026-09-12) and never created on
-- prod; this creates them as the code now reads them. users.id is BIGINT
-- UNSIGNED on the shared (Laravel) table; user_id is a plain snapshot with no
-- foreign key, like ai_api_keys.user_id.
-- Additive only. Apply on prod before the code:
--   mysql -u <user> -p <db> < 20261027_story_projects.sql

CREATE TABLE IF NOT EXISTS ai_story_projects (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  title            VARCHAR(255) NOT NULL,
  template_key     VARCHAR(50)  NOT NULL DEFAULT 'film',
  brief            TEXT NOT NULL,
  language         VARCHAR(10)  NOT NULL DEFAULT 'th',
  aspect_ratio     VARCHAR(10)  NOT NULL DEFAULT '16:9',
  mode             VARCHAR(10)  NOT NULL DEFAULT 'film',
  song_url         MEDIUMTEXT NULL,
  song_seconds     DECIMAL(8,2) NULL,
  mood             VARCHAR(30)  NULL,
  status           VARCHAR(30)  NOT NULL DEFAULT 'draft',
  quote_json       JSON NULL,
  credits_charged  INT NOT NULL DEFAULT 0,
  actual_cost_usd  DECIMAL(12,6) NOT NULL DEFAULT 0,
  script_json      JSON NULL,
  final_video_url  MEDIUMTEXT NULL,
  thumbnail_url    MEDIUMTEXT NULL,
  duration_sec     INT NULL,
  error_message    TEXT NULL,
  expires_at       DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ai_story_projects_user_id_status_idx (user_id, status),
  KEY ai_story_projects_status_created_at_idx (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_story_characters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  project_id     INT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  description    TEXT NOT NULL,
  origin         VARCHAR(20) NOT NULL DEFAULT 'generated',
  reference_url  MEDIUMTEXT NULL,
  voice_id       VARCHAR(100) NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ai_story_characters_project_id_idx (project_id),
  CONSTRAINT ai_story_characters_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES ai_story_projects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_story_shots (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  project_id            INT NOT NULL,
  shot_number           INT NOT NULL,
  visual_prompt         TEXT NOT NULL,
  narration             TEXT NULL,
  character_ids         JSON NULL,
  speaker_id            INT NULL,
  shot_size             VARCHAR(30) NOT NULL DEFAULT 'medium',
  camera                VARCHAR(30) NOT NULL DEFAULT 'static',
  sound                 TEXT NULL,
  model_id              INT NULL,
  start_sec             DECIMAL(8,2) NULL,
  duration_sec          DECIMAL(6,2) NOT NULL DEFAULT 0,
  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  media_url             MEDIUMTEXT NULL,
  audio_url             MEDIUMTEXT NULL,
  visual_generation_id  INT NULL,
  error_message         TEXT NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ai_story_shots_project_id_shot_number_idx (project_id, shot_number),
  KEY ai_story_shots_project_id_status_idx (project_id, status),
  CONSTRAINT ai_story_shots_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES ai_story_projects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
