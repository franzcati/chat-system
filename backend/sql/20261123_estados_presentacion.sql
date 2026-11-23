-- MariaDB 10.6+. Aplicar después de 20261123_estados_multidestino.sql.
ALTER TABLE chat_estados
  ADD COLUMN IF NOT EXISTS apariencia VARCHAR(160) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS leyenda VARCHAR(700) NULL DEFAULT NULL;
