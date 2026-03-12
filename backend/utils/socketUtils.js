const db = require("../db");
let usuariosConectados = {};
let ioGlobal = null;

function initSocket(server) {
  const { Server } = require("socket.io");

  const io = new Server(server, {
    cors: {
      origin: ["https://quickchat.click", "https://www.quickchat.click"],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  ioGlobal = io;

  io.on("connection", (socket) => {
    console.log("🔌 Usuario conectado:", socket.id);

    socket.on("registrarUsuario", async (userId) => {
      socket.userId = userId;

      // Sala personal
      socket.join(`usuario_${userId}`);

      try {
        const [grupos] = await db.query(
          "SELECT grupo_id FROM usuario_grupo WHERE usuario_id = ?",
          [userId]
        );

        grupos.forEach((g) => {
          socket.join(`grupo_${g.grupo_id}`);
          console.log(`✅ Usuario ${userId} unido a sala grupo_${g.grupo_id}`);
        });
      } catch (err) {
        console.error("❌ Error obteniendo grupos del usuario:", err);
      }

      usuariosConectados[userId] = {
        socketId: socket.id,
        estado: "online",
        ultimaConexion: new Date(),
      };

      io.emit("actualizarUsuarios", usuariosConectados);
    });

    socket.on("disconnect", () => {
      if (socket.userId && usuariosConectados[socket.userId]) {
        usuariosConectados[socket.userId] = {
          ...usuariosConectados[socket.userId],
          estado: "desconectado",
          ultimaConexion: new Date(),
        };

        io.emit("actualizarUsuarios", usuariosConectados);
      }
    });
  });

  return { io, usuariosConectados };
}

function enviarEventoAlUsuario(userId, evento, payload) {
  if (!ioGlobal) {
    console.error("❌ Socket.io no inicializado");
    return false;
  }

  const usuario = usuariosConectados[userId];

  if (!usuario || !usuario.socketId) {
    return false;
  }

  ioGlobal.to(usuario.socketId).emit(evento, payload);
  return true;
}

function enviarEventoASala(sala, evento, payload) {
  if (!ioGlobal) {
    console.error("❌ Socket.io no inicializado");
    return false;
  }

  ioGlobal.to(sala).emit(evento, payload);
  return true;
}

module.exports = {
  initSocket,
  enviarEventoAlUsuario,
  enviarEventoASala,
};