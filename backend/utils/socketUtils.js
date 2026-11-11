const db = require("../db");
const { logDev } = require("./logger");
const {
  authenticateSocket,
} = require("./socketAuth");

let usuariosConectados = {};
let ioGlobal = null;
const socketsPorUsuario = new Map();
const detallesSocketsPorUsuario = new Map();
const estadoManualPorUsuario = new Map();
const instanciaPorUsuario = new Map();
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
  Object.keys(usuariosConectados).forEach(
    (userId) =>
      recalcularEstadoUsuario(userId)
  );

  const instanceIds = new Set(
    Array.from(
      instanciaPorUsuario.values()
    )
      .map(Number)
      .filter(
        (id) =>
          Number.isInteger(id) &&
          id > 0
      )
  );

  instanceIds.forEach((instanceId) => {
    const payload = {};

    Object.entries(
      usuariosConectados
    ).forEach(([userId, state]) => {
      if (
        Number(
          instanciaPorUsuario.get(
            String(userId)
          )
        ) === instanceId
      ) {
        payload[userId] = state;
      }
    });

    io.to(
      `instancia_${instanceId}`
    ).emit(
      "actualizarUsuarios",
      payload
    );
  });
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
    "http://chatvista.click",
    "https://chatvista.click",
    "http://www.chatvista.click",
    "https://www.chatvista.click",
    "http://chatquick.click",
    "https://chatquick.click",
    "http://www.chatquick.click",
    "https://www.chatquick.click",
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
  const senderId = normalizarId(
    socket.userId
  );
  if (!senderId) return null;

  const tipo = payload.tipo === "grupo" ? "grupo" : "privado";
  const grupoId = tipo === "grupo" ? normalizarId(payload.grupoId) : null;
  const receiverId = tipo === "privado" ? normalizarId(payload.receiverId) : null;

  if (tipo === "grupo" && !grupoId) return null;
  if (tipo === "privado" && !receiverId) return null;
  if (tipo === "privado" && receiverId === senderId) return null;

  if (
    tipo === "grupo" &&
    !socket.rooms.has(
      `grupo_${grupoId}`
    )
  ) {
    return null;
  }

  if (tipo === "privado") {
    const receiverInstance =
      Number(
        instanciaPorUsuario.get(
          String(receiverId)
        )
      );

    if (
      receiverInstance &&
      socket.instanceId &&
      receiverInstance !==
        Number(socket.instanceId)
    ) {
      return null;
    }
  }

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

async function unirUsuarioASusSalas(
  socket,
  userId,
  instanceId
) {
  socket.join(
    `usuario_${userId}`
  );

  socket.join(
    `instancia_${instanceId}`
  );

  try {
    const [grupos] = await db.query(
      `SELECT ug.grupo_id
       FROM usuario_grupo ug
       JOIN usuario u
         ON u.id = ug.usuario_id
       WHERE ug.usuario_id = ?
         AND u.instancia_id = ?`,
      [
        userId,
        instanceId,
      ]
    );

    grupos.forEach((g) => {
      socket.join(
        `grupo_${g.grupo_id}`
      );

      logDev(
        `✅ Usuario ${userId} unido a sala grupo_${g.grupo_id}`
      );
    });
  } catch (err) {
    console.error(
      "❌ Error obteniendo grupos del usuario:",
      err
    );
  }
}

function agregarSocketAUsuario(userId, socketId, meta = {}) {
  const id = normalizarId(userId);
  if (!id) return;

  const instanceId =
    Number(meta.instanceId);

  if (
    Number.isInteger(instanceId) &&
    instanceId > 0
  ) {
    instanciaPorUsuario.set(
      id,
      instanceId
    );
  }

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
    instanceId:
      Number(meta.instanceId) || null,
    connectedAt: Date.now(),
    lastActivity: Date.now(),
  });

  recalcularEstadoUsuario(id);
}

function marcarActividadUsuario(userId, socketId, meta = {}) {
  const id = normalizarId(userId);
  if (!id) return false;

  const detalles = detallesSocketsPorUsuario.get(id);
  const detalle = detalles?.get(socketId);
  if (!detalle) return false;

  const anterior = usuariosConectados[id];
  const firmaAnterior = anterior
    ? `${anterior.estado}|${anterior.dispositivo}|${JSON.stringify(anterior.dispositivos || {})}`
    : "";

  detalles.set(socketId, {
    ...detalle,
    deviceType: normalizarDispositivo(meta.deviceType || detalle.deviceType),
    userAgent: meta.userAgent || detalle.userAgent || "",
    lastActivity: Date.now(),
  });

  const siguiente = recalcularEstadoUsuario(id);
  const firmaSiguiente = siguiente
    ? `${siguiente.estado}|${siguiente.dispositivo}|${JSON.stringify(siguiente.dispositivos || {})}`
    : "";

  // La actividad normal no cambia el estado visible. Sólo hace falta emitir cuando
  // el usuario vuelve de inactivo o cambia de dispositivo/estado.
  return firmaAnterior !== firmaSiguiente;
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



// ========================= CALLS / WEBRTC SIGNALING =========================
const llamadasActivas = new Map();
const llamadaPorUsuario = new Map();
const CALL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function parseChatPermissions(value) {
  let parsed = value || {};
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed || "{}"); } catch { parsed = {}; }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function permissionOn(value) { return value === 1 || value === "1" || value === true || value === "true"; }

