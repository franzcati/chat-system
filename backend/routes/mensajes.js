const express = require("express");
const router = express.Router();
const db = require("../db");
const { logDev } = require("../utils/logger");
const { queryWithRetry } = require("../utils/dbRetry");

function formatDateToMySQL(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}


const MARK_PRIVATE_BATCH_SIZE = 500;
const MARK_PRIVATE_MAX_BATCHES = 20;

async function markPrivateMessagesAsSeen(contactoId, userId) {
  let totalActualizados = 0;

  for (let batch = 0; batch < MARK_PRIVATE_MAX_BATCHES; batch += 1) {
    const [pendientes] = await queryWithRetry(
      db,
      `SELECT id
       FROM mensajes
       WHERE usuario_envia_id = ?
         AND usuario_recibe_id = ?
         AND visto = 0
       ORDER BY id ASC
       LIMIT ?`,
      [contactoId, userId, MARK_PRIVATE_BATCH_SIZE],
      { attempts: 4, label: "seleccionar mensajes privados pendientes" }
    );

    if (!pendientes.length) break;

    const ids = pendientes.map((mensaje) => mensaje.id);
    const [result] = await queryWithRetry(
      db,
      `UPDATE mensajes
       SET visto = 1
       WHERE id IN (?)`,
      [ids],
      { attempts: 4, label: "marcar mensajes privados como vistos" }
    );

    totalActualizados += result.affectedRows || 0;

    if (pendientes.length < MARK_PRIVATE_BATCH_SIZE) break;
  }

  return totalActualizados;
}

function getPaginationOptions(query) {
  const paginated =
    query.paginated === "1" ||
    query.paginado === "1" ||
    query.limit !== undefined ||
    query.beforeId !== undefined;

  const parsedLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 80)
    : 50;

  const parsedBeforeId = Number.parseInt(query.beforeId, 10);
  const beforeId =
    Number.isFinite(parsedBeforeId) && parsedBeforeId > 0 ? parsedBeforeId : null;

  return { paginated, limit, beforeId };
}

let replyColumnReadyPromise = null;

async function ensureReplyColumn() {
  if (!replyColumnReadyPromise) {
    replyColumnReadyPromise = (async () => {
      const [replyIdColumns] = await db.query("SHOW COLUMNS FROM mensajes LIKE 'reply_to_id'");
      if (!replyIdColumns.length) {
        await db.query("ALTER TABLE mensajes ADD COLUMN reply_to_id INT NULL AFTER lote_id");
      }

      const [replyTypeColumns] = await db.query("SHOW COLUMNS FROM mensajes LIKE 'reply_to_tipo'");
      if (!replyTypeColumns.length) {
        await db.query("ALTER TABLE mensajes ADD COLUMN reply_to_tipo VARCHAR(20) NULL AFTER reply_to_id");
      }

      const [replyGroupColumns] = await db.query("SHOW COLUMNS FROM mensajes LIKE 'reply_to_grupo_id'");
      if (!replyGroupColumns.length) {
        await db.query("ALTER TABLE mensajes ADD COLUMN reply_to_grupo_id INT NULL AFTER reply_to_tipo");
      }

      const [forwardColumns] = await db.query("SHOW COLUMNS FROM mensajes LIKE 'reenviado'");
      if (!forwardColumns.length) {
        await db.query("ALTER TABLE mensajes ADD COLUMN reenviado TINYINT(1) NOT NULL DEFAULT 0 AFTER reply_to_grupo_id");
      }
    })().catch((err) => {
      replyColumnReadyPromise = null;
      throw err;
    });
  }

  return replyColumnReadyPromise;
}

async function ensureGroupForwardColumn() {
  const [forwardColumns] = await db.query("SHOW COLUMNS FROM mensajes_grupo LIKE 'reenviado'");
  if (!forwardColumns.length) {
    await db.query("ALTER TABLE mensajes_grupo ADD COLUMN reenviado TINYINT(1) NOT NULL DEFAULT 0 AFTER reply_to_id");
  }
}

const normalizeForwardUrl = (value = "") => String(value || "").trim().replace(/^(\[sticker\])+/i, "");

const looksLikeImageUrl = (value = "", mime = "") =>
  String(mime || "").startsWith("image/") || /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(String(value || ""));

const looksLikeMediaUrl = (value = "", mime = "") =>
  looksLikeImageUrl(value, mime) ||
  String(mime || "").startsWith("audio/") ||
  String(mime || "").startsWith("video/") ||
  /\.(mp3|wav|ogg|m4a|aac|webm|mp4|mov)(\?.*)?$/i.test(String(value || ""));

function buildForwardUnits(original = {}) {
  const units = [];
  const caption = String(original.mensaje || "").trim();
  const imageList = Array.isArray(original.imagenes)
    ? original.imagenes.map(normalizeForwardUrl).filter(Boolean)
    : [];

  if (imageList.length) {
    imageList.forEach((url) => units.push({ mensaje: url, tipo_archivo: "image/*" }));
    if (caption && !imageList.includes(caption)) units.push({ mensaje: caption });
    return units;
  }

  const archivoUrl = normalizeForwardUrl(original.archivo_url || "");
  const tipoArchivo = String(original.tipo_archivo || "");
  const rawMessage = String(original.mensaje || "").trim();

  if (archivoUrl) {
    units.push({
      mensaje: archivoUrl,
      tipo_archivo: tipoArchivo,
      nombre_archivo: original.nombre_archivo || "",
      tamano: original.tamano || 0,
    });

    if (rawMessage && rawMessage !== archivoUrl && !rawMessage.startsWith("[sticker]") && !looksLikeMediaUrl(rawMessage, tipoArchivo)) {
      units.push({ mensaje: rawMessage });
    }

    return units;
  }

  if (rawMessage) {
    units.push({ mensaje: rawMessage });
  }

  return units;
}

