const express = require("express");
const QRCode = require("qrcode");
const pool = require("../db");
const {
  generateSecret,
  findTotpCounter,
  normalizeCode,
  buildOtpAuthUri,
  encryptSecret,
  decryptSecret,
  verifyMfaChallenge,
  formatManualSecret,
} = require("../utils/mfaService");
const {
  createTrustedDevice,
  findTrustedDevice,
  revokeDevice,
  clearTrustedCookie,
} = require("../utils/trustedDeviceService");
const {
  otpExpiresMinutes,
  otpMaxAttempts,
  otpMaxSends,
  otpWindowMinutes,
  otpCooldownSeconds,
  normalizeRecoveryEmail,
  maskEmail,
  normalizeOtp,
  generateEmailOtp,
  generateNonce,
  otpDigest,
  verifyOtpDigest,
  sendOtpEmail,
} = require("../utils/emailOtpService");
const {
  recoveryCodeCount,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
} = require("../utils/mfaRecoveryService");
const { auditMfa } = require("../utils/mfaAuditService");

const router = express.Router();
const SETUP_MAX_AGE_MINUTES = 15;

const DEFAULT_CHAT_PERMISSIONS = {
  crear_grupos: 0,
  editar_mensajes: 0,
  eliminar_mensajes: 0,
  enviar_audios: 0,
};

function normalizarPermisosChat(value) {
  let parsed = value;

  if (!parsed) parsed = {};
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};

  const normalizados = { ...DEFAULT_CHAT_PERMISSIONS };
  for (const key of Object.keys(normalizados)) {
    const raw = parsed[key];
    normalizados[key] =
      raw === 1 || raw === "1" || raw === true || raw === "true" ? 1 : 0;
  }

  return normalizados;
}

async function cargarUsuarioSeguro(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM usuario WHERE id = ? LIMIT 1",
    [userId]
  );

  if (!rows.length) {
    const error = new Error("Usuario no encontrado");
    error.status = 404;
    throw error;
  }

  const { contrasena: _contrasena, ...usuarioSinContrasena } = rows[0];
  const usuario = {
    ...usuarioSinContrasena,
    permisos_chat: normalizarPermisosChat(usuarioSinContrasena.permisos_chat),
  };

  const [permisos] = await pool.query(
    "SELECT permiso FROM roles_permisos WHERE rol_id = ?",
    [usuario.rol_id]
  );
  usuario.rol_permisos = permisos.map((item) => item.permiso);

  return usuario;
}

async function cargarMfa(userId) {
  const [rows] = await pool.query(
    `SELECT
        usuario_id,
        mfa_required,
        mfa_enabled,
        secret_encrypted,
        pending_secret_encrypted,
        pending_created_at,
        enabled_at,
        last_totp_counter,
        recovery_email,
        email_enabled,
        email_verified_at
     FROM usuario_mfa
     WHERE usuario_id = ?
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
}

function methodState(mfa) {
  const totpEnabled =
    Number(mfa?.mfa_enabled || 0) === 1 &&
    Boolean(mfa?.secret_encrypted);

  const email = normalizeRecoveryEmail(mfa?.recovery_email);
  const emailEnabled =
    Number(mfa?.email_enabled || 0) === 1 &&
    Boolean(email) &&
    Boolean(mfa?.email_verified_at);

  return {
    totp_enabled: totpEnabled,
    email_enabled: emailEnabled,
    recovery_email: emailEnabled ? email : "",
    masked_email: emailEnabled ? maskEmail(email) : "",
    has_any_method: totpEnabled || emailEnabled,
  };
}

function responderChallengeInvalido(res, error) {
  if (
    error?.code === "MFA_CHALLENGE_INVALID" ||
    error?.code === "MFA_CHALLENGE_PURPOSE"
  ) {
    return res.status(401).json({
      code: "MFA_CHALLENGE_INVALID",
      error: "La verificación de seguridad expiró. Inicia sesión nuevamente.",
    });
  }

  return null;
}

function readRequestedUserId(req) {
  const raw = req.headers?.["x-qc-user-id"] || req.query?.usuario_id;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function requireCurrentTrustedDevice(req, res) {
  const userId = readRequestedUserId(req);

  if (!userId) {
    res.status(400).json({ error: "Usuario inválido." });
    return null;
  }

  const device = await findTrustedDevice(pool, req, res, userId, {
    touch: false,
  });

  if (!device) {
    res.status(401).json({
      code: "TRUSTED_DEVICE_REQUIRED",
      error:
        "Este navegador ya no está autorizado. Vuelve a iniciar sesión y verifica uno de tus métodos de seguridad.",
    });
    return null;
  }

  return { userId, device };
}

async function requireMfaAdmin(req, res) {
  const actorUserId = readRequestedUserId(req);

  if (!actorUserId) {
    res.status(400).json({ error: "Administrador inválido." });
    return null;
  }

  const trustedDevice = await findTrustedDevice(
    pool,
    req,
    res,
    actorUserId,
    { touch: false }
  );

  if (!trustedDevice) {
    res.status(401).json({
      code: "ADMIN_TRUSTED_DEVICE_REQUIRED",
      error: "Este navegador del administrador no está autorizado. Vuelve a iniciar sesión y verifica MFA.",
    });
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
        u.id,
        u.rol_id,
        u.estado,
        EXISTS(
          SELECT 1
          FROM roles_permisos rp
          WHERE rp.rol_id = u.rol_id
            AND rp.permiso = 'gestionar_mfa'
        ) AS can_manage_mfa
     FROM usuario u
     WHERE u.id = ?
     LIMIT 1`,
    [actorUserId]
  );

  const actor = rows[0];
  if (
    !actor ||
    String(actor.estado || "").trim().toLowerCase() !== "aprobado" ||
    Number(actor.can_manage_mfa || 0) !== 1
  ) {
    await auditMfa(pool, req, {
      event: "MFA_ADMIN_ACCESS_DENIED",
      actorUserId,
      targetUserId: null,
      success: false,
    });

    res.status(403).json({
      code: "MFA_ADMIN_PERMISSION_REQUIRED",
      error: "No tienes permiso para administrar MFA.",
    });
    return null;
  }

  return {
    actorUserId,
    trustedDevice,
    actor,
  };
}