async function getCallUser(userId) {
  const [rows] = await db.query(
    `SELECT id, nombre, apellido, url_imagen, background, instancia_id, permisos_chat
       FROM usuario WHERE id=? AND estado='aprobado' LIMIT 1`,
    [Number(userId)]
  );
  return rows[0] || null;
}

function publicCallUser(row) {
  if (!row) return null;
  return { id: Number(row.id), nombre: `${row.nombre || ""} ${row.apellido || ""}`.trim() || "Usuario", url_imagen: row.url_imagen || null, background: row.background || null };
}

function userOnline(io, userId) {
  const room = io.sockets.adapter.rooms.get(`usuario_${Number(userId)}`);
  return Boolean(room && room.size > 0);
}

function emitToUser(io, userId, event, payload) { io.to(`usuario_${Number(userId)}`).emit(event, payload); }

function finishCall(io, session, reason = "ended") {
  if (!session) return;
  session.members.forEach((member) => {
    llamadaPorUsuario.delete(String(member));
    emitToUser(io, member, "call:ended", { callId: session.id, reason });
  });
  session.invited.forEach((member) => {
    llamadaPorUsuario.delete(String(member));
    emitToUser(io, member, "call:ended", { callId: session.id, reason });
  });
  llamadasActivas.delete(session.id);
}

function makeCallId() { return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`; }

// En WebRTC mesh, cada participante mantiene una conexión por interlocutor.
// Limitar el aforo evita invitar más personas de las que soporta la sala.
const CALL_MAX_PARTICIPANTS = 8;
const CALL_INVITATION_TIMEOUT_MS = 45000;

async function getCallInviteCandidates(io, session, inviterId) {
  const inviter = await getCallUser(inviterId);
  if (!inviter) return { error: "Tu cuenta no está disponible" };
  if (Number(inviter.instancia_id) !== Number(session.instanceId)) {
    return { error: "La llamada pertenece a otra instancia" };
  }

  let rows;
  if (session.chatType === "grupo") {
    const [roles] = await db.query(
      `SELECT rol FROM usuario_grupo WHERE grupo_id=? AND usuario_id=? LIMIT 1`,
      [session.groupId, inviterId]
    );
    if (!["admin", "propietario"].includes(String(roles[0]?.rol || ""))) {
      return { error: "Solo administradores y propietario pueden añadir miembros a la llamada grupal" };
    }
    [rows] = await db.query(
      `SELECT u.id,u.nombre,u.apellido,u.url_imagen,u.background,ug.rol
         FROM usuario_grupo ug
         JOIN usuario u ON u.id=ug.usuario_id
        WHERE ug.grupo_id=? AND u.estado='aprobado' AND u.instancia_id=?
        ORDER BY u.nombre,u.apellido,u.id`,
      [session.groupId, session.instanceId]
    );
  } else {
    if (Number(session.initiatorId) !== Number(inviterId)) {
      return { error: "Solo quien inició la llamada privada puede añadir participantes" };
    }
    // Misma regla de visibilidad que /api/grupos/:id/todos-usuarios:
    // cuenta aprobada, misma instancia y al menos un proyecto compartido.
    [rows] = await db.query(
      `SELECT DISTINCT u.id,u.nombre,u.apellido,u.url_imagen,u.background
         FROM usuario u
         JOIN usuario_proyecto up ON up.usuario_id=u.id
        WHERE up.proyecto_id IN
              (SELECT proyecto_id FROM usuario_proyecto WHERE usuario_id=?)
          AND u.instancia_id=? AND u.estado='aprobado'
        ORDER BY u.nombre,u.apellido,u.id`,
      [inviterId, session.instanceId]
    );
  }
  const excluded = new Set([...session.members, ...session.invited].map(Number));
  const candidates = rows
    .filter(row => !excluded.has(Number(row.id)))
    .map((row) => {
      const online = userOnline(io, row.id);
      return {
        ...publicCallUser(row),
        online,
        estado: online ? "Disponible" : "Desconectado",
        canInvite: session.chatType === "grupo" && ["admin", "propietario"].includes(String(row.rol || "")),
      };
    })
    .sort((a, b) => {
      if (Boolean(b.online) !== Boolean(a.online)) return Number(Boolean(b.online)) - Number(Boolean(a.online));
      return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" });
    });

  return { candidates };
}

async function getCallParticipants(session) {
  const ids = [...new Set([...session.members, ...session.invited])];
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT id,nombre,apellido,url_imagen,background FROM usuario WHERE id IN (?)`, [ids]
  );
  return rows.map(publicCallUser);
}

function windowlessInviteTimeout(io, callId, targetId) {
  const timer = setTimeout(async () => {
    const session = llamadasActivas.get(callId);
    if (!session || !session.invited.has(targetId)) return;
    session.invited.delete(targetId);
    llamadaPorUsuario.delete(String(targetId));
    emitToUser(io, targetId, "call:ended", { callId, reason: "timeout" });
    session.members.forEach(member => emitToUser(io, member, "call:rejected", {
      callId, userId: targetId, reason: "timeout",
    }));
    try { await broadcastCallParticipants(io, session); } catch (error) { console.error("Error sincronizando participantes:", error); }
  }, CALL_INVITATION_TIMEOUT_MS);
  timer.unref?.();
}

async function broadcastCallParticipants(io, session) {
  const participants = await getCallParticipants(session);
  session.members.forEach(member => emitToUser(io, member, "call:participants", {
    callId: session.id, participants,
  }));
  return participants;
}


function setupCallSignaling(io, socket) {
  socket.on("call:start", async (payload = {}, ack = () => {}) => {
    try {
      const callerId = Number(socket.userId);
      const kind = payload.kind === "video" ? "video" : "audio";
      const permissionKey = kind === "video" ? "realizar_videollamadas" : "realizar_llamadas";
      const caller = await getCallUser(callerId);
      if (!caller) return ack({ ok: false, error: "Usuario no disponible" });
      const permissions = parseChatPermissions(caller.permisos_chat);
      if (!permissionOn(permissions[permissionKey])) return ack({ ok: false, error: kind === "video" ? "No tienes permiso para realizar videollamadas" : "No tienes permiso para realizar llamadas" });
      if (llamadaPorUsuario.has(String(callerId))) return ack({ ok: false, error: "Ya tienes una llamada en curso" });

      let invited = [];
      let title = "Llamada";
      let groupMemberRoles = new Map();
      const chatType = payload.chatType === "grupo" ? "grupo" : "privado";
      let groupId = null;
      if (chatType === "grupo") {
        groupId = Number(payload.groupId);
        const [roleRows] = await db.query(`SELECT ug.rol, g.nombre FROM usuario_grupo ug JOIN grupos g ON g.id=ug.grupo_id WHERE ug.grupo_id=? AND ug.usuario_id=? LIMIT 1`, [groupId, callerId]);
        if (!roleRows.length || !["admin", "propietario"].includes(String(roleRows[0].rol))) return ack({ ok: false, error: "Solo administradores y propietario pueden iniciar llamadas grupales" });
        title = roleRows[0].nombre || "Llamada grupal";
        const [memberRows] = await db.query(`SELECT ug.usuario_id AS id, ug.rol FROM usuario_grupo ug JOIN usuario u ON u.id=ug.usuario_id WHERE ug.grupo_id=? AND ug.usuario_id<>? AND u.estado='aprobado' AND u.instancia_id=?`, [groupId, callerId, caller.instancia_id]);
        groupMemberRoles = new Map(memberRows.map(row => [Number(row.id), String(row.rol)]));
        // La reunión grupal puede empezar con el organizador solamente.
        // Si hay usuarios conectados, se les llama al crearla; si no,
        // el propietario/admin podrá abrir el selector y añadirlos después.
        invited = memberRows.map((r) => Number(r.id)).filter((id) => userOnline(io, id) && !llamadaPorUsuario.has(String(id))).slice(0, CALL_MAX_PARTICIPANTS - 1);
      } else {
        const targetId = Number(payload.targetUserId);
        if (!targetId || targetId === callerId) return ack({ ok: false, error: "Destino de llamada inválido" });
        const target = await getCallUser(targetId);
        if (!target || Number(target.instancia_id) !== Number(caller.instancia_id)) return ack({ ok: false, error: "El usuario no está disponible" });
        if (!userOnline(io, targetId)) return ack({ ok: false, error: "El usuario está desconectado" });
        if (llamadaPorUsuario.has(String(targetId))) return ack({ ok: false, error: "El usuario está ocupado" });
        invited = [targetId]; title = publicCallUser(target)?.nombre || "Llamada";
      }

      const callId = makeCallId();
      const session = { id: callId, kind, chatType, groupId, title, instanceId: Number(caller.instancia_id), initiatorId: callerId, invited: new Set(invited), members: new Set([callerId]), screenShares: new Map(), createdAt: Date.now() };
      llamadasActivas.set(callId, session);
      llamadaPorUsuario.set(String(callerId), callId);
      invited.forEach((id) => llamadaPorUsuario.set(String(id), callId));
      const callerPublic = publicCallUser(caller);
      const [participantRows] = await db.query(`SELECT id,nombre,apellido,url_imagen,background FROM usuario WHERE id IN (?)`, [[callerId, ...invited]]);
      const participants = participantRows.map(publicCallUser);
      // Cada invitado ve el botón solo si tiene rol de administración del grupo.
      invited.forEach((id) => emitToUser(io, id, "call:incoming", {
        callId, kind, chatType, groupId, title: chatType === "privado" ? callerPublic.nombre : title,
        caller: callerPublic, initiatorId: callerId, participants,
        canInvite: chatType === "grupo" && ["admin", "propietario"].includes(groupMemberRoles.get(id)),
      }));
      ack({ ok: true, callId, title, participants, invitedCount: invited.length, canInvite: true });
      invited.forEach(id => windowlessInviteTimeout(io, callId, id));
    } catch (error) {
      console.error("❌ Error iniciando llamada:", error);
      ack({ ok: false, error: "No se pudo iniciar la llamada" });
    }
  });

  // Los candidatos proceden exclusivamente del servidor. No se permite
  // enumerar usuarios de otros proyectos, instancias o grupos por Socket.IO.
  socket.on("call:invite-candidates", async ({ callId } = {}, ack = () => {}) => {
    try {
      const session = llamadasActivas.get(String(callId));
      const inviterId = Number(socket.userId);
      if (!session || !session.members.has(inviterId)) {
        return ack({ ok: false, error: "La llamada ya no está disponible" });
      }
      const result = await getCallInviteCandidates(io, session, inviterId);
      if (result.error) return ack({ ok: false, error: result.error });
      ack({ ok: true, candidates: result.candidates, capacity: CALL_MAX_PARTICIPANTS - session.members.size - session.invited.size });
    } catch (error) {
      console.error("Error consultando candidatos de llamada:", error);
      ack({ ok: false, error: "No se pudieron cargar los contactos" });
    }
  });

  socket.on("call:invite", async ({ callId, targetUserId } = {}, ack = () => {}) => {
    try {
      const session = llamadasActivas.get(String(callId));
      const inviterId = Number(socket.userId);
      const targetId = Number(targetUserId);
      if (!session || !session.members.has(inviterId)) return ack({ ok: false, error: "Llamada no disponible" });
      if (!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === inviterId) {
        return ack({ ok: false, error: "Usuario inválido" });
      }
      const inviter = await getCallUser(inviterId);
      const key = session.kind === "video" ? "realizar_videollamadas" : "realizar_llamadas";
      if (!permissionOn(parseChatPermissions(inviter?.permisos_chat)[key])) {
        return ack({ ok: false, error: "No tienes permiso para invitar a esta llamada" });
      }
      const result = await getCallInviteCandidates(io, session, inviterId);
      if (result.error) return ack({ ok: false, error: result.error });
      const candidate = result.candidates.find(person => Number(person.id) === targetId);
      if (!candidate) return ack({ ok: false, error: "No puedes invitar a este usuario o ya participa" });
      if (!candidate.online) return ack({ ok: false, error: "El usuario está desconectado" });
      if (llamadaPorUsuario.has(String(targetId))) return ack({ ok: false, error: "El usuario está ocupado" });
      if (session.members.size + session.invited.size >= CALL_MAX_PARTICIPANTS) {
        return ack({ ok: false, error: "La llamada ha alcanzado el máximo de participantes" });
      }
      session.invited.add(targetId);
      llamadaPorUsuario.set(String(targetId), session.id);
      const inviterPublic = publicCallUser(inviter);
      let participants;
      try { participants = await broadcastCallParticipants(io, session); }
      catch (error) {
        session.invited.delete(targetId);
        llamadaPorUsuario.delete(String(targetId));
        throw error;
      }
      emitToUser(io, targetId, "call:incoming", {
        callId: session.id, kind: session.kind, chatType: session.chatType,
        groupId: session.groupId, title: session.title,
        caller: inviterPublic, invitedBy: inviterPublic, addedToCall: true,
        initiatorId: session.initiatorId, participants, canInvite: Boolean(candidate.canInvite),
      });
      ack({ ok: true, invited: candidate });
      windowlessInviteTimeout(io, session.id, targetId);
    } catch (error) {
      console.error("Error invitando a llamada:", error);
      ack({ ok: false, error: "No se pudo enviar la invitación" });
    }
  });

  socket.on("call:accept", async ({ callId } = {}, ack = () => {}) => {
    const session = llamadasActivas.get(String(callId));
    const userId = Number(socket.userId);
    if (!session || !session.invited.has(userId)) return ack({ ok: false, error: "La llamada ya no está disponible" });
    session.invited.delete(userId);
    const existing = Array.from(session.members);
    session.members.add(userId);
    for (const peerId of existing) {
      emitToUser(io, peerId, "call:peer-ready", { callId: session.id, peerUserId: userId, shouldOffer: true });
      emitToUser(io, userId, "call:peer-ready", { callId: session.id, peerUserId: peerId, shouldOffer: false });
    }
    try { await broadcastCallParticipants(io, session); }
    catch (error) { console.error("Error sincronizando participantes:", error); }
    if (session.screenShares instanceof Map) {
      session.screenShares.forEach((share, ownerUserId) => emitToUser(io, userId, "call:screen-available", {
        callId: session.id,
        ownerUserId: Number(ownerUserId),
        sourceType: share.sourceType,
        label: share.label,
        streamId: share.streamId,
      }));
    }
    ack({ ok: true });
  });

  socket.on("call:reject", async ({ callId, reason = "rejected" } = {}) => {
    const session = llamadasActivas.get(String(callId));
    const userId = Number(socket.userId);
    if (!session || !session.invited.has(userId)) return;
    session.invited.delete(userId); llamadaPorUsuario.delete(String(userId));
    session.members.forEach((member) => emitToUser(io, member, "call:rejected", { callId: session.id, userId, reason }));
    // Rechazar una invitación adicional no debe colgar a quienes ya conversan.
    // En privado, rechazar la única invitación termina la llamada inicial.
    // En grupo, el organizador conserva la reunión abierta para poder invitar
    // otros miembros aunque todas las llamadas iniciales sean rechazadas.
    if (session.chatType === "privado" && session.invited.size === 0 && session.members.size <= 1) finishCall(io, session, "rejected");
    else { try { await broadcastCallParticipants(io, session); } catch (error) { console.error("Error sincronizando participantes:", error); } }
  });

  socket.on("call:upgrade-video", async ({ callId } = {}, ack = () => {}) => {
    try {
      const session = llamadasActivas.get(String(callId));
      const userId = Number(socket.userId);
      if (!session || !session.members.has(userId)) return ack({ ok: false, error: "La llamada ya no está disponible" });
      if (session.chatType === "grupo" && Number(session.initiatorId) !== userId) {
        return ack({ ok: false, error: "Solo quien inició la llamada grupal puede cambiarla a videollamada" });
      }

      const userRow = await getCallUser(userId);
      const permissions = parseChatPermissions(userRow?.permisos_chat);
      if (!permissionOn(permissions.realizar_videollamadas)) {
        return ack({ ok: false, error: "No tienes permiso para realizar videollamadas" });
      }

      session.kind = "video";
      const recipients = new Set([...session.members, ...session.invited]);
      recipients.forEach((member) => emitToUser(io, member, "call:upgraded-video", {
        callId: session.id,
        byUserId: userId,
      }));
      ack({ ok: true });
    } catch (error) {
      console.error("❌ Error cambiando llamada a video:", error);
      ack({ ok: false, error: "No se pudo cambiar a videollamada" });
    }
  });

  socket.on("call:media-state", ({ callId, micMuted = false, deafened = false, cameraEnabled = false } = {}) => {
    const session = llamadasActivas.get(String(callId));
    const userId = Number(socket.userId);
    if (!session || !session.members.has(userId)) return;
    const payload = {
      callId: session.id,
      userId,
      micMuted: Boolean(micMuted),
      deafened: Boolean(deafened),
      cameraEnabled: Boolean(cameraEnabled),
    };
    session.members.forEach((member) => {
      if (Number(member) !== userId) emitToUser(io, member, "call:media-state", payload);
    });
  });


  socket.on("call:screen-start", ({ callId, sourceType = "applications", label = "Pantalla", streamId = "" } = {}, ack = () => {}) => {
    const session = llamadasActivas.get(String(callId));
    const userId = Number(socket.userId);
    if (!session || !session.members.has(userId)) return ack({ ok: false, error: "La llamada ya no está disponible" });
    if (!(session.screenShares instanceof Map)) session.screenShares = new Map();
    session.screenShares.set(userId, { sourceType, label: String(label || "Pantalla").slice(0, 160), streamId: String(streamId || ""), watchers: new Set() });
    session.members.forEach((member) => emitToUser(io, member, "call:screen-available", {
      callId: session.id,
      ownerUserId: userId,
      sourceType,
      label: String(label || "Pantalla").slice(0, 160),
      streamId: String(streamId || ""),
    }));
    ack({ ok: true });
  });

  socket.on("call:screen-watch", ({ callId, ownerUserId, watching = true } = {}, ack = () => {}) => {
    const session = llamadasActivas.get(String(callId));
    const viewerUserId = Number(socket.userId);
    const ownerId = Number(ownerUserId);
    if (!session || !session.members.has(viewerUserId)) return ack({ ok: false, error: "La llamada ya no está disponible" });
    const share = session.screenShares instanceof Map ? session.screenShares.get(ownerId) : null;
    if (!share || !session.members.has(ownerId)) return ack({ ok: false, error: "La transmisión ya no está disponible" });
    if (!(share.watchers instanceof Set)) share.watchers = new Set();
    if (watching) share.watchers.add(viewerUserId); else share.watchers.delete(viewerUserId);
    emitToUser(io, ownerId, "call:screen-viewer", { callId: session.id, viewerUserId, watching: Boolean(watching), count: share.watchers.size });
    session.members.forEach((member) => emitToUser(io, member, "call:screen-viewer-count", { callId: session.id, ownerUserId: ownerId, count: share.watchers.size }));
    ack({ ok: true, count: share.watchers.size });
  });

  socket.on("call:screen-stop", ({ callId } = {}) => {
    const session = llamadasActivas.get(String(callId));
    const ownerId = Number(socket.userId);
    if (!session || !session.members.has(ownerId) || !(session.screenShares instanceof Map)) return;
    const share = session.screenShares.get(ownerId);
    if (!share) return;
    session.screenShares.delete(ownerId);
    session.members.forEach((member) => emitToUser(io, member, "call:screen-stopped", { callId: session.id, ownerUserId: ownerId }));
  });

  const relay = (event) => socket.on(event, (payload = {}) => {
    const session = llamadasActivas.get(String(payload.callId));
    const fromUserId = Number(socket.userId); const toUserId = Number(payload.toUserId);
    if (!session || !session.members.has(fromUserId) || !session.members.has(toUserId)) return;
    const forwarded = { callId: session.id, fromUserId };
    if (event === "call:offer" || event === "call:answer") forwarded.sdp = payload.sdp;
    if (event === "call:ice") forwarded.candidate = payload.candidate;
    emitToUser(io, toUserId, event, forwarded);
  });
  relay("call:offer"); relay("call:answer"); relay("call:ice");

  socket.on("call:leave", ({ callId, reason = "hangup" } = {}) => {
    const session = llamadasActivas.get(String(callId)); const userId = Number(socket.userId);
    if (!session || (!session.members.has(userId) && !session.invited.has(userId))) return;
    if (session.screenShares instanceof Map) {
      if (session.screenShares.has(userId)) {
        session.screenShares.delete(userId);
        session.members.forEach((member) => emitToUser(io, member, "call:screen-stopped", { callId: session.id, ownerUserId: userId }));
      }
      session.screenShares.forEach((share, ownerId) => {
        if (share.watchers instanceof Set && share.watchers.delete(userId)) {
          emitToUser(io, ownerId, "call:screen-viewer", { callId: session.id, viewerUserId: userId, watching: false, count: share.watchers.size });
          session.members.forEach((member) => emitToUser(io, member, "call:screen-viewer-count", { callId: session.id, ownerUserId: Number(ownerId), count: share.watchers.size }));
        }
      });
    }
    session.members.delete(userId); session.invited.delete(userId); llamadaPorUsuario.delete(String(userId));
    session.members.forEach((member) => emitToUser(io, member, "call:participant-left", { callId: session.id, userId, reason }));
    // En reuniones grupales, la salida del organizador no cuelga al resto.
    // Se cierra cuando se retira el último participante conectado.
    if (session.chatType === "grupo" ? session.members.size === 0 : (userId === session.initiatorId || (session.members.size <= 1 && session.invited.size === 0))) {
      finishCall(io, session, reason);
    } else {
      broadcastCallParticipants(io, session).catch(error => console.error("Error sincronizando participantes:", error));
    }
  });
}

