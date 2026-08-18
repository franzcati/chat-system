const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { logDev } = require("../utils/logger");
const { queryWithRetry } = require("../utils/dbRetry");
const { optimizeUploadedAudio } = require("../utils/audioOptimizer");


// =======================
// Helper: formato UTC para MySQL
// =======================
function formatDateToMySQL(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}


const MARK_GROUP_BATCH_SIZE = 250;
const MARK_GROUP_MAX_BATCHES = 8;
const groupSeenInFlight = new Map();

async function runMarkGroupMessagesAsSeen(grupoId, userId) {
  const idsMarcados = [];
  let totalActualizados = 0;

  for (let batch = 0; batch < MARK_GROUP_MAX_BATCHES; batch += 1) {
    const [pendientes] = await queryWithRetry(
      db,
      `SELECT mg.id
       FROM mensajes_grupo mg
       LEFT JOIN mensajes_grupo_vistos mgv
         ON mgv.mensaje_id = mg.id
        AND mgv.usuario_id = ?
       WHERE mg.grupo_id = ?
         AND mg.usuario_id != ?
         AND mgv.mensaje_id IS NULL
       ORDER BY mg.id ASC
       LIMIT ?`,
      [userId, grupoId, userId, MARK_GROUP_BATCH_SIZE],
      { attempts: 4, label: "seleccionar mensajes de grupo pendientes de visto" }
    );

    if (!pendientes.length) break;

    const ids = pendientes.map((mensaje) => mensaje.id);
    const values = ids.map((id) => [id, userId]);

    const [result] = await queryWithRetry(
      db,
      `INSERT IGNORE INTO mensajes_grupo_vistos (mensaje_id, usuario_id) VALUES ?`,
      [values],
      { attempts: 4, label: "marcar mensajes de grupo como vistos" }
    );

    idsMarcados.push(...ids);
    totalActualizados += result.affectedRows || 0;

    if (pendientes.length < MARK_GROUP_BATCH_SIZE) break;
  }

  return { idsMarcados, totalActualizados };
}

async function markGroupMessagesAsSeen(grupoId, userId) {
  const key = `${Number(userId)}:${Number(grupoId)}`;
  const current = groupSeenInFlight.get(key);
  if (current) return current;

  const task = runMarkGroupMessagesAsSeen(grupoId, userId)
    .finally(() => groupSeenInFlight.delete(key));

  groupSeenInFlight.set(key, task);
  return task;
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
      const [columns] = await db.query("SHOW COLUMNS FROM mensajes_grupo LIKE 'reply_to_id'");
      if (!columns.length) {
        await db.query("ALTER TABLE mensajes_grupo ADD COLUMN reply_to_id INT NULL AFTER lote_id");
      }

      const [forwardColumns] = await db.query("SHOW COLUMNS FROM mensajes_grupo LIKE 'reenviado'");
      if (!forwardColumns.length) {
        await db.query("ALTER TABLE mensajes_grupo ADD COLUMN reenviado TINYINT(1) NOT NULL DEFAULT 0 AFTER reply_to_id");
      }
    })().catch((err) => {
      replyColumnReadyPromise = null;
      throw err;
    });
  }

  return replyColumnReadyPromise;
}

