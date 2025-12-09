const express = require('express');
const router = express.Router();
const db = require('../db'); // Asegúrate que tienes conexión a DB

// Registro de usuario
router.post('/', async (req, res) => {
  const { nombre, apellido, contrasena } = req.body;

  if (!nombre || !apellido || !contrasena) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    // Obtener dominio desde sede
    const correo = `${nombre}${apellido}@quick.com`.toLowerCase();

    // Generar color aleatorio para background
    const colors = [
      "#1abc9c", "#3498db", "#9b59b6",
      "#e67e22", "#e74c3c", "#2c3e50",
      "#16a085", "#8e44ad"
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    // Insertar usuario
    await db.query(
    'INSERT INTO usuario (nombre, apellido, correo, contrasena, estado, url_imagen, background) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, apellido, correo, contrasena, 'desaprobado', null, randomColor]
    );

    res.status(201).json({ message: 'Usuario registrado correctamente' });

  } catch (err) {
    console.error('Error al registrar usuario:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;