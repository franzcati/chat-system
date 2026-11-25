export const PALETTE = [
  { id: 'aurora', name: 'Lavanda', light: 'linear-gradient(145deg,#7b6ed3,#6b5fd0)', dark: 'linear-gradient(130deg,#062a74,#171778 50%,#6014ab)', color: '#6455ba', swatch: '#a497ff' },
  { id: 'oceano', name: 'Azul', light: 'linear-gradient(145deg,#0877c4,#0958b6)', color: '#0958b6', swatch: '#008eff' },
  { id: 'jade', name: 'Verde', light: 'linear-gradient(140deg,#047860,#035954)', color: '#047860', swatch: '#00ac88' },
  { id: 'coral', name: 'Coral', light: 'linear-gradient(145deg,#b63749,#902843)', color: '#b63749', swatch: '#ff626c' },
  { id: 'ambar', name: 'Naranja', light: 'linear-gradient(145deg,#ffb442,#ef8e1c)', color: '#ffb442', swatch: '#ff9b06', ink: '#27164a' },
  { id: 'sol', name: 'Amarillo', light: 'linear-gradient(145deg,#ffe078,#f7b935)', color: '#ffe078', swatch: '#fac329', ink: '#27164a' },
  { id: 'violeta', name: 'Violeta', light: 'linear-gradient(145deg,#743eda,#5324a9)', color: '#743eda', swatch: '#874af5' },
  { id: 'rosa', name: 'Rosa', light: 'linear-gradient(145deg,#c13376,#86275e)', color: '#c13376', swatch: '#f34f93' },
];

export const STATUS_FONTS = [
  { id: 'predeterminada', name: 'Predeterminada', family: 'inherit' },
  { id: 'moderna', name: 'Moderna', family: 'Arial, Helvetica, sans-serif' },
  { id: 'clasica', name: 'Clásica', family: 'Georgia, Times New Roman, serif' },
  { id: 'manuscrita', name: 'Manuscrita', family: '"Segoe Script", "Comic Sans MS", cursive' },
  { id: 'mono', name: 'Monoespaciada', family: '"Courier New", monospace' },
  { id: 'redondeada', name: 'Redondeada', family: '"Trebuchet MS", Verdana, sans-serif' },
];
export function statusFont(id) {
  return STATUS_FONTS.find(font => font.id === id)?.family || 'inherit';
}

export function textPresentation(appearance, fallback = '#1d3e70') {
  const palette = PALETTE.find(option => option.id === appearance?.paleta);
  return {
    background: palette ? (appearance.tema === 'dark' && palette.dark || palette.light) : fallback,
    color: palette?.ink || '#fff',
    textAlign: ['left', 'center', 'right'].includes(appearance?.alineacion) ? appearance.alineacion : 'center',
    fontFamily: statusFont(appearance?.fuente),
    fontWeight: !appearance || appearance.negrita ? 700 : 400,
    fontStyle: appearance?.cursiva ? 'italic' : 'normal',
    textDecoration: appearance?.subrayado ? 'underline' : 'none',
  };
}

export function statusProportion(width, height) {
  if (!width || !height) return '';
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return width / divisor <= 32 && height / divisor <= 32
    ? `${width / divisor}:${height / divisor}` : `${width} × ${height}`;
}

export function statusDate(value) {
  if (typeof value !== 'string' || !value) return new Date(NaN);
  return new Date(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value);
}

export function activeStatuses(items, now = Date.now()) {
  return items.filter(item => {
    const expiration = statusDate(item.vence_at).getTime();
    return !Number.isFinite(expiration) || expiration > now;
  });
}

export function nextStatusExpiration(items, now = Date.now()) {
  return items.reduce((next, item) => {
    const expiration = statusDate(item.vence_at).getTime();
    return expiration > now ? Math.min(next, expiration) : next;
  }, Infinity);
}

export function statusContexts(item) {
  const destinations = item.destinos ?? {
    mi_estado: !item.grupo_id,
    grupos: item.grupo_id ? [{ id: item.grupo_id, nombre: item.grupo_nombre, imagen_url: item.grupo_imagen_url }] : [],
  };
  const contexts = destinations.grupos.map(group => ({ key: `g:${group.id}`, group, title: group.nombre }));
  if (destinations.mi_estado) contexts.unshift({ key: `u:${item.autor_id}`, title: [item.nombre, item.apellido].filter(Boolean).join(' ') || 'Usuario' });
  return contexts;
}