async function getReplyMessagesByIds(ids = []) {
  const cleanIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  if (!cleanIds.length) return new Map();

  const [rows] = await db.query(
    `SELECT
       qmg.id,
       qmg.mensaje,
       qmg.eliminado,
       qmg.usuario_id,
       COALESCE(qga_direct.archivo_url, qga_lote.archivo_url) AS archivo_url,
       COALESCE(qga_direct.tipo_archivo, qga_lote.tipo_archivo) AS tipo_archivo,
       COALESCE(qga_direct.nombre_archivo, qga_lote.nombre_archivo) AS nombre_archivo,
       u.nombre,
       u.apellido,
       u.background
     FROM mensajes_grupo qmg
     JOIN usuario u ON u.id = qmg.usuario_id
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

  return new Map(rows.map((row) => [Number(row.id), row]));
}

async function getReplyMessageById(id) {
  const map = await getReplyMessagesByIds([id]);
  return map.get(Number(id)) || null;
}

async function safeGetReplyMessageById(id, contexto = "mensaje de grupo") {
  if (!id) return null;
  try {
    return await getReplyMessageById(id);
  } catch (err) {
    console.warn(`⚠️ No se pudo cargar la respuesta citada para ${contexto}:`, err?.message || err);
    return null;
  }
}

function emitGroupMessageSafely(miembros, enviarEventoAlUsuario, mensaje) {
  if (typeof enviarEventoAlUsuario !== "function") return;
  miembros.forEach(({ usuario_id }) => {
    try {
      enviarEventoAlUsuario(usuario_id, "nuevoMensajeGrupo", mensaje);
    } catch (err) {
      console.warn(`⚠️ No se pudo emitir nuevoMensajeGrupo al usuario ${usuario_id}:`, err?.message || err);
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

async function emitGroupMessageAfterResponse(grupoId, enviarEventoAlUsuario, mensaje) {
  try {
    const [miembros] = await db.query(
      "SELECT usuario_id FROM usuario_grupo WHERE grupo_id = ?",
      [grupoId]
    );
    emitGroupMessageSafely(miembros, enviarEventoAlUsuario, mensaje);
  } catch (err) {
    console.warn(`⚠️ No se pudo emitir mensaje al grupo ${grupoId}:`, err?.message || err);
  }
}

// =======================
// 📦 Configuración de Multer (con carpetas dinámicas por grupo y tipo)
// =======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      // 💡 Si req.body aún no está disponible, usar query
      const grupoId = req.body.grupo_id || req.query.grupo_id;

      if (!grupoId) {
        return cb(new Error("Falta el grupo_id en la solicitud"));
      }

      // 📁 Carpeta base
      const baseDir = path.join(__dirname, "../uploads");

      // 🗂️ Carpeta por grupo
      const grupoDir = path.join(baseDir, `grupo_${grupoId}`);

      // 📷 Subcarpeta según tipo
      let tipoDir = "archivos";
      const mime = file.mimetype.toLowerCase();

      if (mime.startsWith("image/") || mime.includes("gif")) {
        tipoDir = "imagenes";
      }

      // 🧭 Ruta final donde se guardará
      const finalDir = path.join(grupoDir, tipoDir);

      // Crear carpetas si no existen
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }

      cb(null, finalDir);
    } catch (error) {
      console.error("❌ Error creando carpeta de destino:", error);
      cb(error);
    }
  },

  filename: (req, file, cb) => {
    if (file.fieldname === "miniatura" && req._quickchatMainUploadFilename) {
      const parsed = path.parse(req._quickchatMainUploadFilename);
      return cb(null, `${parsed.name}.thumb.webp`);
    }

    const safeName = file.originalname.replace(/\s+/g, "_");
    const generatedName = `${Date.now()}_${safeName}`;

    if (file.fieldname === "archivo") {
      req._quickchatMainUploadFilename = generatedName;
    }

    cb(null, generatedName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 70 * 1024 * 1024 }, // 70 MB por archivo
});

const uploadArchivoConMiniatura = upload.fields([
  { name: "archivo", maxCount: 1 },
  { name: "miniatura", maxCount: 1 },
]);

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

async function obtenerPermisosChatUsuario(usuarioId) {
  const [rows] = await db.query(
    "SELECT permisos_chat FROM usuario WHERE id = ? LIMIT 1",
    [usuarioId]
  );
  return normalizarPermisosChat(rows[0]?.permisos_chat);
}

async function usuarioPuedeEnviarAudios(usuarioId) {
  const permisos = await obtenerPermisosChatUsuario(usuarioId);
  const valor = permisos.enviar_audios;
  return valor === 1 || valor === "1" || valor === true || valor === "true";
}

async function usuarioPuedeEditarMensajes(usuarioId) {
  const permisos = await obtenerPermisosChatUsuario(usuarioId);
  return permisos.editar_mensajes === 1;
}

async function usuarioPuedeEliminarMensajes(usuarioId) {
  const permisos = await obtenerPermisosChatUsuario(usuarioId);
  return permisos.eliminar_mensajes === 1;
}

// =======================
// Obtener contexto alrededor de un mensaje de grupo
// =======================
router.get("/:grupoId/contexto/:mensajeId", async (req, res) => {
  await ensureReplyColumn();
  const { grupoId, mensajeId } = req.params;
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 20), 100)
    : 80;
  const beforeLimit = Math.floor(limit / 2);
  const afterLimit = limit - beforeLimit;

  try {
    const [targetRows] = await db.query(
      "SELECT id FROM mensajes_grupo WHERE grupo_id = ? AND id = ? LIMIT 1",
      [grupoId, mensajeId]
    );

    if (!targetRows.length) {
      return res.status(404).json({ error: "Mensaje de grupo no encontrado" });
    }

    const baseSelect = `SELECT 
        mg.id,
        mg.grupo_id,
        mg.usuario_id,
        mg.mensaje,
        mg.eliminado,
        mg.fecha_envio,
        mg.editado,
        mg.lote_id,
        mg.reply_to_id,
        mg.reenviado,
        mga.archivo_url,
        mga.tipo_archivo,
        mga.nombre_archivo,
        mga.tamano,
        u.nombre,
        u.apellido,
        u.url_imagen,
        u.background,
        u.correo
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       LEFT JOIN mensajes_grupo_archivos mga
         ON mga.grupo_id = mg.grupo_id
        AND mga.usuario_id = mg.usuario_id
        AND mga.archivo_url = mg.mensaje`;

    const [beforeRows] = await db.query(
      `${baseSelect}
       WHERE mg.grupo_id = ? AND mg.id < ?
       ORDER BY mg.id DESC
       LIMIT ?`,
      [grupoId, mensajeId, beforeLimit]
    );

    const [targetAndAfterRows] = await db.query(
      `${baseSelect}
       WHERE mg.grupo_id = ? AND mg.id >= ?
       ORDER BY mg.id ASC
       LIMIT ?`,
      [grupoId, mensajeId, afterLimit]
    );

    const mensajes = [
      ...beforeRows.slice().reverse(),
      ...targetAndAfterRows,
    ];

    const ids = mensajes.map((m) => m.id);

    const [reacciones] = ids.length > 0
      ? await db.query(
          `SELECT 
             r.mensaje_grupo_id, 
             r.usuario_id, 
             r.emoji, 
             u.nombre, 
             u.apellido, 
             u.url_imagen, 
             u.background
           FROM reacciones r
           JOIN usuario u ON u.id = r.usuario_id
           WHERE r.mensaje_grupo_id IN (?)`,
          [ids]
        )
      : [[]];

    const [miembros] = await db.query(
      `SELECT usuario_id FROM usuario_grupo WHERE grupo_id = ?`,
      [grupoId]
    );
    const miembroIds = miembros.map((m) => m.usuario_id);

    const [vistos] = ids.length
      ? await db.query(
          `SELECT mensaje_id, usuario_id 
             FROM mensajes_grupo_vistos 
            WHERE mensaje_id IN (?)`,
          [ids]
        )
      : [[]];

    const [fijados] = await db.query(
      `SELECT 
          mgf.id AS fijado_id,
          mgf.grupo_id,
          mgf.mensaje_id,
          mg.mensaje,
          COALESCE(mga_direct.archivo_url, mga_lote.archivo_url) AS archivo_url,
          COALESCE(mga_direct.tipo_archivo, mga_lote.tipo_archivo) AS tipo_archivo,
          COALESCE(mga_direct.nombre_archivo, mga_lote.nombre_archivo) AS nombre_archivo,
          COALESCE(mga_direct.tamano, mga_lote.tamano) AS tamano,
          mgf.usuario_id AS fijado_por_id,
          u.nombre AS fijado_por_nombre,
          u.apellido AS fijado_por_apellido,
          u.url_imagen AS fijado_por_imagen,
          u.background AS fijado_por_background,
          mgf.fecha_fijado,
          mgf.duracion,
          mgf.fecha_expiracion
       FROM mensajes_grupo_fijados mgf
       JOIN mensajes_grupo mg ON mg.id = mgf.mensaje_id
       LEFT JOIN mensajes_grupo_archivos mga_direct
         ON mga_direct.grupo_id = mg.grupo_id
        AND mga_direct.usuario_id = mg.usuario_id
        AND mga_direct.archivo_url = mg.mensaje
       LEFT JOIN (
         SELECT grupo_id, lote_id, MIN(id) AS media_message_id
         FROM mensajes_grupo
         WHERE lote_id IS NOT NULL AND mensaje LIKE '/uploads/%'
         GROUP BY grupo_id, lote_id
       ) mg_media_idx
         ON mg_media_idx.grupo_id = mg.grupo_id
        AND mg_media_idx.lote_id = mg.lote_id
       LEFT JOIN mensajes_grupo mg_media
         ON mg_media.id = mg_media_idx.media_message_id
       LEFT JOIN mensajes_grupo_archivos mga_lote
         ON mga_lote.grupo_id = mg_media.grupo_id
        AND mga_lote.usuario_id = mg_media.usuario_id
        AND mga_lote.archivo_url = mg_media.mensaje
       JOIN usuario u ON u.id = mgf.usuario_id
       WHERE mgf.grupo_id = ?
       ORDER BY mgf.fecha_fijado ASC
       LIMIT 3`,
      [grupoId]
    );

    const replyMap = await getReplyMessagesByIds(mensajes.map((m) => m.reply_to_id));

    const formatFechaEnvio = (fecha) => {
      if (!fecha) return null;
      if (fecha instanceof Date) return fecha.toISOString();
      return new Date(String(fecha).replace(" ", "T") + "Z").toISOString();
    };

    const mensajesConReacciones = mensajes.map((m) => {
      const vistosMensaje = vistos
        .filter((v) => v.mensaje_id === m.id)
        .map((v) => v.usuario_id);

      const otrosMiembros = miembroIds.filter((id) => id !== m.usuario_id);
      const visto = otrosMiembros.every((id) => vistosMensaje.includes(id)) ? 1 : 0;

      return {
        ...m,
        fecha_envio: formatFechaEnvio(m.fecha_envio),
        reply_to: m.reply_to_id ? replyMap.get(Number(m.reply_to_id)) || null : null,
        visto,
        reacciones: reacciones
          .filter((r) => r.mensaje_grupo_id === m.id)
          .map((r) => ({
            mensaje_id: r.mensaje_grupo_id,
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
      };
    });

    return res.json({
      mensajes: mensajesConReacciones,
      mensajes_fijados: fijados,
      hasMore: beforeRows.length >= beforeLimit,
      nextBeforeId: mensajesConReacciones.length ? mensajesConReacciones[0].id : null,
      targetMessageId: Number(mensajeId),
    });
  } catch (err) {
    console.error("❌ Error al obtener contexto de mensaje de grupo:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error en el servidor" });
    }
  }
});

// =======================
// Obtener mensajes de un grupo (con fijados)
// =======================
// =======================
// Buscar mensajes dentro de un grupo
// =======================
router.get("/:grupoId/buscar", async (req, res) => {
  const { grupoId } = req.params;
  const query = String(req.query.q || "").trim();
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 80) : 40;

  if (!query) {
    return res.json({ mensajes: [] });
  }

  try {
    const like = `%${query}%`;
    const [rows] = await db.query(
      `SELECT
         mg.id,
         mg.grupo_id,
         mg.usuario_id,
         mg.mensaje,
         mg.eliminado,
         mg.fecha_envio,
         mg.editado,
         mg.lote_id,
         mg.reply_to_id,
         mga.archivo_url,
         mga.tipo_archivo,
         mga.nombre_archivo,
         mga.tamano,
         u.nombre,
         u.apellido,
         u.url_imagen,
         u.background,
         u.correo
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       LEFT JOIN mensajes_grupo_archivos mga
         ON mga.grupo_id = mg.grupo_id
        AND mga.usuario_id = mg.usuario_id
        AND mga.archivo_url = mg.mensaje
       WHERE mg.grupo_id = ?
         AND COALESCE(mg.eliminado, 0) = 0
         AND (mg.mensaje LIKE ? OR mga.nombre_archivo LIKE ?)
       ORDER BY mg.id DESC
       LIMIT ?`,
      [grupoId, like, like, limit]
    );

    res.json({ mensajes: rows });
  } catch (err) {
    console.error("❌ Error al buscar mensajes de grupo:", err);
    res.status(500).json({ error: "Error al buscar mensajes" });
  }
});

router.get("/:grupoId", async (req, res) => {
  await ensureReplyColumn();
  const { grupoId } = req.params;
  const { paginated, limit, beforeId } = getPaginationOptions(req.query);

  try {
    const params = [grupoId];
    let beforeClause = "";

    if (paginated && beforeId) {
      beforeClause = "AND mg.id < ?";
      params.push(beforeId);
    }

    const limitClause = paginated
      ? "ORDER BY mg.id DESC LIMIT ?"
      : "ORDER BY mg.fecha_envio ASC, mg.id ASC";

    if (paginated) {
      params.push(limit + 1);
    }

    // 1️⃣ Traer últimos mensajes del grupo. Con paginación se cargan sólo
    // los últimos N primero, y los anteriores se piden al hacer scroll arriba.
    const [rows] = await db.query(
      `SELECT 
        mg.id,
        mg.grupo_id,
        mg.usuario_id,
        mg.mensaje,
        mg.eliminado,
        mg.fecha_envio,
        mg.editado,
        mg.lote_id,
        mg.reply_to_id,
        mg.reenviado,
        mga.archivo_url,
        mga.tipo_archivo,
        mga.nombre_archivo,
        mga.tamano,
        u.nombre,
        u.apellido,
        u.url_imagen,
        u.background,
        u.correo
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       LEFT JOIN mensajes_grupo_archivos mga
         ON mga.grupo_id = mg.grupo_id
        AND mga.usuario_id = mg.usuario_id
        AND mga.archivo_url = mg.mensaje
       WHERE mg.grupo_id = ?
       ${beforeClause}
       ${limitClause}`,
      params
    );

    const hasMore = paginated && rows.length > limit;
    const mensajes = paginated ? rows.slice(0, limit).reverse() : rows;

    const ids = mensajes.map(m => m.id);

    // 2️⃣ Traer reacciones sólo de los mensajes cargados en esta página
    const [reacciones] =
      ids.length > 0
        ? await db.query(
            `SELECT 
               r.mensaje_grupo_id, 
               r.usuario_id, 
               r.emoji, 
               u.nombre, 
               u.apellido, 
               u.url_imagen, 
               u.background
             FROM reacciones r
             JOIN usuario u ON u.id = r.usuario_id
             WHERE r.mensaje_grupo_id IN (?)`,
            [ids]
          )
        : [[]];

    // 3️⃣ Traer miembros del grupo
    const [miembros] = await db.query(
      `SELECT usuario_id FROM usuario_grupo WHERE grupo_id = ?`,
      [grupoId]
    );
    const miembroIds = miembros.map(m => m.usuario_id);

    // 4️⃣ Contar vistos por mensaje en SQL. Antes se descargaba una fila por
    // usuario y mensaje (hasta miembros × 50), lo que crecía mucho en grupos grandes.
    const [vistosAgregados] = ids.length
      ? await db.query(
          `SELECT mgv.mensaje_id, COUNT(DISTINCT mgv.usuario_id) AS total_vistos
             FROM mensajes_grupo_vistos mgv
             JOIN mensajes_grupo mg ON mg.id = mgv.mensaje_id
            WHERE mgv.mensaje_id IN (?)
              AND mgv.usuario_id <> mg.usuario_id
            GROUP BY mgv.mensaje_id`,
          [ids]
        )
      : [[]];

    const vistosPorMensaje = new Map(
      vistosAgregados.map((row) => [Number(row.mensaje_id), Number(row.total_vistos || 0)])
    );

    // 5️⃣ Traer mensajes fijados (máximo 3). Esto siempre se carga completo,
    // aunque el mensaje fijado no esté dentro de la página actual.
    const [fijados] = await db.query(
      `SELECT 
          mgf.id AS fijado_id,
          mgf.grupo_id,
          mgf.mensaje_id,
          mg.mensaje,
          COALESCE(mga_direct.archivo_url, mga_lote.archivo_url) AS archivo_url,
          COALESCE(mga_direct.tipo_archivo, mga_lote.tipo_archivo) AS tipo_archivo,
          COALESCE(mga_direct.nombre_archivo, mga_lote.nombre_archivo) AS nombre_archivo,
          COALESCE(mga_direct.tamano, mga_lote.tamano) AS tamano,
          mgf.usuario_id AS fijado_por_id,
          u.nombre AS fijado_por_nombre,
          u.apellido AS fijado_por_apellido,
          u.url_imagen AS fijado_por_imagen,
          u.background AS fijado_por_background,
          mgf.fecha_fijado,
          mgf.duracion,
          mgf.fecha_expiracion
       FROM mensajes_grupo_fijados mgf
       JOIN mensajes_grupo mg ON mg.id = mgf.mensaje_id
       LEFT JOIN mensajes_grupo_archivos mga_direct
         ON mga_direct.grupo_id = mg.grupo_id
        AND mga_direct.usuario_id = mg.usuario_id
        AND mga_direct.archivo_url = mg.mensaje
       LEFT JOIN (
         SELECT grupo_id, lote_id, MIN(id) AS media_message_id
         FROM mensajes_grupo
         WHERE lote_id IS NOT NULL AND mensaje LIKE '/uploads/%'
         GROUP BY grupo_id, lote_id
       ) mg_media_idx
         ON mg_media_idx.grupo_id = mg.grupo_id
        AND mg_media_idx.lote_id = mg.lote_id
       LEFT JOIN mensajes_grupo mg_media
         ON mg_media.id = mg_media_idx.media_message_id
       LEFT JOIN mensajes_grupo_archivos mga_lote
         ON mga_lote.grupo_id = mg_media.grupo_id
        AND mga_lote.usuario_id = mg_media.usuario_id
        AND mga_lote.archivo_url = mg_media.mensaje
       JOIN usuario u ON u.id = mgf.usuario_id
       WHERE mgf.grupo_id = ?
       ORDER BY mgf.fecha_fijado ASC
       LIMIT 3`,
      [grupoId]
    );

    const replyMap = await getReplyMessagesByIds(mensajes.map((m) => m.reply_to_id));

    const reaccionesPorMensaje = new Map();
    reacciones.forEach((reaccion) => {
      const key = Number(reaccion.mensaje_grupo_id);
      if (!reaccionesPorMensaje.has(key)) reaccionesPorMensaje.set(key, []);
      reaccionesPorMensaje.get(key).push(reaccion);
    });

    // 6️⃣ Armar los mensajes con reacciones y vistos
    const mensajesConReacciones = mensajes.map(m => {
      const totalOtrosMiembros = miembroIds.reduce(
        (total, id) => total + (Number(id) !== Number(m.usuario_id) ? 1 : 0),
        0
      );
      const totalVistos = vistosPorMensaje.get(Number(m.id)) || 0;
      const visto = totalVistos >= totalOtrosMiembros ? 1 : 0;

      return {
        ...m,
        fecha_envio: m.fecha_envio
          ? new Date(m.fecha_envio.replace(" ", "T") + "Z").toISOString()
          : null,
        reply_to: m.reply_to_id ? replyMap.get(Number(m.reply_to_id)) || null : null,
        visto,
        reacciones: (reaccionesPorMensaje.get(Number(m.id)) || [])
          .map(r => ({
            mensaje_id: r.mensaje_grupo_id,
            usuario_id: r.usuario_id,
            emoji: r.emoji,
            usuario: {
              id: r.usuario_id,
              nombre: r.nombre,
              apellido: r.apellido,
              url_imagen: r.url_imagen,
              background: r.background || "#6c757d"
            }
          }))
      };
    });

    // 7️⃣ Responder con página + datos de paginación
    return res.json({
      mensajes: mensajesConReacciones,
      mensajes_fijados: fijados,
      hasMore,
      nextBeforeId: mensajesConReacciones.length ? mensajesConReacciones[0].id : null,
    });
  } catch (err) {
    console.error("❌ Error al obtener mensajes de grupo:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error en el servidor" });
    }
  }
});

// =======================
// Enviar mensaje a un grupo
// =======================
router.post("/", async (req, res) => {
  const { grupoId, usuarioId, mensaje, loteId, replyToId } = req.body;
  const replyToIdNum = Number(replyToId) || null;

  if (!grupoId || !usuarioId || !mensaje) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const fechaUTC = new Date();
  const fechaEnvioISO = fechaUTC.toISOString();

  const { enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    await ensureReplyColumn();

    const [result] = await queryWithRetry(
      db,
      `INSERT INTO mensajes_grupo (grupo_id, usuario_id, mensaje, fecha_envio, lote_id, reply_to_id, reenviado)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, ?, 0)`,
      [grupoId, usuarioId, mensaje, loteId || null, replyToIdNum],
      { attempts: 4, label: "insertar mensaje de grupo" }
    );

    // Desde aquí el mensaje ya quedó guardado. Todo lo adicional se hace de forma segura
    // para no devolver 500 ni mostrar la alerta falsa en el frontend cuando se responde.
    const [usuario, replyTo] = await Promise.all([
      safeGetUserInfo(usuarioId, "usuario mensaje de grupo"),
      safeGetReplyMessageById(replyToIdNum, "envío de grupo"),
    ]);

    const nuevoMensaje = {
      id: result.insertId,
      grupo_id: Number(grupoId),
      usuario_id: Number(usuarioId),
      mensaje,
      eliminado: 0,
      fecha_envio: fechaEnvioISO,
      editado: 0,
      correo: usuario.correo || null,
      lote_id: loteId || null,
      reply_to_id: replyToIdNum,
      reply_to: replyTo,
      reenviado: 0,
      nombre: usuario.nombre || null,
      apellido: usuario.apellido || null,
      url_imagen: usuario.url_imagen || null,
      background: usuario.background || null,
    };

    // Respondemos antes de consultar miembros y emitir sockets. Si esa parte falla,
    // el frontend ya recibió que el mensaje se guardó correctamente.
    res.status(201).json(nuevoMensaje);
    emitGroupMessageAfterResponse(grupoId, enviarEventoAlUsuario, nuevoMensaje);
    return;
  } catch (err) {
    console.error("❌ Error al enviar mensaje de grupo:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error en el servidor" });
    }
  }
});

// =======================
// Marcar mensajes de grupo como vistos
// =======================
router.put("/marcar-vistos-grupo", async (req, res) => {
  const { userId, grupoId } = req.body;

  if (!userId || !grupoId) {
    return res.status(400).json({ error: "Faltan parámetros userId y grupoId" });
  }

  const io = req.app.get("io");
  const { enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    const { idsMarcados, totalActualizados } = await markGroupMessagesAsSeen(grupoId, userId);

    if (!idsMarcados.length) {
      enviarEventoAlUsuario(userId, "actualizarNoVistosGrupo", {
        grupoId,
        reset: true,
      });
      return res.json({ success: true, actualizados: 0 });
    }

    enviarEventoAlUsuario(userId, "actualizarNoVistosGrupo", {
      grupoId,
      reset: true,
    });

    const [[ultimoMensaje]] = await queryWithRetry(
      db,
      `SELECT id, usuario_id AS creadorId 
       FROM mensajes_grupo 
       WHERE grupo_id = ? ORDER BY fecha_envio DESC LIMIT 1`,
      [grupoId],
      { attempts: 3, label: "obtener ultimo mensaje de grupo" }
    );

    if (ultimoMensaje) {
      const [[{ totalMiembros }]] = await queryWithRetry(
        db,
        `SELECT COUNT(*) AS totalMiembros 
         FROM usuario_grupo 
         WHERE grupo_id = ? AND usuario_id != ?`,
        [grupoId, ultimoMensaje.creadorId],
        { attempts: 3, label: "contar miembros del grupo" }
      );

      const [[{ vistos }]] = await queryWithRetry(
        db,
        `SELECT COUNT(DISTINCT usuario_id) AS vistos 
         FROM mensajes_grupo_vistos 
         WHERE mensaje_id = ?
           AND usuario_id <> ?`,
        [ultimoMensaje.id, ultimoMensaje.creadorId],
        { attempts: 3, label: "contar vistos del ultimo mensaje de grupo" }
      );

      if (vistos === totalMiembros) {
        io.to(`grupo_${grupoId}`).emit("todosMensajesVistosGrupo", {
          grupoId,
          mensajeId: ultimoMensaje.id,
        });

        logDev(`✅ Todos los miembros vieron el mensaje ${ultimoMensaje.id} del grupo ${grupoId}`);
      }
    }

    res.json({ success: true, actualizados: totalActualizados });
  } catch (err) {
    console.error("❌ Error al marcar mensajes de grupo como vistos:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Añadir / quitar reacción (CHAT GRUPAL)
// =======================
router.post("/reaccion", async (req, res) => {
  logDev("➡️ [BACK] Reacción de grupo recibida:", req.body);
  const { mensajeGrupoId, usuarioId, emoji } = req.body;

  if (!mensajeGrupoId || !usuarioId || !emoji) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  try {
    // 1) Toggle en la tabla reacciones (mensaje_grupo_id)
    const [rows] = await db.query(
      "SELECT id FROM reacciones WHERE mensaje_grupo_id = ? AND usuario_id = ? AND emoji = ?",
      [mensajeGrupoId, usuarioId, emoji]
    );

    let accion;
    if (rows.length > 0) {
      await db.query("DELETE FROM reacciones WHERE id = ?", [rows[0].id]);
      accion = "eliminada";
    } else {
      await db.query(
        "INSERT INTO reacciones (mensaje_grupo_id, usuario_id, emoji) VALUES (?, ?, ?)",
        [mensajeGrupoId, usuarioId, emoji]
      );
      accion = "agregada";
    }

    // 2) Obtener datos del usuario que reaccionó para enviar en el payload
    const [rowsUser] = await db.query(
      "SELECT id, nombre, apellido, url_imagen, background FROM usuario WHERE id = ?",
      [usuarioId]
    );
    const usuarioData = rowsUser[0] || null;

    // 3) Obtener el grupo al que pertenece el mensaje grupal
    //    Asumo que tu tabla de mensajes grupales se llama `mensajes_grupo`
    //    y tiene una columna `grupo_id`. Ajusta el SELECT si tu columna tiene otro nombre.
    const [rowsMsg] = await db.query(
      "SELECT grupo_id FROM mensajes_grupo WHERE id = ?",
      [mensajeGrupoId]
    );

    if (!rowsMsg || rowsMsg.length === 0) {
      console.warn("⚠️ No se encontró el mensaje grupal:", mensajeGrupoId);
      return res.status(404).json({ error: "Mensaje de grupo no encontrado" });
    }

    const grupoId = rowsMsg[0].grupo_id;

    // 4) Emitir a la sala del grupo correcto
    const io = req.app.get("io");
    if (io) {
      const payload = {
        mensajeGrupoId,
        usuarioId,
        emoji,
        accion,
        usuario: usuarioData,
        grupoId, // útil para el frontend
      };

      logDev("🚀 Emitiendo reaccionActualizadaGrupo a sala grupo_%s:", grupoId, payload);
      io.to(`grupo_${grupoId}`).emit("reaccionActualizadaGrupo", payload);
    }

    return res.json({ success: true, accion });
  } catch (err) {
    console.error("❌ Error en /reaccion (grupo):", err);
    return res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Eliminar (lógico)
// =======================
router.put("/:id/eliminar", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  const io = req.app.get("io");

  try {
    if (!(await usuarioPuedeEliminarMensajes(usuarioId))) {
      return res.status(403).json({ error: "No tienes permiso para eliminar mensajes" });
    }

    await db.query(
      `UPDATE mensajes_grupo SET eliminado = 1 WHERE id = ? AND usuario_id = ?`,
      [id, usuarioId]
    );

    const [rows] = await db.query(`SELECT * FROM mensajes_grupo WHERE id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    const msg = rows[0];

    io.to(`grupo_${msg.grupo_id}`).emit("mensajeEliminadoGrupo", msg);

    return res.json({ success: true, id: msg.id });
  } catch (err) {
    console.error("❌ Error eliminando mensaje de grupo:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error eliminando mensaje de grupo" });
    }
  }
});

