-- =====================================================================
-- QuickChat / ChatVista - Registros de auditoría + Blacklist
-- Fecha: 2026-09-29
-- Requiere respaldo previo. Migración aditiva e idempotente en tablas.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `registros_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instancia_id` int(11) DEFAULT NULL,
  `categoria` varchar(32) NOT NULL,
  `evento` varchar(96) NOT NULL,
  `actor_usuario_id` int(11) DEFAULT NULL,
  `objetivo_usuario_id` int(11) DEFAULT NULL,
  `proyecto_id` int(11) DEFAULT NULL,
  `chat_usuario_id` int(11) DEFAULT NULL,
  `grupo_id` int(11) DEFAULT NULL,
  `mensaje_id` bigint(20) DEFAULT NULL,
  `accion` varchar(190) NOT NULL,
  `resultado` enum('exitoso','alerta','fallido') NOT NULL DEFAULT 'exitoso',
  `ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `dispositivo` varchar(190) DEFAULT NULL,
  `permiso_utilizado` varchar(96) DEFAULT NULL,
  `valores_anteriores` longtext DEFAULT NULL,
  `valores_nuevos` longtext DEFAULT NULL,
  `metadata` longtext DEFAULT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_reg_inst_fecha` (`instancia_id`,`creado_en`),
  KEY `idx_reg_inst_categoria_fecha` (`instancia_id`,`categoria`,`creado_en`),
  KEY `idx_reg_actor_fecha` (`actor_usuario_id`,`creado_en`),
  KEY `idx_reg_objetivo_fecha` (`objetivo_usuario_id`,`creado_en`),
  KEY `idx_reg_proyecto_fecha` (`proyecto_id`,`creado_en`),
  KEY `idx_reg_evento_fecha` (`evento`,`creado_en`),
  KEY `idx_reg_mensaje` (`mensaje_id`),
  KEY `idx_reg_grupo` (`grupo_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `blacklist_reglas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `instancia_id` int(11) NOT NULL,
  `palabra` varchar(255) NOT NULL,
  `categoria` enum('seguridad','spam','fraude','acoso','contenido_sensible','personalizada') NOT NULL DEFAULT 'personalizada',
  `severidad` enum('baja','media','alta','critica') NOT NULL DEFAULT 'media',
  `aplicar_chats` tinyint(1) NOT NULL DEFAULT 1,
  `aplicar_grupos` tinyint(1) NOT NULL DEFAULT 1,
  `aplicar_administrativos` tinyint(1) NOT NULL DEFAULT 0,
  `proyecto_id` int(11) DEFAULT NULL,
  `coincidencia` enum('exacta','contiene','variaciones') NOT NULL DEFAULT 'exacta',
  `accion` enum('registrar','alerta','notificar') NOT NULL DEFAULT 'registrar',
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `observacion` varchar(300) DEFAULT NULL,
  `creado_por_usuario_id` int(11) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_bl_regla_inst_activa` (`instancia_id`,`activa`),
  KEY `idx_bl_regla_proyecto` (`proyecto_id`),
  KEY `idx_bl_regla_palabra` (`instancia_id`,`palabra`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `blacklist_detecciones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `regla_id` bigint(20) unsigned NOT NULL,
  `instancia_id` int(11) NOT NULL,
  `actor_usuario_id` int(11) DEFAULT NULL,
  `objetivo_usuario_id` int(11) DEFAULT NULL,
  `proyecto_id` int(11) DEFAULT NULL,
  `chat_usuario_id` int(11) DEFAULT NULL,
  `grupo_id` int(11) DEFAULT NULL,
  `mensaje_id` bigint(20) DEFAULT NULL,
  `tipo` enum('chat','grupo','administrativo') NOT NULL,
  `categoria` varchar(32) NOT NULL,
  `palabra_detectada` varchar(255) NOT NULL,
  `coincidencia_texto` varchar(500) DEFAULT NULL,
  `contexto` text DEFAULT NULL,
  `severidad` enum('baja','media','alta','critica') NOT NULL DEFAULT 'media',
  `accion_tomada` enum('registrar','alerta','notificar') NOT NULL DEFAULT 'registrar',
  `estado` enum('registrado','alerta','revisado','resuelto') NOT NULL DEFAULT 'registrado',
  `creado_en` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_bl_det_inst_fecha` (`instancia_id`,`creado_en`),
  KEY `idx_bl_det_inst_sev_fecha` (`instancia_id`,`severidad`,`creado_en`),
  KEY `idx_bl_det_regla` (`regla_id`),
  KEY `idx_bl_det_actor` (`actor_usuario_id`,`creado_en`),
  KEY `idx_bl_det_proyecto` (`proyecto_id`,`creado_en`),
  KEY `idx_bl_det_mensaje` (`mensaje_id`),
  KEY `idx_bl_det_grupo` (`grupo_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nuevos permisos. Por seguridad se habilitan automáticamente sólo al rol admin.
INSERT IGNORE INTO `roles_permisos` (`rol_id`,`permiso`)
SELECT r.id, p.permiso
FROM roles r
JOIN (
  SELECT 'ver_registros' permiso UNION ALL
  SELECT 'ver_registros_admin' UNION ALL
  SELECT 'ver_registros_chat' UNION ALL
  SELECT 'ver_registros_grupo' UNION ALL
  SELECT 'ver_registros_seguridad' UNION ALL
  SELECT 'ver_blacklist' UNION ALL
  SELECT 'gestionar_blacklist' UNION ALL
  SELECT 'exportar_registros'
) p
WHERE LOWER(r.nombre)='admin';