export function unseenChatContexts(items, userId, now = Date.now()) {
  const keys = new Set();
  for (const item of activeStatuses(items, now)) {
    if (Number(item.visto) || String(item.autor_id) === String(userId)) continue;
    for (const { key } of statusContexts(item)) keys.add(key);
  }
  return keys;
}

export function emojiBounds(anchor, viewport) {
  const left = viewport.left + 8;
  const top = viewport.top + 8;
  const right = viewport.left + viewport.width - 8;
  const bottom = viewport.top + viewport.height - 8;
  const width = Math.min(352, right - left);
  const above = anchor.top - top - 6;
  const below = bottom - anchor.bottom - 6;
  const room = Math.max(above, below);
  const compact = room < 240;
  const height = Math.min(420, bottom - top, compact ? bottom - top : room);
  let y = anchor.bottom + 6;
  if (compact) y = bottom - height;
  else if (above > below) y = anchor.top - 6 - height;
  return { width, height, left: Math.max(left, Math.min(anchor.left, right - width)),
    top: Math.max(top, Math.min(y, bottom - height)) };
}

export function buildTracks(items, userId, splitGroupAuthors = false) {
  const tracks = new Map();
  for (const item of items) {
    for (const context of statusContexts(item)) {
      const key = splitGroupAuthors && context.group ? context.key + ":u:" + item.autor_id : context.key;
      if (!tracks.has(key)) tracks.set(key, { ...context, key, latest: item, entries: [], unseen: false });
      const track = tracks.get(key);
      track.entries.push(item);
      if (!Number(item.visto) && String(item.autor_id) !== String(userId)) track.unseen = true;
    }
  }
  for (const track of tracks.values()) track.entries.reverse();
  return tracks;
}


export function statusStamp(value, now = new Date()) {
  const date = value instanceof Date ? value : statusDate(value);
  if (!Number.isFinite(date.getTime())) return '';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = date.toDateString() === now.toDateString() ? 'Hoy'
    : date.toDateString() === yesterday.toDateString() ? 'Ayer' : date.toLocaleDateString('es-PE');
  const hour = date.getHours();
  return day + ' a la(s) ' + (hour % 12 || 12) + ':' + String(date.getMinutes()).padStart(2, '0') + (hour < 12 ? ' a. m.' : ' p. m.');
}

export function ringPaint(entries, userId) {
  const portion = 360 / entries.length;
  const gap = entries.length === 1 ? 0 : Math.min(5, portion * .2);
  const colors = entries.flatMap((entry, index) => {
    const seen = Number(entry.visto) || String(entry.autor_id) === String(userId);
    const start = index * portion;
    const end = start + portion - gap;
    const segment = seen
      ? [`#8393aa ${start}deg ${end}deg`]
      : [`var(--qc-state-start) ${start}deg`,
        `var(--qc-state-middle) ${(start + end) / 2}deg`, `var(--qc-state-end) ${end}deg`];
    if (gap) segment.push(`transparent ${end}deg ${start + portion}deg`);
    return segment;
  });
  return entries.length ? 'conic-gradient(' + colors.join(',') + ')' : 'none';
}

// Formato de texto persistido por la ruta de respuestas de Estados.
export function statusReplyParts(text) {
  if (typeof text !== 'string') return null;
  if (text.startsWith('↪ Estados ')) {
    const end = text.indexOf('\n');
    if (end < 0) return null;
    try {
      const ref = JSON.parse(text.slice('↪ Estados '.length, end));
      if (!ref || typeof ref.id !== 'string' || !/^\d+$/.test(ref.id) ||
          !['author','excerpt','caption'].every(key => typeof ref[key] === 'string') ||
          ![null,'Foto','Video','GIF','Texto'].includes(ref.medium)) return null;
      return { id: ref.id, author: ref.author, excerpt: ref.excerpt, caption: ref.caption,
        medium: ref.medium, ...(ref.fuente && STATUS_FONTS.some(font => font.id === ref.fuente) ? { fuente: ref.fuente } : {}), reply: text.slice(end + 1), snapshot: true };
    } catch { return null; }
  }
  const match = /^↪ (Estado(?: del grupo)?) #(\d+)(?: \[(Foto|Video)\])?(?: · ([^\n]*))?\n([\s\S]+)$/.exec(text || '');
  return match && { label: match[1], id: match[2], medium: match[3], excerpt: match[4] || '', reply: match[5] };
}
