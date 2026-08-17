const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const router = express.Router();

const GIPHY_API_BASE = "https://api.giphy.com/v1/gifs";
const GIF_DIR = path.join(__dirname, "..", "uploads", "gifs");
const API_TIMEOUT_MS = 10000;
const DOWNLOAD_TIMEOUT_MS = 15000;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const TRENDING_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_GIF_BYTES = Math.max(
  1,
  Number(process.env.GIPHY_MAX_GIF_MB || 15)
) * 1024 * 1024;

const responseCache = new Map();
const pendingDownloads = new Map();

function getApiKey() {
  return String(process.env.GIPHY_API_KEY || "").trim();
}

function isAllowedGiphyUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "giphy.com" || hostname.endsWith(".giphy.com"))
    );
  } catch {
    return false;
  }
}

function sanitizeGifId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

function pickImage(image = {}) {
  return {
    url: image.url || "",
    width: image.width || "",
    height: image.height || "",
    size: image.size || "",
  };
}

function compactGiphyItem(item = {}) {
  return {
    id: item.id,
    title: item.title || "GIF",
    images: {
      fixed_height_small: pickImage(item.images?.fixed_height_small),
      fixed_height: pickImage(item.images?.fixed_height),
      downsized: pickImage(item.images?.downsized),
      original: pickImage(item.images?.original),
    },
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "QuickChat/1.0",
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function giphyApiRequest(endpoint, params, cacheKey, ttlMs) {
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    const error = new Error("Falta configurar GIPHY_API_KEY en backend/.env");
    error.statusCode = 503;
    throw error;
  }

  const query = new URLSearchParams({
    api_key: apiKey,
    limit: "20",
    rating: "pg",
    ...params,
  });

  const response = await fetchWithTimeout(`${GIPHY_API_BASE}/${endpoint}?${query}`);
  if (!response.ok) {
    const error = new Error(`GIPHY respondió HTTP ${response.status}`);
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }

  const data = await response.json();
  const payload = {
    data: Array.isArray(data?.data) ? data.data.map(compactGiphyItem) : [],
  };

  responseCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });

  return payload;
}

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function downloadGifToFile(remoteUrl, finalPath) {
  if (!isAllowedGiphyUrl(remoteUrl)) {
    const error = new Error("URL de GIPHY no permitida");
    error.statusCode = 400;
    throw error;
  }

  await fsp.mkdir(GIF_DIR, { recursive: true });

  if (await fileExists(finalPath)) {
    return finalPath;
  }

  if (pendingDownloads.has(finalPath)) {
    return pendingDownloads.get(finalPath);
  }

  const task = (async () => {
    const response = await fetchWithTimeout(remoteUrl, {}, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) {
      const error = new Error(`No se pudo descargar el GIF (HTTP ${response.status})`);
      error.statusCode = 502;
      throw error;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("image/gif")) {
      const error = new Error(`El recurso recibido no es un GIF (${contentType || "sin Content-Type"})`);
      error.statusCode = 415;
      throw error;
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength && declaredLength > MAX_GIF_BYTES) {
      const error = new Error("El GIF supera el tamaño máximo permitido");
      error.statusCode = 413;
      throw error;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_GIF_BYTES) {
      const error = new Error("El GIF supera el tamaño máximo permitido");
      error.statusCode = 413;
      throw error;
    }

    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tempPath, buffer);
    await fsp.rename(tempPath, finalPath);
    return finalPath;
  })();

  pendingDownloads.set(finalPath, task);

  try {
    return await task;
  } finally {
    pendingDownloads.delete(finalPath);
  }
}

router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (!q) {
    return res.status(400).json({ error: "Debes indicar una búsqueda" });
  }

  try {
    const cacheKey = `search:${q.toLowerCase()}`;
    const payload = await giphyApiRequest(
      "search",
      { q },
      cacheKey,
      SEARCH_CACHE_TTL_MS
    );
    return res.json(payload);
  } catch (error) {
    console.error("❌ Error GIPHY search:", error.message);
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get("/trending", async (_req, res) => {
  try {
    const payload = await giphyApiRequest(
      "trending",
      {},
      "trending",
      TRENDING_CACHE_TTL_MS
    );
    return res.json(payload);
  } catch (error) {
    console.error("❌ Error GIPHY trending:", error.message);
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Para GIF nuevos: guarda una copia local antes de crear el mensaje.
router.post("/cache", async (req, res) => {
  const id = sanitizeGifId(req.body?.id);
  const remoteUrl = String(req.body?.url || "").trim();

  if (!id || !remoteUrl) {
    return res.status(400).json({ error: "Faltan id o url del GIF" });
  }

  if (!isAllowedGiphyUrl(remoteUrl)) {
    return res.status(400).json({ error: "URL de GIPHY no permitida" });
  }

  const filename = `${id}.gif`;
  const finalPath = path.join(GIF_DIR, filename);

  try {
    await downloadGifToFile(remoteUrl, finalPath);
    return res.json({ url: `/uploads/gifs/${filename}` });
  } catch (error) {
    console.error("❌ Error guardando GIF:", error.message);
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Compatibilidad con mensajes antiguos que guardaron media*.giphy.com/.../giphy.gif.
// La primera visualización descarga una copia; las siguientes se sirven localmente.
router.get("/media", async (req, res) => {
  const remoteUrl = String(req.query.url || "").trim();
  if (!isAllowedGiphyUrl(remoteUrl)) {
    return res.status(400).send("URL de GIPHY no permitida");
  }

  const hash = crypto.createHash("sha256").update(remoteUrl).digest("hex").slice(0, 32);
  const filename = `legacy_${hash}.gif`;
  const finalPath = path.join(GIF_DIR, filename);

  try {
    await downloadGifToFile(remoteUrl, finalPath);
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.type("gif");
    return res.sendFile(finalPath);
  } catch (error) {
    console.error("❌ Error cargando GIF antiguo:", error.message);
    return res.status(error.statusCode || 502).send("No se pudo cargar el GIF");
  }
});

module.exports = router;