async function iniciarTotpParaUsuario(userId) {
  const usuario = await cargarUsuarioSeguro(userId);
  const secret = generateSecret();
  const encrypted = encryptSecret(secret);

  await pool.query(
    `UPDATE usuario_mfa
        SET pending_secret_encrypted = ?,
            pending_created_at = UTC_TIMESTAMP(),
            updated_at = UTC_TIMESTAMP()
      WHERE usuario_id = ?`,
    [encrypted, userId]
  );

  const issuer =
    String(process.env.MFA_ISSUER || "QuickChat").trim() || "QuickChat";
  const accountName =
    usuario.correo || usuario.usuario || `usuario-${userId}`;
  const otpAuthUri = buildOtpAuthUri({
    secret,
    accountName,
    issuer,
  });

  const qrDataUrl = await QRCode.toDataURL(otpAuthUri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });

  return {
    issuer,
    account: accountName,
    qr_data_url: qrDataUrl,
    manual_key: formatManualSecret(secret),
    digits: 6,
    period_seconds: 30,
  };
}

async function validarPendingTotp(userId, inputCode) {
  const code = normalizeCode(inputCode);

  if (code.length !== 6) {
    return {
      ok: false,
      status: 400,
      body: {
        code: "MFA_CODE_FORMAT",
        error: "Ingresa el código de 6 dígitos.",
      },
    };
  }

  const mfa = await cargarMfa(userId);

  if (!mfa?.pending_secret_encrypted || !mfa?.pending_created_at) {
    return {
      ok: false,
      status: 400,
      body: {
        code: "MFA_SETUP_NOT_STARTED",
        error: "Primero genera el QR de configuración.",
      },
    };
  }

  const [ageRows] = await pool.query(
    `SELECT TIMESTAMPDIFF(MINUTE, pending_created_at, UTC_TIMESTAMP()) AS age_minutes
     FROM usuario_mfa
     WHERE usuario_id = ?`,
    [userId]
  );

  const ageMinutes = Number(ageRows[0]?.age_minutes ?? 999);

  if (ageMinutes > SETUP_MAX_AGE_MINUTES) {
    await pool.query(
      `UPDATE usuario_mfa
          SET pending_secret_encrypted = NULL,
              pending_created_at = NULL,
              updated_at = UTC_TIMESTAMP()
        WHERE usuario_id = ?`,
      [userId]
    );

    return {
      ok: false,
      status: 410,
      body: {
        code: "MFA_SETUP_EXPIRED",
        error: "El QR expiró. Genera uno nuevo e inténtalo otra vez.",
      },
    };
  }

  const secret = decryptSecret(mfa.pending_secret_encrypted);
  const matchedCounter = findTotpCounter(secret, code);

  if (matchedCounter === null) {
    return {
      ok: false,
      status: 401,
      body: {
        code: "MFA_CODE_INVALID",
        error:
          "Código incorrecto. Revisa Google Authenticator e inténtalo nuevamente.",
      },
    };
  }

  await pool.query(
    `UPDATE usuario_mfa
        SET secret_encrypted = pending_secret_encrypted,
            pending_secret_encrypted = NULL,
            pending_created_at = NULL,
            mfa_enabled = 1,
            enabled_at = UTC_TIMESTAMP(),
            last_totp_counter = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE usuario_id = ?`,
    [matchedCounter, userId]
  );

  return {
    ok: true,
    matchedCounter,
  };
}

/* ============================================================
   TOTP - PRIMER ENROLAMIENTO
   ============================================================ */

router.post("/setup/start", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "setup"
    );

    const mfa = await cargarMfa(userId);

    if (!mfa || Number(mfa.mfa_required) !== 1) {
      return res.status(403).json({
        code: "MFA_NOT_REQUIRED",
        error:
          "La autenticación en dos pasos no está habilitada para esta cuenta.",
      });
    }

    if (methodState(mfa).totp_enabled) {
      return res.status(409).json({
        code: "TOTP_ALREADY_ENABLED",
        error: "Google Authenticator ya está configurado.",
      });
    }

    const setup = await iniciarTotpParaUsuario(userId);

    return res.json({
      setup_required: true,
      ...setup,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(res, error);
    if (challengeResponse) return challengeResponse;

    console.error("Error iniciando configuración TOTP:", error);
    return res
      .status(500)
      .json({ error: "No se pudo iniciar la configuración de Authenticator." });
  }
});

router.post("/setup/verify", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "setup"
    );

    const mfa = await cargarMfa(userId);

    if (!mfa || Number(mfa.mfa_required) !== 1) {
      return res.status(403).json({
        error: "MFA no está habilitado para esta cuenta.",
      });
    }

    if (methodState(mfa).totp_enabled) {
      return res.status(409).json({
        error: "Google Authenticator ya está configurado.",
      });
    }

    const verified = await validarPendingTotp(
      userId,
      req.body?.code
    );

    if (!verified.ok) {
      return res.status(verified.status).json(verified.body);
    }

    const trustedDevice = await createTrustedDevice(
      pool,
      req,
      res,
      userId
    );
    const usuario = await cargarUsuarioSeguro(userId);

    await auditMfa(pool, req, {
      event: "MFA_TOTP_ADDED",
      targetUserId: userId,
      method: "totp",
      success: true,
    });
    await auditMfa(pool, req, {
      event: "TRUSTED_DEVICE_CREATED",
      targetUserId: userId,
      method: "trusted_device",
      success: true,
      metadata: { trusted_device_id: Number(trustedDevice?.id || 0) || null },
    });

    return res.json({
      mensaje: "Google Authenticator activado correctamente.",
      mfa_enabled: true,
      trusted_device: trustedDevice,
      usuario,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(res, error);
    if (challengeResponse) return challengeResponse;

    console.error("Error verificando configuración TOTP:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Error verificando Authenticator.",
    });
  }
});

