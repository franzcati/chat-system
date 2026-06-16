// backend/routes/stickers.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { stripOwnDomainFromUploadUrl } = require("../utils/urlUtils");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { logDev } = require("../utils/logger");

// backend/routes/stickers.js
const storageSticker = multer.diskStorage({
  destination: (req, file, cb) => {
    const usuarioId = req.body.usuarioId || req.query.usuarioId;
    if (!usuarioId) {
      return cb(new Error("usuarioId es requerido"), null);
    }

    // 👇 AQUÍ cambiamos la ruta de destino
    const folderPath = path.join(
      __dirname,
      "..",
      "uploads",
      "usuarios",
      `usuario_${usuarioId}`,   // carpeta usuario_1, usuario_40, ...
      "stickers"                // subcarpeta stickers
    );

    fs.mkdirSync(folderPath, { recursive: true }); // crea toda la ruta si no existe
    cb(null, folderPath);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = Date.now();
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, `${uniquePrefix}_${safeName}`);
  },
});

const uploadSticker = multer({ storage: storageSticker });

/**
 * POST /api/stickers
 * Sube un nuevo sticker y lo guarda en /uploads/usuarios/usuario_X/stickers
 */
router.post("/", uploadSticker.single("archivo"), async (req, res) => {
  try {
    const usuarioId = Number(req.body.usuarioId || req.query.usuarioId);
    const file = req.file;

    if (!usuarioId || !file) {
      return res
        .status(400)
        .json({ success: false, error: "usuarioId y archivo son obligatorios" });
    }

    const relativePath = path.relative(
      path.join(__dirname, "../uploads"),
      file.path
    );
    const url = `/uploads/${relativePath.replace(/\\/g, "/")}`;

    const nombreOriginal = file.originalname;

    // 👇 Guardamos en tabla "stickers" (catálogo global)
    const [resultado] = await db.query(
      `INSERT INTO stickers (usuario_id, url, nombre_archivo_original)
       VALUES (?, ?, ?)`,
      [usuarioId, url, nombreOriginal]
    );

    const sticker = {
      id: resultado.insertId,
      usuario_id: usuarioId,
      url,
      nombre_archivo_original: nombreOriginal,
    };

    return res.json({ success: true, sticker });
  } catch (err) {
    console.error("❌ Error subiendo sticker:", {
        status: err.response?.status,
        data: err.response?.data,
        headers: err.response?.headers,
    });
    return res
      .status(500)
      .json({ success: false, error: "Error en el servidor" });
  }
});

// GET /api/stickers?usuarioId=XX
// Devuelve stickers FAVORITOS del usuario
router.get("/", async (req, res) => {
  const usuarioId = Number(req.query.usuarioId);

  if (!usuarioId) {
    return res
      .status(400)
      .json({ success: false, error: "usuarioId es obligatorio" });
  }

  try {
    const [rows] = await db.query(
      `SELECT su.id,
              su.sticker_id,
              s.url,
              s.nombre_archivo_original,
              s.usuario_id AS creador_id,
              u.nombre AS creador_nombre,
              u.apellido AS creador_apellido,
              su.creado_en
       FROM stickers_usuario su
       JOIN stickers s ON s.id = su.sticker_id
       LEFT JOIN usuario u ON u.id = s.usuario_id
       WHERE su.usuario_id = ?
       ORDER BY su.creado_en DESC`,
      [usuarioId]
    );

    return res.json({ success: true, stickers: rows });
  } catch (err) {
    console.error("❌ Error obteniendo stickers favoritos:", err);
    return res
      .status(500)
      .json({ success: false, error: "Error en el servidor" });
  }
});

/**
 * GET /api/stickers/todos?usuarioId=XX
 *
 * Antes devolvía el catálogo global, por eso cada usuario veía stickers que
 * enviaron otras personas. Ahora, cuando llega usuarioId, devuelve sólo los
 * stickers propios del usuario y los stickers que ese usuario ya envió.
 * Sin usuarioId conserva el comportamiento global por compatibilidad.
 */
router.get("/todos", async (req, res) => {
  try {
    const usuarioId = Number(req.query.usuarioId);

    if (!usuarioId) {
      const [rows] = await db.query(
        `SELECT s.id,
                s.url,
                s.nombre_archivo_original,
                s.usuario_id AS creador_id,
                u.nombre AS creador_nombre,
                u.apellido AS creador_apellido,
                s.creado_en
         FROM stickers s
         LEFT JOIN usuario u ON u.id = s.usuario_id
         ORDER BY s.creado_en DESC`
      );

      return res.json({ success: true, stickers: rows });
    }

    const [propios] = await db.query(
      `SELECT s.id,
              s.url,
              s.nombre_archivo_original,
              s.usuario_id AS creador_id,
              u.nombre AS creador_nombre,
              u.apellido AS creador_apellido,
              s.creado_en,
              s.creado_en AS enviado_en
       FROM stickers s
       LEFT JOIN usuario u ON u.id = s.usuario_id
       WHERE s.usuario_id = ?
       ORDER BY s.creado_en DESC`,
      [usuarioId]
    );

    const [privadosEnviados] = await db.query(
      `SELECT REPLACE(m.mensaje, '[sticker]', '') AS url,
              MAX(m.fecha_envio) AS enviado_en
       FROM mensajes m
       WHERE m.usuario_envia_id = ?
         AND m.mensaje LIKE '[sticker]%'
       GROUP BY url`,
      [usuarioId]
    );

    const [gruposEnviados] = await db.query(
      `SELECT REPLACE(mg.mensaje, '[sticker]', '') AS url,
              MAX(mg.fecha_envio) AS enviado_en
       FROM mensajes_grupo mg
       WHERE mg.usuario_id = ?
         AND mg.mensaje LIKE '[sticker]%'
       GROUP BY url`,
      [usuarioId]
    );

    const enviadosPorUrl = new Map();
    [...privadosEnviados, ...gruposEnviados].forEach((row) => {
      const url = String(row.url || '').trim();
      if (!url) return;

      const prev = enviadosPorUrl.get(url);
      const prevTime = prev?.enviado_en ? new Date(prev.enviado_en).getTime() : 0;
      const nextTime = row.enviado_en ? new Date(row.enviado_en).getTime() : 0;

      if (!prev || nextTime >= prevTime) {
        enviadosPorUrl.set(url, { url, enviado_en: row.enviado_en });
      }
    });

    const urlsEnviadas = [...enviadosPorUrl.keys()];
    let enviadosCatalogo = [];

    if (urlsEnviadas.length) {
      const [rows] = await db.query(
        `SELECT s.id,
                s.url,
                s.nombre_archivo_original,
                s.usuario_id AS creador_id,
                u.nombre AS creador_nombre,
                u.apellido AS creador_apellido,
                s.creado_en
         FROM stickers s
         LEFT JOIN usuario u ON u.id = s.usuario_id
         WHERE s.url IN (?)`,
        [urlsEnviadas]
      );
      enviadosCatalogo = rows;
    }

    const stickersPorUrl = new Map();

    propios.forEach((sticker) => {
      if (!sticker?.url) return;
      stickersPorUrl.set(sticker.url, sticker);
    });

    enviadosCatalogo.forEach((sticker) => {
      if (!sticker?.url) return;
      const enviado = enviadosPorUrl.get(sticker.url);
      stickersPorUrl.set(sticker.url, {
        ...sticker,
        enviado_en: enviado?.enviado_en || sticker.creado_en,
      });
    });

    enviadosPorUrl.forEach((enviado, url) => {
      if (stickersPorUrl.has(url)) return;
      stickersPorUrl.set(url, {
        id: `sent-${Buffer.from(url).toString('base64')}`,
        url,
        nombre_archivo_original: path.basename(url),
        creador_id: usuarioId,
        creador_nombre: null,
        creador_apellido: null,
        creado_en: enviado.enviado_en,
        enviado_en: enviado.enviado_en,
      });
    });

    const stickers = [...stickersPorUrl.values()].sort((a, b) => {
      const aTime = new Date(a.enviado_en || a.creado_en || 0).getTime();
      const bTime = new Date(b.enviado_en || b.creado_en || 0).getTime();
      return bTime - aTime;
    });

    return res.json({ success: true, stickers });
  } catch (err) {
    console.error("❌ Error obteniendo stickers:", err);
    return res
      .status(500)
      .json({ success: false, error: "Error en el servidor" });
  }
});

// POST /api/stickers/favorito
// Marca como favorito un sticker ya existente en el catálogo (por URL)
router.post("/favorito", async (req, res) => {
  try {
    let { usuarioId, url } = req.body;

    logDev("👉 /api/stickers/favorito body:", req.body);

    if (!usuarioId || !url) {
      return res.status(400).json({ success: false, error: "Faltan datos" });
    }

    // 🔹 Normalizar: si viene con cualquiera de los dominios del sistema, lo recortamos
    url = stripOwnDomainFromUploadUrl(url);

    logDev("👉 Buscando sticker por url:", url);

    // 1️⃣ Buscamos el sticker en el catálogo
    const [rows] = await db.query(
      `SELECT s.id,
              s.url,
              s.nombre_archivo_original,
              s.usuario_id AS creador_id,
              u.nombre AS creador_nombre,
              u.apellido AS creador_apellido
       FROM stickers s
       LEFT JOIN usuario u ON u.id = s.usuario_id
       WHERE s.url = ?`,
      [url]
    );

    if (rows.length === 0) {
      console.warn("⚠️ Sticker no encontrado para url:", url);
      return res
        .status(404)
        .json({ success: false, error: "Sticker no encontrado" });
    }

    const sticker = rows[0];

    // 2️⃣ Lo insertamos en favoritos (si no existe)
    await db.query(
      `INSERT IGNORE INTO stickers_usuario (usuario_id, sticker_id)
       VALUES (?, ?)`,
      [usuarioId, sticker.id]
    );

    return res.json({ success: true, sticker });
  } catch (err) {
    console.error("❌ Error agregando sticker favorito:", err);
    return res
      .status(500)
      .json({ success: false, error: "Error en el servidor" });
  }
});

// DELETE /api/stickers/favorito
router.delete("/favorito", async (req, res) => {
  const { usuarioId, url } = req.body;

  if (!usuarioId || !url) {
    return res.status(400).json({ success: false, error: "Faltan datos" });
  }

  try {
    let urlBuscar = stripOwnDomainFromUploadUrl(url);

    // 1️⃣ Obtener el id del sticker por URL
    const [rows] = await db.query(
      "SELECT id FROM stickers WHERE url = ?",
      [urlBuscar]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Sticker no encontrado" });
    }

    const stickerId = rows[0].id;

    // 2️⃣ Borrar la relación favorito
    await db.query(
      `DELETE FROM stickers_usuario
       WHERE usuario_id = ? AND sticker_id = ?`,
      [usuarioId, stickerId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error eliminando sticker favorito:", err);
    return res
      .status(500)
      .json({ success: false, error: "Error en el servidor" });
  }
});

module.exports = router;