// =======================
// Deshacer eliminación
// =======================
router.put("/:id/deshacer", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  const io = req.app.get("io");

  try {
    // Restaurar/deshacer un mensaje propio NO depende del permiso
    // eliminar_mensajes. El permiso solo controla la acción de eliminar.
    await db.query(
      `UPDATE mensajes_grupo SET eliminado = 0 WHERE id = ? AND usuario_id = ?`,
      [id, usuarioId]
    );

    const [rows] = await db.query(`SELECT * FROM mensajes_grupo WHERE id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const msg = rows[0];

    const fechaEnvioISO = msg.fecha_envio
      ? new Date(msg.fecha_envio.replace(" ", "T") + "Z").toISOString()
      : null;

    io.to(`grupo_${msg.grupo_id}`).emit("mensajeDeshechoGrupo", {
      ...msg,
      fecha_envio: fechaEnvioISO
    });

    return res.json({ success: true, mensaje: msg });
  } catch (err) {
    console.error("❌ Error deshaciendo mensaje de grupo:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Error deshaciendo mensaje de grupo" });
    }
  }
});

// =======================
// Editar mensaje en grupo
// =======================
router.put("/:id/editar", async (req, res) => {
  const { id } = req.params;
  const { usuarioId, nuevoTexto } = req.body;

  if (!nuevoTexto) return res.status(400).json({ error: "Falta el nuevo texto" });

  const io = req.app.get("io");

  try {
    const [rows] = await db.query(`SELECT * FROM mensajes_grupo WHERE id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const mensajeActual = rows[0];
    if (mensajeActual.usuario_id !== usuarioId) return res.status(403).json({ error: "No autorizado" });

    if (!(await usuarioPuedeEditarMensajes(usuarioId))) {
      return res.status(403).json({ error: "No tienes permiso para editar mensajes" });
    }

    const fechaOriginal = mensajeActual.fecha_editado || mensajeActual.fecha_envio;

    await db.query(
      `INSERT INTO mensajes_editados (mensaje_id, es_grupo, usuario_id, texto_original, fecha_original, fecha_edicion)
       VALUES (?, 1, ?, ?, ?, UTC_TIMESTAMP())`,
      [id, usuarioId, mensajeActual.mensaje, fechaOriginal]
    );

    await db.query(
      `UPDATE mensajes_grupo
       SET mensaje = ?, editado = 1, fecha_editado = UTC_TIMESTAMP()
       WHERE id = ?`,
      [nuevoTexto, id]
    );

    const [rowsActualizados] = await db.query(
      `SELECT mg.*, u.nombre, u.apellido, u.url_imagen, u.background
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       WHERE mg.id = ?`,
      [id]
    );

    const mensajeConUTC = {
      ...rowsActualizados[0],
      fecha_envio: rowsActualizados[0].fecha_envio
        ? new Date(rowsActualizados[0].fecha_envio + "Z").toISOString()
        : null,
      fecha_editado: rowsActualizados[0].fecha_editado
        ? new Date(rowsActualizados[0].fecha_editado + "Z").toISOString()
        : null,
    };

    io.to(`grupo_${mensajeActual.grupo_id}`).emit("mensajeEditadoGrupo", {
      ...mensajeConUTC,
      grupoId: mensajeActual.grupo_id,
    });

    return res.json({ success: true, mensaje: mensajeConUTC });

  } catch (err) {
    console.error("❌ Error editando mensaje de grupo:", err);
    if (!res.headersSent) return res.status(500).json({ error: "Error editando mensaje de grupo" });
  }
});

