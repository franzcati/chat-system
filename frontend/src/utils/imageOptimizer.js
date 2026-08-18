const OPTIMIZABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const MAX_IMAGE_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;
const THUMBNAIL_MAX_DIMENSION = 480;
const THUMBNAIL_WEBP_QUALITY = 0.7;
const SMALL_IMAGE_BYTES = 320 * 1024;
const MIN_USEFUL_SAVING_RATIO = 0.94;
const MAX_PARALLEL_OPTIMIZATIONS = 2;

let activeOptimizations = 0;
const optimizationQueue = [];

const createAbortError = () => {
  try {
    return new DOMException("Optimización cancelada", "AbortError");
  } catch {
    const error = new Error("Optimización cancelada");
    error.name = "AbortError";
    return error;
  }
};

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw createAbortError();
};

const getOptimizedFileName = (name = "imagen") => {
  const clean = String(name || "imagen").replace(/\.[^/.]+$/, "") || "imagen";
  return `${clean}.webp`;
};

const getThumbnailFileName = (name = "imagen") => {
  const clean = String(name || "imagen").replace(/\.[^/.]+$/, "") || "imagen";
  return `${clean}.thumb.webp`;
};

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });


const renderWebpVariant = async ({
  source,
  width,
  height,
  maxDimension,
  quality,
  signal,
}) => {
  const largestSide = Math.max(width, height);
  const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  try {
    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });

    if (!context) return null;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    throwIfAborted(signal);
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    throwIfAborted(signal);

    if (!blob?.size) return null;

    return {
      blob,
      width: targetWidth,
      height: targetHeight,
      resized: scale < 1,
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
};

const createThumbnailFile = async (decoded, file, width, height, signal) => {
  try {
    const rendered = await renderWebpVariant({
      source: decoded.source,
      width,
      height,
      maxDimension: THUMBNAIL_MAX_DIMENSION,
      quality: THUMBNAIL_WEBP_QUALITY,
      signal,
    });

    if (!rendered?.blob?.size) return null;

    // Fase 8C:
    // mantenemos una regla simple para el chat: toda imagen compatible debe
    // tener su .thumb.webp. Incluso una imagen pequeña puede producir una
    // miniatura de tamaño parecido, pero así Message.jsx no hará una petición
    // a un thumbnail inexistente y evitamos 404/fallback innecesarios.
    return new File(
      [rendered.blob],
      getThumbnailFileName(file.name),
      {
        type: "image/webp",
        lastModified: Date.now(),
      }
    );
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("⚠️ No se pudo generar miniatura; se usará la imagen completa:", error?.message || error);
    return null;
  }
};

const loadImageElement = (file, signal) =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener?.("abort", onAbort);
      URL.revokeObjectURL(objectUrl);
    };

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    image.onload = () => {
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      cleanup();
      resolve({ source: image, width, height, close: null });
    };

    image.onerror = () => {
      cleanup();
      reject(new Error("No se pudo decodificar la imagen."));
    };

    signal?.addEventListener?.("abort", onAbort, { once: true });
    image.src = objectUrl;
  });

const decodeImage = async (file, signal) => {
  throwIfAborted(signal);

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      throwIfAborted(signal);
      return {
        source: bitmap,
        width: bitmap.width || 0,
        height: bitmap.height || 0,
        close: () => bitmap.close?.(),
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    }
  }

  return loadImageElement(file, signal);
};

