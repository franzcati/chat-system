-- QuickChat MFA - FASE 3
-- Correo alternativo + OTP por correo + expiración + límites.
-- Diseñado para MariaDB 10.6+.

ALTER TABLE usuario_mfa
  ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(320) NULL AFTER last_totp_counter;

ALTER TABLE usuario_mfa
  ADD COLUMN IF NOT EXISTS email_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER recovery_email;

ALTER TABLE usuario_mfa
  ADD COLUMN IF NOT EXISTS email_verified_at DATETIME NULL AFTER email_enabled;

CREATE TABLE IF NOT EXISTS usuario_mfa_email_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  email_destination VARCHAR(320) NOT NULL,
  nonce CHAR(32) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mfa_email_user_purpose_created (usuario_id, purpose, created_at),
  KEY idx_mfa_email_expiry (expires_at),
  CONSTRAINT fk_mfa_email_challenges_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuario(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
