const db = require("../db");
const {
  verifyAuthSession,
} = require("./sessionAuth");
const {
  resolvePortalFromRequest,
} = require("./portalInstance");

async function authenticateSocket(socket) {
  const request = socket.request;

  const session = verifyAuthSession(request);
  const portal =
    resolvePortalFromRequest(request);

  const [instanceRows] = await db.query(
    `SELECT
       id,
       codigo
     FROM instancia
     WHERE codigo = ?
       AND estado = 'activo'
     LIMIT 1`,
    [portal.code]
  );

  if (!instanceRows.length) {
    const error = new Error(
      "Instancia no configurada"
    );
    error.code =
      "INSTANCE_NOT_CONFIGURED";
    throw error;
  }

  const instanceId = Number(
    instanceRows[0].id
  );

  const [userRows] = await db.query(
    `SELECT
       id,
       estado,
       instancia_id
     FROM usuario
     WHERE id = ?
     LIMIT 1`,
    [session.userId]
  );

  if (!userRows.length) {
    const error = new Error(
      "Usuario de sesion no encontrado"
    );
    error.code =
      "AUTH_USER_NOT_FOUND";
    throw error;
  }

  const user = userRows[0];

  if (
    String(user.estado || "")
      .trim()
      .toLowerCase() !== "aprobado"
  ) {
    const error = new Error(
      "La cuenta esta desactivada"
    );
    error.code =
      "AUTH_ACCOUNT_INACTIVE";
    throw error;
  }

  if (
    Number(user.instancia_id) !==
    instanceId
  ) {
    const error = new Error(
      "La sesion no pertenece a este portal"
    );
    error.code =
      "SOCKET_INSTANCE_MISMATCH";
    throw error;
  }

  return {
    userId: Number(user.id),
    instanceId,
    portalCode: portal.code,
    host: portal.host,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

module.exports = {
  authenticateSocket,
};
