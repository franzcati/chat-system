const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function recoveryCodeCount() {
  const raw = Number(process.env.MFA_RECOVERY_CODE_COUNT || 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(6, Math.min(20, Math.floor(raw)));
}

function getRecoverySecret() {
  const secret = String(process.env.MFA_RECOVERY_SECRET || "").trim();
  if (secret.length < 32) {
    const error = new Error("MFA_RECOVERY_SECRET debe tener al menos 32 caracteres");
    error.code = "MFA_RECOVERY_SECRET_MISSING";
    throw error;
  }
  return secret;
}

function randomChars(length) {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return result;
}

function generateRecoveryCode() {
  return `${randomChars(4)}-${randomChars(4)}`;
}

function normalizeRecoveryCode(value) {
  const clean = String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

  if (clean.length !== 8) return "";
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

function hashRecoveryCode(userId, code) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return "";

  return crypto
    .createHmac("sha256", getRecoverySecret())
    .update(`${Number(userId)}|${normalized}`, "utf8")
    .digest("hex");
}

function generateRecoveryCodes(count = recoveryCodeCount()) {
  const unique = new Set();
  while (unique.size < count) unique.add(generateRecoveryCode());
  return [...unique];
}

module.exports = {
  recoveryCodeCount,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
};
