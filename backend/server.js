
require('dotenv').config(); // <- Primero
const db = require("./db"); // 👈 agrega esto
const { logDev } = require('./utils/logger');
const app = require('./app');
const sequelize = require('./config/database');
const http = require('http');
const { initSocket, enviarEventoAlUsuario, getUsuariosConectados, setEstadoManualUsuario } = require("./utils/socketUtils");


// Rutas
const mensajesRoutes = require("./routes/mensajes");
const mensajesGruposRoutes = require("./routes/mensajesGrupo");

const PORT = process.env.PORT || 5000;

// Crear servidor HTTP con Express
const server = http.createServer(app);

// 🔹 Inicializar Socket y capturar io y usuariosConectados
const { io, usuariosConectados } = initSocket(server);
app.set("io", io);
app.set("socketUtils", { usuariosConectados, enviarEventoAlUsuario, getUsuariosConectados, setEstadoManualUsuario });

app.use((req, res, next) => {
  req.io = io;
  req.usuariosConectados = usuariosConectados;
  req.enviarEventoAlUsuario = enviarEventoAlUsuario;
  next();
});


// Rutas
app.use("/api/mensajes", mensajesRoutes);

app.use("/api/mensajes/grupo", mensajesGruposRoutes);

// Conectar a la base de datos y levantar servidor
async function startServer() {
  try {
    await sequelize.authenticate();
    logDev('✅ Conexión a MariaDB exitosa.');

    // En producción no ejecutar ALTER automático en cada reinicio: puede tomar
    // metadata locks y bloquear temporalmente las tablas del chat.
    const allowSchemaAlter = String(process.env.DB_SYNC_ALTER || "false").toLowerCase() === "true";
    await sequelize.sync(allowSchemaAlter ? { alter: true } : {});

    server.listen(PORT, () => {
      logDev(`🚀 Servidor corriendo en puerto ${PORT}`);
      logDev(`🌐 Accesible desde chatvista.click`);
    });

    // 🔁 Limpieza automática de mensajes fijados expirados (cada hora)
    setInterval(async () => {
      try {
        const [result] = await db.query(
          `DELETE FROM mensajes_fijados WHERE fecha_expiracion <= UTC_TIMESTAMP()`
        );
        if (result.affectedRows > 0) {
          logDev(`🕒 ${result.affectedRows} mensajes fijados expirados fueron eliminados automáticamente.`);
        }
      } catch (err) {
        console.error("❌ Error limpiando mensajes fijados expirados:", err);
      }
    }, 60 * 60 * 1000); // cada 1 hora

  } catch (error) {
    console.error('❌ Error al conectar con la base de datos:', error);
  }
}

startServer();
