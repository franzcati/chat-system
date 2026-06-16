const OWN_UPLOAD_HOSTS = new Set([
  "quickchat.click",
  "www.quickchat.click",
  "chatvista.click",
  "www.chatvista.click",
]);

const DEFAULT_PUBLIC_BASE_URL = "https://quickchat.click";

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getOriginFromHeader(value) {
  try {
    const origin = cleanBaseUrl(value);
    if (!origin) return null;
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (err) {
    return null;
  }
}

function isOwnUploadHost(hostname) {
  return OWN_UPLOAD_HOSTS.has(String(hostname || "").toLowerCase());
}

function getRequestBaseUrl(req) {
  const requestOrigin = getOriginFromHeader(req?.headers?.origin);
  if (requestOrigin) {
    try {
      const parsedOrigin = new URL(requestOrigin);
      if (isOwnUploadHost(parsedOrigin.hostname)) return requestOrigin;
    } catch (err) {}
  }

  const host = req?.get?.("x-forwarded-host") || req?.get?.("host");
  if (host) {
    const forwardedProto = String(req?.get?.("x-forwarded-proto") || "")
      .split(",")[0]
      .trim();
    const protocol = forwardedProto || req?.protocol || "https";
    return `${protocol}://${host}`;
  }

  return cleanBaseUrl(process.env.BASE_URL) || DEFAULT_PUBLIC_BASE_URL;
}

function stripOwnDomainFromUploadUrl(value) {
  const url = String(value || "").trim();
  if (!url) return url;

  if (url.startsWith("/api/uploads/")) return url.replace(/^\/api/, "");
  if (url.startsWith("uploads/")) return `/${url}`;

  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (isOwnUploadHost(parsed.hostname) && parsed.pathname.startsWith("/uploads/")) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch (err) {}
  }

  return url;
}

function toAbsoluteUploadUrl(value, req) {
  const normalized = stripOwnDomainFromUploadUrl(value);
  if (!normalized) return null;

  if (/^https?:\/\//i.test(normalized) || /^(blob:|data:)/i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/uploads/")) {
    return `${getRequestBaseUrl(req)}${normalized}`;
  }

  return normalized;
}

module.exports = {
  OWN_UPLOAD_HOSTS,
  getRequestBaseUrl,
  stripOwnDomainFromUploadUrl,
  toAbsoluteUploadUrl,
};
