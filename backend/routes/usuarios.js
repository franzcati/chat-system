const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===============================
// 📌 1. OBTENER SOLO USUARIOS APROBADOS
// ===============================
router.get("/", async (req, res) => {
  try {
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
