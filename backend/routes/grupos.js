const express = require("express");
const multer = require("multer");
const path = require("path");
const db = require("../db");

const router = express.Router();


// Configuración multer (guardar en carpeta /uploads/grupos)
const fs = require("fs");
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "..", "uploads", "grupos");
    fs.mkdirSync(dir, { recursive: true }); // 👈 crea la carpeta si no existe
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// =======================
// Obtener usuarios por proyecto
// =======================
router.get("/:proyectoId", async (req, res) => {
  const { proyectoId } = req.params;

  if (!proyectoId) {
    return res.status(400).json({ error: "Falta el parámetro proyectoId" });
  }

  const sql = `
    SELECT 
      u.id, 
      u.nombre, 
      u.apellido, 
      u.correo,
      u.estado,
      u.url_imagen,
      u.background,
      up.proyecto_id
    FROM usuario u
    JOIN usuario_proyecto up ON u.id = up.usuario_id
    WHERE up.proyecto_id = ?
  `;

  try {
    const [usuarios] = await db.query(sql, [proyectoId]);
    res.json(usuarios);
  } catch (err) {
    console.error("❌ Error al obtener usuarios por proyecto:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// GET /api/usuario/:id/proyecto
// =======================
router.get("/:id/proyecto", async (req, res) => {
  const { id } = req.params;
  const [rows] = await db.query(
    "SELECT proyecto_id FROM usuario_proyecto WHERE usuario_id = ? LIMIT 1",
    [id]
  );
  if (rows.length > 0) {
    res.json({ proyectoId: rows[0].proyecto_id });
  } else {
    res.json({ proyectoId: null });
  }
});

// =======================
// Obtener TODOS los usuarios de TODOS los proyectos donde participa un usuario
// =======================
router.get("/:id/todos-usuarios", async (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT DISTINCT
      u.id, 
      u.nombre, 
      u.apellido, 
      u.correo,
      u.estado,
      u.url_imagen,
      u.background
    FROM usuario u
    JOIN usuario_proyecto up ON u.id = up.usuario_id
    WHERE up.proyecto_id IN (
      SELECT proyecto_id FROM usuario_proyecto WHERE usuario_id = ?
    )
    AND u.id != ?; -- excluye al mismo usuario si quieres
  `;

  try {
    const [usuarios] = await db.query(sql, [id, id]);
    res.json(usuarios);
  } catch (err) {
    console.error("❌ Error al obtener usuarios relacionados:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Crear grupo nuevo (con imagen opcional) — con fecha UTC + info completa de miembros
// =======================
router.post("/", upload.single("imagen"), async (req, res) => {
  const { nombre, descripcion, propietarioId, miembros } = req.body;
  const file = req.file;

  // 🔹 Aseguramos que 'miembros' sea un array de IDs válidos
  let miembrosArray;
  try {
    const parsed = JSON.parse(miembros);
    miembrosArray = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    miembrosArray = [];
  }

  // 🧩 Compatibilidad: si vienen objetos, los convertimos a IDs (sin errores)
  miembrosArray = miembrosArray
    .map((m) => {
      if (!m) return null;
      if (typeof m === "object" && m.id) return m.id;
      if (typeof m === "number" || typeof m === "string") return m;
      return null;
    })
    .filter((id) => !!id && id !== propietarioId);

  console.log("📦 Miembros recibidos desde frontend:", miembros);
  console.log("✅ Miembros parseados:", miembrosArray);

  // 🔹 Validación de datos
  if (!propietarioId) {
    return res.status(400).json({ error: "Falta propietarioId" });
  }

  if (miembrosArray.length === 0) {
    return res.status(400).json({ error: "Debe haber al menos un miembro válido" });
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    // 1️⃣ Fecha UTC exacta
    const fechaUTC = new Date().toISOString().slice(0, 19).replace("T", " ");

    // 2️⃣ Crear grupo
    const [grupoResult] = await conn.query(
      `INSERT INTO grupos 
        (nombre, descripcion, imagen_url, propietario_id, privacidad, fecha_creacion) 
       VALUES (?, ?, ?, ?, 'privado', ?)`,
      [
        nombre?.trim() || "Chat privado",
        descripcion?.trim() || null,
        file ? `/uploads/grupos/${file.filename}` : null,
        propietarioId,
        fechaUTC,
      ]
    );
    const grupoId = grupoResult.insertId;

    // 3️⃣ Insertar propietario
    await conn.query(
      "INSERT INTO usuario_grupo (grupo_id, usuario_id, rol) VALUES (?, ?, 'propietario')",
      [grupoId, propietarioId]
    );

    // 4️⃣ Insertar miembros válidos
    for (const usuarioId of miembrosArray) {
      await conn.query(
        "INSERT INTO usuario_grupo (grupo_id, usuario_id, rol) VALUES (?, ?, 'miembro')",
        [grupoId, usuarioId]
      );
    }

    await conn.commit();

    // 5️⃣ Obtener grupo con toda la info (propietario + miembros)
    const [grupoRows] = await conn.query(
      `SELECT 
          g.id AS grupo_id,
          g.nombre,
          g.descripcion,
          g.imagen_url,
          g.propietario_id,
          g.privacidad,
          g.fecha_creacion,
          u.nombre AS propietario_nombre,
          u.apellido AS propietario_apellido
        FROM grupos g
        JOIN usuario u ON g.propietario_id = u.id
        WHERE g.id = ?`,
      [grupoId]
    );

    const grupo = grupoRows[0];

    const [miembrosRows] = await conn.query(
      `SELECT 
          u.id, 
          u.nombre, 
          u.apellido, 
          u.correo,
          u.url_imagen, 
          u.background
        FROM usuario_grupo ug
        JOIN usuario u ON u.id = ug.usuario_id
        WHERE ug.grupo_id = ?`,
      [grupoId]
    );

    // 6️⃣ Armar objeto completo
    const BASE_URL = process.env.BASE_URL || "https://quickchat.click";

    const grupoCompleto = {
      ...grupo,
      imagen_url: grupo.imagen_url ? `${BASE_URL}${grupo.imagen_url}` : null,
      miembros: miembrosRows.map((m) => ({
        ...m,
        url_imagen: m.url_imagen ? `${BASE_URL}${m.url_imagen}` : null,
      })),
    };

    // 7️⃣ Emitir evento al propietario y a todos los miembros
    const io = req.app.get("io");
    const todosMiembros = Array.from(new Set([propietarioId, ...miembrosArray]));
    // ✅ Nueva versión — compatible con socketUtils.js
    for (const uid of todosMiembros) {
      io.to(`usuario_${uid}`).emit("grupoCreado", grupoCompleto);
    }

    // ✅ Enviar respuesta final
    res.json({ success: true, grupo: grupoCompleto });
    } catch (err) {
    await conn.rollback();
    console.error("❌ Error al crear grupo:", err);

    // Enviar error más detallado al frontend en desarrollo
    res.status(500).json({
      error: "Error al crear grupo",
      message: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  } finally {
    conn.release();
  }
});

// =======================
// Obtener los grupos de un usuario con último mensaje + archivos + favoritos + admins
// =======================
router.get("/usuario/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const sql = `
      SELECT 
        g.id AS grupo_id,
        g.nombre,
        g.descripcion,
        g.imagen_url,
        g.propietario_id,
        g.privacidad,
        g.fecha_creacion,
        ug.rol,

        -- Último mensaje
        m.id AS ultimo_mensaje_id,
        m.mensaje AS ultimo_mensaje,
        m.eliminado AS eliminado,
        m.editado AS editado,
        m.fecha_envio,

        -- Datos del remitente del último mensaje
        u.id AS ultimo_remitente_id,
        CONCAT(u.nombre, ' ', u.apellido) AS ultimo_remitente,
        u.correo AS ultimo_remitente_correo,
        u.url_imagen AS ultimo_remitente_avatar,
        u.background AS ultimo_remitente_background,

        CASE 
          WHEN u.id = ? THEN 'enviado'
          ELSE 'recibido'
        END AS tipo_mensaje,

        -- Si el grupo está en favoritos
        CASE 
          WHEN cf.id IS NOT NULL THEN 1 
          ELSE 0 
        END AS es_favorito,

        (
          SELECT 
            CASE 
              WHEN EXISTS (
                SELECT 1
                FROM usuario_grupo ug2
                WHERE ug2.grupo_id = g.id
                AND ug2.usuario_id != ?
                AND NOT EXISTS (
                  SELECT 1
                  FROM mensajes_grupo_vistos mgv
                  WHERE mgv.mensaje_id = m.id
                  AND mgv.usuario_id = ug2.usuario_id
                )
              )
              THEN 0
              ELSE 1
            END
        ) AS visto,

        (
          SELECT COUNT(mg.id)
          FROM mensajes_grupo mg
          LEFT JOIN mensajes_grupo_vistos mgv 
            ON mgv.mensaje_id = mg.id AND mgv.usuario_id = ?
          WHERE mg.grupo_id = g.id
            AND mg.usuario_id != ?
            AND mgv.mensaje_id IS NULL
        ) AS mensajes_no_leidos,

        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', u2.id,
              'nombre', u2.nombre,
              'apellido', u2.apellido,
              'url_imagen', u2.url_imagen,
              'background', u2.background,
              'correo', u2.correo,
              'rol', ug2.rol
            )
          )
          FROM usuario_grupo ug2
          JOIN usuario u2 ON u2.id = ug2.usuario_id
          WHERE ug2.grupo_id = g.id
        ) AS miembros,

        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', mgf.id,
              'grupo_id', mgf.grupo_id,
              'mensaje_id', mgf.mensaje_id,
              'mensaje', mg.mensaje,
              'usuario_id', mgf.usuario_id,
              'nombre', uf.nombre,
              'apellido', uf.apellido,
              'url_imagen', uf.url_imagen,
              'background', uf.background,
              'fecha_fijado', mgf.fecha_fijado,
              'duracion', mgf.duracion,
              'fecha_expiracion', mgf.fecha_expiracion
            )
          )
          FROM (
            SELECT *
            FROM mensajes_grupo_fijados
            ORDER BY fecha_fijado ASC
            LIMIT 3
          ) AS mgf
          JOIN mensajes_grupo mg ON mg.id = mgf.mensaje_id
          JOIN usuario uf ON uf.id = mgf.usuario_id
          WHERE mgf.grupo_id = g.id
        ) AS mensajes_fijados,

        -- Archivos (documentos e imágenes)
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', mga.id,
              'usuario_id', mga.usuario_id,
              'nombre_archivo', mga.nombre_archivo,
              'archivo_url', mga.archivo_url,
              'tipo_archivo', mga.tipo_archivo,
              'fecha_envio', mga.fecha_envio,
              'tipo', 
                CASE 
                  WHEN mga.tipo_archivo LIKE 'image/%' THEN 'imagen'
                  ELSE 'documento'
                END
            )
          )
          FROM mensajes_grupo_archivos mga
          WHERE mga.grupo_id = g.id
        ) AS archivos

      FROM grupos g
      JOIN usuario_grupo ug ON g.id = ug.grupo_id
      LEFT JOIN (
        SELECT mg1.*
        FROM mensajes_grupo mg1
        INNER JOIN (
          SELECT grupo_id, MAX(fecha_envio) AS ultima_fecha
          FROM mensajes_grupo
          GROUP BY grupo_id
        ) mg2 
        ON mg1.grupo_id = mg2.grupo_id 
        AND mg1.fecha_envio = mg2.ultima_fecha
      ) m ON g.id = m.grupo_id
      LEFT JOIN usuario u ON u.id = m.usuario_id
      LEFT JOIN chats_favoritos cf 
        ON cf.chat_id = g.id AND cf.usuario_id = ? AND cf.tipo = 'grupo'

      WHERE ug.usuario_id = ?

      ORDER BY m.fecha_envio IS NULL, m.fecha_envio DESC, g.fecha_creacion DESC;
    `;

    const [grupos] = await db.query(sql, [
      userId, userId, userId, userId, userId, userId, userId
    ]);

    const BASE_URL = process.env.BASE_URL || "https://quickchat.click";

    const gruposConExtras = grupos.map((g) => {
      const miembros = g.miembros ? JSON.parse(g.miembros) : [];
      const fijados = g.mensajes_fijados ? JSON.parse(g.mensajes_fijados) : [];
      const archivos = g.archivos ? JSON.parse(g.archivos) : [];
      const admins = miembros.filter((m) => m.rol === "admin");
      const propietario = miembros.find((m) => m.id === g.propietario_id);

      fijados.forEach(f => {
        if (f.url_imagen) f.url_imagen = `${BASE_URL}${f.url_imagen}`;
      });

      return {
        ...g,
        imagen_url: g.imagen_url ? `${BASE_URL}${g.imagen_url}` : null,
        ultimo_remitente_avatar: g.ultimo_remitente_avatar
          ? `${BASE_URL}${g.ultimo_remitente_avatar}`
          : null,
        miembros,
        fijados,
        archivos,
        admins,
        propietario,
        es_favorito: g.es_favorito === 1,
      };
    });

    res.json(gruposConExtras);
  } catch (err) {
    console.error("❌ Error al obtener grupos:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Obtener TODOS los usuarios con proyectos en común
// + marcar si ya están en un grupo
// =======================
router.get("/:grupoId/usuarios-comunes/:usuarioId", async (req, res) => {
  const { grupoId, usuarioId } = req.params;

  // 🔹 Traemos usuarios con proyectos en común + su rol en el grupo (si lo tienen)
  const sqlUsuarios = `
    SELECT DISTINCT
      u.id,
      u.nombre,
      u.apellido,
      u.url_imagen,
      u.background,
      ug.rol,  -- 👈 ahora cada usuario trae su rol dentro del grupo (propietario, admin, miembro, NULL si no está)
      CASE WHEN ug.id IS NOT NULL THEN 1 ELSE 0 END AS en_grupo
    FROM usuario u
    LEFT JOIN usuario_proyecto up 
      ON u.id = up.usuario_id
    LEFT JOIN usuario_grupo ug 
      ON ug.usuario_id = u.id AND ug.grupo_id = ?
    WHERE 
      (
        up.proyecto_id IN (
          SELECT proyecto_id 
          FROM usuario_proyecto 
          WHERE usuario_id = ?
        )
        OR ug.id IS NOT NULL -- 👈 incluye también a los que ya están en el grupo aunque no tengan proyecto en común
      )
      AND u.id != ?;
  `;

  // 🔹 Info del grupo + el rol del usuario actual
  const sqlGrupoInfo = `
    SELECT g.privacidad, ug.rol
    FROM grupos g
    LEFT JOIN usuario_grupo ug
      ON ug.grupo_id = g.id AND ug.usuario_id = ?
    WHERE g.id = ?;
  `;

  try {
    // Consulta usuarios candidatos
    const [usuarios] = await db.query(sqlUsuarios, [grupoId, usuarioId, usuarioId]);

    // Consulta rol del usuario que está usando la app
    const [grupoInfoRows] = await db.query(sqlGrupoInfo, [usuarioId, grupoId]);
    const grupoInfo = grupoInfoRows[0] || { privacidad: "publico", rol: "miembro" };

    res.json({
      grupo: grupoInfo,  // { privacidad, rol del usuario actual }
      usuarios           // lista de usuarios con en_grupo y rol individual
    });
  } catch (err) {
    console.error("❌ Error al obtener usuarios comunes:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

router.post("/:id/actualizar-miembros", async (req, res) => {
  const { id } = req.params;
  const { miembros, usuarioId } = req.body;

  try {
    // 1️⃣ Obtener los roles actuales del grupo
    const [rolesRows] = await db.query(
      "SELECT usuario_id, rol FROM usuario_grupo WHERE grupo_id = ?",
      [id]
    );

    const rolesMap = {};
    rolesRows.forEach(r => {
      rolesMap[r.usuario_id] = r.rol;
    });

    const miembrosAnteriores = rolesRows.map(r => r.usuario_id);

    // 2️⃣ Obtener propietarios/admins (no se pueden eliminar)
    const fijos = rolesRows
      .filter(r => r.rol === "propietario" || r.rol === "admin")
      .map(r => r.usuario_id);

    // 3️⃣ Asegurar que el usuario que hace la acción quede dentro
    if (usuarioId && !fijos.includes(usuarioId)) {
      fijos.push(usuarioId);
    }

    // 4️⃣ Miembros finales = seleccionados + fijos
    const miembrosFinales = Array.from(new Set([...miembros, ...fijos]));

    if (miembrosFinales.length === 0) {
      return res.status(400).json({ error: "El grupo no puede quedar vacío" });
    }

    // 5️⃣ Eliminar los que ya no están
    await db.query(
      "DELETE FROM usuario_grupo WHERE grupo_id = ? AND usuario_id NOT IN (?)",
      [id, miembrosFinales]
    );

    // 6️⃣ Reinsertar/actualizar miembros
    for (const uid of miembrosFinales) {
      const rol = rolesMap[uid] || "miembro";
      await db.query(
        "INSERT INTO usuario_grupo (grupo_id, usuario_id, rol) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rol=VALUES(rol)",
        [id, uid, rol]
      );
    }

    // 7️⃣ Consultar detalles actualizados
    const [miembrosDetalles] = await db.query(`
      SELECT 
        u.id,
        u.nombre,
        u.apellido,
        u.correo,
        u.url_imagen,
        u.background,
        ug.rol
      FROM usuario_grupo ug
      JOIN usuario u ON u.id = ug.usuario_id
      WHERE ug.grupo_id = ?
      ORDER BY FIELD(ug.rol, 'propietario', 'admin', 'miembro')
    `, [id]);

    // 8️⃣ Obtener datos del grupo
    const [grupoRows] = await db.query(`
      SELECT 
        g.id AS grupo_id,
        g.nombre,
        g.descripcion,
        g.imagen_url,
        g.propietario_id,
        g.privacidad,
        g.fecha_creacion
      FROM grupos g
      WHERE g.id = ?
    `, [id]);

    const grupo = grupoRows[0];
    const BASE_URL = process.env.BASE_URL || "https://quickchat.click";

    const grupoCompleto = {
      ...grupo,
      imagen_url: grupo.imagen_url ? `${BASE_URL}${grupo.imagen_url}` : null,
      miembros: miembrosDetalles.map(m => ({
        ...m,
        url_imagen: m.url_imagen ? `${BASE_URL}${m.url_imagen}` : null,
      })),
    };

    // 9️⃣ Emitir eventos a cada tipo de usuario
    const io = req.app.get("io");

    const eliminados = miembrosAnteriores.filter(idAnt => !miembrosFinales.includes(idAnt));
    const agregados = miembrosFinales.filter(idNuevo => !miembrosAnteriores.includes(idNuevo));

    // 🔸 A los que permanecen → actualización normal
    io.to(`grupo_${id}`).emit("miembrosActualizados", {
      id: Number(id),
      miembros: miembrosDetalles,
    });

    // 🔹 A los eliminados → sacar grupo del ChatList
    eliminados.forEach(uid => {
      io.to(`usuario_${uid}`).emit("grupoEliminado", { id: Number(id) });
    });

    // 🔹 A los nuevos → enviar grupo completo (igual que "grupoCreado")
    agregados.forEach(uid => {
      io.to(`usuario_${uid}`).emit("grupoCreado", grupoCompleto);
    });

    res.json({
      success: true,
      miembros: miembrosDetalles,
    });
  } catch (err) {
    console.error("❌ Error actualizando miembros:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// 🧩 Salir de grupo (miembro o admin)
router.post("/:id/salir", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const [rows] = await db.query(
      "SELECT rol FROM usuario_grupo WHERE grupo_id = ? AND usuario_id = ?",
      [id, usuarioId]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: "No eres miembro del grupo" });
    }

    const rol = rows[0].rol;

    // No puede salir el propietario, debe eliminar el grupo
    if (rol === "propietario") {
      return res.status(400).json({ error: "El propietario no puede salir, solo eliminar el grupo" });
    }

    // Eliminar del grupo
    await db.query("DELETE FROM usuario_grupo WHERE grupo_id = ? AND usuario_id = ?", [id, usuarioId]);
  

    // Emitir evento a ese usuario para eliminar el grupo localmente
    const io = req.app.get("io");
    io.to(`usuario_${usuarioId}`).emit("grupoEliminado", { id: Number(id) });

    // 4️⃣ Obtiene los miembros restantes
    const [miembrosDetalles] = await db.query(`
      SELECT u.id, u.nombre, u.apellido, u.correo, u.url_imagen, u.background, ug.rol
      FROM usuario_grupo ug
      JOIN usuario u ON u.id = ug.usuario_id
      WHERE ug.grupo_id = ?
    `, [id]);

    // 5️⃣ Emite el evento a los miembros restantes del grupo
    io.to(`grupo_${id}`).emit("miembrosActualizados", {
      id: Number(id),
      miembros: miembrosDetalles,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al salir del grupo:", err);
    res.status(500).json({ error: "Error al salir del grupo" });
  }
});


// 🧩 Eliminar grupo (solo propietario)
router.delete("/:id/eliminar", async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const [rows] = await db.query(
      "SELECT rol FROM usuario_grupo WHERE grupo_id = ? AND usuario_id = ?",
      [id, usuarioId]
    );

    if (rows.length === 0 || rows[0].rol !== "propietario") {
      return res.status(403).json({ error: "Solo el propietario puede eliminar el grupo" });
    }

    await db.query("DELETE FROM usuario_grupo WHERE grupo_id = ?", [id]);
    await db.query("DELETE FROM grupos WHERE id = ?", [id]);

    const io = req.app.get("io");

    // 🔹 Emitir a todos los miembros conectados
    io.to(`grupo_${id}`).emit("grupoEliminado", { id: Number(id) });

    // 🔹 Emitir directamente al propietario también
    io.emit("grupoEliminado", { id: Number(id) });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al eliminar grupo:", err);
    res.status(500).json({ error: "Error al eliminar grupo" });
  }
});

// =======================
// Actualizar nombre o descripción del grupo
// =======================
router.put("/:id/editar-info", async (req, res) => {
  const { id } = req.params;
  const { usuarioId, nombre, descripcion } = req.body;

  if (!usuarioId) {
    return res.status(400).json({ error: "Falta usuarioId" });
  }

  try {
    // Verificamos si el usuario es propietario o admin del grupo
    const [rows] = await db.query(
      "SELECT rol FROM usuario_grupo WHERE grupo_id = ? AND usuario_id = ?",
      [id, usuarioId]
    );
    if (rows.length === 0 || !["propietario", "admin"].includes(rows[0].rol)) {
      return res.status(403).json({ error: "No tienes permisos para editar este grupo" });
    }

    // Actualizamos nombre y/o descripción
    const [result] = await db.query(
      "UPDATE grupos SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion) WHERE id = ?",
      [nombre || null, descripcion || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    // Emitir actualización por socket
    const io = req.app.get("io");
    io.to(`grupo_${id}`).emit("grupoActualizado", { id, nombre, descripcion });

    res.json({ success: true, message: "Grupo actualizado correctamente" });
  } catch (err) {
    console.error("❌ Error al actualizar grupo:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// =======================
// Cambiar privacidad (solo propietario)
// =======================
router.put("/:id/privacidad", async (req, res) => {
  const { id } = req.params;
  const { usuarioId, privacidad } = req.body;

  if (!usuarioId || !privacidad) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  if (!["publico", "privado"].includes(privacidad)) {
    return res.status(400).json({ error: "Valor de privacidad inválido" });
  }

  try {
    // Solo el propietario puede cambiar privacidad
    const [rows] = await db.query(
      "SELECT rol FROM usuario_grupo WHERE grupo_id = ? AND usuario_id = ?",
      [id, usuarioId]
    );
    if (rows.length === 0 || rows[0].rol !== "propietario") {
      return res.status(403).json({ error: "Solo el propietario puede cambiar la privacidad" });
    }

    await db.query("UPDATE grupos SET privacidad = ? WHERE id = ?", [privacidad, id]);

    const io = req.app.get("io");
    io.to(`grupo_${id}`).emit("privacidadActualizada", { id, privacidad });

    res.json({ success: true, message: "Privacidad actualizada correctamente" });
  } catch (err) {
    console.error("❌ Error al cambiar privacidad:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = router;