async function insertForwardedPrivateMessage({ senderId, receiverId, unit, loteId, fechaEnvioMySQL, fechaEnvioISO, enviarEventoAlUsuario }) {
  const [result] = await db.query(
    `INSERT INTO mensajes
      (usuario_envia_id, usuario_recibe_id, mensaje, lote_id, reply_to_id, reply_to_tipo, reply_to_grupo_id, reenviado, fecha_envio, fijado)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?, 0)`,
    [senderId, receiverId, unit.mensaje, loteId || null, fechaEnvioMySQL]
  );

  const [[sender]] = await db.query(
    "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
    [senderId]
  );
  const [[receiver]] = await db.query(
    "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
    [receiverId]
  );

  const nuevoMensaje = {
    id: result.insertId,
    usuario_envia_id: senderId,
    usuario_recibe_id: receiverId,
    mensaje: unit.mensaje,
    lote_id: loteId || null,
    reply_to_id: null,
    reply_to_tipo: null,
    reply_to_grupo_id: null,
    reply_to: null,
    reenviado: 1,
    fecha_envio: fechaEnvioISO,
    fecha_envio_db: fechaEnvioMySQL,
    eliminado: 0,
    editado: 0,
    visto: 0,
    fijado: false,
    archivo_url: unit.tipo_archivo ? unit.mensaje : null,
    tipo_archivo: unit.tipo_archivo || "",
    nombre_archivo: unit.nombre_archivo || "",
    tamano: unit.tamano || 0,
    emisor_nombre: sender?.nombre,
    emisor_apellido: sender?.apellido,
    emisor_correo: sender?.correo,
    emisor_avatar: sender?.url_imagen,
    emisor_background: sender?.background,
    receptor_nombre: receiver?.nombre,
    receptor_apellido: receiver?.apellido,
    receptor_correo: receiver?.correo,
    receptor_avatar: receiver?.url_imagen,
    receptor_background: receiver?.background,
    reacciones: [],
  };

  enviarEventoAlUsuario(senderId, "nuevoMensaje", nuevoMensaje);
  enviarEventoAlUsuario(receiverId, "nuevoMensaje", nuevoMensaje);
  return nuevoMensaje;
}

async function insertForwardedGroupMessage({ grupoId, senderId, unit, loteId, fechaEnvioISO, enviarEventoAlUsuario }) {
  const [result] = await db.query(
    `INSERT INTO mensajes_grupo (grupo_id, usuario_id, mensaje, fecha_envio, lote_id, reply_to_id, reenviado)
     VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, NULL, 1)`,
    [grupoId, senderId, unit.mensaje, loteId || null]
  );

  const [[usuario]] = await db.query(
    "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
    [senderId]
  );

  const nuevoMensaje = {
    id: result.insertId,
    grupo_id: Number(grupoId),
    usuario_id: Number(senderId),
    mensaje: unit.mensaje,
    eliminado: 0,
    fecha_envio: fechaEnvioISO,
    editado: 0,
    lote_id: loteId || null,
    reply_to_id: null,
    reply_to: null,
    reenviado: 1,
    archivo_url: unit.tipo_archivo ? unit.mensaje : null,
    tipo_archivo: unit.tipo_archivo || "",
    nombre_archivo: unit.nombre_archivo || "",
    tamano: unit.tamano || 0,
    reacciones: [],
    ...usuario,
  };

  const [miembros] = await db.query(
    "SELECT usuario_id FROM usuario_grupo WHERE grupo_id = ?",
    [grupoId]
  );

  miembros.forEach(({ usuario_id }) => {
    enviarEventoAlUsuario(usuario_id, "nuevoMensajeGrupo", nuevoMensaje);
  });

  return nuevoMensaje;
}

async function getReplyMessagesByIds(ids = []) {
  const cleanIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  if (!cleanIds.length) return new Map();

  const [rows] = await db.query(
    `SELECT
       qm.id,
       qm.mensaje,
       qm.eliminado,
       qm.usuario_envia_id AS usuario_id,
       COALESCE(qma_direct.archivo_url, qma_lote.archivo_url) AS archivo_url,
       COALESCE(qma_direct.tipo_archivo, qma_lote.tipo_archivo) AS tipo_archivo,
       COALESCE(qma_direct.nombre_archivo, qma_lote.nombre_archivo) AS nombre_archivo,
       qu.nombre,
       qu.apellido,
       qu.background,
       NULL AS source_group_id,
       NULL AS source_group_name
     FROM mensajes qm
     JOIN usuario qu ON qu.id = qm.usuario_envia_id
     LEFT JOIN mensajes_archivos qma_direct
       ON qma_direct.sender_id = qm.usuario_envia_id
      AND qma_direct.receiver_id = qm.usuario_recibe_id
      AND qma_direct.archivo_url = qm.mensaje
     LEFT JOIN (
       SELECT lote_id, sender_id, receiver_id, MIN(id) AS first_file_id
       FROM mensajes_archivos
       WHERE lote_id IS NOT NULL
       GROUP BY lote_id, sender_id, receiver_id
     ) qma_idx
       ON qma_idx.lote_id = qm.lote_id
      AND qma_idx.sender_id = qm.usuario_envia_id
      AND qma_idx.receiver_id = qm.usuario_recibe_id
     LEFT JOIN mensajes_archivos qma_lote
       ON qma_lote.id = qma_idx.first_file_id
     WHERE qm.id IN (?)`,
    [cleanIds]
  );

  return new Map(rows.map((row) => [Number(row.id), row]));
}

async function getReplyMessageById(id) {
  const map = await getReplyMessagesByIds([id]);
  return map.get(Number(id)) || null;
}

async function getGroupReplyMessagesByIds(ids = []) {
  const cleanIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  if (!cleanIds.length) return new Map();

  const [rows] = await db.query(
    `SELECT
       qmg.id,
       qmg.mensaje,
       qmg.eliminado,
       qmg.usuario_id,
       qmg.grupo_id AS source_group_id,
       g.nombre AS source_group_name,
       COALESCE(qga_direct.archivo_url, qga_lote.archivo_url) AS archivo_url,
       COALESCE(qga_direct.tipo_archivo, qga_lote.tipo_archivo) AS tipo_archivo,
       COALESCE(qga_direct.nombre_archivo, qga_lote.nombre_archivo) AS nombre_archivo,
       u.nombre,
       u.apellido,
       u.background
     FROM mensajes_grupo qmg
     JOIN usuario u ON u.id = qmg.usuario_id
     LEFT JOIN grupos g ON g.id = qmg.grupo_id
     LEFT JOIN mensajes_grupo_archivos qga_direct
       ON qga_direct.grupo_id = qmg.grupo_id
      AND qga_direct.usuario_id = qmg.usuario_id
      AND qga_direct.archivo_url = qmg.mensaje
     LEFT JOIN (
       SELECT grupo_id, lote_id, MIN(id) AS media_message_id
       FROM mensajes_grupo
       WHERE lote_id IS NOT NULL AND mensaje LIKE '/uploads/%'
       GROUP BY grupo_id, lote_id
     ) qgm_idx
       ON qgm_idx.grupo_id = qmg.grupo_id
      AND qgm_idx.lote_id = qmg.lote_id
     LEFT JOIN mensajes_grupo qgm_media
       ON qgm_media.id = qgm_idx.media_message_id
     LEFT JOIN mensajes_grupo_archivos qga_lote
       ON qga_lote.grupo_id = qgm_media.grupo_id
      AND qga_lote.usuario_id = qgm_media.usuario_id
      AND qga_lote.archivo_url = qgm_media.mensaje
     WHERE qmg.id IN (?)`,
    [cleanIds]
  );

  return new Map(rows.map((row) => [Number(row.id), { ...row, reply_source: "grupo", reply_to_tipo: "grupo" }]));
}

