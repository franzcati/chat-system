-- QuickChat - Gestión de roles y permisos (2026-09-27)
-- Migración aditiva: no elimina usuarios, roles ni permisos existentes.
-- Compatible con MySQL 8 / MariaDB recientes.

-- Las columnas se agregan de forma idempotente sin depender de ADD COLUMN IF NOT EXISTS,
-- para mantener compatibilidad tanto con MySQL como con MariaDB.
SET @db_name := DATABASE();

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='roles' AND COLUMN_NAME='descripcion'),
  'SELECT 1',
  'ALTER TABLE roles ADD COLUMN descripcion VARCHAR(255) NULL AFTER nombre'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='roles' AND COLUMN_NAME='alcance_admin'),
  'SELECT 1',
  'ALTER TABLE roles ADD COLUMN alcance_admin ENUM(''organizacion'',''proyectos'') NOT NULL DEFAULT ''proyectos'' AFTER descripcion'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='roles' AND COLUMN_NAME='estado'),
  'SELECT 1',
  'ALTER TABLE roles ADD COLUMN estado ENUM(''activo'',''inactivo'') NOT NULL DEFAULT ''activo'' AFTER alcance_admin'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='roles' AND COLUMN_NAME='es_sistema'),
  'SELECT 1',
  'ALTER TABLE roles ADD COLUMN es_sistema TINYINT(1) NOT NULL DEFAULT 0 AFTER estado'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='roles' AND COLUMN_NAME='creado_en'),
  'SELECT 1',
  'ALTER TABLE roles ADD COLUMN creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER es_sistema'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS roles_asignables (
  rol_origen_id INT NOT NULL,
  rol_destino_id INT NOT NULL,
  PRIMARY KEY (rol_origen_id, rol_destino_id),
  CONSTRAINT fk_roles_asignables_origen FOREIGN KEY (rol_origen_id) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_roles_asignables_destino FOREIGN KEY (rol_destino_id) REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE roles SET es_sistema = 1 WHERE LOWER(nombre) IN ('admin','mod','helper','user');
UPDATE roles SET alcance_admin = 'organizacion' WHERE LOWER(nombre) = 'admin';
UPDATE roles SET alcance_admin = 'proyectos' WHERE LOWER(nombre) IN ('mod','helper','user');

UPDATE roles SET descripcion = 'Acceso total al sistema. Puede gestionar usuarios, proyectos, permisos y configuraciones.' WHERE LOWER(nombre)='admin' AND (descripcion IS NULL OR descripcion='');
UPDATE roles SET descripcion = 'Administración delegada y moderación sobre los proyectos autorizados.' WHERE LOWER(nombre)='mod' AND (descripcion IS NULL OR descripcion='');
UPDATE roles SET descripcion = 'Soporte y moderación limitada en los proyectos asignados.' WHERE LOWER(nombre)='helper' AND (descripcion IS NULL OR descripcion='');
UPDATE roles SET descripcion = 'Acceso estándar al chat en los proyectos asignados.' WHERE LOWER(nombre)='user' AND (descripcion IS NULL OR descripcion='');

-- Permisos administrativos nuevos. INSERT IGNORE conserva lo que ya exista.
INSERT INTO roles_permisos (rol_id, permiso)
SELECT id, p.permiso FROM roles
JOIN (
  SELECT 'ver_usuarios' permiso UNION ALL
  SELECT 'crear_usuarios' UNION ALL
  SELECT 'editar_usuarios' UNION ALL
  SELECT 'editar_usuarios_lote' UNION ALL
  SELECT 'gestionar_permisos_chat' UNION ALL
  SELECT 'asignar_roles' UNION ALL
  SELECT 'eliminar_usuarios' UNION ALL
  SELECT 'gestionar_proyectos_usuario' UNION ALL
  SELECT 'gestionar_roles' UNION ALL
  SELECT 'crear_roles' UNION ALL
  SELECT 'editar_roles' UNION ALL
  SELECT 'eliminar_roles' UNION ALL
  SELECT 'crear_proyectos' UNION ALL
  SELECT 'editar_proyectos' UNION ALL
  SELECT 'eliminar_proyectos' UNION ALL
  SELECT 'gestionar_mfa' UNION ALL
  SELECT 'chat_crear_grupos' UNION ALL
  SELECT 'chat_enviar_audios' UNION ALL
  SELECT 'chat_editar_mensajes' UNION ALL
  SELECT 'chat_eliminar_mensajes' UNION ALL
  SELECT 'chat_buscar_mensajes' UNION ALL
  SELECT 'chat_eliminar_cualquier_mensaje'
) p ON 1=1
WHERE LOWER(roles.nombre)='admin'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=roles.id AND rp.permiso=p.permiso);

