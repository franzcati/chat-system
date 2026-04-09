
require('dotenv').config(); // <- Primero
const db = require("./db"); // 👈 agrega esto
const { logDev } = require('./utils/logger');
const app = require('./app');
const sequelize = require('./config/database');
const cors = require('cors');
const http = require('http');
const { initSocket, enviarEventoAlUsuario } = require("./utils/socketUtils");


// Rutas
const mensajesRoutes = require("./routes/mensajes");
const mensajesGruposRoutes = require("./routes/mensajesGrupo");

// 🔹 Configuración CORS para producción
const allowedOrigins = [
  "http://chatvista.click",
  "https://chatvista.click",
  "http://www.chatvista.click",
  "https://www.chatvista.click"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

const PORT = process.env.PORT || 5000;

// Crear servidor HTTP con Express
const server = http.createServer(app);

// 🔹 Inicializar Socket y capturar io y usuariosConectados
const { io, usuariosConectados } = initSocket(server);
app.set("io", io);


app.set("io", io);
app.set("socketUtils", { usuariosConectados, enviarEventoAlUsuario });

app.use((req, res, next) => {
  req.io = io;
  req.usuariosConectados = usuariosConectados;
  req.enviarEventoAlUsuario = enviarEventoAlUsuario;
  next();
});


// Rutas
app.use("/api/mensajes", mensajesRoutes);

app.use("/api/mensajes/grupo", mensajesGruposRoutes);

// Otras rutas
app.use('/api/registro', require('./routes/signup'));
app.use('/api/sedes', require('./routes/sedes'));
app.use('/api/usuario', require('./routes/usuario'));
app.use('/api/chats', require('./routes/chats'));

app.get('/', (req, res) => {
  res.send('API Chat funcionando');
});

// Conectar a la base de datos y levantar servidor
async function startServer() {
  try {
    await sequelize.authenticate();
    logDev('✅ Conexión a MariaDB exitosa.');

    await sequelize.sync({ alter: true });

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
          console.log(`🕒 ${result.affectedRows} mensajes fijados expirados fueron eliminados automáticamente.`);
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
