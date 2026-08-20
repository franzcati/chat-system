const crypto = require("crypto");
const nodemailer = require("nodemailer");

const OTP_DIGITS = 6;

let transporter = null;
let transporterFingerprint = "";

function envInt(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function otpExpiresMinutes() {
  return envInt("MFA_EMAIL_OTP_EXPIRES_MINUTES", 5, 2, 15);
}

function otpMaxAttempts() {
  return envInt("MFA_EMAIL_OTP_MAX_ATTEMPTS", 5, 3, 10);
}

function otpMaxSends() {
  return envInt("MFA_EMAIL_OTP_MAX_SENDS", 3, 1, 10);
}

function otpWindowMinutes() {
  return envInt("MFA_EMAIL_OTP_WINDOW_MINUTES", 15, 5, 60);
}

function otpCooldownSeconds() {
  return envInt("MFA_EMAIL_OTP_COOLDOWN_SECONDS", 60, 30, 300);
}

function getOtpSecret() {
  const secret = String(process.env.MFA_EMAIL_OTP_SECRET || "").trim();
  if (secret.length < 32) {
    const error = new Error("MFA_EMAIL_OTP_SECRET debe tener al menos 32 caracteres");
    error.code = "MFA_EMAIL_OTP_SECRET_MISSING";
    throw error;
  }
  return secret;
}

function normalizeRecoveryEmail(value) {
  const email = String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase();

  if (email.length < 5 || email.length > 320) return "";
  if (/[\r\n\0]/.test(email)) return "";

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email);
  return valid ? email : "";
}

function maskEmail(value) {
  const email = normalizeRecoveryEmail(value);
  if (!email) return "";

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 1
    ? `${local || "*"}***`
    : `${local.slice(0, Math.min(2, local.length))}${"*".repeat(Math.min(5, Math.max(3, local.length - 2)))}`;

  return `${visible}@${domain}`;
}

function normalizeOtp(value) {
  return String(value || "").replace(/\D/g, "").slice(0, OTP_DIGITS);
}

function generateEmailOtp() {
  return crypto.randomInt(0, 10 ** OTP_DIGITS).toString().padStart(OTP_DIGITS, "0");
}

function generateNonce() {
  return crypto.randomBytes(16).toString("hex");
}

function otpDigest({ userId, purpose, email, nonce, code }) {
  return crypto
    .createHmac("sha256", getOtpSecret())
    .update([
      String(Number(userId)),
      String(purpose || ""),
      normalizeRecoveryEmail(email),
      String(nonce || ""),
      normalizeOtp(code),
    ].join("|"), "utf8")
    .digest("hex");
}

function verifyOtpDigest(params, expectedDigest) {
  const actual = Buffer.from(otpDigest(params), "hex");
  const expected = Buffer.from(String(expectedDigest || ""), "hex");

  return actual.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseBoolean(value, fallback = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "si", "sí", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = envInt("SMTP_PORT", 587, 1, 65535);
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "");
  const from = String(process.env.SMTP_FROM || "").trim();

  if (!host || !from) {
    const error = new Error("SMTP no está configurado. Define SMTP_HOST, SMTP_PORT, SMTP_SECURE y SMTP_FROM.");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }

  if ((user && !pass) || (!user && pass)) {
    const error = new Error("SMTP_USER y SMTP_PASS deben configurarse juntos.");
    error.code = "SMTP_AUTH_INCOMPLETE";
    throw error;
  }

  return { host, port, secure, user, pass, from };
}

function getTransporter() {
  const config = readSmtpConfig();
  const fingerprint = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    hasPass: Boolean(config.pass),
  });

  if (transporter && transporterFingerprint === fingerprint) {
    return { transporter, from: config.from };
  }

  const transportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  };

  if (config.user) {
    transportOptions.auth = { user: config.user, pass: config.pass };
  }

  transporter = nodemailer.createTransport(transportOptions);
  transporterFingerprint = fingerprint;
  return { transporter, from: config.from };
}

async function verifySmtpConnection() {
  const mailer = getTransporter();
  await mailer.transporter.verify();
  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendOtpEmail({ to, code, purpose, account }) {
  const destination = normalizeRecoveryEmail(to);
  const cleanCode = normalizeOtp(code);

  if (!destination) {
    const error = new Error("Correo alternativo inválido.");
    error.code = "RECOVERY_EMAIL_INVALID";
    throw error;
  }

  if (cleanCode.length !== OTP_DIGITS) {
    throw new Error("Código OTP inválido.");
  }

  const { transporter: mailer, from } = getTransporter();
  const expires = otpExpiresMinutes();
  const isSetup = purpose === "setup" || purpose === "enroll";
  const subject = isSetup
    ? "Verifica tu correo alternativo de QuickChat"
    : "Código de acceso de QuickChat";
  const accountLine = account ? `Cuenta QuickChat: ${String(account).trim()}` : "Cuenta QuickChat";

  const text = [
    subject,
    "",
    accountLine,
    "",
    `Tu código de seguridad es: ${cleanCode}`,
    `Este código vence en ${expires} minutos y sólo puede usarse una vez.`,
    "",
    "Si tú no solicitaste este código, ignora este mensaje.",
    "No compartas este código con otras personas.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f6fb;padding:28px;color:#172033">
      <div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:30px;border:1px solid #e5eaf2">
        <div style="font-size:24px;font-weight:800;color:#135ee8;margin-bottom:8px">QuickChat</div>
        <h2 style="margin:0 0 12px;font-size:22px;color:#172033">${escapeHtml(subject)}</h2>
        <p style="margin:0 0 20px;color:#667085">${escapeHtml(accountLine)}</p>
        <div style="text-align:center;font-size:36px;font-weight:900;letter-spacing:8px;padding:22px 10px;border-radius:16px;background:#eef4ff;color:#174fc7">${escapeHtml(cleanCode)}</div>
        <p style="margin:20px 0 0;line-height:1.55;color:#475467">Este código vence en <strong>${expires} minutos</strong> y sólo puede usarse una vez.</p>
        <p style="margin:12px 0 0;line-height:1.55;color:#667085">Si tú no solicitaste este código, ignora este mensaje. No compartas el código con otras personas.</p>
      </div>
    </div>`;

  return mailer.sendMail({
    from,
    to: destination,
    subject,
    text,
    html,
  });
}

module.exports = {
  OTP_DIGITS,
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
  verifySmtpConnection,
};
