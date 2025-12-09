// utils/url.js
const BASE_URL = import.meta.env.VITE_API_URL || ""; // 👈 usa variable de entorno

export function getAvatarUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path; // ya es URL completa
  return `${BASE_URL}${path}`; // concatena backend + ruta relativa
}