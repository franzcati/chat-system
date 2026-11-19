const crypto = require('crypto');
const db = require('../db');
const { generateTotp, verifyTotp } = require('./mfaService');
const { formatTelegramAlert } = require('./telegramAlertFormat');
const { securityEventLabel } = require('./securityEventLabels');
const { telegramApi } = require('./telegramApi');
const telegramServerEnabled = () => String(process.env.SECURITY_TELEGRAM_ALERTS_DISABLED || '').toLowerCase() !== 'true';

function encryptionKey() {
  const raw = String(process.env.SECURITY_CENTER_ENCRYPTION_KEY || '');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SECURITY_CENTER_ENCRYPTION_KEY debe contener 32 bytes');
  return key;
}
function parseSecret(input) {
  let value = String(input || '').trim();
  if (value.toLowerCase().startsWith('otpauth://')) {
    const uri = new URL(value);
    if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp') throw new Error('URI TOTP inválida');
    if (String(uri.searchParams.get('algorithm') || 'SHA1').toUpperCase() !== 'SHA1' ||
        String(uri.searchParams.get('digits') || '6') !== '6' ||
        String(uri.searchParams.get('period') || '30') !== '30') throw new Error('Solo se admite TOTP SHA1 de 6 dígitos cada 30 segundos');
    value = uri.searchParams.get('secret') || '';
  }
  value = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!/^[A-Z2-7]{16,128}$/.test(value)) throw new Error('Clave Base32 inválida');
  return value;
}
function encryptSecret(secret, instanceId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`chatvista:security:${instanceId}`));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
function decryptSecret(payload, instanceId) {
  const [version, iv, tag, body] = String(payload || '').split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Credencial cifrada inválida');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(`chatvista:security:${instanceId}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
const VIEW_TTL_SECONDS = 5 * 60;
function viewSignature(body) {
  const key = crypto.hkdfSync('sha256', encryptionKey(), Buffer.from('chatvista-security-view'), Buffer.from('v1'), 32);
  return crypto.createHmac('sha256', key).update(body).digest('base64url');
}
function createViewToken({ instanceId, userId, sessionId, credentialId, outside }) {
  const expiresAt = Date.now() + VIEW_TTL_SECONDS * 1000;
  const body = Buffer.from(JSON.stringify({ instanceId, userId, sessionId, credentialId, outside, expiresAt })).toString('base64url');
  return { token: `${body}.${viewSignature(body)}`, expiresAt };
}
function verifyViewToken(value, expected) {
  const [body, signature] = String(value || '').split('.');
  if (!body || !signature || body.length > 1000) return null;
  const provided = Buffer.from(signature, 'utf8'), correct = Buffer.from(viewSignature(body), 'utf8');
  if (provided.length !== correct.length || !crypto.timingSafeEqual(provided, correct)) return null;
  try {
    const token = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Number(token.expiresAt) > Date.now() && token.instanceId === expected.instanceId &&
      token.userId === expected.userId && token.sessionId === expected.sessionId &&
      token.credentialId === expected.credentialId ? token : null;
  } catch { return null; }
}
const validTime = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || ''));
const validTimezone = tz => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};
function localParts(timezone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
    weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday) };
}
function defaultHours(day) {
  return day === 0 ? { enabled: false, start_time: '08:00', end_time: '18:00' } :
    day === 6 ? { enabled: true, start_time: '08:00', end_time: '13:00' } :
      { enabled: true, start_time: '08:00', end_time: '18:00' };
}
async function workStatus(conn, instanceId, userId, policy) {
  const local = localParts(policy.timezone);
  const [exceptions] = await conn.query(
    `SELECT enabled,start_time,end_time FROM security_exceptions
     WHERE instancia_id=? AND local_date=? AND (usuario_id=? OR usuario_id IS NULL)
     ORDER BY (usuario_id IS NOT NULL) DESC,id DESC LIMIT 1`, [instanceId, local.date, userId]);
  const [hours] = await conn.query('SELECT enabled,start_time,end_time FROM security_hours WHERE instancia_id=? AND weekday=?', [instanceId, local.weekday]);
  const rule = exceptions[0] || hours[0] || defaultHours(local.weekday);
  return { outside: !rule.enabled || local.time < rule.start_time || local.time >= rule.end_time,
    local, description: rule.enabled ? `${rule.start_time}–${rule.end_time} (${policy.timezone})` : `No laborable (${policy.timezone})` };
}
async function policyFor(conn, instanceId) {
  await conn.query('INSERT IGNORE INTO security_policy (instancia_id) VALUES (?)', [instanceId]);
  const [rows] = await conn.query('SELECT * FROM security_policy WHERE instancia_id=?', [instanceId]);
  return rows[0];
}
function sourceIp(req) {
  // Solo se leen cabeceras enviadas por el proxy que Express considera confiable.
  const trustedProxy = req.app?.get('trust proxy fn')?.(req.socket?.remoteAddress, 0);
  const headerNames = trustedProxy ? [process.env.AUDIT_IP_HEADER, 'X-Real-IP'].filter(Boolean) : [];
  const net = require('node:net');
  const isPublic = value => {
    const ip = String(value || '').replace(/^::ffff:/i, '');
    return Boolean(net.isIP(ip)) && !/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80)/i.test(ip);
  };
  const headerIp = headerNames.map(name => String(req.get(name) || '').trim()).find(isPublic);
  return isPublic(req.ip) ? req.ip : headerIp || req.ip;
}
async function event(conn, req, type, result, credentialId = null, outside = false, detail = {}) {
  const reportedLocalIp = String(req.get('X-Client-Local-IP') || '');
  const clientDevice = {
    platformVersion: String(req.get('X-Client-Platform-Version') || req.get('Sec-CH-UA-Platform-Version') || '').replace(/^"|"$/g, '').slice(0, 24),
    browser: String(req.get('X-Client-Browser') || '').slice(0, 40),
    localIp: /^(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(reportedLocalIp) ? reportedLocalIp : '',
  };
  const [saved] = await conn.query(
    `INSERT INTO security_events (instancia_id,usuario_id,credential_id,session_id,event_type,result,outside_hours,ip,user_agent,detail_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [req.instanciaActual.id, req.auth.userId, credentialId, req.auth.session.id, type, result,
      outside ? 1 : 0, String(sourceIp(req) || '').slice(0, 64), String(req.headers['user-agent'] || '').slice(0, 500), JSON.stringify({ ...detail, clientDevice })]);
  return saved.insertId;
}
async function queueAlert(conn, instanceId, eventId, dedupeKey, message) {
  if (!telegramServerEnabled()) return;
  // Lectura normal: INSERT ... SELECT tomaría un bloqueo compartido sobre
  // security_policy y podría esperar al revelado, que ya bloqueó esa fila.
  const [policy] = await conn.query('SELECT telegram_enabled,telegram_chat_id FROM security_policy WHERE instancia_id=?', [instanceId]);
  if (!policy[0]?.telegram_enabled || !policy[0]?.telegram_chat_id) return;
  await conn.query(`INSERT IGNORE INTO security_alert_outbox (instancia_id,event_id,dedupe_key,message)
    VALUES (?,?,?,?)`, [instanceId, eventId, dedupeKey, message]);
  // Las llamadas hechas dentro de una transacción pueden no estar confirmadas todavía;
  // el intervalo breve garantiza que también se recojan tras el commit.
  setTimeout(() => { void processAlerts(); }, 100).unref();
}
function escapeTelegram(value) { return String(value ?? '').replace(/[\r\n\0<>]/g, ' ').slice(0, 190); }
let workerBusy = false;
async function processAlerts() {
  if (workerBusy || !telegramServerEnabled() || !process.env.SECURITY_TELEGRAM_BOT_TOKEN) return;
  workerBusy = true;
  try {
    await db.query(`UPDATE security_alert_outbox SET status='failed'
      WHERE status='sending' AND next_attempt_at<UTC_TIMESTAMP(3)`);
    const [items] = await db.query(`SELECT q.id,q.instancia_id,q.message,p.telegram_chat_id,p.timezone FROM security_alert_outbox q
      JOIN security_policy p ON p.instancia_id=q.instancia_id
      WHERE q.status IN ('pending','failed') AND q.next_attempt_at<=UTC_TIMESTAMP(3)
      AND q.attempts<8 AND p.telegram_enabled=1 AND p.telegram_chat_id IS NOT NULL ORDER BY q.id LIMIT 10`);
    for (const item of items) {
      const [lock] = await db.query(`UPDATE security_alert_outbox SET status='sending',attempts=attempts+1
        ,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE)
        WHERE id=? AND status IN ('pending','failed')`, [item.id]);
      if (!lock.affectedRows) continue;
      try {
        const [active] = await db.query('SELECT telegram_enabled FROM security_policy WHERE instancia_id=?', [item.instancia_id]);
        if (!active[0]?.telegram_enabled) {
          await db.query("UPDATE security_alert_outbox SET status='failed' WHERE id=?", [item.id]);
          continue;
        }
        const response = await telegramApi('sendMessage', { chat_id: item.telegram_chat_id,
          text: formatTelegramAlert(item.message, item.timezone), parse_mode: 'HTML',
          link_preview_options: { is_disabled: true } });
        if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
        await db.query("UPDATE security_alert_outbox SET status='sent',sent_at=UTC_TIMESTAMP(3) WHERE id=?", [item.id]);
        await db.query('UPDATE security_policy SET telegram_last_success_at=UTC_TIMESTAMP(3) WHERE instancia_id=?', [item.instancia_id]);
      } catch (error) {
        console.warn('Alerta Telegram pendiente de reintento:', item.id, error.name || 'Error', error.message || '');
        await db.query(`UPDATE security_alert_outbox SET status='failed',
          next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL LEAST(300,POW(2,attempts-1)*5) SECOND) WHERE id=?`, [item.id]);
        await db.query('UPDATE security_policy SET telegram_last_error_at=UTC_TIMESTAMP(3) WHERE instancia_id=?', [item.instancia_id]);
      }
    }
    if (items.length === 10) setTimeout(() => { void processAlerts(); }, 100).unref();
  } catch (error) { console.error('Error procesando alertas:', error.message); }
  finally { workerBusy = false; }
}
async function dailyDigest() {
  if (!telegramServerEnabled()) return;
  const [policies] = await db.query("SELECT instancia_id,timezone,daily_digest_time FROM security_policy WHERE telegram_enabled=1 AND telegram_chat_id IS NOT NULL");
  for (const p of policies) {
    if (localParts(p.timezone).time !== p.daily_digest_time) continue;
    const { date } = localParts(p.timezone);
    const [rows] = await db.query(`SELECT event_type,COUNT(*) n FROM security_events
      WHERE instancia_id=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
      GROUP BY event_type`, [p.instancia_id]);
    const summary = rows.map(r => `${securityEventLabel(r.event_type)}: ${r.n}`).join('\n') || 'Sin eventos';
    await queueAlert(db, p.instancia_id, null, `digest:${date}`, `🔐 Resumen de seguridad · ${date}\n${summary}`);
  }
}
let healthBusy = false;
async function checkTelegramConnection() {
  if (healthBusy || !telegramServerEnabled() || !process.env.SECURITY_TELEGRAM_BOT_TOKEN) return;
  healthBusy = true;
  try {
    const [active] = await db.query('SELECT 1 FROM security_policy WHERE telegram_enabled=1 AND telegram_chat_id IS NOT NULL LIMIT 1');
    if (!active.length) return;
    const response = await telegramApi('getMe', {}, 5000);
    if (!response.ok) throw new Error('Telegram no respondió');
    await db.query('UPDATE security_policy SET telegram_last_success_at=UTC_TIMESTAMP(3) WHERE telegram_enabled=1 AND telegram_chat_id IS NOT NULL');
  } catch {
    await db.query('UPDATE security_policy SET telegram_last_error_at=UTC_TIMESTAMP(3) WHERE telegram_enabled=1 AND telegram_chat_id IS NOT NULL').catch(() => {});
  } finally { healthBusy = false; }
}
function startAlertWorker() {
  void processAlerts();
  setInterval(() => { void processAlerts(); }, 3000).unref();
  void checkTelegramConnection();
  setInterval(() => { void checkTelegramConnection(); }, 30000).unref();
  setInterval(() => { void dailyDigest().catch(e => console.error('Resumen diario:', e.message)); }, 60000).unref();
}
module.exports = { parseSecret, encryptSecret, decryptSecret, generateTotp, verifyTotp, validTime, validTimezone,
  localParts, defaultHours, workStatus, policyFor, event, queueAlert, escapeTelegram, sourceIp, telegramServerEnabled, startAlertWorker,
  createViewToken, verifyViewToken };
