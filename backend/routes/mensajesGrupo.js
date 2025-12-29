const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { enviarEventoAlUsuario } = require("../utils/socketUtils");

// =======================
// Helper: formato UTC para MySQL
// =======================
function formatDateToMySQL(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
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
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 70 * 1024 * 1024 }, // 70 MB
});

// =======================
// Obtener mensajes de un grupo (con fijados)
// =======================
router.get("/:grupoId", async (req, res) => {
  const { grupoId } = req.params;

  try {
    // 1️⃣ Traer mensajes del grupo
    const [mensajes] = await db.query(
      `SELECT 
        mg.id,
        mg.grupo_id,
        mg.usuario_id,
        mg.mensaje,
        mg.eliminado,
        mg.fecha_envio,
        mg.editado,
        mg.lote_id,
        u.nombre,
        u.apellido,
        u.url_imagen,
        u.background,
        u.correo
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       WHERE mg.grupo_id = ?
       ORDER BY mg.fecha_envio ASC`,
      [grupoId]
    );

    if (mensajes.length === 0) {
      return res.json({
        mensajes: [],
        mensajes_fijados: []
      });
    }

    const ids = mensajes.map(m => m.id);

    // 2️⃣ Traer reacciones
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

    // 4️⃣ Traer vistos
    const [vistos] = ids.length
      ? await db.query(
          `SELECT mensaje_id, usuario_id 
             FROM mensajes_grupo_vistos 
            WHERE mensaje_id IN (?)`,
          [ids]
        )
      : [[]];

    // 5️⃣ Traer mensajes fijados (máximo 3)
    const [fijados] = await db.query(
      `SELECT 
          mgf.id AS fijado_id,
          mgf.grupo_id,
          mgf.mensaje_id,
          mg.mensaje,
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
       JOIN usuario u ON u.id = mgf.usuario_id
       WHERE mgf.grupo_id = ?
       ORDER BY mgf.fecha_fijado ASC
       LIMIT 3`,
      [grupoId]
    );

    // 6️⃣ Armar los mensajes con reacciones y vistos
    const mensajesConReacciones = mensajes.map(m => {
      const vistosMensaje = vistos
        .filter(v => v.mensaje_id === m.id)
        .map(v => v.usuario_id);

      const otrosMiembros = miembroIds.filter(id => id !== m.usuario_id);
      const visto = otrosMiembros.every(id => vistosMensaje.includes(id)) ? 1 : 0;

      return {
        ...m,
        fecha_envio: m.fecha_envio
          ? new Date(m.fecha_envio.replace(" ", "T") + "Z").toISOString()
          : null,
        visto,
        reacciones: reacciones
          .filter(r => r.mensaje_grupo_id === m.id)
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

    // 7️⃣ Responder con ambos conjuntos de datos
    return res.json({
      mensajes: mensajesConReacciones,
      mensajes_fijados: fijados
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
  const { grupoId, usuarioId, mensaje, loteId } = req.body; // 👈 leemos loteId OPCIONAL

  if (!grupoId || !usuarioId || !mensaje) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const fechaUTC = new Date();
  const fechaEnvioMySQL = formatDateToMySQL(fechaUTC);
  const fechaEnvioISO = fechaUTC.toISOString();

  const io = req.app.get("io");
  const { usuariosConectados, enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    const [result] = await db.query(
      `INSERT INTO mensajes_grupo (grupo_id, usuario_id, mensaje, fecha_envio, lote_id)
      VALUES (?, ?, ?, ?, ?)`,
      [grupoId, usuarioId, mensaje, fechaEnvioMySQL, loteId || null]  // 👈 puede ser null
    );

    const [usuarioInfo] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [usuarioId]
    );
    const usuario = usuarioInfo[0];

    const nuevoMensaje = {
      id: result.insertId,
      grupo_id: grupoId,
      usuario_id: usuarioId,
      mensaje,
      eliminado: 0,
      fecha_envio: fechaEnvioISO,
      editado: 0,
      correo: usuario.correo,
      lote_id: loteId || null,  // 👈 MUY IMPORTANTE
      ...usuario,
    };

    // Emitir mensaje a todos los miembros del grupo conectados
    const [miembros] = await db.query(
      "SELECT usuario_id FROM usuario_grupo WHERE grupo_id = ?",
      [grupoId]
    );

    miembros.forEach(({ usuario_id }) => {
      enviarEventoAlUsuario(io, usuariosConectados, usuario_id, "nuevoMensajeGrupo", nuevoMensaje);
    });

    return res.status(201).json(nuevoMensaje);
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
  const { usuariosConectados, enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    // 1️⃣ Traer todos los mensajes del grupo que NO fueron enviados por el mismo usuario
    const [mensajes] = await db.query(
      `SELECT id 
       FROM mensajes_grupo 
       WHERE grupo_id = ? AND usuario_id != ?`,
      [grupoId, userId]
    );

    if (mensajes.length === 0) {
      return res.json({ success: true, actualizados: 0 });
    }

    // 2️⃣ Insertar en la tabla de vistos (si no existe, ignora)
    const values = mensajes.map((m) => [m.id, userId]);
    await db.query(
      `INSERT IGNORE INTO mensajes_grupo_vistos (mensaje_id, usuario_id) VALUES ?`,
      [values]
    );

    // 3️⃣ Emitir evento a todos los miembros conectados del grupo para actualizar vistos
    mensajes.forEach((m) => {
      io.to(`grupo_${grupoId}`).emit("mensajesVistosGrupo", { grupoId, userId, mensajeId: m.id });
    });

    // 🔹 Resetear contador de no vistos del usuario que abrió el chat
    enviarEventoAlUsuario(io, usuariosConectados, userId, "actualizarNoVistosGrupo", {
      grupoId,
      reset: true,
    });

    // 4️⃣ Verificar si todos los miembros vieron el último mensaje
    const [[ultimoMensaje]] = await db.query(
      `SELECT id, usuario_id AS creadorId 
       FROM mensajes_grupo 
       WHERE grupo_id = ? ORDER BY fecha_envio DESC LIMIT 1`,
      [grupoId]
    );

    if (ultimoMensaje) {
      // Contar miembros (todos menos el remitente del mensaje)
      const [[{ totalMiembros }]] = await db.query(
        `SELECT COUNT(*) AS totalMiembros FROM usuario_grupo WHERE grupo_id = ? AND usuario_id != ?`,
        [grupoId, ultimoMensaje.creadorId]
      );

      // Contar usuarios que vieron el mensaje (sin contar al creador)
      const [[{ vistos }]] = await db.query(
        `SELECT COUNT(DISTINCT usuario_id) AS vistos 
         FROM mensajes_grupo_vistos 
         WHERE mensaje_id = ?`,
        [ultimoMensaje.id]
      );

      // Si todos los miembros vieron → emitir evento global
      if (vistos === totalMiembros) {
        io.to(`grupo_${grupoId}`).emit("todosMensajesVistosGrupo", {
          grupoId,
          mensajeId: ultimoMensaje.id,
        });

        console.log(`✅ Todos los miembros vieron el mensaje ${ultimoMensaje.id} del grupo ${grupoId}`);
      }
    }

    res.json({ success: true, actualizados: mensajes.length });
  } catch (err) {
    console.error("❌ Error al marcar mensajes de grupo como vistos:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Añadir / quitar reacción (CHAT GRUPAL)
// =======================
router.post("/reaccion", async (req, res) => {
  console.log("➡️ [BACK] Reacción de grupo recibida:", req.body);
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

      console.log("🚀 Emitiendo reaccionActualizadaGrupo a sala grupo_%s:", grupoId, payload);
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
  const { usuariosConectados, enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    await db.query(
      `UPDATE mensajes_grupo SET eliminado = 1 WHERE id = ? AND usuario_id = ?`,
      [id, usuarioId]
    );

    const [rows] = await db.query(`SELECT * FROM mensajes_grupo WHERE id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    const msg = rows[0];
    const io = req.app.get("io");
     // 3️⃣ Emitir evento a todos los miembros conectados del grupo
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
  const { usuariosConectados, enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    await db.query(
      `UPDATE mensajes_grupo SET eliminado = 0 WHERE id = ? AND usuario_id = ?`,
      [id, usuarioId]
    );

    const [rows] = await db.query(`SELECT * FROM mensajes_grupo WHERE id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const msg = rows[0];

    // Transformar a ISO UTC antes de emitir
    const fechaEnvioISO = msg.fecha_envio ? new Date(msg.fecha_envio.replace(" ", "T") + "Z").toISOString() : null;

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
  const { usuariosConectados, enviarEventoAlUsuario } = req.app.get("socketUtils");

  try {
    // 1️⃣ Obtener mensaje actual
    const [rows] = await db.query(`SELECT * FROM mensajes_grupo WHERE id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Mensaje no encontrado" });

    const mensajeActual = rows[0];
    if (mensajeActual.usuario_id !== usuarioId) return res.status(403).json({ error: "No autorizado" });

    // 2️⃣ Guardar historial de edición con fecha_original
    // Si es la primera edición, usamos fecha_envio como fecha_original
    const fechaOriginal = mensajeActual.fecha_editado || mensajeActual.fecha_envio;

    await db.query(
      `INSERT INTO mensajes_editados (mensaje_id, es_grupo, usuario_id, texto_original, fecha_original, fecha_edicion)
       VALUES (?, 1, ?, ?, ?, UTC_TIMESTAMP())`,
      [id, usuarioId, mensajeActual.mensaje, fechaOriginal]
    );

    // 3️⃣ Actualizar mensaje en mensajes_grupo
    await db.query(
      `UPDATE mensajes_grupo
       SET mensaje = ?, editado = 1, fecha_editado = UTC_TIMESTAMP()
       WHERE id = ?`,
      [nuevoTexto, id]
    );

    // 4️⃣ Traer mensaje actualizado
    const [rowsActualizados] = await db.query(
      `SELECT mg.*, u.nombre, u.apellido, u.url_imagen, u.background
       FROM mensajes_grupo mg
       JOIN usuario u ON u.id = mg.usuario_id
       WHERE mg.id = ?`,
      [id]
    );

    const mensajeConUTC = {
      ...rowsActualizados[0],
      fecha_envio: rowsActualizados[0].fecha_envio ? new Date(rowsActualizados[0].fecha_envio + "Z").toISOString() : null,
      fecha_editado: rowsActualizados[0].fecha_editado ? new Date(rowsActualizados[0].fecha_editado + "Z").toISOString() : null,
    };

    // 5️⃣ Emitir evento a todos los miembros
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

  console.log("📩 Datos recibidos para fijar:", req.body);

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
         mg.usuario_id AS autor_id,
         ua.nombre AS autor_nombre,
         ua.apellido AS autor_apellido,
         ua.url_imagen AS autor_imagen,
         uf.nombre AS fijado_por_nombre,
         uf.apellido AS fijado_por_apellido,
         uf.url_imagen AS fijado_por_imagen
       FROM mensajes_grupo_fijados mgf
       JOIN mensajes_grupo mg ON mg.id = mgf.mensaje_id
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
router.post("/archivo", upload.single("archivo"), async (req, res) => {
  try {
    const grupo_id = Number(req.body.grupo_id || req.query.grupo_id);
    const usuario_id = Number(req.body.usuario_id || req.query.usuario_id);
    const loteId =
      req.body.loteId ||
      req.body.lote_id ||
      req.query.loteId ||
      req.query.lote_id ||
      null;

    if (!grupo_id || !usuario_id || isNaN(grupo_id) || isNaN(usuario_id)) {
      console.error("❌ grupo_id o usuario_id inválido:", grupo_id, usuario_id);
      return res.status(400).json({ error: "Datos inválidos en la solicitud" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No se recibió ningún archivo" });
    }

    // 📁 Ruta relativa final tipo: /uploads/grupo_51/imagenes/....
    const relativePath = path.relative(
      path.join(__dirname, "../uploads"),
      file.path
    );
    const urlArchivo = `/uploads/${relativePath.replace(/\\/g, "/")}`;

    // 1️⃣ Crear mensaje en mensajes_grupo (mensaje = ruta de la imagen)
    const [resultadoMsg] = await db.query(
      `INSERT INTO mensajes_grupo (grupo_id, usuario_id, mensaje, fecha_envio, lote_id)
      VALUES (?, ?, ?, NOW(), ?)`,
      [grupo_id, usuario_id, urlArchivo, loteId || null]   // 👈 usamos el lote
    );
    const mensajeId = resultadoMsg.insertId;

    // 2️⃣ Guardar metadatos en mensajes_grupo_archivos
    await db.query(
      `INSERT INTO mensajes_grupo_archivos 
        (grupo_id, usuario_id, archivo_url, tipo_archivo, nombre_archivo, tamano, fecha_envio)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [grupo_id, usuario_id, urlArchivo, file.mimetype, file.originalname, file.size]
    );

    // 3️⃣ Info del usuario
    const [[usuarioInfo]] = await db.query(
      "SELECT nombre, apellido, correo, url_imagen, background FROM usuario WHERE id = ?",
      [usuario_id]
    );

    // 4️⃣ Objeto mensaje que entiende el front
    const mensaje = {
      id: mensajeId,
      grupo_id,
      usuario_id,
      mensaje: urlArchivo,
      archivo_url: urlArchivo,
      tipo_archivo: file.mimetype,
      nombre_archivo: file.originalname,
      tamano: file.size,
      eliminado: 0,
      editado: 0,
      fijado: 0,
      fecha_envio: new Date().toISOString(),
      lote_id: loteId || null,       // 👈 AQUÍ
      ...usuarioInfo,
    };

    // 5️⃣ Emitir por socket a todos los del grupo
    const io = req.app.get("io");
    if (io) {
      io.to(`grupo_${grupo_id}`).emit("nuevoMensajeGrupo", mensaje);
    }

    res.json({ success: true, mensaje });
  } catch (err) {
    console.error("❌ Error al subir archivo:", err);
    res.status(500).json({ error: "Error al subir archivo" });
  }
});
module.exports = router;