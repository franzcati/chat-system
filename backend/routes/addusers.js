const express = require("express");
const router = express.Router();
const pool = require("../db");

// Crear múltiples usuarios
router.post("/batch", async (req, res) => {
  const { usuarios } = req.body;

  if (!Array.isArray(usuarios) || usuarios.length === 0) {
    return res.status(400).json({ error: "No se enviaron usuarios." });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const usr of usuarios) {
      const { nombre, apellido, usuario, password, proyecto } = usr;

      // Validaciones obligatorias
      if (!nombre || !apellido || !usuario || !password || !proyecto) {
        return res.status(400).json({
          error: "Todos los campos son obligatorios.",
        });
      }

      // Revisar si ya existe correo
      const [exists] = await connection.query(
        "SELECT id FROM usuario WHERE correo = ?",
        [usuario]
      );

      if (exists.length > 0) {
        return res.status(409).json({
          error: `El correo ${usuario} ya está registrado.`,
        });
      }

      // 🎨 GENERAR COLOR RANDOM
      const colors = [
        "#1abc9c", "#3498db", "#9b59b6",
        "#e67e22", "#e74c3c", "#2c3e50",
        "#16a085", "#8e44ad"
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      // Insertar usuario con background random
      const [result] = await connection.query(
        `INSERT INTO usuario 
        (nombre, apellido, correo, contrasena, rol_id, background) 
        VALUES (?, ?, ?, ?, 4, ?)`,
        [nombre, apellido, usuario, password, randomColor]
      );

      const userId = result.insertId;

      // Insertar en usuario_proyecto
      await connection.query(
        "INSERT INTO usuario_proyecto (usuario_id, proyecto_id) VALUES (?, ?)",
        [userId, proyecto]
      );
    }

    await connection.commit();
    res.json({ mensaje: "Usuarios creados correctamente" });

  } catch (error) {
    await connection.rollback();
    console.error("Error creando usuario:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    connection.release();
  }
});

module.exports = router;