/* ============================================================
   TOTP - LOGIN EN DISPOSITIVO NUEVO
   ============================================================ */

router.post("/verify-login", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "verify"
    );

    const code = normalizeCode(req.body?.code);

    if (code.length !== 6) {
      return res
        .status(400)
        .json({ error: "Ingresa el código de 6 dígitos." });
    }

    const mfa = await cargarMfa(userId);
    const methods = methodState(mfa);

    if (!methods.totp_enabled) {
      return res.status(403).json({
        code: "TOTP_NOT_CONFIGURED",
        error:
          "Google Authenticator no está configurado para esta cuenta.",
      });
    }

    const secret = decryptSecret(mfa.secret_encrypted);
    const matchedCounter = findTotpCounter(secret, code);

    if (matchedCounter === null) {
      await auditMfa(pool, req, {
        event: "MFA_TOTP_FAILED",
        targetUserId: userId,
        method: "totp",
        success: false,
      });
      return res.status(401).json({
        code: "MFA_CODE_INVALID",
        error:
          "Código incorrecto. Revisa Google Authenticator e inténtalo nuevamente.",
      });
    }

    const [counterUpdate] = await pool.query(
      `UPDATE usuario_mfa
          SET last_totp_counter = ?,
              updated_at = UTC_TIMESTAMP()
        WHERE usuario_id = ?
          AND (
            last_totp_counter IS NULL
            OR last_totp_counter < ?
          )`,
      [matchedCounter, userId, matchedCounter]
    );

    if (counterUpdate.affectedRows !== 1) {
      return res.status(409).json({
        code: "MFA_CODE_ALREADY_USED",
        error:
          "Ese código ya fue utilizado. Espera al siguiente código de Authenticator.",
      });
    }

    const trustedDevice = await createTrustedDevice(
      pool,
      req,
      res,
      userId
    );
    const usuario = await cargarUsuarioSeguro(userId);

    await auditMfa(pool, req, {
      event: "MFA_TOTP_SUCCESS",
      targetUserId: userId,
      method: "totp",
      success: true,
    });
    await auditMfa(pool, req, {
      event: "TRUSTED_DEVICE_CREATED",
      targetUserId: userId,
      method: "trusted_device",
      success: true,
      metadata: { trusted_device_id: Number(trustedDevice?.id || 0) || null },
    });

    return res.json({
      mensaje: "Verificación de seguridad correcta.",
      trusted_device: trustedDevice,
      usuario,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(res, error);
    if (challengeResponse) return challengeResponse;

    console.error("Error verificando login TOTP:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Error verificando Authenticator.",
    });
  }
});

/* ============================================================
   CORREO OTP
   ============================================================ */

function emailAccountLabel(usuario) {
  return (
    usuario?.correo ||
    usuario?.usuario ||
    `usuario-${usuario?.id || ""}`
  );
}

function emailOtpConfigPublic() {
  return {
    expires_minutes: otpExpiresMinutes(),
    max_attempts: otpMaxAttempts(),
    max_sends: otpMaxSends(),
    window_minutes: otpWindowMinutes(),
    cooldown_seconds: otpCooldownSeconds(),
  };
}

