const pool = require('../db');

const normalizePermissionList = (rows = []) => rows.map((row) => String(row.permiso || '').trim()).filter(Boolean);

async function getRoleById(roleId, db = pool) {
  const [rows] = await db.query(
    `SELECT id, nombre, descripcion, alcance_admin, estado, es_sistema, creado_en
     FROM roles WHERE id = ? LIMIT 1`,
    [Number(roleId)]
  );
  return rows[0] || null;
}

async function getActorPolicy(req, db = pool) {
  const actorId = Number(req.auth?.userId);
  const [rows] = await db.query(
    `SELECT u.id, u.rol_id, r.nombre AS rol_nombre, r.alcance_admin
     FROM usuario u
     JOIN roles r ON r.id = u.rol_id
     WHERE u.id = ? LIMIT 1`,
    [actorId]
  );
  const row = rows[0];
  if (!row) return null;
  const isAdmin = String(row.rol_nombre || '').toLowerCase() === 'admin';
  return {
    userId: Number(row.id),
    roleId: Number(row.rol_id),
    roleName: row.rol_nombre,
    scope: isAdmin ? 'organizacion' : (row.alcance_admin || 'proyectos'),
    isAdmin,
  };
}

async function getActorProjectIds(req, db = pool) {
  const actorId = Number(req.auth?.userId);
  const [rows] = await db.query(`SELECT proyecto_id FROM usuario_proyecto WHERE usuario_id = ?`, [actorId]);
  return rows.map((row) => Number(row.proyecto_id)).filter(Boolean);
}

async function canAccessProject(req, projectId, db = pool) {
  const policy = await getActorPolicy(req, db);
  if (!policy) return false;
  if (policy.scope === 'organizacion') return true;
  const ids = await getActorProjectIds(req, db);
  return ids.includes(Number(projectId));
}

async function canAccessUser(req, targetUserId, db = pool) {
  const policy = await getActorPolicy(req, db);
  if (!policy) return false;
  if (policy.scope === 'organizacion' || Number(targetUserId) === policy.userId) return true;
  const [rows] = await db.query(
    `SELECT 1
       FROM usuario_proyecto actor_up
       JOIN usuario_proyecto target_up ON target_up.proyecto_id = actor_up.proyecto_id
      WHERE actor_up.usuario_id = ? AND target_up.usuario_id = ?
      LIMIT 1`,
    [policy.userId, Number(targetUserId)]
  );
  return rows.length > 0;
}

async function canAssignRole(req, targetRoleId, db = pool) {
  const policy = await getActorPolicy(req, db);
  if (!policy) return false;
  if (policy.isAdmin) return true;
  const [rows] = await db.query(
    `SELECT 1 FROM roles_asignables WHERE rol_origen_id = ? AND rol_destino_id = ? LIMIT 1`,
    [policy.roleId, Number(targetRoleId)]
  );
  return rows.length > 0;
}

async function getAssignableRoles(req, db = pool) {
  const policy = await getActorPolicy(req, db);
  if (!policy) return [];
  const [rows] = policy.isAdmin
    ? await db.query(`SELECT id, nombre, descripcion, alcance_admin, estado, es_sistema FROM roles WHERE estado='activo' ORDER BY id`)
    : await db.query(
      `SELECT r.id, r.nombre, r.descripcion, r.alcance_admin, r.estado, r.es_sistema
         FROM roles_asignables ra JOIN roles r ON r.id = ra.rol_destino_id
        WHERE ra.rol_origen_id = ? AND r.estado='activo' ORDER BY r.id`,
      [policy.roleId]
    );
  return rows;
}

function requireUserScope(paramName = 'id') {
  return async (req, res, next) => {
    try {
      const targetId = Number(req.params?.[paramName] || req.body?.usuario_id);
      if (!targetId || !(await canAccessUser(req, targetId))) {
        return res.status(403).json({ code: 'USER_SCOPE_DENIED', error: 'No tienes acceso a este usuario' });
      }
      next();
    } catch (error) {
      console.error('Error validando alcance de usuario:', error);
      res.status(500).json({ code: 'USER_SCOPE_ERROR', error: 'No se pudo validar el alcance de administración' });
    }
  };
}

async function canManageUser(req, targetUserId, db = pool) {
  const policy = await getActorPolicy(req, db);
  if (!policy) return false;
  if (policy.isAdmin) return true;
  if (!(await canAccessUser(req, targetUserId, db))) return false;
  if (Number(targetUserId) === policy.userId) return true;
  const [rows] = await db.query(`SELECT rol_id FROM usuario WHERE id=? LIMIT 1`, [Number(targetUserId)]);
  if (!rows.length) return false;
  const targetRoleId = Number(rows[0].rol_id);
  const [allowed] = await db.query(
    `SELECT 1 FROM roles_asignables WHERE rol_origen_id=? AND rol_destino_id=? LIMIT 1`,
    [policy.roleId, targetRoleId]
  );
  return allowed.length > 0;
}

async function getRolePermissions(roleId, db = pool) {
  const [rows] = await db.query(`SELECT permiso FROM roles_permisos WHERE rol_id = ? ORDER BY permiso`, [Number(roleId)]);
  return normalizePermissionList(rows);
}

module.exports = {
  getRoleById,
  getActorPolicy,
  getActorProjectIds,
  canAccessProject,
  canAccessUser,
  canManageUser,
  canAssignRole,
  getAssignableRoles,
  requireUserScope,
  getRolePermissions,
};