// =======================
// Historial de ediciones
// =======================
router.get("/:id/historial", async (req, res) => {
  const { id } = req.params;

  try {
    // 1️⃣ Mensaje original
    const [mensajeOriginalArr] = await db.query(
      `SELECT mg.*, u.nombre, u.apellido, u.url_imagen, u.background
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       WHERE mg.id = ?`,
      [id]
    );

    if (!mensajeOriginalArr.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const mensajeOriginal = mensajeOriginalArr[0];
    // Si el mensaje fue editado, usamos fecha_editado; sino fecha_envio
    const fechaMensaje = mensajeOriginal.fecha_editado || mensajeOriginal.fecha_envio;

    const mensajeOriginalUTC = {
      id: mensajeOriginal.id,
      mensaje_id: mensajeOriginal.id,
      texto_original: mensajeOriginal.mensaje,
      fecha: fechaMensaje ? new Date(fechaMensaje + "Z").toISOString() : null,
      usuario_id: mensajeOriginal.usuario_id,
      nombre: mensajeOriginal.nombre,
      apellido: mensajeOriginal.apellido,
      url_imagen: mensajeOriginal.url_imagen,
      background: mensajeOriginal.background,
      es_original: true
    };

    // 2️⃣ Traer historial de ediciones incluyendo fecha_original
    const [historial] = await db.query(
      `SELECT me.*, u.nombre, u.apellido, u.url_imagen, u.background
       FROM mensajes_editados me
       JOIN usuario u ON u.id = me.usuario_id
       WHERE me.mensaje_id = ? AND me.es_grupo = 1
       ORDER BY me.fecha_edicion ASC`,
      [id]
    );

    const historialUTC = historial.map(h => ({
      id: h.id,
      mensaje_id: h.mensaje_id,
      texto_original: h.texto_original,
      fecha: h.fecha_original ? new Date(h.fecha_original + "Z").toISOString() : null,
      fecha_edicion: h.fecha_edicion ? new Date(h.fecha_edicion + "Z").toISOString() : null,
      usuario_id: h.usuario_id,
      nombre: h.nombre,
      apellido: h.apellido,
      url_imagen: h.url_imagen,
      background: h.background,
      es_original: false
    }));

    // 3️⃣ Unir mensaje original + historial
    const historialCompleto = [...historialUTC, mensajeOriginalUTC];

    return res.json(historialCompleto);

  } catch (err) {
    console.error("❌ Error obteniendo historial de grupo:", err);
    if (!res.headersSent) return res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// 📌 Fijar o Desfijar mensaje en Grupo
// =======================
router.post("/fijar", async (req, res) => {
  const { grupo_id, mensaje_id, usuario_id, duracion = "24h" } = req.body;

  logDev("📩 Datos recibidos para fijar:", req.body);

  if (!grupo_id || !mensaje_id || !usuario_id) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  try {
    // 1️⃣ Verificar si el mensaje ya está fijado
    const [rows] = await db.query(
      "SELECT id FROM mensajes_grupo_fijados WHERE mensaje_id = ? AND grupo_id = ?",
      [mensaje_id, grupo_id]
    );

    let accion;
    let fechaFijadoMySQL = null;
    let fechaExpMySQL = null;

    if (rows.length > 0) {
      // 🔸 Desfijar
      await db.query("DELETE FROM mensajes_grupo_fijados WHERE mensaje_id = ? AND grupo_id = ?", [mensaje_id, grupo_id]);
      await db.query("UPDATE mensajes_grupo SET fijado = 0 WHERE id = ?", [mensaje_id]);
      accion = "desfijado";
    } else {
      // 🔹 Fijar (máximo 3 por grupo)
      const [fijadosExistentes] = await db.query(
        "SELECT id FROM mensajes_grupo_fijados WHERE grupo_id = ? ORDER BY fecha_fijado ASC",
        [grupo_id]
      );

      if (fijadosExistentes.length >= 3) {
        // Eliminar el más antiguo
        const masAntiguoId = fijadosExistentes[0].id;
        await db.query("DELETE FROM mensajes_grupo_fijados WHERE id = ?", [masAntiguoId]);
      }

      // Calcular fechas
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
        "INSERT INTO mensajes_grupo_fijados (grupo_id, mensaje_id, usuario_id, fecha_fijado, duracion, fecha_expiracion) VALUES (?, ?, ?, ?, ?, ?)",
        [grupo_id, mensaje_id, usuario_id, fechaFijadoMySQL, duracion, fechaExpMySQL]
      );

      await db.query("UPDATE mensajes_grupo SET fijado = 1 WHERE id = ?", [mensaje_id]);
      accion = "fijado";
    }

    // 2️⃣ Obtener datos del mensaje y usuario
    const [[msgData]] = await db.query(
      `SELECT mg.id, mg.mensaje, mg.usuario_id, mg.grupo_id, mg.fijado,
              u.nombre AS usuario_nombre, u.apellido AS usuario_apellido, u.url_imagen, u.background
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       WHERE mg.id = ?`,
      [mensaje_id]
    );

    const [[usrData]] = await db.query(
      "SELECT id, nombre, apellido, url_imagen, background FROM usuario WHERE id = ?",
      [usuario_id]
    );

    // 3️⃣ Emitir actualización a todos los miembros del grupo
    const io = req.app.get("io");
    const payload = {
      accion,
      grupo_id,
      mensaje_id,
      usuario_id,
      usuario: usrData,
      mensaje: msgData,
      fijado: accion === "fijado",
      duracion: accion === "fijado" ? duracion : null,
      fecha_fijado: accion === "fijado" ? new Date(fechaFijadoMySQL + "Z").toISOString() : null,
      fecha_expiracion: accion === "fijado" ? new Date(fechaExpMySQL + "Z").toISOString() : null,
    };

    io.to(`grupo_${grupo_id}`).emit("mensajeFijadoGrupo", payload);

    res.json({ success: true, accion, payload });
  } catch (err) {
    console.error("❌ Error al fijar mensaje de grupo:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});


// =======================
// 📋 Obtener mensajes fijados de un grupo
// =======================
router.get("/fijados/:grupoId", async (req, res) => {
  const { grupoId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT 
         mgf.id,
         mgf.grupo_id,
         mgf.mensaje_id,
         mgf.usuario_id AS fijado_por_id,
         mgf.fecha_fijado,
         mgf.duracion,
         mgf.fecha_expiracion,
         mg.mensaje,
         COALESCE(mga_direct.archivo_url, mga_lote.archivo_url) AS archivo_url,
         COALESCE(mga_direct.tipo_archivo, mga_lote.tipo_archivo) AS tipo_archivo,
         COALESCE(mga_direct.nombre_archivo, mga_lote.nombre_archivo) AS nombre_archivo,
         COALESCE(mga_direct.tamano, mga_lote.tamano) AS tamano,
         mg.usuario_id AS autor_id,
         ua.nombre AS autor_nombre,
         ua.apellido AS autor_apellido,
         ua.url_imagen AS autor_imagen,
         uf.nombre AS fijado_por_nombre,
         uf.apellido AS fijado_por_apellido,
         uf.url_imagen AS fijado_por_imagen
       FROM mensajes_grupo_fijados mgf
       JOIN mensajes_grupo mg ON mg.id = mgf.mensaje_id
       LEFT JOIN mensajes_grupo_archivos mga_direct
         ON mga_direct.grupo_id = mg.grupo_id
        AND mga_direct.usuario_id = mg.usuario_id
        AND mga_direct.archivo_url = mg.mensaje
       LEFT JOIN (
         SELECT grupo_id, lote_id, MIN(id) AS media_message_id
         FROM mensajes_grupo
         WHERE lote_id IS NOT NULL AND mensaje LIKE '/uploads/%'
         GROUP BY grupo_id, lote_id
       ) mg_media_idx
         ON mg_media_idx.grupo_id = mg.grupo_id
        AND mg_media_idx.lote_id = mg.lote_id
       LEFT JOIN mensajes_grupo mg_media
         ON mg_media.id = mg_media_idx.media_message_id
       LEFT JOIN mensajes_grupo_archivos mga_lote
         ON mga_lote.grupo_id = mg_media.grupo_id
        AND mga_lote.usuario_id = mg_media.usuario_id
        AND mga_lote.archivo_url = mg_media.mensaje
       JOIN usuario ua ON ua.id = mg.usuario_id
       JOIN usuario uf ON uf.id = mgf.usuario_id
       WHERE mgf.grupo_id = ?
       ORDER BY mgf.fecha_fijado ASC`,
      [grupoId]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener mensajes fijados de grupo:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// =======================
// 📤 Subir archivo a un grupo (con subcarpetas dinámicas)
// =======================
router.post("/archivo", uploadArchivoConMiniatura, async (req, res) => {
  try {
    const grupo_id = Number(req.body.grupo_id || req.query.grupo_id);
    const usuario_id = Number(req.body.usuario_id || req.query.usuario_id);
    const loteId =
      req.body.loteId ||
      req.body.lote_id ||
      req.query.loteId ||
      req.query.lote_id ||
      null;
    const replyToIdNum = Number(req.body.replyToId || req.query.replyToId) || null;

    if (!grupo_id || !usuario_id || isNaN(grupo_id) || isNaN(usuario_id)) {
      console.error("❌ grupo_id o usuario_id inválido:", grupo_id, usuario_id);
      return res.status(400).json({ error: "Datos inválidos en la solicitud" });
    }

    const file = req.files?.archivo?.[0] || null;
    let thumbnailFile = req.files?.miniatura?.[0] || null;

    if (!file) {
      return res.status(400).json({ error: "No se recibió ningún archivo" });
    }

    const mainIsImage = String(file.mimetype || "").toLowerCase().startsWith("image/");
    if (thumbnailFile && (!mainIsImage || thumbnailFile.mimetype !== "image/webp")) {
      eliminarArchivoTemporal(thumbnailFile);
      thumbnailFile = null;
    }

    if (esNotaVozGrabada(req, file) && !(await usuarioPuedeEnviarAudios(usuario_id))) {
      eliminarArchivoTemporal(file);
      eliminarArchivoTemporal(thumbnailFile);
      return res.status(403).json({
        error: "No tienes permiso para grabar audios. Solicita autorización a un administrador.",
      });
    }

    const preparedFile = await optimizeUploadedAudio(file, {
      isVoiceNote: esNotaVozGrabada(req, file),
    });

    // 📁 Ruta relativa final tipo: /uploads/grupo_51/archivos/....
    const relativePath = path.relative(
      path.join(__dirname, "../uploads"),
      preparedFile.path
    );
    const urlArchivo = `/uploads/${relativePath.replace(/\\/g, "/")}`;

    const miniaturaUrl = thumbnailFile?.path
      ? `/uploads/${path.relative(
          path.join(__dirname, "../uploads"),
          thumbnailFile.path
        ).replace(/\\/g, "/")}`
      : null;

    // 1️⃣ Crear mensaje en mensajes_grupo (mensaje = ruta de la imagen)
    await ensureReplyColumn();

    const [resultadoMsg] = await queryWithRetry(
      db,
      `INSERT INTO mensajes_grupo (grupo_id, usuario_id, mensaje, fecha_envio, lote_id, reply_to_id)
      VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?, ?)`,
      [grupo_id, usuario_id, urlArchivo, loteId || null, replyToIdNum],
      { attempts: 4, label: "insertar mensaje archivo de grupo" }
    );
    const mensajeId = resultadoMsg.insertId;

    // 2️⃣ Guardar metadatos en mensajes_grupo_archivos
    await queryWithRetry(
      db,
      `INSERT INTO mensajes_grupo_archivos 
        (grupo_id, usuario_id, archivo_url, tipo_archivo, nombre_archivo, tamano, lote_id, fecha_envio)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [grupo_id, usuario_id, urlArchivo, preparedFile.mimetype, file.originalname, preparedFile.size, loteId || null],
      { attempts: 4, label: "insertar archivo de grupo" }
    );

    // 3️⃣ Info del usuario y respuesta citada. Esto ya no puede romper la respuesta HTTP,
    // porque el archivo y el mensaje ya quedaron guardados.
    const [usuarioInfo, replyTo] = await Promise.all([
      safeGetUserInfo(usuario_id, "usuario archivo de grupo"),
      safeGetReplyMessageById(replyToIdNum, "archivo de grupo"),
    ]);

    // 4️⃣ Objeto mensaje que entiende el front
    const mensaje = {
      id: mensajeId,
      grupo_id,
      usuario_id,
      mensaje: urlArchivo,
      archivo_url: urlArchivo,
      miniatura_url: miniaturaUrl,
      tipo_archivo: preparedFile.mimetype,
      nombre_archivo: file.originalname,
      tamano: preparedFile.size,
      eliminado: 0,
      editado: 0,
      fijado: 0,
      fecha_envio: new Date().toISOString(),
      lote_id: loteId || null,
      reply_to_id: replyToIdNum,
      reply_to: replyTo,
      nombre: usuarioInfo.nombre || null,
      apellido: usuarioInfo.apellido || null,
      correo: usuarioInfo.correo || null,
      url_imagen: usuarioInfo.url_imagen || null,
      background: usuarioInfo.background || null,
    };

    // Respondemos antes de emitir por socket para evitar alertas falsas.
    res.json({ success: true, mensaje });

    const io = req.app.get("io");
    if (io) {
      try {
        io.to(`grupo_${grupo_id}`).emit("nuevoMensajeGrupo", mensaje);
      } catch (emitErr) {
        console.warn("⚠️ No se pudo emitir archivo de grupo por socket:", emitErr?.message || emitErr);
      }
    }
    return;
  } catch (err) {
    console.error("❌ Error al subir archivo:", err);
    res.status(500).json({ error: "Error al subir archivo" });
  }
});
module.exports = router;