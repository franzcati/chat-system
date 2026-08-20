require('dotenv').config(); // <- Aquí al principio

const express = require('express');
const cors = require('cors');
const app = express();

app.set("trust proxy", true);

const defaultAllowedOrigins = [
  "http://quickchat.click",
  "https://quickchat.click",
  "http://www.quickchat.click",
  "https://www.quickchat.click",
  "http://chatvista.click",
  "https://chatvista.click",
  "http://www.chatvista.click",
  "https://www.chatvista.click",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const envAllowedOrigins = String(process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URLS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowedOrigins]));

const signupRoutes = require('./routes/signup'); // ⬅️ Importa las rutas

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origen no permitido por CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));
app.use(express.json());

// REGISTRO (SIGNUP)
app.use('/api/registro', signupRoutes); // ⬅️ Ahora puedes acceder a /api/signup/messages

// SEDES
const sedesRoutes = require('./routes/sedes');
app.use('/api/sedes', sedesRoutes);

// MESSAGES
const messagesRoutes = require('./routes/messages');
app.use('/api/messages', messagesRoutes);

//LOGIN
app.use('/api/usuario', require('./routes/usuario'));

// MFA / AUTENTICACION EN DOS PASOS
app.use('/api/mfa', require('./routes/mfa'));

//BUSQUEDA DE CHAT
const chats = require('./routes/chats');
app.use('/api/chats', chats);

//PROYECTOS
app.use("/api/proyecto", require("./routes/proyecto"));

//AGREGAR USUARIOS NUEVOS
app.use("/api/addusers", require("./routes/addusers"));

//FUNCION PARA USUARIOS
app.use("/api/usuarios", require("./routes/usuarios"));

//FUNCION PARA ROLES
app.use("/api/roles", require("./routes/roles"));

//FUNCION PARA PERMISOS DE ROLES
app.use("/api/roles_permisos", require("./routes/roles_permisos"));

const gruposRoutes = require("./routes/grupos");
app.use("/api/grupos", gruposRoutes);

//STICKERS
const stickersRoutes = require("./routes/stickers");
app.use("/api/stickers", stickersRoutes);

// 👇 NOTIFICACIONES
const notificacionesRoutes = require("./routes/notificaciones");
app.use("/api/notificaciones", notificacionesRoutes);

// GIPHY: búsquedas/trending con caché y almacenamiento local de GIFs.
const giphyRoutes = require("./routes/giphy");
app.use("/api/giphy", giphyRoutes);

const path = require("path");

// Los GIF guardados por QuickChat tienen nombres inmutables (ID/hash), por
// eso sí podemos permitir una caché larga sin afectar el resto de uploads.
app.use(
  "/uploads/gifs",
  express.static(path.join(__dirname, "uploads", "gifs"), {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    immutable: true,
  })
);

// Los archivos de mensajes usan nombres únicos (timestamp/ID), por eso
// Chrome puede reutilizarlos al cambiar de conversación sin pedirlos otra vez.
// Otros recursos de /uploads conservan una caché corta.
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      const normalized = String(filePath || "").replace(/\\/g, "/");
      const isPrivateChatMedia = /\/uploads\/chat_\d+_\d+\//i.test(normalized);
      const isGroupChatMedia = /\/uploads\/grupo_\d+\/archivos\//i.test(normalized);

      if (isPrivateChatMedia || isGroupChatMedia) {
        res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  })
);

// Aquí se agregarán las rutas más adelante
app.get('/', (req, res) => {
  res.send('API Chat funcionando');
});

module.exports = app;