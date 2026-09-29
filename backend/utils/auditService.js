const pool = require('../db');

const SENSITIVE_KEYS = /(password|contrasena|contraseña|secret|token|otp|recovery|cookie|authorization)/i;

function getRequestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || null;
}

function getDeviceLabel(userAgent) {
  const ua = String(userAgent || '');
  let browser = 'Navegador';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let os = 'Dispositivo';
  if (/Windows NT 10/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return `${browser} · ${os}`;
}

function sanitize(value, depth = 0) {
  if (depth > 6) return '[profundidad omitida]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(key)) {
        out[key] = '[REDACTADO]';
      } else {
        out[key] = sanitize(item, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

function jsonOrNull(value) {
  if (value == null) return null;
  try { return JSON.stringify(sanitize(value)); } catch { return null; }
}

async function inferInstanceId(req, db = pool) {
  const fromReq = Number(req?.instanciaActual?.id || req?.auth?.usuario?.instancia_id);
  if (Number.isInteger(fromReq) && fromReq > 0) return fromReq;
  const host = String(req?.headers?.host || '').split(':')[0].toLowerCase();
  if (!host) return null;
  try {
    const [rows] = await db.query(
      `SELECT id FROM instancia WHERE LOWER(dominio_base)=? OR ? LIKE CONCAT('%.', LOWER(dominio_base)) LIMIT 1`,
      [host, host]
    );
    return rows.length ? Number(rows[0].id) : null;
  } catch { return null; }
}

async function inferPrimaryProjectId(userId, db = pool) {
  const id = Number(userId);
  if (!id) return null;
  try {
    const [rows] = await db.query(`SELECT proyecto_principal_id FROM usuario WHERE id=? LIMIT 1`, [id]);
    return rows[0]?.proyecto_principal_id ? Number(rows[0].proyecto_principal_id) : null;
  } catch { return null; }
}

async function writeAudit(req, payload = {}, db = pool) {
  try {
    const actorId = Number(payload.actorUserId || req?.auth?.userId) || null;
    const targetUserId = Number(payload.targetUserId || 0) || null;
    const instanciaId = Number(payload.instanciaId || await inferInstanceId(req, db)) || null;
    const hasExplicitProject = Object.prototype.hasOwnProperty.call(payload, 'projectId');
    const proyectoId = hasExplicitProject
      ? (Number(payload.projectId || 0) || null)
      : (targetUserId ? await inferPrimaryProjectId(targetUserId, db) : (actorId ? await inferPrimaryProjectId(actorId, db) : null));
    const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 500) || null;
    await db.query(
      `INSERT INTO registros_auditoria (
        instancia_id,categoria,evento,actor_usuario_id,objetivo_usuario_id,proyecto_id,
        chat_usuario_id,grupo_id,mensaje_id,accion,resultado,ip,user_agent,dispositivo,
        permiso_utilizado,valores_anteriores,valores_nuevos,metadata
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        instanciaId,
        String(payload.category || 'administrativo').slice(0, 32),
        String(payload.event || 'EVENTO').slice(0, 96),
        actorId,
        targetUserId,
        proyectoId || null,
        Number(payload.chatUserId || 0) || null,
        Number(payload.groupId || 0) || null,
        Number(payload.messageId || 0) || null,
        String(payload.action || payload.event || 'Acción registrada').slice(0, 190),
        ['exitoso','alerta','fallido'].includes(payload.result) ? payload.result : 'exitoso',
        getRequestIp(req),
        userAgent,
        getDeviceLabel(userAgent),
        payload.permission ? String(payload.permission).slice(0, 96) : null,
        jsonOrNull(payload.before),
        jsonOrNull(payload.after),
        jsonOrNull(payload.metadata),
      ]
    );
  } catch (error) {
    // La auditoría nunca debe romper una operación principal.
    console.error('⚠️ No se pudo guardar registro de auditoría:', error?.message || error);
  }
}

function classifyMutation(req, statusCode) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST','PUT','PATCH','DELETE'].includes(method)) return null;
  const url = String(req.originalUrl || '').split('?')[0];
  const successful = statusCode >= 200 && statusCode < 400;
  const result = successful ? 'exitoso' : 'fallido';
  const body = sanitize(req.body || {});
  const response = sanitize(req.res?.locals?.auditResponse || null);
  const metadata = { method, url, body, response };

  const make = (category, event, action, extra = {}) => ({ category, event, action, result, metadata, ...extra });

  if (url === '/api/usuario/login') return make('seguridad', successful ? 'LOGIN' : 'LOGIN_FALLIDO', successful ? 'Inicio de sesión' : 'Intento de inicio de sesión fallido');
  if (url === '/api/usuario/logout') return make('seguridad', 'LOGOUT', 'Cierre de sesión');
  if (url.startsWith('/api/mfa')) return make('seguridad', successful ? 'MFA_EVENTO' : 'MFA_EVENTO_FALLIDO', successful ? 'Acción de autenticación MFA' : 'Intento MFA fallido');

  if (url.startsWith('/api/usuarios/admin')) {
    if (url.includes('/batch')) return method === 'POST' ? make('administrativo', 'USUARIOS_CREADOS_LOTE', 'Creó usuarios por lote') : make('administrativo', 'USUARIOS_EDICION_LOTE', 'Editó usuarios por lote');
    if (method === 'POST') return make('administrativo', 'USUARIO_CREADO', 'Creó usuario', { targetUserId: Number(response?.usuario?.id || response?.id || response?.usuario_id || 0) || null });
    if (method === 'DELETE') return make('administrativo', 'USUARIO_DESACTIVADO', 'Desactivó usuario', { targetUserId: Number(url.split('/').pop()) || null });
    if (method === 'PUT' || method === 'PATCH') {
      const targetUserId = Number(url.split('/').pop()) || null;
      if (Object.keys(req.body || {}).some((key) => /contrasena|contraseña|password/i.test(key))) return make('administrativo', 'USUARIO_PASSWORD_CAMBIADA', 'Actualizó la contraseña de un usuario', { targetUserId });
      if ('rol_id' in (req.body || {}) || 'rolId' in (req.body || {})) return make('administrativo', 'USUARIO_ROL_CAMBIADO', 'Cambió el rol de un usuario', { targetUserId });
      if ('proyecto_principal_id' in (req.body || {}) || 'proyectoPrincipalId' in (req.body || {}) || 'proyecto_id' in (req.body || {})) return make('administrativo', 'USUARIO_PROYECTO_CAMBIADO', 'Cambió el proyecto de un usuario', { targetUserId });
      if ('permisos_chat' in (req.body || {})) return make('administrativo', 'USUARIO_PERMISOS_CAMBIADOS', 'Cambió permisos de un usuario', { targetUserId });
      return make('administrativo', 'USUARIO_EDITADO', 'Editó usuario', { targetUserId });
    }
  }

  if (url.startsWith('/api/proyecto/admin')) {
    const id = Number((url.match(/\/api\/proyecto\/admin\/(\d+)/) || [])[1]) || null;
    if (method === 'POST' && !id) return make('administrativo', 'PROYECTO_CREADO', 'Creó proyecto', { projectId: Number(response?.proyecto?.id || response?.id || response?.proyecto_id || 0) || null });
    if (method === 'PUT') return make('administrativo', 'PROYECTO_EDITADO', 'Editó proyecto', { projectId: id });
    if (method === 'PATCH') return make('administrativo', 'PROYECTO_ESTADO_CAMBIADO', 'Cambió el estado de un proyecto', { projectId: id });
    if (method === 'DELETE') return make('administrativo', 'PROYECTO_MIEMBRO_QUITADO', 'Quitó un usuario de un proyecto', { projectId: id });
    if (method === 'POST') return make('administrativo', 'PROYECTO_MIEMBRO_AGREGADO', 'Agregó un usuario a un proyecto', { projectId: id });
  }

  if (url.startsWith('/api/roles/manage')) {
    const roleId = Number(url.split('/').pop()) || null;
    if (method === 'POST') return make('administrativo', 'ROL_CREADO', 'Creó rol', { projectId: null });
    if (method === 'PUT') return make('administrativo', 'ROL_EDITADO', 'Modificó rol y permisos', { projectId: null, metadata: { ...metadata, roleId } });
    if (method === 'DELETE') return make('administrativo', 'ROL_ELIMINADO', 'Eliminó rol', { projectId: null, metadata: { ...metadata, roleId } });
  }

  if (url.startsWith('/api/grupos')) {
    const groupId = Number((url.match(/\/api\/grupos\/(\d+)/) || [])[1]) || null;
    if (method === 'POST' && (url === '/api/grupos/' || url === '/api/grupos')) return make('chat_grupal', 'GRUPO_CREADO', 'Creó grupo', { groupId: Number(response?.grupo_id || response?.grupo?.grupo_id || response?.grupo?.id || 0) || null });
    if ((/\/miembros/.test(url) || url.includes('actualizar-miembros')) && method === 'POST') return make('chat_grupal', 'GRUPO_MIEMBRO_CAMBIADO', 'Modificó miembros del grupo', { groupId });
    if (/\/salir/.test(url)) return make('chat_grupal', 'GRUPO_SALIDA', 'Salió del grupo', { groupId });
    if (method === 'DELETE' && url.endsWith('/imagen')) return make('chat_grupal', 'GRUPO_IMAGEN_ELIMINADA', 'Eliminó la imagen del grupo', { groupId });
    if (method === 'DELETE' && /^\/api\/grupos\/\d+$/.test(url)) return make('chat_grupal', 'GRUPO_ELIMINADO', 'Eliminó grupo', { groupId });
    if (method === 'PUT') return make('chat_grupal', 'GRUPO_EDITADO', 'Modificó grupo', { groupId });
  }

  if (url.startsWith('/api/mensajesGrupo')) {
    const messageId = Number((url.match(/\/api\/mensajesGrupo\/(\d+)/) || [])[1]) || null;
    if (method === 'POST' && (url === '/api/mensajesGrupo/' || url === '/api/mensajesGrupo')) return make('chat_grupal', 'MENSAJE_GRUPO_ENVIADO', 'Envió mensaje en grupo');
    if (url.endsWith('/editar')) return make('chat_grupal', 'MENSAJE_GRUPO_EDITADO', 'Editó mensaje de grupo', { messageId });
    if (url.endsWith('/eliminar')) return make('chat_grupal', 'MENSAJE_GRUPO_ELIMINADO', 'Eliminó mensaje de grupo', { messageId });
    if (url.endsWith('/deshacer')) return make('chat_grupal', 'MENSAJE_GRUPO_RESTAURADO', 'Restauró mensaje de grupo', { messageId });
  }

  if (url.startsWith('/api/mensajes')) {
    const messageId = Number((url.match(/\/api\/mensajes\/(\d+)/) || [])[1]) || null;
    if (method === 'POST' && (url === '/api/mensajes/' || url === '/api/mensajes')) return make('chat', 'MENSAJE_ENVIADO', 'Envió mensaje');
    if (url.endsWith('/editar')) return make('chat', 'MENSAJE_EDITADO', 'Editó mensaje', { messageId });
    if (url.endsWith('/eliminar')) return make('chat', 'MENSAJE_ELIMINADO', 'Eliminó mensaje', { messageId });
    if (url.endsWith('/deshacer')) return make('chat', 'MENSAJE_RESTAURADO', 'Restauró mensaje', { messageId });
  }

  return null;
}

function collectTextForBlacklist(value, out = [], depth = 0) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') {
    if (value !== '[REDACTADO]' && value.trim()) out.push(value.trim());
    return out;
  }
  if (Array.isArray(value)) {
    value.slice(0, 50).forEach((item) => collectTextForBlacklist(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      if (!SENSITIVE_KEYS.test(key)) collectTextForBlacklist(item, out, depth + 1);
    });
  }
  return out;
}

function auditRequestLifecycle(req, res, next) {
  const started = Date.now();
  const shouldCapture = ['POST','PUT','PATCH','DELETE'].includes(String(req.method || '').toUpperCase());
  if (shouldCapture) {
    res.locals = res.locals || {};
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      res.locals.auditResponse = sanitize(body);
      return originalJson(body);
    };
  }
  res.on('finish', () => {
    if (req.auditHandled) return;
    const payload = classifyMutation(req, res.statusCode);
    if (!payload) return;
    payload.metadata = { ...(payload.metadata || {}), statusCode: res.statusCode, durationMs: Date.now() - started };
    writeAudit(req, payload).catch(() => {});
    if (payload.category === 'administrativo' && req.auth?.userId) {
      const text = collectTextForBlacklist(payload.metadata?.body || {}).join(' · ').slice(0, 3000);
      if (text) {
        try {
          const { detectBlacklist } = require('./blacklistService');
          detectBlacklist({ req, actorUserId: Number(req.auth.userId), text, type: 'administrativo' }).catch(() => {});
        } catch {}
      }
    }
  });
  next();
}

module.exports = {
  writeAudit,
  auditRequestLifecycle,
  sanitize,
  getRequestIp,
  getDeviceLabel,
  inferPrimaryProjectId,
};
