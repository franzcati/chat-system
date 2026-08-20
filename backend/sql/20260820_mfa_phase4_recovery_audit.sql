-- QuickChat MFA - FASE 4
-- Recuperación, reset administrativo y auditoría.

CREATE TABLE IF NOT EXISTS usuario_mfa_recovery_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mfa_recovery_user_hash (usuario_id, code_hash),
  KEY idx_mfa_recovery_active (usuario_id, used_at, revoked_at),
  CONSTRAINT fk_mfa_recovery_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuario_mfa_auditoria (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT NULL,
  actor_usuario_id INT NULL,
  evento VARCHAR(64) NOT NULL,
  metodo VARCHAR(32) NULL,
  resultado VARCHAR(16) NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  metadata_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mfa_audit_user_date (usuario_id, created_at),
  KEY idx_mfa_audit_actor_date (actor_usuario_id, created_at),
  KEY idx_mfa_audit_event_date (evento, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles_permisos (rol_id, permiso)
SELECT 1, 'gestionar_mfa'
WHERE NOT EXISTS (
  SELECT 1
  FROM roles_permisos
  WHERE rol_id = 1
    AND permiso = 'gestionar_mfa'
);
