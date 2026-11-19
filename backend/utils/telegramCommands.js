const db = require('../db');
const { telegramApi } = require('./telegramApi');
const { securityBrand } = require('./securityBrand');
const { securityEventLabel } = require('./securityEventLabels');
const { localParts, telegramServerEnabled } = require('./securityCenter');

const html = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const menu = { inline_keyboard: [
  [{ text: '📊 Alertas de hoy', callback_data: 'qc:today' }, { text: '📅 Ayer', callback_data: 'qc:yesterday' }],
  [{ text: '📱 Dispositivos de confianza', callback_data: 'qc:devices' }],
  [{ text: '🛡️ Administración MFA', callback_data: 'qc:mfa' }],
] };
const send = async (chatId, message, replyMarkup, messageId) => {
  const response = await telegramApi(messageId ? 'editMessageText' : 'sendMessage', { chat_id: chatId, text: message, parse_mode: 'HTML',
    ...(messageId ? { message_id: messageId } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  if (!response.ok && !/message is not modified/i.test(response.description || '')) throw new Error(`Telegram HTTP ${response.status}`);
};
async function report(chatId, instanceId, timezone, date, messageId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    return send(chatId, 'Fecha inválida. Usa <code>/alertas AAAA-MM-DD</code>.', undefined, messageId);
  }
  const [rows] = await db.query(`SELECT event_type,result,created_at FROM security_events
    WHERE instancia_id=? AND created_at>=DATE_SUB(?, INTERVAL 1 DAY)
      AND created_at<DATE_ADD(?, INTERVAL 2 DAY) ORDER BY id DESC LIMIT 5000`, [instanceId, date, date]);
  const counts = {};
  for (const row of rows) {
    if (localParts(timezone, new Date(`${String(row.created_at).replace(' ', 'T')}Z`)).date !== date) continue;
    counts[row.event_type] = (counts[row.event_type] || 0) + 1;
  }
  const types = ['CODE_ATTEMPT', 'CODE_REVEALED', 'CREDENTIAL_CREATED', 'CREDENTIAL_UPDATED',
    'CREDENTIAL_DELETED', 'NEW_DEVICE', 'MULTIPLE_DEVICES', 'TRUSTED_DEVICE_ADDED', 'MFA_ADMIN_RESET',
    'TELEGRAM_MFA_RESET', 'TELEGRAM_TRUST_REVOKED'];
  const lines = [...new Set([...types, ...Object.keys(counts)])]
    .map(type => `• ${html(securityEventLabel(type))}: <b>${counts[type] || 0}</b>`);
  await send(chatId, `<b>📊 Resumen de alertas · ${date}</b>\nZona horaria: ${html(timezone)}\n\n${lines.join('\n')}\n\n<i>Los eventos pueden aparecer con retraso si Telegram estuvo sin conexión.</i>`,
    { inline_keyboard: [[{ text: '⬅️ Menú', callback_data: 'qc:menu' }]] }, messageId);
}
async function trustedUsers(instanceId) {
  const [rows] = await db.query(`SELECT u.id,u.nombre,u.apellido,COUNT(d.id) devices
    FROM usuario_mfa_dispositivos d JOIN usuario u ON u.id=d.usuario_id AND u.instancia_id=?
    WHERE d.revoked_at IS NULL AND d.expires_at>UTC_TIMESTAMP()
    GROUP BY u.id,u.nombre,u.apellido HAVING devices>1 ORDER BY devices DESC,u.id LIMIT 30`, [instanceId]);
  return rows;
}
async function devices(chatId, instanceId, messageId) {
  const rows = await trustedUsers(instanceId);
  const keyboard = rows.slice(0, 20).map(r => [{ text: `${`${r.nombre || ''} ${r.apellido || ''}`.trim()} (ID ${r.id}) · ${r.devices} dispositivos`, callback_data: `qc:user:${r.id}` }]);
  keyboard.push([{ text: '🔄 Actualizar', callback_data: 'qc:devices' }, { text: '⬅️ Menú', callback_data: 'qc:menu' }]);
  await send(chatId, `<b>📱 Usuarios con varios dispositivos de confianza</b>\nRegistros vigentes, aunque no estén conectados ahora.\n\n<b>${rows.length}</b> usuario(s) encontrado(s). Selecciona uno para ver sus dispositivos.`,
    { inline_keyboard: keyboard }, messageId);
}
const pending = new Map();
const allowedAdmin = senderId => String(process.env.SECURITY_TELEGRAM_ADMIN_IDS || '').split(',').map(x => x.trim()).includes(String(senderId));
async function userDevices(chatId, instanceId, userId, messageId, senderId) {
  const [users] = await db.query('SELECT id,nombre,apellido FROM usuario WHERE id=? AND instancia_id=? LIMIT 1', [userId, instanceId]);
  if (!users.length) return devices(chatId, instanceId, messageId);
  const [rows] = await db.query(`SELECT id,nombre,last_used_at FROM usuario_mfa_dispositivos
    WHERE usuario_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() ORDER BY last_used_at DESC LIMIT 25`, [userId]);
  const list = rows.map(r => `• ${html(r.nombre || 'Dispositivo')} (ID ${r.id})`).join('\n');
  return send(chatId, `<b>📱 ${html(`${users[0].nombre || ''} ${users[0].apellido || ''}`.trim())}</b>\n${rows.length} dispositivo(s) de confianza vigente(s).\n\n${list || 'Ninguno.'}\n\n<i>Revocar la confianza exige volver a confirmar MFA en el próximo inicio; no borra el MFA registrado.</i>`,
    { inline_keyboard: [
      ...(rows.length && allowedAdmin(senderId) ? [[{ text: '🔒 Revocar confianza de todos', callback_data: `qc:revoke:${userId}` }]] : []),
      ...(allowedAdmin(senderId) ? [[{ text: '🔑 Restablecer MFA', callback_data: `qc:reset:${userId}` }]] : []),
      [{ text: '⬅️ Usuarios', callback_data: 'qc:devices' }],
    ] }, messageId);
}
async function handle(update) {
  const callback = update.callback_query;
  const message = callback?.message || update.message;
  const chatId = String(message?.chat?.id || '');
  const senderId = callback?.from?.id || message?.from?.id;
  if (!chatId || !senderId || !['group','supergroup'].includes(message.chat.type)) return;
  const [policies] = await db.query('SELECT instancia_id,timezone FROM security_policy WHERE telegram_chat_id=? AND telegram_enabled=1', [chatId]);
  if (!policies.length) return;
  const member = await telegramApi('getChatMember', { chat_id: chatId, user_id: senderId });
  if (!member.ok || !['creator','administrator'].includes(member.result?.status)) {
    if (callback) await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Solo administradores del grupo pueden consultar estos datos.', show_alert: true });
    return;
  }
  if (callback) await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
  const policy = policies[0];
  const action = callback?.data || message.text?.trim() || '';
  const messageId = callback?.message?.message_id;
  if (action === 'qc:menu' || /^\/cmds(?:@\w+)?$/i.test(action)) {
    return send(chatId, `<b>🛡️ QuickChatBot · Panel de comandos</b>\nConsulta la actividad de seguridad de ${html(securityBrand())}.\n\n• <code>/alertas AAAA-MM-DD</code> para una fecha\n• <code>/dispositivos</code> para confianza registrada\n• <code>/miid</code> para ver tu ID de Telegram\n\nElige una opción:`, menu, messageId);
  }
  if (/^\/miid(?:@\w+)?$/i.test(action)) return send(chatId, `Tu ID de Telegram es <code>${senderId}</code>. Solo una persona autorizada en el servidor podrá revocar confianza.`);
  if (action === 'qc:today') return report(chatId, policy.instancia_id, policy.timezone, localParts(policy.timezone).date, messageId);
  if (action === 'qc:yesterday') {
    const yesterday = new Date(Date.now() - 86400000);
    return report(chatId, policy.instancia_id, policy.timezone, localParts(policy.timezone, yesterday).date, messageId);
  }
  if (action === 'qc:devices' || /^\/dispositivos(?:@\w+)?$/i.test(action)) return devices(chatId, policy.instancia_id, messageId);
  const selected = /^qc:user:(\d+)$/.exec(action);
  if (selected) return userDevices(chatId, policy.instancia_id, Number(selected[1]), messageId, senderId);
  const change = /^qc:(revoke|reset):(\d+)$/.exec(action);
  if (change && allowedAdmin(senderId)) {
    const [, type, rawId] = change;
    const userId = Number(rawId);
    const [users] = await db.query('SELECT id,nombre,apellido FROM usuario WHERE id=? AND instancia_id=? LIMIT 1', [userId,policy.instancia_id]);
    if (!users.length) return devices(chatId, policy.instancia_id, messageId);
    const code = require('node:crypto').randomBytes(8).toString('hex');
    pending.set(code, { chatId, senderId, userId, type, instanceId: policy.instancia_id, expires: Date.now()+60000 });
    return send(chatId, `<b>⚠️ Confirmar ${type === 'reset' ? 'restablecimiento MFA' : 'revocación'}</b>\nUsuario: ${html(`${users[0].nombre || ''} ${users[0].apellido || ''}`.trim())}\n${type === 'reset' ? 'Se borrará su MFA registrado, correo de recuperación y códigos; deberá configurarlo de nuevo al iniciar sesión.' : 'Se revocará la confianza de sus dispositivos; el MFA registrado seguirá vigente.'} También se cerrarán sus sesiones.`,
      { inline_keyboard: [[{ text: type === 'reset' ? 'Confirmar restablecimiento MFA' : 'Confirmar revocación', callback_data: `qc:confirm:${code}` }], [{ text: 'Cancelar', callback_data: `qc:user:${userId}` }]] }, messageId);
  }
  const confirm = /^qc:confirm:([a-f0-9]{16})$/.exec(action);
  if (confirm && allowedAdmin(senderId)) {
    const item = pending.get(confirm[1]); pending.delete(confirm[1]);
    if (!item || item.expires<Date.now() || item.chatId!==chatId || item.senderId!==senderId || item.instanceId!==policy.instancia_id) {
      return send(chatId, 'Confirmación vencida. Vuelve a seleccionar el usuario.', { inline_keyboard: [[{ text: '⬅️ Usuarios', callback_data: 'qc:devices' }]] }, messageId);
    }
    const conn = await db.getConnection();
    let revoked;
    try {
      await conn.beginTransaction();
      if (item.type === 'reset') await conn.query(`INSERT INTO usuario_mfa (usuario_id,mfa_required,mfa_enabled)
        VALUES (?,1,0) ON DUPLICATE KEY UPDATE mfa_required=1,mfa_enabled=0,secret_encrypted=NULL,
        pending_secret_encrypted=NULL,pending_created_at=NULL,enabled_at=NULL,last_totp_counter=NULL,
        recovery_email=NULL,email_enabled=0,email_verified_at=NULL,updated_at=UTC_TIMESTAMP()`, [item.userId]);
      const [result] = await conn.query(`UPDATE usuario_mfa_dispositivos SET revoked_at=UTC_TIMESTAMP()
        WHERE usuario_id=? AND revoked_at IS NULL`, [item.userId]);
      revoked = result.affectedRows;
      if (item.type === 'reset') {
        await conn.query(`UPDATE usuario_mfa_email_challenges SET used_at=COALESCE(used_at,UTC_TIMESTAMP())
          WHERE usuario_id=? AND used_at IS NULL`, [item.userId]);
        await conn.query(`UPDATE usuario_mfa_recovery_codes SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP())
          WHERE usuario_id=? AND used_at IS NULL`, [item.userId]);
      }
      await conn.query(`UPDATE security_sessions SET revoked_at=UTC_TIMESTAMP(3)
        WHERE instancia_id=? AND usuario_id=? AND revoked_at IS NULL`, [policy.instancia_id,item.userId]);
      await conn.query(`INSERT INTO security_events (instancia_id,usuario_id,event_type,result,detail_json)
        VALUES (?,?,?,'ok',?)`, [policy.instancia_id,item.userId,
        item.type === 'reset' ? 'TELEGRAM_MFA_RESET' : 'TELEGRAM_TRUST_REVOKED',
        JSON.stringify({ telegram_admin_id: String(senderId), target_user_id: item.userId, revoked_count: revoked })]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
    return send(chatId, `<b>✅ ${item.type === 'reset' ? 'MFA restablecido' : 'Confianza revocada'}</b>\nUsuario ID ${item.userId} · ${revoked} dispositivo(s). Sus sesiones fueron cerradas. ${item.type === 'reset' ? 'Deberá registrar nuevamente su MFA.' : 'El MFA registrado sigue vigente.'}`,
      { inline_keyboard: [[{ text: '⬅️ Usuarios', callback_data: 'qc:devices' }]] }, messageId);
  }
  if (action === 'qc:mfa') return send(chatId, '<b>🛡️ Administración MFA</b>\nSelecciona “Dispositivos de confianza”, elige un usuario y confirma la revocación o el restablecimiento. Solo los administradores autorizados en la VPS pueden ejecutar cambios.',
    { inline_keyboard: [[{ text: '📱 Dispositivos', callback_data: 'qc:devices' }, { text: '⬅️ Menú', callback_data: 'qc:menu' }]] }, messageId);
  const date = /^\/alertas(?:@\w+)?\s+(\S+)$/i.exec(action)?.[1];
  if (date) return report(chatId, policy.instancia_id, policy.timezone, date, messageId);
}
let running = false;
function startTelegramCommands() {
  if (running || !telegramServerEnabled() || process.env.SECURITY_TELEGRAM_COMMANDS_DISABLED === 'true' || !process.env.SECURITY_TELEGRAM_BOT_TOKEN) return;
  running = true;
  (async () => {
    let offset;
    let commandsRegistered = false;
    while (telegramServerEnabled() && process.env.SECURITY_TELEGRAM_COMMANDS_DISABLED !== 'true') {
      try {
        const [active] = await db.query('SELECT 1 FROM security_policy WHERE telegram_enabled=1 AND telegram_chat_id IS NOT NULL LIMIT 1');
        if (active.length) {
          if (!commandsRegistered) {
            const registered = await telegramApi('setMyCommands', { commands: [
              { command: 'cmds', description: 'Panel de seguridad' },
              { command: 'alertas', description: 'Resumen por fecha AAAA-MM-DD' },
              { command: 'dispositivos', description: 'Dispositivos de confianza registrados' },
              { command: 'miid', description: 'Mostrar mi ID de Telegram' },
            ] });
            if (!registered.ok) throw new Error(`Telegram HTTP ${registered.status}`);
            commandsRegistered = true;
          }
          const response = await telegramApi('getUpdates', { offset: offset ?? -1, limit: 100, timeout: 10,
            allowed_updates: ['message','callback_query'] }, 16000);
          if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
          for (const update of response.result || []) {
            offset = update.update_id + 1;
            try { await handle(update); } catch (error) { console.error('Comando Telegram:', error.code || error.message); }
          }
        }
      } catch (error) { console.error('Recepción de comandos Telegram:', error.code || error.message); }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    running = false;
  })().catch(error => { running = false; console.error('Comandos Telegram:', error.message); });
}
module.exports = { startTelegramCommands };
