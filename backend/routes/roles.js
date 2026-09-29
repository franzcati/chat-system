const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireAnyPermission, requirePermission } = require('../middleware/requireAuth');
const { resolveInstance } = require('../middleware/resolveInstance');
const { getAssignableRoles, getActorPolicy, canAssignRole } = require('../utils/roleAccess');

const ADMIN_PERMISSIONS = [
  'ver_usuarios','crear_usuarios','editar_usuarios','editar_usuarios_lote',
  'gestionar_permisos_chat','asignar_roles','eliminar_usuarios','gestionar_proyectos_usuario',
];
const CHAT_ROLE_KEYS = [
  'chat_crear_grupos','chat_enviar_audios','chat_editar_mensajes',
  'chat_eliminar_mensajes','chat_buscar_mensajes','chat_eliminar_cualquier_mensaje',
];
const ROLE_MANAGEMENT_PERMISSIONS = ['gestionar_roles','crear_roles','editar_roles','eliminar_roles'];
const AUDIT_ROLE_KEYS = [
  'ver_registros','ver_registros_admin','ver_registros_chat','ver_registros_grupo',
  'ver_registros_seguridad','ver_blacklist','gestionar_blacklist','exportar_registros',
];

const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const normalizeList = (value) => [...new Set((Array.isArray(value) ? value : []).map(v => String(v || '').trim()).filter(Boolean))];


async function canManageRoleDefinition(req, role, db = pool) {
  const policy = await getActorPolicy(req, db);
  if (!policy) return false;
  if (policy.isAdmin) return true;
  if (Number(role?.es_sistema || 0) === 1) return false;
  return canAssignRole(req, Number(role?.id), db);
}

router.use(requireAuth, resolveInstance);

// Catálogo general: necesario para filtros y etiquetas. Requiere sesión.
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, descripcion, alcance_admin, estado, es_sistema
         FROM roles ORDER BY id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo roles:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/assignable', requireAnyPermission(['crear_usuarios','editar_usuarios','editar_usuarios_lote','asignar_roles']), async (req, res) => {
  try {
    const roles = await getAssignableRoles(req);
    res.json({ roles });
  } catch (error) {
    console.error('Error cargando roles asignables:', error);
    res.status(500).json({ error: 'No se pudieron cargar los roles asignables' });
  }
});

router.get('/manage', requireAnyPermission(ROLE_MANAGEMENT_PERMISSIONS), async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);
    const [roles] = await pool.query(
      `SELECT r.id, r.nombre, r.descripcion, r.alcance_admin, r.estado, r.es_sistema, r.creado_en,
              COUNT(DISTINCT u.id) AS usuarios_asignados
         FROM roles r
         LEFT JOIN usuario u ON u.rol_id = r.id AND u.instancia_id = ? AND u.estado = 'aprobado'
        GROUP BY r.id, r.nombre, r.descripcion, r.alcance_admin, r.estado, r.es_sistema, r.creado_en
        ORDER BY r.es_sistema DESC, r.id ASC`,
      [instanciaId]
    );
    const [permissions] = await pool.query(`SELECT rol_id, permiso FROM roles_permisos ORDER BY rol_id, permiso`);
    const byRole = new Map();
    for (const row of permissions) {
      const id = Number(row.rol_id);
      if (!byRole.has(id)) byRole.set(id, []);
      byRole.get(id).push(String(row.permiso));
    }
    const result = roles.map((role) => ({
      ...role,
      id: Number(role.id),
      usuarios_asignados: Number(role.usuarios_asignados || 0),
      permisos: byRole.get(Number(role.id)) || [],
    }));
    res.json({
      roles: result,
      resumen: {
        roles: result.length,
        usuarios_asignados: result.reduce((sum, role) => sum + role.usuarios_asignados, 0),
        roles_globales: result.filter((r) => r.alcance_admin === 'organizacion').length,
        roles_proyecto: result.filter((r) => r.alcance_admin === 'proyectos').length,
      },
    });
  } catch (error) {
    console.error('Error cargando gestión de roles:', error);
    res.status(500).json({ error: 'No se pudo cargar la gestión de roles' });
  }
});

