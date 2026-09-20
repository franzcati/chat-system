const fs = require("fs");
const db = require("../db");

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function removeUploadedFile(req) {
  if (!req.file?.path) return;

  try {
    fs.unlinkSync(req.file.path);
  } catch {}
}

function parseMemberIds(value) {
  let parsed = value;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return [
    ...new Set(
      parsed
        .map((item) => {
          if (
            item &&
            typeof item === "object"
          ) {
            return positiveInt(item.id);
          }

          return positiveInt(item);
        })
        .filter(Boolean)
    ),
  ];
}

function normalizeChatPermissions(value) {
  let parsed = value || {};

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return {};
  }

  return parsed;
}

async function requireCanCreateGroup(
  req,
  res,
  next
) {
  try {
    const userId = positiveInt(
      req.auth?.userId
    );

    const instanceId = positiveInt(
      req.instanciaActual?.id
    );

    const [rows] = await db.query(
      `SELECT permisos_chat
       FROM usuario
       WHERE id = ?
         AND instancia_id = ?
         AND estado = 'aprobado'
       LIMIT 1`,
      [userId, instanceId]
    );

    if (!rows.length) {
      return res.status(403).json({
        code: "GROUP_CREATE_DENIED",
        error:
          "No tienes acceso para crear grupos",
      });
    }

    const permisos =
      normalizeChatPermissions(
        rows[0].permisos_chat
      );

    const allowed =
      permisos.crear_grupos === 1 ||
      permisos.crear_grupos === "1" ||
      permisos.crear_grupos === true ||
      permisos.crear_grupos === "true";

    if (!allowed) {
      return res.status(403).json({
        code: "GROUP_CREATE_DENIED",
        error:
          "No tienes permiso para crear grupos",
      });
    }

    next();
  } catch (error) {
    console.error(
      "Error validando creacion de grupo:",
      error
    );

    res.status(500).json({
      code: "GROUP_SECURITY_ERROR",
      error:
        "No se pudo validar la creacion del grupo",
    });
  }
}

function requireSelfParam(paramName) {
  return function selfParamSecurity(
    req,
    res,
    next
  ) {
    const requestedId = positiveInt(
      req.params?.[paramName]
    );

    const authId = positiveInt(
      req.auth?.userId
    );

    if (!requestedId) {
      return res.status(400).json({
        code: "INVALID_USER_ID",
        error: "Usuario invalido",
      });
    }

    if (requestedId !== authId) {
      return res.status(403).json({
        code: "ACTOR_ID_MISMATCH",
        error:
          "El usuario solicitado no corresponde a la sesion",
      });
    }

    next();
  };
}