-- Valores iniciales conservadores para MOD (no se borran permisos preexistentes).
INSERT INTO roles_permisos (rol_id, permiso)
SELECT id, p.permiso FROM roles
JOIN (
  SELECT 'ver_usuarios' permiso UNION ALL
  SELECT 'crear_usuarios' UNION ALL
  SELECT 'editar_usuarios' UNION ALL
  SELECT 'editar_usuarios_lote' UNION ALL
  SELECT 'gestionar_permisos_chat' UNION ALL
  SELECT 'asignar_roles' UNION ALL
  SELECT 'gestionar_proyectos_usuario' UNION ALL
  SELECT 'gestionar_roles' UNION ALL
  SELECT 'chat_crear_grupos' UNION ALL
  SELECT 'chat_enviar_audios' UNION ALL
  SELECT 'chat_editar_mensajes' UNION ALL
  SELECT 'chat_eliminar_mensajes' UNION ALL
  SELECT 'chat_buscar_mensajes' UNION ALL
  SELECT 'chat_eliminar_cualquier_mensaje'
) p ON 1=1
WHERE LOWER(roles.nombre)='mod'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=roles.id AND rp.permiso=p.permiso);

-- Helper: soporte/moderación sin administración peligrosa.
INSERT INTO roles_permisos (rol_id, permiso)
SELECT id, p.permiso FROM roles
JOIN (
  SELECT 'chat_enviar_audios' permiso UNION ALL
  SELECT 'chat_buscar_mensajes'
) p ON 1=1
WHERE LOWER(roles.nombre)='helper'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=roles.id AND rp.permiso=p.permiso);

-- User: permisos básicos de chat. No agrega permisos administrativos.
INSERT INTO roles_permisos (rol_id, permiso)
SELECT id, p.permiso FROM roles
JOIN (
  SELECT 'chat_enviar_audios' permiso
) p ON 1=1
WHERE LOWER(roles.nombre)='user'
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=roles.id AND rp.permiso=p.permiso);

-- Admin puede asignar todos los roles.
INSERT IGNORE INTO roles_asignables (rol_origen_id, rol_destino_id)
SELECT a.id, d.id FROM roles a CROSS JOIN roles d WHERE LOWER(a.nombre)='admin';

-- Mod puede asignar helper y user inicialmente.
INSERT IGNORE INTO roles_asignables (rol_origen_id, rol_destino_id)
SELECT o.id, d.id FROM roles o CROSS JOIN roles d
WHERE LOWER(o.nombre)='mod' AND LOWER(d.nombre) IN ('helper','user');

-- Sincroniza los permisos de chat del rol con el JSON por usuario.
-- JSON_VALID evita que un valor heredado inválido bloquee toda la migración.
UPDATE usuario u
JOIN roles r ON r.id = u.rol_id
SET u.permisos_chat = JSON_SET(
  CASE WHEN JSON_VALID(COALESCE(u.permisos_chat, '{}')) THEN COALESCE(u.permisos_chat, '{}') ELSE '{}' END,
  '$.crear_grupos', IF(EXISTS(SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='chat_crear_grupos'), 1, 0),
  '$.enviar_audios', IF(EXISTS(SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='chat_enviar_audios'), 1, 0),
  '$.editar_mensajes', IF(EXISTS(SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='chat_editar_mensajes'), 1, 0),
  '$.eliminar_mensajes', IF(EXISTS(SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='chat_eliminar_mensajes'), 1, 0),
  '$.buscar_mensajes', IF(EXISTS(SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='chat_buscar_mensajes'), 1, 0),
  '$.eliminar_cualquier_mensaje', IF(EXISTS(SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='chat_eliminar_cualquier_mensaje'), 1, 0)
);
