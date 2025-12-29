// socketUtils.js
const db = require("../db"); // Necesario para consultar grupos
let usuariosConectados = {}; // Mantener estado de sockets conectados

function initSocket(server) {
  const { Server } = require("socket.io");
  const io = new Server(server, {
    cors: {
      origin: ["https://quickchat.click","https://www.quickchat.click"],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("🔌 Usuario conectado:", socket.id);

    // Registrar usuario y unir a salas
    socket.on("registrarUsuario", async (userId) => {
      socket.userId = userId;

      // Sala personal
      socket.join(`usuario_${userId}`);

      // Obtener grupos del usuario y unirse a cada sala
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

      // Registrar usuario conectado
      usuariosConectados[userId] = {
        socketId: socket.id,
        estado: "online",
        ultimaConexion: new Date(),
      };

      // Emitir lista actualizada de usuarios
      io.emit("actualizarUsuarios", usuariosConectados);
    });

    // Desconexión
    socket.on("disconnect", () => {
      if (socket.userId && usuariosConectados[socket.userId]) {
        usuariosConectados[socket.userId] = {
          estado: "desconectado",
          ultimaConexion: new Date(),
        };
        io.emit("actualizarUsuarios", usuariosConectados);
      }
    });
  });

  return { io, usuariosConectados };
}

/**
 * Función para enviar eventos a un usuario específico
 */
function enviarEventoAlUsuario(io, usuariosConectados, userId, evento, payload) {
  if (usuariosConectados[userId]) {
    const socketId = usuariosConectados[userId].socketId;
    io.to(socketId).emit(evento, payload);
  }
}

module.exports = { initSocket, enviarEventoAlUsuario };