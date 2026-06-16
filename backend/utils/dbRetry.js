const RETRYABLE_DB_CODES = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDbError(err) {
  return Boolean(err && RETRYABLE_DB_CODES.has(err.code));
}

async function queryWithRetry(db, sql, params = [], options = {}) {
  const attempts = Number(options.attempts || 3);
  const baseDelayMs = Number(options.baseDelayMs || 120);
  const label = options.label || "consulta SQL";

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await db.query(sql, params);
    } catch (err) {
      lastError = err;

      if (!isRetryableDbError(err) || attempt >= attempts) {
        throw err;
      }

      const jitter = Math.floor(Math.random() * 90);
      const delay = baseDelayMs * attempt + jitter;
      console.warn(
        `⚠️ ${label} bloqueada por ${err.code}. Reintentando ${attempt}/${attempts - 1} en ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = {
  isRetryableDbError,
  queryWithRetry,
};
