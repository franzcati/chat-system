import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import ChatBody from "../components/ChatBody";
import MiembrosGrupos from "../components/MiembrosGrupos";
import VerInfoGrupo from "../components/VerInfoGrupo";
import VerInfoContacto from "../components/VerInfoContacto";
import VerArchivos from "../components/VerArchivos";
import ProfileModal from "../components/ProfileModal";
import { useTheme } from "../context/ThemeContext";
import socket from "../socket";
import * as bootstrap from "bootstrap";
import { logDev } from "../utils/logger";
import { getAvatarUrl } from "../utils/url";
import { getMessagePreview, getReplyAuthorName } from "../utils/messagePreview";
import { getProfileTitleStyle } from "../utils/profileColor";
import { renderRichTextInline } from "../utils/richText.jsx";
import ChatInput from "../components/ChatInput";
import GroupAvatar from "../components/GroupAvatar";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import "../css/emoji.css";


const MESSAGE_PAGE_SIZE = 50;
const GROUP_CONTEXT_PAGE_SIZE = 80;

const getChatKey = (chat) => {
  if (!chat) return "sin-chat";
  return chat.tipo === "grupo"
    ? `grupo-${chat.grupo_id}`
    : `privado-${chat.usuario_id}`;
};

const extractMessagesPayload = (data) => {
  const mensajes = Array.isArray(data)
    ? data
    : Array.isArray(data?.mensajes)
      ? data.mensajes
      : [];

  const mensajesFijados = Array.isArray(data?.mensajes_fijados)
    ? data.mensajes_fijados
    : [];

  return {
    mensajes,
    mensajesFijados,
    hasMore: Boolean(data?.hasMore),
    nextBeforeId: data?.nextBeforeId ?? (mensajes.length ? mensajes[0].id : null),
  };
};

