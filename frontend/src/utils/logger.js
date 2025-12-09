// src/utils/logger.js
export const logDev = (...args) => {
  if (import.meta.env.VITE_NODE_ENV === 'development') {
    console.log(...args);
  }
};