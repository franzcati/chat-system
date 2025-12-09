const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener todos los proyectos activos
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre, descripcion FROM proyecto WHERE estado = 'activo'"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error cargando proyectos:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Obtener proyectos asignados a un usuario
router.get("/:usuarioId", async (req, res) => {
  const usuarioId = req.params.usuarioId;

  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre 
       FROM proyecto p
       INNER JOIN usuario_proyecto up ON up.proyecto_id = p.id
       WHERE up.usuario_id = ?`,
      [usuarioId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo proyectos del usuario:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// CREAR PROYECTO
router.post("/", async (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO proyecto (nombre, descripcion)
       VALUES (?, ?)`,
      [nombre, descripcion || null]
    );

    res.json({
      id: result.insertId,
      nombre,
      descripcion: descripcion || null,
    });

  } catch (err) {
    console.error("❌ Error creando proyecto:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ACTUALIZAR PROYECTO
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio" });
  }

  try {
    await pool.query(
      `UPDATE proyecto
       SET nombre = ?, descripcion = ?
       WHERE id = ?`,
      [nombre, descripcion || null, id]
    );

    res.json({ mensaje: "Proyecto actualizado correctamente" });

  } catch (err) {
    console.error("❌ Error actualizando proyecto:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ELIMINAR / DESACTIVAR PROYECTO
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {

    // Si quisieras borrar del todo:
    await pool.query(`DELETE FROM proyecto WHERE id = ?`, [id]);

    res.json({ mensaje: "Proyecto eliminado correctamente" });

  } catch (err) {
    console.error("❌ Error eliminando proyecto:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});


module.exports = router;