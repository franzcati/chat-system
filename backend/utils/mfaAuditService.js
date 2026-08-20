function requestIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return (
    forwarded ||
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  ).slice(0, 64);
}

function requestUserAgent(req) {
  return String(req.headers?.["user-agent"] || "").slice(0, 500);
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;

  try {
    const text = JSON.stringify(metadata);
    return text.length <= 4000 ? text : text.slice(0, 4000);
  } catch {
    return null;
  }
}

async function auditMfa(pool, req, {
  event,
  targetUserId = null,
  actorUserId = null,
  method = null,
  success = true,
  metadata = null,
}) {
  try {
    await pool.query(
      `INSERT INTO usuario_mfa_auditoria
        (usuario_id, actor_usuario_id, evento, metodo, resultado,
         ip, user_agent, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        Number.isInteger(Number(targetUserId)) && Number(targetUserId) > 0 ? Number(targetUserId) : null,
        Number.isInteger(Number(actorUserId)) && Number(actorUserId) > 0 ? Number(actorUserId) : null,
        String(event || "MFA_EVENT").slice(0, 64),
        method ? String(method).slice(0, 32) : null,
        success ? "ok" : "fail",
        requestIp(req),
        requestUserAgent(req),
        safeMetadata(metadata),
      ]
    );
  } catch (error) {
    // La auditoría nunca debe tumbar el login ni bloquear MFA.
    console.error("Error registrando auditoría MFA:", error?.message || error);
  }
}

module.exports = {
  auditMfa,
  requestIp,
  requestUserAgent,
};
