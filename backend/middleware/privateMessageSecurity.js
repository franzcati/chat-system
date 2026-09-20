const db = require("../db");

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function readField(req, fieldName) {
  if (
    req.body &&
    Object.prototype.hasOwnProperty.call(
      req.body,
      fieldName
    )
  ) {
    return req.body[fieldName];
  }

  if (
    req.query &&
    Object.prototype.hasOwnProperty.call(
      req.query,
      fieldName
    )
  ) {
    return req.query[fieldName];
  }

  return undefined;
}

async function userInInstance(
  userId,
  instanceId,
  requireActive = false
) {
  const params = [userId, instanceId];

  let sql = `
    SELECT id
    FROM usuario
    WHERE id = ?
      AND instancia_id = ?
  `;

  if (requireActive) {
    sql += " AND estado = 'aprobado'";
  }

  sql += " LIMIT 1";

  const [rows] = await db.query(sql, params);
  return rows.length > 0;
}

async function privateMessageAccessible(
  req,
  messageId
) {
  const authId = positiveInt(req.auth?.userId);
  const instanceId = positiveInt(
    req.instanciaActual?.id
  );
  const id = positiveInt(messageId);

  if (!authId || !instanceId || !id) {
    return false;
  }

  const [rows] = await db.query(
    `SELECT m.id
     FROM mensajes m
     JOIN usuario ue
       ON ue.id = m.usuario_envia_id
     JOIN usuario ur
       ON ur.id = m.usuario_recibe_id
     WHERE m.id = ?
       AND (
         m.usuario_envia_id = ?
         OR m.usuario_recibe_id = ?
       )
       AND ue.instancia_id = ?
       AND ur.instancia_id = ?
     LIMIT 1`,
    [
      id,
      authId,
      authId,
      instanceId,
      instanceId,
    ]
  );

  return rows.length > 0;
}

async function groupMembership(req, groupId) {
  const authId = positiveInt(req.auth?.userId);
  const id = positiveInt(groupId);

  if (!authId || !id) return false;

  const [rows] = await db.query(
    `SELECT 1
     FROM usuario_grupo
     WHERE grupo_id = ?
       AND usuario_id = ?
     LIMIT 1`,
    [id, authId]
  );

  return rows.length > 0;
}

async function requirePrivatePairQuery(
  req,
  res,
  next
) {
  try {
    const authId = positiveInt(req.auth?.userId);
    const instanceId = positiveInt(
      req.instanciaActual?.id
    );

    const usuario1 = positiveInt(
      req.query.usuario1
    );
    const usuario2 = positiveInt(
      req.query.usuario2
    );

    if (!usuario1 || !usuario2) {
      return res.status(400).json({
        code: "INVALID_PRIVATE_CHAT",
        error:
          "Los usuarios del chat son inválidos",
      });
    }

    if (
      authId !== usuario1 &&
      authId !== usuario2
    ) {
      return res.status(403).json({
        code: "PRIVATE_CHAT_ACCESS_DENIED",
        error:
          "No tienes acceso a esta conversación",
      });
    }

    const ids = [...new Set([
      usuario1,
      usuario2,
    ])];

    const [rows] = await db.query(
      `SELECT id
       FROM usuario
       WHERE id IN (?)
         AND instancia_id = ?`,
      [ids, instanceId]
    );

    if (rows.length !== ids.length) {
      return res.status(403).json({
        code: "CROSS_INSTANCE_ACCESS_DENIED",
        error:
          "La conversación no pertenece a este portal",
      });
    }

    next();
  } catch (error) {
    console.error(
      "Error validando chat privado:",
      error
    );

    res.status(500).json({
      code: "PRIVATE_CHAT_SECURITY_ERROR",
      error:
        "No se pudo validar la conversación",
    });
  }
}

function requirePrivateMessageParam(paramName) {
  return async function messageParamSecurity(
    req,
    res,
    next
  ) {
    try {
      const allowed =
        await privateMessageAccessible(
          req,
          req.params[paramName]
        );

      if (!allowed) {
        return res.status(403).json({
          code: "PRIVATE_MESSAGE_ACCESS_DENIED",
          error:
            "No tienes acceso a este mensaje",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando mensaje privado:",
        error
      );

      res.status(500).json({
        code: "PRIVATE_MESSAGE_SECURITY_ERROR",
        error:
          "No se pudo validar el mensaje",
      });
    }
  };
}

function requirePrivateMessageBody(fieldName) {
  return async function messageBodySecurity(
    req,
    res,
    next
  ) {
    try {
      const allowed =
        await privateMessageAccessible(
          req,
          req.body?.[fieldName]
        );

      if (!allowed) {
        return res.status(403).json({
          code: "PRIVATE_MESSAGE_ACCESS_DENIED",
          error:
            "No tienes acceso a este mensaje",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando mensaje privado:",
        error
      );

      res.status(500).json({
        code: "PRIVATE_MESSAGE_SECURITY_ERROR",
        error:
          "No se pudo validar el mensaje",
      });
    }
  };
}

function requireSameInstanceUserField(
  fieldName,
  requireActive = false
) {
  return async function sameInstanceUser(
    req,
    res,
    next
  ) {
    try {
      const userId = positiveInt(
        readField(req, fieldName)
      );

      const instanceId = positiveInt(
        req.instanciaActual?.id
      );

      if (!userId) {
        return res.status(400).json({
          code: "INVALID_TARGET_USER",
          error: "Usuario destino inválido",
        });
      }

      const allowed = await userInInstance(
        userId,
        instanceId,
        requireActive
      );

      if (!allowed) {
        return res.status(403).json({
          code: "CROSS_INSTANCE_USER_DENIED",
          error:
            "El usuario no pertenece a este portal",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando usuario destino:",
        error
      );

      res.status(500).json({
        code: "TARGET_USER_SECURITY_ERROR",
        error:
          "No se pudo validar el usuario destino",
      });
    }
  };
}

async function validateForwardDestinations(
  req,
  res,
  next
) {
  try {
    const instanceId = positiveInt(
      req.instanciaActual?.id
    );

    const destinos = Array.isArray(
      req.body?.destinos
    )
      ? req.body.destinos
      : [];

    for (const destino of destinos) {
      const id = positiveInt(destino?.id);

      if (!id) {
        return res.status(400).json({
          code: "INVALID_FORWARD_TARGET",
          error:
            "Hay un destino de reenvío inválido",
        });
      }

      if (destino?.tipo === "grupo") {
        if (!(await groupMembership(req, id))) {
          return res.status(403).json({
            code: "GROUP_ACCESS_DENIED",
            error:
              "No perteneces al grupo indicado",
          });
        }
      } else {
        const allowed = await userInInstance(
          id,
          instanceId,
          true
        );

        if (!allowed) {
          return res.status(403).json({
            code: "CROSS_INSTANCE_USER_DENIED",
            error:
              "El destinatario no pertenece a este portal",
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error(
      "Error validando reenvío:",
      error
    );

    res.status(500).json({
      code: "FORWARD_SECURITY_ERROR",
      error:
        "No se pudieron validar los destinos",
    });
  }
}

async function validateReplyAccess(
  req,
  res,
  next
) {
  try {
    const replyId = positiveInt(
      readField(req, "replyToId")
    );

    if (!replyId) return next();

    const replyType = String(
      readField(req, "replyToType") || ""
    ).toLowerCase();

    if (replyType === "grupo") {
      const groupId = positiveInt(
        readField(req, "replyToGrupoId")
      );

      if (
        !groupId ||
        !(await groupMembership(req, groupId))
      ) {
        return res.status(403).json({
          code: "GROUP_REPLY_ACCESS_DENIED",
          error:
            "No tienes acceso al mensaje citado",
        });
      }

      const [rows] = await db.query(
        `SELECT id
         FROM mensajes_grupo
         WHERE id = ?
           AND grupo_id = ?
         LIMIT 1`,
        [replyId, groupId]
      );

      if (!rows.length) {
        return res.status(403).json({
          code: "GROUP_REPLY_ACCESS_DENIED",
          error:
            "No tienes acceso al mensaje citado",
        });
      }

      return next();
    }

    if (
      !(await privateMessageAccessible(
        req,
        replyId
      ))
    ) {
      return res.status(403).json({
        code: "PRIVATE_REPLY_ACCESS_DENIED",
        error:
          "No tienes acceso al mensaje citado",
      });
    }

    next();
  } catch (error) {
    console.error(
      "Error validando mensaje citado:",
      error
    );

    res.status(500).json({
      code: "REPLY_SECURITY_ERROR",
      error:
        "No se pudo validar el mensaje citado",
    });
  }
}

module.exports = {
  requirePrivatePairQuery,
  requirePrivateMessageParam,
  requirePrivateMessageBody,
  requireSameInstanceUserField,
  validateForwardDestinations,
  validateReplyAccess,
};
