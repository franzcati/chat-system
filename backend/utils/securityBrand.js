// Nombre visible de esta VPS. No modificar los identificadores del cifrado ni los dominios.
function securityBrand() {
  const value = String(process.env.SECURITY_CENTER_BRAND || 'ChatVista').replace(/[\r\n\0<>]/g, ' ').trim();
  return value.slice(0, 60) || 'ChatVista';
}

module.exports = { securityBrand };