function cleanupCallsForUser(io, userId) {
  const callId = llamadaPorUsuario.get(String(userId));
  if (!callId) return;
  const session = llamadasActivas.get(callId);
  if (!session) { llamadaPorUsuario.delete(String(userId)); return; }
  if (session.screenShares instanceof Map) {
    if (session.screenShares.has(Number(userId))) {
      session.screenShares.delete(Number(userId));
      session.members.forEach((member) => emitToUser(io, member, "call:screen-stopped", { callId, ownerUserId: Number(userId) }));
    }
    session.screenShares.forEach((share, ownerId) => {
      if (share.watchers instanceof Set && share.watchers.delete(Number(userId))) {
        emitToUser(io, ownerId, "call:screen-viewer", { callId, viewerUserId: Number(userId), watching: false, count: share.watchers.size });
      }
    });
  }
  session.members.delete(Number(userId)); session.invited.delete(Number(userId)); llamadaPorUsuario.delete(String(userId));
  session.members.forEach((member) => emitToUser(io, member, "call:participant-left", { callId, userId: Number(userId), reason: "disconnect" }));
  if (session.chatType === "grupo" ? session.members.size === 0 : (Number(userId) === session.initiatorId || session.members.size <= 1)) {
    finishCall(io, session, "disconnect");
  } else {
    broadcastCallParticipants(io, session).catch(error => console.error("Error sincronizando participantes:", error));
  }
}

