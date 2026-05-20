const express = require("express");
const router = express.Router();
const pool = require("../db");

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadsDir = path.join(__dirname, "..", "uploads", "perfiles");
fs.mkdirSync(uploadsDir, { recursive: true });

const storagePerfil = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext && ext.length <= 8 ? ext : ".jpg";
    cb(null, `perfil_${req.params.id}_${Date.now()}${safeExt}`);
  },
});

const uploadPerfil = multer({
  storage: storagePerfil,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se permiten imágenes"));
    }
    cb(null, true);
  },
});

let columnasPerfilVerificadas = false;

async function columnaExiste(nombre) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'usuario'
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [nombre]
  );
  return rows.length > 0;
}

async function asegurarColumnasPerfil() {
  if (columnasPerfilVerificadas) return;

  const columnas = [
    ["perfil_cartel", "VARCHAR(255) NULL"],
    ["perfil_biografia", "TEXT NULL"],
    ["perfil_estado_mensaje", "VARCHAR(255) NULL"],
    ["perfil_estado_expira", "DATETIME NULL"],
    ["perfil_tema_principal", "VARCHAR(20) NULL DEFAULT '#030202'"],
    ["perfil_tema_secundario", "VARCHAR(20) NULL DEFAULT '#e7b5bf'"],
    ["perfil_avatares_recientes", "TEXT NULL"],
  ];

  for (const [nombre, definicion] of columnas) {
    if (!(await columnaExiste(nombre))) {
      await pool.query(`ALTER TABLE usuario ADD COLUMN ${nombre} ${definicion}`);
    }
  }

  columnasPerfilVerificadas = true;
}

function limpiarExpiracionEstado(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 6) : [];
  } catch (error) {
    return [];
  }
}

async function guardarAvatarReciente(id, url) {
  if (!url) return;
  await asegurarColumnasPerfil();
  const [rows] = await pool.query("SELECT perfil_avatares_recientes FROM usuario WHERE id = ? LIMIT 1", [id]);
  const current = parseJsonArray(rows[0]?.perfil_avatares_recientes);
  const next = [url, ...current.filter((item) => item !== url)].slice(0, 6);
  await pool.query("UPDATE usuario SET perfil_avatares_recientes = ? WHERE id = ?", [JSON.stringify(next), id]);
}

function normalizarPerfilUsuario(row) {
  if (!row) return null;
  return {
    ...row,
    perfil_biografia: row.perfil_biografia || "",
    perfil_estado_mensaje: row.perfil_estado_mensaje || "",
    perfil_estado_expira: row.perfil_estado_expira || null,
    perfil_tema_principal: row.perfil_tema_principal || "#030202",
    perfil_tema_secundario: row.perfil_tema_secundario || "#e7b5bf",
    perfil_avatares_recientes: parseJsonArray(row.perfil_avatares_recientes),
  };
}

async function obtenerPerfilUsuario(id) {
  await asegurarColumnasPerfil();
  const [rows] = await pool.query(
    `SELECT id, nombre, apellido, correo, url_imagen, background,
            perfil_cartel, perfil_biografia, perfil_estado_mensaje,
            perfil_estado_expira, perfil_tema_principal, perfil_tema_secundario,
            perfil_avatares_recientes
       FROM usuario
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return normalizarPerfilUsuario(rows[0]);
}


// ===============================================================
// 📌 ESTADOS DE PRESENCIA DEL CHAT
// ===============================================================
router.get("/estados/presencia", async (req, res) => {
  try {
    const socketUtils = req.app.get("socketUtils");
    const estados = socketUtils?.getUsuariosConectados
      ? socketUtils.getUsuariosConectados()
      : req.usuariosConectados || {};

    res.json(estados || {});
  } catch (error) {
    console.error("❌ Error obteniendo estados de presencia:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.put("/:id/estado-presencia", async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body || {};

  try {
    const socketUtils = req.app.get("socketUtils");

    if (!socketUtils?.setEstadoManualUsuario) {
      return res.status(500).json({ error: "Socket no inicializado" });
    }

    const nextState = socketUtils.setEstadoManualUsuario(id, estado || "online");
    res.json({ mensaje: "Estado actualizado", estado: nextState });
  } catch (error) {
    console.error("❌ Error actualizando estado de presencia:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ===============================================================
// 📌 PERFIL PERSONAL / ESTADO PERSONAL
// ===============================================================
router.get("/:id/perfil", async (req, res) => {
  try {
    const perfil = await obtenerPerfilUsuario(req.params.id);
    if (!perfil) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(perfil);
  } catch (error) {
    console.error("❌ Error obteniendo perfil:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.put("/:id/perfil", async (req, res) => {
  const {
    perfil_biografia,
    perfil_estado_mensaje,
    perfil_estado_expira,
    perfil_tema_principal,
    perfil_tema_secundario,
  } = req.body || {};

  try {
    await asegurarColumnasPerfil();
    await pool.query(
      `UPDATE usuario
          SET perfil_biografia = ?,
              perfil_estado_mensaje = ?,
              perfil_estado_expira = ?,
              perfil_tema_principal = ?,
              perfil_tema_secundario = ?
        WHERE id = ?`,
      [
        perfil_biografia || null,
        perfil_estado_mensaje || null,
        limpiarExpiracionEstado(perfil_estado_expira),
        perfil_tema_principal || "#030202",
        perfil_tema_secundario || "#e7b5bf",
        req.params.id,
      ]
    );

    const perfil = await obtenerPerfilUsuario(req.params.id);
    res.json({ mensaje: "Perfil actualizado", usuario: perfil });
  } catch (error) {
    console.error("❌ Error actualizando perfil:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.post("/:id/perfil/avatar", uploadPerfil.single("imagen"), async (req, res) => {
  try {
    await asegurarColumnasPerfil();
    if (!req.file) return res.status(400).json({ error: "Imagen requerida" });
    const url = `/uploads/perfiles/${req.file.filename}`;
    await pool.query("UPDATE usuario SET url_imagen = ? WHERE id = ?", [url, req.params.id]);
    await guardarAvatarReciente(req.params.id, url);
    const perfil = await obtenerPerfilUsuario(req.params.id);
    res.json({ mensaje: "Foto de perfil actualizada", url_imagen: url, usuario: perfil });
  } catch (error) {
    console.error("❌ Error actualizando avatar:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.put("/:id/perfil/avatar-url", async (req, res) => {
  const { url_imagen } = req.body || {};

  try {
    await asegurarColumnasPerfil();
    const url = String(url_imagen || "").trim();
    if (!url || !url.startsWith("/uploads/perfiles/")) {
      return res.status(400).json({ error: "Avatar inválido" });
    }

    await pool.query("UPDATE usuario SET url_imagen = ? WHERE id = ?", [url, req.params.id]);
    await guardarAvatarReciente(req.params.id, url);
    const perfil = await obtenerPerfilUsuario(req.params.id);
    res.json({ mensaje: "Foto de perfil actualizada", url_imagen: url, usuario: perfil });
  } catch (error) {
    console.error("❌ Error seleccionando avatar reciente:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.post("/:id/perfil/cartel", uploadPerfil.single("imagen"), async (req, res) => {
  try {
    await asegurarColumnasPerfil();
    if (!req.file) return res.status(400).json({ error: "Imagen requerida" });
    const url = `/uploads/perfiles/${req.file.filename}`;
    await pool.query("UPDATE usuario SET perfil_cartel = ? WHERE id = ?", [url, req.params.id]);
    const perfil = await obtenerPerfilUsuario(req.params.id);
    res.json({ mensaje: "Cartel actualizado", perfil_cartel: url, usuario: perfil });
  } catch (error) {
    console.error("❌ Error actualizando cartel:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.delete("/:id/perfil/cartel", async (req, res) => {
  try {
    await asegurarColumnasPerfil();
    await pool.query("UPDATE usuario SET perfil_cartel = NULL WHERE id = ?", [req.params.id]);
    const perfil = await obtenerPerfilUsuario(req.params.id);
    res.json({ mensaje: "Cartel eliminado", usuario: perfil });
  } catch (error) {
    console.error("❌ Error eliminando cartel:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ===============================
// 📌 1. OBTENER SOLO USUARIOS APROBADOS
// ===============================
router.get("/", async (req, res) => {
  try {
    await asegurarColumnasPerfil();
    const [rows] = await pool.query(`
      SELECT 
        u.id,
        u.nombre,
        u.apellido,
        u.correo AS usuario,
        u.contrasena,
        u.rol_id,
        u.estado,
        u.url_imagen,
        u.background,
        u.perfil_cartel,
        u.perfil_biografia,
        u.perfil_estado_mensaje,
        u.perfil_estado_expira,
        u.perfil_tema_principal,
        u.perfil_tema_secundario,
        u.perfil_avatares_recientes,
        u.permisos_chat,

        (
          SELECT COALESCE(
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'id', p.id,
                'nombre', p.nombre
              )
            ),
            JSON_ARRAY()
          )
          FROM usuario_proyecto up
          JOIN proyecto p ON p.id = up.proyecto_id
          WHERE up.usuario_id = u.id
        ) AS proyectos_detallados

      FROM usuario u
      WHERE u.estado = 'aprobado';   -- 🔹 AQUÍ ESTÁ LA CLAVE
    `);

    const data = rows.map((u) => ({
      ...u,
      permisos_chat: JSON.parse(u.permisos_chat),
      proyectos_detallados: u.proyectos_detallados
        ? JSON.parse(u.proyectos_detallados)
        : [],
    }));

    res.json(data);

  } catch (err) {
    console.error("❌ Error obteniendo usuarios:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ===============================================================
// 📌 2. CREAR USUARIO
// ===============================================================
router.post("/", async (req, res) => {
  const {
    nombre,
    apellido,
    usuario,
    contrasena,
    rol_id,
    permisos_chat,
    proyecto
  } = req.body;

  if (!nombre || !apellido || !usuario || !contrasena || !proyecto) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  // 🎨 Generar color aleatorio para background
  const colors = [
    "#1abc9c", "#3498db", "#9b59b6",
    "#e67e22", "#e74c3c", "#2c3e50",
    "#16a085", "#8e44ad"
  ];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO usuario (
          nombre,
          apellido,
          correo,
          contrasena,
          rol_id,
          permisos_chat,
          background,
          estado
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nombre,
        apellido,
        usuario,
        contrasena,
        rol_id || 4,                       // o el rol que quieras por defecto
        JSON.stringify(permisos_chat || {}),
        randomColor,                       // 👈 color aleatorio
        'aprobado'                         // 👈 si quieres que se creen aprobados
      ]
    );

    await connection.query(
      `INSERT INTO usuario_proyecto (usuario_id, proyecto_id)
       VALUES (?, ?)`,
      [result.insertId, proyecto]
    );

    await connection.commit();
    res.json({ mensaje: "Usuario creado correctamente" });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Error creando usuario:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    connection.release();
  }
});

// ===============================================================
// 📌 3. ACTUALIZAR USUARIO
// ===============================================================
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  let {
    nombre,
    apellido,
    usuario,
    contrasena,
    rol_id,
    permisos_chat,
    proyectos   // <<--- ARRAY de ids de proyecto
  } = req.body;

  // 🔹 normalizamos / limpiamos proyectos
  proyectos = (proyectos || [])
    .filter(p => p != null)      // fuera null/undefined
    .map(p => Number(p));        // aseguramos que sean números

  if (!nombre || !apellido || !usuario || !Array.isArray(proyectos)) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // ================================
    // 1) ACTUALIZAR DATOS DEL USUARIO
    // ================================
    let query = `
      UPDATE usuario SET
        nombre = ?,
        apellido = ?,
        correo = ?,
        permisos_chat = ?
    `;
    const values = [
      nombre,
      apellido,
      usuario,
      JSON.stringify(permisos_chat || {})
    ];

    if (contrasena) {
      query += `, contrasena = ?`;
      values.push(contrasena);
    }

    if (rol_id) {
      query += `, rol_id = ?`;
      values.push(rol_id);
    }

    query += ` WHERE id = ?`;
    values.push(id);

    await connection.query(query, values);

    // ===========================================
    // 2) MULTIPROYECTOS → ACTUALIZACIÓN CORRECTa
    // ===========================================

    // 2.1 Obtener proyectos actuales del usuario
    const [actuales] = await connection.query(
      `SELECT proyecto_id FROM usuario_proyecto WHERE usuario_id = ?`,
      [id]
    );

    const actualesIds = actuales.map(p => p.proyecto_id);

    // 2.2 Identificar cuáles agregar
    const paraAgregar = proyectos.filter(p => !actualesIds.includes(p));

    // 2.3 Identificar cuáles eliminar
    const paraEliminar = actualesIds.filter(p => !proyectos.includes(p));

    // 2.4 AGREGAR nuevos
    for (const proyectoId of paraAgregar) {
      await connection.query(
        `INSERT INTO usuario_proyecto (usuario_id, proyecto_id)
         VALUES (?, ?)`,
        [id, proyectoId]
      );
    }

    // 2.5 ELIMINAR los que fueron quitados
    if (paraEliminar.length > 0) {
      await connection.query(
        `DELETE FROM usuario_proyecto 
         WHERE usuario_id = ? AND proyecto_id IN (?)`,
        [id, paraEliminar]
      );
    }

    await connection.commit();
    res.json({ mensaje: "Usuario actualizado correctamente" });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Error actualizando usuario:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    connection.release();
  }
});

// ===============================================================
// 📌 4. ELIMINAR USUARIO
// ===============================================================
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    await pool.query(`DELETE FROM usuario_proyecto WHERE usuario_id = ?`, [id]);
    await pool.query(`UPDATE usuario SET estado = 'desaprobado' WHERE id = ?`, [id]);

    res.json({ mensaje: "Usuario eliminado correctamente" });

  } catch (error) {
    console.error("❌ Error eliminando usuario:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
