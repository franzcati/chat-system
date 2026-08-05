// frontend/src/socket.js
import { io } from "socket.io-client";
import { logDev } from "./utils/logger";

const socketUrl = import.meta.env.VITE_SOCKET_URL || "/";

const getDeviceType = () => {
  const userAgent = navigator.userAgent || "";
  const isTouch = navigator.maxTouchPoints && navigator.maxTouchPoints > 1;
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  return isMobileUA || isTouch ? "mobile" : "desktop";
};

const getPresencePayload = (userId) => ({
  userId,
  deviceType: getDeviceType(),
  userAgent: navigator.userAgent || "",
});



export const socket = io(socketUrl, {
  autoConnect: false,
  withCredentials: true,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

socket.on("connect", () => {
  logDev("✅ Conectado al servidor Socket.io con ID:", socket.id);
  // El servidor registra al usuario usando socket.auth durante el handshake.
  // No emitimos registrarUsuario otra vez para evitar registros y joins duplicados.
});

socket.on("disconnect", (reason) => {
  logDev("🔴 Socket desconectado:", reason);
});

socket.io.on("reconnect_attempt", (attempt) => {
  logDev("🔁 Reintentando conectar socket:", attempt);
});

socket.on("connect_error", (err) => {
  console.error("❌ Error de conexión con Socket.io:", err.message);
});

/**
 * ✅ Conecta y registra al usuario.
 * Se vuelve a registrar automáticamente en cada reconexión.
 */
export const conectarUsuarioSocket = (userId) => {
  if (!userId) return;

  const previousUserId = socket.auth?.userId || null;
  socket.auth = {
    ...(socket.auth || {}),
    userId,
    deviceType: getDeviceType(),
  };

  if (!socket.connected) {
    socket.connect();
    return;
  }

  if (previousUserId && String(previousUserId) !== String(userId)) {
    socket.emit("registrarUsuario", getPresencePayload(userId));
  }
};

export default socket;


export const emitirActividadUsuario = (userId) => {
  if (!userId || !socket.connected) return;
  socket.emit("usuarioActividad", getPresencePayload(userId));
};

export const cambiarEstadoPresenciaSocket = (userId, estado) => {
  if (!userId) return;
  if (socket.connected) {
    socket.emit("cambiarEstadoUsuario", { userId, estado });
  }
};
