// utils/logger.js
const logDev = (...args) => {
  if ((process.env.NODE_ENV || 'development') === 'development') {
    console.log(...args);
  }
};

module.exports = { logDev };