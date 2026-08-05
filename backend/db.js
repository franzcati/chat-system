require('dotenv').config();
const mysql = require('mysql2/promise');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Un pool moderado es mejor que abrir una conexión por usuario. Para ~500 usuarios
// concurrentes, 25-40 conexiones suelen ser un punto de partida razonable; se puede
// ajustar desde .env después de medir, sin volver a cambiar el código.
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: toPositiveInt(process.env.DB_POOL_LIMIT, 30),
  maxIdle: toPositiveInt(process.env.DB_POOL_MAX_IDLE, 20),
  idleTimeout: toPositiveInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 60000),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

module.exports = db;
