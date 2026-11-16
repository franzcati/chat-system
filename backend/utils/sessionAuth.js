const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../db");

const SESSION_COOKIE_NAME =
  String(process.env.SESSION_COOKIE_NAME || "qc_session").trim() || "qc_session";

const SESSION_ISSUER = "quickchat-chatvista";
const SESSION_AUDIENCE = "chat-system";
const DEFAULT_SESSION_TTL_HOURS = 168;

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || "").trim();

  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET debe estar configurado y tener al menos 32 caracteres"
    );
  }

  return secret;
}

function getSessionTtlHours() {
  const parsed = Number.parseInt(process.env.SESSION_TTL_HOURS, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_TTL_HOURS;
  }

  return Math.min(parsed, 24 * 30);
}

function isSecureRequest(req) {
  return Boolean(req?.secure);
}

function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge: getSessionTtlHours() * 60 * 60 * 1000,
  };
}

function createSessionToken(userId, sessionId) {
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new Error("Usuario inválido para crear sesión");
  }

  const ttlHours = getSessionTtlHours();

  return jwt.sign(
    {
      type: "session",
      sid: sessionId,
    },
    getSessionSecret(),
    {
      algorithm: "HS256",
      subject: String(numericUserId),
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      expiresIn: `${ttlHours}h`,
    }
  );
}

async function setAuthSession(req, res, userId) {
  const sessionId = crypto.randomUUID();
  const [users] = await pool.query("SELECT instancia_id,nombre,apellido,correo FROM usuario WHERE id=? AND estado='aprobado' LIMIT 1", [userId]);
  if (!users.length || !users[0].instancia_id) throw new Error("Usuario sin instancia activa");
  const deviceToken = String(parseCookies(req).qc_security_device || "");
  let deviceHash = crypto.createHash("sha256").update(deviceToken || crypto.randomBytes(32)).digest("hex");
  const ttlHours = getSessionTtlHours();
  const token = createSessionToken(userId, sessionId);
  const { sourceIp } = require('./securityCenter');
  const ip = String(sourceIp(req) || '').slice(0, 64);
  await pool.query(
    `INSERT INTO security_sessions (id, usuario_id, instancia_id, device_hash, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR))`,
    [sessionId, userId, users[0].instancia_id, deviceHash, ip, String(req.headers["user-agent"] || "").slice(0, 500), ttlHours]
  );
  if (!deviceToken) {
    // La cookie de dispositivo persiste entre logins; nunca se almacena su valor en claro.
    const newDeviceToken = crypto.randomBytes(32).toString("base64url");
    const newHash = crypto.createHash("sha256").update(newDeviceToken).digest("hex");
    await pool.query("UPDATE security_sessions SET device_hash=? WHERE id=?", [newHash, sessionId]);
    deviceHash = newHash;
    res.cookie("qc_security_device", newDeviceToken, { httpOnly: true, secure: isSecureRequest(req), sameSite: "lax", path: "/", maxAge: 365 * 86400000 });
  }

  try {
    const { policyFor, queueAlert, escapeTelegram } = require("./securityCenter");
    const userLabel = escapeTelegram(`${users[0].nombre || ''} ${users[0].apellido || ''}`.trim() || users[0].correo || userId);
    const [device] = await pool.query(`INSERT IGNORE INTO security_devices (instancia_id,usuario_id,device_hash)
      VALUES (?,?,?)`, [users[0].instancia_id, userId, deviceHash]);
    await pool.query(`UPDATE security_devices SET last_seen_at=UTC_TIMESTAMP(3)
      WHERE instancia_id=? AND usuario_id=? AND device_hash=?`, [users[0].instancia_id, userId, deviceHash]);
    const policy = await policyFor(pool, users[0].instancia_id);
    await pool.query(`INSERT INTO security_events
      (instancia_id,usuario_id,session_id,event_type,result,ip,user_agent)
      VALUES (?,?,?,'LOGIN_SUCCESS','ok',?,?)`,
      [users[0].instancia_id,userId,sessionId,ip,String(req.headers['user-agent'] || '').slice(0,500)]);
    if (device.affectedRows && policy.alert_new_device) {
      const [evt] = await pool.query(`INSERT INTO security_events
        (instancia_id,usuario_id,session_id,event_type,result,ip,user_agent)
        VALUES (?,?,?,'NEW_DEVICE','ok',?,?)`, [users[0].instancia_id,userId,sessionId,ip,String(req.headers['user-agent'] || '').slice(0,500)]);
      await queueAlert(pool, users[0].instancia_id, evt.insertId, `new-device:${userId}:${deviceHash}`,
        `🚨 CHATVISTA · Nuevo dispositivo\nUsuario: ${userLabel} (${userId})\nFecha: ${new Date().toISOString()}\nIP: ${escapeTelegram(ip)}\nNavegador: ${escapeTelegram(req.headers['user-agent'])}\nSesión: ${sessionId}`);
    }
    const [count] = await pool.query(`SELECT COUNT(DISTINCT device_hash) n FROM security_sessions WHERE instancia_id=? AND usuario_id=?
      AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3) AND last_seen_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)`, [users[0].instancia_id,userId]);
    if (Number(count[0].n) > 1 && policy.alert_multiple_devices) {
      const [activeDevices] = await pool.query(`SELECT ip,user_agent,MAX(last_seen_at) last_seen_at
        FROM security_sessions WHERE instancia_id=? AND usuario_id=?
        AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
        AND last_seen_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)
        GROUP BY device_hash,ip,user_agent ORDER BY last_seen_at DESC LIMIT 8`,
        [users[0].instancia_id,userId]);
      const [evt] = await pool.query(`INSERT INTO security_events (instancia_id,usuario_id,session_id,event_type,result,detail_json)
        VALUES (?,?,?,'MULTIPLE_DEVICES','ok',?)`, [users[0].instancia_id,userId,sessionId,
          JSON.stringify({ count: Number(count[0].n), devices: activeDevices.map(({ ip, user_agent }) => ({ ip, user_agent })) })]);
      const details = activeDevices.map((device, index) =>
        `${index + 1}. IP: ${escapeTelegram(device.ip)} · ${escapeTelegram(device.user_agent)}`).join('\n');
      await queueAlert(pool, users[0].instancia_id,evt.insertId,`multi:${userId}:${Math.floor(Date.now()/3600000)}`,
        `⚠️ CHATVISTA · Dispositivos simultáneos\nUsuario: ${userLabel} (${userId})\nDispositivos: ${count[0].n}\nFecha: ${new Date().toISOString()}\n${details}`);
    }
  } catch (error) { console.error("No se pudo registrar el dispositivo:", error.message); }

  res.cookie(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(req)
  );

  return token;
}

