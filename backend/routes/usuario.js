const express = require('express');
const router = express.Router();
const pool = require('../db'); // Asegúrate de tener configurada tu conexión MySQL

const DEFAULT_CHAT_PERMISSIONS = {
  crear_grupos: 0,
  editar_mensajes: 0,
  eliminar_mensajes: 0,
  enviar_audios: 0,
};

function normalizarPermisosChat(value) {
  let parsed = value;

  if (!parsed) parsed = {};

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    parsed = {};
  }

  const normalizados = { ...DEFAULT_CHAT_PERMISSIONS };

  for (const key of Object.keys(normalizados)) {
    const raw = parsed[key];
    normalizados[key] = raw === 1 || raw === '1' || raw === true || raw === 'true' ? 1 : 0;
  }

  return normalizados;
}

// Ruta para login
router.post('/login', async (req, res) => {
  const { correo, contrasena } = req.body;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM usuario WHERE correo = ?',
      [correo]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'El correo ingresado no existe' });
    }

    const usuario = rows[0];

    if (usuario.contrasena !== contrasena) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // 👉 Convertir permisos_chat si viene como string
    usuario.permisos_chat = normalizarPermisosChat(usuario.permisos_chat);

    // 👉 Obtener permisos del rol
    const [permisos] = await pool.query(
      'SELECT permiso FROM roles_permisos WHERE rol_id = ?',
      [usuario.rol_id]
    );

    // Convertir a array simple: ["crear_usuarios","editar_usuarios"]
    usuario.rol_permisos = permisos.map((p) => p.permiso);

    res.json({
      mensaje: 'Inicio de sesión exitoso',
      usuario,
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;