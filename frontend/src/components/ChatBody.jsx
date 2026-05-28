// src/components/ChatBody.jsx
import React, { useMemo, useEffect, useRef, useLayoutEffect, useState } from "react";
import { formatChatTimeOnly, formatChatDate } from "../utils/date";
import Message from "./Message";

// Detecta si un mensaje es de imagen (url o mimetype)
const esMensajeSticker = (m) => String(m?.mensaje || "").trim().startsWith("[sticker]");

const esMensajeImagen = (m) => {
  if (!m || esMensajeSticker(m)) return false;

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

const ChatBody = ({
  messages = [],
  user,
  socket,
  tipo,
  chatKey,
  hasMoreMessages = false,
  isLoadingOlderMessages = false,
  onLoadOlderMessages,
  onVerPerfil,
  onGuardarStickerFavorito,
  onEliminarStickerFavorito,
  stickersFavoritos = [],
  mentionOptions = [],
  onReply,
  onReplyPrivado,
  onEnviarMensajePrivado,
  onReplyPreviewClick,
  scrollTargetMessageId = null,
  scrollTargetToken = null,
  typingUsers = [],
  onMarkVisibleMessages,
  onCancelUpload,
  onRetryUpload,
  onForward,
  onStartSelect,
  selectionMode = false,
  selectedMessages = [],
  onToggleSelect,
  onCancelSelection,
  onOpenForwardModal,
}) => {
  const esGrupo = tipo === "grupo";

  const getForwardSelectionKey = (message = {}) => {
    const source = esGrupo ? "grupo" : "privado";
    return `${source}-${message?.id}`;
  };

  const selectedKeySet = useMemo(
    () => new Set((selectedMessages || []).map(getForwardSelectionKey)),
    [selectedMessages, esGrupo]
  );

  const selectedCount = selectedMessages?.length || 0;

  const chatContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const prevMessagesLength = useRef(0);
  const prevLastMessageIdRef = useRef(null);
  const olderLoadSnapshotRef = useRef(null);
  const skipNextAutoScrollRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [newUnreadCount, setNewUnreadCount] = useState(0);
  const markReadThrottleRef = useRef({ last: 0, timer: null });
  const handledScrollTargetRef = useRef(null);

  // --- helpers scroll ---
  const isNearBottom = () => {
    const el = chatContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
  };

  const isIncomingMessage = (message) => {
    if (!message || !user?.id) return false;
    if (esGrupo) return Number(message.usuario_id) !== Number(user.id);
    return Number(message.usuario_envia_id) !== Number(user.id);
  };

  const isOutgoingMessage = (message) => {
    if (!message || !user?.id) return false;
    if (esGrupo) return Number(message.usuario_id) === Number(user.id);
    return Number(message.usuario_envia_id) === Number(user.id);
  };

  const hasUnreadIncomingMessages = () =>
    messages.some((message) => {
      if (!isIncomingMessage(message)) return false;
      if (message.estado === "error" || message.eliminado) return false;
      return Number(message.visto ?? message.leido ?? 0) !== 1;
    });

  const requestMarkVisibleMessages = (force = false) => {
    if (typeof onMarkVisibleMessages !== "function") return;

    // Evita llamar al backend en cada pixel de scroll.
    // Solo marcamos cuando realmente hay mensajes entrantes pendientes
    // o cuando el usuario tocó el botón de bajar al final.
    if (!force && newUnreadCount <= 0 && !hasUnreadIncomingMessages()) return;

    const now = Date.now();
    const elapsed = now - markReadThrottleRef.current.last;

    if (elapsed >= 1200) {
      markReadThrottleRef.current.last = now;
      onMarkVisibleMessages();
      return;
    }

    if (markReadThrottleRef.current.timer) return;

    markReadThrottleRef.current.timer = window.setTimeout(() => {
      markReadThrottleRef.current.timer = null;
      markReadThrottleRef.current.last = Date.now();
      onMarkVisibleMessages();
    }, 1200 - elapsed);
  };

  const markBottomAsRead = (force = false) => {
    setNewUnreadCount(0);
    setShowJumpToBottom(false);
    requestMarkVisibleMessages(force);
  };

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  };

  const handleJumpToBottom = () => {
    scrollToBottom(true);
    window.setTimeout(() => markBottomAsRead(true), 260);
  };

  const scrollToMessageInBody = (messageId, smooth = true) => {
    if (!messageId) return false;

    const target = document.getElementById(`mensaje-${messageId}`);
    if (!target) return false;

    target.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "center",
    });
    target.classList.add("highlight-pinned");
    setTimeout(() => target.classList.remove("highlight-pinned"), 1600);
    return true;
  };

  const handleScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;

    if (isNearBottom()) {
      markBottomAsRead();
    } else {
      setShowJumpToBottom(true);
    }

    if (
      !hasMoreMessages ||
      isLoadingOlderMessages ||
      loadingOlderRef.current ||
      !onLoadOlderMessages
    ) return;

    if (el.scrollTop <= 120) {
      olderLoadSnapshotRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
      skipNextAutoScrollRef.current = true;
      loadingOlderRef.current = true;

      Promise.resolve(onLoadOlderMessages()).finally(() => {
        loadingOlderRef.current = false;
      });
    }
  };

  // Mantiene la posición exacta cuando se agregan mensajes antiguos arriba.
  useLayoutEffect(() => {
    const snapshot = olderLoadSnapshotRef.current;
    const el = chatContainerRef.current;
    if (!snapshot || !el) return;

    el.scrollTop = el.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop;
    olderLoadSnapshotRef.current = null;
  }, [messages]);

  // Cuando cambian los mensajes
  useEffect(() => {
    const previousLength = prevMessagesLength.current;

    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      prevMessagesLength.current = messages.length;
      prevLastMessageIdRef.current = messages[messages.length - 1]?.id ?? null;
      return;
    }

    if (previousLength === 0 && messages.length > 0) {
      scrollToBottom(false);
      markBottomAsRead();
    } else if (messages.length > previousLength) {
      const wasNearBottom = isNearBottom();
      const newItems = messages.slice(previousLength);
      const outgoingCount = newItems.filter(isOutgoingMessage).length;
      const incomingCount = newItems.filter(isIncomingMessage).length;

      // Si el mensaje nuevo lo envió el usuario actual, WhatsApp baja siempre
      // al último mensaje. Si el mensaje es entrante y el usuario está leyendo
      // mensajes antiguos, no movemos el scroll: sólo mostramos el botón.
      if (outgoingCount > 0) {
        scrollToBottom();
        window.setTimeout(() => markBottomAsRead(true), 220);
      } else if (wasNearBottom) {
        scrollToBottom();
        window.setTimeout(markBottomAsRead, 220);
      } else {
        setShowJumpToBottom(true);
        if (incomingCount > 0) {
          setNewUnreadCount((count) => count + incomingCount);
        }
      }
    } else if (isNearBottom()) {
      markBottomAsRead();
    }

    prevMessagesLength.current = messages.length;
    prevLastMessageIdRef.current = messages[messages.length - 1]?.id ?? null;
  }, [messages]);

  // Cuando se cambia de chat (grupo o privado)
  useEffect(() => {
    prevMessagesLength.current = 0;
    olderLoadSnapshotRef.current = null;
    skipNextAutoScrollRef.current = false;
    loadingOlderRef.current = false;
    if (markReadThrottleRef.current.timer) {
      window.clearTimeout(markReadThrottleRef.current.timer);
      markReadThrottleRef.current.timer = null;
    }
    markReadThrottleRef.current.last = 0;
    handledScrollTargetRef.current = null;
    setShowJumpToBottom(false);
    setNewUnreadCount(0);

    if (!scrollTargetMessageId) {
      setTimeout(() => scrollToBottom(false), 150);
    }
  }, [chatKey, tipo, scrollTargetMessageId]);

  // Cuando venimos desde una respuesta privada o un mensaje fijado antiguo,
  // centramos el mensaje una sola vez. Antes se repetía cada vez que cambiaba
  // `messages`; por eso, al tocar la flecha de bajar, el chat volvía a saltar
  // hacia el fijado.
  useEffect(() => {
    if (!scrollTargetMessageId) return;

    const targetKey = `${chatKey || tipo || "chat"}:${scrollTargetToken || "sin-token"}:${scrollTargetMessageId}`;
    if (handledScrollTargetRef.current === targetKey) return;

    const timer = setTimeout(() => {
      const didScroll = scrollToMessageInBody(scrollTargetMessageId, true);
      if (didScroll) {
        handledScrollTargetRef.current = targetKey;
        setShowJumpToBottom(true);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [chatKey, tipo, scrollTargetMessageId, scrollTargetToken, messages]);

  useEffect(() => {
    return () => {
      if (markReadThrottleRef.current.timer) {
        window.clearTimeout(markReadThrottleRef.current.timer);
        markReadThrottleRef.current.timer = null;
      }
    };
  }, []);

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
      className="chat-body-inner h-100 py-6 py-lg-12 hide-scrollbar overflow-auto"
      onScroll={handleScroll}
    >
      <div className="chat-load-more">
        {isLoadingOlderMessages ? (
          <span className="chat-load-more-pill">Cargando mensajes anteriores...</span>
        ) : hasMoreMessages ? (
          <button
            type="button"
            className="chat-load-more-pill chat-load-more-button"
            onClick={onLoadOlderMessages}
          >
            Cargar mensajes anteriores
          </button>
        ) : null}
      </div>
      {groups.map(({ date, items }) => {
        const itemsAgrupados = agruparImagenesTipoWhatsApp(items) || [];

        return (
          <div className="date-group" key={date.toISOString()}>
            <div className="date-sticky-wrapper">
              <span className="date-chip">{formatChatDate(date)}</span>
            </div>

            {(() => {
              const getSenderId = (item) => {
                if (!item) return null;
                return esGrupo ? item.usuario_id : item.usuario_envia_id;
              };

              const normalizeStickerUrl = (url = "") => {
                let cleanUrl = String(url || "").trim().replace(/^(\[sticker\])+/i, "");
                if (cleanUrl.startsWith("/api/uploads/")) cleanUrl = cleanUrl.replace(/^\/api/, "");
                if (cleanUrl.startsWith("uploads/")) cleanUrl = `/${cleanUrl}`;
                if (/^https?:\/\//i.test(cleanUrl)) {
                  try {
                    const parsed = new URL(cleanUrl);
                    if (parsed.pathname.startsWith("/uploads/")) {
                      cleanUrl = `${parsed.pathname}${parsed.search}`;
                    }
                  } catch (err) {}
                }
                return cleanUrl;
              };

              const renderMessageNode = (msg, index, extra = {}) => {
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

                const senderId = getSenderId(msg);
                const previousSenderId = getSenderId(itemsAgrupados[index - 1]);
                const nextSenderId = getSenderId(itemsAgrupados[index + 1]);
                const agrupadoConAnterior = extra.agrupadoConAnterior ?? previousSenderId === senderId;
                const agrupadoConSiguiente = extra.agrupadoConSiguiente ?? nextSenderId === senderId;

                const enviadoPorMi = esGrupo
                  ? Number(msg.usuario_id) === Number(user.id)
                  : Number(msg.usuario_envia_id) === Number(user.id);

                const mostrarAvatar = extra.mostrarAvatar ?? !agrupadoConSiguiente;
                const mostrarNombre = extra.mostrarNombre ?? (esGrupo && !enviadoPorMi && !agrupadoConAnterior);

                let esStickerFavorito = false;
                if (msg.mensaje?.startsWith?.("[sticker]")) {
                  const urlSticker = normalizeStickerUrl(msg.mensaje);
                  esStickerFavorito = stickersFavoritos.some(
                    (s) => normalizeStickerUrl(s.url) === urlSticker && !s.esDefault
                  );
                }

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
                    mostrarAvatar={mostrarAvatar}
                    mostrarNombre={mostrarNombre}
                    agrupadoConAnterior={agrupadoConAnterior}
                    agrupadoConSiguiente={agrupadoConSiguiente}
                    onVerPerfil={onVerPerfil}
                    onGuardarStickerFavorito={onGuardarStickerFavorito}
                    onEliminarStickerFavorito={onEliminarStickerFavorito}
                    esStickerFavorito={esStickerFavorito}
                    mentionOptions={mentionOptions}
                    onReply={onReply}
                    onReplyPrivado={onReplyPrivado}
                    onEnviarMensajePrivado={onEnviarMensajePrivado}
                    onReplyPreviewClick={onReplyPreviewClick}
                    onCancelUpload={onCancelUpload}
                    onRetryUpload={onRetryUpload}
                    onForward={onForward}
                    onStartSelect={onStartSelect}
                    selectionMode={selectionMode}
                    isSelected={selectedKeySet.has(getForwardSelectionKey(msg))}
                    onToggleSelect={onToggleSelect}
                  />
                );
              };

              const nodes = [];
              for (let index = 0; index < itemsAgrupados.length; index += 1) {
                const msg = itemsAgrupados[index];
                if (!esMensajeSticker(msg)) {
                  nodes.push(renderMessageNode(msg, index));
                  continue;
                }

                const senderId = getSenderId(msg);
                const run = [msg];
                let cursor = index + 1;

                while (
                  cursor < itemsAgrupados.length &&
                  esMensajeSticker(itemsAgrupados[cursor]) &&
                  getSenderId(itemsAgrupados[cursor]) === senderId
                ) {
                  run.push(itemsAgrupados[cursor]);
                  cursor += 1;
                }

                if (run.length === 1) {
                  nodes.push(renderMessageNode(msg, index));
                  continue;
                }

                const enviadoPorMi = esGrupo
                  ? Number(msg.usuario_id) === Number(user.id)
                  : Number(msg.usuario_envia_id) === Number(user.id);

                nodes.push(
                  <div
                    key={`sticker-cluster-${run.map((item) => item.id).join("-")}`}
                    className={`wa-sticker-cluster ${enviadoPorMi ? "out" : "in"}`}
                  >
                    {run.map((item, runIndex) => renderMessageNode(item, index + runIndex, {
                      mostrarAvatar: false,
                      mostrarNombre: false,
                      agrupadoConAnterior: runIndex > 0,
                      agrupadoConSiguiente: runIndex < run.length - 1,
                    }))}
                  </div>
                );

                index = cursor - 1;
              }

              return nodes;
            })()}
          </div>
        );
      })}

      {typingUsers.length > 0 && (
        <div className="wa-typing-row incoming">
          <div className="wa-typing-bubble" aria-label="Escribiendo">
            <span className="wa-typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      )}

      {selectionMode && (
        <div className="wa-forward-selection-bar">
          <button
            type="button"
            className="wa-forward-selection-close"
            onClick={onCancelSelection}
            aria-label="Cancelar selección"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
          <span className="wa-forward-selection-count">
            {selectedCount} {selectedCount === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <button
            type="button"
            className="wa-forward-selection-send"
            onClick={onOpenForwardModal}
            disabled={selectedCount === 0}
            aria-label="Reenviar mensajes seleccionados"
            title="Reenviar"
          >
            <i className="fa-solid fa-share" aria-hidden="true" />
          </button>
        </div>
      )}

      {showJumpToBottom && (
        <button
          type="button"
          className={`wa-jump-bottom ${newUnreadCount > 0 ? "has-unread" : ""}`}
          onClick={handleJumpToBottom}
          aria-label={newUnreadCount > 0 ? `${newUnreadCount} mensajes nuevos` : "Ir al final"}
          title="Ir al final"
        >
          {newUnreadCount > 0 && <span className="wa-jump-bottom-count">{newUnreadCount}</span>}
          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatBody;