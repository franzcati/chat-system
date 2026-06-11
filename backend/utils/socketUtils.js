const db = require("../db");
let usuariosConectados = {};
let ioGlobal = null;
const socketsPorUsuario = new Map();
const detallesSocketsPorUsuario = new Map();
const estadoManualPorUsuario = new Map();
const INACTIVITY_LIMIT_MS = 5 * 60 * 1000;
const PRESENCE_BROADCAST_INTERVAL_MS = Number(process.env.PRESENCE_BROADCAST_INTERVAL_MS || 5000);
const TYPING_KEEPALIVE_INTERVAL_MS = Number(process.env.TYPING_KEEPALIVE_INTERVAL_MS || 900);
const typingStates = new Map();
let presenceBroadcastTimer = null;
let lastPresenceBroadcastAt = 0;

function normalizarId(id) {
  if (id === undefined || id === null) return null;
  const value = String(id).trim();
  return value || null;
}

function normalizarEstado(estado) {
  const value = String(estado || "").trim().toLowerCase();
  const permitidos = ["online", "en_linea", "inactivo", "no_molestar", "invisible", "desconectado"];
  if (!permitidos.includes(value)) return "online";
  return value === "en_linea" ? "online" : value;
}

function normalizarDispositivo(value) {
  const device = String(value || "").toLowerCase();
  if (["mobile", "telefono", "phone"].includes(device)) return "mobile";
  if (["tablet"].includes(device)) return "tablet";
  return "desktop";
}

function getManualStatus(userId) {
  return estadoManualPorUsuario.get(String(userId)) || null;
}

function getPublicStatus(userId, hasSockets) {
  const manual = getManualStatus(userId);
  if (manual === "invisible") return "desconectado";
  if (manual === "no_molestar") return hasSockets ? "no_molestar" : "desconectado";
  if (manual === "inactivo") return hasSockets ? "inactivo" : "desconectado";
  return null;
}

function recalcularEstadoUsuario(userId) {
  const id = normalizarId(userId);
  if (!id) return null;

  const socketIds = Array.from(socketsPorUsuario.get(id) || []);
  const detalles = Array.from(detallesSocketsPorUsuario.get(id)?.values() || []);
  const hasSockets = socketIds.length > 0;
  const now = Date.now();
  const lastActivity = detalles.length
    ? Math.max(...detalles.map((detalle) => detalle.lastActivity || 0))
    : 0;
  const publicStatus = getPublicStatus(id, hasSockets);

  let estado = "desconectado";
  if (publicStatus) {
    estado = publicStatus;
  } else if (hasSockets) {
    estado = now - lastActivity >= INACTIVITY_LIMIT_MS ? "inactivo" : "online";
  }

  const deviceCounts = detalles.reduce(
    (acc, detalle) => {
      const device = normalizarDispositivo(detalle.deviceType);
      acc[device] = (acc[device] || 0) + 1;
      return acc;
    },
    { desktop: 0, mobile: 0, tablet: 0 }
  );

  const dispositivoPrincipal = deviceCounts.mobile > 0
    ? "mobile"
    : deviceCounts.tablet > 0
    ? "tablet"
    : "desktop";

  usuariosConectados[id] = {
    socketId: socketIds[0] || null,
    socketIds,
    estado,
    estadoManual: getManualStatus(id),
    dispositivo: hasSockets ? dispositivoPrincipal : null,
    dispositivos: deviceCounts,
    ultimaActividad: lastActivity ? new Date(lastActivity) : null,
    ultimaConexion: new Date(),
  };

  return usuariosConectados[id];
}

function publicarEstadoUsuarios(io) {
  Object.keys(usuariosConectados).forEach((userId) => recalcularEstadoUsuario(userId));
  io.emit("actualizarUsuarios", usuariosConectados);
}

function programarPublicarEstadoUsuarios(io, options = {}) {
  if (!io) return;

  const immediate = Boolean(options.immediate);
  const now = Date.now();
  const elapsed = now - lastPresenceBroadcastAt;

  const emitir = () => {
    if (presenceBroadcastTimer) {
      clearTimeout(presenceBroadcastTimer);
      presenceBroadcastTimer = null;
    }

    lastPresenceBroadcastAt = Date.now();
    publicarEstadoUsuarios(io);
  };

  if (immediate && elapsed >= PRESENCE_BROADCAST_INTERVAL_MS) {
    emitir();
    return;
  }

  if (presenceBroadcastTimer) return;

  const delay = Math.max(250, PRESENCE_BROADCAST_INTERVAL_MS - elapsed);
  presenceBroadcastTimer = setTimeout(emitir, delay);
}

