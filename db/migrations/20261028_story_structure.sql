-- Migration: story library, acts and scenes, keyframes (คลังอ้างอิง + องก์/ฉาก + ภาพเปิดช็อต)
-- Date: 2026-10-28
-- Reason: A film has many characters, props (a sword, a car) and places, and
--         a long one is told in acts and scenes. Each shot should open on a
--         picture that holds every reference it shows — composed by an image
--         model that takes several reference pictures — and every act, scene
--         and shot must be re-planned or re-rendered on its own.
--
--   ai_story_characters.kind      character | prop | location — the one
--                                 table is the project's reference library.
--   ai_story_characters.images    extra pictures of the same thing (other
--                                 angles), after reference_url.
--   ai_story_characters.image_*   an AI picture ordered for it: the order,
--                                 its state and why it failed.
--   ai_story_acts                 the film's acts: title and summary.
--   ai_story_scenes               scenes, in an act or none: where, when,
--                                 what happens.
--   ai_story_shots.scene_id       the scene a shot belongs to (none = loose).
--   ai_story_shots.prop_ids       props visible in the shot.
--   ai_story_shots.location_id    the shot's place when it is not its scene's.
--   ai_story_shots.keyframe_*     the shot's opening picture: the order, the
--                                 picture, why it failed, and whether the
--                                 clip opens on it.
--
-- Additive only. Apply on prod before the code:
--   mysql -u <user> -p <db> < 20261028_story_structure.sql

ALTER TABLE ai_story_characters
  ADD COLUMN kind                VARCHAR(20) NOT NULL DEFAULT 'character' AFTER project_id,
  ADD COLUMN images              JSON NULL AFTER reference_url,
  ADD COLUMN image_status        VARCHAR(20) NULL,
  ADD COLUMN image_generation_id INT NULL,
  ADD COLUMN image_error         TEXT NULL,
  ADD COLUMN updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS ai_story_acts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  act_number  INT NOT NULL,
  title       VARCHAR(200) NOT NULL,
  summary     TEXT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ai_story_acts_project_id_idx (project_id),
  CONSTRAINT ai_story_acts_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES ai_story_projects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_story_scenes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  project_id    INT NOT NULL,
  act_id        INT NULL,
  scene_number  INT NOT NULL,
  title         VARCHAR(200) NOT NULL,
  summary       TEXT NULL,
  location_id   INT NULL,
  time_of_day   VARCHAR(20) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ai_story_scenes_project_id_idx (project_id),
  KEY ai_story_scenes_act_id_idx (act_id),
  CONSTRAINT ai_story_scenes_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES ai_story_projects (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ai_story_scenes_act_id_fkey FOREIGN KEY (act_id)
    REFERENCES ai_story_acts (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ai_story_shots
  ADD COLUMN scene_id               INT NULL AFTER project_id,
  ADD COLUMN prop_ids               JSON NULL AFTER character_ids,
  ADD COLUMN location_id            INT NULL AFTER prop_ids,
  ADD COLUMN keyframe_status        VARCHAR(20) NULL,
  ADD COLUMN keyframe_generation_id INT NULL,
  ADD COLUMN keyframe_url           MEDIUMTEXT NULL,
  ADD COLUMN keyframe_error         TEXT NULL,
  ADD COLUMN keyframe_use           TINYINT(1) NOT NULL DEFAULT 1,
  ADD KEY ai_story_shots_scene_id_idx (scene_id),
  ADD CONSTRAINT ai_story_shots_scene_id_fkey FOREIGN KEY (scene_id)
    REFERENCES ai_story_scenes (id) ON DELETE SET NULL ON UPDATE CASCADE;
