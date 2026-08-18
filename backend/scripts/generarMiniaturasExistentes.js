const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn } = require("child_process");

const uploadsDir = path.resolve(__dirname, "../uploads");
const supported = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const minBytes = Math.max(1, Number(process.env.THUMB_BACKFILL_MIN_BYTES || 120 * 1024));

function runFfmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", input,
      "-vf", "scale='min(480,iw)':-2:force_original_aspect_ratio=decrease",
      "-frames:v", "1",
      "-c:v", "libwebp",
      "-quality", "70",
      output,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(err || `ffmpeg ${code}`)));
  });
}

async function walk(dir, files = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

(async () => {
  const files = await walk(uploadsDir);
  const candidates = files.filter((file) => {
    if (/\.thumb\.webp$/i.test(file)) return false;
    return supported.has(path.extname(file).toLowerCase());
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const input of candidates) {
    const stat = await fsp.stat(input);
    const parsed = path.parse(input);
    const output = path.join(parsed.dir, `${parsed.name}.thumb.webp`);

    if (stat.size < minBytes || fs.existsSync(output)) {
      skipped += 1;
      continue;
    }

    const temp = `${output}.${process.pid}.tmp.webp`;
    try {
      await runFfmpeg(input, temp);
      await fsp.rename(temp, output);
      created += 1;
      console.log(`✅ ${path.relative(uploadsDir, output)}`);
    } catch (error) {
      failed += 1;
      try { await fsp.unlink(temp); } catch {}
      console.warn(`⚠️ ${path.relative(uploadsDir, input)}: ${error.message}`);
    }
  }

  console.log(`\nMiniaturas creadas: ${created}`);
  console.log(`Omitidas: ${skipped}`);
  console.log(`Fallidas: ${failed}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
