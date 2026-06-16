// utils/url.js
const BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const OWN_UPLOAD_HOSTS = new Set([
  "quickchat.click",
  "www.quickchat.click",
  "chatvista.click",
  "www.chatvista.click",
]);

const getCurrentOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return BASE_URL;
};

export function getAvatarUrl(path) {
  if (!path) return null;

  let finalUrl = String(path).trim();
  if (!finalUrl) return null;

  if (/^(blob:|data:)/i.test(finalUrl)) return finalUrl;

  if (finalUrl.startsWith("/api/uploads/")) {
    finalUrl = finalUrl.replace(/^\/api/, "");
  }

  if (finalUrl.startsWith("uploads/")) {
    finalUrl = `/${finalUrl}`;
  }

  if (/^https?:\/\//i.test(finalUrl)) {
    try {
      const parsed = new URL(finalUrl);

      // Si es una imagen/archivo del mismo sistema, se sirve desde el dominio actual.
      // Así el mismo build funciona en chatvista.click y quickchat.click.
      if (OWN_UPLOAD_HOSTS.has(parsed.hostname.toLowerCase()) && parsed.pathname.startsWith("/uploads/")) {
        const currentOrigin = getCurrentOrigin();
        return currentOrigin
          ? `${currentOrigin}${parsed.pathname}${parsed.search}`
          : `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
      }

      // Evita mixed content si algún registro viejo quedó con http.
      if (parsed.protocol === "http:") {
        parsed.protocol = "https:";
        return parsed.toString();
      }
    } catch (err) {
      return finalUrl;
    }

    return finalUrl;
  }

  if (finalUrl.startsWith("/uploads/")) {
    return `${getCurrentOrigin()}${finalUrl}`;
  }

  return `${BASE_URL}${finalUrl}`;
}