async function enforceEmailSendRateLimit(userId, purpose) {
  const windowMinutes = otpWindowMinutes();
  const cooldownSeconds = otpCooldownSeconds();
  const maxSends = otpMaxSends();

  const [rows] = await pool.query(
    `SELECT
        COUNT(*) AS send_count,
        COALESCE(
          TIMESTAMPDIFF(
            SECOND,
            MAX(created_at),
            UTC_TIMESTAMP()
          ),
          999999
        ) AS seconds_since_last
     FROM usuario_mfa_email_challenges
     WHERE usuario_id = ?
       AND purpose = ?
       AND created_at >= DATE_SUB(
         UTC_TIMESTAMP(),
         INTERVAL ${windowMinutes} MINUTE
       )`,
    [userId, purpose]
  );

  const sendCount = Number(rows[0]?.send_count || 0);
  const sinceLast = Number(
    rows[0]?.seconds_since_last || 999999
  );

  if (sinceLast < cooldownSeconds) {
    const retryAfterSeconds = Math.max(
      1,
      cooldownSeconds - sinceLast
    );
    const error = new Error(
      `Espera ${retryAfterSeconds} segundos antes de solicitar otro código.`
    );
    error.status = 429;
    error.code = "EMAIL_OTP_COOLDOWN";
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  if (sendCount >= maxSends) {
    const error = new Error(
      `Se alcanzó el límite de ${maxSends} códigos por correo en ${windowMinutes} minutos. Inténtalo más tarde.`
    );
    error.status = 429;
    error.code = "EMAIL_OTP_RATE_LIMIT";
    error.retryAfterSeconds = windowMinutes * 60;
    throw error;
  }
}

async function issueEmailOtp({
  userId,
  purpose,
  email,
}) {
  const destination = normalizeRecoveryEmail(email);

  if (!destination) {
    const error = new Error(
      "Ingresa un correo alternativo válido."
    );
    error.status = 400;
    error.code = "RECOVERY_EMAIL_INVALID";
    throw error;
  }

  await enforceEmailSendRateLimit(userId, purpose);

  await pool.query(
    `DELETE FROM usuario_mfa_email_challenges
     WHERE usuario_id = ?
       AND created_at < DATE_SUB(
         UTC_TIMESTAMP(),
         INTERVAL 7 DAY
       )`,
    [userId]
  );

  const code = generateEmailOtp();
  const nonce = generateNonce();
  const expiresMinutes = otpExpiresMinutes();
  const maxAttempts = otpMaxAttempts();

  const codeHash = otpDigest({
    userId,
    purpose,
    email: destination,
    nonce,
    code,
  });

  const [insert] = await pool.query(
    `INSERT INTO usuario_mfa_email_challenges
      (
        usuario_id,
        purpose,
        email_destination,
        nonce,
        code_hash,
        attempts,
        max_attempts,
        expires_at,
        used_at,
        created_at
      )
     VALUES
      (
        ?, ?, ?, ?, ?,
        0, ?,
        DATE_ADD(
          UTC_TIMESTAMP(),
          INTERVAL ${expiresMinutes} MINUTE
        ),
        NULL,
        UTC_TIMESTAMP()
      )`,
    [
      userId,
      purpose,
      destination,
      nonce,
      codeHash,
      maxAttempts,
    ]
  );

  const requestId = Number(insert.insertId);

  try {
    const usuario = await cargarUsuarioSeguro(userId);

    await sendOtpEmail({
      to: destination,
      code,
      purpose,
      account: emailAccountLabel(usuario),
    });
  } catch (error) {
    await pool.query(
      `DELETE FROM usuario_mfa_email_challenges
       WHERE id = ?
         AND usuario_id = ?`,
      [requestId, userId]
    );
    throw error;
  }

  await pool.query(
    `UPDATE usuario_mfa_email_challenges
        SET used_at = COALESCE(
          used_at,
          UTC_TIMESTAMP()
        )
      WHERE usuario_id = ?
        AND purpose = ?
        AND id <> ?
        AND used_at IS NULL`,
    [userId, purpose, requestId]
  );

  return {
    request_id: requestId,
    masked_email: maskEmail(destination),
    expires_in_seconds: expiresMinutes * 60,
    ...emailOtpConfigPublic(),
  };
}

async function consumeEmailOtp({
  userId,
  purpose,
  requestId,
  code,
}) {
  const cleanCode = normalizeOtp(code);

  if (cleanCode.length !== 6) {
    return {
      ok: false,
      status: 400,
      code: "EMAIL_OTP_CODE_FORMAT",
      error:
        "Ingresa el código de 6 dígitos enviado por correo.",
    };
  }

  const numericRequestId = Number(requestId);

  if (
    !Number.isInteger(numericRequestId) ||
    numericRequestId <= 0
  ) {
    return {
      ok: false,
      status: 400,
      code: "EMAIL_OTP_REQUEST_INVALID",
      error:
        "La solicitud del código no es válida. Pide un código nuevo.",
    };
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT
          id,
          usuario_id,
          purpose,
          email_destination,
          nonce,
          code_hash,
          attempts,
          max_attempts,
          expires_at,
          used_at,
          CASE
            WHEN expires_at <= UTC_TIMESTAMP()
            THEN 1
            ELSE 0
          END AS expired
       FROM usuario_mfa_email_challenges
       WHERE id = ?
         AND usuario_id = ?
         AND purpose = ?
       LIMIT 1
       FOR UPDATE`,
      [numericRequestId, userId, purpose]
    );

    const challenge = rows[0];

    if (!challenge) {
      await connection.rollback();
      return {
        ok: false,
        status: 404,
        code: "EMAIL_OTP_NOT_FOUND",
        error:
          "Este código ya no está disponible. Solicita uno nuevo.",
      };
    }

    if (challenge.used_at) {
      await connection.rollback();
      return {
        ok: false,
        status: 409,
        code: "EMAIL_OTP_ALREADY_USED",
        error:
          "Ese código ya fue utilizado. Solicita uno nuevo.",
      };
    }

    if (Number(challenge.expired || 0) === 1) {
      await connection.query(
        `UPDATE usuario_mfa_email_challenges
         SET used_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [challenge.id]
      );
      await connection.commit();

      return {
        ok: false,
        status: 410,
        code: "EMAIL_OTP_EXPIRED",
        error: "El código venció. Solicita uno nuevo.",
      };
    }

    const attempts = Number(challenge.attempts || 0);
    const maxAttempts = Number(
      challenge.max_attempts || otpMaxAttempts()
    );

    if (attempts >= maxAttempts) {
      await connection.query(
        `UPDATE usuario_mfa_email_challenges
         SET used_at = COALESCE(
           used_at,
           UTC_TIMESTAMP()
         )
         WHERE id = ?`,
        [challenge.id]
      );
      await connection.commit();

      return {
        ok: false,
        status: 429,
        code: "EMAIL_OTP_ATTEMPTS_EXCEEDED",
        error:
          "Se agotaron los intentos para este código. Solicita uno nuevo.",
      };
    }

    const valid = verifyOtpDigest(
      {
        userId,
        purpose,
        email: challenge.email_destination,
        nonce: challenge.nonce,
        code: cleanCode,
      },
      challenge.code_hash
    );

    if (!valid) {
      const newAttempts = attempts + 1;
      const exhausted = newAttempts >= maxAttempts;

      await connection.query(
        `UPDATE usuario_mfa_email_challenges
            SET attempts = ?,
                used_at = CASE
                  WHEN ? = 1
                  THEN UTC_TIMESTAMP()
                  ELSE used_at
                END
          WHERE id = ?`,
        [
          newAttempts,
          exhausted ? 1 : 0,
          challenge.id,
        ]
      );

      await connection.commit();

      return {
        ok: false,
        status: exhausted ? 429 : 401,
        code: exhausted
          ? "EMAIL_OTP_ATTEMPTS_EXCEEDED"
          : "EMAIL_OTP_CODE_INVALID",
        error: exhausted
          ? "Código incorrecto. Se agotaron los intentos; solicita un código nuevo."
          : `Código incorrecto. Te quedan ${Math.max(
              0,
              maxAttempts - newAttempts
            )} intentos.`,
        attempts_remaining: Math.max(
          0,
          maxAttempts - newAttempts
        ),
      };
    }

    await connection.query(
      `UPDATE usuario_mfa_email_challenges
          SET attempts = attempts + 1,
              used_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [challenge.id]
    );

    await connection.commit();

    return {
      ok: true,
      email: challenge.email_destination,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

    throw error;
  } finally {
    connection.release();
  }
}

function respondEmailError(res, error) {
  const status = Number(error?.status || 500);

  if (
    status === 429 &&
    error?.retryAfterSeconds
  ) {
    res.setHeader(
      "Retry-After",
      String(error.retryAfterSeconds)
    );
  }

  return res.status(status).json({
    code: error?.code || "EMAIL_OTP_ERROR",
    error:
      status >= 500
        ? "No se pudo enviar el código por correo. Revisa la configuración SMTP."
        : error?.message ||
          "No se pudo completar la verificación por correo.",
    retry_after_seconds:
      error?.retryAfterSeconds || undefined,
  });
}

/* ============================================================
   CORREO - PRIMER ENROLAMIENTO
   ============================================================ */

router.post("/email/enroll/request", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "setup"
    );

    const mfa = await cargarMfa(userId);

    if (!mfa || Number(mfa.mfa_required) !== 1) {
      return res.status(403).json({
        code: "MFA_NOT_REQUIRED",
        error:
          "La autenticación en dos pasos no está habilitada para esta cuenta.",
      });
    }

    if (methodState(mfa).email_enabled) {
      return res.status(409).json({
        code: "EMAIL_ALREADY_ENABLED",
        error:
          "Esta cuenta ya tiene un correo alternativo verificado.",
      });
    }

    const email = normalizeRecoveryEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        code: "RECOVERY_EMAIL_INVALID",
        error: "Ingresa un correo alternativo válido.",
      });
    }

    const result = await issueEmailOtp({
      userId,
      purpose: "enroll",
      email,
    });

    return res.json({
      mensaje:
        "Enviamos un código al correo indicado. Escríbelo para activar este método.",
      ...result,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(
      res,
      error
    );
    if (challengeResponse) return challengeResponse;

    console.error(
      "Error enviando enrolamiento por correo:",
      error
    );
    return respondEmailError(res, error);
  }
});

router.post("/email/enroll/verify", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "setup"
    );

    const mfa = await cargarMfa(userId);

    if (!mfa || Number(mfa.mfa_required) !== 1) {
      return res.status(403).json({
        code: "MFA_NOT_REQUIRED",
        error:
          "La autenticación en dos pasos no está habilitada para esta cuenta.",
      });
    }

    const result = await consumeEmailOtp({
      userId,
      purpose: "enroll",
      requestId: req.body?.request_id,
      code: req.body?.code,
    });

    if (!result.ok) {
      return res
        .status(result.status)
        .json(result);
    }

    await pool.query(
      `UPDATE usuario_mfa
          SET recovery_email = ?,
              email_enabled = 1,
              email_verified_at = UTC_TIMESTAMP(),
              updated_at = UTC_TIMESTAMP()
        WHERE usuario_id = ?`,
      [result.email, userId]
    );

    const trustedDevice = await createTrustedDevice(
      pool,
      req,
      res,
      userId
    );
    const usuario = await cargarUsuarioSeguro(userId);

    await auditMfa(pool, req, {
      event: "MFA_EMAIL_ADDED",
      targetUserId: userId,
      method: "email",
      success: true,
    });
    await auditMfa(pool, req, {
      event: "TRUSTED_DEVICE_CREATED",
      targetUserId: userId,
      method: "trusted_device",
      success: true,
      metadata: { trusted_device_id: Number(trustedDevice?.id || 0) || null },
    });

    return res.json({
      mensaje:
        "Correo alternativo verificado y activado correctamente.",
      email_enabled: true,
      masked_email: maskEmail(result.email),
      trusted_device: trustedDevice,
      usuario,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(
      res,
      error
    );
    if (challengeResponse) return challengeResponse;

    console.error(
      "Error verificando enrolamiento por correo:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo confirmar el correo alternativo.",
    });
  }
});

/* ============================================================
   CORREO - LOGIN EN DISPOSITIVO NUEVO
   ============================================================ */

router.post("/email/login/status", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "verify"
    );

    const mfa = await cargarMfa(userId);
    const methods = methodState(mfa);

    return res.json({
      totp_available: methods.totp_enabled,
      email_available: methods.email_enabled,
      masked_email: methods.masked_email,
      ...emailOtpConfigPublic(),
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(
      res,
      error
    );
    if (challengeResponse) return challengeResponse;

    console.error(
      "Error consultando métodos MFA:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudieron consultar los métodos de seguridad.",
    });
  }
});

router.post("/email/login/request", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "verify"
    );

    const mfa = await cargarMfa(userId);
    const methods = methodState(mfa);

    if (!methods.email_enabled) {
      return res.status(403).json({
        code: "EMAIL_MFA_NOT_CONFIGURED",
        error:
          "Esta cuenta no tiene un correo alternativo verificado.",
      });
    }

    const result = await issueEmailOtp({
      userId,
      purpose: "login",
      email: methods.recovery_email,
    });

    return res.json({
      mensaje:
        "Código enviado al correo alternativo.",
      ...result,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(
      res,
      error
    );
    if (challengeResponse) return challengeResponse;

    console.error(
      "Error enviando OTP de login por correo:",
      error
    );
    return respondEmailError(res, error);
  }
});

router.post("/email/login/verify", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(
      req.body?.challenge,
      "verify"
    );

    const mfa = await cargarMfa(userId);
    const methods = methodState(mfa);

    if (!methods.email_enabled) {
      return res.status(403).json({
        code: "EMAIL_MFA_NOT_CONFIGURED",
        error:
          "La verificación por correo no está disponible para esta cuenta.",
      });
    }

    const result = await consumeEmailOtp({
      userId,
      purpose: "login",
      requestId: req.body?.request_id,
      code: req.body?.code,
    });

    if (!result.ok) {
      await auditMfa(pool, req, {
        event: "MFA_EMAIL_FAILED",
        targetUserId: userId,
        method: "email",
        success: false,
        metadata: { code: result.code || null },
      });
      return res
        .status(result.status)
        .json(result);
    }

    const trustedDevice = await createTrustedDevice(
      pool,
      req,
      res,
      userId
    );
    const usuario = await cargarUsuarioSeguro(userId);

    await auditMfa(pool, req, {
      event: "MFA_EMAIL_SUCCESS",
      targetUserId: userId,
      method: "email",
      success: true,
    });
    await auditMfa(pool, req, {
      event: "TRUSTED_DEVICE_CREATED",
      targetUserId: userId,
      method: "trusted_device",
      success: true,
      metadata: { trusted_device_id: Number(trustedDevice?.id || 0) || null },
    });

    return res.json({
      mensaje: "Código por correo correcto.",
      trusted_device: trustedDevice,
      usuario,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(
      res,
      error
    );
    if (challengeResponse) return challengeResponse;

    console.error(
      "Error verificando OTP de login por correo:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo verificar el código por correo.",
    });
  }
});

/* ============================================================
   SEGURIDAD DESDE DISPOSITIVO CONFIABLE
   ============================================================ */

router.get("/methods", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const mfa = await cargarMfa(auth.userId);
    const methods = methodState(mfa);

    return res.json({
      totp_enabled: methods.totp_enabled,
      email_enabled: methods.email_enabled,
      masked_email: methods.masked_email,
      email_verified_at:
        methods.email_enabled
          ? mfa.email_verified_at
          : null,
    });
  } catch (error) {
    console.error(
      "Error consultando métodos MFA:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudieron cargar los métodos de seguridad.",
    });
  }
});

router.post("/totp/setup/start", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const mfa = await cargarMfa(auth.userId);
    const methods = methodState(mfa);

    if (methods.totp_enabled) {
      return res.status(409).json({
        code: "TOTP_ALREADY_ENABLED",
        error:
          "Google Authenticator ya está configurado.",
      });
    }

    const setup = await iniciarTotpParaUsuario(
      auth.userId
    );

    return res.json(setup);
  } catch (error) {
    console.error(
      "Error preparando Authenticator:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo preparar Google Authenticator.",
    });
  }
});

router.post("/totp/setup/verify", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const mfa = await cargarMfa(auth.userId);
    const methods = methodState(mfa);

    if (methods.totp_enabled) {
      return res.status(409).json({
        code: "TOTP_ALREADY_ENABLED",
        error:
          "Google Authenticator ya está configurado.",
      });
    }

    const verified = await validarPendingTotp(
      auth.userId,
      req.body?.code
    );

    if (!verified.ok) {
      return res
        .status(verified.status)
        .json(verified.body);
    }

    await auditMfa(pool, req, {
      event: "MFA_TOTP_ADDED",
      targetUserId: auth.userId,
      actorUserId: auth.userId,
      method: "totp",
      success: true,
    });

    return res.json({
      mensaje:
        "Google Authenticator agregado correctamente.",
      totp_enabled: true,
    });
  } catch (error) {
    console.error(
      "Error confirmando Authenticator:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo confirmar Google Authenticator.",
    });
  }
});

router.get("/email", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const mfa = await cargarMfa(auth.userId);

    return res.json({
      recovery_email:
        mfa?.recovery_email || "",
      masked_email:
        mfa?.recovery_email
          ? maskEmail(mfa.recovery_email)
          : "",
      email_enabled:
        methodState(mfa).email_enabled,
      email_verified_at:
        mfa?.email_verified_at || null,
      ...emailOtpConfigPublic(),
    });
  } catch (error) {
    console.error(
      "Error consultando correo alternativo:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo cargar el correo alternativo.",
    });
  }
});

router.post("/email/setup/request", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const email = normalizeRecoveryEmail(
      req.body?.email
    );

    if (!email) {
      return res.status(400).json({
        code: "RECOVERY_EMAIL_INVALID",
        error:
          "Ingresa un correo alternativo válido.",
      });
    }

    const result = await issueEmailOtp({
      userId: auth.userId,
      purpose: "setup",
      email,
    });

    return res.json({
      mensaje:
        "Enviamos un código al correo indicado. Escríbelo para confirmar.",
      ...result,
    });
  } catch (error) {
    console.error(
      "Error enviando verificación de correo alternativo:",
      error
    );
    return respondEmailError(res, error);
  }
});

router.post("/email/setup/verify", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const result = await consumeEmailOtp({
      userId: auth.userId,
      purpose: "setup",
      requestId: req.body?.request_id,
      code: req.body?.code,
    });

    if (!result.ok) {
      return res
        .status(result.status)
        .json(result);
    }

    await pool.query(
      `UPDATE usuario_mfa
          SET recovery_email = ?,
              email_enabled = 1,
              email_verified_at = UTC_TIMESTAMP(),
              updated_at = UTC_TIMESTAMP()
        WHERE usuario_id = ?`,
      [result.email, auth.userId]
    );

    await auditMfa(pool, req, {
      event: "MFA_EMAIL_ADDED",
      targetUserId: auth.userId,
      actorUserId: auth.userId,
      method: "email",
      success: true,
    });

    return res.json({
      mensaje:
        "Correo alternativo verificado correctamente.",
      recovery_email: result.email,
      masked_email: maskEmail(result.email),
      email_enabled: true,
    });
  } catch (error) {
    console.error(
      "Error confirmando correo alternativo:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo confirmar el correo alternativo.",
    });
  }
});

router.delete("/email", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const mfa = await cargarMfa(auth.userId);
    const methods = methodState(mfa);

    if (
      methods.email_enabled &&
      !methods.totp_enabled
    ) {
      return res.status(409).json({
        code: "LAST_MFA_METHOD",
        error:
          "No puedes eliminar el correo porque es el único método de seguridad de esta cuenta. Agrega Google Authenticator primero.",
      });
    }

    await pool.query(
      `UPDATE usuario_mfa
          SET recovery_email = NULL,
              email_enabled = 0,
              email_verified_at = NULL,
              updated_at = UTC_TIMESTAMP()
        WHERE usuario_id = ?`,
      [auth.userId]
    );

    await pool.query(
      `UPDATE usuario_mfa_email_challenges
          SET used_at = COALESCE(
            used_at,
            UTC_TIMESTAMP()
          )
        WHERE usuario_id = ?
          AND used_at IS NULL`,
      [auth.userId]
    );

    return res.json({
      mensaje:
        "Correo alternativo eliminado. Google Authenticator continúa activo.",
      email_enabled: false,
    });
  } catch (error) {
    console.error(
      "Error eliminando correo alternativo:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo eliminar el correo alternativo.",
    });
  }
});

/* ============================================================
   FASE 4 - CÓDIGOS DE RECUPERACIÓN
   ============================================================ */

router.get("/recovery/status", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(req, res);
    if (!auth) return;

    const [rows] = await pool.query(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN used_at IS NULL AND revoked_at IS NULL THEN 1 ELSE 0 END) AS available,
          MAX(created_at) AS last_generated_at
       FROM usuario_mfa_recovery_codes
       WHERE usuario_id = ?`,
      [auth.userId]
    );

    return res.json({
      total: Number(rows[0]?.total || 0),
      available: Number(rows[0]?.available || 0),
      last_generated_at: rows[0]?.last_generated_at || null,
      configured: Number(rows[0]?.available || 0) > 0,
    });
  } catch (error) {
    console.error("Error consultando códigos de recuperación:", error);
    return res.status(500).json({ error: "No se pudieron consultar los códigos de recuperación." });
  }
});

