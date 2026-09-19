const { requireAuth } = require("./requireAuth");
const { resolveInstance } = require("./resolveInstance");

function requirePortalSessionMatch(req, res, next) {
  const sessionInstanceId = Number(
    req.auth?.usuario?.instancia_id
  );

  const portalInstanceId = Number(
    req.instanciaActual?.id
  );

  if (
    !Number.isInteger(sessionInstanceId) ||
    !Number.isInteger(portalInstanceId) ||
    sessionInstanceId !== portalInstanceId
  ) {
    return res.status(403).json({
      code: "INSTANCE_ACCESS_DENIED",
      error: "La sesion no corresponde a este portal",
    });
  }

  next();
}

const ACTOR_KEYS = [
  "usuarioId",
  "userId",
  "miUsuarioId",
  "sender_id",
  "senderId",
  "usuario_id",
  "usuario_envia_id",
  "propietarioId",
];

function enforceAuthenticatedActor(req, res, next) {
  const authId = Number(req.auth?.userId);

  if (!Number.isInteger(authId) || authId <= 0) {
    return res.status(401).json({
      code: "AUTH_REQUIRED",
      error: "Debes iniciar sesion nuevamente",
    });
  }

  for (const [sourceName, source] of [
    ["body", req.body],
    ["query", req.query],
  ]) {
    if (!source || typeof source !== "object") {
      continue;
    }

    for (const key of ACTOR_KEYS) {
      if (
        !Object.prototype.hasOwnProperty.call(source, key)
      ) {
        continue;
      }

      const raw = source[key];

      if (
        raw === undefined ||
        raw === null ||
        raw === ""
      ) {
        continue;
      }

      const requestedId = Number(raw);

      if (
        !Number.isInteger(requestedId) ||
        requestedId !== authId
      ) {
        return res.status(403).json({
          code: "ACTOR_ID_MISMATCH",
          error:
            `El campo ${key} de ${sourceName} no corresponde al usuario autenticado`,
        });
      }
    }
  }

  next();
}

function requireSelfParam(req, res, next, value, name) {
  const authId = Number(req.auth?.userId);
  const requestedId = Number(value);

  if (
    !Number.isInteger(requestedId) ||
    requestedId <= 0
  ) {
    return res.status(400).json({
      code: "INVALID_USER_ID",
      error: "Usuario invalido",
    });
  }

  if (requestedId !== authId) {
    return res.status(403).json({
      code: "ACTOR_ID_MISMATCH",
      error:
        `El parametro ${name} no corresponde al usuario autenticado`,
    });
  }

  next();
}

const chatAuthMiddleware = [
  requireAuth,
  resolveInstance,
  requirePortalSessionMatch,
];

module.exports = {
  chatAuthMiddleware,
  enforceAuthenticatedActor,
  requireSelfParam,
};
