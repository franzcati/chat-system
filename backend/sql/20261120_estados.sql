-- Ejecutar en cada VPS antes de publicar el backend. MariaDB 10.6+.
CREATE TABLE IF NOT EXISTS chat_estados (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instancia_id INT NOT NULL,
  autor_id INT NOT NULL,
  grupo_id INT NULL,
  tipo ENUM('texto','imagen','video') NOT NULL,
  texto VARCHAR(700) NULL,
  fondo CHAR(7) NULL,
  archivo VARCHAR(100) NULL,
  mime VARCHAR(50) NULL,
  creado_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  vence_at DATETIME(3) NOT NULL,
  eliminado_at DATETIME(3) NULL,
  KEY idx_estado_visor (instancia_id, vence_at, grupo_id),
  KEY idx_estado_autor (autor_id, creado_at),
  CONSTRAINT fk_estado_autor FOREIGN KEY (autor_id) REFERENCES usuario(id) ON DELETE CASCADE,
  CONSTRAINT fk_estado_grupo FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_estado_vistas (
  estado_id BIGINT UNSIGNED NOT NULL,
  usuario_id INT NOT NULL,
  visto_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (estado_id, usuario_id),
  CONSTRAINT fk_estado_vista FOREIGN KEY (estado_id) REFERENCES chat_estados(id) ON DELETE CASCADE,
  CONSTRAINT fk_estado_vista_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