router.post("/recovery/generate", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(req, res);
    if (!auth) return;

    const mfa = await cargarMfa(auth.userId);
    const methods = methodState(mfa);
    if (!methods.has_any_method) {
      return res.status(409).json({
        code: "MFA_METHOD_REQUIRED",
        error: "Configura primero Authenticator o correo antes de generar códigos de recuperación.",
      });
    }

    const codes = generateRecoveryCodes(recoveryCodeCount());
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE usuario_mfa_recovery_codes
            SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
          WHERE usuario_id = ?
            AND used_at IS NULL
            AND revoked_at IS NULL`,
        [auth.userId]
      );

      for (const code of codes) {
        await connection.query(
          `INSERT INTO usuario_mfa_recovery_codes
            (usuario_id, code_hash, created_at, used_at, revoked_at)
           VALUES (?, ?, UTC_TIMESTAMP(), NULL, NULL)`,
          [auth.userId, hashRecoveryCode(auth.userId, code)]
        );
      }

      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }

    await auditMfa(pool, req, {
      event: "MFA_RECOVERY_CODES_GENERATED",
      targetUserId: auth.userId,
      actorUserId: auth.userId,
      method: "recovery",
      success: true,
      metadata: { count: codes.length },
    });

    return res.json({
      mensaje: "Códigos de recuperación generados. Guárdalos ahora: no volverán a mostrarse.",
      codes,
      count: codes.length,
    });
  } catch (error) {
    console.error("Error generando códigos de recuperación:", error);
    return res.status(500).json({ error: "No se pudieron generar los códigos de recuperación." });
  }
});

router.post("/recovery/verify-login", async (req, res) => {
  try {
    const { userId } = verifyMfaChallenge(req.body?.challenge, "verify");
    const normalized = normalizeRecoveryCode(req.body?.code);

    if (!normalized) {
      return res.status(400).json({
        code: "RECOVERY_CODE_FORMAT",
        error: "Ingresa un código de recuperación válido.",
      });
    }

    const digest = hashRecoveryCode(userId, normalized);
    const connection = await pool.getConnection();
    let matchedId = null;

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id
           FROM usuario_mfa_recovery_codes
          WHERE usuario_id = ?
            AND code_hash = ?
            AND used_at IS NULL
            AND revoked_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [userId, digest]
      );

      if (!rows.length) {
        await connection.rollback();
        await auditMfa(pool, req, {
          event: "MFA_RECOVERY_FAILED",
          targetUserId: userId,
          method: "recovery",
          success: false,
        });

        return res.status(401).json({
          code: "RECOVERY_CODE_INVALID",
          error: "Código de recuperación incorrecto, usado o revocado.",
        });
      }

      matchedId = Number(rows[0].id);
      await connection.query(
        `UPDATE usuario_mfa_recovery_codes
            SET used_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [matchedId]
      );

      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }

    const trustedDevice = await createTrustedDevice(pool, req, res, userId);
    const usuario = await cargarUsuarioSeguro(userId);

    await auditMfa(pool, req, {
      event: "MFA_RECOVERY_SUCCESS",
      targetUserId: userId,
      method: "recovery",
      success: true,
      metadata: { recovery_code_id: matchedId },
    });
    await auditMfa(pool, req, {
      event: "TRUSTED_DEVICE_CREATED",
      targetUserId: userId,
      method: "trusted_device",
      success: true,
      metadata: { trusted_device_id: Number(trustedDevice?.id || 0) || null },
    });

    return res.json({
      mensaje: "Código de recuperación correcto.",
      trusted_device: trustedDevice,
      usuario,
    });
  } catch (error) {
    const challengeResponse = responderChallengeInvalido(res, error);
    if (challengeResponse) return challengeResponse;

    console.error("Error verificando código de recuperación:", error);
    return res.status(500).json({ error: "No se pudo verificar el código de recuperación." });
  }
});

