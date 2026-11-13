-- Phase 2: pin the opening picture to its inputs and store its human face review.
-- Additive, ai_ tables only. Apply BEFORE deploying the updated Prisma client.
SET @story_continuity_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_story_shots' AND COLUMN_NAME = 'keyframe_meta') = 0,
  'ALTER TABLE ai_story_shots ADD COLUMN keyframe_meta JSON NULL',
  'SELECT 1'
);
PREPARE story_continuity_stmt FROM @story_continuity_ddl;
EXECUTE story_continuity_stmt;
DEALLOCATE PREPARE story_continuity_stmt;
