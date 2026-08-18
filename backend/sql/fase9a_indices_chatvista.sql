-- FASE 9A - INDICES MARIA DB PARA QUICKCHAT / CHATVISTA
-- Ejecutar primero SOLO en Chatvista.
-- MariaDB 10.6
-- No modifica filas ni columnas; sólo agrega índices.

USE chat_system;

-- Conversación privada: paginación ORDER BY id con emisor/receptor exactos.
CREATE INDEX IF NOT EXISTS idx_mensajes_chat_id
  ON mensajes (usuario_envia_id, usuario_recibe_id, id);

-- Archivos privados: localizar el archivo asociado a un mensaje por URL.
CREATE INDEX IF NOT EXISTS idx_ma_chat_archivo
  ON mensajes_archivos (sender_id, receiver_id, archivo_url);

-- Archivos privados: lotes de multimedia y MIN(id).
CREATE INDEX IF NOT EXISTS idx_ma_lote_chat_id
  ON mensajes_archivos (lote_id, sender_id, receiver_id, id);

-- Archivos privados del panel lateral, ordenados por fecha/id.
CREATE INDEX IF NOT EXISTS idx_ma_chat_fecha_id
  ON mensajes_archivos (sender_id, receiver_id, fecha_envio, id);

-- Mensajes de grupo: paginación y último mensaje por grupo.
CREATE INDEX IF NOT EXISTS idx_mg_grupo_id
  ON mensajes_grupo (grupo_id, id);

-- Mensajes de grupo: localizar el primer mensaje de un lote.
CREATE INDEX IF NOT EXISTS idx_mg_grupo_lote_id
  ON mensajes_grupo (grupo_id, lote_id, id);

-- Archivos de grupo: relación directa mensaje -> archivo.
CREATE INDEX IF NOT EXISTS idx_mga_grupo_usuario_archivo
  ON mensajes_grupo_archivos (grupo_id, usuario_id, archivo_url);

-- Archivos de grupo: relación lote -> primer archivo.
CREATE INDEX IF NOT EXISTS idx_mga_grupo_lote_id
  ON mensajes_grupo_archivos (grupo_id, lote_id, id);

-- Lista de grupos del usuario y joins usuario -> grupo.
CREATE INDEX IF NOT EXISTS idx_ug_usuario_grupo
  ON usuario_grupo (usuario_id, grupo_id);

-- Refrescar estadísticas del optimizador.
ANALYZE TABLE
  mensajes,
  mensajes_archivos,
  mensajes_grupo,
  mensajes_grupo_archivos,
  usuario_grupo;