/* ============================================================
   FASE 4 - ADMINISTRACIÓN MFA
   Sólo usuario confiable + permiso gestionar_mfa.
   ============================================================ */

router.get("/admin/users/:userId/status", async (req, res) => {
  try {
    const admin = await requireMfaAdmin(req, res);
    if (!admin) return;

    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ error: "Usuario inválido." });
    }

    const [users] = await pool.query(
      `SELECT id, nombre, apellido, correo, correo AS usuario, estado, rol_id
         FROM usuario
        WHERE id = ?
        LIMIT 1`,
      [targetUserId]
    );

    if (!users.length) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const mfa = await cargarMfa(targetUserId);
    const methods = methodState(mfa);

    const [deviceRows] = await pool.query(
      `SELECT COUNT(*) AS count
         FROM usuario_mfa_dispositivos
        WHERE usuario_id = ?
          AND revoked_at IS NULL
          AND expires_at > UTC_TIMESTAMP()`,
      [targetUserId]
    );

    const [recoveryRows] = await pool.query(
      `SELECT COUNT(*) AS available
         FROM usuario_mfa_recovery_codes
        WHERE usuario_id = ?
          AND used_at IS NULL
          AND revoked_at IS NULL`,
      [targetUserId]
    );

    const [auditRows] = await pool.query(
      `SELECT id, evento, metodo, resultado, ip, created_at, actor_usuario_id
         FROM usuario_mfa_auditoria
        WHERE usuario_id = ?
        ORDER BY id DESC
        LIMIT 12`,
      [targetUserId]
    );

    await auditMfa(pool, req, {
      event: "MFA_ADMIN_STATUS_VIEWED",
      targetUserId,
      actorUserId: admin.actorUserId,
      method: "admin",
      success: true,
    });

    return res.json({
      usuario: users[0],
      mfa_required: Number(mfa?.mfa_required || 0) === 1,
      totp_enabled: methods.totp_enabled,
      email_enabled: methods.email_enabled,
      masked_email: methods.masked_email,
      trusted_devices: Number(deviceRows[0]?.count || 0),
      recovery_codes_available: Number(recoveryRows[0]?.available || 0),
      audit: auditRows,
    });
  } catch (error) {
    console.error("Error consultando estado MFA administrativo:", error);
    return res.status(500).json({ error: "No se pudo consultar el estado MFA." });
  }
});

