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

export function textPresentation(appearance, fallback = '#1d3e70') {
  const palette = PALETTE.find(option => option.id === appearance?.paleta);
  return {
    background: palette ? (appearance.tema === 'dark' && palette.dark || palette.light) : fallback,
    color: palette?.ink || '#fff',
    textAlign: ['left', 'center', 'right'].includes(appearance?.alineacion) ? appearance.alineacion : 'center',
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