async function getReplyMessageByContext(id, tipo = "privado") {
  if (!id) return null;
  if (tipo === "grupo") {
    const map = await getGroupReplyMessagesByIds([id]);
    return map.get(Number(id)) || null;
  }
  return getReplyMessageById(id);
}

async function safeGetReplyMessageByContext(id, tipo = "privado", contexto = "mensaje privado") {
  if (!id) return null;
  try {
    return await getReplyMessageByContext(id, tipo);
  } catch (err) {
    console.warn(`⚠️ No se pudo cargar la respuesta citada para ${contexto}:`, err?.message || err);
    return null;
  }
}

function emitPrivateMessageSafely(enviarEventoAlUsuario, senderId, receiverId, mensaje) {
  if (typeof enviarEventoAlUsuario !== "function") return;
  [...new Set([senderId, receiverId].map((id) => Number(id)).filter(Boolean))].forEach((userId) => {
    try {
      enviarEventoAlUsuario(userId, "nuevoMensaje", mensaje);
    } catch (err) {
      console.warn(`⚠️ No se pudo emitir nuevoMensaje al usuario ${userId}:`, err?.message || err);
    }
  });
}

async function safeGetUserInfo(userId, contexto = "usuario") {
  if (!userId) return {};
  try {
    const [rows] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [userId]
    );
    return rows[0] || {};
  } catch (err) {
    console.warn(`⚠️ No se pudo cargar información de ${contexto} ${userId}:`, err?.message || err);
    return {};
  }
}

// =======================
// Subir archivo en chat individual
// =======================
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const senderId = req.query.sender_id;
    const receiverId = req.query.receiver_id;
    const folderPath = path.join(__dirname, "..", "uploads", `chat_${senderId}_${receiverId}`);
    fs.mkdirSync(folderPath, { recursive: true });
    cb(null, folderPath);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = Date.now();
    cb(null, `${uniquePrefix}_${file.originalname.replace(/\s+/g, "_")}`);
  },
});

const upload = multer({ storage });

function esArchivoAudio(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  const name = String(file?.originalname || "").toLowerCase();
  return mime.startsWith("audio/") || /\.(webm|ogg|m4a|mp3|wav|aac|opus)$/i.test(name);
}

function esNotaVozGrabada(req, file) {
  const flag = String(req.body?.esNotaVoz || req.query?.esNotaVoz || "").toLowerCase();
  const name = String(file?.originalname || "").toLowerCase();
  return flag === "1" || flag === "true" || name.startsWith("voice_note_");
}

function eliminarArchivoTemporal(file) {
  if (!file?.path) return;
  fs.unlink(file.path, (err) => {
    if (err) {
      console.warn("⚠️ No se pudo eliminar archivo no autorizado:", err?.message || err);
    }
  });
}

