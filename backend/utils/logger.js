// Los logs detallados se desactivan por defecto en producción para no convertir
// PM2 y el disco en un cuello de botella. Actívalos temporalmente con
// CHAT_VERBOSE_LOGS=1.
const logDev = (...args) => {
  const enabled = process.env.CHAT_VERBOSE_LOGS === '1' || process.env.NODE_ENV === 'development';
  if (enabled) console.log(...args);
};

module.exports = { logDev };
