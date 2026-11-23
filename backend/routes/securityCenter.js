const express = require('express');
const { createHmac } = require('node:crypto');
const db = require('../db');
const { requireAuth, requirePermission, requireAnyPermission, hasPermission } = require('../middleware/requireAuth');
const { resolveInstance } = require('../middleware/resolveInstance');
const { parseSecret, encryptSecret, decryptSecret, generateTotp, verifyTotp, validTime,
  validTimezone, defaultHours, workStatus, policyFor, event, queueAlert, escapeTelegram, sourceIp, telegramServerEnabled,
  createViewToken, verifyViewToken, markAttemptAlert, finishAttemptAlert } = require('../utils/securityCenter');
const { decryptSecret: decryptMfaSecret } = require('../utils/mfaService');
const router = express.Router();
const { formatTelegramAlert } = require('../utils/telegramAlertFormat');
const { telegramApi } = require('../utils/telegramApi');
const { securityBrand } = require('../utils/securityBrand');
const { securityProjectLines } = require('../utils/securityProjects');
router.use(requireAuth, resolveInstance);
router.use((req, res, next) => {
  if (req.auth.usuario.instancia_id !== req.instanciaActual.id) return res.status(403).json({ error: 'Instancia no autorizada' });
  res.set('Cache-Control', 'no-store');
  res.set('Accept-CH', 'Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List'); next();
});
const admin = 'gestionar_credenciales_2fa';
const id = value => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const short = (value, max = 190) => String(value || '').trim().slice(0, max);
const actorLabel = req => escapeTelegram(`${req.auth.usuario.nombre || ''} ${req.auth.usuario.apellido || ''}`.trim() || req.auth.usuario.correo || req.auth.userId);
const bad = (res, error) => res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo completar la operación',
  ...(error.attemptId ? { attempt_id: error.attemptId } : {}) });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function scopedUser(conn, userId, instanceId) {
  const [rows] = await conn.query("SELECT id FROM usuario WHERE id=? AND instancia_id=? AND estado='aprobado' LIMIT 1", [userId, instanceId]);
  return rows.length > 0;
}
router.get('/users', requireAnyPermission(admin, 'gestionar_horarios_2fa', 'ver_auditoria_seguridad'), async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT u.id,u.nombre,u.apellido,u.correo,u.url_imagen,r.nombre rol_nombre
      FROM usuario u LEFT JOIN roles r ON r.id=u.rol_id
      WHERE u.instancia_id=? AND u.estado='aprobado' ORDER BY u.nombre,u.apellido LIMIT 500`, [req.instanciaActual.id]);
    res.json({ users: rows });
  } catch (e) { bad(res, e); }
});

router.get('/credentials/:id/access', requirePermission(admin), async (req, res) => {
  try {
    const credentialId = id(req.params.id);
    if (!credentialId) throw fail('Credencial inválida');
    const [credentials] = await db.query('SELECT responsable_id FROM security_credentials WHERE id=? AND instancia_id=? LIMIT 1',
      [credentialId, req.instanciaActual.id]);
    if (!credentials.length) throw fail('Credencial no encontrada', 404);
    const [members] = await db.query(`SELECT u.id,u.nombre,u.apellido,u.correo,u.url_imagen,r.nombre rol_nombre
      FROM security_credential_access a JOIN usuario u ON u.id=a.usuario_id
      LEFT JOIN roles r ON r.id=u.rol_id
      WHERE a.credential_id=? AND u.instancia_id=? AND u.estado='aprobado'
      ORDER BY (u.id=?) DESC,u.nombre,u.apellido`,
      [credentialId, req.instanciaActual.id, credentials[0].responsable_id]);
    res.json({ members, owner_id: credentials[0].responsable_id });
  } catch (e) { bad(res, e); }
});

router.get('/credentials', async (req, res) => {
  try {
    const canAdmin = hasPermission(req, admin);
    const [rows] = await db.query(`SELECT c.id,c.plataforma,c.cuenta,c.nombre,c.responsable_id,c.creado_por_id,c.estado,c.created_at,c.proyecto_id,
      EXISTS (SELECT 1 FROM security_credential_access mine WHERE mine.credential_id=c.id AND mine.usuario_id=?) AS can_reveal,
      u.nombre responsable_nombre,u.apellido responsable_apellido,u.url_imagen responsable_imagen,
      (SELECT COUNT(*) FROM security_credential_access assigned
        JOIN usuario member ON member.id=assigned.usuario_id AND member.instancia_id=c.instancia_id AND member.estado='aprobado'
        WHERE assigned.credential_id=c.id) AS assigned_count
      FROM security_credentials c JOIN usuario u ON u.id=c.responsable_id
      WHERE c.instancia_id=? AND (${canAdmin ? '1=1' : `EXISTS (SELECT 1 FROM security_credential_access a WHERE a.credential_id=c.id AND a.usuario_id=?)`})
      ${canAdmin ? '' : `AND (c.proyecto_id IS NULL OR EXISTS (SELECT 1 FROM usuario_proyecto up WHERE up.proyecto_id=c.proyecto_id AND up.usuario_id=?))`}
      ORDER BY c.created_at DESC LIMIT 300`, canAdmin ? [req.auth.userId, req.instanciaActual.id] : [req.auth.userId, req.instanciaActual.id, req.auth.userId, req.auth.userId]);
    res.json({ credentials: rows, can_manage: canAdmin });
  } catch (e) { console.error('Lista de credenciales:', e.message); bad(res, e); }
});

router.post('/credentials', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const instanceId = req.instanciaActual.id;
    const ownerId = id(req.body.responsable_id) || req.auth.userId;
    if (ownerId !== req.auth.userId && !hasPermission(req, admin)) throw fail('No puedes asignar otra cuenta', 403);
    const platform = short(req.body.plataforma, 100), account = short(req.body.cuenta), name = short(req.body.nombre);
    if (!platform || !account || !name) throw fail('Completa plataforma, cuenta y nombre');
    const secret = parseSecret(req.body.clave);
    await conn.beginTransaction();
    if (!await scopedUser(conn, ownerId, instanceId)) throw fail('Responsable fuera de la instancia', 403);
    const policy = await policyFor(conn, instanceId);
    await conn.query('SELECT instancia_id FROM security_policy WHERE instancia_id=? FOR UPDATE', [instanceId]);
    const [limits] = await conn.query('SELECT max_credentials FROM security_user_limits WHERE instancia_id=? AND usuario_id=?', [instanceId, ownerId]);
    const max = limits[0]?.max_credentials ?? 1;
    const [counts] = await conn.query('SELECT COUNT(*) n FROM security_credentials WHERE instancia_id=? AND responsable_id=? AND estado=?', [instanceId, ownerId, 'activo']);
    if (Number(counts[0].n) >= Number(max)) throw fail('El responsable alcanzó el límite de credenciales', 409);
    const projectId = id(req.body.proyecto_id);
    if (projectId) {
      const [projects] = await conn.query(`SELECT p.id FROM proyecto p JOIN usuario_proyecto up
        ON up.proyecto_id=p.id AND up.usuario_id=? WHERE p.id=? AND p.instancia_id=? LIMIT 1`, [ownerId, projectId, instanceId]);
      if (!projects.length) throw fail('Proyecto fuera de la instancia', 403);
    }
    const [result] = await conn.query(`INSERT INTO security_credentials
      (instancia_id,proyecto_id,plataforma,cuenta,nombre,responsable_id,creado_por_id,secret_cipher)
      VALUES (?,?,?,?,?,?,?,?)`, [instanceId, projectId, platform, account, name, ownerId, req.auth.userId, encryptSecret(secret, instanceId)]);
    await conn.query('INSERT INTO security_credential_access (credential_id,usuario_id,asignado_por_id) VALUES (?,?,?)', [result.insertId, ownerId, req.auth.userId]);
    await event(conn, req, 'CREDENTIAL_CREATED', 'ok', result.insertId, false, { platform, account, ownerId });
    await conn.commit(); res.status(201).json({ id: result.insertId, mensaje: 'Credencial registrada' });
  } catch (e) { await conn.rollback(); console.error('Registro de credencial:', e.message); bad(res, e); }
  finally { conn.release(); }
});

router.put('/credentials/:id', requirePermission(admin), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const credentialId = id(req.params.id), instanceId = req.instanciaActual.id;
    if (!credentialId) throw fail('Credencial inválida');
    const platform = short(req.body.plataforma, 100), account = short(req.body.cuenta), name = short(req.body.nombre);
    const ownerId = id(req.body.responsable_id);
    if (!platform || !account || !name || !ownerId) throw fail('Completa los datos de la credencial');
    const replaceSecret = Boolean(String(req.body.clave || '').trim());
    const cipher = replaceSecret ? encryptSecret(parseSecret(req.body.clave), instanceId) : null;
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT responsable_id,proyecto_id FROM security_credentials WHERE id=? AND instancia_id=? FOR UPDATE', [credentialId, instanceId]);
    if (!rows.length) throw fail('Credencial no encontrada', 404);
    if (!await scopedUser(conn, ownerId, instanceId)) throw fail('Responsable fuera de la instancia', 403);
    if (rows[0].proyecto_id) {
      const [membership] = await conn.query('SELECT 1 FROM usuario_proyecto WHERE proyecto_id=? AND usuario_id=? LIMIT 1', [rows[0].proyecto_id, ownerId]);
      if (!membership.length) throw fail('Responsable fuera del proyecto', 403);
    }
    if (ownerId !== Number(rows[0].responsable_id)) {
      const [limits] = await conn.query('SELECT max_credentials FROM security_user_limits WHERE instancia_id=? AND usuario_id=?', [instanceId, ownerId]);
      const [counts] = await conn.query("SELECT COUNT(*) n FROM security_credentials WHERE instancia_id=? AND responsable_id=? AND estado='activo'", [instanceId, ownerId]);
      if (Number(counts[0].n) >= Number(limits[0]?.max_credentials ?? 1)) throw fail('El nuevo responsable alcanzó su límite de credenciales', 409);
    }
    await conn.query(`UPDATE security_credentials SET plataforma=?,cuenta=?,nombre=?,responsable_id=?,
      secret_cipher=COALESCE(?,secret_cipher) WHERE id=? AND instancia_id=?`,
      [platform, account, name, ownerId, cipher, credentialId, instanceId]);
    await conn.query('INSERT IGNORE INTO security_credential_access (credential_id,usuario_id,asignado_por_id) VALUES (?,?,?)', [credentialId, ownerId, req.auth.userId]);
    await event(conn, req, 'CREDENTIAL_UPDATED', 'ok', credentialId, false,
      { platform, account, ownerId, previousOwnerId: rows[0].responsable_id, secretChanged: replaceSecret });
    await conn.commit(); res.json({ ok: true });
  } catch (e) { await conn.rollback(); bad(res, e); }
  finally { conn.release(); }
});

router.delete('/credentials/:id', requirePermission(admin), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const credentialId = id(req.params.id);
    if (!credentialId) throw fail('Credencial inválida');
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT plataforma,cuenta,responsable_id FROM security_credentials WHERE id=? AND instancia_id=? FOR UPDATE', [credentialId, req.instanciaActual.id]);
    if (!rows.length) throw fail('Credencial no encontrada', 404);
    const item = rows[0];
    await event(conn, req, 'CREDENTIAL_DELETED', 'ok', credentialId, false,
      { platform: item.plataforma, account: item.cuenta, ownerId: item.responsable_id });
    await conn.query('DELETE FROM security_credentials WHERE id=? AND instancia_id=?', [credentialId, req.instanciaActual.id]);
    await conn.commit(); res.json({ ok: true });
  } catch (e) { await conn.rollback(); bad(res, e); }
  finally { conn.release(); }
});

router.patch('/credentials/:id', requirePermission(admin), async (req, res) => {
  try {
    const credentialId = id(req.params.id);
    const state = req.body.estado;
    if (!credentialId || !['activo','suspendido'].includes(state)) throw fail('Estado inválido');
    const [result] = await db.query('UPDATE security_credentials SET estado=? WHERE id=? AND instancia_id=?', [state, credentialId, req.instanciaActual.id]);
    if (!result.affectedRows) throw fail('Credencial no encontrada', 404);
    await event(db, req, 'CREDENTIAL_STATUS', 'ok', credentialId, false, { state });
    res.json({ ok: true });
  } catch (e) { bad(res, e); }
});

router.put('/credentials/:id/access/:userId', requirePermission(admin), async (req, res) => {
  try {
    const credentialId = id(req.params.id), targetId = id(req.params.userId);
    if (!credentialId || !targetId) throw fail('Identificador inválido');
    const [rows] = await db.query('SELECT id,responsable_id,proyecto_id FROM security_credentials WHERE id=? AND instancia_id=? LIMIT 1', [credentialId, req.instanciaActual.id]);
    if (!rows.length || !await scopedUser(db, targetId, req.instanciaActual.id)) throw fail('Cuenta o usuario fuera de la instancia', 404);
    if (rows[0].proyecto_id) {
      const [member] = await db.query('SELECT 1 FROM usuario_proyecto WHERE proyecto_id=? AND usuario_id=? LIMIT 1', [rows[0].proyecto_id, targetId]);
      if (!member.length) throw fail('Usuario fuera del proyecto', 403);
    }
    if (req.body.enabled === false) {
      if (targetId === Number(rows[0].responsable_id)) throw fail('No se puede quitar al responsable');
      await db.query('DELETE FROM security_credential_access WHERE credential_id=? AND usuario_id=?', [credentialId, targetId]);
    } else {
      await db.query('INSERT IGNORE INTO security_credential_access (credential_id,usuario_id,asignado_por_id) VALUES (?,?,?)', [credentialId, targetId, req.auth.userId]);
    }
    await event(db, req, 'ACCESS_CHANGED', 'ok', credentialId, false, { targetId, enabled: req.body.enabled !== false });
    res.json({ ok: true });
  } catch (e) { bad(res, e); }
});

router.post('/credentials/:id/reveal', async (req, res) => {
  const conn = await db.getConnection();
  let credentialId = id(req.params.id), outside = false, attemptId = null;
  let alertOffhours = false;
  let attemptPlatform = '', attemptAccount = '';
  let attemptProjects = 'Proyecto principal: No disponible\nProyectos secundarios: No disponibles';
  try {
    if (!credentialId) throw fail('Credencial inválida');
    await conn.beginTransaction();
    const instanceId = req.instanciaActual.id, userId = req.auth.userId;
    const policy = await policyFor(conn, instanceId);
    alertOffhours = !!policy.alert_offhours;
    // Serializa los límites por instancia y evita consultas simultáneas que los eludan.
    await conn.query('SELECT instancia_id FROM security_policy WHERE instancia_id=? FOR UPDATE', [instanceId]);
    const [rows] = await conn.query(`SELECT c.id,c.plataforma,c.cuenta,c.secret_cipher FROM security_credentials c
      JOIN security_credential_access a ON a.credential_id=c.id AND a.usuario_id=?
      WHERE c.id=? AND c.instancia_id=? AND c.estado='activo'
      AND (c.proyecto_id IS NULL OR EXISTS (SELECT 1 FROM usuario_proyecto up WHERE up.proyecto_id=c.proyecto_id AND up.usuario_id=?))
      LIMIT 1`, [userId, credentialId, instanceId, userId]);
    if (!rows.length) throw fail('Credencial no autorizada', 404);
    const status = await workStatus(conn, instanceId, userId, policy); outside = status.outside;
    attemptPlatform = rows[0].plataforma;
    attemptAccount = rows[0].cuenta;
    // El clic en el ojo queda registrado antes de solicitar MFA o aplicar límites.
    // Se guarda fuera de la transacción para conservarlo aunque se rechace la consulta.
    if (outside) {
      const previousAttempt = id(req.body?.attempt_id);
      if (previousAttempt) {
        const [recorded] = await conn.query(`SELECT id FROM security_events WHERE id=? AND instancia_id=? AND usuario_id=?
          AND credential_id=? AND session_id=? AND event_type='CODE_ATTEMPT' AND outside_hours=1
          AND created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE) LIMIT 1`,
          [previousAttempt, instanceId, userId, credentialId, req.auth.session.id]);
        if (recorded.length) attemptId = previousAttempt;
      }
      if (!attemptId) {
        attemptId = await event(db, req, 'CODE_ATTEMPT', 'attempt', credentialId, true,
          { platform: rows[0].plataforma, account: rows[0].cuenta });
        if (alertOffhours) {
          attemptProjects = await securityProjectLines(db, instanceId, userId)
            .catch(() => attemptProjects);
          await queueAlert(db, instanceId, attemptId, `offhours-attempt:${attemptId}`,
            `⚠️ Intento de consulta 2FA fuera de horario\nIntento: ${attemptId}\nUsuario: ${actorLabel(req)} (${userId})\n${attemptProjects}\nPlataforma: ${escapeTelegram(attemptPlatform)}\nCuenta: ${escapeTelegram(attemptAccount)}\nFecha: ${new Date().toISOString()}\nIP: ${escapeTelegram(sourceIp(req))}\nAcceso: 🟡 En verificación; código no revelado`);
          await markAttemptAlert(db, instanceId, attemptId);
        }
      }
    }
    const [limits] = await conn.query('SELECT daily_offhours_limit FROM security_user_limits WHERE instancia_id=? AND usuario_id=?', [instanceId, userId]);
    const dailyLimit = Number(limits[0]?.daily_offhours_limit ?? policy.daily_offhours_limit);
    if (outside) {
      const [counts] = await conn.query(`SELECT COUNT(*) n FROM security_events WHERE instancia_id=? AND usuario_id=? AND event_type='CODE_REVEALED'
        AND outside_hours=1 AND created_at>=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)`, [instanceId, userId]);
      if (Number(counts[0].n) >= dailyLimit) throw fail('Límite de consultas fuera de horario alcanzado', 429);
      if (policy.step_up_offhours) {
        const [mfa] = await conn.query('SELECT secret_encrypted,mfa_enabled FROM usuario_mfa WHERE usuario_id=? LIMIT 1', [userId]);
        if (mfa[0]?.mfa_enabled && mfa[0]?.secret_encrypted) {
          if (!req.body?.codigo_mfa) {
            await conn.commit();
            return res.json({ mfa_required: true, attempt_id: attemptId });
          }
          if (!verifyTotp(decryptMfaSecret(mfa[0].secret_encrypted), req.body.codigo_mfa)) {
            const invalid = fail('El código MFA es incorrecto o venció', 403);
            invalid.attemptId = attemptId;
            throw invalid;
          }
        }
      }
    }
    const [recent] = await conn.query(`SELECT COUNT(*) n FROM security_events WHERE instancia_id=? AND usuario_id=?
      AND event_type='CODE_REVEALED' AND created_at>DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`, [instanceId, userId]);
    // Una apertura autoriza cinco minutos de recargas. El límite por hora
    // protege contra automatización sin impedir la consulta operativa diaria.
    if (Number(recent[0].n) >= 120) throw fail('Demasiadas consultas; intenta más tarde', 429);
    const item = rows[0];
    const secret = decryptSecret(item.secret_cipher, instanceId);
    const eventId = await event(conn, req, 'CODE_REVEALED', 'ok', credentialId, outside, { platform: item.plataforma, account: item.cuenta });
    if (outside && policy.alert_offhours) await finishAttemptAlert(conn, instanceId, attemptId, 'correct',
      '🟢 Correcto; código revelado');
    await conn.commit();
    const view = createViewToken({ instanceId, userId, sessionId: req.auth.session.id, credentialId, outside });
    const now = Date.now();
    res.json({ code: generateTotp(secret, now), remaining_ms: 30000 - now % 30000,
      view_token: view.token, view_expires_at: view.expiresAt, outside_hours: outside });
  } catch (e) {
    await conn.rollback();
    if (credentialId && (e.status || attemptId)) {
      const deniedId = await event(db, req, 'CODE_DENIED', 'denied', credentialId, outside,
        { reason: e.status ? String(e.status) : 'error_interno', attempt_id: attemptId }).catch(() => null);
      if (outside && alertOffhours && attemptId && deniedId) await finishAttemptAlert(db,
        req.instanciaActual.id, attemptId, 'failed',
        `🔴 Fallido; código no revelado (${escapeTelegram(e.status ? e.message : 'Error del servidor')})`)
        .catch(error => console.error('Aviso de consulta fallida:', error.message));
    }
    if (!e.status) console.error('Error al revelar código 2FA:', e.code || e.name, e.errno || '');
    bad(res, e);
  } finally { conn.release(); }
});

// El cierre del formulario MFA actualiza el intento que inició este usuario.
router.post('/credentials/:id/attempts/:attemptId/cancel', async (req, res) => {
  try {
    const credentialId = id(req.params.id), attemptId = id(req.params.attemptId);
    if (!credentialId || !attemptId) throw fail('Intento inválido');
    const instanceId = req.instanciaActual.id;
    const [rows] = await db.query(`SELECT id FROM security_events WHERE id=? AND instancia_id=?
      AND usuario_id=? AND credential_id=? AND session_id=? AND event_type='CODE_ATTEMPT'
      AND outside_hours=1 AND created_at>DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE) LIMIT 1`,
      [attemptId, instanceId, req.auth.userId, credentialId, req.auth.session.id]);
    if (!rows.length) throw fail('Intento no encontrado', 404);
    const changed = await finishAttemptAlert(db, instanceId, attemptId, 'failed',
      '🔴 Fallido; verificación MFA cancelada');
    if (changed) await event(db, req, 'CODE_DENIED', 'denied', credentialId, true,
      { reason: 'mfa_cancelado', attempt_id: attemptId });
    res.json({ ok: true });
  } catch (e) { bad(res, e); }
});

// Una visualización autenticada dura cinco minutos. Cada recarga comprueba
// nuevamente la sesión y la asignación, sin crear otra alerta cada 30 segundos.
router.post('/credentials/:id/current', async (req, res) => {
  try {
    const credentialId = id(req.params.id), instanceId = req.instanciaActual.id, userId = req.auth.userId;
    const grant = verifyViewToken(req.body?.view_token, { instanceId, userId,
      sessionId: req.auth.session.id, credentialId });
    if (!grant) throw fail('La visualización venció. Pulsa el ojo para continuar.', 403);
    const [rows] = await db.query(`SELECT c.secret_cipher FROM security_credentials c
      JOIN security_credential_access a ON a.credential_id=c.id AND a.usuario_id=?
      WHERE c.id=? AND c.instancia_id=? AND c.estado='activo'
      AND (c.proyecto_id IS NULL OR EXISTS (SELECT 1 FROM usuario_proyecto up
        WHERE up.proyecto_id=c.proyecto_id AND up.usuario_id=?)) LIMIT 1`,
      [userId, credentialId, instanceId, userId]);
    if (!rows.length) throw fail('Credencial no autorizada', 404);
    const policy = await policyFor(db, instanceId);
    const currentHours = await workStatus(db, instanceId, userId, policy);
    if (currentHours.outside && !grant.outside) throw fail('El horario cambió. Pulsa el ojo para continuar.', 403);
    const now = Date.now();
    res.json({ code: generateTotp(decryptSecret(rows[0].secret_cipher, instanceId), now),
      remaining_ms: 30000 - now % 30000, view_expires_at: grant.expiresAt });
  } catch (e) { bad(res, e); }
});

router.get('/policy', async (req, res) => {
  try {
    const policy = await policyFor(db, req.instanciaActual.id);
    const [hours] = await db.query('SELECT weekday,enabled,start_time,end_time FROM security_hours WHERE instancia_id=?', [req.instanciaActual.id]);
    const [limits] = await db.query('SELECT max_credentials,daily_offhours_limit FROM security_user_limits WHERE instancia_id=? AND usuario_id=?', [req.instanciaActual.id, req.auth.userId]);
    res.json({ brand: securityBrand(), timezone: policy.timezone, hours: Array.from({ length: 7 }, (_, day) =>
      ({ weekday: day, ...(hours.find(h => h.weekday === day) || defaultHours(day)) })),
      max_credentials: limits[0]?.max_credentials ?? 1,
      daily_offhours_limit: limits[0]?.daily_offhours_limit ?? policy.daily_offhours_limit,
      step_up_offhours: Boolean(policy.step_up_offhours),
      can_manage_hours: hasPermission(req, 'gestionar_horarios_2fa') });
  } catch (e) { bad(res, e); }
});
router.put('/policy', requirePermission('gestionar_horarios_2fa'), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { timezone, hours, daily_offhours_limit, step_up_offhours } = req.body;
    if (!validTimezone(timezone) || !Array.isArray(hours) || hours.length !== 7 ||
      !hours.every(h => Number.isInteger(h.weekday) && h.weekday >= 0 && h.weekday < 7 && validTime(h.start_time) && validTime(h.end_time) && h.start_time < h.end_time) ||
      new Set(hours.map(h => h.weekday)).size !== 7 || !Number.isInteger(daily_offhours_limit) || daily_offhours_limit < 0 || daily_offhours_limit > 100) throw fail('Política inválida');
    await conn.beginTransaction(); await policyFor(conn, req.instanciaActual.id);
    await conn.query('UPDATE security_policy SET timezone=?,daily_offhours_limit=?,step_up_offhours=? WHERE instancia_id=?',
      [timezone, daily_offhours_limit, step_up_offhours ? 1 : 0, req.instanciaActual.id]);
    for (const h of hours) await conn.query(`INSERT INTO security_hours (instancia_id,weekday,enabled,start_time,end_time)
      VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),start_time=VALUES(start_time),end_time=VALUES(end_time)`,
      [req.instanciaActual.id, h.weekday, h.enabled ? 1 : 0, h.start_time, h.end_time]);
    await event(conn, req, 'POLICY_CHANGED', 'ok'); await conn.commit(); res.json({ ok: true });
  } catch (e) { await conn.rollback(); bad(res, e); } finally { conn.release(); }
});
router.put('/limits/:userId', requirePermission('gestionar_horarios_2fa'), async (req, res) => {
  try {
    const userId = id(req.params.userId), { max_credentials, daily_offhours_limit } = req.body;
    if (!userId || !await scopedUser(db, userId, req.instanciaActual.id) ||
      !Number.isInteger(max_credentials) || max_credentials < 1 || max_credentials > 100 ||
      !Number.isInteger(daily_offhours_limit) || daily_offhours_limit < 0 || daily_offhours_limit > 100) throw fail('Usuario o límites inválidos');
    await db.query(`INSERT INTO security_user_limits (instancia_id,usuario_id,max_credentials,daily_offhours_limit) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE max_credentials=VALUES(max_credentials),daily_offhours_limit=VALUES(daily_offhours_limit)`,
      [req.instanciaActual.id,userId,max_credentials,daily_offhours_limit]);
    await event(db, req, 'LIMITS_CHANGED', 'ok', null, false, { userId }); res.json({ ok: true });
  } catch (e) { bad(res, e); }
});
router.get('/exceptions', requirePermission('gestionar_horarios_2fa'), async (req, res) => {
  try { const [rows] = await db.query('SELECT id,usuario_id,local_date,enabled,start_time,end_time,reason FROM security_exceptions WHERE instancia_id=? AND local_date>=CURDATE() ORDER BY local_date,id LIMIT 200', [req.instanciaActual.id]); res.json({ exceptions: rows }); }
  catch (e) { bad(res, e); }
});
router.post('/exceptions', requirePermission('gestionar_horarios_2fa'), async (req, res) => {
  try {
    const { local_date, enabled, start_time, end_time, reason } = req.body, userId = id(req.body.usuario_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(local_date || '') || !short(reason) ||
       (enabled && (!validTime(start_time) || !validTime(end_time) || start_time >= end_time)) ||
       (userId && !await scopedUser(db, userId, req.instanciaActual.id))) throw fail('Excepción inválida');
    await db.query(`INSERT INTO security_exceptions (instancia_id,usuario_id,local_date,enabled,start_time,end_time,reason,approved_by_id)
      VALUES (?,?,?,?,?,?,?,?)`, [req.instanciaActual.id,userId,local_date,enabled?1:0,enabled?start_time:null,enabled?end_time:null,short(reason),req.auth.userId]);
    await event(db, req, 'EXCEPTION_CREATED', 'ok'); res.status(201).json({ ok: true });
  } catch (e) { bad(res, e); }
});
router.delete('/exceptions/:id', requirePermission('gestionar_horarios_2fa'), async (req, res) => {
  try {
    const exceptionId = id(req.params.id);
    if (!exceptionId) throw fail('Excepción inválida');
    const [result] = await db.query('DELETE FROM security_exceptions WHERE id=? AND instancia_id=?', [exceptionId, req.instanciaActual.id]);
    if (!result.affectedRows) throw fail('Excepción no encontrada', 404);
    await event(db, req, 'EXCEPTION_DELETED', 'ok'); res.json({ ok: true });
  } catch (e) { bad(res, e); }
});
router.get('/audit', requirePermission('ver_auditoria_seguridad'), async (req, res) => {
  try {
    const params = [req.instanciaActual.id], where = ['e.instancia_id=?'];
    if (id(req.query.usuario_id)) { where.push('e.usuario_id=?'); params.push(id(req.query.usuario_id)); }
    if (req.query.event_type === 'CODE_CONSULTATIONS') where.push("e.event_type IN ('CODE_REVEALED','CODE_ATTEMPT','CREDENTIAL_CREATED','CREDENTIAL_UPDATED','CREDENTIAL_DELETED')");
    else if (short(req.query.event_type, 64)) { where.push('e.event_type=?'); params.push(short(req.query.event_type, 64)); }
    if (short(req.query.plataforma, 100)) { where.push("JSON_UNQUOTE(JSON_EXTRACT(e.detail_json,'$.platform'))=?"); params.push(short(req.query.plataforma, 100)); }
    if (req.query.result === 'success') where.push("e.result='ok' AND e.outside_hours=0");
    else if (req.query.result === 'warning') where.push('e.outside_hours=1');
    else if (['ok','denied','failed'].includes(req.query.result)) { where.push('e.result=?'); params.push(req.query.result); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { where.push('e.created_at>=?'); params.push(`${req.query.from} 00:00:00`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { where.push('e.created_at<DATE_ADD(?,INTERVAL 1 DAY)'); params.push(`${req.query.to} 00:00:00`); }
    const [rows] = await db.query(`SELECT e.id,e.usuario_id,e.credential_id,e.session_id,e.event_type,e.result,e.outside_hours,e.ip,e.user_agent,e.detail_json,e.created_at,
      u.nombre usuario_nombre,u.apellido usuario_apellido,u.correo usuario_correo,u.url_imagen usuario_imagen,
      c.plataforma,c.cuenta,c.nombre credencial_nombre,p.nombre proyecto_nombre
      FROM security_events e LEFT JOIN usuario u ON u.id=e.usuario_id AND u.instancia_id=e.instancia_id
      LEFT JOIN security_credentials c ON c.id=e.credential_id AND c.instancia_id=e.instancia_id
      LEFT JOIN proyecto p ON p.id=c.proyecto_id AND p.instancia_id=e.instancia_id
      WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT 300`, params);
    res.json({ events: rows });
  } catch (e) { bad(res, e); }
});
router.get('/sessions', requirePermission('ver_auditoria_seguridad'), async (req, res) => {
  try { const [rows] = await db.query(`SELECT id,usuario_id,instancia_id,ip,user_agent,created_at,last_seen_at,expires_at,revoked_at
    FROM security_sessions WHERE instancia_id=? ORDER BY created_at DESC LIMIT 300`, [req.instanciaActual.id]); res.json({ sessions: rows }); }
  catch (e) { bad(res, e); }
});
const telegramToken = () => String(process.env.SECURITY_TELEGRAM_BOT_TOKEN || '').trim();
let cachedTelegramUsername = '';
const linkCode = req => createHmac('sha256', telegramToken())
  .update(`${req.instanciaActual.id}:${req.auth.session.id}`).digest('hex').slice(0, 12);
async function telegramCall(method, body) {
  if (!telegramToken()) throw fail('Configura SECURITY_TELEGRAM_BOT_TOKEN en el servidor', 503);
  let response;
  try {
    response = await telegramApi(method, body, 10000);
  } catch { throw fail('La VPS no pudo conectarse con Telegram. Revisa su conexión a api.telegram.org.', 502); }
  if (!response.ok) {
    const reason = String(response.description || `HTTP ${response.status}`)
      .replaceAll(telegramToken(), '[token oculto]').slice(0, 180);
    throw fail(`Telegram rechazó la operación: ${reason}`, 502);
  }
  return response.result;
}
router.get('/alerts/setup', requirePermission('gestionar_alertas_2fa'), async (req, res) => {
  try {
    if (!telegramToken()) return res.json({ configured: false });
    let reachable = false;
    try { cachedTelegramUsername = (await telegramCall('getMe', {})).username; reachable = true; }
    catch { /* Un error transitorio no significa que falte el token. */ }
    res.json({ configured: true, reachable, username: cachedTelegramUsername,
      command: cachedTelegramUsername ? `/vincular@${cachedTelegramUsername} ${linkCode(req)}` : '' });
  } catch (e) { bad(res, e); }
});
router.post('/alerts/discover', requirePermission('gestionar_alertas_2fa'), async (req, res) => {
  try {
    const bot = await telegramCall('getMe', {});
    const updates = await telegramCall('getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] });
    const expected = `/vincular@${bot.username} ${linkCode(req)}`;
    const matches = updates.filter(u => u.message?.text?.trim() === expected &&
      ['group','supergroup'].includes(u.message.chat?.type));
    if (!matches.length) throw fail(`No encontré el comando en el grupo. Envíalo allí y vuelve a pulsar Buscar grupo.`, 404);
    const group = matches[matches.length - 1].message.chat;
    res.json({ chat_id: String(group.id), title: group.title || 'Grupo de Telegram' });
  } catch (e) { bad(res, e); }
});
const testSent = new Map();
router.post('/alerts/test', requirePermission('gestionar_alertas_2fa'), async (req, res) => {
  try {
    const instanceId = req.instanciaActual.id;
    if (Date.now() - (testSent.get(instanceId) || 0) < 60000) throw fail('Espera un minuto antes de repetir la prueba', 429);
    const policy = await policyFor(db, instanceId);
    if (!telegramServerEnabled()) throw fail('Telegram está desactivado en esta VPS', 409);
    if (!policy.telegram_enabled) throw fail('Activa la sincronización antes de enviar una prueba');
    if (!policy.telegram_chat_id) throw fail('Guarda primero el grupo de Telegram');
    const message = await telegramCall('sendMessage', { chat_id: policy.telegram_chat_id, parse_mode: 'HTML',
      text: formatTelegramAlert(`✅ Prueba de alertas de seguridad\nInstancia: ${instanceId}\nFecha: ${new Date().toISOString()}\nEl bot está conectado correctamente. No se envían claves ni códigos 2FA.`, policy.timezone) });
    testSent.set(instanceId, Date.now()); res.json({ ok: true, group: message.chat?.title || String(message.chat?.id || ''), message_id: message.message_id });
  } catch (e) { bad(res, e); }
});
router.put('/alerts', requirePermission('gestionar_alertas_2fa'), async (req, res) => {
  try {
    const { chat_id, telegram_enabled, alert_offhours, alert_new_device, alert_multiple_devices, daily_digest_time } = req.body;
    if (chat_id && !/^-?\d{5,25}$/.test(String(chat_id)) || !validTime(daily_digest_time)) throw fail('Configuración de Telegram inválida');
    const instanceId = req.instanciaActual.id;
    const before = await policyFor(db, instanceId);
    const enabled = !!telegram_enabled;
    if (enabled && !chat_id) throw fail('Indica el grupo antes de activar la sincronización');
    await db.query(`UPDATE security_policy SET telegram_chat_id=?,telegram_enabled=?,alert_offhours=?,alert_new_device=?,alert_multiple_devices=?,daily_digest_time=? WHERE instancia_id=?`,
      [chat_id || null,enabled?1:0,alert_offhours?1:0,alert_new_device?1:0,alert_multiple_devices?1:0,daily_digest_time,instanceId]);
    if (!enabled) await db.query("DELETE FROM security_alert_outbox WHERE instancia_id=? AND status IN ('pending','failed','sending')", [instanceId]);
    const switched = !!before.telegram_enabled !== enabled || (enabled && before.telegram_chat_id !== chat_id);
    if (switched && telegramToken() && telegramServerEnabled()) {
      const previous = before.telegram_enabled && before.telegram_chat_id;
      const transitions = [
        ...(previous ? [[before.telegram_chat_id, `🔴 QuickChatBot se desconectó de ${securityBrand()}`]] : []),
        ...(enabled ? [[chat_id, `🟢 QuickChatBot en línea en ${securityBrand()}`]] : []),
      ];
      // No impedir guardar la preferencia si Telegram está temporalmente inaccesible.
      for (const [group, message] of transitions) {
        try {
          await telegramCall('sendMessage', { chat_id: group, text: message });
          await db.query('UPDATE security_policy SET telegram_last_success_at=UTC_TIMESTAMP(3) WHERE instancia_id=?', [instanceId]);
        }
        catch { await db.query('UPDATE security_policy SET telegram_last_error_at=UTC_TIMESTAMP(3) WHERE instancia_id=?', [instanceId]); }
      }
    }
    await event(db, req, 'ALERT_CONFIG_CHANGED', 'ok'); res.json({ ok: true });
  } catch (e) { bad(res, e); }
});
router.get('/alerts', requirePermission('gestionar_alertas_2fa'), async (req, res) => {
  try { const p = await policyFor(db, req.instanciaActual.id);
    const [outbox] = await db.query(`SELECT SUM(attempts<8) pending_count,
      SUM(status='failed' AND attempts<8) retry_count, SUM(status='failed' AND attempts>=8) undelivered_count
      FROM security_alert_outbox WHERE instancia_id=? AND status IN ('pending','failed','sending')`, [req.instanciaActual.id]);
    res.json({ chat_id: p.telegram_chat_id || '', alert_offhours: !!p.alert_offhours,
    alert_new_device: !!p.alert_new_device, alert_multiple_devices: !!p.alert_multiple_devices,
    telegram_enabled: !!p.telegram_enabled, server_disabled: !telegramServerEnabled(), last_success_at: p.telegram_last_success_at, last_error_at: p.telegram_last_error_at,
    daily_digest_time: p.daily_digest_time, pending_alerts: Number(outbox[0]?.pending_count || 0), retrying_alerts: Number(outbox[0]?.retry_count || 0),
    undelivered_alerts: Number(outbox[0]?.undelivered_count || 0),
    bot_configured: !!process.env.SECURITY_TELEGRAM_BOT_TOKEN, brand: securityBrand() }); }
  catch (e) { bad(res, e); }
});
module.exports = router;
