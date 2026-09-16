-- =====================================================================
-- ChatVista / QuickChat - Gestión de Proyectos multiportal
-- Fecha: 2026-09-16
-- IMPORTANTE: ejecutar con copia de seguridad previa.
-- Esta migración es conservadora: NO adivina portal, dominio ni proyecto
-- principal cuando los datos históricos no permiten determinarlos con certeza.
-- =====================================================================

-- 1) Catálogo normalizado de portales / instancias.
CREATE TABLE `instancia` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `codigo` varchar(32) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `dominio_base` varchar(190) NOT NULL,
  `estado` enum('activo','inactivo') NOT NULL DEFAULT 'activo',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_instancia_codigo` (`codigo`),
  UNIQUE KEY `uq_instancia_dominio_base` (`dominio_base`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `instancia` (`codigo`, `nombre`, `dominio_base`, `estado`) VALUES
  ('quickchat', 'QUICK CHAT', 'quickchat.click', 'activo'),
  ('chatvista', 'CHATVISTA', 'chatvista.click', 'activo');

-- 2) Ampliar la tabla proyecto existente. NO se crea proyecto_v2.
ALTER TABLE `proyecto`
  ADD COLUMN `dominio` varchar(190) DEFAULT NULL AFTER `nombre`,
  ADD COLUMN `instancia_id` int(11) DEFAULT NULL AFTER `dominio`,
  ADD COLUMN `tipo` enum('operativo','comercial','soporte','personalizado') NOT NULL DEFAULT 'operativo' AFTER `descripcion`,
  ADD COLUMN `color` varchar(20) NOT NULL DEFAULT '#168cff' AFTER `tipo`,
  ADD COLUMN `icono` varchar(40) NOT NULL DEFAULT 'folder' AFTER `color`,
  ADD COLUMN `created_at` datetime NOT NULL DEFAULT current_timestamp() AFTER `estado`,
  ADD COLUMN `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() AFTER `created_at`,
  ADD KEY `idx_proyecto_dominio` (`dominio`),
  ADD KEY `idx_proyecto_instancia_estado` (`instancia_id`,`estado`),
  ADD CONSTRAINT `fk_proyecto_instancia`
    FOREIGN KEY (`instancia_id`) REFERENCES `instancia` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) Ampliar usuario sin eliminar correo: correo sigue siendo el login final.
