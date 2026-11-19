const labels = Object.freeze({
  CODE_ATTEMPT: 'Intentos de consulta 2FA fuera de horario',
  CODE_REVEALED: 'Códigos 2FA consultados',
  CODE_DENIED: 'Consultas 2FA rechazadas',
  LOGIN_SUCCESS: 'Inicios de sesión',
  NEW_DEVICE: 'Dispositivos nuevos',
  MULTIPLE_DEVICES: 'Sesiones en varios dispositivos',
  TRUSTED_DEVICE_ADDED: 'Dispositivos de confianza adicionales',
  MFA_ADMIN_RESET: 'MFA restablecidos por un administrador',
  TELEGRAM_MFA_RESET: 'MFA restablecidos desde Telegram',
  TELEGRAM_TRUST_REVOKED: 'Dispositivos de confianza revocados desde Telegram',
  CREDENTIAL_CREATED: 'Credenciales 2FA agregadas',
  CREDENTIAL_UPDATED: 'Credenciales 2FA editadas',
  CREDENTIAL_DELETED: 'Credenciales 2FA eliminadas',
  CREDENTIAL_STATUS: 'Cambios de estado de credenciales',
  ACCESS_CHANGED: 'Cambios de acceso a credenciales',
  POLICY_CHANGED: 'Cambios de horario de seguridad',
  LIMITS_CHANGED: 'Cambios de límites de seguridad',
  EXCEPTION_CREATED: 'Excepciones de horario agregadas',
  EXCEPTION_DELETED: 'Excepciones de horario eliminadas',
  ALERT_CONFIG_CHANGED: 'Cambios de configuración de alertas',
});

function securityEventLabel(type) {
  return labels[type] || String(type || 'Evento desconocido').replace(/[^A-Za-z0-9_ -]/g, '').replace(/_/g, ' ').toLowerCase();
}

module.exports = { labels, securityEventLabel };
