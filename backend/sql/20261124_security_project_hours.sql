    -- MariaDB. Aplicar en pruebas después de 20261112_centro_seguridad.sql.
CREATE TABLE IF NOT EXISTS security_project_hours (
  instancia_id INT NOT NULL,
  proyecto_id INT NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL,
  start_time CHAR(5) NOT NULL,
  end_time CHAR(5) NOT NULL,
  PRIMARY KEY (instancia_id, proyecto_id, weekday),
  CONSTRAINT fk_security_project_hours_project FOREIGN KEY (proyecto_id) REFERENCES proyecto(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE security_exceptions
  ADD COLUMN IF NOT EXISTS proyecto_id INT NULL AFTER instancia_id,
  ADD INDEX IF NOT EXISTS idx_security_exception_scope (instancia_id, proyecto_id, local_date, usuario_id),
  ADD CONSTRAINT fk_security_exception_project FOREIGN KEY IF NOT EXISTS (proyecto_id) REFERENCES proyecto(id) ON DELETE CASCADE;