router.post("/admin/users/:userId/reset", async (req, res) => {
  try {
    const admin = await requireMfaAdmin(req, res);
    if (!admin) return;

    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ error: "Usuario inválido." });
    }

    if (req.body?.confirm !== true) {
      return res.status(400).json({
        code: "MFA_ADMIN_RESET_CONFIRM_REQUIRED",
        error: "Debes confirmar explícitamente el restablecimiento MFA.",
      });
    }

    const [users] = await pool.query(
      `SELECT id, correo, correo AS usuario
         FROM usuario
        WHERE id = ?
        LIMIT 1`,
      [targetUserId]
    );

    if (!users.length) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        `INSERT INTO usuario_mfa (usuario_id, mfa_required, mfa_enabled)
         VALUES (?, 1, 0)
         ON DUPLICATE KEY UPDATE
           mfa_required = 1,
           mfa_enabled = 0,
           secret_encrypted = NULL,
           pending_secret_encrypted = NULL,
           pending_created_at = NULL,
           enabled_at = NULL,
           last_totp_counter = NULL,
           recovery_email = NULL,
           email_enabled = 0,
           email_verified_at = NULL,
           updated_at = UTC_TIMESTAMP()`,
        [targetUserId]
      );

      await connection.query(
        `UPDATE usuario_mfa_dispositivos
            SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
          WHERE usuario_id = ?`,
        [targetUserId]
      );

      await connection.query(
        `UPDATE usuario_mfa_email_challenges
            SET used_at = COALESCE(used_at, UTC_TIMESTAMP())
          WHERE usuario_id = ?
            AND used_at IS NULL`,
        [targetUserId]
      );

      await connection.query(
        `UPDATE usuario_mfa_recovery_codes
            SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
          WHERE usuario_id = ?
            AND used_at IS NULL`,
        [targetUserId]
      );

      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }

    // Si el administrador se restablece a sí mismo, invalida también su cookie actual.
    if (targetUserId === admin.actorUserId) {
      clearTrustedCookie(res, targetUserId);
    }

    await auditMfa(pool, req, {
      event: "MFA_ADMIN_RESET",
      targetUserId,
      actorUserId: admin.actorUserId,
      method: "admin",
      success: true,
    });

    return res.json({
      mensaje: "MFA restablecido. En el próximo inicio de sesión el usuario deberá elegir y configurar nuevamente un método de seguridad.",
      usuario_id: targetUserId,
      mfa_required: true,
    });
  } catch (error) {
    console.error("Error restableciendo MFA:", error);
    return res.status(500).json({ error: "No se pudo restablecer MFA." });
  }
});

