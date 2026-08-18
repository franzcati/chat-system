const express = require('express');
const router = express.Router();
const pool = require('../db');

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

function normalizarCorreo(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function normalizarContrasena(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function contrasenasCoinciden(contrasenaGuardada, contrasenaIngresada) {
  const guardada = String(contrasenaGuardada ?? '');
  const ingresada = String(contrasenaIngresada ?? '');

  return guardada === ingresada || normalizarContrasena(guardada) === normalizarContrasena(ingresada);
}

function estadoNormalizado(value) {
  return String(value || '').trim().toLowerCase();
}

// Ruta para login
router.post('/login', async (req, res) => {
  const correoNormalizado = normalizarCorreo(req.body?.correo);
  const contrasena = req.body?.contrasena;

  if (!correoNormalizado) {
    return res.status(400).json({ error: 'Ingrese un correo válido' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT *
       FROM usuario
       WHERE LOWER(
         REPLACE(
           REPLACE(
             REPLACE(
               REPLACE(
                 REPLACE(TRIM(correo), ' ', ''),
               CHAR(9), ''),
             CHAR(10), ''),
           CHAR(13), ''),
         CHAR(160), '')
       ) = ?
       ORDER BY
         CASE WHEN LOWER(TRIM(estado)) = 'aprobado' THEN 0 ELSE 1 END,
         id DESC
       LIMIT 10`,
      [correoNormalizado]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'El correo ingresado no existe' });
    }

    // Primero validamos la contraseña. Si coincide pero la cuenta no está
    // aprobada, NO permitimos el acceso. La versión anterior tenía un fallback
    // que podía autenticar cuentas con estado distinto de "aprobado".
    const usuarioContrasena = rows.find((row) => contrasenasCoinciden(row.contrasena, contrasena));

    if (!usuarioContrasena) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const estado = estadoNormalizado(usuarioContrasena.estado);
    if (estado !== 'aprobado') {
      return res.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        error: 'Tu cuenta está desactivada o todavía no ha sido aprobada. Comunícate con un administrador.'
      });
    }

    // La contraseña sólo se usa para validar el login. Nunca debe salir en la respuesta HTTP.
    const { contrasena: _contrasena, ...usuarioSinContrasena } = usuarioContrasena;
    const usuario = {
      ...usuarioSinContrasena,
      permisos_chat: normalizarPermisosChat(usuarioSinContrasena.permisos_chat),
    };

    const [permisos] = await pool.query(
      'SELECT permiso FROM roles_permisos WHERE rol_id = ?',
      [usuario.rol_id]
    );

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