function normalizarPermisosChat(value) {
  let parsed = value || {};
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function usuarioPuedeEnviarAudios(usuarioId) {
  const [rows] = await db.query(
    "SELECT permisos_chat FROM usuario WHERE id = ? LIMIT 1",
    [usuarioId]
  );
  const permisos = normalizarPermisosChat(rows[0]?.permisos_chat);
  const valor = permisos.enviar_audios;
  return valor === 1 || valor === "1" || valor === true || valor === "true";
}


router.get("/contexto/:mensajeId", async (req, res) => {
  try {
    await ensureReplyColumn();
    const mensajeId = Number(req.params.mensajeId);
    const usuario1 = Number(req.query.usuario1);
    const usuario2 = Number(req.query.usuario2);
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 20), 120)
      : 80;

    if (!mensajeId || !usuario1 || !usuario2) {
      return res.status(400).json({ error: "Faltan parámetros mensajeId, usuario1 o usuario2" });
    }

    const beforeLimit = Math.max(Math.floor((limit - 1) / 2), 1);
    const afterLimit = Math.max(limit - beforeLimit, 1);
    const chatWhere = `(
      (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
      OR
      (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
    )`;

    const [targetRows] = await db.query(
      `SELECT m.id FROM mensajes m WHERE m.id = ? AND ${chatWhere} LIMIT 1`,
      [mensajeId, usuario1, usuario2, usuario2, usuario1]
    );

    if (!targetRows.length) {
      return res.status(404).json({ error: "Mensaje no encontrado en este chat" });
    }

    const selectFields = `
      SELECT
        m.id,
        m.usuario_envia_id,
        m.usuario_recibe_id,
        m.mensaje,
        m.lote_id,
        m.reply_to_id,
        m.reply_to_tipo,
        m.reply_to_grupo_id,
        m.reenviado,
        m.fecha_envio,
        m.eliminado,
        m.editado,
        m.visto,
        m.fijado,
        ma.archivo_url,
        ma.tipo_archivo,
        ma.nombre_archivo,
        ma.tamano,
        ue.nombre AS emisor_nombre,
        ue.apellido AS emisor_apellido,
        ue.url_imagen AS emisor_avatar,
        ue.background AS emisor_background,
        ue.correo AS emisor_correo,
        ur.nombre AS receptor_nombre,
        ur.apellido AS receptor_apellido,
        ur.url_imagen AS receptor_avatar,
        ur.background AS receptor_background,
        ur.correo AS receptor_correo
      FROM mensajes m
      JOIN usuario ue ON ue.id = m.usuario_envia_id
      JOIN usuario ur ON ur.id = m.usuario_recibe_id
      LEFT JOIN mensajes_archivos ma
        ON ma.sender_id = m.usuario_envia_id
       AND ma.receiver_id = m.usuario_recibe_id
       AND ma.archivo_url = m.mensaje
    `;

    const chatParams = [usuario1, usuario2, usuario2, usuario1];

    const [beforeRowsRaw] = await db.query(
      `${selectFields}
       WHERE ${chatWhere}
         AND m.id < ?
       ORDER BY m.id DESC
       LIMIT ?`,
      [...chatParams, mensajeId, beforeLimit]
    );

    const [afterRows] = await db.query(
      `${selectFields}
       WHERE ${chatWhere}
         AND m.id >= ?
       ORDER BY m.id ASC
       LIMIT ?`,
      [...chatParams, mensajeId, afterLimit]
    );

    const mensajes = [...beforeRowsRaw.reverse(), ...afterRows];
    const ids = mensajes.map((m) => m.id);
    let reacciones = [];

    if (ids.length > 0) {
      const [rowsReacciones] = await db.query(
        `SELECT r.mensaje_id, r.usuario_id, r.emoji,
                u.nombre, u.apellido, u.url_imagen, u.background
         FROM reacciones r
         JOIN usuario u ON u.id = r.usuario_id
         WHERE r.mensaje_id IN (?)`,
        [ids]
      );
      reacciones = rowsReacciones;
    }

    const privateReplyMap = await getReplyMessagesByIds(
      mensajes
        .filter((m) => !m.reply_to_tipo || m.reply_to_tipo === "privado")
        .map((m) => m.reply_to_id)
    );

    const groupReplyMap = await getGroupReplyMessagesByIds(
      mensajes
        .filter((m) => m.reply_to_tipo === "grupo")
        .map((m) => m.reply_to_id)
    );

    const toIso = (value) => {
      if (!value) return null;
      if (value instanceof Date) return value.toISOString();
      return new Date(String(value).replace(" ", "T") + "Z").toISOString();
    };

    const mensajesConReacciones = mensajes.map((m) => ({
      ...m,
      fijado: !!m.fijado,
      fecha_envio: toIso(m.fecha_envio),
      reply_to: m.reply_to_id
        ? (m.reply_to_tipo === "grupo"
            ? groupReplyMap.get(Number(m.reply_to_id))
            : privateReplyMap.get(Number(m.reply_to_id))) || null
        : null,
      reacciones: reacciones
        .filter((r) => r.mensaje_id === m.id)
        .map((r) => ({
          mensaje_id: r.mensaje_id,
          usuario_id: r.usuario_id,
          emoji: r.emoji,
          usuario: {
            id: r.usuario_id,
            nombre: r.nombre,
            apellido: r.apellido,
            url_imagen: r.url_imagen,
            background: r.background || "#6c757d",
          },
        })),
    }));

    return res.json({
      mensajes: mensajesConReacciones,
      hasMore: beforeRowsRaw.length >= beforeLimit,
      nextBeforeId: mensajesConReacciones.length ? mensajesConReacciones[0].id : null,
      targetMessageId: mensajeId,
    });
  } catch (err) {
    console.error("❌ Error al obtener contexto de mensaje privado:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error en el servidor" });
    }
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureReplyColumn();
    const { usuario1, usuario2 } = req.query;
    const { paginated, limit, beforeId } = getPaginationOptions(req.query);

    if (!usuario1 || !usuario2) {
      return res.status(400).json({ error: "Faltan parámetros usuario1 y usuario2" });
    }

    const params = [usuario1, usuario2, usuario2, usuario1];
    let beforeClause = "";

    if (paginated && beforeId) {
      beforeClause = "AND m.id < ?";
      params.push(beforeId);
    }

    const limitClause = paginated
      ? "ORDER BY m.id DESC LIMIT ?"
      : "ORDER BY m.fecha_envio ASC, m.id ASC";

    if (paginated) {
      params.push(limit + 1);
    }

    const sqlMensajes = `
      SELECT 
        m.id,
        m.usuario_envia_id,
        m.usuario_recibe_id,
        m.mensaje,
        m.lote_id,
        m.reply_to_id,
        m.reply_to_tipo,
        m.reply_to_grupo_id,
        m.reenviado,
        m.fecha_envio,
        m.eliminado,
        m.editado,
        m.visto,
        m.fijado,
        ma.archivo_url,
        ma.tipo_archivo,
        ma.nombre_archivo,
        ma.tamano,
        ue.nombre AS emisor_nombre,
        ue.apellido AS emisor_apellido,
        ue.url_imagen AS emisor_avatar,
        ue.background AS emisor_background,
        ue.correo AS emisor_correo, 
        ur.nombre AS receptor_nombre,
        ur.apellido AS receptor_apellido,
        ur.url_imagen AS receptor_avatar,
        ur.background AS receptor_background,
        ur.correo AS receptor_correo
      FROM mensajes m
      JOIN usuario ue ON ue.id = m.usuario_envia_id
      JOIN usuario ur ON ur.id = m.usuario_recibe_id
      LEFT JOIN mensajes_archivos ma
        ON ma.sender_id = m.usuario_envia_id
       AND ma.receiver_id = m.usuario_recibe_id
       AND ma.archivo_url = m.mensaje
      WHERE (
          (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
       OR (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
      )
      ${beforeClause}
      ${limitClause}
    `;

    const [rows] = await db.query(sqlMensajes, params);
    const hasMore = paginated && rows.length > limit;
    const mensajes = paginated ? rows.slice(0, limit).reverse() : rows;

    const ids = mensajes.map((m) => m.id);
    let reacciones = [];

    if (ids.length > 0) {
      const [rowsReacciones] = await db.query(
        `SELECT r.mensaje_id, r.usuario_id, r.emoji, 
                u.nombre, u.apellido, u.url_imagen, u.background
         FROM reacciones r
         JOIN usuario u ON u.id = r.usuario_id
         WHERE r.mensaje_id IN (?)`,
        [ids]
      );
      reacciones = rowsReacciones;
    }

    const privateReplyMap = await getReplyMessagesByIds(
      mensajes
        .filter((m) => !m.reply_to_tipo || m.reply_to_tipo === "privado")
        .map((m) => m.reply_to_id)
    );
    const groupReplyMap = await getGroupReplyMessagesByIds(
      mensajes
        .filter((m) => m.reply_to_tipo === "grupo")
        .map((m) => m.reply_to_id)
    );

    const mensajesConReacciones = mensajes.map((m) => ({
      ...m,
      fijado: !!m.fijado,
      fecha_envio: m.fecha_envio
        ? new Date(m.fecha_envio.replace(" ", "T") + "Z").toISOString()
        : null,
      reply_to: m.reply_to_id
        ? (m.reply_to_tipo === "grupo"
            ? groupReplyMap.get(Number(m.reply_to_id))
            : privateReplyMap.get(Number(m.reply_to_id))) || null
        : null,
      reacciones: reacciones
        .filter((r) => r.mensaje_id === m.id)
        .map((r) => ({
          mensaje_id: r.mensaje_id,
          usuario_id: r.usuario_id,
          emoji: r.emoji,
          usuario: {
            id: r.usuario_id,
            nombre: r.nombre,
            apellido: r.apellido,
            url_imagen: r.url_imagen,
            background: r.background || "#6c757d",
          },
        })),
    }));

    if (paginated) {
      return res.json({
        mensajes: mensajesConReacciones,
        hasMore,
        nextBeforeId: mensajesConReacciones.length ? mensajesConReacciones[0].id : null,
      });
    }

    return res.json(mensajesConReacciones);
  } catch (err) {
    console.error("❌ Error al obtener mensajes:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error en el servidor" });
    }
  }
});