const optimizeImageNow = async (file, options = {}) => {
  const signal = options.signal;
  const mimeType = String(file?.type || "").toLowerCase();

  if (!file || !OPTIMIZABLE_IMAGE_TYPES.has(mimeType)) {
    return {
      file,
      optimized: false,
      originalSize: Number(file?.size || 0),
      optimizedSize: Number(file?.size || 0),
      reason: "unsupported",
    };
  }

  // GIF/SVG no entran en OPTIMIZABLE_IMAGE_TYPES para no perder animaciones
  // ni rasterizar contenido vectorial.
  throwIfAborted(signal);

  let decoded;
  try {
    decoded = await decodeImage(file, signal);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      file,
      optimized: false,
      originalSize: file.size,
      optimizedSize: file.size,
      reason: "decode-failed",
    };
  }

  try {
    const width = Number(decoded.width || 0);
    const height = Number(decoded.height || 0);

    if (!width || !height) {
      return {
        file,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        reason: "invalid-dimensions",
      };
    }

    const largestSide = Math.max(width, height);
    const scale = largestSide > MAX_IMAGE_DIMENSION
      ? MAX_IMAGE_DIMENSION / largestSide
      : 1;

    // La miniatura se prepara a partir del mismo bitmap ya decodificado.
    // Así distribuimos el trabajo en el navegador del remitente y no cargamos
    // el VPS con otra conversión de imagen por cada envío.
    const thumbnailFile = await createThumbnailFile(decoded, file, width, height, signal);

    // Una foto pequeña y liviana no necesita recodificarse como imagen principal.
    if (scale === 1 && file.size <= SMALL_IMAGE_BYTES) {
      return {
        file,
        thumbnailFile,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        thumbnailSize: thumbnailFile?.size || 0,
        width,
        height,
        reason: "already-small",
      };
    }

    const rendered = await renderWebpVariant({
      source: decoded.source,
      width,
      height,
      maxDimension: MAX_IMAGE_DIMENSION,
      quality: WEBP_QUALITY,
      signal,
    });

    if (!rendered?.blob?.size) {
      return {
        file,
        thumbnailFile,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        thumbnailSize: thumbnailFile?.size || 0,
        width,
        height,
        reason: "encode-failed",
      };
    }

    // Si WebP no ahorra nada útil y tampoco redujimos dimensiones, conservamos
    // el original para evitar perder calidad sin beneficio.
    if (!rendered.resized && rendered.blob.size >= file.size * MIN_USEFUL_SAVING_RATIO) {
      return {
        file,
        thumbnailFile,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        thumbnailSize: thumbnailFile?.size || 0,
        width,
        height,
        reason: "not-smaller",
      };
    }

    const optimizedFile = new File(
      [rendered.blob],
      getOptimizedFileName(file.name),
      {
        type: "image/webp",
        lastModified: Date.now(),
      }
    );

    return {
      file: optimizedFile,
      thumbnailFile,
      optimized: true,
      originalSize: file.size,
      optimizedSize: optimizedFile.size,
      thumbnailSize: thumbnailFile?.size || 0,
      width: rendered.width,
      height: rendered.height,
      originalWidth: width,
      originalHeight: height,
      savedBytes: Math.max(0, file.size - optimizedFile.size),
    };
  } finally {
    decoded?.close?.();
  }
};

const pumpOptimizationQueue = () => {
  while (
    activeOptimizations < MAX_PARALLEL_OPTIMIZATIONS &&
    optimizationQueue.length
  ) {
    const entry = optimizationQueue.shift();
    if (!entry || entry.cancelled) continue;

    activeOptimizations += 1;

    optimizeImageNow(entry.file, entry.options)
      .then(entry.resolve)
      .catch(entry.reject)
      .finally(() => {
        activeOptimizations = Math.max(0, activeOptimizations - 1);
        pumpOptimizationQueue();
      });
  }
};

export const optimizeImageForChat = (file, options = {}) =>
  new Promise((resolve, reject) => {
    if (!file) {
      resolve({
        file,
        optimized: false,
        originalSize: 0,
        optimizedSize: 0,
        reason: "missing-file",
      });
      return;
    }

    const entry = {
      file,
      options,
      resolve,
      reject,
      cancelled: false,
    };

    const onAbort = () => {
      entry.cancelled = true;
      reject(createAbortError());
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    options.signal?.addEventListener?.("abort", onAbort, { once: true });

    const wrappedResolve = entry.resolve;
    const wrappedReject = entry.reject;

    entry.resolve = (value) => {
      options.signal?.removeEventListener?.("abort", onAbort);
      wrappedResolve(value);
    };
    entry.reject = (error) => {
      options.signal?.removeEventListener?.("abort", onAbort);
      wrappedReject(error);
    };

    optimizationQueue.push(entry);
    pumpOptimizationQueue();
  });

export const isChatImageOptimizable = (file) =>
  OPTIMIZABLE_IMAGE_TYPES.has(String(file?.type || "").toLowerCase());

export const formatOptimizationSavings = (result) => {
  const original = Number(result?.originalSize || 0);
  const optimized = Number(result?.optimizedSize || 0);
  if (!original || !optimized || optimized >= original) return null;
  return Math.round((1 - optimized / original) * 100);
};
