const fs = require("fs");
const db = require("../db");

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function readField(req, name) {
  if (
    req.body &&
    Object.prototype.hasOwnProperty.call(
      req.body,
      name
    )
  ) {
    return req.body[name];
  }

  if (
    req.query &&
    Object.prototype.hasOwnProperty.call(
      req.query,
      name
    )
  ) {
    return req.query[name];
  }

  return undefined;
}

function removeUploadedFiles(req) {
  const files = [];

  if (req.file) {
    files.push(req.file);
  }

  if (req.files && typeof req.files === "object") {
    Object.values(req.files).forEach((value) => {
      if (Array.isArray(value)) {
        files.push(...value);
      }
    });
  }

  files.forEach((file) => {
    if (!file?.path) return;

    try {
      fs.unlinkSync(file.path);
    } catch {}
  });
}

async function isGroupMember(
  groupId,
  userId
) {
  const grupo = positiveInt(groupId);
  const usuario = positiveInt(userId);

  if (!grupo || !usuario) {
    return false;
  }

  const [rows] = await db.query(
    `SELECT 1
     FROM usuario_grupo
     WHERE grupo_id = ?
       AND usuario_id = ?
     LIMIT 1`,
    [grupo, usuario]
  );

  return rows.length > 0;
}

function requireGroupMembershipParam(
  paramName
) {
  return async function groupParamSecurity(
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

      if (!groupId) {
        return res.status(400).json({
          code: "INVALID_GROUP_ID",
          error: "Grupo inválido",
        });
      }

      if (
        !(await isGroupMember(
          groupId,
          userId
        ))
      ) {
        return res.status(403).json({
          code: "GROUP_ACCESS_DENIED",
          error:
            "No perteneces a este grupo",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando acceso al grupo:",
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

function requireGroupMembershipBody(
  fieldName
) {
  return async function groupBodySecurity(
    req,
    res,
    next
  ) {
    try {
      const groupId = positiveInt(
        req.body?.[fieldName]
      );

      const userId = positiveInt(
        req.auth?.userId
      );

      if (!groupId) {
        return res.status(400).json({
          code: "INVALID_GROUP_ID",
          error: "Grupo inválido",
        });
      }

      if (
        !(await isGroupMember(
          groupId,
          userId
        ))
      ) {
        return res.status(403).json({
          code: "GROUP_ACCESS_DENIED",
          error:
            "No perteneces a este grupo",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando acceso al grupo:",
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

async function requireGroupUploadAccess(
  req,
  res,
  next
) {
  try {
    const groupId = positiveInt(
      req.query?.grupo_id
    );

    const userId = positiveInt(
      req.auth?.userId
    );

    if (!groupId) {
      return res.status(400).json({
        code: "INVALID_GROUP_ID",
        error:
          "Falta grupo_id válido en la solicitud",
      });
    }

    if (
      !(await isGroupMember(
        groupId,
        userId
      ))
    ) {
      return res.status(403).json({
        code: "GROUP_ACCESS_DENIED",
        error:
          "No perteneces a este grupo",
      });
    }

    next();
  } catch (error) {
    console.error(
      "Error validando subida de grupo:",
      error
    );

    res.status(500).json({
      code: "GROUP_UPLOAD_SECURITY_ERROR",
      error:
        "No se pudo validar el grupo",
    });
  }
}

function requireGroupMessageParam(
  messageParam,
  groupParam = null
) {
  return async function groupMessageParamSecurity(
    req,
    res,
    next
  ) {
    try {
      const messageId = positiveInt(
        req.params?.[messageParam]
      );

      const userId = positiveInt(
        req.auth?.userId
      );

      if (!messageId) {
        return res.status(400).json({
          code: "INVALID_GROUP_MESSAGE_ID",
          error:
            "Mensaje de grupo inválido",
        });
      }

      const expectedGroupId = groupParam
        ? positiveInt(
            req.params?.[groupParam]
          )
        : null;

      const params = [
        messageId,
        userId,
      ];

      let groupClause = "";

      if (expectedGroupId) {
        groupClause =
          " AND mg.grupo_id = ?";
        params.push(expectedGroupId);
      }

      const [rows] = await db.query(
        `SELECT mg.id
         FROM mensajes_grupo mg
         JOIN usuario_grupo ug
           ON ug.grupo_id = mg.grupo_id
          AND ug.usuario_id = ?
         WHERE mg.id = ?
         ${groupClause}
         LIMIT 1`,
        groupClause
          ? [
              userId,
              messageId,
              expectedGroupId,
            ]
          : [
              userId,
              messageId,
            ]
      );

      if (!rows.length) {
        return res.status(403).json({
          code:
            "GROUP_MESSAGE_ACCESS_DENIED",
          error:
            "No tienes acceso a este mensaje de grupo",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando mensaje de grupo:",
        error
      );

      res.status(500).json({
        code:
          "GROUP_MESSAGE_SECURITY_ERROR",
        error:
          "No se pudo validar el mensaje",
      });
    }
  };
}

function requireGroupMessageBody(
  fieldName
) {
  return async function groupMessageBodySecurity(
    req,
    res,
    next
  ) {
    try {
      const messageId = positiveInt(
        req.body?.[fieldName]
      );

      const userId = positiveInt(
        req.auth?.userId
      );

      if (!messageId) {
        return res.status(400).json({
          code: "INVALID_GROUP_MESSAGE_ID",
          error:
            "Mensaje de grupo inválido",
        });
      }

      const [rows] = await db.query(
        `SELECT mg.id
         FROM mensajes_grupo mg
         JOIN usuario_grupo ug
           ON ug.grupo_id = mg.grupo_id
          AND ug.usuario_id = ?
         WHERE mg.id = ?
         LIMIT 1`,
        [userId, messageId]
      );

      if (!rows.length) {
        return res.status(403).json({
          code:
            "GROUP_MESSAGE_ACCESS_DENIED",
          error:
            "No tienes acceso a este mensaje de grupo",
        });
      }

      next();
    } catch (error) {
      console.error(
        "Error validando mensaje de grupo:",
        error
      );

      res.status(500).json({
        code:
          "GROUP_MESSAGE_SECURITY_ERROR",
        error:
          "No se pudo validar el mensaje",
      });
    }
  };
}

async function validateGroupReply(
  req,
  res,
  next
) {
  try {
    const replyId = positiveInt(
      readField(req, "replyToId")
    );

    if (!replyId) {
      return next();
    }

    const groupId =
      positiveInt(
        req.body?.grupoId
      ) ||
      positiveInt(
        req.body?.grupo_id
      ) ||
      positiveInt(
        req.query?.grupo_id
      );

    const userId = positiveInt(
      req.auth?.userId
    );

    if (!groupId) {
      removeUploadedFiles(req);

      return res.status(400).json({
        code: "INVALID_GROUP_ID",
        error: "Grupo inválido",
      });
    }

    const [rows] = await db.query(
      `SELECT mg.id
       FROM mensajes_grupo mg
       JOIN usuario_grupo ug
         ON ug.grupo_id = mg.grupo_id
        AND ug.usuario_id = ?
       WHERE mg.id = ?
         AND mg.grupo_id = ?
       LIMIT 1`,
      [
        userId,
        replyId,
        groupId,
      ]
    );

    if (!rows.length) {
      removeUploadedFiles(req);

      return res.status(403).json({
        code:
          "GROUP_REPLY_ACCESS_DENIED",
        error:
          "No tienes acceso al mensaje citado",
      });
    }

    next();
  } catch (error) {
    removeUploadedFiles(req);

    console.error(
      "Error validando respuesta de grupo:",
      error
    );

    res.status(500).json({
      code: "GROUP_REPLY_SECURITY_ERROR",
      error:
        "No se pudo validar el mensaje citado",
    });
  }
}

async function validatePinnedGroupMessage(
  req,
  res,
  next
) {
  try {
    const groupId = positiveInt(
      req.body?.grupo_id
    );

    const messageId = positiveInt(
      req.body?.mensaje_id
    );

    const userId = positiveInt(
      req.auth?.userId
    );

    if (!groupId || !messageId) {
      return res.status(400).json({
        code: "INVALID_GROUP_MESSAGE",
        error:
          "Grupo o mensaje inválido",
      });
    }

    const [rows] = await db.query(
      `SELECT mg.id
       FROM mensajes_grupo mg
       JOIN usuario_grupo ug
         ON ug.grupo_id = mg.grupo_id
        AND ug.usuario_id = ?
       WHERE mg.id = ?
         AND mg.grupo_id = ?
       LIMIT 1`,
      [
        userId,
        messageId,
        groupId,
      ]
    );

    if (!rows.length) {
      return res.status(403).json({
        code:
          "GROUP_MESSAGE_ACCESS_DENIED",
        error:
          "No tienes acceso a este mensaje",
      });
    }

    next();
  } catch (error) {
    console.error(
      "Error validando mensaje fijado:",
      error
    );

    res.status(500).json({
      code:
        "GROUP_MESSAGE_SECURITY_ERROR",
      error:
        "No se pudo validar el mensaje",
    });
  }
}

module.exports = {
  requireGroupMembershipParam,
  requireGroupMembershipBody,
  requireGroupUploadAccess,
  requireGroupMessageParam,
  requireGroupMessageBody,
  validateGroupReply,
  validatePinnedGroupMessage,
};
