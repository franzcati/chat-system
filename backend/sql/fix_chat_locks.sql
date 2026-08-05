-- Ejecutar en la base de datos del chat durante una ventana de bajo tráfico.
-- Primero permite identificar transacciones abiertas que estén reteniendo locks.

SELECT
  trx_id,
  trx_mysql_thread_id,
  trx_started,
  trx_state,
  trx_wait_started,
  trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;

SHOW FULL PROCESSLIST;
SHOW ENGINE INNODB STATUS;

-- Verifica índices antes de crearlos:
SHOW INDEX FROM mensajes;
SHOW INDEX FROM mensajes_grupo;
SHOW INDEX FROM mensajes_grupo_vistos;
SHOW INDEX FROM chat_silenciados;

-- Antes de crear el índice UNIQUE, esta consulta debe devolver cero filas.
SELECT mensaje_id, usuario_id, COUNT(*) AS duplicados
FROM mensajes_grupo_vistos
GROUP BY mensaje_id, usuario_id
HAVING COUNT(*) > 1;

-- Índices recomendados. Ejecutar cada ALTER solamente si no existe un índice
-- equivalente con las mismas columnas iniciales.
ALTER TABLE mensajes
  ADD INDEX idx_mensajes_pendientes_visto
  (usuario_envia_id, usuario_recibe_id, visto, id);

ALTER TABLE mensajes_grupo
  ADD INDEX idx_mensajes_grupo_lectura
  (grupo_id, usuario_id, id);

ALTER TABLE mensajes_grupo_vistos
  ADD UNIQUE INDEX uq_mensaje_grupo_usuario_visto
  (mensaje_id, usuario_id);

-- chat_silenciados ya debería tener UNIQUE(usuario_id, tipo, chat_id).
-- No es necesario actualizar silencios vencidos en cada GET; se filtran por fecha.