function getAllowedSocketOrigins() {
  const defaults = [
    "http://quickchat.click",
    "https://quickchat.click",
    "http://www.quickchat.click",
    "https://www.quickchat.click",
    "http://quickchat.click",
    "https://quickchat.click",
    "http://www.quickchat.click",
    "https://www.quickchat.click",
  ];

  const envOrigins = String(
    process.env.SOCKET_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_URLS ||
    ""
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([...defaults, ...envOrigins]));
}

function validarSocketOrigin(origin, callback) {
  const allowedOrigins = getAllowedSocketOrigins();

  if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(null, false);
}

function normalizarTypingPayload(payload = {}, socket) {
  const senderId = normalizarId(payload.senderId || socket.userId);
  if (!senderId) return null;

  const tipo = payload.tipo === "grupo" ? "grupo" : "privado";
  const grupoId = tipo === "grupo" ? normalizarId(payload.grupoId) : null;
  const receiverId = tipo === "privado" ? normalizarId(payload.receiverId) : null;

  if (tipo === "grupo" && !grupoId) return null;
  if (tipo === "privado" && !receiverId) return null;
  if (tipo === "privado" && receiverId === senderId) return null;

  return {
    tipo,
    grupoId,
    receiverId,
    senderId,
    nombre: String(payload.nombre || "Usuario"),
    apellido: String(payload.apellido || ""),
  };
}

function getTypingKey(payload) {
  const target = payload.tipo === "grupo" ? `grupo_${payload.grupoId}` : `usuario_${payload.receiverId}`;
  return `${payload.senderId}:${target}`;
}

function emitirTypingUpdate(io, socket, payload, isTyping) {
  const eventPayload = {
    ...payload,
    isTyping,
    at: Date.now(),
  };

  if (payload.tipo === "grupo") {
    socket.to(`grupo_${payload.grupoId}`).emit("typing:update", eventPayload);
    return;
  }

  io.to(`usuario_${payload.receiverId}`).emit("typing:update", eventPayload);
}

function iniciarTyping(io, socket, payload = {}) {
  const normalized = normalizarTypingPayload(payload, socket);
  if (!normalized) return;

  const key = getTypingKey(normalized);
  const now = Date.now();
  const current = typingStates.get(key);

  if (current?.isTyping && now - current.lastEmittedAt < TYPING_KEEPALIVE_INTERVAL_MS) {
    typingStates.set(key, {
      ...current,
      ...normalized,
      socketId: socket.id,
      lastSeenAt: now,
    });
    return;
  }

  typingStates.set(key, {
    ...normalized,
    socketId: socket.id,
    isTyping: true,
    lastSeenAt: now,
    lastEmittedAt: now,
  });

  emitirTypingUpdate(io, socket, normalized, true);
}

function detenerTyping(io, socket, payload = {}) {
  const normalized = normalizarTypingPayload(payload, socket);
  if (!normalized) return;

  const key = getTypingKey(normalized);
  const current = typingStates.get(key);

  if (current && current.socketId && current.socketId !== socket.id) return;

  typingStates.delete(key);
  emitirTypingUpdate(io, socket, normalized, false);
}

function detenerTypingDeSocket(io, socket) {
  Array.from(typingStates.entries()).forEach(([key, state]) => {
    if (state.socketId !== socket.id) return;
    typingStates.delete(key);
    emitirTypingUpdate(io, socket, state, false);
  });
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

function agregarSocketAUsuario(userId, socketId, meta = {}) {
  const id = normalizarId(userId);
  if (!id) return;

  if (!socketsPorUsuario.has(id)) {
    socketsPorUsuario.set(id, new Set());
  }

  if (!detallesSocketsPorUsuario.has(id)) {
    detallesSocketsPorUsuario.set(id, new Map());
  }

  socketsPorUsuario.get(id).add(socketId);
  detallesSocketsPorUsuario.get(id).set(socketId, {
    deviceType: normalizarDispositivo(meta.deviceType),
    userAgent: meta.userAgent || "",
    connectedAt: Date.now(),
    lastActivity: Date.now(),
  });

  recalcularEstadoUsuario(id);
}

function marcarActividadUsuario(userId, socketId, meta = {}) {
  const id = normalizarId(userId);
  if (!id) return;

  const detalles = detallesSocketsPorUsuario.get(id);
  const detalle = detalles?.get(socketId);
  if (!detalle) return;

  detalles.set(socketId, {
    ...detalle,
    deviceType: normalizarDispositivo(meta.deviceType || detalle.deviceType),
    userAgent: meta.userAgent || detalle.userAgent || "",
    lastActivity: Date.now(),
  });

  recalcularEstadoUsuario(id);
}

function quitarSocketDeUsuario(userId, socketId) {
  const id = normalizarId(userId);
  if (!id) return;

  const sockets = socketsPorUsuario.get(id);
  const detalles = detallesSocketsPorUsuario.get(id);

  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) socketsPorUsuario.delete(id);
  }

  if (detalles) {
    detalles.delete(socketId);
    if (detalles.size === 0) detallesSocketsPorUsuario.delete(id);
  }

  recalcularEstadoUsuario(id);
}

