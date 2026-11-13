-- Migration: series and short dramas (ซีรีส์ / ละครสั้น)
-- Date: 2026-11-13
-- Reason: A customer wants to tell one story over many episodes — a vertical
--         short drama of 1-minute episodes, or a series of longer ones — with
--         the same cast, look and frame in every episode, each episode ending
--         on a cliffhanger the next one picks up. An episode is an ordinary
--         film project (acts → scenes → shots, rendered and cut as before);
--         the series holds what they share: the premise, the cast, and the
--         AI-written outline of every episode (the "bible").
--
--   ai_story_series                 one series: premise, format, genre, look,
--                                   frame, episode length and count, the cast
--                                   (cast_json) and the outline (bible_json);
--                                   status draft | planning | ready | failed
--                                   while AI writes the outline.
--   ai_story_projects.series_id     the series an episode belongs to (NULL =
--                                   a standalone film). Deleting a series keeps
--                                   its episodes as standalone films.
--   ai_story_projects.episode_number  1-based, unique within its series.
--
-- users.id is BIGINT UNSIGNED on the shared (Laravel) table; user_id is a plain
-- snapshot with no foreign key, like ai_story_projects.user_id.
--
-- Additive only. Apply on prod BEFORE the code: Prisma names every column of
-- ai_story_projects in its SELECT, so code that knows series_id on a database
-- that does not breaks every movie page.
--   mysql -u <user> -p <db> < 20261113_story_series.sql

CREATE TABLE IF NOT EXISTS ai_story_series (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  title            VARCHAR(255) NOT NULL,
  premise          TEXT NOT NULL,
  format           VARCHAR(20)  NOT NULL DEFAULT 'short',
  genre            VARCHAR(30)  NOT NULL DEFAULT 'romance',
  language         VARCHAR(10)  NOT NULL DEFAULT 'th',
  aspect_ratio     VARCHAR(10)  NOT NULL DEFAULT '9:16',
  template_key     VARCHAR(50)  NOT NULL DEFAULT 'drama',
  episode_seconds  INT NOT NULL DEFAULT 60,
  episode_count    INT NOT NULL DEFAULT 10,
  cast_json        JSON NULL,
  bible_json       JSON NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft',
  error_message    TEXT NULL,
  planning_at      DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ai_story_series_user_id_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ai_story_projects
  ADD COLUMN series_id      INT NULL AFTER user_id,
  ADD COLUMN episode_number INT NULL AFTER series_id,
  ADD UNIQUE KEY ai_story_projects_series_id_episode_number_key (series_id, episode_number),
  ADD CONSTRAINT ai_story_projects_series_id_fkey FOREIGN KEY (series_id)
    REFERENCES ai_story_series (id) ON DELETE SET NULL ON UPDATE CASCADE;
