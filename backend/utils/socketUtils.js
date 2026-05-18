const db = require("../db");
let usuariosConectados = {};
let ioGlobal = null;
const socketsPorUsuario = new Map();

function normalizarId(id) {
  if (id === undefined || id === null) return null;
  const value = String(id).trim();
  return value || null;
}

function publicarEstadoUsuarios(io) {
  io.emit("actualizarUsuarios", usuariosConectados);
}

async function unirUsuarioASusSalas(socket, userId) {
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
}

function agregarSocketAUsuario(userId, socketId) {
  if (!socketsPorUsuario.has(userId)) {
    socketsPorUsuario.set(userId, new Set());
  }

  socketsPorUsuario.get(userId).add(socketId);

  const socketIds = Array.from(socketsPorUsuario.get(userId));
  usuariosConectados[userId] = {
    socketId: socketIds[0],
    socketIds,
    estado: "online",
    ultimaConexion: new Date(),
  };
}

function quitarSocketDeUsuario(userId, socketId) {
  const sockets = socketsPorUsuario.get(userId);

  if (!sockets) return;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    socketsPorUsuario.delete(userId);
    usuariosConectados[userId] = {
      socketId: null,
      socketIds: [],
      estado: "desconectado",
      ultimaConexion: new Date(),
    };
    return;
  }

  const socketIds = Array.from(sockets);
  usuariosConectados[userId] = {
    socketId: socketIds[0],
    socketIds,
    estado: "online",
    ultimaConexion: new Date(),
  };
}

function initSocket(server) {
  const { Server } = require("socket.io");

  const io = new Server(server, {
    cors: {
      origin: [
        "http://chatvista.click",
        "https://chatvista.click",
        "http://www.chatvista.click",
        "https://www.chatvista.click",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  ioGlobal = io;

  io.on("connection", (socket) => {
    console.log("🔌 Usuario conectado:", socket.id);

    const registrarUsuario = async (rawUserId) => {
      const userId = normalizarId(rawUserId);
      if (!userId) return;

      if (socket.userId && socket.userId !== userId) {
        quitarSocketDeUsuario(socket.userId, socket.id);
      }

      socket.userId = userId;
      await unirUsuarioASusSalas(socket, userId);
      agregarSocketAUsuario(userId, socket.id);
      publicarEstadoUsuarios(io);
    };

    socket.on("registrarUsuario", registrarUsuario);

    socket.on("joinGrupo", (grupoId) => {
      if (!grupoId) return;
      socket.join(`grupo_${grupoId}`);
      console.log(`✅ Socket ${socket.id} unido manualmente a grupo_${grupoId}`);
    });

    socket.on("leaveGrupo", (grupoId) => {
      if (!grupoId) return;
      socket.leave(`grupo_${grupoId}`);
      console.log(`↩️ Socket ${socket.id} salió de grupo_${grupoId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log("🔴 Usuario desconectado:", socket.id, reason);

      if (socket.userId) {
        quitarSocketDeUsuario(socket.userId, socket.id);
        publicarEstadoUsuarios(io);
      }
    });

    const userIdHandshake = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userIdHandshake) {
      registrarUsuario(userIdHandshake);
    }
  });

  return { io, usuariosConectados };
}

function enviarEventoAlUsuario(userId, evento, payload) {
  if (!ioGlobal) {
    console.error("❌ Socket.io no inicializado");
    return false;
  }

  const id = normalizarId(userId);
  if (!id) return false;

  const sala = `usuario_${id}`;
  const room = ioGlobal.sockets.adapter.rooms.get(sala);

  ioGlobal.to(sala).emit(evento, payload);
  return Boolean(room && room.size > 0);
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
