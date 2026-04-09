const express = require("express");
const router = express.Router();
const db = require("../db");
const { logDev } = require("../utils/logger");

function formatDateToMySQL(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
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

router.get("/", async (req, res) => {
  try {
    const { usuario1, usuario2 } = req.query;

    if (!usuario1 || !usuario2) {
      return res.status(400).json({ error: "Faltan parámetros usuario1 y usuario2" });
    }

    const sqlMensajes = `
      SELECT 
        m.id,
        m.usuario_envia_id,
        m.usuario_recibe_id,
        m.mensaje,
        m.lote_id,
        m.fecha_envio,
        m.eliminado,
        m.editado,
        m.visto,
        m.fijado,
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
      WHERE (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
         OR (m.usuario_envia_id = ? AND m.usuario_recibe_id = ?)
      ORDER BY m.fecha_envio ASC
    `;

    const [mensajes] = await db.query(sqlMensajes, [usuario1, usuario2, usuario2, usuario1]);

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

    const mensajesConReacciones = mensajes.map((m) => ({
      ...m,
      fijado: !!m.fijado,
      fecha_envio: m.fecha_envio
        ? new Date(m.fecha_envio.replace(" ", "T") + "Z").toISOString()
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
  const { message, loteId } = req.body;

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
    const [result] = await db.query(
      `INSERT INTO mensajes 
        (usuario_envia_id, usuario_recibe_id, mensaje, lote_id, fecha_envio, fijado)
      VALUES (?, ?, ?, ?, ?, 0)`,
      [senderId, receiverId, message, loteId || null, fechaEnvioMySQL]
    );

    const [senderInfo] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [senderId]
    );
    const sender = senderInfo[0];

    const [receiverInfo] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [receiverId]
    );
    const receiver = receiverInfo[0];

    const nuevoMensaje = {
      id: result.insertId,
      usuario_envia_id: senderId,
      usuario_recibe_id: receiverId,
      mensaje: message,
      lote_id: loteId || null,
      fecha_envio: fechaEnvioISO,
      fecha_envio_db: fechaEnvioMySQL,
      editado: 0,
      visto: 0,
      fijado: false,
      emisor_nombre: sender.nombre,
      emisor_apellido: sender.apellido,
      emisor_correo: sender.correo,
      emisor_avatar: sender.url_imagen,
      emisor_background: sender.background,
      receptor_nombre: receiver.nombre,
      receptor_apellido: receiver.apellido,
      receptor_correo: receiver.correo,
      receptor_avatar: receiver.url_imagen,
      receptor_background: receiver.background,
      reacciones: [],
    };

    const [rowsReacciones] = await db.query(
      `SELECT * FROM reacciones WHERE mensaje_id = ?`,
      [result.insertId]
    );
    logDev("🔹 Reacciones del mensaje recién creado:", rowsReacciones);

    logDev("📦 Mensaje listo para emitir:", nuevoMensaje);

    enviarEventoAlUsuario(senderId, "nuevoMensaje", nuevoMensaje);
    enviarEventoAlUsuario(receiverId, "nuevoMensaje", nuevoMensaje);

    res.status(201).json(nuevoMensaje);
  } catch (err) {
    console.error("❌ Error al insertar mensaje:", err);
    res.status(500).json({ error: "Error al guardar mensaje" });
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
    const [result] = await db.query(
      `UPDATE mensajes 
       SET visto = 1 
       WHERE usuario_envia_id = ? 
         AND usuario_recibe_id = ? 
         AND visto = 0`,
      [contactoId, userId]
    );

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    const payload = { emisorId: contactoId, receptorId: userId };

    enviarEventoAlUsuario(contactoId, "mensajesVistos", payload);
    enviarEventoAlUsuario(userId, "mensajesVistos", payload);

    res.json({ success: true, actualizados: result.affectedRows });
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

    if (!sender_id || !receiver_id || isNaN(sender_id) || isNaN(receiver_id)) {
      console.error("❌ sender_id o receiver_id inválido:", sender_id, receiver_id);
      return res.status(400).json({ success: false, error: "Datos inválidos en la solicitud" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "No se recibió ningún archivo" });
    }

    const relativePath = path.relative(
      path.join(__dirname, "../uploads"),
      file.path
    );

    const urlArchivo = `/uploads/${relativePath.replace(/\\/g, "/")}`;

    const fechaUTC = new Date();
    const fechaEnvioMySQL = formatDateToMySQL(fechaUTC);
    const fechaEnvioISO = fechaUTC.toISOString();

    const [resultadoArchivo] = await db.query(
      `INSERT INTO mensajes_archivos 
        (sender_id, receiver_id, archivo_url, tipo_archivo, nombre_archivo, tamano, fecha_envio, lote_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sender_id, receiver_id, urlArchivo, file.mimetype, file.originalname, file.size, fechaEnvioMySQL, loteId]
    );

    const [resultadoMensaje] = await db.query(
      `INSERT INTO mensajes 
        (usuario_envia_id, usuario_recibe_id, mensaje, lote_id, fecha_envio, fijado)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [sender_id, receiver_id, urlArchivo, loteId || null, fechaEnvioMySQL]
    );

    const [[emisor]] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [sender_id]
    );

    const [[receptor]] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [receiver_id]
    );

    const mensaje = {
      id: resultadoMensaje.insertId,
      usuario_envia_id: sender_id,
      usuario_recibe_id: receiver_id,
      mensaje: urlArchivo,
      lote_id: loteId || null,
      fecha_envio: fechaEnvioISO,
      editado: 0,
      eliminado: 0,
      visto: 0,
      fijado: false,
      archivo_url: urlArchivo,
      tipo_archivo: file.mimetype,
      nombre_archivo: file.originalname,
      tamano: file.size,
      emisor_nombre: emisor.nombre,
      emisor_apellido: emisor.apellido,
      emisor_correo: emisor.correo,
      emisor_avatar: emisor.url_imagen,
      emisor_background: emisor.background,
      receptor_nombre: receptor.nombre,
      receptor_apellido: receptor.apellido,
      receptor_correo: receptor.correo,
      receptor_avatar: receptor.url_imagen,
      receptor_background: receptor.background,
      reacciones: [],
    };

    const { enviarEventoAlUsuario } = req.app.get("socketUtils");

    enviarEventoAlUsuario(sender_id, "nuevoMensaje", mensaje);
    enviarEventoAlUsuario(receiver_id, "nuevoMensaje", mensaje);

    res.json({
      success: true,
      mensaje,
      archivo_id: resultadoArchivo.insertId,
    });
  } catch (err) {
    console.error("❌ Error al subir archivo privado:", err);
    res.status(500).json({ success: false, error: "Error al subir archivo" });
  }
});

module.exports = router;