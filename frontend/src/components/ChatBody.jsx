// src/components/ChatBody.jsx
import React, { useMemo, useEffect, useRef } from "react";
import { formatChatTimeOnly, formatChatDate } from "../utils/date";
import Message from "./Message";

// Detecta si un mensaje es de imagen (url o mimetype)
const esMensajeImagen = (m) => {
  if (!m) return false;

  const mime = m.tipo_archivo || "";
  if (mime.startsWith("image/")) return true;

  const url = m.archivo_url || m.mensaje || "";
  return /\.(png|jpe?g|gif|webp)$/i.test(url);
};

/**
 * 🔙 Fallback: agrupar SOLO por tiempo cuando NO hay lote_id
 * - Junta imágenes consecutivas del mismo usuario en <= 60s
 * - El texto SIEMPRE sale como mensaje aparte (nunca caption aquí)
 */
const agruparImagenesPorTiempo = (items) => {
  const resultado = [];
  const MAX_DIFF_MS = 60 * 1000; // 60 segundos

  let grupo = null;

  const flushGrupo = () => {
    if (!grupo) return;
    const base = grupo.imagenes[0];

    resultado.push({
      ...base,
      imagenes: grupo.imagenes.map((m) => m.archivo_url || m.mensaje),
      // en este modo NO hay caption
      mensaje: base.mensaje || "",
    });

    grupo = null;
  };

  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const esImg = esMensajeImagen(m);
    const t = m.fecha_envio ? new Date(m.fecha_envio).getTime() : Date.now();

    if (esImg) {
      if (
        grupo &&
        grupo.usuario_id === m.usuario_id &&
        t - grupo.lastTime <= MAX_DIFF_MS
      ) {
        grupo.imagenes.push(m);
        grupo.lastTime = t;
      } else {
        flushGrupo();
        grupo = {
          usuario_id: m.usuario_id,
          imagenes: [m],
          lastTime: t,
        };
      }
      continue;
    }

    // No es imagen => cerramos grupo y añadimos el mensaje normal
    flushGrupo();
    resultado.push(m);
  }

  flushGrupo();
  return resultado;
};

/**
 * 🆕 Agrupar imágenes tipo WhatsApp usando lote_id
 * - Si algún mensaje trae lote_id/loteId → usamos este modo
 * - Si NINGUNO trae lote → usamos agruparImagenesPorTiempo (fallback)
 */
const agruparImagenesTipoWhatsApp = (items) => {
  if (!items || !items.length) return [];

  // ¿Hay al menos un mensaje con lote?
  const tieneLotes = items.some(
    (m) => m && (m.lote_id || m.loteId)
  );

  // Si no hay lotes, usamos el modo antiguo por tiempo
  if (!tieneLotes) {
    return agruparImagenesPorTiempo(items);
  }

  // ---- MODO LOTE: imágenes + caption sólo si comparten lote ----
  const lotes = new Map();
  const sinLote = [];

  for (const m of items) {
    const loteId = m.lote_id || m.loteId;

    if (!loteId) {
      // Mensajes viejos o sin lote -> se muestran tal cual
      sinLote.push(m);
      continue;
    }

    let g = lotes.get(loteId);
    if (!g) {
      g = { loteId, mensajes: [] };
      lotes.set(loteId, g);
    }
    g.mensajes.push(m);
  }

  const grupos = Array.from(lotes.values()).map((g) => {
    const ordenados = g.mensajes
      .slice()
      .sort(
        (a, b) =>
          new Date(a.fecha_envio || 0) - new Date(b.fecha_envio || 0)
      );

    const base = ordenados[0];
    const imagenes = ordenados.filter(esMensajeImagen);
    // caption = el PRIMER mensaje NO imagen de ese lote (si existe)
    const caption = ordenados.find((m) => !esMensajeImagen(m));

    return {
      ...base,
      imagenes: imagenes.map((m) => m.archivo_url || m.mensaje),
      mensaje: caption ? caption.mensaje : "",
    };
  });

  // Mezclamos mensajes sin lote y grupos con lote respetando la fecha
  const todos = [
    ...sinLote.map((m) => ({
      fecha: new Date(m.fecha_envio || 0),
      msg: m,
    })),
    ...grupos.map((m) => ({
      fecha: new Date(m.fecha_envio || 0),
      msg: m,
    })),
  ];

  todos.sort((a, b) => a.fecha - b.fecha);

  return todos.map((x) => x.msg);
};

const ChatBody = ({ messages = [], user, socket, tipo, onVerPerfil }) => {
  const esGrupo = tipo === "grupo";

  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const prevMessagesLength = useRef(0);

  // --- helpers scroll ---
  const isNearBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  };

  // Cuando cambian los mensajes
  useEffect(() => {
    if (
      messages.length > prevMessagesLength.current &&
      isNearBottom()
    ) {
      scrollToBottom();
    }
    prevMessagesLength.current = messages.length;
  }, [messages]);

  // Cuando se cambia de chat (grupo o privado)
  useEffect(() => {
    setTimeout(() => scrollToBottom(false), 150);
    prevMessagesLength.current = messages.length;
  }, [tipo]);

  // Agrupar por fecha
  const groups = useMemo(() => {
    const map = new Map();

    for (const m of messages) {
      if (!m || !m.fecha_envio) continue;

      const d =
        m.fecha_envio instanceof Date
          ? m.fecha_envio
          : new Date(m.fecha_envio);

      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(d.getDate()).padStart(2, "0")}`;
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
      {groups.map(({ date, items }) => {
        const itemsAgrupados = agruparImagenesTipoWhatsApp(items) || [];

        return (
          <div className="date-group" key={date.toISOString()}>
            <div className="date-sticky-wrapper">
              <span className="date-chip">{formatChatDate(date)}</span>
            </div>

            {itemsAgrupados.map((msg) => {
              const usuario = esGrupo
                ? {
                    id: msg.usuario_id,
                    nombre: msg.nombre || "Usuario",
                    apellido: msg.apellido || "",
                    url_imagen: msg.url_imagen || null,
                    correo: msg.correo || "",
                    background: msg.background || "#6c757d",
                  }
                : {
                    id: msg.usuario_envia_id,
                    nombre: msg.emisor_nombre || "Usuario",
                    apellido: msg.emisor_apellido || "",
                    url_imagen: msg.emisor_avatar || null,
                    correo: msg.emisor_correo || "",
                    background: msg.emisor_background || "#6c757d",
                  };

              const enviadoPorMi = esGrupo
                ? msg.usuario_id === user.id
                : msg.usuario_envia_id === user.id;

              return (
                <Message
                  key={msg.id}
                  id={msg.id}
                  mensaje={msg}
                  hora={formatChatTimeOnly(new Date(msg.fecha_envio))}
                  enviadoPorMi={enviadoPorMi}
                  usuario={usuario}
                  miUsuario={user}
                  reacciones={msg.reacciones || []}
                  esGrupo={esGrupo}
                  onVerPerfil={onVerPerfil}
                />
              );
            })}
          </div>
        );
      })}

      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatBody;