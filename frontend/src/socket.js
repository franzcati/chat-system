// frontend/src/socket.js
import { io } from "socket.io-client";
import { logDev } from "./utils/logger";

export const socket = io("/", {
  autoConnect: false,
  withCredentials: true,
  transports: ["websocket"],
});

socket.on("connect", () => {
  logDev("✅ Conectado al servidor Socket.io con ID:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("❌ Error de conexión con Socket.io:", err.message);
});

/**
 * ✅ Función para conectar el usuario solo una vez
 */
export const conectarUsuarioSocket = (userId) => {
  if (!socket.connected) socket.connect();
  socket.emit("registrarUsuario", userId);
  logDev("📡 Usuario registrado en socket:", userId);
};

export default socket;