setInterval(() => {
  const now = Date.now();
  if (!ioGlobal) return;
  for (const session of llamadasActivas.values()) if (now - session.createdAt > CALL_MAX_AGE_MS) finishCall(ioGlobal, session, "timeout");
}, 60000).unref?.();

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

  io.use(async (socket, next) => {
    try {
      const auth =
        await authenticateSocket(
          socket
        );

      socket.data.auth = auth;
      socket.userId = normalizarId(
        auth.userId
      );
      socket.instanceId =
        Number(auth.instanceId);
      socket.portalCode =
        auth.portalCode;

      next();
    } catch (error) {
      console.warn(
        "⚠️ Socket rechazado:",
        error?.code ||
          error?.message
      );

      const socketError =
        new Error(
          "SOCKET_AUTH_REQUIRED"
        );

      socketError.data = {
        code:
          error?.code ||
          "SOCKET_AUTH_REQUIRED",
        message:
          "Debes iniciar sesion nuevamente",
      };

      next(socketError);
    }
  });

  io.on("connection", (socket) => {
    logDev("🔌 Usuario conectado:", socket.id);

    const registrarUsuario = async (payload) => {
      const {
        deviceType,
        userAgent,
      } = obtenerPayloadRegistro(
        payload
      );

      const userId = normalizarId(
        socket.data?.auth?.userId ||
          socket.userId
      );

      const instanceId = Number(
        socket.data?.auth
          ?.instanceId ||
          socket.instanceId
      );

      if (
        !userId ||
        !Number.isInteger(
          instanceId
        ) ||
        instanceId <= 0
      ) {
        return;
      }

      // El frontend puede disparar el registro desde el handshake y desde el evento
      // connect casi simultáneamente. Unificamos esas llamadas para no consultar grupos
      // ni unir salas tres veces por cada reconexión.
      if (socket.data?.registeredUserId === userId) {
        marcarActividadUsuario(userId, socket.id, {
          deviceType: deviceType || socket.deviceType,
          userAgent: userAgent || socket.userAgent,
        });
        return;
      }

      if (socket.data?.registrationUserId === userId && socket.data?.registrationPromise) {
        return socket.data.registrationPromise;
      }

      const registrationTask = (async () => {
        if (socket.userId && socket.userId !== userId) {
          quitarSocketDeUsuario(socket.userId, socket.id);
        }

        socket.userId = userId;
        socket.deviceType = normalizarDispositivo(
          deviceType || socket.deviceType || socket.handshake.auth?.deviceType || socket.handshake.query?.deviceType
        );
        socket.userAgent = userAgent || socket.handshake.headers?.["user-agent"] || "";

        await unirUsuarioASusSalas(
          socket,
          userId,
          instanceId
        );

        agregarSocketAUsuario(
          userId,
          socket.id,
          {
            deviceType:
              socket.deviceType,
            userAgent:
              socket.userAgent,
            instanceId,
          }
        );
        socket.data.registeredUserId = userId;
        programarPublicarEstadoUsuarios(io, { immediate: true });
      })();

      socket.data.registrationUserId = userId;
      socket.data.registrationPromise = registrationTask;

      try {
        return await registrationTask;
      } finally {
        if (socket.data.registrationPromise === registrationTask) {
          socket.data.registrationPromise = null;
          socket.data.registrationUserId = null;
        }
      }
    };

    socket.on("registrarUsuario", (payload) => {
      registrarUsuario(payload).catch((err) => {
        console.error("❌ Error registrando usuario en Socket.IO:", err);
      });
    });

    socket.on("usuarioActividad", (payload = {}) => {
      if (!socket.userId) return;
      const estadoVisibleCambio = marcarActividadUsuario(socket.userId, socket.id, {
        deviceType: payload.deviceType || socket.deviceType,
        userAgent: payload.userAgent || socket.userAgent,
      });
      if (estadoVisibleCambio) {
        programarPublicarEstadoUsuarios(io, { immediate: true });
      }
    });

    socket.on("cambiarEstadoUsuario", (payload = {}) => {
      const targetUserId = normalizarId(payload.userId || socket.userId);
      if (!targetUserId || targetUserId !== socket.userId) return;
      setEstadoManualUsuario(targetUserId, payload.estado);
    });

    socket.on(
      "joinGrupo",
      async (grupoId) => {
        const id =
          normalizarId(grupoId);

        if (
          !id ||
          !socket.userId ||
          !socket.instanceId
        ) {
          return;
        }

        const room =
          `grupo_${id}`;

        if (
          socket.rooms.has(room)
        ) {
          return;
        }

        try {
          const [rows] =
            await db.query(
              `SELECT 1
               FROM usuario_grupo ug
               JOIN usuario u
                 ON u.id = ug.usuario_id
               WHERE ug.grupo_id = ?
                 AND ug.usuario_id = ?
                 AND u.instancia_id = ?
               LIMIT 1`,
              [
                id,
                socket.userId,
                socket.instanceId,
              ]
            );

          if (!rows.length) {
            console.warn(
              `⚠️ Join de grupo rechazado: usuario ${socket.userId}, grupo ${id}`
            );
            return;
          }

          socket.join(room);

          logDev(
            `✅ Socket ${socket.id} unido manualmente a ${room}`
          );
        } catch (error) {
          console.error(
            "❌ Error validando joinGrupo:",
            error
          );
        }
      }
    );

    // Los sockets se unen a todos sus grupos al registrarse. Cambiar de conversación
    // no debe sacarlos de la sala, porque dejarían de recibir nuevos mensajes y sus
    // contadores. Se conserva el evento por compatibilidad con frontends antiguos.
    socket.on("leaveGrupo", () => {});


    setupCallSignaling(io, socket);

    // Indicador de escritura tipo WhatsApp.
    // Se envía de forma dirigida y con rate limit para que no se sature cuando hay muchos usuarios conectados.
    socket.on("typing:start", (payload = {}) => iniciarTyping(io, socket, payload));
    socket.on("typing:stop", (payload = {}) => detenerTyping(io, socket, payload));

    socket.on("disconnect", (reason) => {
      logDev("🔴 Usuario desconectado:", socket.id, reason);

      detenerTypingDeSocket(io, socket);

      if (socket.userId) {
        const remainingSockets = (socketsPorUsuario.get(String(socket.userId)) || new Set()).size;
        if (remainingSockets <= 1) cleanupCallsForUser(io, socket.userId);
        quitarSocketDeUsuario(socket.userId, socket.id);
        programarPublicarEstadoUsuarios(io, { immediate: true });
      }
    });

    registrarUsuario({
      deviceType:
        socket.handshake.auth
          ?.deviceType ||
        socket.handshake.query
          ?.deviceType,
      userAgent:
        socket.handshake.headers
          ?.["user-agent"],
    }).catch((err) => {
      console.error(
        "❌ Error registrando usuario desde sesion:",
        err
      );

      socket.disconnect(true);
    });
  });

  const presenceInterval = setInterval(() => publicarEstadoUsuarios(io), 30000);
  presenceInterval.unref?.();

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

