-- QuickChat: índices recomendados para listas, paginación y contadores.
-- Ejecutar UNA VEZ, preferiblemente fuera del horario de mayor uso.
-- El procedimiento evita volver a crear un índice con el mismo nombre.

DELIMITER //

DROP PROCEDURE IF EXISTS qc_add_index_if_missing//
CREATE PROCEDURE qc_add_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = p_table
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND index_name = p_index
  ) THEN
    SET @qc_sql = p_ddl;
    PREPARE qc_stmt FROM @qc_sql;
    EXECUTE qc_stmt;
    DEALLOCATE PREPARE qc_stmt;
  END IF;
END//

DELIMITER ;

CALL qc_add_index_if_missing(
  'mensajes',
  'idx_mensajes_envia_recibe_id',
  'ALTER TABLE mensajes ADD INDEX idx_mensajes_envia_recibe_id (usuario_envia_id, usuario_recibe_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes',
  'idx_mensajes_recibe_visto_envia_id',
  'ALTER TABLE mensajes ADD INDEX idx_mensajes_recibe_visto_envia_id (usuario_recibe_id, visto, usuario_envia_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes',
  'idx_mensajes_envia_id',
  'ALTER TABLE mensajes ADD INDEX idx_mensajes_envia_id (usuario_envia_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes_grupo',
  'idx_mensajes_grupo_grupo_id',
  'ALTER TABLE mensajes_grupo ADD INDEX idx_mensajes_grupo_grupo_id (grupo_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes_grupo',
  'idx_mensajes_grupo_grupo_usuario_id',
  'ALTER TABLE mensajes_grupo ADD INDEX idx_mensajes_grupo_grupo_usuario_id (grupo_id, usuario_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes_grupo_vistos',
  'idx_mgv_usuario_mensaje',
  'ALTER TABLE mensajes_grupo_vistos ADD INDEX idx_mgv_usuario_mensaje (usuario_id, mensaje_id)'
);

CALL qc_add_index_if_missing(
  'usuario_grupo',
  'idx_usuario_grupo_usuario_grupo',
  'ALTER TABLE usuario_grupo ADD INDEX idx_usuario_grupo_usuario_grupo (usuario_id, grupo_id)'
);

CALL qc_add_index_if_missing(
  'usuario_grupo',
  'idx_usuario_grupo_grupo_usuario',
  'ALTER TABLE usuario_grupo ADD INDEX idx_usuario_grupo_grupo_usuario (grupo_id, usuario_id)'
);

CALL qc_add_index_if_missing(
  'mensajes_archivos',
  'idx_ma_lote_participantes_id',
  'ALTER TABLE mensajes_archivos ADD INDEX idx_ma_lote_participantes_id (lote_id, sender_id, receiver_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes_archivos',
  'idx_ma_participantes_url',
  'ALTER TABLE mensajes_archivos ADD INDEX idx_ma_participantes_url (sender_id, receiver_id, archivo_url(100))'
);

CALL qc_add_index_if_missing(
  'mensajes_grupo_archivos',
  'idx_mga_grupo_lote_id',
  'ALTER TABLE mensajes_grupo_archivos ADD INDEX idx_mga_grupo_lote_id (grupo_id, lote_id, id)'
);

CALL qc_add_index_if_missing(
  'mensajes_grupo_archivos',
  'idx_mga_grupo_usuario_url',
  'ALTER TABLE mensajes_grupo_archivos ADD INDEX idx_mga_grupo_usuario_url (grupo_id, usuario_id, archivo_url(100))'
);

CALL qc_add_index_if_missing(
  'chat_silenciados',
  'idx_silenciados_usuario_estado_hasta',
  'ALTER TABLE chat_silenciados ADD INDEX idx_silenciados_usuario_estado_hasta (usuario_id, silenciado, silenciado_hasta)'
);

CALL qc_add_index_if_missing(
  'chats_estados',
  'idx_chats_estados_usuario',
  'ALTER TABLE chats_estados ADD INDEX idx_chats_estados_usuario (usuario_id, tipo, chat_id)'
);

DROP PROCEDURE IF EXISTS qc_add_index_if_missing;

-- Verificación rápida:
SELECT table_name, index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columnas
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN (
    'mensajes', 'mensajes_grupo', 'mensajes_grupo_vistos', 'usuario_grupo',
    'mensajes_archivos', 'mensajes_grupo_archivos', 'chat_silenciados', 'chats_estados'
  )
GROUP BY table_name, index_name
ORDER BY table_name, index_name;
