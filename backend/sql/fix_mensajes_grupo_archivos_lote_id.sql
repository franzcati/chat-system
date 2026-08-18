-- FASE 7C: alinear mensajes_grupo_archivos con el código que usa lote_id.
-- Ejecutar SOLO en Chatvista primero.
-- Base esperada: chat_system / MariaDB 10.6.

START TRANSACTION;

-- 1) Agregar la columna faltante.
ALTER TABLE mensajes_grupo_archivos
  ADD COLUMN IF NOT EXISTS lote_id VARCHAR(64) NULL AFTER tamano;

-- 2) Completar lote_id de archivos históricos a partir del mensaje de grupo
--    que apunta exactamente al mismo archivo.
UPDATE mensajes_grupo_archivos AS mga
JOIN mensajes_grupo AS mg
  ON mg.grupo_id = mga.grupo_id
 AND mg.usuario_id = mga.usuario_id
 AND mg.mensaje = mga.archivo_url
SET mga.lote_id = mg.lote_id
WHERE mga.lote_id IS NULL
  AND mg.lote_id IS NOT NULL;

COMMIT;

-- 3) Verificación visual.
SELECT
  COUNT(*) AS total_archivos,
  SUM(lote_id IS NOT NULL) AS archivos_con_lote
FROM mensajes_grupo_archivos;

SHOW COLUMNS FROM mensajes_grupo_archivos LIKE 'lote_id';
