-- Aplicar después de las migraciones de Estados de las Fases 1 y 2.
CREATE TABLE IF NOT EXISTS chat_estado_reacciones (
  estado_id BIGINT UNSIGNED NOT NULL,
  usuario_id INT NOT NULL,
  creado_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (estado_id, usuario_id),
  KEY idx_estado_reacciones_usuario (usuario_id),
  CONSTRAINT fk_estado_reaccion_estado FOREIGN KEY (estado_id)
    REFERENCES chat_estados(id) ON DELETE CASCADE,
  CONSTRAINT fk_estado_reaccion_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