// =======================
// Enviar un nuevo mensaje
// =======================
router.post("/", async (req, res) => {
  const senderId = Number(req.body.senderId);
  const receiverId = Number(req.body.receiverId);
  const { message, loteId, replyToId, replyToType, replyToGrupoId } = req.body;
  const replyToIdNum = Number(replyToId) || null;
  const replyToTipo = replyToIdNum && replyToType === "grupo" ? "grupo" : (replyToIdNum ? "privado" : null);
  const replyToGrupoIdNum = replyToTipo === "grupo" ? Number(replyToGrupoId) || null : null;

  logDev("📤 [POST] Datos recibidos:", req.body);

  if (!senderId || !receiverId || !message) {
    console.warn("⚠️ Campos obligatorios faltantes:", { senderId, receiverId, message });
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const fechaUTC = new Date();
  const fechaEnvioMySQL = formatDateToMySQL(fechaUTC);
  const fechaEnvioISO = fechaUTC.toISOString();

  logDev("🕒 Guardando en DB (UTC):", fechaEnvioMySQL);
  logDev("🕒 Guardando en ISO:", fechaEnvioISO);

  const { enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    await ensureReplyColumn();

    const [result] = await queryWithRetry(
      db,
      `INSERT INTO mensajes 
        (usuario_envia_id, usuario_recibe_id, mensaje, lote_id, reply_to_id, reply_to_tipo, reply_to_grupo_id, reenviado, fecha_envio, fijado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
      [senderId, receiverId, message, loteId || null, replyToIdNum, replyToTipo, replyToGrupoIdNum, fechaEnvioMySQL],
      { attempts: 4, label: "insertar mensaje privado" }
    );

    // Desde aquí el mensaje ya quedó guardado. Todo lo adicional se hace de forma segura
    // para no devolver 500 ni mostrar la alerta falsa en el frontend cuando se responde.
    const [sender, receiver, replyTo] = await Promise.all([
      safeGetUserInfo(senderId, "emisor privado"),
      safeGetUserInfo(receiverId, "receptor privado"),
      safeGetReplyMessageByContext(replyToIdNum, replyToTipo, "envío privado"),
    ]);

    const nuevoMensaje = {
      id: result.insertId,
      usuario_envia_id: senderId,
      usuario_recibe_id: receiverId,
      mensaje: message,
      lote_id: loteId || null,
      reply_to_id: replyToIdNum,
      reply_to_tipo: replyToTipo,
      reply_to_grupo_id: replyToGrupoIdNum,
      reply_to: replyTo,
      reenviado: 0,
      fecha_envio: fechaEnvioISO,
      fecha_envio_db: fechaEnvioMySQL,
      editado: 0,
      visto: 0,
      fijado: false,
      emisor_nombre: sender.nombre || null,
      emisor_apellido: sender.apellido || null,
      emisor_correo: sender.correo || null,
      emisor_avatar: sender.url_imagen || null,
      emisor_background: sender.background || null,
      receptor_nombre: receiver.nombre || null,
      receptor_apellido: receiver.apellido || null,
      receptor_correo: receiver.correo || null,
      receptor_avatar: receiver.url_imagen || null,
      receptor_background: receiver.background || null,
      reacciones: [],
    };

    logDev("📦 Mensaje listo para emitir:", nuevoMensaje);

    // Respondemos primero porque el mensaje ya fue guardado.
    // Si falla un socket, no debe mostrarse la alerta falsa de "no se pudo enviar".
    res.status(201).json(nuevoMensaje);
    emitPrivateMessageSafely(enviarEventoAlUsuario, senderId, receiverId, nuevoMensaje);
    return;
  } catch (err) {
    console.error("❌ Error al insertar mensaje:", err);
    res.status(500).json({ error: "Error al guardar mensaje" });
  }
});

// =======================
// Reenviar mensajes a chats privados o grupos
// =======================
router.post("/reenviar", async (req, res) => {
  const usuarioId = Number(req.body.usuarioId);
  const mensajes = Array.isArray(req.body.mensajes) ? req.body.mensajes : [];
  const destinos = Array.isArray(req.body.destinos) ? req.body.destinos : [];

  if (!usuarioId || !mensajes.length || !destinos.length) {
    return res.status(400).json({ error: "Faltan usuarioId, mensajes o destinos" });
  }

  const { enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    await ensureReplyColumn();
    await ensureGroupForwardColumn();

    const reenviados = [];

    for (const destino of destinos) {
      const tipoDestino = destino.tipo === "grupo" ? "grupo" : "privado";
      const destinoId = Number(destino.id);
      if (!destinoId) continue;

      for (const original of mensajes) {
        const units = buildForwardUnits(original);
        if (!units.length) continue;

        const loteId = units.length > 1 ? `forward-${Date.now()}-${Math.random().toString(36).slice(2)}` : null;

        for (const unit of units) {
          const fechaUTC = new Date();
          const fechaEnvioMySQL = formatDateToMySQL(fechaUTC);
          const fechaEnvioISO = fechaUTC.toISOString();

          if (tipoDestino === "grupo") {
            const nuevo = await insertForwardedGroupMessage({
              grupoId: destinoId,
              senderId: usuarioId,
              unit,
              loteId,
              fechaEnvioISO,
              enviarEventoAlUsuario,
            });
            reenviados.push(nuevo);
          } else if (destinoId !== usuarioId) {
            const nuevo = await insertForwardedPrivateMessage({
              senderId: usuarioId,
              receiverId: destinoId,
              unit,
              loteId,
              fechaEnvioMySQL,
              fechaEnvioISO,
              enviarEventoAlUsuario,
            });
            reenviados.push(nuevo);
          }
        }
      }
    }

    return res.status(201).json({ success: true, mensajes: reenviados });
  } catch (err) {
    console.error("❌ Error reenviando mensajes:", err);
    return res.status(500).json({ error: "Error reenviando mensajes" });
  }
});

// =======================
// Marcar mensajes como vistos
// =======================
router.put("/marcar-vistos", async (req, res) => {
  const { userId, contactoId } = req.body;

  if (!userId || !contactoId) {
    return res.status(400).json({ error: "Faltan parámetros userId y contactoId" });
  }

  try {
    const actualizados = await markPrivateMessagesAsSeen(contactoId, userId);

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    const payload = { emisorId: contactoId, receptorId: userId };

    enviarEventoAlUsuario(contactoId, "mensajesVistos", payload);
    enviarEventoAlUsuario(userId, "mensajesVistos", payload);

    res.json({ success: true, actualizados });
  } catch (err) {
    console.error("❌ Error al marcar como vistos:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Añadir / quitar reacción
// =======================
router.post("/reaccion", async (req, res) => {
  logDev("➡️ [BACK] Reacción privada recibida:", req.body);
  const { mensajeId, usuarioId, emoji } = req.body;

  if (!mensajeId || !usuarioId || !emoji) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  try {
    const [rows] = await db.query(
      "SELECT id FROM reacciones WHERE mensaje_id = ? AND usuario_id = ? AND emoji = ?",
      [mensajeId, usuarioId, emoji]
    );

    let accion;
    if (rows.length > 0) {
      await db.query("DELETE FROM reacciones WHERE id = ?", [rows[0].id]);
      accion = "eliminada";
    } else {
      await db.query(
        "INSERT INTO reacciones (mensaje_id, usuario_id, emoji) VALUES (?, ?, ?)",
        [mensajeId, usuarioId, emoji]
      );
      accion = "agregada";
    }

    const [rowsUser] = await db.query(
      "SELECT id, nombre, apellido, url_imagen, background FROM usuario WHERE id = ?",
      [usuarioId]
    );
    const usuarioData = rowsUser[0];

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    const [rowsMsg] = await db.query(
      "SELECT usuario_envia_id, usuario_recibe_id FROM mensajes WHERE id = ?",
      [mensajeId]
    );

    if (rowsMsg.length > 0) {
      const { usuario_envia_id, usuario_recibe_id } = rowsMsg[0];
      const receptorId =
        Number(usuario_envia_id) === Number(usuarioId)
          ? usuario_recibe_id
          : usuario_envia_id;

      const payload = { mensajeId, usuarioId, emoji, accion, usuario: usuarioData };
      logDev("🚀 Emitiendo reaccionActualizada PRIVADO:", payload);

      enviarEventoAlUsuario(usuarioId, "reaccionActualizada", payload);
      enviarEventoAlUsuario(receptorId, "reaccionActualizada", payload);
    }

    res.json({ success: true, accion });
  } catch (err) {
    console.error("❌ Error en /reaccion (privado):", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// DELETE lógico de mensaje
// =======================
router.put("/:id/eliminar", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    await db.query(
      `UPDATE mensajes SET eliminado = 1 WHERE id = ? AND usuario_envia_id = ?`,
      [id, usuarioId]
    );

    const [rows] = await db.query(`SELECT * FROM mensajes WHERE id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    const msg = rows[0];
    const mensajeUTC = {
      ...msg,
      fecha_envio: msg.fecha_envio ? new Date(msg.fecha_envio + "Z").toISOString() : null,
      fecha_editado: msg.fecha_editado ? new Date(msg.fecha_editado + "Z").toISOString() : null,
    };

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    enviarEventoAlUsuario(mensajeUTC.usuario_envia_id, "mensajeEliminado", mensajeUTC);
    enviarEventoAlUsuario(mensajeUTC.usuario_recibe_id, "mensajeEliminado", mensajeUTC);

    res.json({ success: true, mensaje: mensajeUTC });
  } catch (err) {
    console.error("❌ Error eliminando mensaje:", err);
    res.status(500).json({ error: "Error eliminando mensaje" });
  }
});

// =======================
// Deshacer eliminado
// =======================
router.put("/:id/deshacer", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    await db.query(
      `UPDATE mensajes SET eliminado = 0 WHERE id = ? AND usuario_envia_id = ?`,
      [id, usuarioId]
    );

    const [rows] = await db.query(`SELECT * FROM mensajes WHERE id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    const msg = rows[0];

    const mensajeUTC = {
      ...msg,
      fecha_envio: msg.fecha_envio ? new Date(msg.fecha_envio + "Z").toISOString() : null,
      fecha_editado: msg.fecha_editado ? new Date(msg.fecha_editado + "Z").toISOString() : null,
    };

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    enviarEventoAlUsuario(mensajeUTC.usuario_envia_id, "mensajeDeshecho", mensajeUTC);
    enviarEventoAlUsuario(mensajeUTC.usuario_recibe_id, "mensajeDeshecho", mensajeUTC);

    res.json({ success: true, mensaje: mensajeUTC });
  } catch (err) {
    console.error("❌ Error deshaciendo mensaje:", err);
    res.status(500).json({ error: "Error deshaciendo mensaje" });
  }
});

// =======================
// Editar mensaje
// =======================
router.put("/:id/editar", async (req, res) => {
  const { id } = req.params;
  const { usuarioId, nuevoTexto } = req.body;

  if (!usuarioId || !nuevoTexto) {
    return res.status(400).json({ error: "Faltan parámetros usuarioId o nuevoTexto" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM mensajes WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const original = rows[0];

    if (original.usuario_envia_id !== usuarioId) {
      return res.status(403).json({ error: "No tienes permiso" });
    }

    const fechaOriginal = original.fecha_editado || original.fecha_envio;

    await db.query(
      `INSERT INTO mensajes_editados (mensaje_id, es_grupo, usuario_id, texto_original, fecha_original, fecha_edicion)
       VALUES (?, 0, ?, ?, ?, UTC_TIMESTAMP())`,
      [id, usuarioId, original.mensaje, fechaOriginal]
    );

    await db.query(
      `UPDATE mensajes 
       SET mensaje = ?, editado = 1, fecha_editado = UTC_TIMESTAMP() 
       WHERE id = ?`,
      [nuevoTexto, id]
    );

    const [updated] = await db.query("SELECT * FROM mensajes WHERE id = ?", [id]);
    const mensajeEditado = updated[0];

    const mensajeUTC = {
      ...mensajeEditado,
      fecha_envio: mensajeEditado.fecha_envio
        ? new Date(mensajeEditado.fecha_envio + "Z").toISOString()
        : null,
      fecha_editado: mensajeEditado.fecha_editado
        ? new Date(mensajeEditado.fecha_editado + "Z").toISOString()
        : null,
    };

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    enviarEventoAlUsuario(mensajeUTC.usuario_envia_id, "mensajeEditado", mensajeUTC);
    enviarEventoAlUsuario(mensajeUTC.usuario_recibe_id, "mensajeEditado", mensajeUTC);

    res.json({ success: true, mensaje: mensajeUTC });
  } catch (err) {
    console.error("❌ Error al editar mensaje:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Obtener historial de ediciones
// =======================
router.get("/:id/historial", async (req, res) => {
  const { id } = req.params;

  try {
    const [mensajeArr] = await db.query("SELECT * FROM mensajes WHERE id = ?", [id]);
    if (!mensajeArr.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const mensajeOriginal = mensajeArr[0];
    const fechaMensaje = mensajeOriginal.fecha_editado || mensajeOriginal.fecha_envio;

    const mensajeOriginalUTC = {
      id: mensajeOriginal.id,
      mensaje_id: mensajeOriginal.id,
      texto_original: mensajeOriginal.mensaje,
      fecha: fechaMensaje ? new Date(fechaMensaje + "Z").toISOString() : null,
      usuario_id: mensajeOriginal.usuario_envia_id,
      nombre: mensajeOriginal.nombre_envia,
      apellido: mensajeOriginal.apellido_envia,
      es_original: true,
    };

    const [historial] = await db.query(
      `SELECT me.*, u.nombre, u.apellido
       FROM mensajes_editados me
       JOIN usuario u ON u.id = me.usuario_id
       WHERE me.mensaje_id = ? AND me.es_grupo = 0
       ORDER BY me.fecha_edicion ASC`,
      [id]
    );

    const historialUTC = historial.map((h) => ({
      id: h.id,
      mensaje_id: h.mensaje_id,
      texto_original: h.texto_original,
      fecha: h.fecha_original ? new Date(h.fecha_original + "Z").toISOString() : null,
      fecha_edicion: h.fecha_edicion ? new Date(h.fecha_edicion + "Z").toISOString() : null,
      usuario_id: h.usuario_id,
      nombre: h.nombre,
      apellido: h.apellido,
      es_original: false,
    }));

    const historialCompleto = [...historialUTC, mensajeOriginalUTC];

    return res.json(historialCompleto);
  } catch (err) {
    console.error("❌ Error al traer historial:", err);
    res.status(500).json({ error: "Error al obtener historial" });
  }
});

// =======================
// FIJAR o DESFIJAR mensaje
// =======================
router.post("/fijar", async (req, res) => {
  const { mensajeId, usuarioId, duracion = "24h" } = req.body;

  if (!mensajeId || !usuarioId) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  try {
    const [rows] = await db.query(
      "SELECT id, usuario_id FROM mensajes_fijados WHERE mensaje_id = ?",
      [mensajeId]
    );

    let accion;
    let fechaExpMySQL = null;
    let fechaFijadoMySQL = null;

    if (rows.length > 0) {
      await db.query("DELETE FROM mensajes_fijados WHERE mensaje_id = ?", [mensajeId]);
      await db.query("UPDATE mensajes SET fijado = 0 WHERE id = ?", [mensajeId]);
      accion = "desfijado";
    } else {
      await ensureReplyColumn();

    const fechaUTC = new Date();
      const fechaExp = new Date(fechaUTC);

      switch (duracion) {
        case "7d":
          fechaExp.setUTCDate(fechaExp.getUTCDate() + 7);
          break;
        case "30d":
          fechaExp.setUTCDate(fechaExp.getUTCDate() + 30);
          break;
        default:
          fechaExp.setUTCHours(fechaExp.getUTCHours() + 24);
          break;
      }

      fechaFijadoMySQL = fechaUTC.toISOString().slice(0, 19).replace("T", " ");
      fechaExpMySQL = fechaExp.toISOString().slice(0, 19).replace("T", " ");

      await db.query(
        "INSERT INTO mensajes_fijados (mensaje_id, usuario_id, fecha_fijado, duracion, fecha_expiracion) VALUES (?, ?, ?, ?, ?)",
        [mensajeId, usuarioId, fechaFijadoMySQL, duracion, fechaExpMySQL]
      );

      await db.query("UPDATE mensajes SET fijado = 1 WHERE id = ?", [mensajeId]);
      accion = "fijado";
    }

    const [msgData] = await db.query(
      `SELECT m.id, m.mensaje, m.usuario_envia_id, m.usuario_recibe_id, m.fijado,
              ue.nombre AS emisor_nombre, ue.apellido AS emisor_apellido
       FROM mensajes m
       JOIN usuario ue ON ue.id = m.usuario_envia_id
       WHERE m.id = ?`,
      [mensajeId]
    );

    const [usrData] = await db.query(
      "SELECT id, nombre, apellido, url_imagen, background FROM usuario WHERE id = ?",
      [usuarioId]
    );

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    const payload = {
      accion,
      mensajeId,
      usuarioId,
      usuario: usrData[0],
      mensaje: msgData[0],
      fijado: msgData[0].fijado === 1,
      duracion: accion === "fijado" ? duracion : null,
      fecha_fijado: accion === "fijado" ? new Date(fechaFijadoMySQL + "Z").toISOString() : null,
      fecha_expiracion: accion === "fijado" ? new Date(fechaExpMySQL + "Z").toISOString() : null,
    };

    const receptorId =
      msgData[0].usuario_envia_id === usuarioId
        ? msgData[0].usuario_recibe_id
        : msgData[0].usuario_envia_id;

    enviarEventoAlUsuario(usuarioId, "mensajeFijado", payload);
    enviarEventoAlUsuario(receptorId, "mensajeFijado", payload);

    res.json({ success: true, accion, payload });
  } catch (err) {
    console.error("❌ Error al fijar mensaje:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Obtener mensajes fijados
// =======================
router.get("/fijados", async (req, res) => {
  const { usuario1, usuario2 } = req.query;

  if (!usuario1 || !usuario2) {
    return res.status(400).json({ error: "Faltan usuario1 y usuario2" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
          mf.id AS fijado_id, 
          mf.fecha_fijado,
          mf.duracion,
          mf.fecha_expiracion,
          m.id AS mensaje_id, 
          m.mensaje, 
          COALESCE(ma_direct.archivo_url, ma_lote.archivo_url) AS archivo_url,
          COALESCE(ma_direct.tipo_archivo, ma_lote.tipo_archivo) AS tipo_archivo,
          COALESCE(ma_direct.nombre_archivo, ma_lote.nombre_archivo) AS nombre_archivo,
          COALESCE(ma_direct.tamano, ma_lote.tamano) AS tamano,
          m.usuario_envia_id, 
          m.usuario_recibe_id,
          m.fijado,
          u.id AS usuario_fijo_id,
          u.nombre, 
          u.apellido, 
          u.url_imagen, 
          u.background
       FROM mensajes_fijados mf
       JOIN mensajes m ON m.id = mf.mensaje_id
       LEFT JOIN mensajes_archivos ma_direct
         ON ma_direct.sender_id = m.usuario_envia_id
        AND ma_direct.receiver_id = m.usuario_recibe_id
        AND ma_direct.archivo_url = m.mensaje
       LEFT JOIN (
         SELECT lote_id, sender_id, receiver_id, MIN(id) AS first_file_id
         FROM mensajes_archivos
         WHERE lote_id IS NOT NULL
         GROUP BY lote_id, sender_id, receiver_id
       ) ma_idx
         ON ma_idx.lote_id = m.lote_id
        AND ma_idx.sender_id = m.usuario_envia_id
        AND ma_idx.receiver_id = m.usuario_recibe_id
       LEFT JOIN mensajes_archivos ma_lote
         ON ma_lote.id = ma_idx.first_file_id
       JOIN usuario u ON u.id = mf.usuario_id
       WHERE ((m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
          OR (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?))
         AND mf.fecha_expiracion > UTC_TIMESTAMP()
       ORDER BY mf.fecha_fijado DESC`,
      [usuario1, usuario2, usuario2, usuario1]
    );

    const fijados = rows.map((r) => ({
      ...r,
      fijado: r.fijado === 1,
      fecha_fijado: new Date(r.fecha_fijado.replace(" ", "T") + "Z").toISOString(),
      fecha_expiracion: new Date(r.fecha_expiracion.replace(" ", "T") + "Z").toISOString(),
    }));

    res.json(fijados);
  } catch (err) {
    console.error("❌ Error al obtener fijados:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Subir archivo en chat individual
// =======================
router.post("/archivo", upload.single("archivo"), async (req, res) => {
  try {
    const sender_id = Number(req.body.sender_id || req.query.sender_id);
    const receiver_id = Number(req.body.receiver_id || req.query.receiver_id);
    const loteId = req.body.loteId || req.query.loteId || null;
    const replyToIdNum = Number(req.body.replyToId || req.query.replyToId) || null;
    const replyToType = req.body.replyToType || req.query.replyToType;
    const replyToTipo = replyToIdNum && replyToType === "grupo" ? "grupo" : (replyToIdNum ? "privado" : null);
    const replyToGrupoIdNum = replyToTipo === "grupo" ? Number(req.body.replyToGrupoId || req.query.replyToGrupoId) || null : null;

    if (!sender_id || !receiver_id || isNaN(sender_id) || isNaN(receiver_id)) {
      console.error("❌ sender_id o receiver_id inválido:", sender_id, receiver_id);
      return res.status(400).json({ success: false, error: "Datos inválidos en la solicitud" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "No se recibió ningún archivo" });
    }

    if (esNotaVozGrabada(req, file) && !(await usuarioPuedeEnviarAudios(sender_id))) {
      eliminarArchivoTemporal(file);
      return res.status(403).json({
        success: false,
        error: "No tienes permiso para grabar audios. Solicita autorización a un administrador.",
      });
    }

    const relativePath = path.relative(
      path.join(__dirname, "../uploads"),
      file.path
    );

    const urlArchivo = `/uploads/${relativePath.replace(/\\/g, "/")}`;

    await ensureReplyColumn();

    const fechaUTC = new Date();
    const fechaEnvioMySQL = formatDateToMySQL(fechaUTC);
    const fechaEnvioISO = fechaUTC.toISOString();

    const [resultadoArchivo] = await queryWithRetry(
      db,
      `INSERT INTO mensajes_archivos 
        (sender_id, receiver_id, archivo_url, tipo_archivo, nombre_archivo, tamano, fecha_envio, lote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sender_id, receiver_id, urlArchivo, file.mimetype, file.originalname, file.size, fechaEnvioMySQL, loteId],
      { attempts: 4, label: "insertar archivo privado" }
    );

    const [resultadoMensaje] = await queryWithRetry(
      db,
      `INSERT INTO mensajes 
        (usuario_envia_id, usuario_recibe_id, mensaje, lote_id, reply_to_id, reply_to_tipo, reply_to_grupo_id, fecha_envio, fijado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [sender_id, receiver_id, urlArchivo, loteId || null, replyToIdNum, replyToTipo, replyToGrupoIdNum, fechaEnvioMySQL],
      { attempts: 4, label: "insertar mensaje archivo privado" }
    );

    // El archivo y el mensaje ya quedaron guardados. La información extra no debe
    // provocar alerta falsa si alguna consulta auxiliar falla.
    const [emisor, receptor, replyTo] = await Promise.all([
      safeGetUserInfo(sender_id, "emisor archivo privado"),
      safeGetUserInfo(receiver_id, "receptor archivo privado"),
      safeGetReplyMessageByContext(replyToIdNum, replyToTipo, "archivo privado"),
    ]);

    const mensaje = {
      id: resultadoMensaje.insertId,
      usuario_envia_id: sender_id,
      usuario_recibe_id: receiver_id,
      mensaje: urlArchivo,
      lote_id: loteId || null,
      reply_to_id: replyToIdNum,
      reply_to_tipo: replyToTipo,
      reply_to_grupo_id: replyToGrupoIdNum,
      reply_to: replyTo,
      reenviado: 0,
      fecha_envio: fechaEnvioISO,
      editado: 0,
      eliminado: 0,
      visto: 0,
      fijado: false,
      archivo_url: urlArchivo,
      tipo_archivo: file.mimetype,
      nombre_archivo: file.originalname,
      tamano: file.size,
      emisor_nombre: emisor.nombre || null,
      emisor_apellido: emisor.apellido || null,
      emisor_correo: emisor.correo || null,
      emisor_avatar: emisor.url_imagen || null,
      emisor_background: emisor.background || null,
      receptor_nombre: receptor.nombre || null,
      receptor_apellido: receptor.apellido || null,
      receptor_correo: receptor.correo || null,
      receptor_avatar: receptor.url_imagen || null,
      receptor_background: receptor.background || null,
      reacciones: [],
    };

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    res.json({
      success: true,
      mensaje,
      archivo_id: resultadoArchivo.insertId,
    });

    emitPrivateMessageSafely(enviarEventoAlUsuario, sender_id, receiver_id, mensaje);
    return;
  } catch (err) {
    console.error("❌ Error al subir archivo privado:", err);
    res.status(500).json({ success: false, error: "Error al subir archivo" });
  }
});

module.exports = router;