-- MariaDB 10.6+. Aplicar después de 20261120_estados.sql.
-- La migración agrega estructura. No modifica filas existentes.
ALTER TABLE chat_estados
  ADD COLUMN IF NOT EXISTS visible_instancia TINYINT UNSIGNED NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS clave_envio VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN IF NOT EXISTS huella_envio CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_estado_envio (instancia_id, autor_id, clave_envio);

CREATE TABLE IF NOT EXISTS chat_estado_grupos (
  estado_id BIGINT UNSIGNED NOT NULL,
  grupo_id INT NOT NULL,
  PRIMARY KEY (estado_id, grupo_id),
  KEY idx_estado_grupos_grupo (grupo_id, estado_id),
  CONSTRAINT fk_estado_destino_estado FOREIGN KEY (estado_id) REFERENCES chat_estados(id) ON DELETE CASCADE,
  CONSTRAINT fk_estado_destino_grupo FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
