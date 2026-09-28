-- QuickChat - Auditoría mínima de eliminación de mensajes (2026-09-28)
-- Aditiva e idempotente. No elimina ni modifica mensajes existentes.
-- Permite distinguir eliminaciones propias de eliminaciones realizadas por moderadores.

SET @db_name := DATABASE();

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='mensajes' AND COLUMN_NAME='eliminado_por_usuario_id'),
  'SELECT 1',
  'ALTER TABLE mensajes ADD COLUMN eliminado_por_usuario_id INT NULL AFTER eliminado'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='mensajes' AND COLUMN_NAME='eliminado_por_admin'),
  'SELECT 1',
  'ALTER TABLE mensajes ADD COLUMN eliminado_por_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER eliminado_por_usuario_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='mensajes_grupo' AND COLUMN_NAME='eliminado_por_usuario_id'),
  'SELECT 1',
  'ALTER TABLE mensajes_grupo ADD COLUMN eliminado_por_usuario_id INT NULL AFTER eliminado'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='mensajes_grupo' AND COLUMN_NAME='eliminado_por_admin'),
  'SELECT 1',
  'ALTER TABLE mensajes_grupo ADD COLUMN eliminado_por_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER eliminado_por_usuario_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
