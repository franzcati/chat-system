// src/components/ChatBody.jsx
import React, { useMemo, useEffect, useState, useRef } from "react";
import { formatChatTimeOnly, formatChatDate, toLocalDate } from "../utils/date";
import Message from "./Message";

const ChatBody = ({ messages: initialMessages, user, endRef, socket, tipo, onVerPerfil }) => {
  const [messages, setMessages] = useState(initialMessages);
  const esGrupo = tipo === "grupo";

  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);

  // ==============================
  // 🔹 Sincroniza si el padre cambia los mensajes
  // ==============================
  useEffect(() => {
    if (!initialMessages) {
      console.log("⚠️ initialMessages está vacío o undefined");
      return;
    }

    console.log("📥 Recibiendo mensajes iniciales:", initialMessages);

    // Se asignan tal cual, sin convertir la fecha aún
    setMessages(initialMessages);

    console.log("✅ Mensajes seteados en estado `messages`");
  }, [initialMessages]);
  

  // ==============================
  // 🔹 Scroll inteligente al final
  // ==============================

  const prevMessagesLength = useRef(0);

  // Detecta si el usuario está cerca del fondo
  const isNearBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
  };

  // Hace scroll al fondo
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  };

  // Cuando llegan nuevos mensajes
  useEffect(() => {
    if (
      messages.length > prevMessagesLength.current && // solo si hay más mensajes
      isNearBottom()
    ) {
      scrollToBottom();
    }
    prevMessagesLength.current = messages.length; // actualiza referencia
  }, [messages]);

  // Cuando se cambia de chat (grupo o privado)
  useEffect(() => {
    setTimeout(() => scrollToBottom(false), 150);
    prevMessagesLength.current = 0; // resetea longitud anterior al cambiar de chat
  }, [tipo]);

  // ==============================
  // 🔹 Agrupar mensajes por fecha
  // ==============================
  const groups = useMemo(() => {
    const map = new Map();

    for (const m of messages) {
      const d = m.fecha_envio instanceof Date ? m.fecha_envio : new Date(m.fecha_envio);

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, { date: d, items: [] });
      map.get(key).items.push(m);
    }

    return Array.from(map.values());
  }, [messages]);

  
  return (
    <div
      ref={chatContainerRef}
      className="chat-body-inner py-6 py-lg-12 hide-scrollbar overflow-auto"
    >
      {groups.map(({ date, items }) => (
        <div className="date-group" key={date.toISOString()}>
          {/* Cabecera sticky de fecha */}
          <div className="date-sticky-wrapper">
            <span className="date-chip">{formatChatDate(date)}</span> {/* 👈 ahora con helper */}
          </div>

          {/* Mensajes del día */}
          {items.map((msg) => {
            const usuario = esGrupo
              ? { 
                  id: msg.usuario_id,
                  nombre: msg.nombre || "Usuario",
                  apellido: msg.apellido || "",
                  url_imagen: msg.url_imagen || null,   // 👈 aquí
                  correo: msg.correo || "",             // 👈 aquí
                  background: msg.background || "#6c757d",
                }
              : {
                  id: msg.usuario_envia_id,
                  nombre: msg.emisor_nombre || "Usuario",
                  apellido: msg.emisor_apellido || "",
                  url_imagen: msg.emisor_avatar || null,
                  correo: msg.emisor_correo || "",       // 👈 aquí
                  background: msg.emisor_background || "#6c757d",
                };

            const enviadoPorMi = esGrupo
              ? msg.usuario_id === user.id
              : msg.usuario_envia_id === user.id;
            // 🔹 Aquí agregas tu log
            //console.log("Raw Date del mensaje:", new Date(msg.fecha_envio));
            //console.log("Hora local del mensaje:", formatChatTimeOnly(new Date(msg.fecha_envio)));

            return (
              <Message
                key={msg.id}
                id={msg.id}
                mensaje={msg}   // 👈 ahora mandas el objeto completo
                hora={formatChatTimeOnly(new Date(msg.fecha_envio))}
                enviadoPorMi={enviadoPorMi}
                usuario={usuario}
                miUsuario={user}
                reacciones={msg.reacciones || []}
                esGrupo={esGrupo}   // 👈 se lo pasamos
                onVerPerfil={onVerPerfil}   // 👈 usamos la prop que viene de ChatBox
              />
            );
          })}
        </div>
      ))}

      {/* 👇 Ancla invisible para el autoscroll */}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatBody;