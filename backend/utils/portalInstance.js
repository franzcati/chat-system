const PORTAL_HOSTS = new Map([
  ["quickchat.click", "quickchat"],
  ["www.quickchat.click", "quickchat"],
  ["chatvista.click", "chatvista"],
  ["www.chatvista.click", "chatvista"],
  ["chatquick.click", "chatquick"],
  ["www.chatquick.click", "chatquick"],
]);

const VALID_PORTAL_CODES = new Set([
  "quickchat",
  "chatvista",
  "chatquick",
]);

function normalizeHost(value) {
  let host = String(value || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!host) return "";

  // IPv6, por ejemplo: [::1]:5000
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    if (closingBracket > 0) {
      host = host.slice(1, closingBracket);
    }
  } else {
    // Eliminar puerto: chatvista.click:443
    host = host.replace(/:\d+$/, "");
  }

  // Un FQDN puede llegar excepcionalmente con punto final.
  return host.replace(/\.$/, "");
}

function isLocalHost(host) {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

function resolvePortalFromRequest(req) {
  // Nginx sobrescribe Host con:
  // proxy_set_header Host $host;
  //
  // No confiamos en un portal/instancia enviado por req.body.
  // Tampoco utilizamos X-Forwarded-Host.
  const host = normalizeHost(req?.headers?.host);

  const portalCode = PORTAL_HOSTS.get(host);

  if (portalCode) {
    return {
      code: portalCode,
      host,
      source: "host",
    };
  }

  // Fallback exclusivamente para localhost/desarrollo/pruebas internas.
  const fallbackCode = String(
    process.env.PORTAL_FALLBACK_CODE || ""
  )
    .trim()
    .toLowerCase();

  if (
    isLocalHost(host) &&
    VALID_PORTAL_CODES.has(fallbackCode)
  ) {
    return {
      code: fallbackCode,
      host,
      source: "local-fallback",
    };
  }

  const error = new Error(
    "El dominio utilizado no corresponde a un portal permitido"
  );
  error.status = 400;
  error.code = "PORTAL_HOST_NOT_ALLOWED";
  error.host = host;

  throw error;
}

module.exports = {
  normalizeHost,
  resolvePortalFromRequest,
};
