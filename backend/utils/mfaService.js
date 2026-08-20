const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const CHALLENGE_TTL_SECONDS = 10 * 60;
const CHALLENGE_ISSUER = "quickchat";
const CHALLENGE_AUDIENCE = "quickchat-mfa";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(value) {
  const normalized = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");

  let bits = 0;
  let accumulator = 0;
  const bytes = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Secreto Base32 inválido");

    accumulator = (accumulator << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter, digits = TOTP_DIGITS) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto
    .createHmac("sha1", key)
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const modulus = 10 ** digits;
  return String(binary % modulus).padStart(digits, "0");
}

function generateTotp(secret, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(secret, counter, TOTP_DIGITS);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, TOTP_DIGITS);
}

function safeEqualStrings(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findTotpCounter(secret, inputCode, options = {}) {
  const code = normalizeCode(inputCode);
  if (code.length !== TOTP_DIGITS) return null;

  const nowMs = Number(options.nowMs || Date.now());
  const window = Number.isInteger(options.window) ? options.window : TOTP_WINDOW;
  const currentCounter = Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);

  // Primero probamos el paso actual, luego los pasos adyacentes permitidos.
  const offsets = [0];
  for (let distance = 1; distance <= window; distance += 1) {
    offsets.push(-distance, distance);
  }

  for (const offset of offsets) {
    const counter = currentCounter + offset;
    const expected = hotp(secret, counter, TOTP_DIGITS);
    if (safeEqualStrings(expected, code)) return counter;
  }

  return null;
}

function verifyTotp(secret, inputCode, options = {}) {
  return findTotpCounter(secret, inputCode, options) !== null;
}

function buildOtpAuthUri({ secret, accountName, issuer }) {
  const cleanIssuer = String(issuer || "QuickChat").trim() || "QuickChat";
  const cleanAccount = String(accountName || "usuario").trim() || "usuario";
  const label = `${encodeURIComponent(cleanIssuer)}:${encodeURIComponent(cleanAccount)}`;

  const params = new URLSearchParams({
    secret,
    issuer: cleanIssuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

function parseEncryptionKey() {
  const raw = String(process.env.MFA_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("MFA_ENCRYPTION_KEY no está configurada");

  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY debe representar exactamente 32 bytes");
  }

  return key;
}

function encryptSecret(secret) {
  const key = parseEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(secret), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptSecret(payload) {
  const key = parseEncryptionKey();
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = String(payload || "").split(".");

  if (version !== "v1" || !ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new Error("Secreto MFA cifrado inválido");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function getChallengeSecret() {
  const secret = String(process.env.MFA_CHALLENGE_SECRET || "").trim();
  if (secret.length < 32) {
    throw new Error("MFA_CHALLENGE_SECRET debe tener al menos 32 caracteres");
  }
  return secret;
}

function encodeJsonBase64Url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signChallengeBody(body) {
  return crypto
    .createHmac("sha256", getChallengeSecret())
    .update(body)
    .digest("base64url");
}

function createMfaChallenge({ userId, purpose }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CHALLENGE_ISSUER,
    aud: CHALLENGE_AUDIENCE,
    sub: String(userId),
    purpose,
    iat: now,
    exp: now + CHALLENGE_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const body = encodeJsonBase64Url(payload);
  const signature = signChallengeBody(body);
  return `${body}.${signature}`;
}

function verifyMfaChallenge(token, expectedPurpose) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) {
    const error = new Error("Desafío MFA inválido");
    error.code = "MFA_CHALLENGE_INVALID";
    throw error;
  }

  const expectedSignature = signChallengeBody(body);
  if (!safeEqualStrings(expectedSignature, signature)) {
    const error = new Error("Firma MFA inválida");
    error.code = "MFA_CHALLENGE_INVALID";
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    const error = new Error("Desafío MFA corrupto");
    error.code = "MFA_CHALLENGE_INVALID";
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== CHALLENGE_ISSUER ||
    payload.aud !== CHALLENGE_AUDIENCE ||
    Number(payload.exp || 0) < now
  ) {
    const error = new Error("Desafío MFA expirado o inválido");
    error.code = "MFA_CHALLENGE_INVALID";
    throw error;
  }

  if (payload.purpose !== expectedPurpose) {
    const error = new Error("El desafío MFA no corresponde a esta operación");
    error.code = "MFA_CHALLENGE_PURPOSE";
    throw error;
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    const error = new Error("Usuario MFA inválido");
    error.code = "MFA_CHALLENGE_INVALID";
    throw error;
  }

  return { ...payload, userId };
}

function formatManualSecret(secret) {
  return String(secret || "").replace(/(.{4})/g, "$1 ").trim();
}

module.exports = {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  generateSecret,
  generateTotp,
  verifyTotp,
  findTotpCounter,
  normalizeCode,
  buildOtpAuthUri,
  encryptSecret,
  decryptSecret,
  createMfaChallenge,
  verifyMfaChallenge,
  formatManualSecret,
};