async function verifyStoredSession(session) {
  const [rows] = await pool.query(
    `SELECT id, instancia_id, device_hash FROM security_sessions
     WHERE id=? AND usuario_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3) LIMIT 1`,
    [session.sessionId, session.userId]
  );
  if (!rows.length) {
    const error = new Error("Sesión revocada");
    error.code = "SESSION_INVALID";
    throw error;
  }
  await pool.query(`UPDATE security_sessions SET last_seen_at=UTC_TIMESTAMP(3)
    WHERE id=? AND last_seen_at<DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE)`, [session.sessionId]);
  return rows[0];
}

async function revokeSession(sessionId) {
  if (sessionId) await pool.query("UPDATE security_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=? AND revoked_at IS NULL", [sessionId]);
}

async function revokeUserSessions(userId) {
  await pool.query("UPDATE security_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE usuario_id=? AND revoked_at IS NULL", [userId]);
}

function parseCookies(req) {
  const raw = String(req?.headers?.cookie || "");
  const cookies = {};

  for (const part of raw.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex <= 0) continue;

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (!key) continue;

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function getAuthSessionToken(req) {
  const cookies = parseCookies(req);
  return String(cookies[SESSION_COOKIE_NAME] || "").trim();
}

function verifyAuthSession(req) {
  const token = getAuthSessionToken(req);

  if (!token) {
    const error = new Error("Sesión no encontrada");
    error.code = "SESSION_MISSING";
    throw error;
  }

  let payload;

  try {
    payload = jwt.verify(token, getSessionSecret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
  } catch (cause) {
    const error = new Error("Sesión inválida o expirada");
    error.code = "SESSION_INVALID";
    error.cause = cause;
    throw error;
  }

  if (!payload || payload.type !== "session" || !/^[0-9a-f-]{36}$/i.test(payload.sid || "")) {
    const error = new Error("Tipo de sesión inválido");
    error.code = "SESSION_INVALID";
    throw error;
  }

  const userId = Number(payload.sub);

  if (!Number.isInteger(userId) || userId <= 0) {
    const error = new Error("Usuario de sesión inválido");
    error.code = "SESSION_INVALID";
    throw error;
  }

  return {
    userId,
    sessionId: payload.sid,
    issuedAt: Number(payload.iat || 0),
    expiresAt: Number(payload.exp || 0),
  };
}

function clearAuthSession(req, res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/",
  });
}

module.exports = {
  SESSION_COOKIE_NAME,
  setAuthSession,
  verifyAuthSession,
  verifyStoredSession,
  revokeSession,
  revokeUserSessions,
  clearAuthSession,
};
