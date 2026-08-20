const express = require('express');
const router = express.Router();
const pool = require('../db');
const { createMfaChallenge } = require('../utils/mfaService');
const { findTrustedDevice } = require('../utils/trustedDeviceService');
const { auditMfa } = require('../utils/mfaAuditService');

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

async function prepararUsuarioRespuesta(usuarioDb) {
  const { contrasena: _contrasena, ...usuarioSinContrasena } = usuarioDb;
  const usuario = {
    ...usuarioSinContrasena,
    permisos_chat: normalizarPermisosChat(usuarioSinContrasena.permisos_chat),
  };

  const [permisos] = await pool.query(
    'SELECT permiso FROM roles_permisos WHERE rol_id = ?',
    [usuario.rol_id]
  );
  usuario.rol_permisos = permisos.map((p) => p.permiso);
  return usuario;
}

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
      await auditMfa(pool, req, {
        event: 'LOGIN_EMAIL_NOT_FOUND',
        success: false,
      });
      return res.status(404).json({ error: 'El correo ingresado no existe' });
    }

    const usuarioContrasena = rows.find((row) => contrasenasCoinciden(row.contrasena, contrasena));

    if (!usuarioContrasena) {
      await auditMfa(pool, req, {
        event: 'LOGIN_PASSWORD_FAILED',
        targetUserId: rows[0]?.id || null,
        success: false,
      });
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await auditMfa(pool, req, {
      event: 'LOGIN_PASSWORD_OK',
      targetUserId: usuarioContrasena.id,
      success: true,
    });

    const estado = estadoNormalizado(usuarioContrasena.estado);
    if (estado !== 'aprobado') {
      await auditMfa(pool, req, {
        event: 'LOGIN_ACCOUNT_INACTIVE',
        targetUserId: usuarioContrasena.id,
        success: false,
      });
      return res.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        error: 'Tu cuenta está desactivada o todavía no ha sido aprobada. Comunícate con un administrador.'
      });
    }

    const [mfaRows] = await pool.query(
      `SELECT
          mfa_required,
          mfa_enabled,
          secret_encrypted,
          recovery_email,
          email_enabled,
          email_verified_at
       FROM usuario_mfa
       WHERE usuario_id = ?
       LIMIT 1`,
      [usuarioContrasena.id]
    );

    const mfa = mfaRows[0] || null;

    // En esta versión mfa_enabled representa exclusivamente el método TOTP.
    // email_enabled representa exclusivamente el método por correo.
    const totpEnabled =
      Number(mfa?.mfa_enabled || 0) === 1 &&
      Boolean(mfa?.secret_encrypted);

    const emailEnabled =
      Number(mfa?.email_enabled || 0) === 1 &&
      Boolean(String(mfa?.recovery_email || '').trim()) &&
      Boolean(mfa?.email_verified_at);

    const mfaRequired = Number(mfa?.mfa_required || 0) === 1;
    const hasAnyMethod = totpEnabled || emailEnabled;

    let recoveryEnabled = false;
    if (hasAnyMethod) {
      const [recoveryRows] = await pool.query(
        `SELECT COUNT(*) AS available
           FROM usuario_mfa_recovery_codes
          WHERE usuario_id = ?
            AND used_at IS NULL
            AND revoked_at IS NULL`,
        [usuarioContrasena.id]
      );
      recoveryEnabled = Number(recoveryRows[0]?.available || 0) > 0;
    }

    if (mfaRequired || hasAnyMethod) {
      const setupRequired = mfaRequired && !hasAnyMethod;

      // Si ya existe al menos un método y este navegador fue autorizado antes,
      // la contraseña completa el login sin pedir el segundo factor nuevamente.
      if (!setupRequired) {
        const trustedDevice = await findTrustedDevice(
          pool,
          req,
          res,
          usuarioContrasena.id,
          { touch: true }
        );

        if (trustedDevice) {
          const usuario = await prepararUsuarioRespuesta(usuarioContrasena);

          await auditMfa(pool, req, {
            event: 'LOGIN_TRUSTED_DEVICE',
            targetUserId: usuarioContrasena.id,
            method: 'trusted_device',
            success: true,
            metadata: { trusted_device_id: Number(trustedDevice.id) },
          });

          return res.json({
            mensaje: 'Inicio de sesión exitoso en dispositivo confiable',
            usuario,
            mfa_required: false,
            mfa_trusted_device: true,
            trusted_device_id: Number(trustedDevice.id),
            mfa_methods: {
              totp: totpEnabled,
              email: emailEnabled,
              recovery: recoveryEnabled,
            },
          });
        }
      }

      const challenge = createMfaChallenge({
        userId: usuarioContrasena.id,
        purpose: setupRequired ? 'setup' : 'verify',
      });

      await auditMfa(pool, req, {
        event: 'MFA_CHALLENGE_ISSUED',
        targetUserId: usuarioContrasena.id,
        method: setupRequired ? 'setup' : 'verify',
        success: true,
      });

      return res.json({
        mensaje: setupRequired
          ? 'Elige cómo proteger esta cuenta.'
          : 'Este es un dispositivo nuevo. Verifica tu identidad.',
        mfa_required: true,
        mfa_action: setupRequired ? 'setup' : 'verify',
        challenge,
        mfa_methods: {
          totp: totpEnabled,
          email: emailEnabled,
          recovery: recoveryEnabled,
        },
      });
    }

    const usuario = await prepararUsuarioRespuesta(usuarioContrasena);

    return res.json({
      mensaje: 'Inicio de sesión exitoso',
      usuario,
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
