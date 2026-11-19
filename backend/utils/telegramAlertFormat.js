const { securityBrand } = require('./securityBrand');

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function browserSummary(value) {
  const ua = String(value || '');
  const browser = /Edg\/([\d.]+)/.exec(ua) ? 'Microsoft Edge' :
    /(?:Chrome|CriOS)\/([\d.]+)/.exec(ua) ? 'Google Chrome' :
    /Firefox\/([\d.]+)/.exec(ua) ? 'Firefox' :
    /Safari\/([\d.]+)/.exec(ua) ? 'Safari' : 'Navegador no identificado';
  const system = /Windows NT 10\.0/.test(ua) ? 'Windows 10/11' :
    /Windows NT/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS/iPadOS' : /Mac OS X/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : 'Sistema no identificado';
  return `${browser} · ${system}`;
}

function formatTelegramAlert(message, timezone = 'America/Lima') {
  const [heading = 'Alerta de seguridad', ...lines] = String(message || '').split(/\r?\n/);
  // También admite avisos que estaban en cola antes de configurar el nombre de esta VPS.
  const title = heading.replace(/^((?:🚨|⚠️|🔐|✅)\s*)?(?:CHATVISTA|QUICKCHAT|CHATQUICK)\s*·\s*/i, '$1');
  const rows = lines.filter(Boolean).map(line => {
    const match = /^([^:]{1,35}):\s*(.*)$/.exec(line);
    if (!match) return escapeHtml(line);
    const [, label, raw] = match;
    let value = raw;
    if (label === 'Navegador' || label === 'Dispositivo') value = browserSummary(raw);
    if (label === 'Fecha' && !Number.isNaN(Date.parse(raw))) {
      try {
        value = new Intl.DateTimeFormat('es-PE', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(raw)) + ` (${timezone})`;
      } catch { value = raw; }
    }
    if (label === 'IP' && /^(?:127\.|::1$|::ffff:127\.)/.test(raw)) value = 'No registrada (proxy local)';
    return `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`;
  });
  const body = rows.length ? `\n\n<blockquote>${rows.join('\n')}</blockquote>` : '';
  return `<b>${escapeHtml(title)}</b>${body}\n\n<i>${escapeHtml(securityBrand())} · Seguridad 2FA</i>`;
}

module.exports = { formatTelegramAlert };
