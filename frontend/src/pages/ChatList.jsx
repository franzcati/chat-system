import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import socket from "../socket";
import { logDev } from "../utils/logger";
import { formatChatTime, parseToDate } from "../utils/date";
import { getAvatarUrl } from "../utils/url";
import { getMessagePreview } from "../utils/messagePreview";
import { Star } from "lucide-react";
import toast from "react-hot-toast";
import GroupAvatar from "../components/GroupAvatar";




const ChatList = ({ onSelectChat, userId, selectedChat, setSelectedChat }) => {
  
  logDev("🔥 ChatList renderizado", { userId });
  const [mensajes, setMensajes] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [chats, setChats] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [favoritos, setFavoritos] = useState([]);
  const [usuariosComunes, setUsuariosComunes] = useState([]);
  const [silenciados, setSilenciados] = useState([]);
  const [chatEstados, setChatEstados] = useState([]);
  const [estadosUsuarios, setEstadosUsuarios] = useState({});
  const [menuChatAbierto, setMenuChatAbierto] = useState(null);
  const [menuChatPosition, setMenuChatPosition] = useState(null);
  const [activeFilter, setActiveFilter] = useState("todos");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [typingByChat, setTypingByChat] = useState({});
  const typingPreviewTimersRef = useRef({});

 // ----------------------------
 // SILENCIAR NOTIFICACIONES

 const getChatKey = (chat) =>
  `${chat.tipo}-${chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id}`;
 const getTypingKeyFromPayload = (payload = {}) => {
  if (payload.tipo === "grupo" && payload.grupoId) return `grupo-${payload.grupoId}`;
  if (payload.tipo === "privado") {
    const senderId = Number(payload.senderId);
    const receiverId = Number(payload.receiverId);
    const myId = Number(userId);
    const otherId = senderId === myId ? receiverId : senderId;
    return otherId ? `privado-${otherId}` : null;
  }
  return null;
 };
 const esFavorito = (chat) =>
  favoritos.some(
    (f) =>
      f.chat_id === (chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id) &&
      f.tipo === chat.tipo
  );

  const estaSilenciado = (tipo, chatId) => {
    return silenciados.some((s) => {
      if (s.tipo !== tipo || Number(s.chat_id) !== Number(chatId)) return false;
      if (Number(s.silenciado) !== 1) return false;
      if (!s.silenciado_hasta) return true;
      return new Date(s.silenciado_hasta).getTime() > Date.now();
    });
  };

  const getEstadoChat = (chat) => {
    if (!chat) return null;
    const chatId = chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id;
    return chatEstados.find(
      (estado) =>
        estado.tipo === chat.tipo &&
        Number(estado.chat_id) === Number(chatId)
    );
  };

  const estaArchivado = (chat) => Number(getEstadoChat(chat)?.archivado || 0) === 1;
  const estaMarcadoNoLeido = (chat) => Number(getEstadoChat(chat)?.marcado_no_leido || 0) === 1;
  const estaFijado = (chat) => Number(getEstadoChat(chat)?.fijado || 0) === 1;

  const mostrarNotificacion = ({ titulo, cuerpo, chat, uniqueId }) => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const n = new Notification(titulo, {
      body: cuerpo,
      icon: "/icono.png",
      tag: uniqueId ? `msg-${uniqueId}` : `msg-${Date.now()}`,
    });

    n.onclick = () => {
      window.focus();
      if (chat) {
        onSelectChat(chat);
        if (setSelectedChat) setSelectedChat(chat);
      }
      n.close();
    };
  };

  const actualizarSilencioChat = async (chat, duracion = "always") => {
    try {
      const tipo = chat.tipo;
      const chatId = tipo === "grupo" ? chat.grupo_id : chat.usuario_id;
      const activarSilencio = !!duracion;

      const res = await axios.post("/api/notificaciones/silenciar", {
        usuarioId: userId,
        tipo,
        chatId,
        silenciado: activarSilencio,
        duracion,
      });

      setSilenciados((prev) => {
        const existe = prev.some(
          (s) => s.tipo === tipo && Number(s.chat_id) === Number(chatId)
        );

        if (!activarSilencio) {
          return prev.filter(
            (s) => !(s.tipo === tipo && Number(s.chat_id) === Number(chatId))
          );
        }

        const nuevoSilencio = {
          tipo,
          chat_id: chatId,
          silenciado: 1,
          silenciado_hasta: res.data?.silenciado_hasta || null,
        };

        if (existe) {
          return prev.map((s) =>
            s.tipo === tipo && Number(s.chat_id) === Number(chatId)
              ? nuevoSilencio
              : s
          );
        }

        return [...prev, nuevoSilencio];
      });

      const textoDuracion =
        duracion === "8h"
          ? "por 8 horas"
          : duracion === "1w"
          ? "por 1 semana"
          : "siempre";

      toast.success(
        activarSilencio
          ? `Notificaciones silenciadas ${textoDuracion}`
          : "Notificaciones activadas"
      );
    } catch (err) {
      console.error("❌ Error cambiando silencio:", err);
      toast.error("No se pudo actualizar el silencio");
    }
  };

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const getTimestamp = (fecha) => {
    const d = parseToDate(fecha);
    return d ? d.getTime() : 0;
  };
  const getInitial = (text) => (text ? text.charAt(0).toUpperCase() : "U");

  const getPresenceInfo = (targetUserId) => {
    const estado = estadosUsuarios?.[String(targetUserId)] || estadosUsuarios?.[Number(targetUserId)] || null;
    const rawStatus = estado?.estado || "desconectado";
    const dispositivo = estado?.dispositivo || "desktop";

    const meta = {
      online: {
        label: dispositivo === "mobile" ? "En línea desde teléfono" : "En línea desde PC",
        shortLabel: "En línea",
        className: "online",
        iconClass: dispositivo === "mobile" ? "fa-solid fa-mobile-screen-button" : "fa-solid fa-desktop",
      },
      inactivo: {
        label: "Inactivo",
        shortLabel: "Inactivo",
        className: "idle",
        iconClass: "fa-solid fa-moon",
      },
      no_molestar: {
        label: "No molestar",
        shortLabel: "No molestar",
        className: "dnd",
        iconClass: "fa-solid fa-minus",
      },
      desconectado: {
        label: "Sin conexión",
        shortLabel: "Sin conexión",
        className: "offline",
        iconClass: "fa-regular fa-circle",
      },
    };

    return meta[rawStatus] || meta.desconectado;
  };

  const estaEnNoMolestarUsuario = (targetUserId) => {
    const estado = estadosUsuarios?.[String(targetUserId)] || estadosUsuarios?.[Number(targetUserId)] || null;
    return estado?.estado === "no_molestar";
  };

  const renderPresenceBadge = (targetUserId) => {
    const presence = getPresenceInfo(targetUserId);
    return (
      <span className={`wa-presence-badge ${presence.className}`} title={presence.label}>
        <i className={presence.iconClass} aria-hidden="true" />
      </span>
    );
  };

  const getChatPreviewSource = (chat = {}) => ({
    ...chat,
    mensaje: chat.mensaje ?? chat.ultimo_mensaje,
    archivo_url: chat.archivo_url || chat.ultimo_archivo_url,
    tipo_archivo: chat.tipo_archivo || chat.ultimo_tipo_archivo,
    nombre_archivo: chat.nombre_archivo || chat.ultimo_nombre_archivo,
  });

  const renderChatPreview = (chat) => {
    const preview = getMessagePreview(getChatPreviewSource(chat));

    return (
      <span className="wa-preview-line chat-list-preview-line">
        {preview.iconClass && <i className={`wa-preview-icon ${preview.iconClass}`} aria-hidden="true" />}
        <span className="wa-preview-label">{preview.text}</span>
      </span>
    );
  };

  const getPreviewText = (message) => {
    const preview = getMessagePreview(message);
    return preview.text;
  };

  useEffect(() => {
    const cerrarMenusFlotantes = () => {
      setMenuChatAbierto(null);
      setMenuChatPosition(null);
      setFilterMenuOpen(false);
    };

    document.addEventListener("click", cerrarMenusFlotantes);
    window.addEventListener("resize", cerrarMenusFlotantes);
    document.addEventListener("scroll", cerrarMenusFlotantes, true);

    return () => {
      document.removeEventListener("click", cerrarMenusFlotantes);
      window.removeEventListener("resize", cerrarMenusFlotantes);
      document.removeEventListener("scroll", cerrarMenusFlotantes, true);
    };
  }, []);


  useEffect(() => {
    const cargarEstados = async () => {
      try {
        const res = await axios.get("/api/usuarios/estados/presencia");
        setEstadosUsuarios(res.data || {});
      } catch (err) {
        console.error("❌ Error cargando estados de presencia:", err);
      }
    };

    cargarEstados();

    const handleActualizarUsuarios = (payload) => {
      setEstadosUsuarios(payload || {});
    };

    socket.on("actualizarUsuarios", handleActualizarUsuarios);
    return () => socket.off("actualizarUsuarios", handleActualizarUsuarios);
  }, []);

  useEffect(() => {
    if (!userId) return;

    const handleTypingUpdate = (payload = {}) => {
      const senderId = Number(payload.senderId);
      if (!senderId || senderId === Number(userId)) return;

      const key = getTypingKeyFromPayload(payload);
      if (!key) return;

      if (!payload.isTyping) {
        if (typingPreviewTimersRef.current[key]) {
          window.clearTimeout(typingPreviewTimersRef.current[key]);
          delete typingPreviewTimersRef.current[key];
        }

        setTypingByChat((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }

      const at = payload.at || Date.now();
      const nombre = [payload.nombre, payload.apellido].filter(Boolean).join(" ").trim() || "Usuario";

      setTypingByChat((prev) => ({
        ...prev,
        [key]: {
          senderId,
          nombre,
          at,
        },
      }));

      if (typingPreviewTimersRef.current[key]) {
        window.clearTimeout(typingPreviewTimersRef.current[key]);
      }

      typingPreviewTimersRef.current[key] = window.setTimeout(() => {
        setTypingByChat((prev) => {
          if (prev[key]?.at !== at) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        delete typingPreviewTimersRef.current[key];
      }, 4200);
    };

    socket.on("typing:update", handleTypingUpdate);
    return () => {
      socket.off("typing:update", handleTypingUpdate);
      Object.values(typingPreviewTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      typingPreviewTimersRef.current = {};
    };
  }, [userId]);

  // -------------------------------
  // 🔹 Agrupar mensajes privados
  const agruparChatsPrivados = (mensajes, userId) => {
    if (!mensajes || mensajes.length === 0) return [];

    const grouped = {};

    mensajes.forEach((msg) => {
      const esEmisor = msg.usuario_envia_id === userId;
      const otherUserId = esEmisor ? msg.usuario_recibe_id : msg.usuario_envia_id;
      const eliminado = msg.eliminado ?? 0;

      const otherUserNombre = esEmisor
        ? `${msg.receptor_nombre || ""} ${msg.receptor_apellido || ""}`.trim() || msg.receptor_nombre || "Usuario"
        : `${msg.emisor_nombre || ""} ${msg.emisor_apellido || ""}`.trim() || msg.emisor_nombre || "Usuario";

      const otherUserCorreo = esEmisor ? msg.receptor_correo || "" : msg.emisor_correo || "";
      const otherUserAvatar = esEmisor ? msg.receptor_avatar || null : msg.emisor_avatar || null;
      const otherUserBackground = esEmisor ? msg.receptor_background || "#6c757d" : msg.emisor_background || "#6c757d";

      const msgTime = getTimestamp(msg.fecha_envio);
      const mensajeMostrado = eliminado === 1 ? "Se eliminó este mensaje" : msg.mensaje;

      if (!grouped[otherUserId]) {
        grouped[otherUserId] = {
          tipo: "privado",
          usuario_id: otherUserId,
          usuario_nombre: otherUserNombre,
          usuario_correo: otherUserCorreo,
          url_imagen: otherUserAvatar,
          background: otherUserBackground,
          mensajes_no_leidos: msg.usuario_recibe_id === userId && msg.visto === 0 ? 1 : 0,
          eliminado,
          ultimo_mensaje: mensajeMostrado,
          ultimo_archivo_url: msg.archivo_url || null,
          ultimo_tipo_archivo: msg.tipo_archivo || "",
          ultimo_nombre_archivo: msg.nombre_archivo || "",
          ultimo_mensaje_id: msg.id,
          fecha_envio: msg.fecha_envio,
          tipo_mensaje: esEmisor ? "enviado" : "recibido",
          visto: msg.visto,
          lastTime: msgTime,
        };
      } else {
        if (msg.id === grouped[otherUserId].ultimo_mensaje_id) {
          grouped[otherUserId].ultimo_mensaje = mensajeMostrado;
          grouped[otherUserId].eliminado = eliminado;
          grouped[otherUserId].tipo_mensaje = esEmisor ? "enviado" : "recibido";
          grouped[otherUserId].visto = msg.visto;
        }

        if (msgTime > grouped[otherUserId].lastTime) {
          grouped[otherUserId].ultimo_mensaje = mensajeMostrado;
          grouped[otherUserId].ultimo_archivo_url = msg.archivo_url || null;
          grouped[otherUserId].ultimo_tipo_archivo = msg.tipo_archivo || "";
          grouped[otherUserId].ultimo_nombre_archivo = msg.nombre_archivo || "";
          grouped[otherUserId].ultimo_mensaje_id = msg.id;
          grouped[otherUserId].fecha_envio = msg.fecha_envio;
          grouped[otherUserId].tipo_mensaje = esEmisor ? "enviado" : "recibido";
          grouped[otherUserId].visto = msg.visto;
          grouped[otherUserId].lastTime = msgTime;
        }

        if (msg.usuario_recibe_id === userId && msg.visto === 0) {
          grouped[otherUserId].mensajes_no_leidos += 1;
        }
      }
    });

    return Object.values(grouped);
  };

  useEffect(() => {
    logDev("🟢 useEffect ChatList sockets montado", {
      userId,
      connected: socket.connected,
      socketId: socket.id,
    });

    if (!userId) return;

    const handleNuevoMensaje = (msg) => {
      logDev("📩 ChatList recibió nuevoMensaje:", msg);

      const miId = Number(userId);
      const enviaId = Number(msg.usuario_envia_id);
      const recibeId = Number(msg.usuario_recibe_id);

      if (enviaId !== miId && recibeId !== miId) return;

      setMensajes((prev) => {
        const yaExiste = prev.some((m) => Number(m.id) === Number(msg.id));
        if (yaExiste) {
          return prev.map((m) =>
            Number(m.id) === Number(msg.id) ? { ...m, ...msg } : m
          );
        }
        return [...prev, msg];
      });

      const otherUserId = enviaId === miId ? recibeId : enviaId;
      const esMio = enviaId === miId;

      const chatAbiertoEsEste =
        selectedChat?.tipo === "privado" &&
        Number(selectedChat?.usuario_id) === Number(otherUserId);

      const silenciado = estaSilenciado("privado", otherUserId);

      if (!esMio && !chatAbiertoEsEste && !silenciado && !estaEnNoMolestarUsuario(userId)) {
        mostrarNotificacion({
          titulo: `${msg.emisor_nombre || "Usuario"} ${msg.emisor_apellido || ""}`.trim(),
          cuerpo:
            msg.eliminado === 1
              ? "Se eliminó este mensaje"
              : getPreviewText(msg),
          uniqueId: msg.id,
          chat: {
            tipo: "privado",
            usuario_id: otherUserId,
            usuario_nombre: `${msg.emisor_nombre || ""} ${msg.emisor_apellido || ""}`.trim(),
            usuario_correo: msg.emisor_correo || "",
            url_imagen: msg.emisor_avatar || null,
            background: msg.emisor_background || "#6c757d",
          },
        });
      }
    };

    socket.on("nuevoMensaje", handleNuevoMensaje);

    return () => {
      socket.off("nuevoMensaje", handleNuevoMensaje);
    };
  }, [userId, selectedChat, silenciados, estadosUsuarios]);

  // -------------------------------
  // 🔹 Cargar privados, grupos y favoritos
  useEffect(() => {
    if (!userId) return;

    const fetchData = async () => {
      try {
        const [resMensajes, resGrupos, resFavoritos, resSilenciados, resEstados] = await Promise.all([
          axios.get(`/api/chats/${userId}`),
          axios.get(`/api/grupos/usuario/${userId}`),
          axios.get(`/api/chats/favoritos/${userId}`),
          axios.get(`/api/notificaciones/silenciados/${userId}`),
          axios.get(`/api/chats/estados/${userId}`),
        ]);

        setMensajes(resMensajes.data);
        setGrupos(resGrupos.data);
        setFavoritos(resFavoritos.data);
        setSilenciados(resSilenciados.data || []);
        setChatEstados(resEstados.data || []);

        console.group("📋 Chats cargados al inicio");
        logDev("🗨️ Mensajes privados:", resMensajes.data);
        logDev("👥 Grupos:", resGrupos.data);
        logDev("⭐ Favoritos:", resFavoritos.data);
        logDev("🔕 Silenciados:", resSilenciados.data);
        logDev("📦 Estados de chats:", resEstados.data);
        console.groupEnd();

      } catch (error) {
        console.error("❌ Error cargando datos iniciales del ChatList:", error);
      }
    };

    fetchData();
  }, [userId]);

  // -------------------------------
  // 🔹 Unificar privados + grupos
  useEffect(() => {
    if (!userId) return;

    const privados = agruparChatsPrivados(mensajes.filter((m) => !m.grupo_id), userId);

    const gruposAdaptados = grupos.map((g) => {
      const eliminado = g.eliminado ?? 0;
      const mensajeMostrado =
        eliminado === 1 ? "Se eliminó este mensaje" : g.ultimo_mensaje || "Nuevo grupo creado";
      const mensajesNoLeidos = g.miembros?.some((m) => m.id === userId)
        ? g.mensajes_no_leidos || 0
        : 0;

      return {
        // 🔹 Identificación general
        tipo: "grupo",
        grupo_id: g.grupo_id,
        user_id: userId,
        usuario_id: g.grupo_id,
        usuario_nombre: g.nombre,

        // 🔹 Imagen y colores
        imagen_url: g.imagen_url,
        background: "#6c757d",

        // 🔹 Estado de mensajes
        mensajes_no_leidos: mensajesNoLeidos,
        eliminado: g.eliminado,
        ultimo_mensaje: mensajeMostrado,
        ultimo_archivo_url: g.ultimo_archivo_url || g.archivo_url || null,
        ultimo_tipo_archivo: g.ultimo_tipo_archivo || g.tipo_archivo || "",
        ultimo_nombre_archivo: g.ultimo_nombre_archivo || g.nombre_archivo || "",
        ultimo_mensaje_id: g.ultimo_mensaje_id || null,
        ultimo_remitente: g.ultimo_remitente || null,
        ultimo_remitente_avatar: g.ultimo_remitente_avatar || null,
        ultimo_remitente_background: g.ultimo_remitente_background,
        fecha_envio: g.fecha_envio || g.fecha_creacion,
        tipo_mensaje: g.tipo_mensaje,
        visto: g.visto,
        lastTime: g.fecha_envio
          ? getTimestamp(g.fecha_envio)
          : getTimestamp(g.fecha_creacion),

        // 🔹 NUEVOS CAMPOS — información extendida del grupo
        descripcion: g.descripcion || "",
        fecha_creacion: g.fecha_creacion,
        privacidad: g.privacidad,
        propietario: g.propietario || null,
        admins: g.admins || [],
        archivos: g.archivos || [],
        es_favorito: g.es_favorito || false,
        miembros: g.miembros || [],
      };
    });

    setChats([...privados, ...gruposAdaptados].sort((a, b) => b.lastTime - a.lastTime));
  }, [mensajes, grupos, userId]);

  // -------------------------------
  // 🔹 Socket.IO
  useEffect(() => {
    if (!userId) return;

    const handleNuevoMensaje = (msg) => {
      const miId = Number(userId);
      const enviaId = Number(msg.usuario_envia_id);
      const recibeId = Number(msg.usuario_recibe_id);

      if (enviaId !== miId && recibeId !== miId) return;

      setMensajes((prev) => {
        const yaExiste = prev.some((m) => Number(m.id) === Number(msg.id));
        if (yaExiste) {
          return prev.map((m) =>
            Number(m.id) === Number(msg.id) ? { ...m, ...msg } : m
          );
        }
        return [...prev, msg];
      });

      setChats((prevChats) => {
        const otherUserId = enviaId === miId ? recibeId : enviaId;
        const esEmisor = enviaId === miId;

        const yaExiste = prevChats.some(
          (chat) =>
            chat.tipo === "privado" &&
            Number(chat.usuario_id) === Number(otherUserId)
        );

        if (!yaExiste) {
          return [
            {
              tipo: "privado",
              usuario_id: otherUserId,
              usuario_nombre: esEmisor
                ? `${msg.receptor_nombre || ""} ${msg.receptor_apellido || ""}`.trim() || msg.receptor_nombre || "Usuario"
                : `${msg.emisor_nombre || ""} ${msg.emisor_apellido || ""}`.trim() || msg.emisor_nombre || "Usuario",
              usuario_correo: esEmisor ? msg.receptor_correo || "" : msg.emisor_correo || "",
              url_imagen: esEmisor ? msg.receptor_avatar || null : msg.emisor_avatar || null,
              background: esEmisor
                ? msg.receptor_background || "#6c757d"
                : msg.emisor_background || "#6c757d",
              mensajes_no_leidos: esEmisor ? 0 : ((msg.visto ?? 0) === 0 ? 1 : 0),
              eliminado: msg.eliminado ?? 0,
              ultimo_mensaje: msg.eliminado ? "Se eliminó este mensaje" : msg.mensaje,
              ultimo_archivo_url: msg.archivo_url || null,
              ultimo_tipo_archivo: msg.tipo_archivo || "",
              ultimo_nombre_archivo: msg.nombre_archivo || "",
              ultimo_mensaje_id: msg.id,
              fecha_envio: msg.fecha_envio,
              tipo_mensaje: esEmisor ? "enviado" : "recibido",
              visto: msg.visto ?? 0,
              lastTime: getTimestamp(msg.fecha_envio),
            },
            ...prevChats,
          ].sort((a, b) => b.lastTime - a.lastTime);
        }

        return prevChats
          .map((chat) => {
            if (
              chat.tipo === "privado" &&
              Number(chat.usuario_id) === Number(otherUserId)
            ) {
              return {
                ...chat,
                ultimo_mensaje: msg.eliminado ? "Se eliminó este mensaje" : msg.mensaje,
                ultimo_mensaje_id: msg.id,
                fecha_envio: msg.fecha_envio,
                tipo_mensaje: esEmisor ? "enviado" : "recibido",
                visto: msg.visto ?? 0,
                lastTime: getTimestamp(msg.fecha_envio),
                mensajes_no_leidos: esEmisor
                  ? chat.mensajes_no_leidos || 0
                  : (chat.mensajes_no_leidos || 0) + ((msg.visto ?? 0) === 0 ? 1 : 0),
              };
            }
            return chat;
          })
          .sort((a, b) => b.lastTime - a.lastTime);
      });
    };

    const handleNuevoMensajeGrupo = (msg) => {
      setMensajes((prev) => {
        const yaExiste = prev.some((m) => Number(m.id) === Number(msg.id));
        if (yaExiste) return prev;
        return [
          ...prev,
          { ...msg, tipo_mensaje: Number(msg.usuario_id) === Number(userId) ? "enviado" : "recibido" },
        ];
      });

      setGrupos((prev) => {
        const updatedGrupos = prev.map((g) => {
          if (Number(g.grupo_id) === Number(msg.grupo_id)) {
            const soyRemitente = Number(msg.usuario_id) === Number(userId);
            const nuevosNoVistos = soyRemitente
              ? g.mensajes_no_leidos || 0
              : (g.mensajes_no_leidos || 0) + 1;

            return {
              ...g,
              eliminado: 0,
              ultimo_mensaje: msg.mensaje,
              ultimo_archivo_url: msg.archivo_url || null,
              ultimo_tipo_archivo: msg.tipo_archivo || "",
              ultimo_nombre_archivo: msg.nombre_archivo || "",
              ultimo_mensaje_id: msg.id,
              ultimo_remitente: `${msg.nombre} ${msg.apellido}`,
              ultimo_remitente_id: msg.usuario_id,
              ultimo_remitente_avatar: msg.url_imagen,
              ultimo_remitente_background: msg.background,
              fecha_envio: msg.fecha_envio,
              tipo_mensaje: soyRemitente ? "enviado" : "recibido",
              lastTime: getTimestamp(msg.fecha_envio),
              mensajes_no_leidos: nuevosNoVistos,
              visto: soyRemitente ? 0 : g.visto,
            };
          }
          return g;
        });

        setChats((prevChats) => {
          const privadoChats = prevChats.filter((c) => c.tipo === "privado");
          const grupoChats = updatedGrupos.map((g) => ({
            tipo: "grupo",
            grupo_id: g.grupo_id,
            usuario_id: g.grupo_id,
            usuario_nombre: g.nombre,
            imagen_url: g.imagen_url,
            background: "#6c757d",
            mensajes_no_leidos: g.mensajes_no_leidos || 0,
            eliminado: g.eliminado,
            ultimo_mensaje: g.ultimo_mensaje,
            ultimo_archivo_url: g.ultimo_archivo_url || g.archivo_url || null,
            ultimo_tipo_archivo: g.ultimo_tipo_archivo || g.tipo_archivo || "",
            ultimo_nombre_archivo: g.ultimo_nombre_archivo || g.nombre_archivo || "",
            ultimo_mensaje_id: g.ultimo_mensaje_id,
            ultimo_remitente: g.ultimo_remitente,
            ultimo_remitente_avatar: g.ultimo_remitente_avatar,
            fecha_envio: g.fecha_envio,
            tipo_mensaje: g.tipo_mensaje,
            visto: g.visto,
            lastTime: g.lastTime,
            miembros: g.miembros || [],
          }));
          return [...privadoChats, ...grupoChats].sort((a, b) => b.lastTime - a.lastTime);
        });

        return updatedGrupos;
      });

      const soyYo = Number(msg.usuario_id) === Number(userId);
      const chatAbiertoEsEsteGrupo =
        selectedChat?.tipo === "grupo" &&
        Number(selectedChat?.grupo_id) === Number(msg.grupo_id);

      const silenciado = estaSilenciado("grupo", msg.grupo_id);

      if (!soyYo && !chatAbiertoEsEsteGrupo && !silenciado && !estaEnNoMolestarUsuario(userId)) {
        const grupoActual = grupos.find(
          (g) => Number(g.grupo_id) === Number(msg.grupo_id)
        );

        mostrarNotificacion({
          titulo: `Grupo: ${grupoActual?.nombre || "Grupo"}`,
          cuerpo: `${msg.nombre || "Usuario"}: ${
            msg.eliminado === 1
              ? "Se eliminó este mensaje"
              : getPreviewText(msg)
          }`,
          uniqueId: msg.id,
          chat: {
            tipo: "grupo",
            grupo_id: msg.grupo_id,
            usuario_nombre: grupoActual?.nombre || "Grupo",
            imagen_url: grupoActual?.imagen_url || null,
          },
        });
      }
    };

    // 🧩 Grupo nuevo (cuando te agregan a uno)
    const handleGrupoCreado = (nuevoGrupo) => {
      logDev("🟢 NUEVO GRUPO CREADO (socket):", nuevoGrupo);
      setGrupos((prev) => [...prev, nuevoGrupo]);

      setChats((prevChats) => {
        const privadoChats = prevChats.filter((c) => c.tipo === "privado");
        const grupoChats = [
          ...prevChats.filter((c) => c.tipo === "grupo"),
          {
            tipo: "grupo",
            grupo_id: nuevoGrupo.grupo_id,
            usuario_id: nuevoGrupo.grupo_id,
            usuario_nombre: nuevoGrupo.nombre,
            imagen_url: nuevoGrupo.imagen_url,
            background: "#6c757d",
            miembros: nuevoGrupo.miembros,
            ultimo_mensaje: "",
            fecha_envio: nuevoGrupo.fecha_creacion,
            lastTime: getTimestamp(nuevoGrupo.fecha_creacion),
          },
        ];
        return [...privadoChats, ...grupoChats].sort((a, b) => b.lastTime - a.lastTime);
      });
    };

    const handleMensajesVistos = ({ emisorId, receptorId }) =>
      setMensajes((prev) =>
        prev.map((msg) =>
          msg.usuario_envia_id === emisorId && msg.usuario_recibe_id === receptorId
            ? { ...msg, visto: 1 }
            : msg
        )
    );

    const handleMensajesVistosGrupo = ({ userId: vistoPor, grupoId }) =>
      setMensajes((prev) =>
        prev.map((msg) =>
          msg.grupo_id === grupoId && msg.usuario_id === vistoPor
            ? { ...msg, visto: 1 }
            : msg
        )
    );

     // 🟢 NUEVO: actualizar contador no vistos en tiempo real
    const handleActualizarNoVistosGrupo = ({ grupoId, incremento, reset }) => {
      setGrupos((prev) =>
        prev.map((g) => {
          if (g.grupo_id === grupoId) {
            let nuevosNoVistos = g.mensajes_no_leidos || 0;
            if (reset) nuevosNoVistos = 0;
            else nuevosNoVistos += incremento || 0;

            return { ...g, mensajes_no_leidos: nuevosNoVistos };
          }
          return g;
        })
      );

      setChats((prevChats) =>
        prevChats.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? {
                ...c,
                mensajes_no_leidos: reset
                  ? 0
                  : (c.mensajes_no_leidos || 0) + (incremento || 0),
              }
            : c
        )
      );
    };

    const handleTodosMensajesVistosGrupo = ({ grupoId, mensajeId }) => {
      logDev("🔹 Evento TODOS MENSAJES VISTOS recibido:", { grupoId, mensajeId });

      // 1️⃣ Actualizar mensajes del grupo
      setMensajes(prev => prev.map(msg =>
        msg.grupo_id === grupoId && msg.id <= mensajeId
          ? { ...msg, visto: 1 }
          : msg
      ));

      // 2️⃣ Actualizar grupos
      setGrupos(prev => prev.map(g =>
        g.grupo_id === grupoId
          ? { ...g, mensajes_no_leidos: 0, visto: 1 }
          : g
      ));

      // 3️⃣ Actualizar chats
      setChats(prev => prev.map(c =>
        c.tipo === "grupo" && c.grupo_id === grupoId
          ? { ...c, mensajes_no_leidos: 0, visto: 1 }
          : c
      ));
    };

    // --- ⬇️ NUEVO: grupo actualizado ---
    const handleGrupoActualizado = (data) => {
      logDev("📢 [SOCKET] Grupo actualizado:", data);

      const grupoId = Number(data.id); // 👈 Convertir a número

      // Actualiza tanto la lista de grupos como los chats
      setGrupos((prev) =>
        prev.map((g) =>
          g.grupo_id === grupoId
            ? {
                ...g,
                nombre: data.nombre ?? g.nombre,
                descripcion: data.descripcion ?? g.descripcion,
                imagen_url: data.imagen_url ?? g.imagen_url,
              }
            : g
        )
      );

      setChats((prev) =>
        prev.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? {
                ...c,
                usuario_nombre: data.nombre ?? c.usuario_nombre,
                nombre: data.nombre ?? c.nombre,
                descripcion: data.descripcion ?? c.descripcion,
                imagen_url: data.imagen_url ?? c.imagen_url,
              }
            : c
        )
      );
    };
    
    // 🟢 Nuevo: privacidad actualizada
    const handlePrivacidadActualizada = (data) => {
      logDev("🔐 [SOCKET] Privacidad actualizada:", data);

      const grupoId = Number(data.id);

      setGrupos((prev) =>
        prev.map((g) =>
          g.grupo_id === grupoId
            ? { ...g, privacidad: data.privacidad }
            : g
        )
      );

      setChats((prev) =>
        prev.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? { ...c, privacidad: data.privacidad }
            : c
        )
      );
    };

    // 🧩 Nuevo: miembros actualizados en tiempo real
    const handleMiembrosActualizados = (data) => {
      logDev("👥 [SOCKET] Miembros actualizados (ChatList):", data);

      const grupoId = Number(data.id);

      // Actualizamos los arrays locales de grupos y chats
      setGrupos((prev) =>
        prev.map((g) =>
          g.grupo_id === grupoId
            ? { ...g, miembros: data.miembros }
            : g
        )
      );

      setChats((prev) =>
        prev.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? { ...c, miembros: data.miembros }
            : c
        )
      );
    };
    // 🧩 Grupo eliminado (si te sacan del grupo)
    const handleGrupoEliminado = (data) => {
      const grupoId = Number(data.id);
      logDev("🚫 [SOCKET] Eliminando grupo del ChatList:", grupoId);

      setGrupos((prev) => {
        const existe = prev.some((g) => g.grupo_id === grupoId);
        if (!existe) return prev;
        logDev("🗑️ Eliminado de grupos:", grupoId);
        return prev.filter((g) => g.grupo_id !== grupoId);
      });

      setChats((prev) => {
        const existe = prev.some((c) => c.tipo === "grupo" && c.grupo_id === grupoId);
        if (!existe) return prev;
        logDev("🗑️ Eliminado de chats:", grupoId);
        return prev.filter((c) => !(c.tipo === "grupo" && c.grupo_id === grupoId));
      });

      logDev("🗑️ selectedChat actual:", selectedChat);

      // 💡 Forzar limpieza del chat actual si corresponde
      if (!selectedChat || (selectedChat.tipo === "grupo" && Number(selectedChat.grupo_id) === grupoId)) {
        logDev("🧹 Cerrando chat actual...");
        setSelectedChat(null);
      }

      toast.error("🚫 Grupo eliminado o ya no perteneces a él");
    };

    socket.on("nuevoMensaje", handleNuevoMensaje);
    socket.on("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
    socket.on("grupoCreado", handleGrupoCreado);
    socket.on("mensajesVistos", handleMensajesVistos);
    socket.on("mensajesVistosGrupo", handleMensajesVistosGrupo);
    socket.on("actualizarNoVistosGrupo", handleActualizarNoVistosGrupo);
    socket.on("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
    socket.on("grupoActualizado", handleGrupoActualizado);
    socket.on("privacidadActualizada", handlePrivacidadActualizada);
    socket.on("miembrosActualizados", handleMiembrosActualizados);
    socket.on("grupoEliminado", handleGrupoEliminado);

    return () => {
      socket.off("nuevoMensaje", handleNuevoMensaje);
      socket.off("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
      socket.off("grupoCreado", handleGrupoCreado);
      socket.off("mensajesVistos", handleMensajesVistos);
      socket.off("mensajesVistosGrupo", handleMensajesVistosGrupo);
      socket.off("actualizarNoVistosGrupo", handleActualizarNoVistosGrupo);
      socket.off("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
      socket.off("grupoActualizado", handleGrupoActualizado);
      socket.off("privacidadActualizada", handlePrivacidadActualizada);
      socket.off("miembrosActualizados", handleMiembrosActualizados);
      socket.off("grupoEliminado", handleGrupoEliminado);
    };
  }, [userId, selectedChat, silenciados, grupos, estadosUsuarios]);

  // -------------------------------
  // 🔹 Socket.IO PARA ELIMINAR MENSAJES, DESHACER ELIMINADO, EDITAR MENSAJE
  useEffect(() => {
    if (!userId) return;

    const actualizarChat = (msg) => {
      const esGrupo = !!msg.grupo_id;

      // Actualizar la lista de mensajes localmente
      setMensajes((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));

      if (esGrupo) {
        setGrupos((prevGrupos) => {
          const updatedGrupos = prevGrupos.map((g) => {
            // Solo actualizar el grupo si coincide
            if (g.grupo_id !== msg.grupo_id) return g;

            // 🧠 Verificar si este mensaje es el último
            const esUltimo = g.ultimo_mensaje_id === msg.id;

            // Si NO es el último → no modificar el preview
            if (!esUltimo) {
              return {
                ...g,
                mensajes_no_leidos: g.mensajes_no_leidos || 0, // mantener contadores
              };
            }

            // Si SÍ es el último → actualizamos el preview correctamente
            return {
              ...g,
              eliminado: msg.eliminado ?? g.eliminado,
              editado: msg.editado ?? g.editado,
              ultimo_mensaje: msg.eliminado
                ? "Mensaje eliminado"
                : msg.mensaje ?? g.ultimo_mensaje,
              ultimo_archivo_url: msg.archivo_url ?? g.ultimo_archivo_url ?? null,
              ultimo_tipo_archivo: msg.tipo_archivo ?? g.ultimo_tipo_archivo ?? "",
              ultimo_nombre_archivo: msg.nombre_archivo ?? g.ultimo_nombre_archivo ?? "",
              ultimo_mensaje_id: msg.id,
              ultimo_remitente: msg.nombre
                ? `${msg.nombre} ${msg.apellido}`
                : g.ultimo_remitente,
              ultimo_remitente_avatar: msg.url_imagen ?? g.ultimo_remitente_avatar,
              fecha_envio: msg.fecha_envio ?? g.fecha_envio,
              lastTime: getTimestamp(msg.fecha_envio || g.fecha_creacion),
            };
          });

          // 🔹 Reflejar también en la lista de chats
          setChats((prevChats) => {
            const privadoChats = prevChats.filter((c) => c.tipo === "privado");

            const grupoChats = updatedGrupos.map((g) => ({
              tipo: "grupo",
              grupo_id: g.grupo_id,
              usuario_id: g.grupo_id,
              usuario_nombre: g.nombre,
              imagen_url: g.imagen_url,
              background: "#6c757d",
              mensajes_no_leidos: g.miembros?.some((m) => m.id === userId)
                ? g.mensajes_no_leidos || 0
                : 0,
              eliminado: g.eliminado,
              ultimo_mensaje: g.ultimo_mensaje,
              ultimo_mensaje_id: g.ultimo_mensaje_id,
              ultimo_remitente: g.ultimo_remitente,
              ultimo_remitente_avatar: g.ultimo_remitente_avatar,
              fecha_envio: g.fecha_envio,
              tipo_mensaje: g.tipo_mensaje,
              visto: g.visto,
              lastTime: g.lastTime,
              miembros: g.miembros || [],
            }));

            return [...privadoChats, ...grupoChats].sort(
              (a, b) => b.lastTime - a.lastTime
            );
          });

          return updatedGrupos;
        });
      } else {
        // 🔹 CHAT PRIVADO (ya funcionaba bien)
        setChats((prevChats) =>
          prevChats.map((chat) => {
            const esEsteChat =
              chat.tipo === "privado" &&
              ((chat.usuario_id === msg.usuario_envia_id &&
                msg.usuario_recibe_id === userId) ||
                (chat.usuario_id === msg.usuario_recibe_id &&
                  msg.usuario_envia_id === userId));

            if (!esEsteChat) return chat;

            // Solo actualizar si el mensaje afectado es el último
            const esUltimo = chat.ultimo_mensaje_id === msg.id;

            if (!esUltimo) return chat;

            return {
              ...chat,
              ultimo_mensaje: msg.eliminado
                ? "Mensaje eliminado"
                : msg.mensaje ?? chat.ultimo_mensaje,
              ultimo_archivo_url: msg.archivo_url ?? chat.ultimo_archivo_url ?? null,
              ultimo_tipo_archivo: msg.tipo_archivo ?? chat.ultimo_tipo_archivo ?? "",
              ultimo_nombre_archivo: msg.nombre_archivo ?? chat.ultimo_nombre_archivo ?? "",
              eliminado: msg.eliminado ?? chat.eliminado,
              editado: msg.editado ?? chat.editado,
            };
          })
        );
      }
    };

    socket.on("mensajeEliminado", actualizarChat);
    socket.on("mensajeEliminadoGrupo", actualizarChat);
    socket.on("mensajeDeshecho", actualizarChat);
    socket.on("mensajeDeshechoGrupo", actualizarChat);
    socket.on("mensajeEditado", actualizarChat);
    socket.on("mensajeEditadoGrupo", actualizarChat);

    return () => {
      socket.off("mensajeEliminado", actualizarChat);
      socket.off("mensajeEliminadoGrupo", actualizarChat);
      socket.off("mensajeDeshecho", actualizarChat);
      socket.off("mensajeDeshechoGrupo", actualizarChat);
      socket.off("mensajeEditado", actualizarChat);
      socket.off("mensajeEditadoGrupo", actualizarChat);
    };
  }, [userId]);

  // -------------------------------
  // 🔹 Filtrar usuarios comunes
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setUsuariosComunes([]);
      return;
    }

    fetch(`/api/chats/usuarios/comunes/${userId}?search=${searchTerm}`)
      .then((res) => res.json())
      .then((data) => setUsuariosComunes(data))
      .catch((err) => console.error("Error cargando usuarios comunes", err));
  }, [searchTerm, userId]);

  // -------------------------------
  // 🔹 Funciones
  const toggleFavorito = async (chat) => {
    const chatId = chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id;
    const isFavorito = favoritos.some(
      (f) => Number(f.chat_id) === Number(chatId) && f.tipo === chat.tipo
    );

    if (isFavorito) {
      await axios.delete("/api/chats/favoritos", {
        data: { usuarioId: userId, chatId, tipo: chat.tipo },
      });
      setFavoritos((prev) =>
        prev.filter((f) => !(Number(f.chat_id) === Number(chatId) && f.tipo === chat.tipo))
      );
    } else {
      await axios.post("/api/chats/favoritos", {
        usuarioId: userId,
        chatId,
        tipo: chat.tipo,
      });
      setFavoritos((prev) => [
        ...prev,
        { usuario_id: userId, chat_id: chatId, tipo: chat.tipo },
      ]);
    }
  };

  const actualizarEstadoChat = async (chat, cambios) => {
    const chatId = chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id;

    const res = await axios.post("/api/chats/estado", {
      usuarioId: userId,
      tipo: chat.tipo,
      chatId,
      ...cambios,
    });

    const nextEstado = {
      tipo: chat.tipo,
      chat_id: chatId,
      archivado: Number(res.data?.archivado ?? cambios.archivado ?? getEstadoChat(chat)?.archivado ?? 0),
      marcado_no_leido: Number(
        res.data?.marcado_no_leido ??
          cambios.marcadoNoLeido ??
          getEstadoChat(chat)?.marcado_no_leido ??
          0
      ),
      fijado: Number(res.data?.fijado ?? cambios.fijado ?? getEstadoChat(chat)?.fijado ?? 0),
    };

    setChatEstados((prev) => {
      const existe = prev.some(
        (estado) => estado.tipo === chat.tipo && Number(estado.chat_id) === Number(chatId)
      );

      if (existe) {
        return prev.map((estado) =>
          estado.tipo === chat.tipo && Number(estado.chat_id) === Number(chatId)
            ? { ...estado, ...nextEstado }
            : estado
        );
      }

      return [...prev, nextEstado];
    });

    return nextEstado;
  };

  const archivarChat = async (chat) => {
    try {
      const nextArchived = !estaArchivado(chat);
      await actualizarEstadoChat(chat, {
        archivado: nextArchived,
        marcadoNoLeido: nextArchived ? false : estaMarcadoNoLeido(chat),
      });

      setMenuChatAbierto(null);
      setMenuChatPosition(null);

      if (
        nextArchived &&
        selectedChat?.tipo === chat.tipo &&
        Number(selectedChat?.[chat.tipo === "grupo" ? "grupo_id" : "usuario_id"]) ===
          Number(chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id)
      ) {
        setSelectedChat(null);
      }

      toast.success(nextArchived ? "Chat archivado" : "Chat desarchivado");
    } catch (err) {
      console.error("❌ Error actualizando archivo de chat:", err);
      toast.error("No se pudo actualizar el archivo del chat");
    }
  };

  const fijarChat = async (chat) => {
    try {
      const nextPinned = !estaFijado(chat);
      await actualizarEstadoChat(chat, { fijado: nextPinned });
      setMenuChatAbierto(null);
      setMenuChatPosition(null);
      toast.success(nextPinned ? "Chat fijado" : "Chat desfijado");
    } catch (err) {
      console.error("❌ Error fijando chat:", err);
      toast.error("No se pudo actualizar el fijado");
    }
  };

  const marcarChatNoLeido = async (chat) => {
    try {
      await actualizarEstadoChat(chat, { marcadoNoLeido: !estaMarcadoNoLeido(chat) });
      setMenuChatAbierto(null);
      setMenuChatPosition(null);
      toast.success(estaMarcadoNoLeido(chat) ? "Chat marcado como leído" : "Chat marcado como no leído");
    } catch (err) {
      console.error("❌ Error marcando chat:", err);
      toast.error("No se pudo actualizar el chat");
    }
  };

  const handleSelectUsuarioComun = (usuario) => {
    const nuevoChat = {
      tipo: "privado",
      usuario_id: usuario.id,
      usuario_nombre: `${usuario.nombre} ${usuario.apellido}`,
      usuario_apellido: usuario.apellido,
      url_imagen: usuario.url_imagen,
      background: usuario.background,
      correo: usuario.correo,
      mensajes: [],
      esNuevo: true,
      lastTime: Date.now(), // ⚡ Importante
    };

    setChats((prev) => {
      const yaExiste = prev.some((c) => c.tipo === "privado" && c.usuario_id === usuario.id);
      if (!yaExiste) return [nuevoChat, ...prev].sort((a, b) => b.lastTime - a.lastTime);
      return prev;
    });

    onSelectChat(nuevoChat);
  };

  // -------------------------------
  // 🔹 Filtrar chats por búsqueda y chips tipo WhatsApp
  const isFavoriteChat = (chat) =>
    favoritos.some(
      (f) =>
        Number(f.chat_id) === Number(chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id) &&
        f.tipo === chat.tipo
    );

  const isUnreadChat = (chat) => Number(chat.mensajes_no_leidos || 0) > 0 || estaMarcadoNoLeido(chat);

  const normalizeText = (value = "") =>
    String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const chatMatchesSearch = (chat, term) => {
    const search = normalizeText(term).trim();
    if (!search) return true;

    const nombre = normalizeText(chat.usuario_nombre || "");
    const apellido = normalizeText(chat.usuario_apellido || "");
    const ultimoMensaje = normalizeText(chat.ultimo_mensaje || "");
    const preview = normalizeText(getPreviewText(getChatPreviewSource(chat)) || "");
    const miembros = chat.miembros
      ? normalizeText(chat.miembros.map((m) => `${m.nombre || ""} ${m.apellido || ""}`).join(" "))
      : "";

    return (
      nombre.includes(search) ||
      apellido.includes(search) ||
      ultimoMensaje.includes(search) ||
      preview.includes(search) ||
      miembros.includes(search)
    );
  };

  const sortChatsVisual = (lista) =>
    [...lista].sort((a, b) => {
      const pinnedDiff = Number(estaFijado(b)) - Number(estaFijado(a));
      if (pinnedDiff !== 0) return pinnedDiff;
      return (b.lastTime || 0) - (a.lastTime || 0);
    });

  const searchedChats = sortChatsVisual(
    chats.filter((chat) => chatMatchesSearch(chat, searchTerm))
  );

  const activeChats = searchedChats.filter((chat) => !estaArchivado(chat));
  const archivedChats = searchedChats.filter((chat) => estaArchivado(chat));

  const filterCounts = {
    todos: activeChats.length,
    unread: activeChats.filter(isUnreadChat).length,
    favoritos: activeChats.filter(isFavoriteChat).length,
    grupos: activeChats.filter((chat) => chat.tipo === "grupo").length,
    privados: activeChats.filter((chat) => chat.tipo === "privado").length,
    archivados: archivedChats.length,
  };

  const filteredChats = (activeFilter === "archivados" ? archivedChats : activeChats).filter((chat) => {
    if (activeFilter === "unread") return isUnreadChat(chat);
    if (activeFilter === "favoritos") return isFavoriteChat(chat);
    if (activeFilter === "grupos") return chat.tipo === "grupo";
    if (activeFilter === "privados") return chat.tipo === "privado";
    return true;
  });

  const handleSelectChat = async (chat) => {
    onSelectChat(chat);
    if (estaMarcadoNoLeido(chat)) {
      actualizarEstadoChat(chat, { marcadoNoLeido: false }).catch((err) =>
        console.error("❌ Error limpiando marcado como no leído:", err)
      );
    }
    try {
      if (chat.tipo === "grupo") {
         logDev("📡 Chat grupo seleccionado:", chat);
        if (!chat.ultimo_mensaje) return;

        await axios.put("/api/mensajes/grupo/marcar-vistos-grupo", {
          userId,
          grupoId: chat.grupo_id,
        });

        setMensajes((prev) =>
          prev.map((msg) =>
            msg.grupo_id === chat.grupo_id
              ? { ...msg, vistos: [...(msg.vistos || []), userId] }
              : msg
          )
        );
      } else {
        if (!chat.ultimo_mensaje) return;

        await axios.put("/api/mensajes/marcar-vistos", {
          userId,
          contactoId: chat.usuario_id,
        });

        setMensajes((prev) =>
          prev.map((msg) =>
            msg.usuario_envia_id === chat.usuario_id && msg.usuario_recibe_id === userId
              ? { ...msg, visto: 1 }
              : msg
          )
        );
      }
    } catch (err) {
      console.error("❌ Error al marcar mensajes como vistos:", err);
    }
  };

  const getChatId = (chat) => (chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id);

  const getChatTitle = (chat) => chat.usuario_nombre || (chat.tipo === "grupo" ? "Grupo" : "Usuario");

  const getPreviewPrefix = (chat) => {
    if (chat.eliminado === 1) return "";
    if (chat.tipo !== "grupo") return "";
    if (chat.tipo_mensaje === "enviado") return "Tú: ";
    if (chat.ultimo_remitente) return `${chat.ultimo_remitente}: `;
    return "";
  };

  const renderAvatar = (chat) => {
    const title = getChatTitle(chat);

    if (chat.tipo === "grupo") {
      return <GroupAvatar group={chat} members={chat.miembros} size={44} />;
    }

    if (chat.url_imagen) {
      return (
        <div className="wa-presence-wrapper">
          <img
            src={getAvatarUrl(chat.url_imagen)}
            alt={title}
            className="avatar-img rounded-circle"
            style={{ width: "44px", height: "44px", objectFit: "cover" }}
          />
          {renderPresenceBadge(chat.usuario_id)}
        </div>
      );
    }

    return (
      <div className="wa-presence-wrapper">
        <div
          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
          style={{
            width: "44px",
            height: "44px",
            backgroundColor: chat.background || "#6c757d",
            fontSize: "18px",
          }}
        >
          {getInitial(title)}
        </div>
        {renderPresenceBadge(chat.usuario_id)}
      </div>
    );
  };

  const renderTypingPreview = (chat) => {
    const entry = typingByChat[getChatKey(chat)];
    if (!entry) return null;

    const label = chat.tipo === "grupo" ? `${entry.nombre} está escribiendo` : "escribiendo";

    return (
      <span className="wa-chat-typing-preview">
        <span>{label}</span>
        <span className="wa-chat-typing-wave" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  };

  const renderReadStatus = (chat) => {
    if (chat.tipo_mensaje !== "enviado" || chat.eliminado === 1) return null;

    return (
      <span className="me-1 d-inline-flex wa-chat-checks" aria-label={chat.visto === 0 ? "Enviado" : "Visto"}>
        {chat.visto === 0 ? (
          <span className="svg15 double-check"></span>
        ) : (
          <span className="svg15 double-check-blue"></span>
        )}
      </span>
    );
  };

  const renderChatMenu = (chat) => {
    const chatKey = getChatKey(chat);
    const chatId = chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id;
    const silenciado = estaSilenciado(chat.tipo, chatId);
    const favorito = isFavoriteChat(chat);
    const marcadoNoLeido = estaMarcadoNoLeido(chat);
    const fijado = estaFijado(chat);
    const archivado = estaArchivado(chat);

    return (
      <>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();

            if (menuChatAbierto === chatKey) {
              setMenuChatAbierto(null);
              setMenuChatPosition(null);
              return;
            }

            const rect = e.currentTarget.getBoundingClientRect();
            const menuWidth = 280;
            const estimatedHeight = silenciado ? 330 : 280;
            const margin = 8;

            const left = Math.max(
              margin,
              Math.min(window.innerWidth - menuWidth - margin, rect.right - menuWidth)
            );

            let top = rect.bottom + margin;
            if (top + estimatedHeight > window.innerHeight - margin) {
              top = Math.max(margin, rect.top - estimatedHeight - margin);
            }

            setMenuChatPosition({ top, left });
            setMenuChatAbierto(chatKey);
          }}
          className="btn btn-sm border-0 bg-transparent p-0 ms-2 text-muted chat-options-btn wa-chat-action-btn"
          title="Opciones"
          aria-expanded={menuChatAbierto === chatKey}
        >
          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
        </button>

        {menuChatAbierto === chatKey && createPortal(
          <div
            className="shadow-sm border rounded-3 bg-white wa-chat-options-menu wa-chat-options-menu-lg"
            style={
              menuChatPosition
                ? { top: `${menuChatPosition.top}px`, left: `${menuChatPosition.left}px` }
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dropdown-item wa-chat-option-item"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                archivarChat(chat);
              }}
            >
              <i className={archivado ? "fa-solid fa-box-open" : "fa-solid fa-box-archive"} aria-hidden="true" />
              <span>{archivado ? "Desarchivar chat" : "Archivar chat"}</span>
            </button>

            <button
              className="dropdown-item wa-chat-option-item"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                fijarChat(chat);
              }}
            >
              <i className="fa-solid fa-thumbtack" aria-hidden="true" />
              <span>{fijado ? "Desfijar chat" : "Fijar chat"}</span>
            </button>

            <div className="wa-submenu-wrapper">
              <button
                className="dropdown-item wa-chat-option-item wa-chat-option-has-submenu"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <i className="fa-solid fa-bell-slash" aria-hidden="true" />
                <span>{silenciado ? "Silenciado" : "Silenciar notificaciones"}</span>
                <i className="fa-solid fa-chevron-right wa-submenu-chevron" aria-hidden="true" />
              </button>

              <div className="shadow-sm border rounded-3 bg-white wa-chat-options-submenu">
                {silenciado && (
                  <button
                    className="dropdown-item wa-chat-option-item"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      actualizarSilencioChat(chat, null);
                      setMenuChatAbierto(null);
                      setMenuChatPosition(null);
                    }}
                  >
                    <i className="fa-solid fa-bell" aria-hidden="true" />
                    <span>Reactivar notificaciones</span>
                  </button>
                )}
                <button
                  className="dropdown-item wa-chat-option-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    actualizarSilencioChat(chat, "8h");
                    setMenuChatAbierto(null);
                    setMenuChatPosition(null);
                  }}
                >
                  <span>8 horas</span>
                </button>
                <button
                  className="dropdown-item wa-chat-option-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    actualizarSilencioChat(chat, "1w");
                    setMenuChatAbierto(null);
                    setMenuChatPosition(null);
                  }}
                >
                  <span>1 semana</span>
                </button>
                <button
                  className="dropdown-item wa-chat-option-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    actualizarSilencioChat(chat, "always");
                    setMenuChatAbierto(null);
                    setMenuChatPosition(null);
                  }}
                >
                  <span>Siempre</span>
                </button>
              </div>
            </div>

            <button
              className="dropdown-item wa-chat-option-item"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                marcarChatNoLeido(chat);
              }}
            >
              <i className="fa-solid fa-envelope-circle-check" aria-hidden="true" />
              <span>{marcadoNoLeido ? "Marcar como leído" : "Marcar como no leído"}</span>
            </button>

            <button
              className="dropdown-item wa-chat-option-item"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await toggleFavorito(chat);
                  setMenuChatAbierto(null);
                  setMenuChatPosition(null);
                  toast.success(favorito ? "Quitado de favoritos" : "Añadido a Favoritos");
                } catch (err) {
                  console.error("❌ Error actualizando favorito:", err);
                  toast.error("No se pudo actualizar favoritos");
                }
              }}
            >
              <i className={favorito ? "fa-solid fa-heart-crack" : "fa-regular fa-heart"} aria-hidden="true" />
              <span>{favorito ? "Quitar de Favoritos" : "Añadir a Favoritos"}</span>
            </button>
          </div>,
          document.body
        )}
      </>
    );
  };

  const renderChatItem = (chat) => {
    const isSelected =
      selectedChat?.tipo === chat.tipo &&
      Number(getChatId(selectedChat)) === Number(getChatId(chat));
    const isMuted = estaSilenciado(chat.tipo, getChatId(chat));
    const previewPrefix = getPreviewPrefix(chat);
    const typingPreview = renderTypingPreview(chat);

    return (
      <a
        key={`${chat.tipo}-${getChatId(chat)}`}
        href="#"
        className={`card border-0 text-reset chat-card-hover wa-chat-list-card ${isSelected ? "active" : ""} ${estaArchivado(chat) ? "is-archived" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          handleSelectChat(chat);
        }}
      >
        <div className="card-body wa-chat-list-card-body">
          <div className="wa-chat-list-row">
            <div className="avatar avatar-xl wa-chat-list-avatar">
              {renderAvatar(chat)}
            </div>

            <div className="wa-chat-list-main">
              <div className="wa-chat-list-top">
                <h5 className="wa-chat-list-title">
                  <span className="text-truncate">{getChatTitle(chat)}</span>
                  {estaFijado(chat) && (
                    <i className="fa-solid fa-thumbtack wa-pinned-icon" title="Chat fijado" aria-hidden="true" />
                  )}
                  {estaArchivado(chat) && (
                    <i className="fa-solid fa-box-archive wa-archived-icon" title="Chat archivado" aria-hidden="true" />
                  )}
                  {isMuted && (
                    <i className="fa-solid fa-bell-slash wa-muted-icon" title="Chat silenciado" aria-hidden="true" />
                  )}
                </h5>
                <span className={`wa-chat-list-time ${chat.mensajes_no_leidos > 0 ? "has-unread" : ""}`}>
                  {formatChatTime(chat.fecha_envio)}
                </span>
                {renderChatMenu(chat)}
              </div>

              <div className="wa-chat-list-bottom">
                {renderReadStatus(chat)}
                <div className="line-clamp wa-chat-list-preview">
                  {typingPreview ? (
                    typingPreview
                  ) : chat.eliminado === 1 ? (
                    <span className="fst-italic text-muted d-inline-flex align-items-center gap-1">
                      <i className="fa-solid fa-ban" aria-hidden="true" />
                      Se eliminó este mensaje
                    </span>
                  ) : (
                    <>
                      {previewPrefix && <span className="wa-preview-prefix">{previewPrefix}</span>}
                      {renderChatPreview(chat)}
                    </>
                  )}
                </div>
                {chat.mensajes_no_leidos > 0 ? (
                  <div className="wa-unread-badge">
                    <span>{chat.mensajes_no_leidos}</span>
                  </div>
                ) : estaMarcadoNoLeido(chat) ? (
                  <div className="wa-unread-dot" title="Marcado como no leído" />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </a>
    );
  };

  const filterLabel = {
    todos: "Todos",
    unread: "No leídos",
    favoritos: "Favoritos",
    grupos: "Grupos",
    privados: "Individuales",
    archivados: "Archivados",
  }[activeFilter];

  return (
    <aside className="sidebar bg-light">
      <div className="tab-pane fade h-100 active show" id="tab-content-chats" role="tabpanel">
        <div className="d-flex flex-column h-100 position-relative">
          <div className="hide-scrollbar">
            <div className="container py-4">
              <div className="mb-8">
                <h2 className="fw-bold m-0">Chats</h2>
              </div>

              <div className="mb-3">
                <div className="input-group wa-chat-search">
                  <div className="input-group-text">
                    <div className="icon icon-lg">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="feather feather-search"
                      >
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="form-control form-control-lg ps-0"
                    placeholder="Buscar un chat o iniciar uno nuevo"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="wa-filter-row" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`wa-filter-chip ${activeFilter === "todos" ? "active" : ""}`}
                  onClick={() => setActiveFilter("todos")}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className={`wa-filter-chip ${activeFilter === "unread" ? "active" : ""}`}
                  onClick={() => setActiveFilter("unread")}
                >
                  No leídos{filterCounts.unread > 0 ? ` ${filterCounts.unread}` : ""}
                </button>
                <button
                  type="button"
                  className={`wa-filter-chip ${activeFilter === "favoritos" ? "active" : ""}`}
                  onClick={() => setActiveFilter("favoritos")}
                >
                  Favoritos
                </button>
                <div className="wa-filter-more-wrap">
                  <button
                    type="button"
                    className={`wa-filter-chip wa-filter-more ${["grupos", "privados"].includes(activeFilter) ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterMenuOpen((prev) => !prev);
                    }}
                    title="Más filtros"
                  >
                    <span>{["grupos", "privados"].includes(activeFilter) ? filterLabel : ""}</span>
                    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                  </button>

                  {filterMenuOpen && (
                    <div className="wa-filter-dropdown shadow-sm">
                      <button
                        type="button"
                        className={activeFilter === "grupos" ? "active" : ""}
                        onClick={() => {
                          setActiveFilter("grupos");
                          setFilterMenuOpen(false);
                        }}
                      >
                        <span>Grupos</span>
                        <span>{filterCounts.grupos}</span>
                      </button>
                      <button
                        type="button"
                        className={activeFilter === "privados" ? "active" : ""}
                        onClick={() => {
                          setActiveFilter("privados");
                          setFilterMenuOpen(false);
                        }}
                      >
                        <span>Chats individuales</span>
                        <span>{filterCounts.privados}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {filterCounts.archivados > 0 && (
                <button
                  type="button"
                  className={`wa-archived-shortcut ${activeFilter === "archivados" ? "active" : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveFilter(activeFilter === "archivados" ? "todos" : "archivados");
                  }}
                  title="Ver chats archivados"
                >
                  <span className="wa-archived-shortcut-icon">
                    <i className="fa-solid fa-box-archive" aria-hidden="true" />
                  </span>
                  <span className="wa-archived-shortcut-text">Archivados</span>
                  <span className="wa-archived-shortcut-count">{filterCounts.archivados}</span>
                </button>
              )}

              {usuariosComunes.length > 0 && searchTerm.trim() !== "" && (
                <div className="mt-3 mb-3 wa-common-users">
                  <h6 className="fw-bold text-muted mb-2">Personas en proyectos comunes</h6>
                  {usuariosComunes.map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      className="wa-common-user-card"
                      onClick={(e) => {
                        e.preventDefault();
                        handleSelectUsuarioComun(u);
                      }}
                    >
                      {u.url_imagen ? (
                        <img
                          src={getAvatarUrl(u.url_imagen)}
                          alt={u.nombre}
                          className="rounded-circle me-2"
                          style={{ width: "40px", height: "40px", objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold me-2"
                          style={{
                            width: "40px",
                            height: "40px",
                            backgroundColor: u.background || "#6c757d",
                          }}
                        >
                          {getInitial(u.nombre)}
                        </div>
                      )}
                      <div className="text-start">
                        <div className="fw-bold">{u.nombre} {u.apellido}</div>
                        <div className="fst-italic text-muted">Iniciar conversación</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="card-list wa-chat-list">
                {filteredChats.length > 0 ? (
                  filteredChats.map(renderChatItem)
                ) : (
                  <div className="wa-empty-filter">
                    <i className="fa-regular fa-comment-dots" aria-hidden="true" />
                    <p className="mb-1">No hay chats para este filtro</p>
                    <span>
                      {activeFilter === "todos"
                        ? "Prueba buscando otro nombre o mensaje."
                        : activeFilter === "archivados"
                        ? "Cuando archives un chat, aparecerá aquí."
                        : "Cambia a Todos para ver todas tus conversaciones."}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default ChatList;