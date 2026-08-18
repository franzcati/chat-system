-- ROLLBACK FASE 9A - usar sólo si se decide retirar estos índices.
USE chat_system;

DROP INDEX IF EXISTS idx_mensajes_chat_id ON mensajes;
DROP INDEX IF EXISTS idx_ma_chat_archivo ON mensajes_archivos;
DROP INDEX IF EXISTS idx_ma_lote_chat_id ON mensajes_archivos;
DROP INDEX IF EXISTS idx_ma_chat_fecha_id ON mensajes_archivos;
DROP INDEX IF EXISTS idx_mg_grupo_id ON mensajes_grupo;
DROP INDEX IF EXISTS idx_mg_grupo_lote_id ON mensajes_grupo;
DROP INDEX IF EXISTS idx_mga_grupo_usuario_archivo ON mensajes_grupo_archivos;
DROP INDEX IF EXISTS idx_mga_grupo_lote_id ON mensajes_grupo_archivos;
DROP INDEX IF EXISTS idx_ug_usuario_grupo ON usuario_grupo;
