const express = require("express");
const router = express.Router();
const pool = require("../db");

const COLORS = [
  "#1abc9c", "#3498db", "#9b59b6",
  "#e67e22", "#e74c3c", "#2c3e50",
  "#16a085", "#8e44ad",
];

function normalizeBatchUsers(usuarios) {
  return usuarios.map((usr) => ({
    nombre: String(usr?.nombre || "").trim(),
    apellido: String(usr?.apellido || "").trim(),
    usuario: String(usr?.usuario || "").trim().toLowerCase(),
    password: String(usr?.password || ""),
    proyecto: Number(usr?.proyecto),
  }));
}

// Crear múltiples usuarios
router.post("/batch", async (req, res) => {
  const usuarios = Array.isArray(req.body?.usuarios) ? req.body.usuarios : [];

  if (!usuarios.length) {
    return res.status(400).json({ error: "No se enviaron usuarios." });
  }

  // Validar antes de abrir la transacción. Antes había returns dentro de una
  // transacción activa; al liberar esa conexión al pool, podía conservar locks.
  const normalizedUsers = normalizeBatchUsers(usuarios);
  const invalidUser = normalizedUsers.find(
    (usr) => !usr.nombre || !usr.apellido || !usr.usuario || !usr.password || !usr.proyecto
  );

  if (invalidUser) {
    return res.status(400).json({ error: "Todos los campos son obligatorios." });
  }

  const emails = normalizedUsers.map((usr) => usr.usuario);
  if (new Set(emails).size !== emails.length) {
    return res.status(409).json({ error: "El lote contiene correos duplicados." });
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [existing] = await connection.query(
      "SELECT correo FROM usuario WHERE correo IN (?)",
      [emails]
    );

    if (existing.length) {
      const error = new Error(`El correo ${existing[0].correo} ya está registrado.`);
      error.httpStatus = 409;
      throw error;
    }

    for (const usr of normalizedUsers) {
      const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      const [result] = await connection.query(
        `INSERT INTO usuario
          (nombre, apellido, correo, contrasena, rol_id, background)
         VALUES (?, ?, ?, ?, 4, ?)`,
        [usr.nombre, usr.apellido, usr.usuario, usr.password, randomColor]
      );

      await connection.query(
        "INSERT INTO usuario_proyecto (usuario_id, proyecto_id) VALUES (?, ?)",
        [result.insertId, usr.proyecto]
      );
    }

    await connection.commit();
    transactionStarted = false;
    return res.json({ mensaje: "Usuarios creados correctamente" });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Error haciendo rollback del lote de usuarios:", rollbackError);
      }
    }

    console.error("Error creando usuario:", error);
    return res.status(error.httpStatus || 500).json({
      error: error.httpStatus ? error.message : "Error interno del servidor",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
