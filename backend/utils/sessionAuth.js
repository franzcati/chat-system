const jwt = require("jsonwebtoken");

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
  if (req?.secure) return true;

  const forwardedProto = String(
    req?.headers?.["x-forwarded-proto"] || ""
  )
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https";
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

function createSessionToken(userId) {
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new Error("Usuario inválido para crear sesión");
  }

  const ttlHours = getSessionTtlHours();

  return jwt.sign(
    {
      type: "session",
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

function setAuthSession(req, res, userId) {
  const token = createSessionToken(userId);

  res.cookie(
    SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(req)
  );

  return token;
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

  if (!payload || payload.type !== "session") {
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
  clearAuthSession,
};
