import React, { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext();
export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ user, children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

     // 🔹 Usar URL relativa para que funcione con proxy de Vite o producción
    const socketUrl = import.meta.env.VITE_SOCKET_URL || ""; 
    // Si usas Vite, puedes poner en .env: VITE_SOCKET_URL=/ (o /api/socket)

    const newSocket = io(socketUrl, {
      query: { userId: user.id },
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      console.log("🟢 Socket conectado:", newSocket.id, "Usuario:", user.email);
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
      console.log("🔴 Socket desconectado");
    });

    return () => {
      // 🔹 Desconectar socket anterior al cambiar de usuario o salir
      newSocket.disconnect();
      setIsConnected(false);
      console.log("⚪ Socket limpiado");
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};