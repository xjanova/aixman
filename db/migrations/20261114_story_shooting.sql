-- Apply before deploying the shooting-script and finishing code. Additive and repeatable.
SET @aixman_schema = DATABASE();
SET @aixman_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@aixman_schema AND TABLE_NAME='ai_story_shots' AND COLUMN_NAME='angle'), 'SELECT 1', 'ALTER TABLE ai_story_shots ADD COLUMN angle VARCHAR(30) NOT NULL DEFAULT ''eye-level''');
PREPARE aixman_stmt FROM @aixman_sql;
EXECUTE aixman_stmt;
DEALLOCATE PREPARE aixman_stmt;
SET @aixman_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@aixman_schema AND TABLE_NAME='ai_story_shots' AND COLUMN_NAME='continuity_note'), 'SELECT 1', 'ALTER TABLE ai_story_shots ADD COLUMN continuity_note TEXT NULL');
PREPARE aixman_stmt FROM @aixman_sql;
EXECUTE aixman_stmt;
DEALLOCATE PREPARE aixman_stmt;
SET @aixman_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@aixman_schema AND TABLE_NAME='ai_story_shots' AND COLUMN_NAME='cut_json'), 'SELECT 1', 'ALTER TABLE ai_story_shots ADD COLUMN cut_json JSON NULL');
PREPARE aixman_stmt FROM @aixman_sql;
EXECUTE aixman_stmt;
DEALLOCATE PREPARE aixman_stmt;