/* ============================================================
   DISPOSITIVOS
   ============================================================ */

router.get("/devices", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const [rows] = await pool.query(
      `SELECT
          id,
          nombre,
          user_agent,
          created_at,
          last_used_at,
          expires_at
       FROM usuario_mfa_dispositivos
       WHERE usuario_id = ?
         AND revoked_at IS NULL
         AND expires_at > UTC_TIMESTAMP()
       ORDER BY
         last_used_at DESC,
         id DESC`,
      [auth.userId]
    );

    return res.json({
      devices: rows.map((item) => ({
        id: Number(item.id),
        nombre: item.nombre,
        user_agent: item.user_agent,
        created_at: item.created_at,
        last_used_at: item.last_used_at,
        expires_at: item.expires_at,
        current:
          Number(item.id) ===
          Number(auth.device.id),
      })),
    });
  } catch (error) {
    console.error(
      "Error listando dispositivos MFA:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudieron cargar los dispositivos.",
    });
  }
});

router.delete("/devices/:deviceId", async (req, res) => {
  try {
    const auth = await requireCurrentTrustedDevice(
      req,
      res
    );
    if (!auth) return;

    const deviceId = Number(req.params.deviceId);

    if (
      !Number.isInteger(deviceId) ||
      deviceId <= 0
    ) {
      return res
        .status(400)
        .json({ error: "Dispositivo inválido." });
    }

    const revoked = await revokeDevice(
      pool,
      auth.userId,
      deviceId
    );

    if (!revoked) {
      return res.status(404).json({
        error:
          "El dispositivo no existe o ya fue revocado.",
      });
    }

    const currentRevoked =
      Number(auth.device.id) === deviceId;

    if (currentRevoked) {
      clearTrustedCookie(
        res,
        auth.userId
      );
    }

    await auditMfa(pool, req, {
      event: "TRUSTED_DEVICE_REVOKED",
      targetUserId: auth.userId,
      actorUserId: auth.userId,
      method: "trusted_device",
      success: true,
      metadata: { revoked_device_id: deviceId, current: currentRevoked },
    });

    return res.json({
      mensaje: currentRevoked
        ? "Este dispositivo fue revocado. En el próximo login se pedirá un método de seguridad."
        : "Dispositivo revocado correctamente.",
      revoked_device_id: deviceId,
      current_revoked: currentRevoked,
    });
  } catch (error) {
    console.error(
      "Error revocando dispositivo MFA:",
      error
    );
    return res.status(500).json({
      error:
        "No se pudo revocar el dispositivo.",
    });
  }
});

module.exports = router;
