CREATE TABLE IF NOT EXISTS usuario_mfa (
  usuario_id INT NOT NULL,
  mfa_required TINYINT(1) NOT NULL DEFAULT 0,
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  secret_encrypted TEXT NULL,
  pending_secret_encrypted TEXT NULL,
  pending_created_at DATETIME NULL,
  enabled_at DATETIME NULL,
  last_totp_counter BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id),
  KEY idx_usuario_mfa_required_enabled (mfa_required, mfa_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
