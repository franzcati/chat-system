const pool = require('../db');
const { writeAudit, inferPrimaryProjectId } = require('./auditService');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let left = i;
    let diag = i - 1;
    for (let j = 1; j <= y.length; j += 1) {
      const up = prev[j];
      const value = x[i - 1] === y[j - 1] ? diag : Math.min(diag, up, left) + 1;
      prev[j] = value;
      diag = up;
      left = value;
    }
  }
  return prev[y.length];
}

function matchesRule(message, rule) {
  const text = normalizeText(message);
  const needle = normalizeText(rule.palabra);
  if (!text || !needle) return false;
  if (rule.coincidencia === 'contiene') return text.includes(needle);
  if (rule.coincidencia === 'exacta') {
    if (text === needle) return true;
    return ` ${text} `.includes(` ${needle} `);
  }
  // Variaciones: comparación segura, sin regex aportadas por usuarios.
  if (text.includes(needle)) return true;
  const words = text.split(/[^a-z0-9ñ]+/i).filter(Boolean);
  const targetWords = needle.split(/[^a-z0-9ñ]+/i).filter(Boolean);
  if (targetWords.length !== 1) return false;
  const target = targetWords[0];
  const maxDistance = target.length >= 8 ? 2 : 1;
  return words.some((word) => Math.abs(word.length - target.length) <= maxDistance && levenshtein(word, target) <= maxDistance);
}

async function notifyAdmins(req, detection, db = pool) {
  try {
    const [admins] = await db.query(
      `SELECT DISTINCT u.id
         FROM usuario u
         JOIN roles_permisos rp ON rp.rol_id=u.rol_id
        WHERE u.instancia_id=? AND u.estado='aprobado'
          AND rp.permiso IN ('ver_blacklist','gestionar_blacklist')`,
      [Number(detection.instancia_id)]
    );
    const socketUtils = req.app.get('socketUtils');
    if (!socketUtils?.enviarEventoAlUsuario) return;
    for (const admin of admins) {
      socketUtils.enviarEventoAlUsuario(Number(admin.id), 'blacklistAlerta', detection);
    }
  } catch (error) {
    console.error('⚠️ No se pudo notificar detección blacklist:', error?.message || error);
  }
}

async function detectBlacklist({ req, actorUserId, targetUserId = null, messageId, groupId = null, text, type }) {
  try {
    const instanciaId = Number(req?.instanciaActual?.id || req?.auth?.usuario?.instancia_id);
    if (!instanciaId || !actorUserId || !text) return [];
    if (type !== 'administrativo' && !messageId) return [];
    const projectId = await inferPrimaryProjectId(actorUserId, pool);
    const applyColumn = type === 'grupo' ? 'aplicar_grupos' : type === 'administrativo' ? 'aplicar_administrativos' : 'aplicar_chats';
    const [rules] = await pool.query(
      `SELECT * FROM blacklist_reglas
        WHERE instancia_id=? AND activa=1 AND ${applyColumn}=1
          AND (proyecto_id IS NULL OR proyecto_id=?)
        ORDER BY FIELD(severidad,'critica','alta','media','baja'), id ASC`,
      [instanciaId, projectId || 0]
    );
    const matched = [];
    for (const rule of rules) {
      if (!matchesRule(text, rule)) continue;
      const estado = rule.accion === 'registrar' ? 'registrado' : 'alerta';
      const snippet = String(text).slice(0, 500);
      const [result] = await pool.query(
        `INSERT INTO blacklist_detecciones (
          regla_id,instancia_id,actor_usuario_id,objetivo_usuario_id,proyecto_id,chat_usuario_id,
          grupo_id,mensaje_id,tipo,categoria,palabra_detectada,coincidencia_texto,contexto,severidad,
          accion_tomada,estado
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          rule.id, instanciaId, Number(actorUserId), Number(targetUserId || 0) || null,
          projectId || null, type === 'chat' ? Number(targetUserId || 0) || null : null,
          Number(groupId || 0) || null, Number(messageId || 0) || null, type,
          rule.categoria, rule.palabra, snippet, snippet, rule.severidad, rule.accion, estado,
        ]
      );
      const detection = {
        id: Number(result.insertId), regla_id: Number(rule.id), instancia_id: instanciaId,
        actor_usuario_id: Number(actorUserId), objetivo_usuario_id: Number(targetUserId || 0) || null,
        proyecto_id: projectId || null, grupo_id: Number(groupId || 0) || null,
        mensaje_id: Number(messageId || 0) || null, tipo: type, categoria: rule.categoria,
        palabra_detectada: rule.palabra, severidad: rule.severidad, accion_tomada: rule.accion,
        estado,
      };
      matched.push(detection);
      await writeAudit(req, {
        category: 'blacklist', event: 'BLACKLIST_DETECCION', action: `Detectó palabra restringida: ${rule.palabra}`,
        result: rule.accion === 'registrar' ? 'exitoso' : 'alerta', actorUserId, targetUserId,
        projectId, chatUserId: type === 'chat' ? targetUserId : null, groupId, messageId: Number(messageId || 0) || null,
        metadata: { detectionId: detection.id, ruleId: rule.id, severity: rule.severidad, action: rule.accion, snippet },
      });
      if (rule.accion === 'notificar') await notifyAdmins(req, detection);
    }
    return matched;
  } catch (error) {
    console.error('⚠️ Error evaluando blacklist:', error?.message || error);
    return [];
  }
}

module.exports = { detectBlacklist, matchesRule, normalizeText };
