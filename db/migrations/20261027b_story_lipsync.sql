-- Migration: MV vocal lip-sync (ลิปซิงก์เสียงร้องในโหมด MV)
-- Date: 2026-10-27
-- Reason: An MV's singer should mouth the song. The lead vocal is taken out
--         of the song once per project (Demucs on our server, or a vocal stem
--         the customer uploads), each singing shot gets its slice of it, and
--         LatentSync re-dubs the shot's clip to that slice.
--
--   ai_story_projects.vocals_*   the project's lead vocal: where it is, where
--                                it came from, for which song, and the state
--                                of a separation in progress.
--   ai_story_shots.lipsync_*     one shot's dub: the order, its clip, the shot
--                                clip it was made from (a re-render makes it
--                                stale), and whether the cut uses it.
--
-- Additive only. Apply on prod before the code:
--   mysql -u <user> -p <db> < 20261027b_story_lipsync.sql

ALTER TABLE ai_story_projects
  ADD COLUMN vocals_status     VARCHAR(20) NULL,
  ADD COLUMN vocals_url        MEDIUMTEXT NULL,
  ADD COLUMN vocals_source     VARCHAR(20) NULL,
  ADD COLUMN vocals_song_url   MEDIUMTEXT NULL,
  ADD COLUMN vocals_error      TEXT NULL,
  ADD COLUMN vocals_started_at DATETIME(3) NULL;

ALTER TABLE ai_story_shots
  ADD COLUMN lipsync_status        VARCHAR(20) NULL,
  ADD COLUMN lipsync_generation_id INT NULL,
  ADD COLUMN lipsync_url           MEDIUMTEXT NULL,
  ADD COLUMN lipsync_source_url    MEDIUMTEXT NULL,
  ADD COLUMN lipsync_error         TEXT NULL,
  ADD COLUMN lipsync_use           TINYINT(1) NOT NULL DEFAULT 1;
