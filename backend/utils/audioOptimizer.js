const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_MIN_BYTES = 8 * 1024 * 1024; // 8 MB

// Permite bajar temporalmente el umbral en Chatvista para pruebas.
// En producción, si la variable no existe, se mantienen 8 MB.
const configuredMinBytes = Number(process.env.AUDIO_OPTIMIZE_MIN_BYTES);
const MIN_BYTES =
  Number.isFinite(configuredMinBytes) && configuredMinBytes > 0
    ? configuredMinBytes
    : DEFAULT_MIN_BYTES;

console.log(
  `🎧 Audio optimizer activo | umbral=${MIN_BYTES} bytes ` +
  `(${(MIN_BYTES / 1024 / 1024).toFixed(2)} MB)`
);

const FFMPEG_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.AUDIO_FFMPEG_TIMEOUT_MS || 180_000)
);

const FFPROBE_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.AUDIO_FFPROBE_TIMEOUT_MS || 15_000)
);

// Sólo una conversión pesada simultánea por proceso Node.
// Así varios usuarios no saturan las CPU del VPS.
let conversionTail = Promise.resolve();

function queueConversion(task) {
  const run = conversionTail.then(task, task);
  conversionTail = run.catch(() => {});
  return run;
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      settled = true;
      reject(new Error(`${command} excedió el tiempo máximo permitido`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} terminó con código ${code}: ${stderr.slice(-2500)}`
          )
        );
      }
    });
  });
}

async function probeAudio(filePath) {
  const { stdout } = await runProcess(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_name,codec_type,sample_rate,channels,bit_rate",
      "-show_entries", "format=duration,size,bit_rate",
      "-of", "json",
      filePath,
    ],
    FFPROBE_TIMEOUT_MS
  );

  const parsed = JSON.parse(stdout || "{}");
  const stream = Array.isArray(parsed.streams) ? parsed.streams[0] || {} : {};
  const format = parsed.format || {};

  return {
    codec: String(stream.codec_name || "").toLowerCase(),
    sampleRate: Number(stream.sample_rate || 0),
    channels: Number(stream.channels || 0),
    streamBitrate: Number(stream.bit_rate || 0),
    duration: Number(format.duration || 0),
    size: Number(format.size || 0),
    formatBitrate: Number(format.bit_rate || 0),
  };
}

function isAudioFile(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  const name = String(file?.originalname || file?.filename || "").toLowerCase();
  return (
    mime.startsWith("audio/") ||
    /\.(wav|wave|aiff|aif|flac|alac|m4a|aac|mp3|ogg|opus|webm)$/i.test(name)
  );
}

function isLosslessOrPcmCodec(codec) {
  const value = String(codec || "").toLowerCase();
  return (
    value.startsWith("pcm_") ||
    value === "flac" ||
    value === "alac" ||
    value === "wavpack"
  );
}

function shouldOptimize({ file, probe, isVoiceNote }) {
  if (!file?.path || !isAudioFile(file) || isVoiceNote) {
    return { optimize: false, reason: "nota_de_voz_o_no_audio" };
  }

  const size = Number(probe?.size || file.size || 0);

  // No gastamos CPU para archivos pequeños.
  if (size < MIN_BYTES) {
    return { optimize: false, reason: "archivo_pequeno" };
  }

  // MP3/AAC/Opus/Vorbis y otros codecs ya comprimidos no se vuelven
  // a comprimir sólo porque su duración sea larga.
  if (!isLosslessOrPcmCodec(probe?.codec)) {
    return { optimize: false, reason: `codec_ya_comprimido:${probe?.codec || "desconocido"}` };
  }

  return { optimize: true, reason: `lossless_o_pcm:${probe.codec}` };
}

function outputBitrate(channels) {
  // Uso principal del chat: voz/llamadas.
  // Mono 48 kbps; estéreo 96 kbps.
  return Number(channels || 1) > 1 ? "96k" : "48k";
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("⚠️ No se pudo eliminar archivo temporal de audio:", error?.message || error);
    }
  }
}

async function optimizeInsideQueue(file, options = {}) {
  const isVoiceNote = Boolean(options.isVoiceNote);

  if (!file?.path || !isAudioFile(file)) {
    return {
      ...file,
      optimizedAudio: false,
      optimizationReason: "no_audio",
    };
  }

  let probe;
  try {
    probe = await probeAudio(file.path);
  } catch (error) {
    console.warn(
      `⚠️ ffprobe no pudo analizar ${file.originalname || file.filename || file.path}; se conserva original:`,
      error?.message || error
    );
    return {
      ...file,
      optimizedAudio: false,
      optimizationReason: "ffprobe_fallo",
    };
  }

  const decision = shouldOptimize({ file, probe, isVoiceNote });
  if (!decision.optimize) {
    return {
      ...file,
      size: Number(probe.size || file.size || 0),
      optimizedAudio: false,
      optimizationReason: decision.reason,
      audioProbe: probe,
    };
  }

  const parsed = path.parse(file.path);
  const finalPath = path.join(parsed.dir, `${parsed.name}.m4a`);
  const tempPath = path.join(
    parsed.dir,
    `.${parsed.name}.${process.pid}.${Date.now()}.optimizing.m4a`
  );

  const bitrate = outputBitrate(probe.channels);

  try {
    await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", file.path,
        "-map", "0:a:0",
        "-vn",
        "-c:a", "aac",
        "-b:a", bitrate,
        "-movflags", "+faststart",
        "-map_metadata", "0",
        tempPath,
      ],
      FFMPEG_TIMEOUT_MS
    );

    const outputStat = await fsp.stat(tempPath);
    const originalSize = Number(probe.size || file.size || 0);
    const outputSize = Number(outputStat.size || 0);

    // Sólo sustituimos el original si el ahorro es real (>= 15%).
    if (!outputSize || (originalSize > 0 && outputSize >= originalSize * 0.85)) {
      await safeUnlink(tempPath);
      return {
        ...file,
        size: originalSize || file.size,
        optimizedAudio: false,
        optimizationReason: "ahorro_insuficiente",
        audioProbe: probe,
      };
    }

    // Si por algún motivo existiera un archivo destino anterior, no queremos
    // mezclarlo con el upload actual.
    await safeUnlink(finalPath);
    await fsp.rename(tempPath, finalPath);

    // El original sólo se elimina DESPUÉS de tener la versión optimizada completa.
    await safeUnlink(file.path);

    console.log(
      `🎧 Audio optimizado: ${file.originalname || file.filename} ` +
      `${Math.round(originalSize / 1024)} KB -> ${Math.round(outputSize / 1024)} KB ` +
      `(${probe.codec} -> AAC ${bitrate})`
    );

    return {
      ...file,
      path: finalPath,
      filename: path.basename(finalPath),
      mimetype: "audio/mp4",
      size: outputSize,
      optimizedAudio: true,
      optimizationReason: decision.reason,
      audioProbe: probe,
    };
  } catch (error) {
    await safeUnlink(tempPath);
    console.warn(
      `⚠️ No se pudo optimizar ${file.originalname || file.filename || file.path}; se conserva original:`,
      error?.message || error
    );

    return {
      ...file,
      size: Number(probe.size || file.size || 0),
      optimizedAudio: false,
      optimizationReason: "ffmpeg_fallo",
      audioProbe: probe,
    };
  }
}

async function optimizeUploadedAudio(file, options = {}) {
  // ffprobe de archivos pequeños también es barato, pero evitamos incluso eso
  // cuando el archivo claramente no alcanza el umbral.
  if (!file?.path || !isAudioFile(file) || options.isVoiceNote) {
    return {
      ...file,
      optimizedAudio: false,
      optimizationReason: options.isVoiceNote ? "nota_de_voz" : "no_audio",
    };
  }

  const knownSize = Number(file.size || 0);
  if (knownSize > 0 && knownSize < MIN_BYTES) {
    return {
      ...file,
      optimizedAudio: false,
      optimizationReason: "archivo_pequeno",
    };
  }

  return queueConversion(() => optimizeInsideQueue(file, options));
}

module.exports = {
  optimizeUploadedAudio,
  probeAudio,
};