function requireProjectAccess(paramName) {
  return async function projectSecurity(
    req,
    res,
    next
  ) {
    try {
      const projectId = positiveInt(
        req.params?.[paramName]
      );

      const userId = positiveInt(
        req.auth?.userId
      );

      const instanceId = positiveInt(
        req.instanciaActual?.id
      );

      if (!projectId) {
        return res.status(400).json({
          code: "INVALID_PROJECT_ID",
          error: "Proyecto invalido",
        });
      }

      const [rows] = await db.query(
        `SELECT p.id
         FROM proyecto p
         JOIN usuario_proyecto up
           ON up.proyecto_id = p.id
          AND up.usuario_id = ?
         WHERE p.id = ?
           AND p.instancia_id = ?
         LIMIT 1`,
        [
          userId,
          projectId,
          instanceId,
        ]
      );

      if (!rows.length) {
        return res.status(403).json({
          code: "PROJECT_ACCESS_DENIED",
          error:
            "No tienes acceso a este proyecto",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando proyecto:",
        error
      );

      res.status(500).json({
        code: "PROJECT_SECURITY_ERROR",
        error:
          "No se pudo validar el proyecto",
      });
    }
  };
}

function requireGroupRoleParam(
  paramName,
  allowedRoles
) {
  return async function groupRoleSecurity(
    req,
    res,
    next
  ) {
    try {
      const groupId = positiveInt(
        req.params?.[paramName]
      );

      const userId = positiveInt(
        req.auth?.userId
      );

      const instanceId = positiveInt(
        req.instanciaActual?.id
      );

      if (!groupId) {
        return res.status(400).json({
          code: "INVALID_GROUP_ID",
          error: "Grupo invalido",
        });
      }

      const [rows] = await db.query(
        `SELECT ug.rol
         FROM usuario_grupo ug
         JOIN usuario u
           ON u.id = ug.usuario_id
         WHERE ug.grupo_id = ?
           AND ug.usuario_id = ?
           AND u.instancia_id = ?
         LIMIT 1`,
        [
          groupId,
          userId,
          instanceId,
        ]
      );

      if (!rows.length) {
        return res.status(403).json({
          code: "GROUP_ACCESS_DENIED",
          error:
            "No perteneces a este grupo",
        });
      }

      if (
        Array.isArray(allowedRoles) &&
        allowedRoles.length &&
        !allowedRoles.includes(rows[0].rol)
      ) {
        return res.status(403).json({
          code: "GROUP_ROLE_DENIED",
          error:
            "No tienes permisos para esta accion",
        });
      }

      req.groupRole = rows[0].rol;
      next();
    } catch (error) {
      console.error(
        "Error validando rol de grupo:",
        error
      );

      res.status(500).json({
        code: "GROUP_SECURITY_ERROR",
        error:
          "No se pudo validar el grupo",
      });
    }
  };
}

function validateMemberCandidates(
  allowExistingMembers
) {
  return async function memberSecurity(
    req,
    res,
    next
  ) {
    try {
      const actorId = positiveInt(
        req.auth?.userId
      );

      const instanceId = positiveInt(
        req.instanciaActual?.id
      );

      const requestedIds = parseMemberIds(
        req.body?.miembros
      ).filter(
        (id) => id !== actorId
      );

      if (
        !allowExistingMembers &&
        requestedIds.length === 0
      ) {
        removeUploadedFile(req);

        return res.status(400).json({
          code: "GROUP_MEMBERS_REQUIRED",
          error:
            "Debes seleccionar al menos un miembro",
        });
      }

      let existingIds = new Set();

      if (allowExistingMembers) {
        const groupId = positiveInt(
          req.params?.id
        );

        const [existing] = await db.query(
          `SELECT usuario_id
           FROM usuario_grupo
           WHERE grupo_id = ?`,
          [groupId]
        );

        existingIds = new Set(
          existing.map(
            (row) =>
              Number(row.usuario_id)
          )
        );
      }

      const newIds = requestedIds.filter(
        (id) => !existingIds.has(id)
      );

      if (!newIds.length) {
        return next();
      }

      const [validRows] = await db.query(
        `SELECT DISTINCT u.id
         FROM usuario u
         JOIN usuario_proyecto up_user
           ON up_user.usuario_id = u.id
         JOIN proyecto p
           ON p.id = up_user.proyecto_id
          AND p.instancia_id = ?
         JOIN usuario_proyecto up_actor
           ON up_actor.proyecto_id =
              up_user.proyecto_id
          AND up_actor.usuario_id = ?
         WHERE u.id IN (?)
           AND u.instancia_id = ?
           AND u.estado = 'aprobado'`,
        [
          instanceId,
          actorId,
          newIds,
          instanceId,
        ]
      );

      const validIds = new Set(
        validRows.map(
          (row) => Number(row.id)
        )
      );

      const invalidIds =
        newIds.filter(
          (id) => !validIds.has(id)
        );

      if (invalidIds.length) {
        removeUploadedFile(req);

        return res.status(403).json({
          code:
            "GROUP_MEMBER_INSTANCE_DENIED",
          error:
            "Uno o mas usuarios no pertenecen a este portal o no comparten proyecto contigo",
        });
      }

      next();
    } catch (error) {
      removeUploadedFile(req);

      console.error(
        "Error validando miembros:",
        error
      );

      res.status(500).json({
        code: "GROUP_MEMBER_SECURITY_ERROR",
        error:
          "No se pudieron validar los miembros",
      });
    }
  };
}

async function requireTargetSameInstance(
  req,
  res,
  next
) {
  try {
    const targetId = positiveInt(
      req.body?.nuevoPropietarioId
    );

    const instanceId = positiveInt(
      req.instanciaActual?.id
    );

    if (!targetId) {
      return res.status(400).json({
        code: "INVALID_TARGET_USER",
        error:
          "Nuevo propietario invalido",
      });
    }

    const [rows] = await db.query(
      `SELECT id
       FROM usuario
       WHERE id = ?
         AND instancia_id = ?
         AND estado = 'aprobado'
       LIMIT 1`,
      [
        targetId,
        instanceId,
      ]
    );

    if (!rows.length) {
      return res.status(403).json({
        code:
          "CROSS_INSTANCE_USER_DENIED",
        error:
          "El nuevo propietario no pertenece a este portal",
      });
    }

    next();
  } catch (error) {
    console.error(
      "Error validando nuevo propietario:",
      error
    );

    res.status(500).json({
      code: "TARGET_USER_SECURITY_ERROR",
      error:
        "No se pudo validar el nuevo propietario",
    });
  }
}

module.exports = {
  requireCanCreateGroup,
  requireSelfParam,
  requireProjectAccess,
  requireGroupRoleParam,
  validateCreateGroupMembers:
    validateMemberCandidates(false),
  validateExistingGroupMembers:
    validateMemberCandidates(true),
  requireTargetSameInstance,
};