function obtenerPayloadRegistro(payload) {
  if (typeof payload === "object" && payload !== null) {
    return {
      userId: payload.userId || payload.id || payload.usuarioId,
      deviceType: payload.deviceType || payload.dispositivo,
      userAgent: payload.userAgent,
    };
  }

  return {
    userId: payload,
    deviceType: "desktop",
    userAgent: "",
  };
}

function setEstadoManualUsuario(userId, estado) {
  const id = normalizarId(userId);
  if (!id) return null;

  const normalized = normalizarEstado(estado);
  if (["online", "desconectado"].includes(normalized)) {
    estadoManualPorUsuario.delete(id);
  } else {
    estadoManualPorUsuario.set(id, normalized);
  }

  const nextState = recalcularEstadoUsuario(id);
  if (ioGlobal) programarPublicarEstadoUsuarios(ioGlobal, { immediate: true });
  return nextState;
}

function getUsuariosConectados() {
  Object.keys(usuariosConectados).forEach((userId) => recalcularEstadoUsuario(userId));
  return usuariosConectados;
}

function initSocket(server) {
  const { Server } = require("socket.io");

  const io = new Server(server, {
    cors: {
      origin: validarSocketOrigin,
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

    const registrarUsuario = async (payload) => {
      const { userId: rawUserId, deviceType, userAgent } = obtenerPayloadRegistro(payload);
      const userId = normalizarId(rawUserId);
      if (!userId) return;

      if (socket.userId && socket.userId !== userId) {
        quitarSocketDeUsuario(socket.userId, socket.id);
      }

      socket.userId = userId;
      socket.deviceType = normalizarDispositivo(deviceType || socket.deviceType || socket.handshake.auth?.deviceType || socket.handshake.query?.deviceType);
      socket.userAgent = userAgent || socket.handshake.headers?.["user-agent"] || "";

      await unirUsuarioASusSalas(socket, userId);
      agregarSocketAUsuario(userId, socket.id, {
        deviceType: socket.deviceType,
        userAgent: socket.userAgent,
      });
      programarPublicarEstadoUsuarios(io, { immediate: true });
    };

    socket.on("registrarUsuario", registrarUsuario);

    socket.on("usuarioActividad", (payload = {}) => {
      if (!socket.userId) return;
      marcarActividadUsuario(socket.userId, socket.id, {
        deviceType: payload.deviceType || socket.deviceType,
        userAgent: payload.userAgent || socket.userAgent,
      });
      programarPublicarEstadoUsuarios(io);
    });

    socket.on("cambiarEstadoUsuario", (payload = {}) => {
      const targetUserId = normalizarId(payload.userId || socket.userId);
      if (!targetUserId || targetUserId !== socket.userId) return;
      setEstadoManualUsuario(targetUserId, payload.estado);
    });

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


    // Indicador de escritura tipo WhatsApp.
    // Se envía de forma dirigida y con rate limit para que no se sature cuando hay muchos usuarios conectados.
    socket.on("typing:start", (payload = {}) => iniciarTyping(io, socket, payload));
    socket.on("typing:stop", (payload = {}) => detenerTyping(io, socket, payload));

    socket.on("disconnect", (reason) => {
      console.log("🔴 Usuario desconectado:", socket.id, reason);

      detenerTypingDeSocket(io, socket);

      if (socket.userId) {
        quitarSocketDeUsuario(socket.userId, socket.id);
        programarPublicarEstadoUsuarios(io, { immediate: true });
      }
    });

    const userIdHandshake = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userIdHandshake) {
      registrarUsuario({
        userId: userIdHandshake,
        deviceType: socket.handshake.auth?.deviceType || socket.handshake.query?.deviceType,
        userAgent: socket.handshake.headers?.["user-agent"],
      });
    }
  });

  setInterval(() => publicarEstadoUsuarios(io), 30000);

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
  getUsuariosConectados,
  setEstadoManualUsuario,
};