router.get('/manage/:id', requireAnyPermission(ROLE_MANAGEMENT_PERMISSIONS), async (req, res) => {
  try {
    const roleId = toInt(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Rol inválido' });
    const instanciaId = Number(req.instanciaActual.id);
    const [roleRows] = await pool.query(
      `SELECT id, nombre, descripcion, alcance_admin, estado, es_sistema, creado_en FROM roles WHERE id=? LIMIT 1`,
      [roleId]
    );
    if (!roleRows.length) return res.status(404).json({ error: 'Rol no encontrado' });
    const [permissionRows] = await pool.query(`SELECT permiso FROM roles_permisos WHERE rol_id=? ORDER BY permiso`, [roleId]);
    const [assignableRows] = await pool.query(`SELECT rol_destino_id FROM roles_asignables WHERE rol_origen_id=? ORDER BY rol_destino_id`, [roleId]);
    const [users] = await pool.query(
      `SELECT id, nombre, apellido, correo, url_imagen, background
         FROM usuario
        WHERE rol_id=? AND instancia_id=? AND estado='aprobado'
        ORDER BY nombre, apellido, id`,
      [roleId, instanciaId]
    );
    res.json({
      role: { ...roleRows[0], id: Number(roleRows[0].id) },
      permissions: permissionRows.map((r) => String(r.permiso)),
      assignable_role_ids: assignableRows.map((r) => Number(r.rol_destino_id)),
      users: users.map((u) => ({ ...u, id: Number(u.id) })),
    });
  } catch (error) {
    console.error('Error cargando rol:', error);
    res.status(500).json({ error: 'No se pudo cargar el rol' });
  }
});

router.post('/manage', requirePermission('crear_roles'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const nombre = String(req.body?.nombre || '').trim().toLowerCase();
    const descripcion = String(req.body?.descripcion || '').trim().slice(0, 255);
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(nombre)) {
      return res.status(400).json({ error: 'El nombre del rol debe tener 2 a 32 caracteres y usar letras, números, guion o guion bajo' });
    }
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO roles (nombre, descripcion, alcance_admin, estado, es_sistema) VALUES (?, ?, 'proyectos', 'activo', 0)`,
      [nombre, descripcion || null]
    );
    await connection.commit();
    res.status(201).json({ success: true, role_id: Number(result.insertId) });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    console.error('Error creando rol:', error);
    res.status(500).json({ error: 'No se pudo crear el rol' });
  } finally { connection.release(); }
});

router.put('/manage/:id', requirePermission('editar_roles'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const roleId = toInt(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Rol inválido' });
    await connection.beginTransaction();
    const [roleRows] = await connection.query(`SELECT * FROM roles WHERE id=? LIMIT 1 FOR UPDATE`, [roleId]);
    if (!roleRows.length) { await connection.rollback(); return res.status(404).json({ error: 'Rol no encontrado' }); }
    const role = roleRows[0];
    const actorPolicy = await getActorPolicy(req, connection);
    if (!actorPolicy || !(await canManageRoleDefinition(req, role, connection))) {
      await connection.rollback();
      return res.status(403).json({ code: 'ROLE_SCOPE_DENIED', error: 'No puedes modificar este rol' });
    }
    const isAdmin = String(role.nombre).toLowerCase() === 'admin';
    const requestedGlobal = req.body?.alcance_admin === 'organizacion';
    const alcance = isAdmin
      ? 'organizacion'
      : (requestedGlobal && actorPolicy.scope === 'organizacion' ? 'organizacion' : 'proyectos');
    const estado = isAdmin ? 'activo' : (req.body?.estado === 'inactivo' ? 'inactivo' : 'activo');
    const descripcion = String(req.body?.descripcion ?? role.descripcion ?? '').trim().slice(0, 255);

    let permissions = normalizeList(req.body?.permissions);
    if (isAdmin) {
      const mandatory = [...ADMIN_PERMISSIONS, ...CHAT_ROLE_KEYS, ...AUDIT_ROLE_KEYS, 'gestionar_roles','crear_roles','editar_roles','eliminar_roles','crear_proyectos','editar_proyectos','eliminar_proyectos','gestionar_mfa'];
      permissions = [...new Set([...permissions, ...mandatory])];
    }
    const allowedPrefixes = new Set([...ADMIN_PERMISSIONS, ...CHAT_ROLE_KEYS, ...AUDIT_ROLE_KEYS, 'gestionar_roles','crear_roles','editar_roles','eliminar_roles','crear_proyectos','editar_proyectos','eliminar_proyectos','gestionar_mfa']);
    permissions = permissions.filter((p) => allowedPrefixes.has(p));
    // Un editor no administrador nunca puede conceder capacidades que él mismo no posee.
    if (!actorPolicy.isAdmin) {
      const actorPermissions = new Set(req.auth?.permisos || []);
      permissions = permissions.filter((permission) => actorPermissions.has(permission));
    }

    let assignable = [...new Set((Array.isArray(req.body?.assignable_role_ids) ? req.body.assignable_role_ids : []).map(toInt).filter(Boolean))];
    if (isAdmin) {
      const [allRoles] = await connection.query(`SELECT id FROM roles WHERE estado='activo'`);
      assignable = allRoles.map((r) => Number(r.id));
    } else if (!actorPolicy.isAdmin) {
      const safeAssignable = [];
      for (const destId of assignable) {
        if (await canAssignRole(req, destId, connection)) safeAssignable.push(destId);
      }
      assignable = safeAssignable;
    }

    await connection.query(`UPDATE roles SET descripcion=?, alcance_admin=?, estado=? WHERE id=?`, [descripcion || null, alcance, estado, roleId]);
    await connection.query(`DELETE FROM roles_permisos WHERE rol_id=? AND permiso IN (?)`, [roleId, [...ADMIN_PERMISSIONS, ...CHAT_ROLE_KEYS, ...AUDIT_ROLE_KEYS, 'gestionar_roles','crear_roles','editar_roles','eliminar_roles','crear_proyectos','editar_proyectos','eliminar_proyectos','gestionar_mfa']]);
    for (const permission of permissions) {
      await connection.query(`INSERT IGNORE INTO roles_permisos (rol_id, permiso) VALUES (?, ?)`, [roleId, permission]);
    }
    await connection.query(`DELETE FROM roles_asignables WHERE rol_origen_id=?`, [roleId]);
    for (const destId of assignable) {
      await connection.query(`INSERT IGNORE INTO roles_asignables (rol_origen_id, rol_destino_id) VALUES (?, ?)`, [roleId, destId]);
    }

    const chatMap = {
      crear_grupos: permissions.includes('chat_crear_grupos') ? 1 : 0,
      enviar_audios: permissions.includes('chat_enviar_audios') ? 1 : 0,
      editar_mensajes: permissions.includes('chat_editar_mensajes') ? 1 : 0,
      eliminar_mensajes: permissions.includes('chat_eliminar_mensajes') ? 1 : 0,
      buscar_mensajes: permissions.includes('chat_buscar_mensajes') ? 1 : 0,
      eliminar_cualquier_mensaje: permissions.includes('chat_eliminar_cualquier_mensaje') ? 1 : 0,
    };
    const [affectedUsers] = await connection.query(`SELECT id, permisos_chat FROM usuario WHERE rol_id=?`, [roleId]);
    for (const user of affectedUsers) {
      let current = {};
      try { current = typeof user.permisos_chat === 'string' ? JSON.parse(user.permisos_chat || '{}') : (user.permisos_chat || {}); } catch { current = {}; }
      await connection.query(`UPDATE usuario SET permisos_chat=? WHERE id=?`, [JSON.stringify({ ...current, ...chatMap }), user.id]);
    }
    const [finalPermissionRows] = await connection.query(`SELECT permiso FROM roles_permisos WHERE rol_id=? ORDER BY permiso`, [roleId]);
    const finalPermissions = finalPermissionRows.map((row) => String(row.permiso));
    await connection.commit();

    const socketUtils = req.app.get('socketUtils');
    if (socketUtils?.enviarEventoAlUsuario) {
      for (const user of affectedUsers) {
        socketUtils.enviarEventoAlUsuario(Number(user.id), 'rolUsuarioActualizado', {
          usuarioId: Number(user.id), rol_id: roleId, rol_permisos: finalPermissions, permisos_chat: chatMap,
        });
      }
    }
    res.json({ success: true, usuarios_actualizados: affectedUsers.length });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    console.error('Error actualizando rol:', error);
    res.status(500).json({ error: 'No se pudo actualizar el rol' });
  } finally { connection.release(); }
});

router.delete('/manage/:id', requirePermission('eliminar_roles'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const roleId = toInt(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Rol inválido' });
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT id, nombre, es_sistema FROM roles WHERE id=? LIMIT 1 FOR UPDATE`, [roleId]);
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Rol no encontrado' }); }
    if (!(await canManageRoleDefinition(req, rows[0], connection))) {
      await connection.rollback();
      return res.status(403).json({ code: 'ROLE_SCOPE_DENIED', error: 'No puedes eliminar este rol' });
    }
    if (Number(rows[0].es_sistema) === 1) { await connection.rollback(); return res.status(409).json({ error: 'Los roles del sistema no se pueden eliminar' }); }
    const [counts] = await connection.query(`SELECT COUNT(*) total FROM usuario WHERE rol_id=? AND estado='aprobado'`, [roleId]);
    if (Number(counts[0]?.total || 0) > 0) { await connection.rollback(); return res.status(409).json({ error: 'No puedes eliminar un rol que todavía tiene usuarios asignados' }); }
    await connection.query(`DELETE FROM roles WHERE id=?`, [roleId]);
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    try { await connection.rollback(); } catch {}
    console.error('Error eliminando rol:', error);
    res.status(500).json({ error: 'No se pudo eliminar el rol' });
  } finally { connection.release(); }
});

module.exports = router;