const getMessageSortTime = (message) => {
  const time = new Date(message?.fecha_envio || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

const sortAndDedupeMessages = (items) => {
  const map = new Map();

  items.forEach((message) => {
    if (!message) return;
    const key = String(message.id ?? `${message.fecha_envio}-${message.mensaje}`);
    const previous = map.get(key);

    map.set(key, {
      ...(previous || {}),
      ...message,
      reacciones: message.reacciones || previous?.reacciones || [],
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    const byDate = getMessageSortTime(a) - getMessageSortTime(b);
    if (byDate !== 0) return byDate;

    const aId = Number(a.id);
    const bId = Number(b.id);
    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;

    return String(a.id || "").localeCompare(String(b.id || ""));
  });
};



const isTempOutgoingMessage = (message) => {
  const id = message?.id;
  return typeof id === "string" && id.startsWith("temp-");
};

const getOutgoingSenderId = (message) => Number(message?.usuario_id ?? message?.usuario_envia_id);

const normalizeMessageText = (value) => String(value ?? "").trim();

const isStickerText = (value) => normalizeMessageText(value).startsWith("[sticker]");

const getMessageUploadKind = (message) => {
  const text = normalizeMessageText(message?.mensaje);
  const fileUrl = normalizeMessageText(message?.archivo_url || message?.url);
  const type = normalizeMessageText(message?.tipo_archivo).toLowerCase();

  if (isStickerText(text)) return "sticker";

  const looksLikeImage =
    type.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(fileUrl || text);

  if (looksLikeImage) return "image";
  return null;
};

const isSameUploadPayload = (optimisticMessage, serverMessage) => {
  const localKind = getMessageUploadKind(optimisticMessage);
  const serverKind = getMessageUploadKind(serverMessage);

  if (!localKind || !serverKind || localKind !== serverKind) return false;

  // Los stickers nuevos se muestran con un blob local mientras suben y el
  // servidor devuelve /uploads/..., por eso no se puede comparar la URL.
  if (localKind === "sticker") return true;

  const localName = normalizeMessageText(optimisticMessage?.nombre_archivo);
  const serverName = normalizeMessageText(serverMessage?.nombre_archivo);
  const localSize = Number(optimisticMessage?.tamano || 0);
  const serverSize = Number(serverMessage?.tamano || 0);
  const localBatch = normalizeMessageText(optimisticMessage?.lote_id);
  const serverBatch = normalizeMessageText(serverMessage?.lote_id);

  if (localName && serverName && localName === serverName) return true;
  if (localSize && serverSize && localSize === serverSize) return true;

  // Fallback para respuestas que no devuelvan nombre/tamaño. Sólo se usa con
  // mensajes temporales y una ventana corta de tiempo, así evitamos duplicados
  // sin tocar mensajes normales.
  if (localBatch && serverBatch && localBatch === serverBatch) return true;

  return false;
};

const isSameOptimisticPayload = (optimisticMessage, serverMessage) => {
  const localText = normalizeMessageText(optimisticMessage?.mensaje);
  const serverText = normalizeMessageText(serverMessage?.mensaje);

  if (localText && serverText && localText === serverText) return true;

  const localFile = normalizeMessageText(optimisticMessage?.archivo_url);
  const serverFile = normalizeMessageText(serverMessage?.archivo_url);
  if (localFile && serverFile && localFile === serverFile) return true;

  return isSameUploadPayload(optimisticMessage, serverMessage);
};

const isNearOptimisticTime = (optimisticMessage, serverMessage) => {
  const localTime = getMessageSortTime(optimisticMessage);
  const serverTime = getMessageSortTime(serverMessage);
  if (!localTime || !serverTime) return true;
  return Math.abs(localTime - serverTime) <= 5 * 60 * 1000;
};

const isMatchingOptimisticMessage = (optimisticMessage, serverMessage, currentUserId) => {
  if (!isTempOutgoingMessage(optimisticMessage)) return false;
  if (getOutgoingSenderId(optimisticMessage) !== Number(currentUserId)) return false;
  if (getOutgoingSenderId(serverMessage) !== Number(currentUserId)) return false;
  if (!isSameOptimisticPayload(optimisticMessage, serverMessage)) return false;
  return isNearOptimisticTime(optimisticMessage, serverMessage);
};

const replaceMatchingOptimisticMessage = (messages, serverMessage, currentUserId) => {
  let replaced = false;

  const merged = messages.map((message) => {
    if (replaced || !isMatchingOptimisticMessage(message, serverMessage, currentUserId)) {
      return message;
    }

    replaced = true;
    return {
      ...message,
      ...serverMessage,
      estado: "enviado",
      reacciones: serverMessage.reacciones || message.reacciones || [],
    };
  });

  return {
    messages: sortAndDedupeMessages(merged),
    replaced,
  };
};

const applyPinnedToMessages = (mensajes, mensajesFijados) => {
  const pinnedMap = new Map(
    (mensajesFijados || [])
      .map((message) => [String(message.mensaje_id || message.id), message])
      .filter(([id]) => id && id !== "undefined")
  );

  return mensajes.map((message) => {
    const pinned = pinnedMap.get(String(message.id));
    return {
      ...message,
      fijado: pinned ? 1 : message.fijado ? 1 : 0,
      fecha_fijado: pinned?.fecha_fijado || message.fecha_fijado || null,
    };
  });
};

const getPreferredAudioMimeType = () => {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];

  return candidates.find((type) => window.MediaRecorder.isTypeSupported(type)) || "";
};

const getAudioExtensionFromMimeType = (mimeType = "") => {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
};

const esArchivoAudio = (file) => {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return mime.startsWith("audio/") || /\.(webm|ogg|m4a|mp3|wav|aac|opus)$/i.test(name);
};

const permisoChatActivo = (permisos, campo) => {
  let parsed = permisos || {};

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  const valor = parsed?.[campo];
  return valor === 1 || valor === "1" || valor === true || valor === "true";
};

const RECORDER_WAVE_BAR_COUNT = 42;
const RECORDER_WAVE_SAMPLE_INTERVAL_MS = 70;
const RECORDER_SILENCE_THRESHOLD = 0.018;

const clampRecorderLevel = (value) => Math.max(0, Math.min(1, value));

const buildIdleRecorderWave = () =>
  Array.from({ length: RECORDER_WAVE_BAR_COUNT }, () => 0);


const STICKER_EDITOR_FILTERS = {
  none: { label: "Ninguno", css: "none" },
  pop: { label: "Pop", css: "saturate(1.35) contrast(1.08) brightness(1.03)" },
  bw: { label: "B/N", css: "grayscale(1) contrast(1.08)" },
  cold: { label: "Frío", css: "saturate(1.08) hue-rotate(190deg) brightness(1.03)" },
  chrome: { label: "Cromo", css: "saturate(1.55) contrast(1.22)" },
  cine: { label: "Cine", css: "contrast(1.16) brightness(0.94) sepia(0.12)" },
};

const STICKER_EDITOR_COLORS = [
  "#4b5563",
  "#9ca3af",
  "#ffffff",
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#fb923c",
  "#ef4444",
];


const ChatBox = ({ chat, user, setChat, onVerPerfil, onAddToList }) => {

  const [messages, setMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextBeforeId, setNextBeforeId] = useState(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyJumpTarget, setReplyJumpTarget] = useState(null);

    // 👇 NUEVO
  const [pendingImages, setPendingImages] = useState([]); // {id, file, preview}
  const [activeImageIndex, setActiveImageIndex] = useState(0); // 👈 NUEVO
  const [isDragOver, setIsDragOver] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioWaveSamples, setAudioWaveSamples] = useState(() => buildIdleRecorderWave());
  const [isSendingAudio, setIsSendingAudio] = useState(false);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false); // 👈 control del picker
  const [offcanvasGrupo, setOffcanvasGrupo] = useState(null);
  const [mostrarInfoGrupo, setMostrarInfoGrupo] = useState(false);
  const [mostrarInfoContacto, setMostrarInfoContacto] = useState(false);
  const [contactoInfoArchivos, setContactoInfoArchivos] = useState([]);
  const [mostrarVerArchivos, setMostrarVerArchivos] = useState(false);
  const [mostrarMenuLlamada, setMostrarMenuLlamada] = useState(false);
  const [searchRequestToken, setSearchRequestToken] = useState(null);
  const [estadosUsuarios, setEstadosUsuarios] = useState({});
  // 👇 referencia al último mensaje
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null); // ref para el ChatInput optimizado
  // arriba de tu componente
  const emojiRef = useRef(null);   // ref para el contenedor del picker
  const emojiBtnRef = useRef(null); // ref para el botón
  const gifRef = useRef(null);   // ref para el contenedor del picker
  const gifBtnRef = useRef(null); // ref para el botón
  const stickerRef = useRef(null);   // ref para el contenedor del picker
  const stickerBtnRef = useRef(null); // ref para el botón
  const stickerFileInputRef = useRef(null);
  const stickerEditorCanvasRef = useRef(null);
  const stickerEditorImageRef = useRef(null);
  const stickerDrawingRef = useRef(false);
  const stickerCropDragRef = useRef(null);
  const typingStopTimeoutRef = useRef(null);
  const typingSenderStateRef = useRef({ isTyping: false, key: null, payload: null, lastStartAt: 0 });
  const typingUsersTimeoutRef = useRef({});
  const callMenuRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingReplyRef = useRef(null);
  const discardRecordingRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const audioAnimationFrameRef = useRef(null);
  const audioSmoothedLevelRef = useRef(0);
  const audioLastWaveSampleAtRef = useRef(0);
  const audioPausedRef = useRef(false);
  const pendingUploadsRef = useRef(new Map());
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState(""); // texto a buscar
  const [gifResults, setGifResults] = useState([]); // resultados de la API
  const { theme } = useTheme();
  const emojiTheme = theme === "dark" ? "dark" : "light";
  const puedeGrabarAudios = permisoChatActivo(user?.permisos_chat, "enviar_audios");
  const acceptAdjuntos = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt";

  useEffect(() => {
    setMostrarInfoGrupo(false);
    setMostrarInfoContacto(false);
    setContactoInfoArchivos([]);
  }, [chat?.tipo, chat?.grupo_id, chat?.usuario_id]);

  const replyTitleStyle = useMemo(
    () => (replyingTo ? getProfileTitleStyle(replyingTo, user, theme) : {}),
    [replyingTo, user, theme]
  );

  // STICKER
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showStickerEditor, setShowStickerEditor] = useState(false);
  const [pendingStickerFile, setPendingStickerFile] = useState(null);
  const [pendingStickerPreview, setPendingStickerPreview] = useState("");
  const [stickerEditorRotation, setStickerEditorRotation] = useState(0);
  const [stickerEditorFlipX, setStickerEditorFlipX] = useState(false);
  const [stickerEditorTool, setStickerEditorTool] = useState("crop");
  const [stickerEditorFilter, setStickerEditorFilter] = useState("none");
  const [stickerDrawColor, setStickerDrawColor] = useState("#22c55e");
  const [stickerShapeType, setStickerShapeType] = useState("rect");
  const [stickerTextItems, setStickerTextItems] = useState([]);
  const [stickerShapeItems, setStickerShapeItems] = useState([]);
  const [stickerDrawPaths, setStickerDrawPaths] = useState([]);
  const [stickerCropRect, setStickerCropRect] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [isCreatingSticker, setIsCreatingSticker] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [forwardSelectionMode, setForwardSelectionMode] = useState(false);
  const [forwardSelectedMessages, setForwardSelectedMessages] = useState([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTargets, setForwardTargets] = useState([]);
  const [forwardSelectedTargets, setForwardSelectedTargets] = useState([]);
  const [forwardSearch, setForwardSearch] = useState("");
  const [isForwardingMessages, setIsForwardingMessages] = useState(false);

  // pestaña activa: "todos" o "favoritos" (si luego quieres más)
  const [stickerTab, setStickerTab] = useState("todos");

  // Catálogo completo
  const [stickersTodos, setStickersTodos] = useState([]);

  // Solo favoritos del usuario
  const [stickersFavoritos, setStickersFavoritos] = useState([]);

  const listaStickers =
  stickerTab === "favoritos" ? stickersFavoritos : stickersTodos;

  const normalizeStickerMessageUrl = useCallback((url = "") => {
    let cleanUrl = String(url || "").trim().replace(/^(\[sticker\])+/i, "");

    if (cleanUrl.startsWith("/api/uploads/")) {
      cleanUrl = cleanUrl.replace(/^\/api/, "");
    }

    if (cleanUrl.startsWith("uploads/")) {
      cleanUrl = `/${cleanUrl}`;
    }

    if (/^https?:\/\//i.test(cleanUrl)) {
      try {
        const parsed = new URL(cleanUrl);
        if (parsed.pathname.startsWith("/uploads/")) {
          cleanUrl = `${parsed.pathname}${parsed.search}`;
        }
      } catch (err) {
        // Dejamos la URL original si no se puede parsear.
      }
    }

    return cleanUrl;
  }, []);

  const getStickerImageUrl = useCallback((url = "") => {
    const cleanUrl = normalizeStickerMessageUrl(url);
    if (!cleanUrl) return "";
    if (/^(blob:|data:|https?:\/\/)/i.test(cleanUrl)) return cleanUrl;
    if (cleanUrl.startsWith("/uploads/")) return getAvatarUrl(cleanUrl);
    return cleanUrl;
  }, [normalizeStickerMessageUrl]);

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
    return () => {
      if (["recording", "paused"].includes(audioRecorderRef.current?.state)) {
        discardRecordingRef.current = true;
        audioRecorderRef.current.stop();
      }
      audioStreamRef.current?.getTracks?.().forEach((track) => track.stop());
      stopAudioMeter();
    };
  }, []);

  useEffect(() => {
    if (!isRecordingAudio || isAudioPaused) return undefined;

    const timer = window.setInterval(() => {
      setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRecordingAudio, isAudioPaused]);

  const mentionOptions = useMemo(() => {
    if (!chat) return [];

    const normalizarNombre = (value) => String(value || "").trim();

    if (chat.tipo === "grupo") {
      const miembros = Array.isArray(chat.miembros) ? chat.miembros : [];
      const usuarios = miembros
        .filter((m) => Number(m.id) !== Number(user?.id))
        .map((m) => {
          const nombreCompleto = `${normalizarNombre(m.nombre)} ${normalizarNombre(m.apellido)}`.trim();

          return {
            id: m.id,
            type: "user",
            label: nombreCompleto || m.correo || `usuario${m.id}`,
            subtitle: m.correo || "Miembro del grupo",
            correo: m.correo || "",
            background: m.background || "#6c757d",
            url_imagen: m.url_imagen || null,
          };
        });

      return [
        {
          id: "todos",
          type: "all",
          label: "todos",
          subtitle: "Mencionar a todos los miembros",
          background: "#2787F5",
        },
        ...usuarios,
      ];
    }

    return [
      {
        id: chat.usuario_id,
        type: "user",
        label: chat.usuario_nombre || chat.usuario_correo || "usuario",
        subtitle: chat.usuario_correo || "Usuario del chat",
        correo: chat.usuario_correo || "",
        background: chat.background || "#6c757d",
        url_imagen: chat.url_imagen || null,
      },
    ].filter((m) => m.id);
  }, [chat, user?.id]);

  const getTypingPayload = useCallback(() => {
    if (!chat || !user?.id) return null;

    return {
      tipo: chat.tipo === "grupo" ? "grupo" : "privado",
      grupoId: chat.tipo === "grupo" ? chat.grupo_id : null,
      receiverId: chat.tipo === "grupo" ? null : chat.usuario_id,
      senderId: user.id,
      nombre: user.nombre || "Usuario",
      apellido: user.apellido || "",
    };
  }, [chat, user?.id, user?.nombre, user?.apellido]);

  const getTypingPayloadKey = (payload) => {
    if (!payload) return "";
    return payload.tipo === "grupo"
      ? `grupo-${payload.grupoId}`
      : `privado-${payload.receiverId}`;
  };

  const emitTypingStop = useCallback((payloadOverride = null) => {
    const payload = payloadOverride || typingSenderStateRef.current.payload || getTypingPayload();
    if (!payload) return;

    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }

    socket.emit("typing:stop", payload);
    typingSenderStateRef.current = {
      isTyping: false,
      key: null,
      payload: null,
      lastStartAt: 0,
    };
  }, [getTypingPayload]);

  useEffect(() => {
    if (!chat || !user?.id) return undefined;

    const payload = getTypingPayload();
    const payloadKey = getTypingPayloadKey(payload);
    const previousPayload = typingSenderStateRef.current.payload;
    const previousKey = typingSenderStateRef.current.key;
    const hasText = Boolean(inputText.trim());

    if (!payload || !hasText) {
      if (typingSenderStateRef.current.isTyping) {
        emitTypingStop(previousPayload || payload);
      }
      return undefined;
    }

    if (typingSenderStateRef.current.isTyping && previousKey && previousKey !== payloadKey) {
      emitTypingStop(previousPayload);
    }

    const now = Date.now();
    const shouldEmitStart =
      !typingSenderStateRef.current.isTyping ||
      typingSenderStateRef.current.key !== payloadKey ||
      now - typingSenderStateRef.current.lastStartAt >= 1200;

    if (shouldEmitStart) {
      socket.emit("typing:start", payload);
      typingSenderStateRef.current = {
        isTyping: true,
        key: payloadKey,
        payload,
        lastStartAt: now,
      };
    }

    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = window.setTimeout(() => {
      emitTypingStop(payload);
    }, 2400);

    return undefined;
  }, [inputText, chat?.tipo, chat?.grupo_id, chat?.usuario_id, user?.id, getTypingPayload, emitTypingStop]);

  useEffect(() => {
    return () => {
      const payload = typingSenderStateRef.current.payload;
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      if (payload) socket.emit("typing:stop", payload);
    };
  }, []);

  useEffect(() => {
    if (!chat || !user?.id) return undefined;

    setTypingUsers([]);

    const handleTypingUpdate = (payload = {}) => {
      const senderId = Number(payload.senderId);
      if (!senderId || senderId === Number(user.id)) return;

      const isSameChat = chat.tipo === "grupo"
        ? payload.tipo === "grupo" && Number(payload.grupoId) === Number(chat.grupo_id)
        : payload.tipo === "privado" && Number(senderId) === Number(chat.usuario_id);

      if (!isSameChat) return;

      if (!payload.isTyping) {
        setTypingUsers((prev) => prev.filter((item) => Number(item.senderId) !== senderId));
        if (typingUsersTimeoutRef.current[senderId]) {
          window.clearTimeout(typingUsersTimeoutRef.current[senderId]);
          delete typingUsersTimeoutRef.current[senderId];
        }
        return;
      }

      const at = payload.at || Date.now();
      const nombre = [payload.nombre, payload.apellido].filter(Boolean).join(" ").trim() || "Usuario";

      setTypingUsers((prev) => {
        const withoutUser = prev.filter((item) => Number(item.senderId) !== senderId);
        return [...withoutUser, { senderId, nombre, at }];
      });

      if (typingUsersTimeoutRef.current[senderId]) {
        window.clearTimeout(typingUsersTimeoutRef.current[senderId]);
      }

      typingUsersTimeoutRef.current[senderId] = window.setTimeout(() => {
        setTypingUsers((prev) => prev.filter((item) => !(Number(item.senderId) === senderId && item.at === at)));
        delete typingUsersTimeoutRef.current[senderId];
      }, 3600);
    };

    socket.on("typing:update", handleTypingUpdate);
    return () => {
      socket.off("typing:update", handleTypingUpdate);
      Object.values(typingUsersTimeoutRef.current).forEach((timer) => window.clearTimeout(timer));
      typingUsersTimeoutRef.current = {};
    };
  }, [chat?.tipo, chat?.grupo_id, chat?.usuario_id, user?.id]);

  const getTypingHeaderText = () => {
    if (!typingUsers.length) return "";
    if (chat?.tipo === "grupo") {
      return `${typingUsers[0].nombre} está escribiendo...`;
    }
    return "escribiendo...";
  };


  const crearLoteId = () =>
  `lote-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const clearPendingImages = () => {
    setPendingImages([]);      // 👈 solo limpiamos el estado
    setActiveImageIndex(0);
  };

  useEffect(() => {
    const handleKey = (e) => {
      if (!pendingImages.length) return;

      if (e.key === "Escape") {
        clearPendingImages();
        return;
      }

      if (e.key === "ArrowRight") {
        setActiveImageIndex((prev) =>
          (prev + 1) % pendingImages.length
        );
      }

      if (e.key === "ArrowLeft") {
        setActiveImageIndex((prev) =>
          prev - 1 < 0 ? pendingImages.length - 1 : prev - 1
        );
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pendingImages.length]);

  // 👇 Nueva función para agregar mensaje de grupo al estado (reutilizable)
  const agregarMensajeGrupo = (msg) => {
    if (!chat || !user) return;
    if (msg.grupo_id !== chat.grupo_id) return;

    const tipoMensaje = msg.usuario_id === user.id ? "enviado" : "recibido";
    const mensajeTransformado = {
      ...msg,
      tipo_mensaje: tipoMensaje,
      visto: 0,
    };

    setMessages((prev) => {
      const existente = prev.find((m) => Number(m.id) === Number(msg.id));

      if (existente) {
        // Ya lo teníamos por socket/POST; solo mergeamos datos nuevos.
        return prev.map((m) =>
          Number(m.id) === Number(msg.id)
            ? {
                ...m,
                ...mensajeTransformado,
                estado: "enviado",
                reacciones: m.reacciones || mensajeTransformado.reacciones || [],
              }
            : m
        );
      }

      // Si el mensaje llegó por socket después de mostrarse como temporal,
      // reemplazamos ese temporal en vez de agregar otra burbuja.
      const optimisticResult = replaceMatchingOptimisticMessage(prev, mensajeTransformado, user.id);
      if (optimisticResult.replaced) return optimisticResult.messages;

      // Primera vez que lo vemos ⇒ lo añadimos.
      return sortAndDedupeMessages([
        ...prev,
        {
          ...mensajeTransformado,
          estado: "enviado",
          reacciones: mensajeTransformado.reacciones || [],
        },
      ]);
    });
  };

  // El scroll principal lo controla ChatBody. Esto evita que al cargar
  // mensajes antiguos el chat salte otra vez al final.

  // 🔹 Cargar sólo la última página del historial cuando cambia el chat.
  // Así el chat entra rápido, como WhatsApp, aunque la conversación sea larga.
  useEffect(() => {
    if (!chat || !user?.id) return;

    setReplyingTo(chat.__privateReplyDraft || null);
    if (chat.__privateReplyDraft) {
      setTimeout(() => inputRef.current?.focus?.(), 0);
    }
    let cancelado = false;
    const chatKey = getChatKey(chat);

    const cargarMensajes = async () => {
      setMessages([]);
      setPinnedMessages([]);
      setHasMoreMessages(false);
      setNextBeforeId(null);
      setIsLoadingMessages(true);

      try {
        if (chat.tipo === "grupo") {
          const jumpMessageId = chat.__jumpToMessageId || null;
          const endpoint = jumpMessageId
            ? `/api/mensajes/grupo/${chat.grupo_id}/contexto/${jumpMessageId}`
            : `/api/mensajes/grupo/${chat.grupo_id}`;

          const resMensajes = await axios.get(endpoint, {
            params: jumpMessageId
              ? { limit: GROUP_CONTEXT_PAGE_SIZE }
              : {
                  paginated: 1,
                  limit: MESSAGE_PAGE_SIZE,
                },
          });

          if (cancelado || chatKey !== getChatKey(chat)) return;

          const {
            mensajes,
            mensajesFijados,
            hasMore,
            nextBeforeId: nextId,
          } = extractMessagesPayload(resMensajes.data);

          setPinnedMessages(mensajesFijados);
          setMessages(sortAndDedupeMessages(applyPinnedToMessages(mensajes, mensajesFijados)));
          setHasMoreMessages(hasMore);
          setNextBeforeId(nextId);

          if (jumpMessageId) {
            setReplyJumpTarget({
              type: "grupo",
              grupoId: Number(chat.grupo_id),
              messageId: Number(jumpMessageId),
              token: chat.__jumpToken || Date.now(),
            });
          } else {
            setReplyJumpTarget(null);
          }

          return;
        }

        const jumpMessageId = chat.__jumpToMessageId || null;

        const [resPrivados, resFijadosPrivados] = await Promise.all([
          jumpMessageId
            ? axios.get(`/api/mensajes/contexto/${jumpMessageId}`, {
                params: {
                  usuario1: user.id,
                  usuario2: chat.usuario_id,
                  limit: GROUP_CONTEXT_PAGE_SIZE,
                },
              })
            : axios.get("/api/mensajes", {
                params: {
                  usuario1: user.id,
                  usuario2: chat.usuario_id,
                  paginated: 1,
                  limit: MESSAGE_PAGE_SIZE,
                },
              }),
          axios.get("/api/mensajes/fijados", {
            params: { usuario1: user.id, usuario2: chat.usuario_id },
          }),
        ]);

        if (cancelado || chatKey !== getChatKey(chat)) return;

        const {
          mensajes,
          hasMore,
          nextBeforeId: nextId,
        } = extractMessagesPayload(resPrivados.data);

        const mensajesFijados = Array.isArray(resFijadosPrivados.data)
          ? resFijadosPrivados.data
          : Array.isArray(resFijadosPrivados.data?.mensajes_fijados)
            ? resFijadosPrivados.data.mensajes_fijados
            : [];

        setPinnedMessages(mensajesFijados);
        setMessages(sortAndDedupeMessages(applyPinnedToMessages(mensajes, mensajesFijados)));
        setHasMoreMessages(hasMore);
        setNextBeforeId(nextId);

        if (jumpMessageId) {
          setReplyJumpTarget({
            type: "privado",
            usuarioId: Number(chat.usuario_id),
            messageId: Number(jumpMessageId),
            token: chat.__jumpToken || Date.now(),
          });
        } else {
          setReplyJumpTarget(null);
        }
      } catch (err) {
        console.error("❌ Error cargando historial paginado:", err);
      } finally {
        if (!cancelado) setIsLoadingMessages(false);
      }
    };

    cargarMensajes();

    return () => {
      cancelado = true;
    };
  }, [chat?.tipo, chat?.grupo_id, chat?.usuario_id, chat?.__privateReplyDraft, chat?.__jumpToMessageId, chat?.__jumpToken, user?.id]);

  const cargarMensajesAnteriores = useCallback(async () => {
    if (!chat || !user?.id || !hasMoreMessages || !nextBeforeId || isLoadingOlderMessages) {
      return;
    }

    setIsLoadingOlderMessages(true);

    try {
      let resMensajes;
      let mensajesFijados = pinnedMessages;

      if (chat.tipo === "grupo") {
        resMensajes = await axios.get(`/api/mensajes/grupo/${chat.grupo_id}`, {
          params: {
            paginated: 1,
            limit: MESSAGE_PAGE_SIZE,
            beforeId: nextBeforeId,
          },
        });
      } else {
        resMensajes = await axios.get("/api/mensajes", {
          params: {
            usuario1: user.id,
            usuario2: chat.usuario_id,
            paginated: 1,
            limit: MESSAGE_PAGE_SIZE,
            beforeId: nextBeforeId,
          },
        });
      }

      const {
        mensajes,
        mensajesFijados: fijadosRespuesta,
        hasMore,
        nextBeforeId: nextId,
      } = extractMessagesPayload(resMensajes.data);

      if (fijadosRespuesta.length) {
        mensajesFijados = fijadosRespuesta;
        setPinnedMessages(fijadosRespuesta);
      }

      const mensajesConFijados = applyPinnedToMessages(mensajes, mensajesFijados);

      setMessages((prev) => sortAndDedupeMessages([...mensajesConFijados, ...prev]));
      setHasMoreMessages(hasMore);
      setNextBeforeId(nextId);
    } catch (err) {
      console.error("❌ Error cargando mensajes anteriores:", err);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [
    chat?.tipo,
    chat?.grupo_id,
    chat?.usuario_id,
    user?.id,
    hasMoreMessages,
    nextBeforeId,
    isLoadingOlderMessages,
    pinnedMessages,
  ]);

  // Cargar stickers (catálogo + favoritos) al cargar usuario
  useEffect(() => {
    if (!user?.id) return;

    const cargarStickers = async () => {
      try {
        const [resTodos, resFav] = await Promise.all([
          axios.get("/api/stickers/todos", { params: { usuarioId: user.id } }),
          axios.get("/api/stickers", { params: { usuarioId: user.id } }),
        ]);

        setStickersTodos(resTodos.data?.stickers || []);
        setStickersFavoritos(resFav.data?.stickers || []);
      } catch (err) {
        console.error("❌ Error cargando stickers:", err);
      }
    };

    cargarStickers();
  }, [user?.id]);

  // Guardar como favorito un sticker (desde el mensaje)
  const handleGuardarStickerFavorito = async (stickerUrl) => {
    logDev("Añadir favorito, URL que mando:", stickerUrl); // 👈 LOG
    if (!user?.id || !stickerUrl) return;

    try {
      const res = await axios.post("/api/stickers/favorito", {
        usuarioId: user.id,
        url: stickerUrl,
      });

      if (!res.data?.success || !res.data?.sticker) {
        console.error("❌ Error respuesta /api/stickers/favorito:", res.data);
        return;
      }

      const sticker = res.data.sticker; // {id, url, nombre_archivo_original, ...}

      setStickersFavoritos((prev) => {
        const existe = prev.some((s) => s.id === sticker.id);
        if (existe) return prev;
        return [sticker, ...prev];
      });
    } catch (err) {
      console.error("❌ Error guardando sticker favorito:", err);
    }
  };

  // 🔹 Eliminar un sticker favorito (por URL)
  const handleEliminarStickerFavorito = async (stickerUrl) => {
    if (!user?.id || !stickerUrl) return;

    try {
      await axios.delete("/api/stickers/favorito", {
        data: { usuarioId: user.id, url: stickerUrl },
      });

      // 👇 aquí debe ser stickersFavoritos
      setStickersFavoritos((prev) => prev.filter((s) => s.url !== stickerUrl));
    } catch (err) {
      console.error("❌ Error eliminando sticker favorito:", err);
    }
  };

  // Escuchar nuevos mensajes en tiempo real
  useEffect(() => {
    if (!chat || !user) return;

    if (chat.tipo === "grupo") {
      // 👉 Unirse al grupo en socket.io
      socket.emit("joinGrupo", chat.grupo_id);

      // Nuevo mensaje de grupo
      const handleNuevoMensajeGrupo = agregarMensajeGrupo;

      // Todos los miembros vieron hasta cierto mensaje
      const handleTodosMensajesVistosGrupo = ({ grupoId, mensajeId }) => {
        if (grupoId !== chat.grupo_id) return;
        setMessages(prev =>
          prev.map(msg =>
            msg.id <= mensajeId && msg.grupo_id === grupoId
              ? { ...msg, visto: 1 }
              : msg
          )
        );
      };

      const handleMensajeEliminadoGrupo = ({ id }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, eliminado: 1 } : m
          )
        );
      };

      const handleMensajeDeshechoGrupo = (msg) => {
        setMessages(prev =>
          prev.map(m => (m.id === msg.id ? { ...m, ...msg, eliminado: 0 } : m))
        );
      };

      // 👇 Nuevo: mensaje editado en grupo
      const handleMensajeEditadoGrupo = (msg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, ...msg } : m
          )
        );
      };

      // dentro del useEffect en ChatBox (donde registras otros listeners)
      const handleReaccionGrupo = ({ mensajeGrupoId, usuarioId, emoji, accion, usuario }) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (Number(m.id) !== Number(mensajeGrupoId)) return m;

            const reaccionesActuales = Array.isArray(m.reacciones) ? m.reacciones : [];

            if (accion === "agregada") {
              const yaExiste = reaccionesActuales.some(
                (r) =>
                  Number(r.usuario_id) === Number(usuarioId) &&
                  r.emoji === emoji
              );

              if (yaExiste) return m;

              return {
                ...m,
                reacciones: [
                  ...reaccionesActuales,
                  {
                    mensaje_id: mensajeGrupoId,
                    usuario_id: usuarioId,
                    emoji,
                    usuario,
                  },
                ],
              };
            }

            if (accion === "eliminada") {
              return {
                ...m,
                reacciones: reaccionesActuales.filter(
                  (r) =>
                    !(Number(r.usuario_id) === Number(usuarioId) && r.emoji === emoji)
                ),
              };
            }

            return m;
          })
        );
      };

      // 📌 Escuchar mensajes fijados en grupo
      // 🧩 NUEVO: fijar y desfijar en tiempo real
      const handleMensajeFijadoGrupo = (data) => {
        const {
          accion,
          grupo_id,
          mensaje_id,
          usuario_id,
          usuario,
          mensaje,
          fecha_fijado,
          fecha_expiracion,
          duracion,
        } = data;

        if (grupo_id !== chat.grupo_id) return;

        logDev("📌 [SOCKET] mensajeFijadoGrupo recibido:", data);

        // ✅ Actualizar mensajes del chat
        setMessages((prev) =>
          prev.map((m) =>
            m.id === mensaje_id
              ? { ...m, fijado: accion === "fijado" ? 1 : 0, fecha_fijado }
              : m
          )
        );

        // ✅ Actualizar los fijados visuales (máx 3)
        setPinnedMessages((prev) => {
          if (accion === "fijado") {
            // evitar duplicados
            const yaExiste = prev.some((f) => Number(f.mensaje_id || f.id) === Number(mensaje_id));
            if (yaExiste) return prev;

            const nuevo = {
              id: mensaje_id,
              grupo_id,
              mensaje_id,
              usuario_id,
              mensaje: mensaje?.mensaje || mensaje || "Mensaje fijado",
              fijado_por: usuario,
              fecha_fijado,
              duracion,
              fecha_expiracion,
            };

            // límite de 3
            const nuevos = [...prev, nuevo];
            return nuevos.slice(-3);
          } else {
            // eliminar si fue desfijado
            return prev.filter((f) => Number(f.mensaje_id || f.id) !== Number(mensaje_id));
          }
        });
      };

      // 🔹 Grupo actualizado (nombre o descripción)
      const handleGrupoActualizado = (data) => {
        if (Number(data.id) !== chat.grupo_id) return;
        logDev("📢 [SOCKET] Grupo actualizado:", data);
        setChat((prev) => ({
          ...prev,
          ...(data.nombre && { usuario_nombre: data.nombre, nombre: data.nombre }),
          ...(data.descripcion !== undefined && { descripcion: data.descripcion }),
          ...(data.imagen_url !== undefined && { imagen_url: data.imagen_url }),
        }));
      };

      // 🟢 Nuevo: privacidad actualizada
      const handlePrivacidadActualizada = (data) => {
        if (Number(data.id) !== chat.grupo_id) return;

        logDev("🔐 [SOCKET] Privacidad actualizada:", data);

        setChat((prev) => ({
          ...prev,
          privacidad: data.privacidad,
        }));
      };

      // 🧩 Nuevo: miembros actualizados en tiempo real
      const handleMiembrosActualizados = (data) => {
        if (Number(data.id) !== chat.grupo_id) return;

        logDev("👥 [SOCKET] Miembros actualizados:", data);

        setChat((prev) => ({
          ...prev,
          miembros: data.miembros,
        }));
      };

      socket.on("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
      socket.on("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
      socket.on("mensajeEliminadoGrupo", handleMensajeEliminadoGrupo);
      socket.on("mensajeDeshechoGrupo", handleMensajeDeshechoGrupo);
      socket.on("mensajeEditadoGrupo", handleMensajeEditadoGrupo);
      socket.on("reaccionActualizadaGrupo", handleReaccionGrupo);
      socket.on("mensajeFijadoGrupo", handleMensajeFijadoGrupo);
      socket.on("grupoActualizado", handleGrupoActualizado);
      socket.on("privacidadActualizada", handlePrivacidadActualizada);
      socket.on("miembrosActualizados", handleMiembrosActualizados);

      return () => {
        socket.emit("leaveGrupo", chat.grupo_id);
        socket.off("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
        socket.off("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
        socket.off("mensajeEliminadoGrupo", handleMensajeEliminadoGrupo);
        socket.off("mensajeDeshechoGrupo", handleMensajeDeshechoGrupo);
        socket.off("mensajeEditadoGrupo", handleMensajeEditadoGrupo);
        socket.off("reaccionActualizadaGrupo", handleReaccionGrupo);
        socket.off("mensajeFijadoGrupo", handleMensajeFijadoGrupo);
        socket.off("grupoActualizado", handleGrupoActualizado);
        socket.off("privacidadActualizada", handlePrivacidadActualizada);
        socket.off("miembrosActualizados", handleMiembrosActualizados);
      };
    } else {
      // Chat individual
      const handleNuevoMensaje = (msg) => {
        const enviaId = Number(msg.usuario_envia_id);
        const recibeId = Number(msg.usuario_recibe_id);
        const chatUserId = Number(chat.usuario_id);
        const myUserId = Number(user.id);

        const perteneceAChat =
          (enviaId === chatUserId && recibeId === myUserId) ||
          (enviaId === myUserId && recibeId === chatUserId);

        if (!perteneceAChat) return;

        setMessages((prev) => {
          const existente = prev.find((m) => Number(m.id) === Number(msg.id));

          if (existente) {
            return prev.map((m) =>
              Number(m.id) === Number(msg.id)
                ? {
                    ...m,
                    ...msg,
                    estado: "enviado",
                    reacciones: m.reacciones || msg.reacciones || [],
                  }
                : m
            );
          }

          // Si es un mensaje mío que ya se pintó como temporal, se reemplaza
          // por el mensaje real del backend para evitar burbujas duplicadas.
          const optimisticResult = replaceMatchingOptimisticMessage(prev, msg, user.id);
          if (optimisticResult.replaced) return optimisticResult.messages;

          return sortAndDedupeMessages([
            ...prev,
            {
              ...msg,
              estado: "enviado",
              reacciones: msg.reacciones || [],
            },
          ]);
        });
      };

      const handleMensajeEliminado = ({ id }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, eliminado: 1 } : m
          )
        );
      };

      const handleMensajeDeshecho = (msg) => {
        setMessages(prev =>
          prev.map(m => (m.id === msg.id ? { ...m, ...msg, eliminado: 0 } : m))
        );
      };

      // 👇 Nuevo: mensaje editado en chat privado
      const handleMensajeEditado = ({ id, mensaje, editado }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, mensaje, editado } : m
          )
        );
      };

      // 👇 AÑADE ESTO
      const handleMensajeFijado = ({ accion, mensajeId, usuarioId, usuario, mensaje, fecha_fijado }) => {
        logDev("📌 [SOCKET] Evento mensajeFijado recibido:", { accion, mensajeId });
        setMessages(prev =>
          prev.map(m =>
            Number(m.id) === Number(mensajeId)
              ? { ...m, fijado: accion === "fijado" ? 1 : 0, fecha_fijado }
              : m
          )
        );

        setPinnedMessages((prev) => {
          if (accion === "fijado") {
            const yaExiste = prev.some((f) => Number(f.mensaje_id || f.id) === Number(mensajeId));
            if (yaExiste) return prev;

            const nuevo = {
              id: mensajeId,
              mensaje_id: mensajeId,
              usuario_id: usuarioId,
              mensaje: mensaje?.mensaje || mensaje || "Mensaje fijado",
              fijado_por: usuario,
              fecha_fijado,
            };

            return [nuevo, ...prev].slice(0, 3);
          }

          return prev.filter((f) => Number(f.mensaje_id || f.id) !== Number(mensajeId));
        });
      };

      // 👇 Nuevo: manejar cuando ambos han visto los mensajes
      const handleMensajesVistos = ({ emisorId, receptorId }) => {
        // Solo si el evento corresponde a este chat actual
        if (
          (chat.usuario_id === emisorId && user.id === receptorId) ||
          (chat.usuario_id === receptorId && user.id === emisorId)
        ) {
          logDev("🔹 Evento MENSAJES VISTOS recibido:", { emisorId, receptorId });

          setMessages(prev =>
            prev.map(m =>
              m.usuario_envia_id === emisorId && m.usuario_recibe_id === receptorId
                ? { ...m, visto: 1 }
                : m
            )
          );
        }
      };

      // Chat individual
      const handleReaccionActualizada = ({ mensajeId, usuarioId, emoji, accion, usuario }) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (Number(m.id) !== Number(mensajeId)) return m;

            const reaccionesActuales = Array.isArray(m.reacciones) ? m.reacciones : [];

            if (accion === "agregada") {
              const yaExiste = reaccionesActuales.some(
                (r) =>
                  Number(r.usuario_id) === Number(usuarioId) &&
                  r.emoji === emoji
              );

              if (yaExiste) return m;

              return {
                ...m,
                reacciones: [
                  ...reaccionesActuales,
                  {
                    mensaje_id: mensajeId,
                    usuario_id: usuarioId,
                    emoji,
                    usuario,
                  },
                ],
              };
            }

            if (accion === "eliminada") {
              return {
                ...m,
                reacciones: reaccionesActuales.filter(
                  (r) =>
                    !(Number(r.usuario_id) === Number(usuarioId) && r.emoji === emoji)
                ),
              };
            }

            return m;
          })
        );
      };

      socket.on("nuevoMensaje", handleNuevoMensaje);
      socket.on("mensajeEliminado", handleMensajeEliminado);
      socket.on("mensajeDeshecho", handleMensajeDeshecho);
      socket.on("mensajeEditado", handleMensajeEditado);
      socket.on("mensajeFijado", handleMensajeFijado); // 👈 AQUÍ
      socket.on("mensajesVistos", handleMensajesVistos); // 👈 nuevo
      socket.on("reaccionActualizada", handleReaccionActualizada);
      return () => {
        socket.off("nuevoMensaje", handleNuevoMensaje);
        socket.off("mensajeEliminado", handleMensajeEliminado);
        socket.off("mensajeDeshecho", handleMensajeDeshecho);
        socket.off("mensajeEditado", handleMensajeEditado);
        socket.off("mensajeFijado", handleMensajeFijado); // 👈 LIMPIEZA
        socket.off("mensajesVistos", handleMensajesVistos); // 👈 nuevo
        socket.off("reaccionActualizada", handleReaccionActualizada);
      };
    }
  }, [chat, user, setChat]);
  
  // cerrar al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        emojiRef.current &&
        !emojiRef.current.contains(e.target) && // si el click NO está dentro del picker
        emojiBtnRef.current &&
        !emojiBtnRef.current.contains(e.target) // y tampoco dentro del botón

      ) {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (

        gifRef.current &&
        !gifRef.current.contains(e.target) && // si el click NO está dentro del picker
        gifBtnRef.current &&
        !gifBtnRef.current.contains(e.target) // y tampoco dentro del botón

      ) {
        setShowGifPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (

        stickerRef.current &&
        !stickerRef.current.contains(e.target) && // si el click NO está dentro del picker
        stickerBtnRef.current &&
        !stickerBtnRef.current.contains(e.target) // y tampoco dentro del botón

      ) {
        setShowStickerPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);


  useEffect(() => {
    const handleClickOutside = (e) => {
      if (callMenuRef.current && !callMenuRef.current.contains(e.target)) {
        setMostrarMenuLlamada(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setMostrarMenuLlamada(false);
  }, [chat?.tipo, chat?.usuario_id, chat?.grupo_id]);
  
  // cerrar con ESC
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setShowEmojiPicker(false);
        setShowGifPicker(false);
        setShowStickerPicker(false);
      }
    };

    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  const buildGroupChatFromSource = useCallback((group = {}, fallback = {}) => {
    group = group || {};
    fallback = fallback || {};
    const grupoId = group.grupo_id || group.id || fallback.grupo_id || fallback.id;

    return {
      ...group,
      tipo: "grupo",
      grupo_id: grupoId,
      user_id: user?.id,
      usuario_id: grupoId,
      usuario_nombre: group.usuario_nombre || group.nombre || fallback.nombre || "Grupo",
      imagen_url: group.imagen_url || fallback.imagen_url || null,
      background: group.background || "#6c757d",
      miembros: Array.isArray(group.miembros) ? group.miembros : [],
      admins: Array.isArray(group.admins) ? group.admins : [],
      archivos: Array.isArray(group.archivos) ? group.archivos : [],
    };
  }, [user?.id]);

  const cargarContextoMensajeGrupo = useCallback(async (grupoId, mensajeId) => {
    if (!grupoId || !mensajeId) return false;

    setIsLoadingMessages(true);
    setReplyJumpTarget({
      type: "grupo",
      grupoId: Number(grupoId),
      messageId: Number(mensajeId),
      token: Date.now(),
    });

    try {
      const resMensajes = await axios.get(
        `/api/mensajes/grupo/${grupoId}/contexto/${mensajeId}`,
        { params: { limit: GROUP_CONTEXT_PAGE_SIZE } }
      );

      const {
        mensajes,
        mensajesFijados,
        hasMore,
        nextBeforeId: nextId,
      } = extractMessagesPayload(resMensajes.data);

      setPinnedMessages(mensajesFijados);
      setMessages(sortAndDedupeMessages(applyPinnedToMessages(mensajes, mensajesFijados)));
      setHasMoreMessages(hasMore);
      setNextBeforeId(nextId);
      return true;
    } catch (err) {
      console.error("❌ Error cargando contexto del mensaje de grupo:", err);
      return false;
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const cargarContextoMensajePrivado = useCallback(async (mensajeId) => {
    if (!mensajeId || !chat?.usuario_id || !user?.id) return false;

    const targetMessageId = Number(mensajeId);

    setIsLoadingMessages(true);
    setReplyJumpTarget({
      type: "privado",
      usuarioId: Number(chat.usuario_id),
      messageId: targetMessageId,
      token: Date.now(),
    });

    try {
      const [resMensajes, resFijadosPrivados] = await Promise.all([
        axios.get(`/api/mensajes/contexto/${targetMessageId}`, {
          params: {
            usuario1: user.id,
            usuario2: chat.usuario_id,
            limit: GROUP_CONTEXT_PAGE_SIZE,
          },
        }),
        axios.get("/api/mensajes/fijados", {
          params: { usuario1: user.id, usuario2: chat.usuario_id },
        }),
      ]);

      const {
        mensajes,
        hasMore,
        nextBeforeId: nextId,
      } = extractMessagesPayload(resMensajes.data);

      const mensajesFijados = Array.isArray(resFijadosPrivados.data)
        ? resFijadosPrivados.data
        : Array.isArray(resFijadosPrivados.data?.mensajes_fijados)
          ? resFijadosPrivados.data.mensajes_fijados
          : [];

      setPinnedMessages(mensajesFijados);
      setMessages(sortAndDedupeMessages(applyPinnedToMessages(mensajes, mensajesFijados)));
      setHasMoreMessages(hasMore);
      setNextBeforeId(nextId);
      return true;
    } catch (err) {
      console.error("❌ Error cargando contexto del mensaje privado:", err);
      return false;
    } finally {
      setIsLoadingMessages(false);
    }
  }, [chat?.usuario_id, user?.id]);

  const openGroupAndJumpToMessage = useCallback(async (grupoId, mensajeId, grupoNombre = "Grupo") => {
    if (!grupoId || !mensajeId) return false;

    setReplyingTo(null);
    setReplyJumpTarget({
      type: "grupo",
      grupoId: Number(grupoId),
      messageId: Number(mensajeId),
      token: Date.now(),
    });

    let groupChat = buildGroupChatFromSource(null, {
      grupo_id: grupoId,
      nombre: grupoNombre,
    });

    try {
      if (user?.id) {
        const res = await axios.get(`/api/grupos/usuario/${user.id}`);
        const groups = Array.isArray(res.data) ? res.data : [];
        const found = groups.find((g) => Number(g.grupo_id || g.id) === Number(grupoId));

        if (found) {
          groupChat = buildGroupChatFromSource(found, {
            grupo_id: grupoId,
            nombre: grupoNombre,
          });
        }
      }
    } catch (err) {
      console.error("❌ Error buscando grupo para abrir mensaje citado:", err);
    }

    setChat({
      ...groupChat,
      __jumpToMessageId: Number(mensajeId),
      __jumpToken: Date.now(),
    });

    return true;
  }, [buildGroupChatFromSource, setChat, user?.id]);

  const getSenderFromGroupMessage = useCallback((message = {}) => {
    const senderId = message.usuario_id || message.usuario_envia_id;
    if (!senderId) return null;

    const nombre = message.nombre || message.emisor_nombre || "Usuario";
    const apellido = message.apellido || message.emisor_apellido || "";

    return {
      tipo: "privado",
      usuario_id: senderId,
      usuario_nombre: `${nombre} ${apellido}`.trim(),
      usuario_correo: message.correo || message.emisor_correo || "",
      url_imagen: message.url_imagen || message.emisor_avatar || null,
      background: message.background || message.emisor_background || "#6c757d",
    };
  }, []);

  const buildPrivateReplyFromGroup = useCallback((message = {}) => ({
    ...message,
    id: message.id,
    usuario_id: message.usuario_id || message.usuario_envia_id,
    usuario_envia_id: message.usuario_id || message.usuario_envia_id,
    reply_source: "grupo",
    reply_to_tipo: "grupo",
    reply_to_grupo_id: message.grupo_id || chat?.grupo_id || null,
    source_group_id: message.grupo_id || chat?.grupo_id || null,
    source_group_name: chat?.usuario_nombre || chat?.nombre || "Grupo",
  }), [chat?.grupo_id, chat?.usuario_nombre, chat?.nombre]);

  const openPrivateChatFromGroupMessage = useCallback((message, shouldReply = false) => {
    const privateChat = getSenderFromGroupMessage(message);
    if (!privateChat || Number(privateChat.usuario_id) === Number(user?.id)) return;

    setChat({
      ...privateChat,
      __privateReplyDraft: shouldReply ? buildPrivateReplyFromGroup(message) : null,
    });
  }, [buildPrivateReplyFromGroup, getSenderFromGroupMessage, setChat, user?.id]);

  const handleReplyPrivado = useCallback((message) => {
    openPrivateChatFromGroupMessage(message, true);
  }, [openPrivateChatFromGroupMessage]);

  const handleEnviarMensajePrivado = useCallback((message) => {
    openPrivateChatFromGroupMessage(message, false);
  }, [openPrivateChatFromGroupMessage]);

  const handleReplyMessage = useCallback((message) => {
    if (!message?.id) return;
    setReplyingTo(message);
    setTimeout(() => inputRef.current?.focus?.(), 0);
  }, []);

  const getForwardMessageKey = useCallback((message = {}) => {
    const source = message.source_tipo || message.forward_source || chat?.tipo || "chat";
    return `${source}-${message.id}`;
  }, [chat?.tipo]);

  const buildForwardPayload = useCallback((message = {}) => ({
    id: message.id,
    source_tipo: message.source_tipo || chat?.tipo || "privado",
    source_grupo_id: message.source_grupo_id || message.grupo_id || chat?.grupo_id || null,
    mensaje: message.mensaje || "",
    archivo_url: message.archivo_url || null,
    tipo_archivo: message.tipo_archivo || "",
    nombre_archivo: message.nombre_archivo || "",
    tamano: message.tamano || 0,
    lote_id: message.lote_id || message.loteId || null,
    imagenes: Array.isArray(message.imagenes) ? message.imagenes : undefined,
  }), [chat?.tipo, chat?.grupo_id]);

  const normalizeForwardSelectionMessage = useCallback((message = {}) => ({
    ...message,
    source_tipo: message.source_tipo || chat?.tipo || "privado",
    source_grupo_id: message.source_grupo_id || message.grupo_id || chat?.grupo_id || null,
  }), [chat?.tipo, chat?.grupo_id]);

  const startForwardSelection = useCallback((message) => {
    if (!message?.id) return;
    const normalized = normalizeForwardSelectionMessage(message);
    setForwardSelectionMode(true);
    setForwardSelectedMessages([normalized]);
    setShowForwardModal(false);
  }, [normalizeForwardSelectionMessage]);

  const toggleForwardSelectedMessage = useCallback((message) => {
    if (!message?.id) return;
    const normalized = normalizeForwardSelectionMessage(message);
    const key = getForwardMessageKey(normalized);

    setForwardSelectedMessages((prev) => {
      const exists = prev.some((item) => getForwardMessageKey(item) === key);
      if (exists) return prev.filter((item) => getForwardMessageKey(item) !== key);
      return [...prev, normalized];
    });
  }, [getForwardMessageKey, normalizeForwardSelectionMessage]);

  const cancelForwardSelection = useCallback(() => {
    setForwardSelectionMode(false);
    setForwardSelectedMessages([]);
    setShowForwardModal(false);
    setForwardSelectedTargets([]);
    setForwardSearch("");
  }, []);

  const getForwardTargetTime = (value) => {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const upsertForwardTarget = (map, target) => {
    if (!target?.key || !target.id) return;
    const previous = map.get(target.key);
    if (!previous || (target.lastTime || 0) > (previous.lastTime || 0)) {
      map.set(target.key, { ...previous, ...target });
    }
  };

  const buildForwardTargetFromPrivate = (item = {}, section = "project") => {
    const currentId = Number(user?.id);
    const enviaId = Number(item.usuario_envia_id || item.emisor_id || item.sender_id);
    const recibeId = Number(item.usuario_recibe_id || item.receptor_id || item.receiver_id);

    let otherId = Number(item.usuario_id || item.id || item.contacto_id);
    let nombre = item.usuario_nombre || item.nombre_completo || `${item.nombre || ""} ${item.apellido || ""}`.trim();
    let correo = item.usuario_correo || item.correo || "";
    let avatar = item.url_imagen || item.usuario_imagen || item.avatar || null;
    let background = item.background || "#6c757d";

    if (Number.isFinite(enviaId) && Number.isFinite(recibeId) && (enviaId === currentId || recibeId === currentId)) {
      const soyEmisor = enviaId === currentId;
      otherId = soyEmisor ? recibeId : enviaId;
      nombre = soyEmisor
        ? item.receptor_nombre || nombre || "Usuario"
        : item.emisor_nombre || nombre || "Usuario";
      correo = soyEmisor
        ? item.receptor_correo || correo || ""
        : item.emisor_correo || correo || "";
      avatar = soyEmisor
        ? item.receptor_avatar || avatar || null
        : item.emisor_avatar || avatar || null;
      background = soyEmisor
        ? item.receptor_background || background || "#6c757d"
        : item.emisor_background || background || "#6c757d";
    }

    return {
      key: `privado-${otherId}`,
      tipo: "privado",
      id: otherId,
      nombre: nombre || correo || "Usuario",
      subtitle: section === "recent" ? "" : "Miembro de proyecto",
      url_imagen: avatar,
      background,
      section,
      lastTime: getForwardTargetTime(item.fecha_envio || item.updated_at || item.creado_en),
    };
  };

  const buildForwardTargetFromGroup = (item = {}, section = "groups") => {
    const groupId = Number(item.grupo_id || item.id);
    const memberCount = Array.isArray(item.miembros) ? item.miembros.length : 0;

    return {
      key: `grupo-${groupId}`,
      tipo: "grupo",
      id: groupId,
      nombre: item.usuario_nombre || item.nombre || "Grupo",
      subtitle: memberCount ? `${memberCount} miembros` : "Grupo",
      imagen_url: item.imagen_url || null,
      background: item.background || "#6c757d",
      miembros: item.miembros || [],
      section,
      lastTime: getForwardTargetTime(item.fecha_envio),
      createdTime: getForwardTargetTime(item.fecha_creacion),
    };
  };

  const loadForwardTargets = useCallback(async () => {
    if (!user?.id) return;

    try {
      const [resChats, resGrupos, resProjectUsers] = await Promise.all([
        axios.get(`/api/chats/${user.id}`),
        axios.get(`/api/grupos/usuario/${user.id}`),
        axios.get(`/api/grupos/${user.id}/todos-usuarios`),
      ]);

      const privateRecentMap = new Map();
      (Array.isArray(resChats.data) ? resChats.data : []).forEach((item) => {
        const target = buildForwardTargetFromPrivate(item, "recent");
        if (target.id && Number(target.id) !== Number(user.id)) {
          upsertForwardTarget(privateRecentMap, target);
        }
      });

      const groupMap = new Map();
      (Array.isArray(resGrupos.data) ? resGrupos.data : []).forEach((item) => {
        const target = buildForwardTargetFromGroup(item, "groups");
        if (target.id) upsertForwardTarget(groupMap, target);
      });

      const recentCandidates = [
        ...privateRecentMap.values(),
        ...groupMap.values().filter((target) => target.lastTime > 0),
      ]
        .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0))
        .slice(0, 10)
        .map((target) => ({ ...target, section: "recent", subtitle: target.tipo === "grupo" ? target.subtitle : "" }));

      const recentKeys = new Set(recentCandidates.map((target) => target.key));

      const nonRecentGroups = [...groupMap.values()]
        .filter((target) => !recentKeys.has(target.key))
        .sort((a, b) => (b.lastTime || b.createdTime || 0) - (a.lastTime || a.createdTime || 0))
        .map((target) => ({ ...target, section: "groups" }));

      const projectMap = new Map();
      (Array.isArray(resProjectUsers.data) ? resProjectUsers.data : []).forEach((item) => {
        const target = buildForwardTargetFromPrivate(item, "project");
        if (
          target.id &&
          Number(target.id) !== Number(user.id) &&
          !recentKeys.has(target.key)
        ) {
          upsertForwardTarget(projectMap, target);
        }
      });

      const projectMembers = [...projectMap.values()].sort((a, b) =>
        String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" })
      );

      setForwardTargets([
        ...recentCandidates,
        ...nonRecentGroups,
        ...projectMembers,
      ]);
    } catch (err) {
      console.error("❌ Error cargando destinos para reenviar:", err);
      setForwardTargets([]);
    }
  }, [user?.id]);

  const openForwardModal = useCallback(() => {
    if (!forwardSelectedMessages.length) return;
    setShowForwardModal(true);
    setForwardSelectedTargets([]);
    setForwardSearch("");
    loadForwardTargets();
  }, [forwardSelectedMessages.length, loadForwardTargets]);

  const toggleForwardTarget = useCallback((target) => {
    if (!target?.key) return;
    setForwardSelectedTargets((prev) => {
      const exists = prev.some((item) => item.key === target.key);
      if (exists) return prev.filter((item) => item.key !== target.key);
      return [...prev, target];
    });
  }, []);

  const filteredForwardSections = useMemo(() => {
    const query = forwardSearch.trim().toLowerCase();
    const matches = (target) =>
      !query || `${target.nombre || ""} ${target.subtitle || ""}`.toLowerCase().includes(query);

    const sectionOrder = [
      { key: "recent", label: "Chats recientes" },
      { key: "groups", label: "Grupos" },
      { key: "project", label: "Miembros de Proyecto" },
    ];

    return sectionOrder
      .map((section) => ({
        ...section,
        targets: forwardTargets.filter((target) => (target.section || "project") === section.key && matches(target)),
      }))
      .filter((section) => section.targets.length > 0);
  }, [forwardTargets, forwardSearch]);

  const sendForwardedMessages = useCallback(async () => {
    if (!forwardSelectedMessages.length || !forwardSelectedTargets.length || isForwardingMessages) return;

    setIsForwardingMessages(true);
    try {
      await axios.post("/api/mensajes/reenviar", {
        usuarioId: user.id,
        mensajes: forwardSelectedMessages.map(buildForwardPayload),
        destinos: forwardSelectedTargets.map((target) => ({
          tipo: target.tipo,
          id: target.id,
        })),
      });

      cancelForwardSelection();
    } catch (err) {
      console.error("❌ Error reenviando mensajes:", err);
      alert("No se pudieron reenviar los mensajes. Inténtalo otra vez.");
    } finally {
      setIsForwardingMessages(false);
    }
  }, [
    buildForwardPayload,
    cancelForwardSelection,
    forwardSelectedMessages,
    forwardSelectedTargets,
    isForwardingMessages,
    user?.id,
  ]);

  useEffect(() => {
    cancelForwardSelection();
  }, [chat?.tipo, chat?.grupo_id, chat?.usuario_id]);

  const renderForwardTargetAvatar = (target) => {
    if (target.tipo === "grupo") {
      return <GroupAvatar group={target} members={target.miembros} size={42} />;
    }

    if (target.url_imagen) {
      return <img src={getAvatarUrl(target.url_imagen)} alt={target.nombre} />;
    }

    return (
      <span style={{ backgroundColor: target.background || "#6c757d" }}>
        {(target.nombre || "U").charAt(0).toUpperCase()}
      </span>
    );
  };

  const renderPreviewLine = (message) => {
    const preview = getMessagePreview(message);
    const rawText = preview.kind === "text" ? (preview.rawText || preview.text) : preview.text;

    return (
      <span className="wa-preview-line">
        {preview.iconClass && <i className={`wa-preview-icon ${preview.iconClass}`} aria-hidden="true" />}
        <span className="wa-preview-label">
          {preview.kind === "text"
            ? renderRichTextInline(rawText, "reply-compose-preview")
            : preview.text}
        </span>
      </span>
    );
  };

  const createLocalOutgoingMessage = (overrides = {}) => {
    const base = {
      id: overrides.id || `temp-${Date.now()}-${Math.random()}`,
      mensaje: overrides.mensaje || "",
      eliminado: 0,
      editado: 0,
      fijado: 0,
      visto: 0,
      fecha_envio: overrides.fecha_envio || new Date().toISOString(),
      estado: overrides.estado || "enviando",
      lote_id: overrides.lote_id || null,
      reply_to_id: overrides.reply_to_id || null,
      reply_to_tipo: overrides.reply_to_tipo || null,
      reply_to_grupo_id: overrides.reply_to_grupo_id || null,
      reply_to: overrides.reply_to || null,
      ...overrides,
    };

    if (chat?.tipo === "grupo") {
      return {
        ...base,
        grupo_id: chat.grupo_id,
        usuario_id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        url_imagen: user.url_imagen,
        background: user.background,
        correo: user.correo,
      };
    }

    return {
      ...base,
      usuario_envia_id: user.id,
      usuario_recibe_id: chat.usuario_id,
      emisor_nombre: user.nombre,
      emisor_apellido: user.apellido,
      emisor_avatar: user.url_imagen,
      emisor_background: user.background,
      emisor_correo: user.correo,
      receptor_nombre: chat.usuario_nombre,
      receptor_apellido: "",
      receptor_avatar: chat.url_imagen,
      receptor_background: chat.background,
      receptor_correo: chat.usuario_correo,
    };
  };

  const makePendingController = (pendingId, baseEntry = {}) => {
    const controller = new AbortController();
    pendingUploadsRef.current.set(pendingId, {
      ...baseEntry,
      controller,
    });
    return controller;
  };

  const clearPendingUpload = (pendingId) => {
    pendingUploadsRef.current.delete(pendingId);
  };

  const markPendingUploadError = (pendingId, errorMessage = "Se produjo un error. Haz clic para obtener más información.") => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === pendingId
          ? {
              ...m,
              estado: "error",
              progreso: 0,
              error_mensaje: errorMessage,
            }
          : m
      )
    );
  };

  const cancelPendingUpload = useCallback((pendingId) => {
    const entry = pendingUploadsRef.current.get(pendingId);
    entry?.controller?.abort?.();
    markPendingUploadError(pendingId, "Envío cancelado. Haz clic para volver a intentar.");
  }, []);

  const retryPendingUpload = useCallback((pendingId) => {
    const entry = pendingUploadsRef.current.get(pendingId);
    if (!entry) return;

    if (entry.kind === "image") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, estado: "subiendo", progreso: 0, error_mensaje: null } : m
        )
      );

      const controller = makePendingController(pendingId, { ...entry, kind: "image" });

      uploadImageMessage(
        entry.file,
        entry.loteId,
        (percent) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === pendingId ? { ...m, progreso: percent } : m))
          );
        },
        entry.replyToId,
        entry.replyToType,
        entry.replyToGrupoId,
        { signal: controller.signal }
      )
        .then((mensajeServidor) => {
          if (!mensajeServidor) {
            markPendingUploadError(pendingId);
            return;
          }

          const msgSrv = {
            ...mensajeServidor,
            lote_id: mensajeServidor.lote_id || entry.loteId,
          };

          setMessages((prev) => {
            const yaExisteReal = prev.find((m) => Number(m.id) === Number(msgSrv.id));
            if (yaExisteReal) {
              return prev
                .filter((m) => m.id !== pendingId)
                .map((m) => Number(m.id) === Number(msgSrv.id) ? { ...m, ...msgSrv, estado: "enviado", progreso: 100 } : m);
            }

            return sortAndDedupeMessages(
              prev.map((m) => m.id === pendingId ? { ...m, ...msgSrv, estado: "enviado", progreso: 100 } : m)
            );
          });
          clearPendingUpload(pendingId);
        })
        .catch((err) => {
          if (axios.isCancel?.(err) || err?.name === "CanceledError" || err?.code === "ERR_CANCELED") {
            markPendingUploadError(pendingId, "Envío cancelado. Haz clic para volver a intentar.");
            return;
          }
          console.error("❌ Error reintentando imagen:", err);
          markPendingUploadError(pendingId);
        });
      return;
    }

    if (entry.kind === "sticker") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, estado: "subiendo", error_mensaje: null } : m
        )
      );

      if (entry.file) {
        uploadAndSendStickerFile(entry.file, { pendingId, localPreviewUrl: entry.localPreviewUrl, originalStickerData: entry.stickerData })
          .catch(() => markPendingUploadError(pendingId));
      } else if (entry.stickerUrl) {
        sendStickerMessage(entry.stickerUrl, entry.stickerData || null, {
          pendingId,
          localPreviewUrl: entry.localPreviewUrl || entry.stickerUrl,
          keepExistingPending: true,
        }).catch(() => markPendingUploadError(pendingId));
      }
    }
  }, [chat, user]);

  // Función para enviar mensaje
  const handleSendMessage = async (messageText, options = {}) => {
    const text = (messageText || "").trim();
    const hayTexto = !!text;
    const hayImagenes = !options.ignorePendingImages && pendingImages.length > 0;
    const replyToId = replyingTo?.id || null;
    const replyPayload = replyingTo || null;
    const replyToType = replyingTo?.reply_to_tipo || replyingTo?.reply_source || "privado";
    const replyToGrupoId = replyingTo?.reply_to_grupo_id || replyingTo?.source_group_id || null;

    if (!hayTexto && !hayImagenes) return;

    // WhatsApp limpia la barra de respuesta apenas el envío fue aceptado.
    // Guardamos arriba la referencia en replyPayload/replyToId para que el backend
    // y el mensaje temporal sigan recibiendo la cita correcta aunque el estado se limpie.
    if (replyToId) {
      setReplyingTo(null);
    }

    // 👇 Un id de lote SOLO cuando hay imágenes
    const loteId = hayImagenes ? crearLoteId() : null;

    try {
      // 1️⃣ Imágenes → mensajes temporales con estado "subiendo"
      if (hayImagenes) {
        for (const img of pendingImages) {
          const tempId = `temp-${Date.now()}-${Math.random()}`;

          const baseTemp = {
            id: tempId,
            mensaje: "",
            archivo_url: img.preview,
            tipo_archivo: img.file.type,
            nombre_archivo: img.file.name,
            tamano: img.file.size,
            eliminado: 0,
            editado: 0,
            fijado: 0,
            fecha_envio: new Date().toISOString(),
            estado: "subiendo",
            progreso: 0,
            lote_id: loteId,
            reply_to_id: replyToId,
            reply_to_tipo: replyToType,
            reply_to_grupo_id: replyToGrupoId,
            reply_to: replyPayload,
          };

          let tempMsg;

          if (chat.tipo === "grupo") {
            tempMsg = {
              ...baseTemp,
              grupo_id: chat.grupo_id,
              usuario_id: user.id,
              nombre: user.nombre,
              apellido: user.apellido,
              url_imagen: user.url_imagen,
              background: user.background,
              correo: user.correo,
            };
          } else {
            tempMsg = {
              ...baseTemp,
              usuario_envia_id: user.id,
              usuario_recibe_id: chat.usuario_id,
              emisor_nombre: user.nombre,
              emisor_apellido: user.apellido,
              emisor_avatar: user.url_imagen,
              emisor_background: user.background,
              emisor_correo: user.correo,
              receptor_nombre: chat.usuario_nombre,
              receptor_apellido: "",
              receptor_avatar: chat.url_imagen,
              receptor_background: chat.background,
              receptor_correo: chat.usuario_correo,
            };
          }

          // Añadimos la vista de envío en curso al chat.
          setMessages((prev) => sortAndDedupeMessages([...prev, tempMsg]));

          const controller = makePendingController(tempId, {
            kind: "image",
            file: img.file,
            loteId,
            replyToId,
            replyToType,
            replyToGrupoId,
          });

          // Subimos la imagen de verdad
          uploadImageMessage(img.file, loteId, (percent) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempId ? { ...m, progreso: percent } : m
              )
            );
          }, replyToId, replyToType, replyToGrupoId, { signal: controller.signal })
            .then((mensajeServidor) => {
              if (!mensajeServidor) {
                // marcar error si no hay respuesta
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempId ? { ...m, estado: "error" } : m
                  )
                );
                return;
              }

              // aseguramos que el lote se mantiene
              const msgSrv = {
                ...mensajeServidor,
                lote_id: mensajeServidor.lote_id || loteId,
              };

              setMessages((prev) => {
                // ¿Ya entró el mensaje real por socket?
                const yaExisteReal = prev.find((m) => Number(m.id) === Number(msgSrv.id));

                if (yaExisteReal) {
                  // llegó por socket: actualizamos ese y borramos el temporal
                  return prev
                    .filter((m) => m.id !== tempId)
                    .map((m) =>
                      m.id === msgSrv.id
                        ? {
                            ...m,
                            ...msgSrv,
                            estado: "enviado",
                            progreso: 100,
                          }
                        : m
                    );
                }

                // aún no entró por socket: reemplazamos el temporal
                return prev.map((m) =>
                  m.id === tempId
                    ? {
                        ...m,
                        ...msgSrv,
                        estado: "enviado",
                        progreso: 100,
                      }
                    : m
                );
              });
              clearPendingUpload(tempId);
            })
            .catch((err) => {
              if (axios.isCancel?.(err) || err?.name === "CanceledError" || err?.code === "ERR_CANCELED") {
                markPendingUploadError(tempId, "Envío cancelado. Haz clic para volver a intentar.");
                return;
              }
              console.error("❌ Error subiendo imagen:", err);
              markPendingUploadError(tempId);
            });
        }
      }

      // 2️⃣ Texto: ya no agregamos una burbuja temporal.
      // Esperamos la respuesta del backend/socket para evitar duplicados y conflictos.
      if (hayTexto) {
        try {
          let nuevo;

          if (chat.tipo === "grupo") {
            const res = await axios.post("/api/mensajes/grupo", {
              grupoId: chat.grupo_id,
              usuarioId: user.id,
              mensaje: text,
              loteId,
              replyToId,
              replyToType,
              replyToGrupoId,
            });
            nuevo = res.data?.mensaje || res.data;
            logDev("✅ Respuesta POST /api/mensajes:", nuevo);
          } else {
            const res = await axios.post("/api/mensajes", {
              senderId: user.id,
              receiverId: chat.usuario_id,
              message: text,
              loteId,
              replyToId,
              replyToType,
              replyToGrupoId,
            });
            nuevo = res.data?.mensaje || res.data;
          }

          if (replyPayload && nuevo && !nuevo.reply_to) {
            nuevo.reply_to = replyPayload;
            nuevo.reply_to_tipo = replyToType;
            nuevo.reply_to_grupo_id = replyToGrupoId;
          }

          if (nuevo?.id) {
            setMessages((prev) => {
              const existe = prev.some((m) => Number(m.id) === Number(nuevo.id));
              if (existe) {
                return sortAndDedupeMessages(
                  prev.map((m) => Number(m.id) === Number(nuevo.id)
                    ? { ...m, ...nuevo, estado: "enviado", reacciones: m.reacciones || nuevo.reacciones || [] }
                    : m
                  )
                );
              }

              return sortAndDedupeMessages([
                ...prev,
                { ...nuevo, estado: "enviado", reacciones: nuevo.reacciones || [] },
              ]);
            });
          }
        } catch (err) {
          console.error("❌ Error enviando mensaje:", err);

          // Cuando se responde un mensaje, versiones anteriores del backend podían guardar
          // el mensaje pero fallar al devolver/armar la cita. En ese caso el socket o una
          // recarga trae el mensaje y mostrar alerta confunde al usuario.
          if (replyToId) {
            setTimeout(async () => {
              try {
                let resVerificacion;
                if (chat.tipo === "grupo") {
                  resVerificacion = await axios.get(`/api/mensajes/grupo/${chat.grupo_id}`, {
                    params: { paginated: 1, limit: MESSAGE_PAGE_SIZE },
                  });
                } else {
                  resVerificacion = await axios.get("/api/mensajes", {
                    params: {
                      usuario1: user.id,
                      usuario2: chat.usuario_id,
                      paginated: 1,
                      limit: MESSAGE_PAGE_SIZE,
                    },
                  });
                }

                const { mensajes } = extractMessagesPayload(resVerificacion.data);
                const posibleGuardado = mensajes.some((m) => {
                  const mismoTexto = String(m?.mensaje || "").trim() === text;
                  const mismoReply = Number(m?.reply_to_id || 0) === Number(replyToId || 0);
                  const mismoUsuario = chat.tipo === "grupo"
                    ? Number(m?.usuario_id) === Number(user.id)
                    : Number(m?.usuario_envia_id) === Number(user.id);
                  return mismoTexto && mismoReply && mismoUsuario;
                });

                if (posibleGuardado) {
                  setMessages((prev) => sortAndDedupeMessages([...prev, ...mensajes]));
                  return;
                }

                alert("No se pudo enviar el mensaje. Inténtalo otra vez.");
              } catch (verifyErr) {
                console.warn("⚠️ No se pudo verificar si la respuesta fue guardada:", verifyErr);
                alert("No se pudo confirmar el envío. Revisa si el mensaje apareció antes de reenviarlo.");
              }
            }, 600);
            return;
          }

          alert("No se pudo enviar el mensaje. Inténtalo otra vez.");
        }
      }

      // 3️⃣ Limpiar previews
      setPendingImages([]);
      setReplyingTo(null);
      inputRef.current?.reset();
    } catch (err) {
      console.error("❌ Error enviando mensaje:", err);
      if (replyToId) {
        setReplyingTo(null);
      }
    }
  };

  // 👇 handler cuando clickeas un emoji
  const handleEmojiClick = (emojiData) => {
    inputRef.current?.insertEmoji(emojiData.emoji);
  };

  const fetchGifs = async (query) => {
    if (!query.trim()) return;
    try {
      const res = await axios.get("https://api.giphy.com/v1/gifs/search", {
        params: {
          api_key: "eYpoeaOCfdA8NSzbqDSoFsA3xrqDxwZR",
          q: query,
          limit: 20,
          rating: "pg",
        },
      });
      logDev("Giphy response:", res.data); // para depurar
      setGifResults(res.data.data);
    } catch (err) {
      console.error("❌ Error buscando GIFs:", err);
    }
  };

  const fetchTrendingGifs = async () => {
    try {
      const res = await axios.get("https://api.giphy.com/v1/gifs/trending", {
        params: {
          api_key: "eYpoeaOCfdA8NSzbqDSoFsA3xrqDxwZR",
          limit: 20,
          rating: "pg",
        },
      });
      setGifResults(res.data.data);
    } catch (err) {
      console.error("❌ Error cargando GIFs trending:", err);
    }
  };

  const closeMediaPickers = () => {
    setShowEmojiPicker(false);
    setShowGifPicker(false);
    setShowStickerPicker(false);
  };

  const openMediaPicker = (panel = "emoji") => {
    setShowEmojiPicker(panel === "emoji");
    setShowGifPicker(panel === "gif");
    setShowStickerPicker(panel === "sticker");

    if (panel === "gif") {
      fetchTrendingGifs();
    }
  };

  const isMediaPickerOpen = showEmojiPicker || showGifPicker || showStickerPicker;
  const activeMediaPicker = showGifPicker ? "gif" : showStickerPicker ? "sticker" : "emoji";

  const toggleMediaPicker = () => {
    if (isMediaPickerOpen) {
      closeMediaPickers();
      return;
    }

    openMediaPicker("emoji");
  };

  const closeStickerEditor = useCallback(() => {
    setShowStickerEditor(false);
    setPendingStickerFile(null);
    setStickerEditorRotation(0);
    setStickerEditorFlipX(false);
    setStickerEditorTool("crop");
    setStickerEditorFilter("none");
    setStickerDrawColor("#22c55e");
    setStickerShapeType("rect");
    setStickerTextItems([]);
    setStickerShapeItems([]);
    setStickerDrawPaths([]);
    setStickerCropRect({ x: 0, y: 0, w: 1, h: 1 });
    if (pendingStickerPreview) {
      URL.revokeObjectURL(pendingStickerPreview);
      setPendingStickerPreview("");
    }
    if (stickerFileInputRef.current) {
      stickerFileInputRef.current.value = "";
    }
  }, [pendingStickerPreview]);

  const openStickerCreator = useCallback(() => {
    setShowStickerPicker(false);
    stickerFileInputRef.current?.click?.();
  }, []);

  const handleStickerFileSelected = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (pendingStickerPreview) {
      URL.revokeObjectURL(pendingStickerPreview);
    }

    setPendingStickerFile(file);
    setPendingStickerPreview(URL.createObjectURL(file));
    setStickerEditorRotation(0);
    setStickerEditorFlipX(false);
    setStickerEditorTool("crop");
    setStickerEditorFilter("none");
    setStickerDrawColor("#22c55e");
    setStickerShapeType("rect");
    setStickerTextItems([]);
    setStickerShapeItems([]);
    setStickerDrawPaths([]);
    setStickerCropRect({ x: 0, y: 0, w: 1, h: 1 });
    setShowStickerEditor(true);
  }, [pendingStickerPreview]);

  useEffect(() => {
    return () => {
      if (pendingStickerPreview) {
        URL.revokeObjectURL(pendingStickerPreview);
      }
    };
  }, [pendingStickerPreview]);

  const getStickerPointerPoint = (event) => {
    const rect = stickerEditorCanvasRef.current?.getBoundingClientRect();
    if (!rect) return null;

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const updateStickerCropFromPointer = useCallback((event) => {
    const corner = stickerCropDragRef.current;
    if (!corner) return;

    const point = getStickerPointerPoint(event);
    if (!point) return;

    event.preventDefault();
    const minSize = 0.16;

    setStickerCropRect((current) => {
      const left = current.x;
      const top = current.y;
      const right = current.x + current.w;
      const bottom = current.y + current.h;
      let nextLeft = left;
      let nextTop = top;
      let nextRight = right;
      let nextBottom = bottom;

      if (corner.includes("left")) {
        nextLeft = Math.max(0, Math.min(point.x, right - minSize));
      }
      if (corner.includes("right")) {
        nextRight = Math.min(1, Math.max(point.x, left + minSize));
      }
      if (corner.includes("top")) {
        nextTop = Math.max(0, Math.min(point.y, bottom - minSize));
      }
      if (corner.includes("bottom")) {
        nextBottom = Math.min(1, Math.max(point.y, top + minSize));
      }

      return {
        x: nextLeft,
        y: nextTop,
        w: nextRight - nextLeft,
        h: nextBottom - nextTop,
      };
    });
  }, []);

  const startStickerCropDrag = (corner) => (event) => {
    if (stickerEditorTool !== "crop") return;
    event.preventDefault();
    event.stopPropagation();
    stickerCropDragRef.current = corner;
  };

  useEffect(() => {
    if (!showStickerEditor) return undefined;

    const handleMove = (event) => updateStickerCropFromPointer(event);
    const handleUp = () => {
      stickerCropDragRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [showStickerEditor, updateStickerCropFromPointer]);

  const handleStickerCanvasPointerDown = (event) => {
    if (stickerEditorTool !== "paint") return;
    const point = getStickerPointerPoint(event);
    if (!point) return;
    event.preventDefault();
    stickerDrawingRef.current = true;
    setStickerDrawPaths((prev) => [
      ...prev,
      {
        id: `path-${Date.now()}`,
        color: stickerDrawColor,
        points: [point],
      },
    ]);
  };

  const handleStickerCanvasPointerMove = (event) => {
    if (!stickerDrawingRef.current || stickerEditorTool !== "paint") return;
    const point = getStickerPointerPoint(event);
    if (!point) return;
    event.preventDefault();
    setStickerDrawPaths((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      return next;
    });
  };

  const stopStickerDrawing = () => {
    stickerDrawingRef.current = false;
  };

  const addStickerText = () => {
    const text = window.prompt("Texto del sticker", "Hola como estan");
    if (!text) return;
    setStickerEditorTool("text");
    setStickerTextItems((prev) => [
      ...prev,
      {
        id: `text-${Date.now()}`,
        text,
        x: 0.5,
        y: 0.5,
        color: stickerDrawColor,
        background: true,
        fontSize: 28,
      },
    ]);
  };

  const addStickerShape = (type = stickerShapeType) => {
    setStickerEditorTool("shape");
    setStickerShapeItems((prev) => [
      ...prev,
      {
        id: `shape-${Date.now()}`,
        type,
        x: 0.5,
        y: 0.5,
        w: 0.22,
        h: 0.16,
        color: stickerDrawColor,
      },
    ]);
  };

  const buildEditedStickerFile = async () => {
    if (!pendingStickerFile) return null;
    const image = stickerEditorImageRef.current;
    if (!image) return pendingStickerFile;

    const size = 512;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = size;
    sourceCanvas.height = size;
    const ctx = sourceCanvas.getContext("2d");
    if (!ctx) return pendingStickerFile;

    const sourceWidth = image.naturalWidth || image.width || size;
    const sourceHeight = image.naturalHeight || image.height || size;
    const maxImageSize = size * 0.88;
    const scale = Math.min(maxImageSize / sourceWidth, maxImageSize / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((stickerEditorRotation * Math.PI) / 180);
    ctx.scale(stickerEditorFlipX ? -1 : 1, 1);
    ctx.filter = STICKER_EDITOR_FILTERS[stickerEditorFilter]?.css || "none";
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
    ctx.filter = "none";

    const toPx = (point) => ({ x: point.x * size, y: point.y * size });

    stickerDrawPaths.forEach((path) => {
      if (!path.points?.length) return;
      ctx.save();
      ctx.strokeStyle = path.color || "#22c55e";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      path.points.forEach((point, index) => {
        const px = toPx(point);
        if (index === 0) ctx.moveTo(px.x, px.y);
        else ctx.lineTo(px.x, px.y);
      });
      ctx.stroke();
      ctx.restore();
    });

    stickerShapeItems.forEach((shape) => {
      const x = (shape.x - shape.w / 2) * size;
      const y = (shape.y - shape.h / 2) * size;
      const w = shape.w * size;
      const h = shape.h * size;
      ctx.save();
      ctx.strokeStyle = shape.color || "#22c55e";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (shape.type === "circle") {
        ctx.beginPath();
        ctx.ellipse(shape.x * size, shape.y * size, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape.type === "line" || shape.type === "arrow") {
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x + w, y);
        ctx.stroke();
        if (shape.type === "arrow") {
          const angle = Math.atan2(-h, w);
          const head = 24;
          ctx.beginPath();
          ctx.moveTo(x + w, y);
          ctx.lineTo(x + w - head * Math.cos(angle - Math.PI / 6), y - head * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x + w, y);
          ctx.lineTo(x + w - head * Math.cos(angle + Math.PI / 6), y - head * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        }
      } else {
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    });

    stickerTextItems.forEach((item) => {
      const x = item.x * size;
      const y = item.y * size;
      const fontSize = item.fontSize || 28;
      ctx.save();
      ctx.font = `700 ${fontSize}px Arial, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const metrics = ctx.measureText(item.text);
      const padX = 12;
      const padY = 7;
      if (item.background) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.strokeStyle = item.color || "#22c55e";
        ctx.lineWidth = 4;
        const boxW = metrics.width + padX * 2;
        const boxH = fontSize + padY * 2;
        ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH);
        ctx.strokeRect(x - boxW / 2, y - boxH / 2, boxW, boxH);
      }
      ctx.fillStyle = "#111827";
      ctx.fillText(item.text, x, y);
      ctx.restore();
    });

    const crop = stickerCropRect || { x: 0, y: 0, w: 1, h: 1 };
    const cropX = Math.max(0, Math.min(size - 1, crop.x * size));
    const cropY = Math.max(0, Math.min(size - 1, crop.y * size));
    const cropW = Math.max(1, Math.min(size - cropX, crop.w * size));
    const cropH = Math.max(1, Math.min(size - cropY, crop.h * size));

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const outCtx = canvas.getContext("2d");
    if (!outCtx) return pendingStickerFile;
    outCtx.clearRect(0, 0, size, size);
    outCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, size, size);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return pendingStickerFile;
    return new File([blob], `sticker_${Date.now()}.png`, { type: "image/png" });
  };

  const addOrKeepPendingStickerMessage = (pendingId, previewUrl, replyPayload = null, replyToId = null, replyToType = "privado", replyToGrupoId = null) => {
    const pendingText = `[sticker]${previewUrl}`;
    const pendingMessage = createLocalOutgoingMessage({
      id: pendingId,
      mensaje: pendingText,
      estado: "subiendo",
      reply_to_id: replyToId,
      reply_to_tipo: replyToType,
      reply_to_grupo_id: replyToGrupoId,
      reply_to: replyPayload,
    });

    setMessages((prev) => {
      if (prev.some((m) => m.id === pendingId)) return prev;
      return sortAndDedupeMessages([...prev, pendingMessage]);
    });
  };

  const sendStickerMessage = async (rawStickerUrl, stickerData = null, options = {}) => {
    if (!chat || !user?.id || !rawStickerUrl) return null;

    const stickerUrl = normalizeStickerMessageUrl(rawStickerUrl);
    const text = `[sticker]${stickerUrl}`;
    const replyToId = options.replyToId ?? replyingTo?.id ?? null;
    const replyToType = options.replyToType ?? replyingTo?.reply_to_tipo ?? replyingTo?.reply_source ?? "privado";
    const replyToGrupoId = options.replyToGrupoId ?? replyingTo?.reply_to_grupo_id ?? replyingTo?.source_group_id ?? null;
    const replyPayload = options.replyPayload ?? replyingTo ?? null;
    const pendingStickerId = options.pendingId || `temp-sticker-${Date.now()}-${Math.random()}`;
    const localPreviewUrl = options.localPreviewUrl || stickerUrl;

    if (replyToId) setReplyingTo(null);

    addOrKeepPendingStickerMessage(
      pendingStickerId,
      localPreviewUrl,
      replyPayload,
      replyToId,
      replyToType,
      replyToGrupoId
    );

    pendingUploadsRef.current.set(pendingStickerId, {
      kind: "sticker",
      stickerUrl,
      stickerData,
      localPreviewUrl,
      replyToId,
      replyToType,
      replyToGrupoId,
      replyPayload,
    });

    inputRef.current?.reset?.();
    setShowStickerPicker(false);

    try {
      let nuevo;
      if (chat.tipo === "grupo") {
        const res = await axios.post("/api/mensajes/grupo", {
          grupoId: chat.grupo_id,
          usuarioId: user.id,
          mensaje: text,
          replyToId,
          replyToType,
          replyToGrupoId,
        });
        nuevo = res.data?.mensaje || res.data;
      } else {
        const res = await axios.post("/api/mensajes", {
          senderId: user.id,
          receiverId: chat.usuario_id,
          message: text,
          replyToId,
          replyToType,
          replyToGrupoId,
        });
        nuevo = res.data?.mensaje || res.data;
      }

      if (replyPayload && nuevo && !nuevo.reply_to) {
        nuevo.reply_to = replyPayload;
        nuevo.reply_to_tipo = replyToType;
        nuevo.reply_to_grupo_id = replyToGrupoId;
      }

      if (nuevo?.id) {
        setMessages((prev) => {
          const exists = prev.some((m) => Number(m.id) === Number(nuevo.id));
          if (exists) {
            return prev
              .filter((m) => m.id !== pendingStickerId)
              .map((m) => Number(m.id) === Number(nuevo.id) ? { ...m, ...nuevo, estado: "enviado" } : m);
          }
          return sortAndDedupeMessages(
            prev.map((m) => m.id === pendingStickerId ? { ...m, ...nuevo, estado: "enviado" } : m)
          );
        });
      }

      clearPendingUpload(pendingStickerId);

      setStickersTodos((prev) => {
        const sinDuplicados = prev.filter((item) => normalizeStickerMessageUrl(item.url) !== stickerUrl);
        return [
          {
            ...(stickerData || {}),
            id: stickerData?.id || `local-${Date.now()}`,
            url: stickerUrl,
            enviado_en: new Date().toISOString(),
          },
          ...sinDuplicados,
        ];
      });

      return nuevo;
    } catch (err) {
      console.error("❌ Error enviando sticker:", err);
      markPendingUploadError(pendingStickerId);
      throw err;
    }
  };

  const uploadAndSendStickerFile = async (file, options = {}) => {
    if (!file || !user?.id) return null;

    const pendingId = options.pendingId || `temp-sticker-${Date.now()}-${Math.random()}`;
    const localPreviewUrl = options.localPreviewUrl || URL.createObjectURL(file);
    const replyToId = options.replyToId ?? replyingTo?.id ?? null;
    const replyToType = options.replyToType ?? replyingTo?.reply_to_tipo ?? replyingTo?.reply_source ?? "privado";
    const replyToGrupoId = options.replyToGrupoId ?? replyingTo?.reply_to_grupo_id ?? replyingTo?.source_group_id ?? null;
    const replyPayload = options.replyPayload ?? replyingTo ?? null;

    addOrKeepPendingStickerMessage(pendingId, localPreviewUrl, replyPayload, replyToId, replyToType, replyToGrupoId);
    pendingUploadsRef.current.set(pendingId, {
      kind: "sticker",
      file,
      localPreviewUrl,
      stickerData: options.originalStickerData || null,
      replyToId,
      replyToType,
      replyToGrupoId,
      replyPayload,
    });

    try {
      const formData = new FormData();
      formData.append("archivo", file);
      formData.append("usuarioId", user.id);

      const res = await axios.post(`/api/stickers?usuarioId=${user.id}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (!res.data?.success || !res.data?.sticker) {
        console.error("❌ Respuesta inesperada /api/stickers:", res.data);
        markPendingUploadError(pendingId);
        return null;
      }

      const sticker = {
        ...res.data.sticker,
        url: normalizeStickerMessageUrl(res.data.sticker.url),
      };

      return await sendStickerMessage(sticker.url, sticker, {
        pendingId,
        localPreviewUrl,
        replyToId,
        replyToType,
        replyToGrupoId,
        replyPayload,
      });
    } catch (err) {
      console.error("❌ Error subiendo sticker:", {
        status: err.response?.status,
        data: err.response?.data,
        headers: err.response?.headers,
      });
      markPendingUploadError(pendingId);
      throw err;
    }
  };

  // 👇 Subir Sticker (catálogo, NO favorito)
  const handleStickerUpload = async (file) => {
    if (!file || !user?.id || isCreatingSticker) return;

    setIsCreatingSticker(true);

    try {
      const stickerFile = showStickerEditor ? await buildEditedStickerFile() : file;
      await uploadAndSendStickerFile(stickerFile || file);
      closeStickerEditor();
    } catch (err) {
      console.error("❌ Error subiendo/enviando sticker:", err);
    } finally {
      setIsCreatingSticker(false);
    }
  };

  const confirmStickerCreation = useCallback(async () => {
    if (!pendingStickerFile || isCreatingSticker) return;
    await handleStickerUpload(pendingStickerFile);
  }, [pendingStickerFile, isCreatingSticker, showStickerEditor, stickerEditorRotation, stickerEditorFlipX, stickerEditorFilter, stickerDrawPaths, stickerTextItems, stickerShapeItems]);

  // 👉 Función para sacar inicial (si no hay avatar)
  const getInitial = (text) => {
    if (!text) return "U";
      return text.charAt(0).toUpperCase();
  };

  const addSelfSuffix = (name = "Usuario") => {
    const cleanName = String(name || "Usuario").trim() || "Usuario";
    return /\(Tú\)$/i.test(cleanName) ? cleanName : `${cleanName} (Tú)`;
  };

  const isSelfPrivateChat = (targetChat = chat) =>
    targetChat?.tipo !== "grupo" && Number(targetChat?.usuario_id) === Number(user?.id);

  const getChatDisplayName = (targetChat = chat) => {
    const baseName = targetChat?.usuario_nombre || targetChat?.nombre || (targetChat?.tipo === "grupo" ? "Grupo" : "Usuario");
    return isSelfPrivateChat(targetChat) ? addSelfSuffix(baseName) : baseName;
  };

  const getPresenceInfo = (targetUserId) => {
    const estado = estadosUsuarios?.[String(targetUserId)] || estadosUsuarios?.[Number(targetUserId)] || null;
    const rawStatus = estado?.estado || "desconectado";
    const dispositivo = estado?.dispositivo || "desktop";

    const meta = {
      online: {
        label: dispositivo === "mobile" ? "En línea desde teléfono" : "En línea desde PC",
        className: "online",
        iconClass: dispositivo === "mobile" ? "fa-solid fa-mobile-screen-button" : "fa-solid fa-desktop",
      },
      inactivo: {
        label: "Inactivo",
        className: "idle",
        iconClass: "fa-solid fa-moon",
      },
      no_molestar: {
        label: "No molestar",
        className: "dnd",
        iconClass: "fa-solid fa-minus",
      },
      desconectado: {
        label: "Sin conexión",
        className: "offline",
        iconClass: "fa-regular fa-circle",
      },
    };

    return meta[rawStatus] || meta.desconectado;
  };

  const renderPresenceBadge = (targetUserId) => {
    const presence = getPresenceInfo(targetUserId);
    return (
      <span className={`wa-presence-badge ${presence.className}`} title={presence.label}>
        <i className={presence.iconClass} aria-hidden="true" />
      </span>
    );
  };

  const getPrivatePresenceText = () => {
    if (!chat || chat.tipo === "grupo") return "";
    return getPresenceInfo(chat.usuario_id).label;
  };

  const getHeaderSubtitle = () => {
    if (!chat) return "";
    if (chat.tipo !== "grupo") return getPrivatePresenceText() || chat.usuario_correo || "";

    const miembros = Array.isArray(chat.miembros) ? chat.miembros : [];
    if (miembros.length) {
      const names = miembros
        .slice(0, 4)
        .map((m) => Number(m.id) === Number(user?.id) ? "Tú" : (m.nombre || m.correo || "Usuario"))
        .filter(Boolean)
        .join(", ");
      return names || `${miembros.length} miembros`;
    }

    return `${chat.miembros?.length || 0} miembros, ${chat.online || 0} online`;
  };

  const handleBuscarEnChat = () => {
    if (chat?.tipo !== "grupo") return;
    setMostrarInfoGrupo(true);
    setSearchRequestToken(Date.now());
  };

  // 👉 Scroll hasta el mensaje fijado en el cuerpo del chat
  const scrollToMessage = (mensajeId) => {
    const elemento = document.getElementById(`mensaje-${mensajeId}`);
    if (elemento) {
      elemento.scrollIntoView({ behavior: "smooth", block: "center" });
      elemento.classList.add("highlight-pinned");
      setTimeout(() => elemento.classList.remove("highlight-pinned"), 1500);
      return true;
    }

    return false;
  };

  const handleJumpToGroupSearchMessage = useCallback(async (mensajeId) => {
    if (!chat?.grupo_id || !mensajeId) return false;

    const foundInCurrentPage = scrollToMessage(mensajeId);
    if (foundInCurrentPage) return true;

    return cargarContextoMensajeGrupo(chat.grupo_id, mensajeId);
  }, [chat?.grupo_id, cargarContextoMensajeGrupo]);

  const handlePinnedMessageClick = useCallback(async (mensajeId) => {
    if (!mensajeId) return false;

    const foundInCurrentPage = scrollToMessage(mensajeId);
    if (foundInCurrentPage) return true;

    if (chat?.tipo === "grupo") {
      return cargarContextoMensajeGrupo(chat.grupo_id, mensajeId);
    }

    return cargarContextoMensajePrivado(mensajeId);
  }, [chat?.tipo, chat?.grupo_id, cargarContextoMensajeGrupo, cargarContextoMensajePrivado]);

  const handleReplyPreviewClick = useCallback((replyMessage = {}, currentMessage = {}) => {
    const targetId = replyMessage.id || replyMessage.reply_to_id || currentMessage.reply_to_id;
    if (!targetId) return false;

    const sourceType =
      replyMessage.reply_to_tipo ||
      replyMessage.reply_source ||
      currentMessage.reply_to_tipo ||
      currentMessage.reply_source ||
      null;

    const sourceGroupId =
      replyMessage.source_group_id ||
      replyMessage.reply_to_grupo_id ||
      currentMessage.reply_to_grupo_id ||
      currentMessage.source_group_id ||
      (sourceType === "grupo" && chat?.tipo === "grupo" ? chat.grupo_id : null);

    const sourceGroupName =
      replyMessage.source_group_name ||
      replyMessage.reply_source_group_name ||
      currentMessage.source_group_name ||
      currentMessage.reply_source_group_name ||
      chat?.usuario_nombre ||
      chat?.nombre ||
      "Grupo";

    // Si el mensaje citado viene de un grupo y estamos en privado, abrimos
    // ese grupo y centramos el mensaje original, igual que WhatsApp.
    if (sourceType === "grupo" || sourceGroupId) {
      const groupId = sourceGroupId || chat?.grupo_id;
      if (!groupId) return false;

      if (chat?.tipo === "grupo" && Number(chat.grupo_id) === Number(groupId)) {
        if (scrollToMessage(targetId)) return true;
        cargarContextoMensajeGrupo(groupId, targetId);
        return true;
      }

      openGroupAndJumpToMessage(groupId, targetId, sourceGroupName);
      return true;
    }

    return false;
  }, [
    cargarContextoMensajeGrupo,
    chat?.grupo_id,
    chat?.nombre,
    chat?.tipo,
    chat?.usuario_nombre,
    openGroupAndJumpToMessage,
  ]);

  const markCurrentChatAsRead = useCallback(async () => {
    if (!chat || !user?.id) return;

    try {
      if (chat.tipo === "grupo") {
        await axios.put("/api/mensajes/grupo/marcar-vistos-grupo", {
          userId: user.id,
          grupoId: chat.grupo_id,
        });

        setMessages((prev) =>
          prev.map((message) =>
            Number(message.grupo_id) === Number(chat.grupo_id) && Number(message.usuario_id) !== Number(user.id)
              ? { ...message, visto: 1 }
              : message
          )
        );
        return;
      }

      await axios.put("/api/mensajes/marcar-vistos", {
        userId: user.id,
        contactoId: chat.usuario_id,
      });

      setMessages((prev) =>
        prev.map((message) =>
          Number(message.usuario_envia_id) === Number(chat.usuario_id) && Number(message.usuario_recibe_id) === Number(user.id)
            ? { ...message, visto: 1 }
            : message
        )
      );
    } catch (err) {
      console.error("❌ Error marcando chat como visto desde el scroll:", err);
    }
  }, [chat?.tipo, chat?.grupo_id, chat?.usuario_id, user?.id]);

  const handleArchivoSeleccionado = (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;

    // 👇 Ahora manejamos imágenes + documentos + lo que sea
    handleFilesSeleccionados(files);

    e.target.value = "";
  };

  // Maneja CUALQUIER tipo de archivo seleccionado / arrastrado
  const handleFilesSeleccionados = (fileList, options = {}) => {
    const filesArray = Array.from(fileList || []);
    if (!filesArray.length) return;

    const archivosPermitidos = filesArray;

    if (!archivosPermitidos.length) return;

    // 1) Imágenes → van a la cola de preview
    const imageFiles = archivosPermitidos.filter((f) => f.type.startsWith("image/"));

    if (imageFiles.length) {
      addImagesToPending(imageFiles, options);
    }

    // 2) Otros archivos (Word, Excel, ZIP, EXE, etc.) → subir directo
    const otherFiles = archivosPermitidos.filter((f) => !f.type.startsWith("image/"));

    const replyFileId = replyingTo?.id || null;
    const replyFileType = replyingTo?.reply_to_tipo || replyingTo?.reply_source || "privado";
    const replyFileGrupoId = replyingTo?.reply_to_grupo_id || replyingTo?.source_group_id || null;

    if (replyFileId && otherFiles.length) {
      setReplyingTo(null);
    }

    otherFiles.forEach(async (file) => {
      try {
        // loteId = null, y no necesitamos barra de progreso aquí
        await uploadImageMessage(
          file,
          null,
          null,
          replyFileId,
          replyFileType,
          replyFileGrupoId
        );
        setReplyingTo(null);
        logDev("📁 Archivo subido correctamente:", file.name);
        // El mensaje aparecerá cuando llegue el evento socket "nuevoMensaje" / "nuevoMensajeGrupo"
      } catch (err) {
        console.error("❌ Error subiendo archivo:", file.name, err);
        alert(`Error al subir el archivo: ${file.name}`);
      }
    });
  };

   // 👇 centralizamos cómo añadimos imágenes a la “cola” tipo WhatsApp
  const getPendingImageKey = (file) =>
    `${file?.type || "image"}:${file?.size || 0}`;

  const uniquePendingImageFiles = (files, options = {}) => {
    const shouldDedupePaste = options?.source === "paste";
    const seen = new Set();

    return Array.from(files || []).filter((file) => {
      if (!file?.type?.startsWith("image/")) return false;
      if (!shouldDedupePaste) return true;

      const key = getPendingImageKey(file);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const addImagesToPending = (fileList, options = {}) => {
    const imageFiles = uniquePendingImageFiles(fileList, options);
    if (!imageFiles.length) return;

    const mapped = imageFiles.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
    }));

    setPendingImages((prev) => {
      if (options?.source === "paste") {
        const existingKeys = new Set(prev.map((item) => getPendingImageKey(item.file)));
        const freshMapped = mapped.filter((item) => !existingKeys.has(getPendingImageKey(item.file)));
        if (!freshMapped.length) return prev;
        setActiveImageIndex(prev.length);
        return [...prev, ...freshMapped];
      }

      const next = [...prev, ...mapped];
      setActiveImageIndex(prev.length);
      return next;
    });
  };

  // 👇 sube UNA imagen y devuelve el objeto mensaje del backend
  const uploadImageMessage = async (file, loteId, onProgress, replyToId = null, replyToType = "privado", replyToGrupoId = null, requestOptions = {}) => {
    if (file.size > 100 * 1024 * 1024) {
      alert("⚠️ El archivo supera los 100 MB permitidos.");
      return null;
    }

    const formData = new FormData();
    formData.append("archivo", file);
    if (requestOptions?.isVoiceNote) formData.append("esNotaVoz", "1");
    if (loteId) formData.append("loteId", loteId); // 👈 importante
    if (replyToId) formData.append("replyToId", replyToId);
    if (replyToId && replyToType) formData.append("replyToType", replyToType);
    if (replyToId && replyToGrupoId) formData.append("replyToGrupoId", replyToGrupoId);

    let lastPercent = 0;
    let res;

    if (chat.tipo === "grupo") {
      res = await axios.post(
        `/api/mensajes/grupo/archivo?grupo_id=${chat.grupo_id}&usuario_id=${user.id}`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          signal: requestOptions.signal,
          onUploadProgress: (e) => {
            if (onProgress && e.total) {
              const percent = Math.round((e.loaded * 100) / e.total);
              if (percent === 100 || percent - lastPercent >= 10) {
                lastPercent = percent;
                onProgress(percent);
              }
            }
          },
        }
      );
    } else {
      res = await axios.post(
        `/api/mensajes/archivo?sender_id=${user.id}&receiver_id=${chat.usuario_id}`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          signal: requestOptions.signal,
          onUploadProgress: (e) => {
            if (onProgress && e.total) {
              const percent = Math.round((e.loaded * 100) / e.total);
              if (percent === 100 || percent - lastPercent >= 10) {
                lastPercent = percent;
                onProgress(percent);
              }
            }
          },
        }
      );
    }

    logDev("📁 Imagen subida:", res.data);

    const mensaje = res.data?.mensaje;
    if (!mensaje) return null;

    if (replyingTo && replyToId && !mensaje.reply_to) {
      mensaje.reply_to = replyingTo;
      mensaje.reply_to_tipo = replyToType;
      mensaje.reply_to_grupo_id = replyToGrupoId;
    }

    // devolvemos SIEMPRE el objeto mensaje
    return {
      ...mensaje,
      lote_id: mensaje.lote_id || loteId, // 👈 forzamos a que venga el lote
    };
  };


  const formatRecordingDuration = (seconds = 0) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const stopAudioMeter = () => {
    if (audioAnimationFrameRef.current) {
      cancelAnimationFrame(audioAnimationFrameRef.current);
      audioAnimationFrameRef.current = null;
    }

    audioAnalyserRef.current = null;

    if (audioContextRef.current) {
      audioContextRef.current.close?.().catch(() => {});
      audioContextRef.current = null;
    }

    audioSmoothedLevelRef.current = 0;
    audioLastWaveSampleAtRef.current = 0;
    audioPausedRef.current = false;
    setAudioLevel(0);
    setAudioWaveSamples(buildIdleRecorderWave());
  };

  const startAudioMeter = (stream) => {
    stopAudioMeter();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.88;

      const dataArray = new Uint8Array(analyser.fftSize);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      audioAnalyserRef.current = analyser;
      audioSmoothedLevelRef.current = 0;
      audioLastWaveSampleAtRef.current = performance.now();
      audioPausedRef.current = false;

      const updateLevel = (now = performance.now()) => {
        if (!audioAnalyserRef.current) return;

        if (audioPausedRef.current) {
          audioAnimationFrameRef.current = requestAnimationFrame(updateLevel);
          return;
        }

        audioAnalyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;

        for (let i = 0; i < dataArray.length; i += 1) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }

        const rms = Math.sqrt(sum / dataArray.length);
        const gatedLevel = rms < RECORDER_SILENCE_THRESHOLD ? 0 : (rms - RECORDER_SILENCE_THRESHOLD) * 16;
        const rawLevel = clampRecorderLevel(gatedLevel);
        const previousLevel = audioSmoothedLevelRef.current;
        const smoothing = rawLevel > previousLevel ? 0.45 : 0.14;
        const nextLevel = previousLevel + (rawLevel - previousLevel) * smoothing;
        const visualLevel = nextLevel < 0.04 ? 0 : clampRecorderLevel(0.16 + nextLevel * 0.95);

        audioSmoothedLevelRef.current = nextLevel;

        if (now - audioLastWaveSampleAtRef.current >= RECORDER_WAVE_SAMPLE_INTERVAL_MS) {
          audioLastWaveSampleAtRef.current = now;
          setAudioLevel(visualLevel);
          setAudioWaveSamples((previousSamples) => [
            ...previousSamples.slice(1),
            visualLevel,
          ]);
        }

        audioAnimationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (err) {
      console.error("❌ No se pudo iniciar el medidor de voz:", err);
      setAudioLevel(0);
      setAudioWaveSamples(buildIdleRecorderWave());
    }
  };

  const stopAudioTracks = () => {
    audioStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    audioStreamRef.current = null;
  };

  const resetAudioRecordingUi = () => {
    audioPausedRef.current = false;
    audioSmoothedLevelRef.current = 0;
    audioLastWaveSampleAtRef.current = 0;
    setIsRecordingAudio(false);
    setIsAudioPaused(false);
    setRecordingSeconds(0);
    setAudioLevel(0);
    setAudioWaveSamples(buildIdleRecorderWave());
  };

  const uploadRecordedAudio = async (audioFile, replyContext = null) => {
    if (!puedeGrabarAudios) {
      alert("No tienes permiso para grabar audios. Solicita autorización a un administrador.");
      return;
    }

    const replyAudioId = replyContext?.id || null;
    const replyAudioType = replyContext?.reply_to_tipo || replyContext?.reply_source || "privado";
    const replyAudioGrupoId = replyContext?.reply_to_grupo_id || replyContext?.source_group_id || null;

    if (replyAudioId) {
      setReplyingTo(null);
    }

    setIsSendingAudio(true);
    try {
      await uploadImageMessage(
        audioFile,
        null,
        null,
        replyAudioId,
        replyAudioType,
        replyAudioGrupoId,
        { isVoiceNote: true }
      );
      logDev("🎙️ Audio enviado correctamente:", audioFile.name);
    } catch (err) {
      console.error("❌ Error enviando audio:", err);
      alert("No se pudo enviar la nota de voz. Revisa el permiso del micrófono e inténtalo otra vez.");
    } finally {
      setIsSendingAudio(false);
      recordingReplyRef.current = null;
    }
  };

  const stopAndSendAudioRecording = () => {
    if (isSendingAudio) return;

    const recorder = audioRecorderRef.current;
    if (!recorder || !["recording", "paused"].includes(recorder.state)) return;

    discardRecordingRef.current = false;
    recorder.stop();
  };

  const cancelAudioRecording = () => {
    const recorder = audioRecorderRef.current;
    if (!recorder || !["recording", "paused"].includes(recorder.state)) return;

    discardRecordingRef.current = true;
    recorder.stop();
  };

  const togglePauseAudioRecording = () => {
    const recorder = audioRecorderRef.current;
    if (!recorder) return;

    if (recorder.state === "recording") {
      recorder.pause();
      audioPausedRef.current = true;
      audioSmoothedLevelRef.current = 0;
      setIsAudioPaused(true);
      setAudioLevel(0);
      return;
    }

    if (recorder.state === "paused") {
      recorder.resume();
      audioPausedRef.current = false;
      audioLastWaveSampleAtRef.current = performance.now();
      setIsAudioPaused(false);
    }
  };

  const handleAudioRecordClick = async () => {
    if (isSendingAudio) return;

    if (!puedeGrabarAudios) {
      alert("No tienes permiso para grabar audios. Solicita autorización a un administrador.");
      return;
    }

    if (isRecordingAudio) {
      stopAndSendAudioRecording();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
      alert("Tu navegador no permite grabar audio desde aquí.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const nextRecorder = new window.MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      audioChunksRef.current = [];
      audioStreamRef.current = stream;
      audioRecorderRef.current = nextRecorder;
      recordingReplyRef.current = replyingTo || null;
      discardRecordingRef.current = false;

      nextRecorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      nextRecorder.onstop = () => {
        const shouldDiscard = discardRecordingRef.current;
        const recordedMimeType = nextRecorder.mimeType || mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: recordedMimeType });
        const replyContext = recordingReplyRef.current;

        stopAudioTracks();
        stopAudioMeter();
        resetAudioRecordingUi();
        audioRecorderRef.current = null;

        if (shouldDiscard || !audioBlob.size) {
          recordingReplyRef.current = null;
          discardRecordingRef.current = false;
          return;
        }

        const extension = getAudioExtensionFromMimeType(recordedMimeType);
        const audioFile = new File([audioBlob], `voice_note_${Date.now()}.${extension}`, {
          type: recordedMimeType,
        });

        uploadRecordedAudio(audioFile, replyContext);
      };

      nextRecorder.onerror = (event) => {
        console.error("❌ Error grabando audio:", event.error || event);
        stopAudioTracks();
        stopAudioMeter();
        resetAudioRecordingUi();
        audioRecorderRef.current = null;
        recordingReplyRef.current = null;
        discardRecordingRef.current = false;
        alert("No se pudo grabar el audio.");
      };

      nextRecorder.start();
      audioPausedRef.current = false;
      audioSmoothedLevelRef.current = 0;
      setRecordingSeconds(0);
      setIsAudioPaused(false);
      setAudioWaveSamples(buildIdleRecorderWave());
      setIsRecordingAudio(true);
      startAudioMeter(stream);
      setShowEmojiPicker(false);
      setShowGifPicker(false);
      setShowStickerPicker(false);
    } catch (err) {
      console.error("❌ Permiso de micrófono denegado o no disponible:", err);
      stopAudioTracks();
      stopAudioMeter();
      resetAudioRecordingUi();
      audioRecorderRef.current = null;
      recordingReplyRef.current = null;
      discardRecordingRef.current = false;
      alert("No se pudo acceder al micrófono.");
    }
  };

  const canSendMessage = !isRecordingAudio && (inputText.trim().length > 0 || pendingImages.length > 0);

  const dragDepth = useRef(0);

  const isFileDrag = (e) =>
    e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

  const handleDragEnter = (e) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;

    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!isFileDrag(e)) return;

    dragDepth.current = 0;
    setIsDragOver(false);

    if (e.dataTransfer?.files?.length) {
      handleFilesSeleccionados(e.dataTransfer.files);
    }
  };

  return (
    <main
      className="main is-visible"
      data-dropzone-area=""
      // 👇 drag & drop de archivos
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`container-fluid h-100 px-0 wa-chat-shell ${(mostrarInfoGrupo || mostrarInfoContacto) ? "is-info-open" : ""}`}>
        <div className="wa-chat-conversation d-flex flex-column h-100 position-relative">
          {/* Header del chat */}
          <div className="chat-header wa-chat-header border-bottom">
            <div className="row align-items-center">
              {/* Mobile: close */}
              <div className="col-2 d-xl-none">
                <a
                  className="icon icon-lg text-muted"
                  href="#"
                  onClick={() => onCloseChat()}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="feather feather-chevron-left"
                  >
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </a>
              </div>
              {/* Mobile: close */}

              {/* Content */}
              <div className="col-8 col-xl-12">
                <div className="row align-items-center text-center text-xl-start">
                  {/* Title */}
                  <div className="col-12 col-xl-6">
                    <div className="row align-items-center gx-5">
                      <div className="col-auto">
                        {chat.tipo === "grupo" ? (
                        <>
                          <div 
                            className="d-flex align-items-center cursor-pointer"
                            onClick={() => { setMostrarInfoContacto(false); setMostrarInfoGrupo(true); }} // 👈 al hacer clic abrimos la info
                          >
                            {/* Avatar o icono del grupo */}
                            <div className="avatar me-3">
                              <GroupAvatar group={chat} members={chat.miembros} size={44} />
                            </div>

                            {/* Nombre + info */}
                            <div className="col overflow-hidden wa-chat-title-block">
                              <h5 className="text-truncate mb-0">
                                {chat.usuario_nombre || chat.nombre || "Grupo"}
                              </h5>
                              <small className={`text-truncate d-block ${getTypingHeaderText() ? "wa-header-typing" : "text-muted"}`}>
                                {getTypingHeaderText() || getHeaderSubtitle()}
                              </small>
                            </div>
                          </div>
                          {/* 🔹 Sidebar deslizante */}

                          

                          {/* Avatares de miembros */}

                        </>
                        ) : (
                        <>
                          <div
                            className="d-flex align-items-center cursor-pointer"
                            onClick={() => { setMostrarInfoGrupo(false); setMostrarInfoContacto(true); }}
                          >
                            <div className="avatar d-none d-xl-inline-block me-3">
                              {chat?.url_imagen ? (
                                <div className="wa-presence-wrapper">
                                  <img
                                    src={getAvatarUrl(chat.url_imagen)}
                                    alt={getChatDisplayName(chat)}
                                    className="avatar-img"
                                    style={{
                                      width: "44px",
                                      height: "44px",
                                      objectFit: "cover",
                                    }}
                                  />
                                  {renderPresenceBadge(chat.usuario_id)}
                                </div>
                              ) : (
                                <div className="wa-presence-wrapper">
                                  <div
                                    className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                    style={{
                                      width: "44px",
                                      height: "44px",
                                      backgroundColor: chat?.background || "#6c757d",
                                      fontSize: "18px",
                                    }}
                                  >
                                    {getInitial(chat?.usuario_nombre || "U")}
                                  </div>
                                  {renderPresenceBadge(chat.usuario_id)}
                                </div>
                              )}
                            </div>
                            <div className="col overflow-hidden wa-chat-title-block">
                              <h5 className="text-truncate mb-0">
                                {getChatDisplayName(chat)}
                              </h5>
                              {(getTypingHeaderText() || getHeaderSubtitle()) && (
                                <small className={`text-truncate d-block ${getTypingHeaderText() ? "wa-header-typing" : "text-muted"}`}>
                                  {getTypingHeaderText() || getHeaderSubtitle()}
                                </small>
                              )}
                            </div>
                          </div>
                        </>
                        )}
                      </div>

                      
                    </div>
                  </div>
                  {/* Title */}

                  {/* Toolbar (desktop) */}
                  <div className="col-xl-6 d-none d-xl-block">
                    <div className="row align-items-center justify-content-end gx-6">
                      <div className="col-auto position-relative" ref={callMenuRef}>
                        <button
                          type="button"
                          className="wa-header-icon-btn"
                          onClick={() => setMostrarMenuLlamada((prev) => !prev)}
                          title="Videollamada"
                        >
                          <i className="fa-solid fa-video" aria-hidden="true" />
                          <i className="fa-solid fa-caret-down ms-1" aria-hidden="true" />
                        </button>
                        {mostrarMenuLlamada && (
                          <div className="wa-call-menu">
                            <div className="wa-call-menu-head">
                              {chat.tipo === "grupo" ? (
                                <GroupAvatar group={chat} members={chat.miembros} size={42} />
                              ) : chat?.url_imagen ? (
                                <img src={getAvatarUrl(chat.url_imagen)} alt={getChatDisplayName(chat)} />
                              ) : (
                                <div style={{ backgroundColor: chat?.background || "#6c757d" }}>{getInitial(chat?.usuario_nombre || "U")}</div>
                              )}
                              <div>
                                <strong>{getChatDisplayName(chat)}</strong>
                                <span>{chat.tipo === "grupo" ? "Selecciona personas" : "Llamada"}</span>
                              </div>
                            </div>
                            <div className="wa-call-menu-actions">
                              <button type="button"><i className="fa-solid fa-phone" aria-hidden="true" /> Voz</button>
                              <button type="button"><i className="fa-solid fa-video" aria-hidden="true" /> Video</button>
                            </div>
                            <button type="button" className="wa-call-menu-row"><i className="fa-solid fa-link" aria-hidden="true" /> Enviar enlace de llamada</button>
                            <button type="button" className="wa-call-menu-row"><i className="fa-regular fa-calendar" aria-hidden="true" /> Programar llamada</button>
                          </div>
                        )}
                      </div>

                      <div className="col-auto">
                        <button
                          type="button"
                          className="wa-header-icon-btn"
                          onClick={handleBuscarEnChat}
                          title="Buscar en el chat"
                        >
                          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="col-auto">
                        <a
                          href="#"
                          className="icon icon-lg text-muted"
                          data-bs-toggle="offcanvas"
                          data-bs-target="#offcanvas-more"
                          aria-controls="offcanvas-more"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="feather feather-more-horizontal"
                          >
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="19" cy="12" r="1"></circle>
                            <circle cx="5" cy="12" r="1"></circle>
                          </svg>
                        </a>
                      </div>

                      {/* Avatares: si es grupo mostramos miembros, si es individual el usuario + yo */}
                      <div className="col-auto">
                        <div className="avatar-group">
                          {chat.tipo === "grupo" ? (
                            <>
                              {/* Primeros 3 miembros */}
                              {chat.miembros?.slice(0, 3).map((m) => (
                                <div
                                  key={m.id}
                                  className="avatar avatar-sm"
                                  style={{ cursor: "pointer" }}
                                  onClick={() => 
                                    onVerPerfil({
                                      id: m.id,
                                      nombre: m.nombre,
                                      apellido: m.apellido || "",
                                      url_imagen: m.url_imagen,
                                      correo: m.correo || "",
                                      background: m.background || "#6c757d",
                                    })
                                  }
                                >
                                  <div className="wa-presence-wrapper wa-presence-wrapper-sm">
                                    {m.url_imagen ? (
                                      <img
                                        className="avatar-img rounded-circle"
                                        src={getAvatarUrl(m.url_imagen)}
                                        alt={m.nombre}
                                        style={{ objectFit: "cover" }}
                                      />
                                    ) : (
                                      <div
                                        className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                        style={{
                                          width: "34px",
                                          height: "34px",
                                          backgroundColor: m.background || "#6c757d",
                                          fontSize: "14px",
                                        }}
                                      >
                                        {getInitial(m.nombre, m.apellido)}
                                      </div>
                                    )}
                                    {renderPresenceBadge(m.id)}
                                  </div>
                                </div>
                              ))}

                              {/* Avatar azul con + o +N (abre offcanvas de miembros) */}
                              <a
                                href="#"
                                className="avatar avatar-sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  logDev("👉 Abriendo modal miembros grupo:", chat.grupo_id);
                                  setOffcanvasGrupo(chat); // mantiene la referencia del grupo actual
                                }}
                              >
                                <div
                                  className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                  style={{
                                    width: "34px",
                                    height: "34px",
                                    backgroundColor: "#007bff",
                                    fontSize: chat.miembros?.length > 3 ? "12px" : "18px",
                                  }}
                                >
                                  {chat.miembros?.length > 3
                                    ? `+${chat.miembros.length - 3}`
                                    : "+"}
                                </div>
                              </a>
                            </>
                          ) : (
                            <>
                              {/* Avatar del otro usuario */}
                              <div
                                className="avatar avatar-sm"
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  const partes = (chat.usuario_nombre || "").split(" ");
                                  const nombre = partes[0] || "";
                                  const apellido = partes.slice(1).join(" ") || "";

                                  onVerPerfil({
                                    id: chat.usuario_id,
                                    ...chat,
                                    nombre,        // 👈 solo "Carlos"
                                    apellido,      // 👈 solo "Ramirez"
                                    url_imagen: chat.url_imagen,
                                    correo: chat.usuario_correo || "",
                                  });
                                }}
                              >
                                {chat?.url_imagen ? (
                                  <img
                                    className="avatar-img rounded-circle"
                                    src={getAvatarUrl(chat.url_imagen)}
                                    alt={getChatDisplayName(chat)}
                                    style={{ objectFit: "cover" }}
                                  />
                                ) : (
                                  <div
                                    className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                    style={{
                                      width: "34px",
                                      height: "34px",
                                      backgroundColor: chat?.background || "#6c757d",
                                      fontSize: "14px",
                                    }}
                                  >
                                    {getInitial(chat?.usuario_nombre || "U")}
                                  </div>
                                )}
                              </div>

                              {/* Avatar del usuario logueado */}
                              <div
                                className="avatar avatar-sm"
                                style={{ cursor: "pointer" }}
                                onClick={() => 
                                  onVerPerfil({
                                      ...user,
                                    url_imagen: user.url_imagen,  // 👈 aseguramos imagen
                                    correo: user.correo || "",    // 👈 aseguramos correo
                                  })
                                }
                              >
                                {user?.url_imagen ? (
                                  <img
                                    className="avatar-img rounded-circle"
                                    src={getAvatarUrl(user.url_imagen)}
                                    alt={user.nombre}
                                    style={{
                                      width: "32px",
                                      height: "32px",
                                      objectFit: "cover",
                                    }}
                                  />
                                ) : (
                                  <div
                                    className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                    style={{
                                      width: "34px",
                                      height: "34px",
                                      backgroundColor: user?.background || "#6c757d",
                                      fontSize: "14px",
                                    }}
                                  >
                                    {getInitial(user?.nombre || "U")}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Toolbar */}
                </div>
              </div>
              {/* Content */}

              {/* Mobile: more */}
              <div className="col-2 d-xl-none text-end">
                <a
                  href="#"
                  className="icon icon-lg text-muted"
                  data-bs-toggle="offcanvas"
                  data-bs-target="#offcanvas-more"
                  aria-controls="offcanvas-more"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="feather feather-more-vertical"
                  >
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                  </svg>
                </a>
              </div>
              {/* Mobile: more */}
            </div>
          </div>
          
          {/* 🔹 Mensajes fijados estilo WhatsApp */}
          {pinnedMessages.length > 0 && (
            <div className="pinned-bar d-flex align-items-center justify-content-between px-3 py-1 border-bottom">
              <div className="pinned-list d-flex align-items-center overflow-auto" style={{ flex: 1 }}>
                {pinnedMessages.map((msg) => {
                  const pinnedMessageId = msg.mensaje_id || msg.id;

                  return (
                    <div 
                      key={msg.fijado_id || pinnedMessageId} 
                      className="pinned-item position-relative d-flex align-items-center mx-1"
                      onClick={() => handlePinnedMessageClick(pinnedMessageId)}
                    >
                      <div className="pinned-content px-3 py-2 bg-white rounded-pill shadow-sm d-flex align-items-center">
                        <i className="bi bi-pin-angle-fill text-primary me-2"></i>
                        <span className="text-truncate small pinned-preview-text" style={{ maxWidth: 220 }}>
                          {renderPreviewLine(msg)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cuerpo del chat */}
          <div className="chat-body hide-scrollbar flex-1 overflow-auto">
            {pendingImages.length > 0 ? (
              // 👇 MODO PREVIEW TIPO WHATSAPP
              <div className="h-100 d-flex flex-column">
                {/* Imagen grande + botón cerrar */}
                <div className="flex-grow-1 d-flex align-items-center justify-content-center chat-preview-stage position-relative">
                  {/* Botón X para cerrar preview */}
                  <button
                    type="button"
                    className="btn btn-light btn-sm position-absolute top-0 end-0 m-3 rounded-circle shadow-sm"
                    onClick={clearPendingImages}
                    title="Cerrar vista previa"
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>×</span>
                  </button>

                  <img
                    src={pendingImages[activeImageIndex]?.preview}
                    alt="preview-grande"
                    style={{
                      maxWidth: "80%",     // 👈 no ocupa todo el ancho
                      maxHeight: "70vh",   // 👈 no ocupa toda la altura
                      objectFit: "contain",
                      borderRadius: "16px",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                    }}
                  />
                </div>

                {/* Miniaturas abajo */}
                <div
                  className="d-flex flex-row gap-2 p-3"
                  style={{
                    overflowX: "auto",    // 👈 solo horizontal
                    overflowY: "hidden",  // 👈 sin scroll vertical
                  }}
                >
                  {pendingImages.map((img, idx) => (
                    <div
                      key={img.id}
                      className="position-relative"
                      style={{
                        width: 80,
                        height: 80,
                        cursor: "pointer",
                        borderRadius: "12px",
                        overflow: "hidden",
                        border:
                          idx === activeImageIndex
                            ? "2px solid var(--bs-primary)"
                            : "1px solid var(--border-color)",
                      }}
                      onClick={() => setActiveImageIndex(idx)}
                    >
                      <img
                        src={img.preview}
                        alt="preview"
                        className="w-100 h-100"
                        style={{ objectFit: "cover" }}
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-light position-absolute top-0 end-0 m-1 p-0 rounded-circle"
                        style={{ width: 20, height: 20, lineHeight: "18px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          //URL.revokeObjectURL(img.preview);
                          setPendingImages((prev) => prev.filter((p) => p.id !== img.id));
                          setActiveImageIndex((prevIndex) =>
                            prevIndex >= pendingImages.length - 1 ? 0 : prevIndex
                          );
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // 👇 MODO NORMAL (mensajes)
              <div className="chat-body-inner h-100" >
                  {isLoadingMessages ? (
                    <div className="chat-loading-state d-flex flex-column align-items-center justify-content-center h-100">
                      <div className="spinner-border spinner-border-sm mb-3" role="status" aria-hidden="true"></div>
                      <span>Cargando últimos mensajes...</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <>
                      <div className="d-flex flex-column align-items-center justify-content-center h-100">
                        <div className="text-center mb-6">
                          <span className="icon icon-xl text-muted">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="feather feather-send"
                            >
                              <line x1="22" y1="2" x2="11" y2="13"></line>
                              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                          </span>
                        </div>

                        <p className="text-center text-muted">
                          Aún no hay mensajes, <br /> ¡inicia la conversación!
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="d-flex flex-column h-100">
                      <ChatBody
                        messages={messages}
                        user={user}
                        chat={chat}
                        chatKey={getChatKey(chat)}
                        tipo={chat.tipo}
                        socket={socket}
                        hasMoreMessages={hasMoreMessages}
                        isLoadingOlderMessages={isLoadingOlderMessages}
                        onLoadOlderMessages={cargarMensajesAnteriores}
                        onVerPerfil={onVerPerfil}
                        onGuardarStickerFavorito={handleGuardarStickerFavorito}
                        onEliminarStickerFavorito={handleEliminarStickerFavorito}
                        stickersFavoritos={stickersFavoritos}
                        mentionOptions={mentionOptions}
                        onReply={handleReplyMessage}
                        onReplyPrivado={handleReplyPrivado}
                        onEnviarMensajePrivado={handleEnviarMensajePrivado}
                        onReplyPreviewClick={handleReplyPreviewClick}
                        scrollTargetMessageId={replyJumpTarget?.messageId || null}
                        scrollTargetToken={replyJumpTarget?.token || null}
                        typingUsers={typingUsers}
                        onMarkVisibleMessages={markCurrentChatAsRead}
                        onCancelUpload={cancelPendingUpload}
                        onRetryUpload={retryPendingUpload}
                        onForward={startForwardSelection}
                        onStartSelect={startForwardSelection}
                        selectionMode={forwardSelectionMode}
                        selectedMessages={forwardSelectedMessages}
                        onToggleSelect={toggleForwardSelectedMessage}
                        onCancelSelection={cancelForwardSelection}
                        onOpenForwardModal={openForwardModal}
                      />
                    </div>
                  )}
              </div>
            )}
          </div>
          
          {/* Input del chat */}
          <div className={`chat-footer pb-3 pb-lg-7 ${forwardSelectionMode ? "d-none" : ""}`}>
            
            {/* Chat: Form */}
            <form
              className={`chat-form wa-chat-form rounded-pill ${replyingTo ? "has-reply-compose" : ""}`}

              data-emoji-form=""
              onSubmit={(e) => {
                e.preventDefault();
                inputRef.current?.send(); // Llamamos al método de ChatInput
              }}
            >
              {replyingTo && (
                <div className="reply-compose-bar" style={replyTitleStyle}>
                  <span className="reply-compose-accent" />
                  <div className="reply-compose-content">
                    <div className="reply-compose-author">
                      {getReplyAuthorName(replyingTo, user?.id)}
                    </div>
                    <div className="reply-compose-preview">
                      {renderPreviewLine(replyingTo)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="reply-compose-close"
                    onClick={() => setReplyingTo(null)}
                    aria-label="Cancelar respuesta"
                  >
                    ×
                  </button>
                </div>
              )}
              {isRecordingAudio ? (
                <div className={`wa-audio-recorder-composer ${isAudioPaused ? "paused" : "recording"}`} aria-live="polite">
                  <button
                    type="button"
                    className="wa-recorder-action wa-recorder-delete"
                    onClick={cancelAudioRecording}
                    disabled={isSendingAudio}
                    aria-label="Eliminar audio"
                    title="Eliminar audio"
                  >
                    <i className="fa-regular fa-trash-can" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    className="wa-recorder-action wa-recorder-toggle"
                    onClick={togglePauseAudioRecording}
                    disabled={isSendingAudio}
                    aria-label={isAudioPaused ? "Reanudar audio" : "Pausar audio"}
                    title={isAudioPaused ? "Reanudar" : "Pausar"}
                  >
                    <i className={`fa-solid ${isAudioPaused ? "fa-play" : "fa-pause"}`} aria-hidden="true" />
                  </button>

                  <div className="wa-recorder-track" aria-label={isAudioPaused ? "Audio pausado" : "Nivel de voz en vivo"}>
                    <span className={`wa-recorder-live-dot ${isAudioPaused ? "paused" : ""}`} />
                    <div className="wa-recorder-wave">
                      {audioWaveSamples.map((sample, index) => {
                        const normalizedSample = clampRecorderLevel(sample);
                        const isSilent = normalizedSample <= 0.03;
                        const height = isSilent
                          ? 3
                          : Math.max(5, Math.min(28, 4 + Math.pow(normalizedSample, 0.75) * 24));

                        return (
                          <span
                            key={`wave-${index}`}
                            className={`wa-recorder-wave-bar ${isSilent ? "is-silent" : "is-speaking"}`}
                            style={{
                              height: `${height}px`,
                              opacity: isAudioPaused ? 0.38 : isSilent ? 0.78 : 0.95,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <span className="wa-recorder-time">{formatRecordingDuration(recordingSeconds)}</span>

                  <span className="wa-recorder-mic" title={isAudioPaused ? "Pausado" : "Grabando"}>
                    <i className="fa-solid fa-microphone" aria-hidden="true" />
                  </span>

                  <button
                    type="button"
                    className="wa-recorder-send"
                    onClick={stopAndSendAudioRecording}
                    disabled={isSendingAudio}
                    aria-label="Enviar audio"
                    title="Enviar audio"
                  >
                    <i className="fa-solid fa-paper-plane" aria-hidden="true" />
                  </button>
                </div>
              ) : (
              <div className="row align-items-center gx-0">
                {/* Input de texto */}
                <div className="col position-relative">
                  <div className="input-group">
                    <input
                      type="file"
                      id="fileInput"
                      hidden
                      accept={acceptAdjuntos}
                      onChange={handleArchivoSeleccionado}
                    />
                    <button
                      type="button"
                      className="btn btn-icon btn-link text-body rounded-circle wa-attach-trigger"
                      aria-label="Adjuntar archivo"
                      title="Adjuntar archivo"
                      onClick={() => document.getElementById("fileInput").click()}
                    >
                      <i className="fa-solid fa-plus" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      ref={(node) => {
                        emojiBtnRef.current = node;
                        gifBtnRef.current = node;
                        stickerBtnRef.current = node;
                      }}
                      className={`input-group-text text-body wa-media-trigger ${isMediaPickerOpen ? "show" : ""}`}
                      data-emoji-btn=""
                      aria-expanded={isMediaPickerOpen}
                      aria-label="Abrir emojis, GIFs y stickers"
                      title="Emojis, GIFs y stickers"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleMediaPicker();
                      }}
                    >
                      <span className="wa-media-trigger-icon" aria-hidden="true">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6.75 3.75h8.9c2.52 0 4.6 2.04 4.6 4.56v5.39c0 2.52-2.08 4.56-4.6 4.56H13.2l-3.72 2.2a.75.75 0 0 1-1.13-.65v-1.55h-1.6c-2.52 0-4.6-2.04-4.6-4.56V8.31c0-2.52 2.08-4.56 4.6-4.56Z" />
                          <path d="M8.15 13.15c.72.86 1.66 1.28 2.85 1.28s2.13-.42 2.85-1.28" />
                          <path d="M8.05 9.5h.01" />
                          <path d="M13.95 9.5h.01" />
                        </svg>
                      </span>
                    </button>

                    <div className="wa-input-grow">
                      <ChatInput
                        ref={inputRef}
                        onSend={(msg) => handleSendMessage(msg)}
                        onPasteFiles={(files, options) => handleFilesSeleccionados(files, options)}
                        onValueChange={setInputText}
                        mentionOptions={mentionOptions}
                        placeholder="Escribe un mensaje..."
                        onReply={handleReplyMessage}
                        onReplyPrivado={handleReplyPrivado}
                        onEnviarMensajePrivado={handleEnviarMensajePrivado}
                      />
                    </div>
                  </div>
                  <input
                    ref={stickerFileInputRef}
                    type="file"
                    accept="image/*,image/gif"
                    className="d-none"
                    onChange={handleStickerFileSelected}
                  />

                  {/* Editor previo para crear sticker */}
                  {showStickerEditor && pendingStickerPreview && (
                    <div className="wa-sticker-editor" role="dialog" aria-label="Crear sticker">
                      <div className="wa-sticker-editor-topbar">
                        <button
                          type="button"
                          className="wa-sticker-editor-close-inline"
                          onClick={closeStickerEditor}
                          aria-label="Cerrar editor de sticker"
                        >
                          <i className="fa-solid fa-xmark" aria-hidden="true" />
                        </button>
                        <button type="button" className="wa-sticker-editor-undo" title="Deshacer" onClick={() => setStickerDrawPaths((prev) => prev.slice(0, -1))}>
                          <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="wa-sticker-editor-undo"
                          title="Rehacer"
                          onClick={() => {}}
                        >
                          <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="wa-sticker-editor-toolbar" aria-label="Herramientas de sticker">
                        <button
                          type="button"
                          className={`wa-sticker-editor-tool ${stickerEditorTool === "crop" ? "active" : ""}`}
                          title="Recortar y rotar"
                          onClick={() => setStickerEditorTool("crop")}
                        >
                          <i className="fa-solid fa-crop-simple" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`wa-sticker-editor-tool ${stickerEditorTool === "filter" ? "active" : ""}`}
                          title="Filtros"
                          onClick={() => setStickerEditorTool("filter")}
                        >
                          <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`wa-sticker-editor-tool ${stickerEditorTool === "paint" ? "active" : ""}`}
                          title="Dibujar"
                          onClick={() => setStickerEditorTool("paint")}
                        >
                          <i className="fa-solid fa-pen" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`wa-sticker-editor-tool ${stickerEditorTool === "text" ? "active" : ""}`}
                          title="Texto"
                          onClick={addStickerText}
                        >
                          Aa
                        </button>
                        <button
                          type="button"
                          className={`wa-sticker-editor-tool ${stickerEditorTool === "shape" ? "active" : ""}`}
                          title="Formas"
                          onClick={() => setStickerEditorTool((value) => value === "shape" ? "crop" : "shape")}
                        >
                          <i className="fa-regular fa-square" aria-hidden="true" />
                        </button>
                      </div>

                      {stickerEditorTool === "filter" && (
                        <div className="wa-sticker-filter-strip">
                          {Object.entries(STICKER_EDITOR_FILTERS).map(([key, filter]) => (
                            <button
                              key={key}
                              type="button"
                              className={`wa-sticker-filter-item ${stickerEditorFilter === key ? "active" : ""}`}
                              onClick={() => setStickerEditorFilter(key)}
                            >
                              <span className="wa-sticker-filter-thumb">
                                <img src={pendingStickerPreview} alt={filter.label} style={{ filter: filter.css }} />
                              </span>
                              <span>{filter.label}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {stickerEditorTool === "paint" && (
                        <div className="wa-sticker-color-strip">
                          {STICKER_EDITOR_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`wa-sticker-color-dot ${stickerDrawColor === color ? "active" : ""}`}
                              style={{ backgroundColor: color }}
                              onClick={() => setStickerDrawColor(color)}
                              aria-label={`Color ${color}`}
                            />
                          ))}
                        </div>
                      )}

                      {stickerEditorTool === "shape" && (
                        <div className="wa-sticker-shape-popover">
                          <button type="button" onClick={() => { setStickerShapeType("rect"); addStickerShape("rect"); }} title="Cuadrado">
                            <i className="fa-regular fa-square" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => { setStickerShapeType("circle"); addStickerShape("circle"); }} title="Círculo">
                            <i className="fa-regular fa-circle" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => { setStickerShapeType("line"); addStickerShape("line"); }} title="Línea">
                            <i className="fa-solid fa-minus" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => { setStickerShapeType("arrow"); addStickerShape("arrow"); }} title="Flecha">
                            <i className="fa-solid fa-arrow-right-long" aria-hidden="true" />
                          </button>
                        </div>
                      )}

                      <div className="wa-sticker-editor-stage">
                        <div
                          ref={stickerEditorCanvasRef}
                          className={`wa-sticker-editor-canvas tool-${stickerEditorTool}`}
                          onPointerDown={handleStickerCanvasPointerDown}
                          onPointerMove={handleStickerCanvasPointerMove}
                          onPointerUp={stopStickerDrawing}
                          onPointerLeave={stopStickerDrawing}
                        >
                          {stickerEditorTool === "crop" && (
                            <>
                              <span
                                className="wa-sticker-crop-box"
                                style={{
                                  left: `${stickerCropRect.x * 100}%`,
                                  top: `${stickerCropRect.y * 100}%`,
                                  width: `${stickerCropRect.w * 100}%`,
                                  height: `${stickerCropRect.h * 100}%`,
                                }}
                                aria-hidden="true"
                              >
                                <span className="wa-sticker-editor-handle top-left" onPointerDown={startStickerCropDrag("top-left")} />
                                <span className="wa-sticker-editor-handle top-right" onPointerDown={startStickerCropDrag("top-right")} />
                                <span className="wa-sticker-editor-handle bottom-left" onPointerDown={startStickerCropDrag("bottom-left")} />
                                <span className="wa-sticker-editor-handle bottom-right" onPointerDown={startStickerCropDrag("bottom-right")} />
                              </span>
                              <span
                                className="wa-sticker-crop-overlay top"
                                style={{ height: `${stickerCropRect.y * 100}%` }}
                                aria-hidden="true"
                              />
                              <span
                                className="wa-sticker-crop-overlay bottom"
                                style={{ top: `${(stickerCropRect.y + stickerCropRect.h) * 100}%` }}
                                aria-hidden="true"
                              />
                              <span
                                className="wa-sticker-crop-overlay left"
                                style={{
                                  top: `${stickerCropRect.y * 100}%`,
                                  width: `${stickerCropRect.x * 100}%`,
                                  height: `${stickerCropRect.h * 100}%`,
                                }}
                                aria-hidden="true"
                              />
                              <span
                                className="wa-sticker-crop-overlay right"
                                style={{
                                  top: `${stickerCropRect.y * 100}%`,
                                  left: `${(stickerCropRect.x + stickerCropRect.w) * 100}%`,
                                  height: `${stickerCropRect.h * 100}%`,
                                }}
                                aria-hidden="true"
                              />
                            </>
                          )}
                          <img
                            ref={stickerEditorImageRef}
                            src={pendingStickerPreview}
                            alt="Vista previa del sticker"
                            style={{
                              filter: STICKER_EDITOR_FILTERS[stickerEditorFilter]?.css || "none",
                              transform: `rotate(${stickerEditorRotation}deg) scaleX(${stickerEditorFlipX ? -1 : 1})`,
                            }}
                          />

                          <svg className="wa-sticker-draw-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                            {stickerDrawPaths.map((path) => (
                              <polyline
                                key={path.id}
                                points={(path.points || []).map((point) => `${point.x * 100},${point.y * 100}`).join(" ")}
                                fill="none"
                                stroke={path.color || "#22c55e"}
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            ))}
                            {stickerShapeItems.map((shape) => {
                              const x = (shape.x - shape.w / 2) * 100;
                              const y = (shape.y - shape.h / 2) * 100;
                              const w = shape.w * 100;
                              const h = shape.h * 100;
                              if (shape.type === "circle") {
                                return <ellipse key={shape.id} cx={shape.x * 100} cy={shape.y * 100} rx={w / 2} ry={h / 2} fill="none" stroke={shape.color} strokeWidth="1.7" />;
                              }
                              if (shape.type === "line" || shape.type === "arrow") {
                                return (
                                  <line
                                    key={shape.id}
                                    x1={x}
                                    y1={y + h}
                                    x2={x + w}
                                    y2={y}
                                    stroke={shape.color}
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    markerEnd={shape.type === "arrow" ? "url(#waStickerArrow)" : undefined}
                                  />
                                );
                              }
                              return <rect key={shape.id} x={x} y={y} width={w} height={h} fill="none" stroke={shape.color} strokeWidth="1.7" />;
                            })}
                            <defs>
                              <marker id="waStickerArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
                                <path d="M0,0 L6,3 L0,6 Z" fill={stickerDrawColor} />
                              </marker>
                            </defs>
                          </svg>

                          {stickerTextItems.map((item) => (
                            <div
                              key={item.id}
                              className="wa-sticker-text-item"
                              style={{
                                left: `${item.x * 100}%`,
                                top: `${item.y * 100}%`,
                                borderColor: item.color,
                              }}
                              onDoubleClick={() => {
                                const text = window.prompt("Editar texto", item.text);
                                if (!text) return;
                                setStickerTextItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, text } : entry));
                              }}
                            >
                              <span>{item.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="wa-sticker-editor-actions">
                        {stickerEditorTool === "crop" && (
                          <>
                            <button
                              type="button"
                              className="wa-sticker-editor-mini"
                              title="Girar"
                              onClick={() => setStickerEditorRotation((value) => (value + 90) % 360)}
                            >
                              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="wa-sticker-editor-mini"
                              title="Voltear"
                              onClick={() => setStickerEditorFlipX((value) => !value)}
                            >
                              <i className="fa-solid fa-right-left" aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {(stickerEditorRotation !== 0 || stickerEditorFlipX || stickerEditorFilter !== "none" || stickerTextItems.length || stickerShapeItems.length || stickerDrawPaths.length || stickerCropRect.x !== 0 || stickerCropRect.y !== 0 || stickerCropRect.w !== 1 || stickerCropRect.h !== 1) && (
                          <button
                            type="button"
                            className="wa-sticker-editor-reset"
                            onClick={() => {
                              setStickerEditorRotation(0);
                              setStickerEditorFlipX(false);
                              setStickerEditorFilter("none");
                              setStickerTextItems([]);
                              setStickerShapeItems([]);
                              setStickerDrawPaths([]);
                              setStickerCropRect({ x: 0, y: 0, w: 1, h: 1 });
                            }}
                          >
                            Restablecer
                          </button>
                        )}
                      </div>

                      <div className="wa-sticker-editor-bottom">
                        <div className="wa-sticker-editor-thumb">
                          <img src={pendingStickerPreview} alt="Sticker seleccionado" />
                        </div>
                        <div className="wa-sticker-editor-bottom-actions">
                          <button
                            type="button"
                            className="wa-sticker-editor-ok"
                            onClick={confirmStickerCreation}
                            disabled={isCreatingSticker}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            className="wa-sticker-editor-send"
                            onClick={confirmStickerCreation}
                            disabled={isCreatingSticker}
                            aria-label="Enviar sticker"
                          >
                            {isCreatingSticker ? (
                              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                            ) : (
                              <i className="fa-solid fa-paper-plane" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Picker flotante unificado tipo WhatsApp */}
                  {isMediaPickerOpen && (
                    <div
                      ref={(node) => {
                        emojiRef.current = node;
                        gifRef.current = node;
                        stickerRef.current = node;
                      }}
                      className={`wa-picker-popover wa-media-picker-shell is-${activeMediaPicker}`}
                      role="dialog"
                      aria-label="Emojis, GIFs y stickers"
                    >
                      <div className={`wa-media-picker-content ${activeMediaPicker}`}>
                        {activeMediaPicker === "emoji" && (
                          <Picker
                            data={data}
                            onEmojiSelect={(emoji) => handleEmojiClick({ emoji: emoji.native })}
                            previewPosition="none"
                            skinTonePosition="search"
                            perLine={9}
                            dynamicWidth
                            theme={emojiTheme}
                            locale="es"
                            style={{ width: "100%", height: "100%" }}
                          />
                        )}

                        {activeMediaPicker === "gif" && (
                          <div className="wa-gif-picker-panel">
                            <input
                              type="text"
                              className="wa-gif-search"
                              placeholder="Buscar GIFs..."
                              value={gifSearch}
                              onChange={(e) => setGifSearch(e.target.value)}
                              onKeyUp={(e) => e.key === "Enter" && fetchGifs(gifSearch)}
                            />
                            <div className="wa-gif-grid">
                              {gifResults.map((gif) => (
                                <img
                                  key={gif.id}
                                  src={gif.images.fixed_height_small.url}
                                  alt={gif.title}
                                  className="wa-gif-result"
                                  onClick={() => {
                                    handleSendMessage(gif.images.original.url);
                                    closeMediaPickers();
                                    setGifSearch("");
                                    setGifResults([]);
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {activeMediaPicker === "sticker" && (
                          <div className="wa-sticker-panel" role="tabpanel" aria-label="Stickers">
                            <div className="wa-sticker-wa-header" role="tablist" aria-label="Filtros de stickers">
                              <button
                                type="button"
                                className={`wa-sticker-wa-tab ${stickerTab === "todos" ? "active" : ""}`}
                                onClick={() => setStickerTab("todos")}
                                role="tab"
                                aria-selected={stickerTab === "todos"}
                                title="Recientes"
                              >
                                <i className="fa-regular fa-clock" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={`wa-sticker-wa-tab ${stickerTab === "favoritos" ? "active" : ""}`}
                                onClick={() => setStickerTab("favoritos")}
                                role="tab"
                                aria-selected={stickerTab === "favoritos"}
                                title="Favoritos"
                              >
                                <i className="fa-regular fa-star" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="wa-sticker-wa-tab wa-sticker-wa-add"
                                onClick={openStickerCreator}
                                title="Crear sticker"
                                aria-label="Crear sticker"
                              >
                                <i className="fa-solid fa-plus" aria-hidden="true" />
                              </button>
                            </div>

                            <div className="wa-sticker-search-shell">
                              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                              <span>Buscar stickers</span>
                            </div>

                            <div className="wa-sticker-grid-wrap">
                              <div className="wa-sticker-grid wa-sticker-grid-whatsapp">
                                {stickerTab === "todos" && (
                                  <div className="wa-sticker-cell">
                                    <button
                                      type="button"
                                      className="wa-sticker-create"
                                      title="Crear sticker"
                                      aria-label="Crear sticker"
                                      onClick={openStickerCreator}
                                    >
                                      <i className="fa-solid fa-plus" aria-hidden="true" />
                                      <span>Crear</span>
                                    </button>
                                  </div>
                                )}

                                {listaStickers.length > 0 ? (
                                  listaStickers.map((sticker) => (
                                    <button
                                      key={sticker.id || sticker.url}
                                      type="button"
                                      className="wa-sticker-item"
                                      title="Enviar sticker"
                                      onClick={() => {
                                        const stickerUrl = normalizeStickerMessageUrl(sticker.url);
                                        sendStickerMessage(stickerUrl, sticker).catch((err) => {
                                          console.error("❌ Error enviando sticker:", err);
                                          alert("No se pudo enviar el sticker.");
                                        });
                                      }}
                                    >
                                      <img src={getStickerImageUrl(sticker.url)} alt="sticker" />
                                    </button>
                                  ))
                                ) : (
                                  <div className="wa-sticker-empty">
                                    {stickerTab === "favoritos"
                                      ? "Tus stickers favoritos aparecerán aquí"
                                      : "Tus stickers enviados aparecerán aquí"}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="wa-media-tabs" role="tablist" aria-label="Tipo de contenido">
                        <button
                          type="button"
                          className={activeMediaPicker === "emoji" ? "active" : ""}
                          onClick={() => openMediaPicker("emoji")}
                          role="tab"
                          aria-selected={activeMediaPicker === "emoji"}
                          title="Emojis"
                        >
                          <i className="fa-regular fa-face-smile" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={activeMediaPicker === "gif" ? "active" : ""}
                          onClick={() => openMediaPicker("gif")}
                          role="tab"
                          aria-selected={activeMediaPicker === "gif"}
                          title="GIF"
                        >
                          GIF
                        </button>
                        <button
                          type="button"
                          className={activeMediaPicker === "sticker" ? "active" : ""}
                          onClick={() => openMediaPicker("sticker")}
                          role="tab"
                          aria-selected={activeMediaPicker === "sticker"}
                          title="Stickers"
                        >
                          <i className="fa-regular fa-note-sticky" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}                </div>

                {/* Botón enviar / grabar audio */}
                <div className="col-auto d-flex align-items-center">
                  {isRecordingAudio && (
                    <span className="wa-audio-recording-pill" aria-live="polite">
                      <span className="wa-audio-recording-dot" />
                      Grabando...
                    </span>
                  )}

                  {canSendMessage ? (
                    <button
                      type="submit"
                      className="btn btn-icon btn-primary rounded-circle ms-5"
                      aria-label="Enviar mensaje"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="feather feather-send"
                      >
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn-icon rounded-circle ms-5 wa-audio-record-button ${isRecordingAudio ? "recording" : ""} ${!puedeGrabarAudios ? "no-permission" : ""}`}
                      onClick={handleAudioRecordClick}
                      disabled={isSendingAudio || !puedeGrabarAudios}
                      aria-label={puedeGrabarAudios ? (isRecordingAudio ? "Enviar nota de voz" : "Grabar nota de voz") : "Sin permiso para grabar audios"}
                      title={puedeGrabarAudios ? (isRecordingAudio ? "Toca para enviar la nota de voz" : "Grabar nota de voz") : "No tienes permiso para grabar audios"}
                    >
                      {isRecordingAudio ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="7" y="7" width="10" height="10" rx="2"></rect>
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="feather feather-mic"
                        >
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                          <line x1="12" y1="19" x2="12" y2="23"></line>
                          <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
              )}
            </form>
            {/* Chat: Form */}

          </div>
        </div>
        {/* Panel de información del grupo: va dentro del shell para empujar el chat y deslizarse desde la derecha */}
        {chat?.tipo === "grupo" && (
          <VerInfoGrupo
            chat={chat}
            visible={mostrarInfoGrupo}
            onClose={() => setMostrarInfoGrupo(false)}
            setMostrarVerArchivos={setMostrarVerArchivos}
            setOffcanvasGrupo={setOffcanvasGrupo}
            user={user}
            onActualizarChat={(campo, valor) => setChat(prev => ({ ...prev, [campo]: valor }))}
            onJumpToMessage={handleJumpToGroupSearchMessage}
            searchRequestToken={searchRequestToken}
          />
        )}
        {chat?.tipo !== "grupo" && (
          <VerInfoContacto
            chat={{ ...chat, archivos: contactoInfoArchivos.length ? contactoInfoArchivos : chat.archivos }}
            user={user}
            visible={mostrarInfoContacto}
            onClose={() => setMostrarInfoContacto(false)}
            onBuscarEnChat={() => {
              setMostrarInfoContacto(false);
              handleBuscarEnChat();
            }}
            onOpenFiles={() => setMostrarVerArchivos(true)}
            onEnviarMensaje={() => setMostrarInfoContacto(false)}
            onAddToList={onAddToList}
            onInfoLoaded={(data) => setContactoInfoArchivos(Array.isArray(data?.archivos) ? data.archivos : [])}
          />
        )}
      </div>
      {/* 👇 Offcanvas MiembrosGrupos controlado por estado */}
      {offcanvasGrupo && (
        <MiembrosGrupos
          grupo={offcanvasGrupo}
          usuarioId={user?.id}
          onClose={() => setOffcanvasGrupo(null)} // cerrar desde dentro
        />
      )}

      {/* 🔹 Panel de archivos */}
      <VerArchivos
        chat={chat?.tipo === "grupo" ? chat : { ...chat, archivos: contactoInfoArchivos.length ? contactoInfoArchivos : chat?.archivos }}
        visible={mostrarVerArchivos}
        onClose={() => setMostrarVerArchivos(false)}
      />
      {isDragOver && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{
            background: "rgba(0,0,0,0.4)",
            zIndex: 2000,
            pointerEvents: "none",  // 👈 clave
          }}
        >
          <div className="bg-white rounded-3 px-4 py-3 shadow">
            Suelta las imágenes o Archivos para adjuntarlas
          </div>
        </div>
      )}

      {showForwardModal && typeof document !== "undefined" && createPortal(
        <div className="wa-forward-modal-backdrop" onClick={() => setShowForwardModal(false)}>
          <div className="wa-forward-modal" onClick={(event) => event.stopPropagation()}>
            <div className="wa-forward-modal-header">
              <button
                type="button"
                className="wa-forward-modal-close"
                onClick={() => setShowForwardModal(false)}
                aria-label="Cerrar reenviar"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
              <strong>Reenviar mensajes a</strong>
              <i className="fa-solid fa-user-plus" aria-hidden="true" />
            </div>

            <div className="wa-forward-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input
                type="text"
                value={forwardSearch}
                onChange={(event) => setForwardSearch(event.target.value)}
                placeholder="Buscar un nombre o número"
                autoFocus
              />
            </div>

            <div className="wa-forward-targets">
              {filteredForwardSections.length === 0 ? (
                <div className="wa-forward-empty">No hay chats para mostrar</div>
              ) : (
                filteredForwardSections.map((section) => (
                  <div className="wa-forward-section" key={section.key}>
                    <div className="wa-forward-section-label">{section.label}</div>
                    {section.targets.map((target) => {
                      const selected = forwardSelectedTargets.some((item) => item.key === target.key);
                      return (
                        <button
                          key={target.key}
                          type="button"
                          className={`wa-forward-target ${selected ? "selected" : ""}`}
                          onClick={() => toggleForwardTarget(target)}
                        >
                          <span className={`wa-forward-check ${selected ? "checked" : ""}`}>
                            {selected && <i className="fa-solid fa-check" aria-hidden="true" />}
                          </span>
                          <span className="wa-forward-avatar">
                            {renderForwardTargetAvatar(target)}
                          </span>
                          <span className="wa-forward-target-text">
                            <strong>{target.nombre}</strong>
                            {target.subtitle && <small>{target.subtitle}</small>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="wa-forward-modal-footer">
              <div className="wa-forward-selected-strip">
                {forwardSelectedTargets.map((target) => (
                  <span key={target.key}>{target.nombre}</span>
                ))}
              </div>
              <button
                type="button"
                className="wa-forward-submit"
                disabled={!forwardSelectedTargets.length || isForwardingMessages}
                onClick={sendForwardedMessages}
                aria-label="Enviar reenviado"
              >
                {isForwardingMessages ? (
                  <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                ) : (
                  <i className="fa-solid fa-paper-plane" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
    </main>
  );
};

export default ChatBox;