-- Ejecutar una vez en cada VPS antes de reiniciar el backend actualizado.
-- Conserva el historial y permite editar el mismo mensaje de Telegram.
ALTER TABLE security_alert_outbox
  ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS message_revision INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_revision INT NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS attempt_outcome ENUM('pending','correct','failed') NULL,
  ADD COLUMN IF NOT EXISTS attempt_deadline_at DATETIME(3) NULL,
  ADD KEY IF NOT EXISTS idx_security_alert_deadline (attempt_outcome,attempt_deadline_at);
