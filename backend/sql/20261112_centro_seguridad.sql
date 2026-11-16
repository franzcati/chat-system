-- Ejecutar en la VPS de desarrollo antes de desplegar el backend.
CREATE TABLE IF NOT EXISTS security_sessions (
  id CHAR(36) PRIMARY KEY,
  usuario_id INT NOT NULL,
  instancia_id INT NOT NULL,
  device_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(500),
  ip VARCHAR(64),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  KEY idx_security_session_user (usuario_id, revoked_at, expires_at),
  KEY idx_security_session_device (instancia_id, usuario_id, device_hash, revoked_at),
  CONSTRAINT fk_security_session_user FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_devices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instancia_id INT NOT NULL,
  usuario_id INT NOT NULL,
  device_hash CHAR(64) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_security_device (instancia_id, usuario_id, device_hash),
  CONSTRAINT fk_security_device_user FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_credentials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instancia_id INT NOT NULL,
  proyecto_id INT NULL,
  plataforma VARCHAR(100) NOT NULL,
  cuenta VARCHAR(190) NOT NULL,
  nombre VARCHAR(190) NOT NULL,
  responsable_id INT NOT NULL,
  creado_por_id INT NOT NULL,
  secret_cipher TEXT NOT NULL,
  estado ENUM('activo','suspendido') NOT NULL DEFAULT 'activo',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_security_credential_scope (instancia_id, estado, responsable_id),
  CONSTRAINT fk_security_credential_owner FOREIGN KEY (responsable_id) REFERENCES usuario(id),
  CONSTRAINT fk_security_credential_creator FOREIGN KEY (creado_por_id) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_credential_access (
  credential_id BIGINT UNSIGNED NOT NULL,
  usuario_id INT NOT NULL,
  asignado_por_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (credential_id, usuario_id),
  KEY idx_security_access_user (usuario_id),
  CONSTRAINT fk_security_access_credential FOREIGN KEY (credential_id) REFERENCES security_credentials(id) ON DELETE CASCADE,
  CONSTRAINT fk_security_access_user FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_policy (
  instancia_id INT PRIMARY KEY,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Lima',
  daily_offhours_limit INT UNSIGNED NOT NULL DEFAULT 10,
  max_credentials INT UNSIGNED NOT NULL DEFAULT 2,
  step_up_offhours TINYINT(1) NOT NULL DEFAULT 1,
  telegram_chat_id VARCHAR(80) NULL,
  telegram_enabled TINYINT(1) NOT NULL DEFAULT 1,
  telegram_last_success_at DATETIME(3) NULL,
  telegram_last_error_at DATETIME(3) NULL,
  alert_offhours TINYINT(1) NOT NULL DEFAULT 1,
  alert_new_device TINYINT(1) NOT NULL DEFAULT 1,
  alert_multiple_devices TINYINT(1) NOT NULL DEFAULT 1,
  daily_digest_time CHAR(5) NOT NULL DEFAULT '18:05',
  KEY idx_security_digest (daily_digest_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_user_limits (
  instancia_id INT NOT NULL,
  usuario_id INT NOT NULL,
  max_credentials INT UNSIGNED NULL,
  daily_offhours_limit INT UNSIGNED NULL,
  PRIMARY KEY (instancia_id, usuario_id),
  CONSTRAINT fk_security_limit_user FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_hours (
  instancia_id INT NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  start_time CHAR(5) NOT NULL DEFAULT '08:00',
  end_time CHAR(5) NOT NULL DEFAULT '18:00',
  PRIMARY KEY (instancia_id, weekday)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_exceptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instancia_id INT NOT NULL,
  usuario_id INT NULL,
  local_date DATE NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  start_time CHAR(5) NULL,
  end_time CHAR(5) NULL,
  reason VARCHAR(190) NOT NULL,
  approved_by_id INT NOT NULL,
  KEY idx_security_exception_day (instancia_id, local_date, usuario_id),
  CONSTRAINT fk_security_exception_approver FOREIGN KEY (approved_by_id) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instancia_id INT NOT NULL,
  usuario_id INT NULL,
  credential_id BIGINT UNSIGNED NULL,
  session_id CHAR(36) NULL,
  event_type VARCHAR(64) NOT NULL,
  result VARCHAR(24) NOT NULL,
  outside_hours TINYINT(1) NOT NULL DEFAULT 0,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  detail_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_security_event_scope (instancia_id, created_at),
  KEY idx_security_event_user (instancia_id, usuario_id, event_type, created_at),
  KEY idx_security_event_credential (credential_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS security_alert_outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instancia_id INT NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  dedupe_key VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  UNIQUE KEY uq_security_alert_dedupe (instancia_id, dedupe_key),
  KEY idx_security_alert_queue (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO roles_permisos (rol_id, permiso)
SELECT r.id, p.permiso FROM roles r JOIN (
  SELECT 'consultar_2fa' permiso UNION ALL
  SELECT 'registrar_credenciales_2fa' UNION ALL
  SELECT 'gestionar_credenciales_2fa' UNION ALL
  SELECT 'gestionar_horarios_2fa' UNION ALL
  SELECT 'gestionar_alertas_2fa' UNION ALL
  SELECT 'ver_auditoria_seguridad'
) p WHERE LOWER(r.nombre) = 'admin';
INSERT IGNORE INTO roles_permisos (rol_id, permiso)
SELECT r.id, 'consultar_2fa' FROM roles r WHERE LOWER(r.nombre) = 'user';
