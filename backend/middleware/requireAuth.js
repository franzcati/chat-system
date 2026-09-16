const pool = require("../db");
const {
  verifyAuthSession,
  clearAuthSession,
} = require("../utils/sessionAuth");

async function cargarUsuarioAutenticado(userId) {
  const [rows] = await pool.query(
    `SELECT
        id,
        nombre,
        apellido,
        correo,
        estado,
        rol_id,
        instancia_id
     FROM usuario
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) {
    const error = new Error("Usuario de sesión no encontrado");
    error.status = 401;
    error.code = "AUTH_USER_NOT_FOUND";
    throw error;
  }

  const usuario = rows[0];

  if (String(usuario.estado || "").trim().toLowerCase() !== "aprobado") {
    const error = new Error("La cuenta está desactivada");
    error.status = 403;
    error.code = "AUTH_ACCOUNT_INACTIVE";
    throw error;
  }

  const [permisosRows] = await pool.query(
    `SELECT permiso
     FROM roles_permisos
     WHERE rol_id = ?`,
    [usuario.rol_id]
  );

  const permisos = permisosRows
    .map((row) => String(row.permiso || "").trim())
    .filter(Boolean);

  return {
    id: Number(usuario.id),
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    correo: usuario.correo,
    rol_id: Number(usuario.rol_id),
    instancia_id:
      usuario.instancia_id === null
        ? null
        : Number(usuario.instancia_id),
    permisos,
  };
}

async function requireAuth(req, res, next) {
  try {
    const session = verifyAuthSession(req);
    const usuario = await cargarUsuarioAutenticado(session.userId);

    req.auth = {
      userId: usuario.id,
      usuario,
      permisos: usuario.permisos,
      session: {
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
      },
    };

    next();
  } catch (error) {
    const status = Number(error?.status || 401);

    if (
      error?.code === "SESSION_MISSING" ||
      error?.code === "SESSION_INVALID" ||
      error?.code === "AUTH_USER_NOT_FOUND" ||
      error?.code === "AUTH_ACCOUNT_INACTIVE"
    ) {
      try {
        clearAuthSession(req, res);
      } catch {}
    }

    return res.status(status).json({
      code: error?.code || "AUTH_REQUIRED",
      error:
        status === 403
          ? error.message || "No tienes acceso a esta operación"
          : "Debes iniciar sesión nuevamente",
    });
  }
}

function requirePermission(...requiredPermissions) {
  const required = requiredPermissions
    .flat()
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return function permissionMiddleware(req, res, next) {
    if (!req.auth?.usuario) {
      return res.status(401).json({
        code: "AUTH_REQUIRED",
        error: "Debes iniciar sesión nuevamente",
      });
    }

    if (required.length === 0) {
      return next();
    }

    const actuales = new Set(req.auth.permisos || []);
    const faltantes = required.filter((permiso) => !actuales.has(permiso));

    if (faltantes.length > 0) {
      return res.status(403).json({
        code: "PERMISSION_DENIED",
        error: "No tienes permisos para realizar esta operación",
      });
    }

    next();
  };
}

function requireAnyPermission(...permissions) {
  const required = permissions
    .flat()
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return function anyPermissionMiddleware(req, res, next) {
    if (!req.auth?.usuario) {
      return res.status(401).json({
        code: "AUTH_REQUIRED",
        error: "Debes iniciar sesión nuevamente",
      });
    }

    if (required.length === 0) {
      return next();
    }

    const actuales = new Set(req.auth.permisos || []);
    const permitido = required.some((permiso) => actuales.has(permiso));

    if (!permitido) {
      return res.status(403).json({
        code: "PERMISSION_DENIED",
        error: "No tienes permisos para realizar esta operación",
      });
    }

    next();
  };
}

function hasPermission(req, permission) {
  const permiso = String(permission || "").trim();
  if (!permiso) return false;

  return Array.isArray(req.auth?.permisos)
    && req.auth.permisos.includes(permiso);
}

module.exports = {
  requireAuth,
  requirePermission,
  requireAnyPermission,
  hasPermission,
};