async function unirUsuarioAGrupo(
  userId,
  grupoId
) {
  if (!ioGlobal) return false;

  const uid = normalizarId(userId);
  const gid = normalizarId(grupoId);

  if (!uid || !gid) return false;

  const socketIds = Array.from(
    socketsPorUsuario.get(uid) || []
  );

  let unidos = 0;

  for (const socketId of socketIds) {
    const socket =
      ioGlobal.sockets.sockets.get(
        socketId
      );

    if (!socket) continue;

    await socket.join(
      `grupo_${gid}`
    );

    unidos += 1;
  }

  return unidos > 0;
}

async function sacarUsuarioDeGrupo(
  userId,
  grupoId
) {
  if (!ioGlobal) return false;

  const uid = normalizarId(userId);
  const gid = normalizarId(grupoId);

  if (!uid || !gid) return false;

  const socketIds = Array.from(
    socketsPorUsuario.get(uid) || []
  );

  let removidos = 0;

  for (const socketId of socketIds) {
    const socket =
      ioGlobal.sockets.sockets.get(
        socketId
      );

    if (!socket) continue;

    await socket.leave(
      `grupo_${gid}`
    );

    removidos += 1;
  }

  return removidos > 0;
}

module.exports = {
  initSocket,
  enviarEventoAlUsuario,
  enviarEventoASala,
  getUsuariosConectados,
  setEstadoManualUsuario,
  unirUsuarioAGrupo,
  sacarUsuarioDeGrupo,
};