ALTER TABLE `usuario`
  ADD COLUMN `usuario_base` varchar(100) DEFAULT NULL AFTER `correo`,
  ADD COLUMN `proyecto_principal_id` int(11) DEFAULT NULL AFTER `usuario_base`,
  ADD COLUMN `instancia_id` int(11) DEFAULT NULL AFTER `proyecto_principal_id`,
  ADD COLUMN `correo_gestionado_proyecto` tinyint(1) NOT NULL DEFAULT 0 AFTER `instancia_id`,
  ADD KEY `idx_usuario_usuario_base` (`usuario_base`),
  ADD KEY `idx_usuario_proyecto_principal` (`proyecto_principal_id`),
  ADD KEY `idx_usuario_instancia_estado` (`instancia_id`,`estado`),
  ADD CONSTRAINT `fk_usuario_proyecto_principal`
    FOREIGN KEY (`proyecto_principal_id`) REFERENCES `proyecto` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_usuario_instancia`
    FOREIGN KEY (`instancia_id`) REFERENCES `instancia` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3.1) Evitar que un usuario quede asociado dos veces al mismo proyecto.
ALTER TABLE `usuario_proyecto`
  ADD UNIQUE KEY `uq_usuario_proyecto` (`usuario_id`, `proyecto_id`);
-- 4) Los cambios de datos sí se agrupan en una transacción.
START TRANSACTION;

-- 4) usuario_base sí puede obtenerse de forma segura del correo existente.
UPDATE `usuario`
   SET `usuario_base` = LOWER(SUBSTRING_INDEX(TRIM(`correo`), '@', 1))
 WHERE (`usuario_base` IS NULL OR TRIM(`usuario_base`) = '')
   AND `correo` LIKE '%@%';

-- Las cuentas cuyo correo YA usa directamente uno de los dos dominios de portal
-- sí pueden asociarse de forma determinista a su instancia, sin adivinar proyectos.
UPDATE `usuario`
   SET `instancia_id` = (SELECT `id` FROM `instancia` WHERE `codigo`='quickchat')
 WHERE LOWER(SUBSTRING_INDEX(TRIM(`correo`), '@', -1)) = 'quickchat.click';

UPDATE `usuario`
   SET `instancia_id` = (SELECT `id` FROM `instancia` WHERE `codigo`='chatvista')
 WHERE LOWER(SUBSTRING_INDEX(TRIM(`correo`), '@', -1)) = 'chatvista.click';

-- 5) Proyecto principal: asignar SOLO cuando existe una única relación clara.
--    Los usuarios con 0 o múltiples proyectos quedan NULL para revisión administrativa.
UPDATE `usuario` u
JOIN (
  SELECT `usuario_id`, MIN(`proyecto_id`) AS `proyecto_id`
    FROM `usuario_proyecto`
   GROUP BY `usuario_id`
  HAVING COUNT(DISTINCT `proyecto_id`) = 1
) unico ON unico.`usuario_id` = u.`id`
   SET u.`proyecto_principal_id` = unico.`proyecto_id`
 WHERE u.`proyecto_principal_id` IS NULL;

COMMIT;

-- 6) Historial de cambios de dominio. Se escribe dentro de la misma transacción
--    de negocio cuando se confirma un cambio desde la API.
CREATE TABLE `proyecto_dominio_historial` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyecto_id` int(11) NOT NULL,
  `dominio_anterior` varchar(190) DEFAULT NULL,
  `dominio_nuevo` varchar(190) NOT NULL,
  `usuario_admin_id` int(11) DEFAULT NULL,
  `fecha` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_historial_proyecto_fecha` (`proyecto_id`,`fecha`),
  KEY `idx_historial_admin` (`usuario_admin_id`),
  CONSTRAINT `fk_historial_proyecto`
    FOREIGN KEY (`proyecto_id`) REFERENCES `proyecto` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_historial_admin`
    FOREIGN KEY (`usuario_admin_id`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- PASO ADMINISTRATIVO OBLIGATORIO DESPUÉS DE ESTA MIGRACIÓN
-- =====================================================================
-- Los proyectos históricos NO reciben instancia ni dominio automáticamente.
-- Debes asignarlos con información confirmada antes de reiniciar el backend.
--
-- 1. Ver proyectos pendientes:
-- SELECT id, nombre, dominio, instancia_id FROM proyecto ORDER BY id;
--
-- 2. Ver candidatos de dominio según los correos de miembros actuales.
--    Esto es un DIAGNÓSTICO, no una autorización para asignar automáticamente:
-- SELECT
--   p.id,
--   p.nombre,
--   LOWER(SUBSTRING_INDEX(u.correo,'@',-1)) AS dominio_candidato,
--   COUNT(*) AS usuarios
-- FROM proyecto p
-- JOIN usuario_proyecto up ON up.proyecto_id = p.id
-- JOIN usuario u ON u.id = up.usuario_id
-- GROUP BY p.id, p.nombre, LOWER(SUBSTRING_INDEX(u.correo,'@',-1))
-- ORDER BY p.id, usuarios DESC;
--
-- 3. Ejemplos de asignación MANUAL (edita IDs/dominios con datos confirmados):
-- UPDATE proyecto
--    SET instancia_id = (SELECT id FROM instancia WHERE codigo='quickchat'),
--        dominio = 'dominio-confirmado.com'
--  WHERE id = 25;
--
-- UPDATE proyecto
--    SET instancia_id = (SELECT id FROM instancia WHERE codigo='chatvista'),
--        dominio = 'otro-dominio-confirmado.com'
--  WHERE id = 99;
--
-- IMPORTANTE:
-- Un mismo dominio puede ser utilizado por más de un proyecto cuando la
-- operación real lo requiera.
-- La unicidad continúa aplicándose a usuario.correo.
-- Los dominios compartidos deben corresponder a una configuración
-- administrativa confirmada.
--
-- 4. Después de asignar instancia a los proyectos, derivar instancia de usuarios
--    que ya tienen proyecto principal (esto sí es determinista):
-- UPDATE usuario u
-- JOIN proyecto p ON p.id = u.proyecto_principal_id
--    SET u.instancia_id = p.instancia_id
--  WHERE u.instancia_id IS NULL
--    AND p.instancia_id IS NOT NULL;
--
-- 5. Marcar como gestionados SOLO usuarios con proyecto principal cuyo correo
--    actual ya coincide exactamente con el dominio confirmado del proyecto:
-- UPDATE usuario u
-- JOIN proyecto p ON p.id = u.proyecto_principal_id
--    SET u.correo_gestionado_proyecto = 1,
--        u.instancia_id = p.instancia_id
--  WHERE p.dominio IS NOT NULL
--    AND p.instancia_id IS NOT NULL
--    AND LOWER(SUBSTRING_INDEX(u.correo,'@',-1)) = LOWER(p.dominio);
--
-- Las cuentas especiales (soporte/TI/servicio/históricas) pueden dejarse en 0.
-- =====================================================================
