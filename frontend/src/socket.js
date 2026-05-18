// frontend/src/socket.js
import { io } from "socket.io-client";
import { logDev } from "./utils/logger";

const socketUrl = import.meta.env.VITE_SOCKET_URL || "/";

const getStoredUserId = () => {
  try {
    const storedUser = localStorage.getItem("usuario");
    if (!storedUser) return null;

    const user = JSON.parse(storedUser);
    return user?.id || null;
  } catch (error) {
    return null;
  }
};

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

  const userId = socket.auth?.userId || getStoredUserId();
  if (userId) {
    socket.emit("registrarUsuario", userId);
    logDev("📡 Usuario registrado/reconectado en socket:", userId);
  }
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

  socket.auth = {
    ...(socket.auth || {}),
    userId,
  };

  if (!socket.connected) {
    socket.connect();
    return;
  }

  socket.emit("registrarUsuario", userId);
  logDev("📡 Usuario registrado en socket:", userId);
};

export default socket;
