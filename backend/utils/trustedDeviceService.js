const crypto = require("crypto");

const COOKIE_PREFIX = "__Host-qc_mfa_device_";
const DEFAULT_TRUST_DAYS = 365;
const TOKEN_BYTES = 32;

function trustDays() {
  const value = Number(process.env.MFA_TRUSTED_DEVICE_DAYS || DEFAULT_TRUST_DAYS);
  if (!Number.isFinite(value) || value < 1 || value > 3650) return DEFAULT_TRUST_DAYS;
  return Math.floor(value);
}

function cookieName(userId) {
  return `${COOKIE_PREFIX}${Number(userId)}`;
}

function parseCookies(req) {
  const raw = String(req?.headers?.cookie || "");
  const result = {};

  raw.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) return;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  });

  return result;
}

function getDeviceToken(req, userId) {
  return parseCookies(req)[cookieName(userId)] || "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function safeHeader(value, max = 500) {
  return String(value || "").replace(/[\r\n\0]/g, " ").trim().slice(0, max);
}

function browserName(userAgent) {
  const ua = String(userAgent || "");
  if (/Edg\//i.test(ua)) return "Microsoft Edge";
  if (/OPR\//i.test(ua)) return "Opera";
  if (/CriOS\//i.test(ua)) return "Chrome";
  if (/FxiOS\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Navegador";
}

function platformName(userAgent) {
  const ua = String(userAgent || "");
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Dispositivo";
}

function deviceNameFromRequest(req) {
  const ua = safeHeader(req?.headers?.["user-agent"]);
  return `${browserName(ua)} · ${platformName(ua)}`.slice(0, 180);
}

function setTrustedCookie(res, userId, token) {
  const maxAge = trustDays() * 24 * 60 * 60;
  const value = encodeURIComponent(String(token));
  res.append(
    "Set-Cookie",
    `${cookieName(userId)}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

function clearTrustedCookie(res, userId) {
  res.append(
    "Set-Cookie",
    `${cookieName(userId)}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

async function createTrustedDevice(pool, req, res, userId) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(token);
  const days = trustDays();
  const name = deviceNameFromRequest(req);
  const userAgent = safeHeader(req?.headers?.["user-agent"]);

  const [result] = await pool.query(
    `INSERT INTO usuario_mfa_dispositivos
      (usuario_id, token_hash, nombre, user_agent, created_at, last_used_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${days} DAY), NULL)`,
    [userId, tokenHash, name, userAgent]
  );

  setTrustedCookie(res, userId, token);

  return {
    id: Number(result.insertId),
    nombre: name,
    current: true,
    trust_days: days,
  };
}

async function findTrustedDevice(pool, req, res, userId, options = {}) {
  const token = getDeviceToken(req, userId);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const [rows] = await pool.query(
    `SELECT id, usuario_id, token_hash, nombre, user_agent,
            created_at, last_used_at, expires_at, revoked_at
       FROM usuario_mfa_dispositivos
      WHERE usuario_id = ?
        AND token_hash = ?
        AND revoked_at IS NULL
        AND expires_at > UTC_TIMESTAMP()
      LIMIT 1`,
    [userId, tokenHash]
  );

  const device = rows[0] || null;
  if (!device) {
    if (res) clearTrustedCookie(res, userId);
    return null;
  }

  if (options.touch !== false) {
    const days = trustDays();
    const userAgent = safeHeader(req?.headers?.["user-agent"]);
    await pool.query(
      `UPDATE usuario_mfa_dispositivos
          SET last_used_at = UTC_TIMESTAMP(),
              expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${days} DAY),
              user_agent = ?
        WHERE id = ?`,
      [userAgent, device.id]
    );
    setTrustedCookie(res, userId, token);
  }

  return device;
}

async function revokeDevice(pool, userId, deviceId) {
  const [result] = await pool.query(
    `UPDATE usuario_mfa_dispositivos
        SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP())
      WHERE id = ?
        AND usuario_id = ?
        AND revoked_at IS NULL`,
    [deviceId, userId]
  );
  return result.affectedRows === 1;
}

module.exports = {
  cookieName,
  getDeviceToken,
  hashToken,
  createTrustedDevice,
  findTrustedDevice,
  revokeDevice,
  clearTrustedCookie,
  trustDays,
};
