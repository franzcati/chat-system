-- Ejecutar una vez en cada base de datos antes de reiniciar el backend nuevo.
ALTER TABLE security_policy
  ADD COLUMN IF NOT EXISTS telegram_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS telegram_last_success_at DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS telegram_last_error_at DATETIME(3) NULL;
