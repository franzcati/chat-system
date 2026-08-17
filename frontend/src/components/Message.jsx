// src/components/Message.jsx
import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { getAvatarUrl } from "../utils/url";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import twemoji from "twemoji";
import { formatChatTimeOnly, formatChatDate } from "../utils/date";
import { useTheme } from "../context/ThemeContext";
import { logDev } from "../utils/logger";
import { getMessagePreview, getReplyAuthorName } from "../utils/messagePreview";
import { getProfileTitleStyle } from "../utils/profileColor";
import {
  decodeRichHtmlValue,
  isRichHtmlValue,
  renderRichTextInline,
  richHtmlHasFormatting,
  sanitizeRichHtml,
} from "../utils/richText.jsx";
import ChatInput from "./ChatInput";

const reactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const AUDIO_MESSAGE_WAVE_BAR_COUNT = 44;
const AUDIO_MESSAGE_WAVE_BAR_WIDTH = 3;

const COPY_BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div",
  "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li",
  "main", "nav", "ol", "p", "pre", "section", "table", "tbody",
  "td", "tfoot", "th", "thead", "tr", "ul",
]);

const COPY_BLOCK_CLASSES = new Set([
  "wa-rich-line",
  "wa-rich-empty-line",
  "wa-rich-quote-line",
]);

const isCopyBlockElement = (node, tag = "") => {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  if (COPY_BLOCK_TAGS.has(String(tag || node.tagName || "").toLowerCase())) return true;
  return Array.from(COPY_BLOCK_CLASSES).some((className) => node.classList?.contains(className));
};

const normalizeClipboardText = (value = "") =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

const nodeToClipboardText = (node) => {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return "";

  const tag = String(node.tagName || "").toLowerCase();
  if (["img", "picture", "source", "style", "script", "noscript", "button", "svg", "path"].includes(tag)) return "";
  if (tag === "br") return "\n";
  if (node.classList?.contains("wa-rich-empty-line")) return "\n";

  const children = Array.from(node.childNodes || [])
    .map((child) => nodeToClipboardText(child))
    .join("");

  if (tag === "li") return `- ${children.trim()}\n`;
  if (tag === "td" || tag === "th") return `${children.trim()}\t`;
  if (tag === "tr") return `${children.replace(/[\t ]+$/g, "")}\n`;
  if (tag === "pre") return `${children}\n`;

  if (isCopyBlockElement(node, tag)) {
    const value = children.replace(/\n{3,}/g, "\n\n");
    return value.endsWith("\n") ? value : `${value}\n`;
  }

  return children;
};

const normalizeClipboardColor = (color = "") => {
  const value = String(color || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  return "";
};

const extractClipboardColorFromStyle = (styleValue = "") => {
  const style = String(styleValue || "");
  const hexMatch = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6})/i);
  if (hexMatch) return normalizeClipboardColor(hexMatch[1]);

  const rgbMatch = style.match(/(?:^|;)\s*color\s*:\s*rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgbMatch) return "";

  const toHex = (value) => Number(value).toString(16).padStart(2, "0");
  return normalizeClipboardColor(`#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`);
};

const isAdaptiveClipboardColor = (color = "") => {
  const normalized = normalizeClipboardColor(color);
  if (!normalized) return false;
  if (["#000000", "#FFFFFF", "#111B21", "#202C33", "#E9EDEF", "#AEBAC1", "#D1D7DB"].includes(normalized)) return true;

  const match = normalized.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/);
  if (!match) return false;

  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 10 && (max <= 42 || min >= 222);
};


const replaceNodeTag = (node, doc, tagName) => {
  const replacement = doc.createElement(tagName);
  Array.from(node.attributes || []).forEach((attr) => {
    if (attr.name !== "class") replacement.setAttribute(attr.name, attr.value);
  });
  while (node.firstChild) replacement.appendChild(node.firstChild);
  node.parentNode?.replaceChild(replacement, node);
  return replacement;
};

const normalizeCopiedRichLineHtml = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

  doc.querySelectorAll(".wa-rich-empty-line").forEach((node) => {
    const div = doc.createElement("div");
    div.appendChild(doc.createElement("br"));
    node.parentNode?.replaceChild(div, node);
  });

  doc.querySelectorAll(".wa-rich-line, .wa-rich-quote-line").forEach((node) => {
    replaceNodeTag(node, doc, "div");
  });

  doc.querySelectorAll(".wa-rich-line-content").forEach((node) => {
    const fragment = doc.createDocumentFragment();
    while (node.firstChild) fragment.appendChild(node.firstChild);
    node.parentNode?.replaceChild(fragment, node);
  });

  return doc.body.innerHTML;
};

const removeAdaptiveClipboardColors = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("[style*='color'], [data-color], font[color]").forEach((node) => {
    const color = normalizeClipboardColor(
      node.getAttribute("data-color") ||
      node.getAttribute("color") ||
      extractClipboardColorFromStyle(node.getAttribute("style") || "")
    );

    if (!isAdaptiveClipboardColor(color)) return;

    node.style?.removeProperty("color");
    node.removeAttribute("data-color");
    node.removeAttribute("color");
    node.classList?.remove("wa-rich-color");
    if (!String(node.getAttribute("style") || "").trim()) node.removeAttribute("style");
  });

  return doc.body.innerHTML;
};

const clampAudioWaveLevel = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const buildAudioMessageFallbackWave = (seed = "") => {
  let hash = 0;
  const text = String(seed || "audio");

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return Array.from({ length: AUDIO_MESSAGE_WAVE_BAR_COUNT }, (_, index) => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const random = hash / 0xffffffff;
    const pulse = Math.abs(Math.sin((index + 1) * 0.74 + random * 1.7));
    const breathing = Math.abs(Math.sin((index + 1) * 0.21));
    const isRest = index % 9 === 0 || index % 13 === 0;

    return isRest
      ? 0.05 + random * 0.08
      : clampAudioWaveLevel(0.18 + pulse * 0.5 + breathing * 0.2);
  });
};

const isRecordedVoiceNoteFile = (name = "") =>
  /^(audio|voice_note)_\d+\.(webm|ogg|m4a|mp3|wav|aac)$/i.test(String(name || ""));

const normalizeRichTextColor = (color = "") => {
  const value = String(color || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  return "";
};

const parseColorToRgb = (color) => {
  if (!color || typeof color !== "string") return null;
  const value = color.trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => char + char).join("")
      : hex[1];

    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgb = value.match(/^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgb) return null;

  return {
    r: Math.max(0, Math.min(255, Number(rgb[1]))),
    g: Math.max(0, Math.min(255, Number(rgb[2]))),
    b: Math.max(0, Math.min(255, Number(rgb[3]))),
  };
};

const mixRgb = (rgb, target, ratio) => ({
  r: Math.round(rgb.r + (target.r - rgb.r) * ratio),
  g: Math.round(rgb.g + (target.g - rgb.g) * ratio),
  b: Math.round(rgb.b + (target.b - rgb.b) * ratio),
});

const rgbToHex = (rgb) =>
  `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;

const getLuminance = (rgb) => {
  const toLinear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
};

const getReadableProfileColor = (color, theme) => {
  const rgb = parseColorToRgb(color);
  if (!rgb) return theme === "dark" ? "#7dd3fc" : "#128c7e";

  const luminance = getLuminance(rgb);

  if (theme === "dark") {
    return rgbToHex(luminance < 0.46 ? mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.52) : rgb);
  }

  return rgbToHex(luminance > 0.62 ? mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.42) : rgb);
};

const Message = ({
  id,
  mensaje,
  hora,
  enviadoPorMi,
  usuario,
  miUsuario,
  reacciones: reaccionesDB = [],
  esGrupo,
  onVerPerfil,
  onGuardarStickerFavorito,
  onEliminarStickerFavorito,   // 👈 nuevo
  esStickerFavorito = false,    // 👈 nuevo
  mostrarAvatar = true,
  mostrarNombre = true,
  agrupadoConAnterior = false,
  agrupadoConSiguiente = false,
  mentionOptions = [],
  onReply,
  onReplyPrivado,
  onEnviarMensajePrivado,
  onReplyPreviewClick,
  onCancelUpload,
  onRetryUpload,
  onForward,
  onStartSelect,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showEmojiPickerReactions, setShowEmojiPickerReactions] = useState(false);
  const [showEmojiPickerEdit, setShowEmojiPickerEdit] = useState(false);
  const [showReactionModal, setShowReactionModal] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState(null);
  const [showHistorial, setShowHistorial] = useState(false);
  const [historial, setHistorial] = useState([]);
  const [openDirection, setOpenDirection] = useState("up"); // "up" o "down"
  const messageRef = useRef(null);

  const [showFijarModal, setShowFijarModal] = useState(false);
  const [duracionFijado, setDuracionFijado] = useState("24h");
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [mensajePendienteFijar, setMensajePendienteFijar] = useState(null);
  // 🎞️ Galería tipo WhatsApp
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const [galeriaImagenes, setGaleriaImagenes] = useState([]); // urls normalizadas
  const [galeriaIndice, setGaleriaIndice] = useState(0);
  const [galeriaZoomed, setGaleriaZoomed] = useState(false);

  // 👇 AQUÍ pegamos lo del modal del sticker
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [esFavLocal, setEsFavLocal] = useState(esStickerFavorito);

  const audioRef = useRef(null);
  const progressRef = useRef(null);

  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioWaveform, setAudioWaveform] = useState(() => buildAudioMessageFallbackWave(""));
  const [audioPlaybackRate, setAudioPlaybackRate] = useState(1);
  const [showAudioRateControl, setShowAudioRateControl] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // version oscura de emoji
  const { theme } = useTheme();
  const emojiTheme = theme === "dark" ? "dark" : "light";

  const senderTitleStyle = useMemo(
    () => getProfileTitleStyle(usuario, miUsuario, theme),
    [usuario, miUsuario, theme]
  );

  useEffect(() => {
    setEsFavLocal(esStickerFavorito);
  }, [esStickerFavorito]);

  const isMine = esGrupo
    ? mensaje.usuario_id === miUsuario?.id
    : mensaje.usuario_envia_id === miUsuario?.id;


  const handleMessageCopy = (event) => {
    const root = messageRef.current;
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;

    try {
      const holder = document.createElement("div");
      holder.appendChild(range.cloneContents());

      const plainText = normalizeClipboardText(nodeToClipboardText(holder) || selection.toString());
      const normalizedHtml = normalizeCopiedRichLineHtml(holder.innerHTML);
      const cleanedHtml = sanitizeRichHtml(removeAdaptiveClipboardColors(normalizedHtml));

      if (!plainText) return;

      event.preventDefault();
      event.clipboardData.setData("text/plain", plainText);

      if (cleanedHtml && richHtmlHasFormatting(cleanedHtml)) {
        event.clipboardData.setData("text/html", cleanedHtml);
      }
    } catch (err) {
      logDev("No se pudo normalizar el texto copiado del mensaje:", err);
    }
  };

  // 👉 Normalizamos mensaje
  const mensajeData =
    typeof mensaje === "string" ? { mensaje, eliminado: 0, editado: 0 } : mensaje;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(mensajeData.mensaje);
  const [editInitialText, setEditInitialText] = useState(mensajeData.mensaje || "");
  const editInputRef = useRef(null);

  const [estaFijado, setEstaFijado] = useState(mensajeData?.fijado || false);

  const esSticker = mensajeData.mensaje?.startsWith("[sticker]");
  const stickerUrl = esSticker
    ? mensajeData.mensaje.replace("[sticker]", "")
    : null;

  const tieneGaleriaImagenes =
    !esSticker && Array.isArray(mensajeData.imagenes) && mensajeData.imagenes.length > 0;

  const archivoUrlCrudo = mensajeData.archivo_url || mensajeData.mensaje || "";
  const tipoArchivoMensaje = mensajeData.tipo_archivo || "";
  const tieneImagenSuelta =
    !tieneGaleriaImagenes &&
    !esSticker &&
    !!archivoUrlCrudo &&
    (/\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(archivoUrlCrudo) ||
      tipoArchivoMensaje.startsWith("image/"));

  const tieneAudioSuelto =
    !tieneGaleriaImagenes &&
    !esSticker &&
    !!archivoUrlCrudo &&
    ((!!tipoArchivoMensaje && tipoArchivoMensaje.startsWith("audio/")) ||
      /\.(mp3|wav|ogg|m4a|aac|webm)(\?.*)?$/i.test(archivoUrlCrudo));

  const tieneVideoSuelto =
    !tieneGaleriaImagenes &&
    !esSticker &&
    !!archivoUrlCrudo &&
    ((!!tipoArchivoMensaje && tipoArchivoMensaje.startsWith("video/")) ||
      /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(archivoUrlCrudo));

  const esMensajeConMedia =
    tieneGaleriaImagenes || tieneImagenSuelta || tieneAudioSuelto || tieneVideoSuelto;

  const replyToMessage = useMemo(() => {
    const directo = mensajeData.reply_to || mensajeData.respuesta || mensajeData.citado;
    if (directo) return directo;

    if (!mensajeData.reply_to_id && !mensajeData.reply_mensaje) return null;

    return {
      id: mensajeData.reply_to_id,
      mensaje: mensajeData.reply_mensaje || "",
      eliminado: mensajeData.reply_eliminado || 0,
      archivo_url: mensajeData.reply_archivo_url || null,
      tipo_archivo: mensajeData.reply_tipo_archivo || "",
      nombre_archivo: mensajeData.reply_nombre_archivo || "",
      usuario_id: mensajeData.reply_usuario_id,
      usuario_envia_id: mensajeData.reply_usuario_id,
      nombre: mensajeData.reply_usuario_nombre || "",
      apellido: mensajeData.reply_usuario_apellido || "",
      emisor_nombre: mensajeData.reply_usuario_nombre || "",
      emisor_apellido: mensajeData.reply_usuario_apellido || "",
      background:
        mensajeData.reply_usuario_background ||
        mensajeData.reply_background ||
        mensajeData.reply_emisor_background ||
        null,
    };
  }, [mensajeData]);

  const crearPayloadRespuesta = () => ({
    ...mensajeData,
    id,
    usuario_id: mensajeData.usuario_id || mensajeData.usuario_envia_id,
    usuario_envia_id: mensajeData.usuario_envia_id || mensajeData.usuario_id,
    nombre:
      mensajeData.nombre ||
      mensajeData.emisor_nombre ||
      (enviadoPorMi ? miUsuario?.nombre : usuario?.nombre) ||
      "",
    apellido:
      mensajeData.apellido ||
      mensajeData.emisor_apellido ||
      (enviadoPorMi ? miUsuario?.apellido : usuario?.apellido) ||
      "",
    archivo_url: mensajeData.archivo_url || null,
    tipo_archivo: mensajeData.tipo_archivo || "",
    nombre_archivo: mensajeData.nombre_archivo || "",
  });

  const crearPayloadReenviar = () => ({
    ...crearPayloadRespuesta(),
    imagenes: Array.isArray(mensajeData.imagenes) ? mensajeData.imagenes : undefined,
    lote_id: mensajeData.lote_id || mensajeData.loteId || null,
    tamano: mensajeData.tamano || 0,
    reenviado: 1,
  });

  const handleForward = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    if (typeof onForward === "function" && !mensajeData.eliminado) {
      onForward(crearPayloadReenviar());
      setDropdownOpen(false);
      setShowReactions(false);
      setShowEmojiPickerReactions(false);
    }
  };

  const handleStartSelect = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    if (typeof onStartSelect === "function" && !mensajeData.eliminado) {
      onStartSelect(crearPayloadReenviar());
      setDropdownOpen(false);
      setShowReactions(false);
      setShowEmojiPickerReactions(false);
    }
  };

  const handleReply = (e) => {
    if (e) {
      e.preventDefault?.();
      e.stopPropagation?.();
    }

    if (typeof onReply === "function" && !mensajeData.eliminado) {
      onReply(crearPayloadRespuesta());
      setDropdownOpen(false);
      setShowReactions(false);
      setShowEmojiPickerReactions(false);
    }
  };

  const nombreRemitenteMenu = (() => {
    const nombre =
      mensajeData.nombre ||
      mensajeData.emisor_nombre ||
      usuario?.nombre ||
      "Usuario";
    const apellido =
      mensajeData.apellido ||
      mensajeData.emisor_apellido ||
      usuario?.apellido ||
      "";
    return `${nombre} ${apellido}`.trim();
  })();

  const puedeEnviarPrivadoDesdeGrupo =
    esGrupo &&
    !isMine &&
    !mensajeData.eliminado &&
    (typeof onReplyPrivado === "function" || typeof onEnviarMensajePrivado === "function");

  const handleReplyPrivado = (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();

    if (typeof onReplyPrivado === "function" && !mensajeData.eliminado) {
      onReplyPrivado(crearPayloadRespuesta());
      setDropdownOpen(false);
      setShowReactions(false);
      setShowEmojiPickerReactions(false);
    }
  };

  const handleEnviarMensajePrivado = (e) => {
    e.preventDefault?.();
    e.stopPropagation?.();

    if (typeof onEnviarMensajePrivado === "function" && !mensajeData.eliminado) {
      onEnviarMensajePrivado(crearPayloadRespuesta());
      setDropdownOpen(false);
      setShowReactions(false);
      setShowEmojiPickerReactions(false);
    }
  };

  const scrollToQuotedMessage = (replyId) => {
    if (!replyId) return;
    const elemento = document.getElementById(`mensaje-${replyId}`);
    if (!elemento) return;
    elemento.scrollIntoView({ behavior: "smooth", block: "center" });
    elemento.classList.add("highlight-pinned");
    setTimeout(() => elemento.classList.remove("highlight-pinned"), 1400);
  };

  const truncatePreviewText = (value = "", maxLength = 150) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!maxLength || text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  };

  const renderReplyPreview = (replyMessage = replyToMessage) => {
    if (!replyMessage) return null;

    const preview = getMessagePreview(replyMessage);
    const rawPreviewText = preview.kind === "text"
      ? (preview.rawText && !isRichHtmlValue(preview.rawText) ? preview.rawText : preview.text)
      : preview.text;
    const previewText = truncatePreviewText(rawPreviewText, 150);
    const author = getReplyAuthorName(replyMessage, miUsuario?.id);
    const replyTitleStyle = getProfileTitleStyle(replyMessage, miUsuario, theme);

    return (
      <button
        type="button"
        className={`wa-quoted-message ${enviadoPorMi ? "out" : "in"}`}
        style={replyTitleStyle}
        onClick={(e) => {
          e.stopPropagation();
          const handled = typeof onReplyPreviewClick === "function"
            ? onReplyPreviewClick(replyMessage, mensajeData)
            : false;

          if (!handled) {
            scrollToQuotedMessage(replyMessage.id || replyMessage.reply_to_id);
          }
        }}
      >
        <span className="wa-quote-line" />
        <span className="wa-quote-content">
          <span className="wa-quote-author">{author}</span>
          <span className="wa-quote-text">
            {preview.iconClass && <i className={`wa-preview-icon ${preview.iconClass}`} aria-hidden="true" />}
            <span className="wa-preview-label">
              {preview.kind === "text"
                ? renderRichTextInline(previewText, `reply-preview-${replyMessage.id || replyMessage.reply_to_id || "msg"}`)
                : previewText}
            </span>
          </span>
        </span>
      </button>
    );
  };

  const permisosChat = useMemo(() => {
    let value = miUsuario?.permisos_chat;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { value = {}; }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }, [miUsuario?.permisos_chat]);

  const tienePermisoEditar = [1, true, "1", "true"].includes(permisosChat.editar_mensajes);
  const tienePermisoEliminar = [1, true, "1", "true"].includes(permisosChat.eliminar_mensajes);

  const puedeEditar =
    isMine &&
    tienePermisoEditar &&
    !mensajeData.eliminado &&
    Date.now() - new Date(mensajeData.fecha_envio).getTime() < 15 * 60 * 1000;

  const puedeEliminar = isMine && tienePermisoEliminar;

  // 👇 estado local que parte de lo que vino del backend
  const reacciones = reaccionesDB || [];

  const dropdownRef = useRef(null);

  const toggleDropdown = (e) => {
    e.preventDefault();
    setDropdownOpen(!dropdownOpen);
    setShowEmojiPickerReactions(false);
    setShowReactions(false);
  };

  // Normaliza URLs de imágenes / stickers para evitar mixed content y rutas rotas.
  const normalizarUrlImagen = (rawUrl) => {
    let finalUrl = String(rawUrl || "").trim().replace(/^(\[sticker\])+/i, "");

    if (!finalUrl) return "";
    if (/^(blob:|data:)/i.test(finalUrl)) return finalUrl;

    if (finalUrl.startsWith("/api/uploads/")) {
      finalUrl = finalUrl.replace(/^\/api/, "");
    }

    if (finalUrl.startsWith("uploads/")) {
      finalUrl = `/${finalUrl}`;
    }

    if (finalUrl.startsWith("http://")) {
      try {
        const u = new URL(finalUrl);
        finalUrl = `https://${u.host}${u.pathname}${u.search}`;
      } catch (e) {}
    }

    // Los GIF antiguos guardaban la URL externa de GIPHY. Los cargamos a
    // través del backend de QuickChat/Chatvista para evitar peticiones que
    // puedan quedarse "Stalled" en perfiles concretos de Chrome. El backend
    // conserva una copia local después de la primera solicitud.
    if (/^https?:\/\//i.test(finalUrl)) {
      try {
        const u = new URL(finalUrl);
        const isGiphyHost = u.hostname === "giphy.com" || u.hostname.endsWith(".giphy.com");
        if (isGiphyHost && /\/giphy\.gif$/i.test(u.pathname)) {
          return `/api/giphy/media?url=${encodeURIComponent(finalUrl)}`;
        }
      } catch (e) {}
    }

    if (/^https?:\/\//i.test(finalUrl) || finalUrl.startsWith("/uploads/")) {
      return getAvatarUrl(finalUrl) || finalUrl;
    }

    return finalUrl;
  };

  const normalizeComparableMediaUrl = (value = "") => {
    const text = String(value || "").trim().replace(/^(\[sticker\])+/i, "");
    if (!text) return "";

    try {
      const url = new URL(text);
      url.hash = "";
      if (url.protocol === "http:") url.protocol = "https:";
      return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    } catch {
      return text.replace(/^http:\/\//i, "https://");
    }
  };

  const looksLikeMediaOnlyUrl = (value = "") => {
    const text = String(value || "").trim();
    return /\.(jpe?g|png|webp|gif|mp4|webm|ogg|mov)(\?.*)?$/i.test(text) ||
      /\/giphy\.gif(?:\?.*)?$/i.test(text);
  };

  const isOnlyMediaUrlText = (value = "", mediaUrl = "") => {
    const cleaned = String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();

    if (!cleaned) return false;

    const normalizedMediaUrl = normalizeComparableMediaUrl(mediaUrl);
    const normalizedText = normalizeComparableMediaUrl(cleaned);

    if (normalizedMediaUrl && normalizedText === normalizedMediaUrl) return true;

    const urls = cleaned.match(/https?:\/\/[^\s]+/gi) || [];
    if (!urls.length) return looksLikeMediaOnlyUrl(cleaned);

    const textWithoutUrls = cleaned
      .replace(/https?:\/\/[^\s]+/gi, "")
      .replace(/[\s.,;:()<>[\]{}¡!¿?"'`]+/g, "")
      .trim();

    if (textWithoutUrls) return false;

    return urls.every((url) => {
      const normalizedUrl = normalizeComparableMediaUrl(url);
      return (normalizedMediaUrl && normalizedUrl === normalizedMediaUrl) || looksLikeMediaOnlyUrl(url);
    });
  };

  const normalizarUrlStickerParaAccion = (rawUrl) => {
    let finalUrl = String(rawUrl || "").trim().replace(/^(\[sticker\])+/i, "");

    if (finalUrl.startsWith("/api/uploads/")) {
      finalUrl = finalUrl.replace(/^\/api/, "");
    }

    if (finalUrl.startsWith("uploads/")) {
      finalUrl = `/${finalUrl}`;
    }

    if (/^https?:\/\//i.test(finalUrl)) {
      try {
        const url = new URL(finalUrl);
        if (url.pathname.startsWith("/uploads/")) {
          return `${url.pathname}${url.search}`;
        }
      } catch (e) {}
    }

    return finalUrl;
  };

  const abrirGaleria = (imagenes, indiceInicial = 0) => {
    if (!imagenes || !imagenes.length) return;
    const normalizadas = imagenes.map(normalizarUrlImagen);
    setGaleriaImagenes(normalizadas);
    setGaleriaIndice(indiceInicial);
    setGaleriaZoomed(false);
    setGaleriaAbierta(true);
  };

  // La onda visual se genera localmente. No descargamos ni decodificamos
  // el audio completo al abrir el chat; el archivo se solicita solo cuando
  // el elemento <audio> necesita sus metadatos o el usuario lo reproduce.
  useEffect(() => {
    const waveformSeed = tieneAudioSuelto && archivoUrlCrudo
      ? `${archivoUrlCrudo}-${mensajeData.nombre_archivo || ""}`
      : "";

    setAudioWaveform(buildAudioMessageFallbackWave(waveformSeed));
  }, [tieneAudioSuelto, archivoUrlCrudo, mensajeData.nombre_archivo]);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        !event.target.closest(".reactions-popover") &&
        !event.target.closest(".emoji-picker")
      ) {
        setDropdownOpen(false);
        setShowEmojiPickerReactions(false);
        setShowReactions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 🎹 Navegación de galería con teclado
  useEffect(() => {
    const handleKey = (e) => {
      if (!galeriaAbierta || galeriaImagenes.length === 0) return;

      if (e.key === "Escape") {
        setGaleriaAbierta(false);
      }
      if (e.key === "ArrowRight") {
        setGaleriaZoomed(false);
        setGaleriaIndice((prev) => (prev + 1) % galeriaImagenes.length);
      }
      if (e.key === "ArrowLeft") {
        setGaleriaZoomed(false);
        setGaleriaIndice((prev) =>
          prev - 1 < 0 ? galeriaImagenes.length - 1 : prev - 1
        );
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [galeriaAbierta, galeriaImagenes.length]);

  // 👉 Al reaccionar: actualiza UI y guarda en backend
  const handleReaction = async (emoji) => {
    logDev("👉 [FRONT] handleReaction llamado con:", emoji, "para mensaje:", id);

    try {
      const endpoint = esGrupo
        ? "/api/mensajes/grupo/reaccion"
        : "/api/mensajes/reaccion";

      const body = esGrupo
        ? { mensajeGrupoId: id, usuarioId: miUsuario?.id, emoji }
        : { mensajeId: id, usuarioId: miUsuario?.id, emoji };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ Backend respondió:", data);
    } catch (e) {
      console.error("❌ Error en fetch:", e);
    }
  };

  // 👇 función para renderizar emojis estilo WhatsApp
  const renderEmoji = (emoji, props = {}) => {
    const html = twemoji.parse(emoji, {
      folder: "svg",
      ext: ".svg",
      className: "twemoji",
    });

    return (
      <span
        {...props}
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ display: "inline-block", cursor: "pointer" }}
      />
    );
  };

  // 👉 Función para sacar inicial (si no hay avatar)
  const getInitial = (text) => {
    if (!text) return "U";
      return text.charAt(0).toUpperCase();
  };

  // 👉 Eliminar mensaje
  const handleEliminar = async (mensajeId) => {
    logDev("🗑️ [FRONT] Eliminando mensaje:", mensajeId);

    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/eliminar`
        : `/api/mensajes/${mensajeId}/eliminar`;

      const body = esGrupo
        ? { usuarioId: miUsuario.id, grupoId: usuario?.grupo_id }
        : { usuarioId: miUsuario.id };

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ [FRONT] Respuesta eliminar:", data);

      if (!res.ok) {
        console.error("❌ [FRONT] Error al eliminar:", data.error);
      }
    } catch (err) {
      console.error("❌ [FRONT] Error fetch eliminar:", err);
    }
  };

  // 👉 Deshacer el mensaje eliminado
  const handleDeshacer = async (mensajeId) => {
    logDev("↩️ [FRONT] Deshaciendo eliminación de:", mensajeId);

    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/deshacer`
        : `/api/mensajes/${mensajeId}/deshacer`;

      const body = { usuarioId: miUsuario.id };

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ [FRONT] Respuesta deshacer:", data);

      if (!res.ok) {
        console.error("❌ [FRONT] Error al deshacer:", data.error);
      }
    } catch (err) {
      console.error("❌ [FRONT] Error fetch deshacer:", err);
    }
  };

  // 👉 Editar mensaje
  const handleEditar = async (mensajeId, nuevoTexto) => {
    logDev("✏️ [FRONT] Editando mensaje:", mensajeId, "nuevo texto:", nuevoTexto);

    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/editar`
        : `/api/mensajes/${mensajeId}/editar`;

      const body = esGrupo
        ? { usuarioId: miUsuario.id, grupoId: usuario?.grupo_id, nuevoTexto }
        : { usuarioId: miUsuario.id, nuevoTexto };

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ [FRONT] Respuesta editar:", data);

      if (!res.ok) {
        console.error("❌ [FRONT] Error al editar:", data.error);
      } else {
        // 👉 Actualiza el estado local
        setIsEditing(false);
        setEditText("");
        setEditInitialText("");
      }
    } catch (err) {
      console.error("❌ [FRONT] Error fetch editar:", err);
    }
  };

  // 👉 Ver Mensajes Editados (Historial)
  const handleVerHistorial = async (mensajeId) => {
    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/historial`
        : `/api/mensajes/${mensajeId}/historial`;

      const res = await fetch(url);
      const data = await res.json();
      setHistorial(data);
      setShowHistorial(true);
    } catch (err) {
      console.error("❌ Error cargando historial:", err);
    }
  };

  const emojiPickerEditRef = useRef(null);

  const handleFijar = async (e) => {
    e.preventDefault();
    setDropdownOpen(false);

    if (estaFijado) {
      desFijarMensaje();
    } else {
      try {
        // 🔹 Obtener cuántos mensajes están fijados actualmente
        let endpoint = "";

        if (esGrupo) {
          endpoint = `/api/mensajes/grupo/fijados/${mensaje.grupo_id}`;
        } else {
          const usuarioDestinoId =
            mensaje.usuario_envia_id === miUsuario.id
              ? mensaje.usuario_recibe_id
              : mensaje.usuario_envia_id;

          endpoint = `/api/mensajes/fijados?usuario1=${miUsuario.id}&usuario2=${usuarioDestinoId}`;
        }

        const res = await fetch(endpoint);
        const data = await res.json();
        const fijadosActuales = data || [];

        if (fijadosActuales.length >= 3) {
          setMensajePendienteFijar({ id: id, duracion: duracionFijado });
          setShowReplaceModal(true);
        } else {
          setShowFijarModal(true);
        }
      } catch (err) {
        console.error("❌ Error verificando mensajes fijados:", err);
        setShowFijarModal(true);
      }
    }
  };

  // 👉 Confirmar Fijado
  const confirmarFijado = async (idOverride = id, duracionOverride = duracionFijado) => {
    try {
      const endpoint = esGrupo ? "/api/mensajes/grupo/fijar" : "/api/mensajes/fijar";

      const body = esGrupo
        ? {
            grupo_id: mensaje.grupo_id,
            mensaje_id: idOverride,
            usuario_id: miUsuario.id,
            duracion: duracionOverride,
          }
        : {
            mensajeId: idOverride,
            usuarioId: miUsuario.id,
            duracion: duracionOverride,
          };

      logDev("📤 Enviando al backend:", { endpoint, body });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("📩 Respuesta del backend:", data);

      if (res.ok) {
        setEstaFijado(true);
        setShowFijarModal(false);
      } else {
        alert(data.error || "Error al fijar mensaje");
      }
    } catch (err) {
      console.error("❌ Error fijando mensaje:", err);
    }
  };

  // 👉 Desfijar mensaje
  const desFijarMensaje = async () => {
    try {
      const endpoint = esGrupo ? "/api/mensajes/grupo/fijar" : "/api/mensajes/fijar";

      const body = esGrupo
        ? {
            grupo_id: mensaje.grupo_id,
            mensaje_id: id,
            usuario_id: miUsuario.id,
          }
        : {
            mensajeId: id,
            usuarioId: miUsuario.id,
          };

      logDev("📤 Desfijando mensaje:", { endpoint, body });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("📌 Desfijado:", data);

      if (res.ok) setEstaFijado(false);
    } catch (err) {
      console.error("❌ Error al desfijar:", err);
    }
  };

  // 👉 Confirmar Reemplazo
  const confirmarReemplazo = async () => {
    try {
      const endpointList = esGrupo
        ? `/api/mensajes/grupo/fijados/${mensaje.grupo_id}`
        : `/api/mensajes/fijados?usuario1=${miUsuario.id}&usuario2=${
            mensaje.usuario_envia_id === miUsuario.id
              ? mensaje.usuario_recibe_id
              : mensaje.usuario_envia_id
          }`;

      const resList = await fetch(endpointList);
      const fijadosActuales = await resList.json();

      if (fijadosActuales.length === 0) {
        setShowReplaceModal(false);
        confirmarFijado();
        return;
      }

      const masAntiguo = fijadosActuales.sort(
        (a, b) => new Date(a.fecha_fijado) - new Date(b.fecha_fijado)
      )[0];

      if (esGrupo) {
        await fetch("/api/mensajes/grupo/fijar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grupo_id: mensaje.grupo_id,
            mensaje_id: masAntiguo.mensaje_id,
            usuario_id: miUsuario.id,
          }),
        });
      } else {
        await fetch("/api/mensajes/fijar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mensajeId: masAntiguo.mensaje_id,
            usuarioId: miUsuario.id,
          }),
        });
      }

      await confirmarFijado(
        mensajePendienteFijar?.id,
        mensajePendienteFijar?.duracion
      );
      setShowReplaceModal(false);
    } catch (err) {
      console.error("❌ Error reemplazando mensaje fijado:", err);
    }
  };

  useEffect(() => {
    if (
      (showEmojiPickerReactions || showReactions || dropdownOpen) &&
      messageRef.current
    ) {
      const rect = messageRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      if (rect.top < windowHeight / 2) {
        setOpenDirection("down");
      } else {
        setOpenDirection("up");
      }
    }
  }, [showEmojiPickerReactions, showReactions, dropdownOpen]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        emojiPickerEditRef.current &&
        !emojiPickerEditRef.current.contains(e.target)
      ) {
        setShowEmojiPickerEdit(false);
      }
    }

    if (showEmojiPickerEdit) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPickerEdit]);

  const normalizeMentionText = (text = "") =>
    String(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const mentionCandidates = useMemo(() => {
    const base = [
      { id: "todos", type: "all", label: "todos" },
      ...(mentionOptions || []),
    ];

    const seen = new Set();

    return base
      .map((option) => {
        const label = String(option?.label || "").trim();
        if (!label) return null;

        const normalized = normalizeMentionText(label);
        if (!normalized || seen.has(normalized)) return null;
        seen.add(normalized);

        return {
          id: option.id || label,
          type: option.type || "user",
          label,
          normalized,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.label.length - a.label.length);
  }, [mentionOptions]);

  const isMentionBoundary = (char) =>
    !char || /[\s.,;:!?()[\]{}<>]/.test(char);

  const renderMentionSegment = (segment = "", keyPrefix = "mention") => {
    const nodes = [];
    let cursor = 0;

    while (cursor < segment.length) {
      const atIndex = segment.indexOf("@", cursor);

      if (atIndex === -1) {
        nodes.push(<span key={`${keyPrefix}-txt-${cursor}`}>{segment.slice(cursor)}</span>);
        break;
      }

      if (atIndex > cursor) {
        nodes.push(<span key={`${keyPrefix}-txt-${cursor}`}>{segment.slice(cursor, atIndex)}</span>);
      }

      const match = mentionCandidates.find((candidate) => {
        const rawMention = segment.slice(atIndex + 1, atIndex + 1 + candidate.label.length);
        if (normalizeMentionText(rawMention) !== candidate.normalized) return false;

        const nextChar = segment[atIndex + 1 + candidate.label.length];
        return isMentionBoundary(nextChar);
      });

      if (match) {
        const mentionText = segment.slice(atIndex, atIndex + 1 + match.label.length);
        nodes.push(
          <span
            key={`${keyPrefix}-mention-${atIndex}`}
            className={`chat-mention ${match.type === "all" ? "chat-mention-all" : ""}`}
          >
            {mentionText}
          </span>
        );
        cursor = atIndex + 1 + match.label.length;
        continue;
      }

      const genericMention = segment.slice(atIndex).match(/^@[A-Za-zÀ-ÿ0-9_.-]{1,40}/);
      if (genericMention) {
        nodes.push(
          <span key={`${keyPrefix}-mention-${atIndex}`} className="chat-mention">
            {genericMention[0]}
          </span>
        );
        cursor = atIndex + genericMention[0].length;
        continue;
      }

      nodes.push(<span key={`${keyPrefix}-at-${atIndex}`}>@</span>);
      cursor = atIndex + 1;
    }

    return nodes;
  };

  const inlineFormatRules = [
    { key: "color", open: "[color=", close: "[/color]", className: "wa-rich-color", color: true },
    { key: "bold", open: "**", close: "**", className: "wa-rich-bold" },
    { key: "underline", open: "__", close: "__", className: "wa-rich-underline" },
    { key: "strike2", open: "~~", close: "~~", className: "wa-rich-strike" },
    { key: "code", open: "`", close: "`", className: "wa-rich-code", raw: true },
    { key: "italic", open: "_", close: "_", className: "wa-rich-italic" },
    { key: "strike", open: "~", close: "~", className: "wa-rich-strike" },
  ];

  const findBalancedMessageColorToken = (value = "") => {
    const source = String(value || "");
    const openRegex = /\[color=(#[0-9a-fA-F]{3,6})\]/g;
    const firstOpen = openRegex.exec(source);
    if (!firstOpen) return null;

    let depth = 1;
    const tokenRegex = /\[color=#[0-9a-fA-F]{3,6}\]|\[\/color\]/g;
    tokenRegex.lastIndex = firstOpen.index + firstOpen[0].length;

    let match;
    while ((match = tokenRegex.exec(source))) {
      if (match[0].startsWith("[color=")) depth += 1;
      else depth -= 1;

      if (depth === 0) {
        return {
          color: normalizeRichTextColor(firstOpen[1]),
          openIndex: firstOpen.index,
          openLength: firstOpen[0].length,
          closeIndex: match.index,
          endIndex: match.index + match[0].length,
          content: source.slice(firstOpen.index + firstOpen[0].length, match.index),
        };
      }
    }

    return null;
  };

  const renderFormattedNode = (rule, content, key, depth) => {
    const children = rule.raw
      ? content
      : renderRichTextSegment(content, `${key}-inner`, depth + 1);

    if (rule.key === "bold") {
      return <strong key={key} className={rule.className}>{children}</strong>;
    }

    if (rule.key === "italic") {
      return <em key={key} className={rule.className}>{children}</em>;
    }

    if (rule.key === "underline") {
      return <span key={key} className={rule.className}>{children}</span>;
    }

    if (rule.key === "strike" || rule.key === "strike2") {
      return <del key={key} className={rule.className}>{children}</del>;
    }

    return <code key={key} className={rule.className}>{children}</code>;
  };

  const renderRichTextSegment = (segment = "", keyPrefix = "rich", depth = 0) => {
    const text = String(segment || "");
    if (!text) return [];
    if (depth > 8) return renderMentionSegment(text, keyPrefix);

    let bestMatch = null;

    const colorToken = findBalancedMessageColorToken(text);
    if (colorToken) {
      bestMatch = {
        rule: inlineFormatRules.find((rule) => rule.key === "color"),
        openIndex: colorToken.openIndex,
        closeIndex: colorToken.closeIndex,
        content: colorToken.content,
        color: colorToken.color,
        endIndex: colorToken.endIndex,
      };
    }

    inlineFormatRules.filter((rule) => !rule.color).forEach((rule) => {
      const openIndex = text.indexOf(rule.open);
      if (openIndex === -1) return;

      const closeIndex = text.indexOf(rule.close, openIndex + rule.open.length);
      if (closeIndex === -1) return;

      if (closeIndex === openIndex + rule.open.length) return;

      if (!bestMatch || openIndex < bestMatch.openIndex || (openIndex === bestMatch.openIndex && rule.open.length > bestMatch.rule.open.length)) {
        bestMatch = { rule, openIndex, closeIndex, endIndex: closeIndex + rule.close.length };
      }
    });

    if (!bestMatch) return renderMentionSegment(text, keyPrefix);

    const { rule, openIndex, closeIndex } = bestMatch;
    const before = text.slice(0, openIndex);
    const content = bestMatch.content ?? text.slice(openIndex + rule.open.length, closeIndex);
    const after = text.slice(bestMatch.endIndex ?? (closeIndex + rule.close.length));

    if (rule.key === "color") {
      const color = normalizeRichTextColor(bestMatch.color);
      const colorNode = color ? (
        <span key={`${keyPrefix}-color-${openIndex}`} className="wa-rich-color" style={{ color }}>
          {renderRichTextSegment(content, `${keyPrefix}-color-${openIndex}-inner`, depth + 1)}
        </span>
      ) : (
        <React.Fragment key={`${keyPrefix}-color-${openIndex}`}>
          {renderRichTextSegment(content, `${keyPrefix}-color-${openIndex}-inner`, depth + 1)}
        </React.Fragment>
      );

      return [
        ...renderRichTextSegment(before, `${keyPrefix}-before`, depth + 1),
        colorNode,
        ...renderRichTextSegment(after, `${keyPrefix}-after`, depth + 1),
      ];
    }

    return [
      ...renderRichTextSegment(before, `${keyPrefix}-before`, depth + 1),
      renderFormattedNode(rule, content, `${keyPrefix}-${rule.key}-${openIndex}`, depth),
      ...renderRichTextSegment(after, `${keyPrefix}-after`, depth + 1),
    ];
  };

  // 🧩 Texto normal con detección de enlaces, menciones y formato tipo WhatsApp.
  const renderTextoConLinks = (texto = "") => {
    const text = String(texto || "");
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const nodes = [];
    let lastIndex = 0;
    let match;
    let partIndex = 0;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(
          ...renderRichTextSegment(text.slice(lastIndex, match.index), `part-${partIndex}`)
        );
      }

      const url = match[0];
      nodes.push(
        <a
          key={`url-${partIndex}-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--link-color)",
            textDecoration: "underline",
            wordBreak: "break-word",
          }}
        >
          {url}
        </a>
      );

      lastIndex = match.index + url.length;
      partIndex += 1;
    }

    if (lastIndex < text.length) {
      nodes.push(...renderRichTextSegment(text.slice(lastIndex), `part-${partIndex}`));
    }

    return nodes;
  };

  const renderFormattedMessageBlocks = (texto = "") => {
    if (isRichHtmlValue(texto)) {
      const safeHtml = sanitizeRichHtml(decodeRichHtmlValue(texto));
      return (
        <div
          className="wa-rich-html-message"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      );
    }

    const lines = String(texto || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let index = 0;

    const renderInlineLine = (line, keyPrefix) => (
      <span className="wa-rich-line-content">
        {renderTextoConLinks(line).map((node, nodeIndex) => (
          <React.Fragment key={`${keyPrefix}-node-${nodeIndex}`}>{node}</React.Fragment>
        ))}
      </span>
    );

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        blocks.push(<span key={`blank-${index}`} className="wa-rich-empty-line" />);
        index += 1;
        continue;
      }

      const orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
      if (orderedMatch) {
        const startNumber = Number(orderedMatch[1]) || 1;
        const items = [];

        while (index < lines.length) {
          const match = lines[index].match(/^\s*(\d+)\.\s+(.+)$/);
          if (!match) break;
          items.push(match[2]);
          index += 1;
        }

        blocks.push(
          <ol key={`ordered-${index}-${blocks.length}`} className="wa-rich-list wa-rich-ordered-list" start={startNumber}>
            {items.map((item, itemIndex) => (
              <li key={`ordered-item-${itemIndex}`}>{renderInlineLine(item, `ordered-${index}-${itemIndex}`)}</li>
            ))}
          </ol>
        );
        continue;
      }

      const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
      if (bulletMatch) {
        const items = [];

        while (index < lines.length) {
          const match = lines[index].match(/^\s*[-*•]\s+(.+)$/);
          if (!match) break;
          items.push(match[1]);
          index += 1;
        }

        blocks.push(
          <ul key={`bullet-${index}-${blocks.length}`} className="wa-rich-list wa-rich-bullet-list">
            {items.map((item, itemIndex) => (
              <li key={`bullet-item-${itemIndex}`}>{renderInlineLine(item, `bullet-${index}-${itemIndex}`)}</li>
            ))}
          </ul>
        );
        continue;
      }

      const quoteMatch = line.match(/^\s*>\s?(.*)$/);
      if (quoteMatch) {
        const quoteLines = [];

        while (index < lines.length) {
          const match = lines[index].match(/^\s*>\s?(.*)$/);
          if (!match) break;
          quoteLines.push(match[1]);
          index += 1;
        }

        blocks.push(
          <blockquote key={`quote-${index}-${blocks.length}`} className="wa-rich-quote-block">
            {quoteLines.map((quoteLine, quoteIndex) => (
              <span key={`quote-line-${quoteIndex}`} className="wa-rich-quote-line">
                {renderInlineLine(quoteLine, `quote-${index}-${quoteIndex}`)}
              </span>
            ))}
          </blockquote>
        );
        continue;
      }

      const normalLines = [];
      while (index < lines.length) {
        const currentLine = lines[index];
        if (!currentLine.trim()) break;
        if (/^\s*(\d+)\.\s+(.+)$/.test(currentLine)) break;
        if (/^\s*[-*•]\s+(.+)$/.test(currentLine)) break;
        if (/^\s*>\s?(.*)$/.test(currentLine)) break;
        normalLines.push(currentLine);
        index += 1;
      }

      normalLines.forEach((normalLine, normalIndex) => {
        blocks.push(
          <span key={`line-${index}-${normalIndex}`} className="wa-rich-line">
            {renderInlineLine(normalLine, `line-${index}-${normalIndex}`)}
          </span>
        );
      });
    }

    return blocks;
  };

  //REPRODUCCION DE AUDIO 
  const formatAudioTime = (seconds) => {
    if (!seconds || Number.isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const toggleAudio = () => {
    if (!audioRef.current) return;

    audioRef.current.playbackRate = audioPlaybackRate;

    if (audioPlaying) {
      audioRef.current.pause();
      return;
    }

    const playPromise = audioRef.current.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        setAudioPlaying(false);
        logDev("No se pudo reproducir el audio:", error);
      });
    }
  };

  const cycleAudioPlaybackRate = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    setAudioPlaybackRate((currentRate) => {
      const nextRate = currentRate === 1 ? 1.5 : currentRate === 1.5 ? 2 : 1;

      if (audioRef.current) {
        audioRef.current.playbackRate = nextRate;
      }

      return nextRate;
    });
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;

    audioRef.current.playbackRate = audioPlaybackRate;

    const duration = Number(audioRef.current.duration);
    if (Number.isFinite(duration) && duration > 0) {
      setAudioDuration(duration);
    }
  };

  const handleAudioError = () => {
    if (!audioRef.current) return;

    setAudioPlaying(false);
    setAudioDuration(0);
    setAudioCurrentTime(0);

    const mediaError = audioRef.current.error;
    logDev("Error cargando audio del mensaje:", {
      code: mediaError?.code || null,
      message: mediaError?.message || "Error de audio",
      src: audioRef.current.currentSrc || audioRef.current.src || "",
    });
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setAudioCurrentTime(audioRef.current.currentTime || 0);
  };

  const handleAudioEnded = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    setAudioPlaying(false);
    setAudioCurrentTime(0);
  };

  const seekAudioToClientX = (clientX) => {
    if (!progressRef.current || !audioRef.current || !audioDuration) return;

    const rect = progressRef.current.getBoundingClientRect();
    const playableWidth = Math.max(1, rect.width - AUDIO_MESSAGE_WAVE_BAR_WIDTH);
    const relativeX = clientX - rect.left - AUDIO_MESSAGE_WAVE_BAR_WIDTH / 2;
    const percent = Math.max(0, Math.min(1, relativeX / playableWidth));
    const newTime = percent * audioDuration;

    audioRef.current.currentTime = newTime;
    setAudioCurrentTime(newTime);
  };

  const handleSeekAudioPointerDown = (event) => {
    if (!progressRef.current || !audioRef.current || !audioDuration) return;
    if (typeof event.button === "number" && event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    seekAudioToClientX(event.clientX);

    const handlePointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      seekAudioToClientX(moveEvent.clientX);
    };

    const handlePointerUp = (upEvent) => {
      upEvent.preventDefault();
      seekAudioToClientX(upEvent.clientX);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = audioPlaybackRate;
  }, [audioPlaybackRate]);

  useEffect(() => {
    if (!audioPlaying) return undefined;

    let animationFrameId;
    const updateCurrentAudioTime = () => {
      if (audioRef.current) {
        setAudioCurrentTime(audioRef.current.currentTime || 0);
      }
      animationFrameId = requestAnimationFrame(updateCurrentAudioTime);
    };

    animationFrameId = requestAnimationFrame(updateCurrentAudioTime);

    return () => cancelAnimationFrame(animationFrameId);
  }, [audioPlaying]);

  useEffect(() => {
    setAudioPlaying(false);
    setAudioDuration(0);
    setAudioCurrentTime(0);
    setAudioPlaybackRate(1);
    setShowAudioRateControl(false);
  }, [archivoUrlCrudo]);

  useEffect(() => {
    if (!showStickerModal || typeof document === "undefined") return undefined;

    const currentCount = Number(document.body.dataset.waStickerDetailOpenCount || 0);
    document.body.dataset.waStickerDetailOpenCount = String(currentCount + 1);
    document.body.classList.add("wa-sticker-detail-open");

    return () => {
      const nextCount = Math.max(0, Number(document.body.dataset.waStickerDetailOpenCount || 1) - 1);

      if (nextCount === 0) {
        document.body.classList.remove("wa-sticker-detail-open");
        delete document.body.dataset.waStickerDetailOpenCount;
      } else {
        document.body.dataset.waStickerDetailOpenCount = String(nextCount);
      }
    };
  }, [showStickerModal]);

  const hasOpenFloatingLayer =
    dropdownOpen ||
    showReactions ||
    showEmojiPickerReactions ||
    showEmojiPickerEdit ||
    showReactionModal ||
    showHistorial ||
    showFijarModal ||
    showReplaceModal ||
    showStickerModal ||
    galeriaAbierta ||
    isEditing;

  return (
    <div
      id={`mensaje-${id}`}
      className={`message ${enviadoPorMi ? "message-out" : ""} ${mostrarAvatar ? "message-has-avatar" : "message-no-avatar"} ${agrupadoConAnterior ? "message-grouped-prev" : ""} ${agrupadoConSiguiente ? "message-grouped-next" : ""} ${hasOpenFloatingLayer ? "message-layer-active" : ""} ${selectionMode ? "message-selection-mode" : ""} ${isSelected ? "message-selected" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {selectionMode && !mensajeData.eliminado && (
        <button
          type="button"
          className={`wa-message-select-check ${isSelected ? "checked" : ""}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.(crearPayloadReenviar());
          }}
          aria-label={isSelected ? "Quitar selección" : "Seleccionar mensaje"}
        >
          {isSelected && <i className="fa-solid fa-check" aria-hidden="true" />}
        </button>
      )}

      {!selectionMode && !mensajeData.eliminado && typeof onReply === "function" && (
        <button
          type="button"
          className={`message-reply-shortcut ${enviadoPorMi ? "out" : "in"}`}
          onClick={handleReply}
          title="Responder"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 14 4 9 9 4"></polyline>
            <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
          </svg>
        </button>
      )}

      {/* Avatar del que envió */}
      <div
        className={`avatar avatar-responsive ${mostrarAvatar ? "" : "message-avatar-hidden"}`}
        style={{ cursor: mostrarAvatar ? "pointer" : "default" }}
        onClick={() => {
          if (mostrarAvatar) onVerPerfil(enviadoPorMi ? miUsuario : usuario);
        }}
        aria-hidden={mostrarAvatar ? "false" : "true"}
      >
        {(enviadoPorMi ? miUsuario?.url_imagen : usuario?.url_imagen) ? (
          <img
            className="avatar-img"
            src={getAvatarUrl(
              enviadoPorMi ? miUsuario.url_imagen : usuario.url_imagen
            )}
            alt={(enviadoPorMi ? miUsuario?.nombre : usuario?.nombre) || "usuario"}
            style={{ width: "44px", height: "44px", objectFit: "cover" }}
          />
        ) : (
          <div
            className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
            style={{
              width: "44px",
              height: "44px",
              backgroundColor: enviadoPorMi
                ? miUsuario?.background || "#6c757d"
                : usuario?.background || "#6c757d",
              fontSize: "18px",
            }}
          >
            {getInitial(
              (enviadoPorMi ? miUsuario?.nombre : usuario?.nombre) || "U"
            )}
          </div>
        )}
      </div>

      <div
        ref={messageRef}
        className="message-inner"
        style={{ position: "relative" }}
        onDoubleClick={selectionMode ? undefined : handleReply}
        onCopy={handleMessageCopy}
        onClick={(event) => {
          if (!selectionMode || mensajeData.eliminado) return;
          event.stopPropagation();
          onToggleSelect?.(crearPayloadReenviar());
        }}
      >
        <div className="message-body">
          <div className="message-content">
            <div
              className={`message-text position-relative ${
                esMensajeConMedia ? "message-media-bubble" : ""
              } ${esSticker ? "message-sticker-bubble" : ""} ${tieneAudioSuelto ? "message-audio-bubble" : ""} ${
                tieneVideoSuelto ? "message-video-bubble" : ""
              } ${mensajeData.eliminado ? "message-deleted-bubble" : ""}`}
            >
              {/* Nombre del remitente dentro de la burbuja */}
              {esGrupo && !enviadoPorMi && mostrarNombre && (
                <div
                  className="fw-bold small message-sender-name"
                  style={senderTitleStyle}
                >
                  {`${usuario?.nombre || ""} ${usuario?.apellido || ""}`}
                </div>
              )}
              {Number(mensajeData.reenviado || mensajeData.forwarded || 0) === 1 && !mensajeData.eliminado && (
                <div className="wa-forwarded-label">
                  <i className="fa-solid fa-share" aria-hidden="true" />
                  <span>Reenviado</span>
                </div>
              )}
              {renderReplyPreview()}
              <div className="message-action" ref={dropdownRef}>
                <div className={`dropdown ${dropdownOpen ? "show" : ""}`}>
                  <button
                    type="button"
                    className={`wa-message-menu-btn ${
                      isHovered || dropdownOpen ? "visible" : ""
                    } ${enviadoPorMi ? "out" : "in"}`}
                    aria-expanded={dropdownOpen ? "true" : "false"}
                    onClick={toggleDropdown}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="7 10 12 15 17 10"></polyline>
                    </svg>
                  </button>

                  <ul
                    className={`dropdown-menu ${dropdownOpen ? "show" : ""}`}
                    style={{
                      position: "absolute",
                      ...(openDirection === "up"
                        ? { bottom: "calc(100% + 8px)" }
                        : { top: "calc(100% + 8px)" }),
                      ...(enviadoPorMi
                        ? { right: "0", left: "auto" }
                        : { left: "0", right: "auto" }),
                      transform: "none",
                      zIndex: 10000,
                    }}
                  >
                    <li>
                      <a
                        className="dropdown-item d-flex align-items-center"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDropdownOpen(false);
                          setShowEmojiPickerReactions(false);
                          setShowReactions(true);
                        }}
                      >
                        <span className="me-auto">Reaccionar</span> 😀
                      </a>
                    </li>

                    {isMine && puedeEditar && (
                      <li>
                        <a
                          className="dropdown-item d-flex align-items-center"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setEditInitialText(mensajeData.mensaje || "");
                            setEditText(mensajeData.mensaje || "");
                            setIsEditing(true);
                            setDropdownOpen(false);
                          }}
                        >
                          <span className="me-auto">Editar</span>
                          <div className="icon">
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
                              className="feather feather-edit-2"
                            >
                              <path d="M17 3a2.828 2.828 0 0 1 4 4L7 21H3v-4L17 3z"></path>
                            </svg>
                          </div>
                        </a>
                      </li>
                    )}

                    <li>
                      <a
                        className="dropdown-item d-flex align-items-center"
                        href="#"
                        onClick={handleReply}
                      >
                        <span className="me-auto">Responder</span>
                        <div className="icon">
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
                            className="feather feather-corner-up-left"
                          >
                            <polyline points="9 14 4 9 9 4"></polyline>
                            <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                          </svg>
                        </div>
                      </a>
                    </li>

                    {!mensajeData.eliminado && typeof onForward === "function" && (
                      <li>
                        <a
                          className="dropdown-item d-flex align-items-center"
                          href="#"
                          onClick={handleForward}
                        >
                          <span className="me-auto">Reenviar</span>
                          <div className="icon">
                            <i className="fa-solid fa-share" aria-hidden="true" />
                          </div>
                        </a>
                      </li>
                    )}

                    {puedeEnviarPrivadoDesdeGrupo && (
                      <>
                        {typeof onReplyPrivado === "function" && (
                          <li>
                            <a
                              className="dropdown-item d-flex align-items-center"
                              href="#"
                              onClick={handleReplyPrivado}
                            >
                              <span className="me-auto">Responder en privado</span>
                              <div className="icon">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="22"
                                  height="22"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                  <path d="M8 9h8"></path>
                                  <path d="M8 13h5"></path>
                                </svg>
                              </div>
                            </a>
                          </li>
                        )}

                        {typeof onEnviarMensajePrivado === "function" && (
                          <li>
                            <a
                              className="dropdown-item d-flex align-items-center"
                              href="#"
                              onClick={handleEnviarMensajePrivado}
                            >
                              <span className="me-auto">Enviar mensaje a {nombreRemitenteMenu}</span>
                              <div className="icon">
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="22"
                                  height="22"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                  <circle cx="12" cy="7" r="4"></circle>
                                  <path d="M18 8h4"></path>
                                  <path d="M20 6v4"></path>
                                </svg>
                              </div>
                            </a>
                          </li>
                        )}
                      </>
                    )}

                    <li>
                      <a
                        className="dropdown-item d-flex align-items-center"
                        href="#"
                        onClick={(e) => handleFijar(e)}
                      >
                        <span className="me-auto">
                          {estaFijado ? "Desfijar mensaje" : "Fijar mensaje"}
                        </span>
                        <div className="icon">
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
                            className="feather feather-pin"
                            style={{
                              transform: estaFijado ? "rotate(45deg)" : "none",
                              transition: "transform 0.2s ease",
                            }}
                          >
                            <path d="M12 2v7l-2 3v9l2-2 2 2v-9l-2-3V2z" />
                          </svg>
                        </div>
                      </a>
                    </li>

                    {!mensajeData.eliminado && typeof onStartSelect === "function" && (
                      <li>
                        <a
                          className="dropdown-item d-flex align-items-center"
                          href="#"
                          onClick={handleStartSelect}
                        >
                          <span className="me-auto">Seleccionar</span>
                          <div className="icon">
                            <i className="fa-regular fa-square-check" aria-hidden="true" />
                          </div>
                        </a>
                      </li>
                    )}

                    {tieneAudioSuelto && !mensajeData.eliminado && (
                      <li>
                        <a
                          className="dropdown-item d-flex align-items-center"
                          href={normalizarUrlImagen(archivoUrlCrudo)}
                          download={mensajeData.nombre_archivo || "audio"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDropdownOpen(false);
                          }}
                        >
                          <span className="me-auto">Descargar audio</span>
                          <div className="icon">
                            <i className="fa-solid fa-download" aria-hidden="true" />
                          </div>
                        </a>
                      </li>
                    )}

                    {puedeEliminar && (
                      <>
                        <li>
                          <hr className="dropdown-divider" />
                        </li>
                        <li>
                          <a
                            className="dropdown-item d-flex align-items-center text-danger"
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              handleEliminar(id);
                              setDropdownOpen(false);
                            }}
                          >
                            <span className="me-auto">Eliminar</span>
                            <div className="icon">
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
                                className="feather feather-trash-2"
                              >
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                              </svg>
                            </div>
                          </a>
                        </li>
                      </>
                    )}

                    {esSticker && onGuardarStickerFavorito && (
                      <li>
                        <a
                          className="dropdown-item d-flex align-items-center"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            onGuardarStickerFavorito(normalizarUrlStickerParaAccion(stickerUrl));
                            setDropdownOpen(false);
                          }}
                        >
                          <span className="me-auto">Guardar como sticker favorito</span>
                          <span>⭐</span>
                        </a>
                      </li>
                    )}
                  </ul>
                  {showReactions && (
                    <div
                      className="reactions-popover"
                      style={{
                        position: "absolute",
                        ...(openDirection === "up"
                          ? { bottom: "calc(100% + 8px)" }
                          : { top: "calc(100% + 8px)" }),
                        ...(enviadoPorMi
                          ? { right: "0", left: "auto" }
                          : { left: "0", right: "auto" }),
                        zIndex: 10001,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="reactions-popover-inner">
                        {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji, idx) => {
                          const esMia = reacciones.some(
                            (r) => r.usuario_id === miUsuario?.id && r.emoji === emoji
                          );

                          return (
                            <span
                              key={idx}
                              onClick={() => {
                                handleReaction(emoji);
                                setShowReactions(false);
                              }}
                              style={{
                                fontSize: "20px",
                                cursor: "pointer",
                                padding: "4px 6px",
                                borderRadius: "50%",
                                backgroundColor: esMia ? "#e5e7eb" : "transparent",
                              }}
                            >
                              {emoji}
                            </span>
                          );
                        })}

                        <button
                          type="button"
                          className="plus-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEmojiPickerReactions(true);
                            setShowReactions(false);
                          }}
                          style={{
                            width: "28px",
                            height: "28px",
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                          }}
                        >
                          <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="12" fill="var(--surface-3)" />
                            <path
                              d="M12 7v10M7 12h10"
                              stroke="var(--text-muted-2)"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {mensajeData.eliminado ? (
                <div className="wa-deleted-message fst-italic text-muted d-flex align-items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    className="me-2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6-7h-1V7a5 5 0 0 0-10 0v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-3 0H9V7a3 3 0 0 1 6 0v3Z" />
                  </svg>
                  Se eliminó este mensaje
                </div>
              ) : (
                (() => {
                  // 🧩 0️⃣ Mensaje con varias imágenes + caption
                  if (
                    !esSticker &&
                    Array.isArray(mensajeData.imagenes) &&
                    mensajeData.imagenes.length > 0
                  ) {
                    const MAX_VISIBLE = 4;
                    const total = mensajeData.imagenes.length;
                    const visibles = mensajeData.imagenes.slice(0, MAX_VISIBLE);
                    const todasNormalizadas = mensajeData.imagenes.map(
                      normalizarUrlImagen
                    );

                    const esSoloIds =
                      typeof mensajeData.mensaje === "string" &&
                      mensajeData.mensaje.trim() !== "" &&
                      mensajeData.mensaje
                        .split("\n")
                        .every((line) =>
                          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                            line.trim()
                          )
                        );

                    const caption =
                      mensajeData.mensaje &&
                      !esSoloIds &&
                      !isOnlyMediaUrlText(mensajeData.mensaje, todasNormalizadas[0])
                        ? mensajeData.mensaje
                        : "";

                    return (
                      <div className="wa-message-media-stack">
                        <div
                          className={`wa-image-grid ${total === 1 ? "single" : "multi"}`}
                          style={{
                            gridTemplateColumns:
                              total === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))",
                          }}
                        >
                          {visibles.map((rawUrl, idx) => {
                            let finalUrl = todasNormalizadas[idx];

                            if (finalUrl?.startsWith("http://")) {
                              try {
                                const u = new URL(finalUrl);
                                finalUrl = `https://${u.host}${u.pathname}${u.search}`;
                              } catch (e) {}
                            }

                            finalUrl = getAvatarUrl(finalUrl) || finalUrl;

                            const isLastVisible = idx === visibles.length - 1;
                            const showMoreBadge =
                              isLastVisible && total > MAX_VISIBLE;
                            const extraCount = total - MAX_VISIBLE + 1;

                            return (
                              <div
                                key={idx}
                                className="wa-image-tile position-relative"
                                onClick={() =>
                                  abrirGaleria(todasNormalizadas, idx)
                                }
                              >
                                <img
                                  src={finalUrl}
                                  alt={`imagen-${idx}`}
                                  loading="lazy"
                                  decoding="async"
                                  className="wa-message-image"
                                  style={{
                                    height: total === 1 ? "auto" : 120,
                                  }}
                                />

                                {showMoreBadge && (
                                  <div
                                    className="d-flex align-items-center justify-content-center"
                                    style={{
                                      position: "absolute",
                                      inset: 0,
                                      backgroundColor: "rgba(0,0,0,0.45)",
                                      color: "#fff",
                                      fontSize: 24,
                                      fontWeight: 600,
                                    }}
                                  >
                                    +{extraCount}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {caption && (
                          <p className="wa-image-caption break-words whitespace-pre-wrap">
                            {renderTextoConLinks(caption)}
                          </p>
                        )}
                      </div>
                    );
                  }

                  // 🧩 1️⃣ Stickers tipo WhatsApp con modal de detalle
                  if (mensajeData.mensaje?.startsWith("[sticker]")) {
                    const raw = mensajeData.mensaje.replace("[sticker]", "");
                    const stickerActionUrl = normalizarUrlStickerParaAccion(raw);
                    const stickerImageUrl = normalizarUrlImagen(raw);

                    // Nombre del sticker sacado del archivo
                    const nombreArchivoSticker = (() => {
                      try {
                        const partes = stickerActionUrl.split("/");
                        const nombre = partes.pop() || "Sticker";
                        return decodeURIComponent(nombre.replace(/\.\w+$/, ""));
                      } catch {
                        return "Sticker";
                      }
                    })();

                    // Nombre del usuario que lo envió
                    const creadorNombre =
                      `${usuario?.nombre || ""} ${usuario?.apellido || ""}`.trim() ||
                      "Desconocido";

                    const handleFavClick = async (e) => {
                      e.stopPropagation();

                      try {
                        if (esFavLocal) {
                          // Eliminar de favoritos
                          if (onEliminarStickerFavorito) {
                            await onEliminarStickerFavorito(stickerActionUrl);
                          }
                          setEsFavLocal(false);
                        } else {
                          // Añadir a favoritos
                          if (onGuardarStickerFavorito) {
                            await onGuardarStickerFavorito(stickerActionUrl);
                          }
                          setEsFavLocal(true);
                        }
                      } catch (err) {
                        console.error("❌ Error al cambiar favorito:", err);
                      }
                    };

                    const estadoSticker = mensajeData.estado;
                    const stickerSubiendo = estadoSticker === "subiendo";
                    const stickerError = estadoSticker === "error";

                    return (
                      <>
                        {/* Sticker dentro del chat, sin burbuja de fondo */}
                        <span className="wa-sticker-message-wrap">
                          <button
                            type="button"
                            className={`wa-sticker-message ${stickerSubiendo ? "is-uploading" : ""} ${stickerError ? "is-error" : ""}`}
                            onClick={() => !stickerSubiendo && !stickerError && setShowStickerModal(true)}
                            aria-label="Ver sticker"
                            disabled={stickerSubiendo}
                          >
                            <img
                              src={stickerImageUrl}
                              alt="sticker"
                              draggable="false"
                              onError={(event) => {
                                event.currentTarget.classList.add("is-broken");
                              }}
                            />

                            {stickerSubiendo && (
                              <span className="wa-media-upload-overlay wa-sticker-upload-overlay">
                                <button
                                  type="button"
                                  className="wa-upload-cancel-btn"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onCancelUpload?.(mensajeData.id || id);
                                  }}
                                  aria-label="Cancelar envío"
                                  title="Cancelar envío"
                                >
                                  ×
                                </button>
                              </span>
                            )}

                            {esFavLocal && (
                              <span className="wa-sticker-fav-badge" aria-label="Favorito">
                                <i className="fa-solid fa-star" aria-hidden="true" />
                              </span>
                            )}
                          </button>

                          {stickerError && (
                            <button
                              type="button"
                              className="wa-media-error-action"
                              data-tooltip={mensajeData.error_mensaje || "Se produjo un error. Haz clic para obtener más información."}
                              aria-label="Reintentar envío"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onRetryUpload?.(mensajeData.id || id);
                              }}
                            >
                              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                            </button>
                          )}
                        </span>

                        {/* Modal estilo WhatsApp */}
                        {showStickerModal && typeof document !== "undefined" && createPortal(
                          <div
                            className="wa-sticker-detail-backdrop"
                            onClick={() => setShowStickerModal(false)}
                          >
                            <div
                              className="wa-sticker-detail-card"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <img
                                src={stickerImageUrl}
                                alt={nombreArchivoSticker}
                              />

                              <div className="wa-sticker-detail-meta">
                                <strong>{nombreArchivoSticker}</strong>
                                <span>by {creadorNombre}</span>
                              </div>

                              <button
                                type="button"
                                className={`wa-sticker-detail-fav ${esFavLocal ? "is-favorite" : ""}`}
                                onClick={handleFavClick}
                              >
                                {esFavLocal ? "Eliminar de favoritos" : "Añadir a favoritos"}
                              </button>
                            </div>
                          </div>,
                          document.body
                        )}
                      </>
                    );
                  }

                  // 🧩 2️⃣ Archivos / imágenes sueltas
                  let urlArchivo = mensajeData.archivo_url || mensajeData.mensaje;
                  const tipo = mensajeData.tipo_archivo || "";
                  const nombre =
                    mensajeData.nombre_archivo ||
                    urlArchivo?.split("/").pop() ||
                    "archivo";
                  const tamano = mensajeData.tamano || 0;

                  urlArchivo = normalizarUrlImagen(urlArchivo);

                  if (urlArchivo?.startsWith("http://")) {
                    try {
                      const u = new URL(urlArchivo);
                      urlArchivo = `https://${u.host}${u.pathname}${u.search}`;
                    } catch (e) {}
                  }

                  if (urlArchivo) {
                    const esImagen =
                      /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(urlArchivo) ||
                      (tipo && tipo.startsWith("image/"));

                    const esAudio =
                      (!!tipo && tipo.startsWith("audio/")) ||
                      /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(urlArchivo);

                    const esVideo =
                      (!!tipo && tipo.startsWith("video/")) ||
                      /\.(mp4|webm|ogg|mov)$/i.test(urlArchivo);

                    if (esImagen) {
                      const estado = mensajeData.estado;
                      const progreso = mensajeData.progreso;

                      const textoCaptionImagen = typeof mensajeData.mensaje === "string"
                        ? mensajeData.mensaje.trim()
                        : "";

                      const captionImagen =
                        mensajeData.archivo_url &&
                        textoCaptionImagen &&
                        mensajeData.mensaje !== mensajeData.archivo_url &&
                        !isOnlyMediaUrlText(textoCaptionImagen, urlArchivo)
                          ? textoCaptionImagen
                          : "";

                      return (
                        <div className="wa-message-media-stack">
                          <div className="wa-single-image-wrap">
                            <img
                              src={urlArchivo}
                              alt={nombre}
                              loading="lazy"
                              decoding="async"
                              className="wa-message-image"
                              style={{
                                opacity: estado === "subiendo" ? 0.8 : 1,
                              }}
                              onClick={() =>
                                estado !== "subiendo" && abrirGaleria([urlArchivo], 0)
                              }
                            />

                            {estado === "subiendo" && (
                              <div className="wa-media-upload-overlay">
                                <button
                                  type="button"
                                  className="wa-upload-cancel-btn"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onCancelUpload?.(mensajeData.id || id);
                                  }}
                                  aria-label="Cancelar envío"
                                  title="Cancelar envío"
                                >
                                  ×
                                </button>
                              </div>
                            )}

                            {estado === "error" && (
                              <button
                                type="button"
                                className="wa-media-error-action"
                                data-tooltip={mensajeData.error_mensaje || "Se produjo un error. Haz clic para obtener más información."}
                                aria-label="Reintentar envío"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onRetryUpload?.(mensajeData.id || id);
                                }}
                              >
                                <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                              </button>
                            )}
                          </div>

                          {captionImagen && (
                            <p className="wa-image-caption break-words whitespace-pre-wrap">
                              {renderTextoConLinks(captionImagen)}
                            </p>
                          )}
                        </div>
                      );
                    }

                    if (esAudio) {
                      const audioProgress = audioDuration > 0
                        ? Math.max(0, Math.min(1, audioCurrentTime / audioDuration))
                        : 0;

                      const avatarAudio = enviadoPorMi
                        ? getAvatarUrl(miUsuario?.url_imagen)
                        : getAvatarUrl(usuario?.url_imagen);

                      const bgAudio = enviadoPorMi
                        ? miUsuario?.background || "#6c757d"
                        : usuario?.background || "#6c757d";

                      const initialAudio = enviadoPorMi
                        ? getInitial(miUsuario?.nombre || "U")
                        : getInitial(usuario?.nombre || "U");

                      const isVoiceNote = isRecordedVoiceNoteFile(mensajeData.nombre_archivo);
                      const waveform = audioWaveform?.length
                        ? audioWaveform
                        : buildAudioMessageFallbackWave(urlArchivo);
                      const elapsedOrDuration = audioPlaying || audioCurrentTime > 0
                        ? audioCurrentTime
                        : audioDuration;
                      const audioTimeLabel = formatAudioTime(elapsedOrDuration);
                      const audioPlayColor = enviadoPorMi || theme === "dark" ? "#ffffff" : "#111827";

                      const renderAudioAvatar = () => (
                        <div
                          className="wa-audio-avatar"
                          onMouseEnter={() => setShowAudioRateControl(true)}
                          onMouseLeave={() => setShowAudioRateControl(false)}
                        >
                          {showAudioRateControl ? (
                            <button
                              type="button"
                              className="wa-audio-speed-button"
                              onClick={cycleAudioPlaybackRate}
                              aria-label={`Cambiar velocidad de audio. Actual ${audioRateLabel}`}
                              title="Cambiar velocidad"
                            >
                              {audioRateLabel}
                            </button>
                          ) : (
                            <>
                              {avatarAudio ? (
                                <img
                                  src={avatarAudio}
                                  alt="avatar audio"
                                  className="wa-audio-avatar-img"
                                />
                              ) : (
                                <div
                                  className="wa-audio-avatar-initial"
                                  style={{ backgroundColor: bgAudio }}
                                >
                                  {initialAudio}
                                </div>
                              )}

                              {isVoiceNote && (
                                <span className="wa-audio-avatar-mic" aria-hidden="true">
                                  <i className="fa-solid fa-microphone" />
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      );

                      const audioProgressPercent = Math.max(0, Math.min(100, audioProgress * 100));
                      const audioPlayheadLeft = `calc(${audioProgressPercent}% + ${(0.5 - audioProgress) * AUDIO_MESSAGE_WAVE_BAR_WIDTH}px)`;
                      const audioRateLabel = audioPlaybackRate === 1 ? "1" : String(audioPlaybackRate);

                      const renderAudioWaveBars = (playedLayer = false) => waveform.map((sample, index) => {
                        const normalizedSample = clampAudioWaveLevel(sample);
                        const isDot = normalizedSample <= 0.09;
                        const height = isDot
                          ? 3
                          : Math.max(5, Math.min(26, 4 + Math.pow(normalizedSample, 0.82) * 22));

                        return (
                          <span
                            key={`audio-wave-${playedLayer ? "played" : "base"}-${index}`}
                            className={`wa-audio-wave-bar ${playedLayer ? "played" : ""} ${isDot ? "is-dot" : ""}`}
                            style={{ height: `${height}px` }}
                          />
                        );
                      });

                      const renderAudioWaveform = () => (
                        <div className="wa-audio-main">
                          <div
                            ref={progressRef}
                            onPointerDown={handleSeekAudioPointerDown}
                            className="wa-audio-waveform"
                            role="slider"
                            aria-valuemin="0"
                            aria-valuemax={Math.round(audioDuration || 0)}
                            aria-valuenow={Math.round(audioCurrentTime || 0)}
                            tabIndex={0}
                          >
                            <div className="wa-audio-wave-track" aria-hidden="true">
                              {renderAudioWaveBars(false)}
                            </div>

                            <div
                              className="wa-audio-wave-track wa-audio-wave-track-played"
                              aria-hidden="true"
                              style={{ clipPath: `inset(0 ${100 - audioProgressPercent}% 0 0)` }}
                            >
                              {renderAudioWaveBars(true)}
                            </div>

                            <span
                              className="wa-audio-playhead"
                              style={{ left: audioPlayheadLeft }}
                            />
                          </div>

                          <div className="wa-audio-times">
                            <span>{audioTimeLabel}</span>
                          </div>
                        </div>
                      );

                      return (
                        <div className={`wa-audio-player ${enviadoPorMi ? "out" : "in"} ${isVoiceNote ? "voice-note" : "audio-file"}`}>
                          <audio
                            ref={audioRef}
                            src={urlArchivo}
                            preload="metadata"
                            onLoadedMetadata={handleLoadedMetadata}
                            onDurationChange={handleLoadedMetadata}
                            onCanPlay={handleLoadedMetadata}
                            onTimeUpdate={handleTimeUpdate}
                            onPlay={() => setAudioPlaying(true)}
                            onPause={() => setAudioPlaying(false)}
                            onEnded={handleAudioEnded}
                            onError={handleAudioError}
                            style={{ display: "none" }}
                          >
                            Tu navegador no soporta audio.
                          </audio>

                          {enviadoPorMi && renderAudioAvatar()}

                          <button
                            type="button"
                            onClick={toggleAudio}
                            className="wa-audio-play"
                            style={{ color: audioPlayColor }}
                            aria-label={audioPlaying ? "Pausar audio" : "Reproducir audio"}
                          >
                            <i className={`fa-solid ${audioPlaying ? "fa-pause" : "fa-play"}`} aria-hidden="true" />
                          </button>

                          {renderAudioWaveform()}

                          {!enviadoPorMi && renderAudioAvatar()}
                        </div>
                      );
                    }

                    if (esVideo) {
                      const textoCaptionVideo = typeof mensajeData.mensaje === "string"
                        ? mensajeData.mensaje.trim()
                        : "";

                      const captionVideo =
                        mensajeData.archivo_url &&
                        textoCaptionVideo &&
                        mensajeData.mensaje !== mensajeData.archivo_url &&
                        !isOnlyMediaUrlText(textoCaptionVideo, urlArchivo)
                          ? textoCaptionVideo
                          : "";

                      return (
                        <div className="wa-message-media-stack">
                          <div className="wa-video-wrap">
                            <video
                              controls
                              playsInline
                              preload="metadata"
                              className="wa-message-video"
                            >
                              <source src={urlArchivo} type={tipo || "video/mp4"} />
                              Tu navegador no soporta video.
                            </video>
                          </div>

                          {captionVideo && (
                            <p className="wa-image-caption wa-media-caption break-words whitespace-pre-wrap">
                              {renderTextoConLinks(captionVideo)}
                            </p>
                          )}
                        </div>
                      );
                    }

                    const esArchivo =
                      !esImagen &&
                      (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|exe|msi|apk)$/i.test(
                        urlArchivo
                      ) ||
                        !!mensajeData.archivo_url ||
                        (!!tipo && !tipo.startsWith("image/")));

                    if (esArchivo) {
                      const nombreLimpio = (nombre || "").replace(/^\d+_/, "");

                      const handleDescargar = async () => {
                        try {
                          const response = await fetch(urlArchivo);
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);

                          const a = document.createElement("a");
                          a.href = url;
                          a.download = nombreLimpio;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                        } catch (error) {
                          console.error("❌ Error al descargar:", error);
                          alert("Error al intentar descargar el archivo.");
                        }
                      };

                      return (
                        <div className="flex items-center gap-2 mt-2">
                          <a
                            onClick={(e) => {
                              e.preventDefault();
                              handleDescargar();
                            }}
                            href={urlArchivo}
                            className="flex items-center justify-center bg-white text-gray-700 border border-gray-300 rounded-full shadow-sm hover:bg-gray-100 transition-all cursor-pointer"
                            style={{
                              width: "28px",
                              height: "28px",
                            }}
                            title={`Descargar ${nombreLimpio}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="feather feather-download"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </a>

                          <span
                            className="text-sm truncate"
                            style={{ maxWidth: "180px" }}
                          >
                            {nombreLimpio}
                          </span>
                        </div>
                      );
                    }
                  }

                  // 🧩 Texto normal
                  return (
                    <div className="break-words wa-rich-message">
                      {renderFormattedMessageBlocks(mensajeData.mensaje)}
                    </div>
                  );
                })()
              )}

              {/* Footer con hora + acciones pequeñas */}
              <div className="message-footer">
                {/* Deshacer es independiente del permiso eliminar_mensajes:
                    el permiso solo controla la eliminación. */}
                {mensajeData.eliminado === 1 && isMine && (
                  <button
                    type="button"
                    className="wa-undo-delete-btn"
                    aria-label="Deshacer eliminación del mensaje"
                    title="Deshacer eliminación"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeshacer(id);
                    }}
                  >
                    Deshacer
                  </button>
                )}

                {mensajeData.editado === 1 && (
                  <button
                    type="button"
                    className="btn btn-link p-0 ms-2 btn-sm p-0 text-decoration-none"
                    style={{
                      fontSize: "10px",
                      fontStyle: "italic",
                    }}
                    onClick={() => handleVerHistorial(id)}
                  >
                    Editado
                  </button>
                )}

                <span
                  className="extra-small text-muted mt-1"
                  style={{
                    fontSize: "10px",
                    alignSelf: "flex-end",
                    marginLeft: "4px",
                  }}
                >
                  {hora}
                  {isMine && (
                    <span
                      className="ms-2"
                      style={{ fontSize: "0.65rem", opacity: 0.9 }}
                    >
                      {mensajeData.visto === 0 ? (
                        <span className="svg15 double-check"></span>
                      ) : (
                        <span className="svg15 double-check-blue"></span>
                      )}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Picker reacción extra */}
        {showEmojiPickerReactions && (
          <div
            className="emoji-picker"
            style={{
              position: "absolute",
              ...(openDirection === "up"
                ? { bottom: "calc(100% + 8px)" }
                : { top: "calc(100% + 8px)" }),
              left: "50%",
              transform: isMine ? "translateX(-65%)" : "translateX(-30%)",
              zIndex: 9999,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Picker
              data={data}
              onEmojiSelect={(emoji) => handleReaction(emoji.native)}
              theme={emojiTheme}
              previewPosition="none"
              searchPosition="top"
              locale="es"
            />
          </div>
        )}

        {/* Reacciones agrupadas */}
        {reacciones.length > 0 && (
          <button
            type="button"
            className={`wa-message-reactions-summary ${enviadoPorMi ? "out" : "in"}`}
            onClick={() => {
              setSelectedEmoji("ALL");
              setShowReactionModal(true);
            }}
            aria-label={`Ver ${reacciones.length} reacciones`}
          >
            {Object.keys(
              reacciones.reduce((acc, r) => {
                acc[r.emoji] = true;
                return acc;
              }, {})
            ).map((emoji, i) => (
              <span key={i} className="wa-message-reaction-emoji">
                {emoji}
              </span>
            ))}

            <span className="wa-message-reaction-count">{reacciones.length}</span>
          </button>
        )}

        {/* Modal detalle reacciones */}
        {showReactionModal && typeof document !== "undefined" && createPortal(
          <div
            className="wa-reactions-modal-backdrop"
            onClick={() => setShowReactionModal(false)}
          >
            <div
              className="wa-reactions-modal-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="wa-reactions-modal-tabs">
                <button
                  type="button"
                  onClick={() => setSelectedEmoji("ALL")}
                  className={`wa-reactions-modal-tab ${selectedEmoji === "ALL" ? "active" : ""}`}
                >
                  Total {reacciones.length}
                </button>

                {Object.values(
                  reacciones.reduce((acc, r) => {
                    if (!acc[r.emoji]) {
                      acc[r.emoji] = { emoji: r.emoji, count: 0 };
                    }
                    acc[r.emoji].count += 1;
                    return acc;
                  }, {})
                ).map((item, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setSelectedEmoji(item.emoji)}
                    className={`wa-reactions-modal-tab ${selectedEmoji === item.emoji ? "active" : ""}`}
                  >
                    <span>{item.emoji}</span>
                    {item.count > 1 && <strong>{item.count}</strong>}
                  </button>
                ))}
              </div>

              <ul className="wa-reactions-modal-list">
                {reacciones
                  .filter(
                    (r) => selectedEmoji === "ALL" || r.emoji === selectedEmoji
                  )
                  .map((r, idx) => {
                    const isMineReaction = r.usuario_id === miUsuario?.id;
                    const avatarUrl = r.usuario?.url_imagen;
                    const bgColor = r.usuario?.background || "#6c757d";
                    const nombre = r.usuario?.nombre || "Usuario";

                    return (
                      <li key={idx} className="wa-reactions-modal-item">
                        <button
                          type="button"
                          className="wa-reactions-modal-user"
                          onClick={() => {
                            if (!isMineReaction) {
                              onVerPerfil(r.usuario);
                              setShowReactionModal(false);
                            }
                          }}
                        >
                          {avatarUrl ? (
                            <img
                              src={getAvatarUrl(avatarUrl)}
                              alt={nombre}
                              className="wa-reactions-modal-avatar"
                            />
                          ) : (
                            <span
                              className="wa-reactions-modal-avatar fallback"
                              style={{ backgroundColor: bgColor }}
                            >
                              {nombre.charAt(0).toUpperCase()}
                            </span>
                          )}

                          <span className="wa-reactions-modal-name-wrap">
                            <strong className="wa-reactions-modal-name">
                              {isMineReaction
                                ? "Tú"
                                : `${r.usuario?.nombre || ""} ${
                                    r.usuario?.apellido || ""
                                  }`}
                            </strong>
                            {isMineReaction && (
                              <small>Haz clic en el emoji para eliminarla</small>
                            )}
                          </span>
                        </button>

                        <button
                          type="button"
                          className="wa-reactions-modal-emoji"
                          onClick={() => handleReaction(r.emoji)}
                          aria-label={isMineReaction ? "Eliminar reacción" : "Reaccionar igual"}
                        >
                          {r.emoji}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          </div>,
          document.body
        )}

        {/* Modal de fijar mensaje */}
        {showFijarModal && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 5000 }}
            onClick={() => setShowFijarModal(false)}
          >
            <div
              className="bg-white rounded-4 shadow p-4"
              style={{ maxWidth: "360px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h6 className="fw-bold mb-3 text-center">Fijar mensaje</h6>
              <p className="text-muted small mb-4 text-center">
                Elige por cuánto tiempo quieres mantener este mensaje fijado.
              </p>

              <div className="d-flex flex-column gap-2 mb-4">
                {[
                  { value: "24h", label: "24 horas" },
                  { value: "7d", label: "7 días" },
                  { value: "30d", label: "30 días" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`border rounded-3 p-2 d-flex align-items-center justify-content-between ${
                      duracionFijado === opt.value ? "border-success bg-light" : ""
                    }`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDuracionFijado(opt.value)}
                  >
                    <span>{opt.label}</span>
                    {duracionFijado === opt.value && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="green"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="feather feather-check"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </label>
                ))}
              </div>

              <div className="d-flex justify-content-between">
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => setShowFijarModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => confirmarFijado()}
                >
                  Fijar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de reemplazo */}
        {showReplaceModal && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 5000 }}
            onClick={() => setShowReplaceModal(false)}
          >
            <div
              className="bg-white rounded-4 shadow p-4 text-center"
              style={{ maxWidth: "360px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h6 className="fw-bold mb-3">
                ¿Deseas reemplazar el mensaje fijado más antiguo?
              </h6>
              <p className="text-muted small mb-4">
                Tu nuevo mensaje fijado reemplazará al más antiguo.
              </p>

              <div className="d-flex justify-content-between">
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => setShowReplaceModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => confirmarReemplazo()}
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de editar */}
        {isEditing && createPortal(
          <div
            className="wa-edit-modal-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setIsEditing(false);
                setShowEmojiPickerEdit(false);
              }
            }}
          >
            <div className="wa-edit-modal-card" onMouseDown={(e) => e.stopPropagation()}>
              <div className="wa-edit-modal-header">
                <button
                  type="button"
                  className="wa-edit-modal-close"
                  aria-label="Cerrar edición"
                  onClick={() => {
                    setIsEditing(false);
                    setShowEmojiPickerEdit(false);
                  }}
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
                <div>
                  <h6>Edita el mensaje</h6>
                  <span>Actualiza el texto manteniendo estilos tipo WhatsApp</span>
                </div>
              </div>

              <div className="wa-edit-modal-preview">
                <div className="wa-edit-preview-bubble">
                  <div className="wa-rich-message">
                    {renderFormattedMessageBlocks(editText ?? editInitialText ?? mensajeData.mensaje ?? "")}
                  </div>
                  <div className="wa-edit-preview-time">
                    {hora}
                    <span className={mensajeData.visto === 0 ? "svg15 double-check" : "svg15 double-check-blue"}></span>
                  </div>
                </div>
              </div>

              <div className="wa-edit-input-row">
                <button
                  type="button"
                  className="wa-edit-emoji-btn"
                  aria-label="Elegir emoji"
                  onClick={() => setShowEmojiPickerEdit((prev) => !prev)}
                >
                  <i className="fa-regular fa-face-smile" aria-hidden="true" />
                </button>

                <div className="wa-edit-rich-input-shell">
                  <ChatInput
                    ref={editInputRef}
                    initialValue={editInitialText || mensajeData.mensaje || ""}
                    onValueChange={setEditText}
                    onSend={(nextText) => handleEditar(id, nextText)}
                    placeholder="Edita el mensaje"
                    autoFocus
                    variant="edit"
                  />
                </div>

                <button
                  type="button"
                  className="wa-edit-submit-btn"
                  aria-label="Guardar edición"
                  onClick={() => handleEditar(id, editText)}
                >
                  <i className="fa-solid fa-check" aria-hidden="true" />
                </button>
              </div>

              {showEmojiPickerEdit && (
                <div ref={emojiPickerEditRef} className="wa-edit-emoji-popover">
                  <Picker
                    data={data}
                    onEmojiSelect={(emoji) => editInputRef.current?.insertEmoji?.(emoji.native)}
                    theme={emojiTheme}
                    previewPosition="none"
                    searchPosition="top"
                    locale="es"
                  />
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

        {/* Modal historial de ediciones */}
        {showHistorial && typeof document !== "undefined" && createPortal(
          <div
            className="wa-history-modal-backdrop"
            onClick={() => setShowHistorial(false)}
          >
            <div
              className="wa-history-modal-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="wa-history-modal-header">
                <button
                  type="button"
                  className="wa-history-modal-close"
                  onClick={() => setShowHistorial(false)}
                  aria-label="Cerrar historial de ediciones"
                >
                  ←
                </button>
                <div>
                  <h6>Historial de ediciones</h6>
                  <span>Versiones anteriores del mensaje</span>
                </div>
              </div>

              <div className="wa-history-timeline">
                {historial.length === 0 ? (
                  <div className="wa-history-empty">
                    No hay ediciones registradas.
                  </div>
                ) : (
                  <div className="wa-history-list">
                    {historial.map((h, index) => {
                      const hora = formatChatTimeOnly(h.fecha);
                      const fecha = formatChatDate(h.fecha);
                      const showDate =
                        index === 0 ||
                        formatChatDate(historial[index - 1].fecha) !== fecha;

                      return (
                        <React.Fragment key={h.id}>
                          {showDate && (
                            <div className="wa-history-date-row">
                              <span className="wa-history-date-chip">{fecha}</span>
                            </div>
                          )}

                          <div className={`wa-history-message-row ${isMine ? "out" : "in"}`}>
                            <div className="wa-history-bubble">
                              <div className="wa-rich-message">
                                {renderFormattedMessageBlocks(h.texto_original)}
                              </div>

                              <div className="wa-history-message-time">
                                {hora}
                                {isMine && (
                                  <span className="ms-1">
                                    {h.visto === 0 ? (
                                      <span className="svg15 double-check"></span>
                                    ) : (
                                      <span className="svg15 double-check-blue"></span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Galería tipo WhatsApp */}
        {galeriaAbierta && galeriaImagenes.length > 0 && typeof document !== "undefined" && createPortal(
          <div
            className="wa-gallery-modal"
            onClick={() => setGaleriaAbierta(false)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGaleriaAbierta(false);
              }}
              className="wa-gallery-close"
              aria-label="Cerrar imagen"
            >
              ✕
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGaleriaZoomed((prev) => !prev);
              }}
              className="wa-gallery-zoom"
              aria-label={galeriaZoomed ? "Reducir imagen" : "Ampliar imagen"}
              title={galeriaZoomed ? "Reducir imagen" : "Ampliar imagen"}
            >
              <i
                className={`fa-solid ${galeriaZoomed ? "fa-magnifying-glass-minus" : "fa-magnifying-glass-plus"}`}
                aria-hidden="true"
              />
            </button>

            {galeriaImagenes.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setGaleriaZoomed(false);
                  setGaleriaIndice((prev) =>
                    prev - 1 < 0 ? galeriaImagenes.length - 1 : prev - 1
                  );
                }}
                className="wa-gallery-arrow wa-gallery-arrow-left"
                aria-label="Imagen anterior"
              >
                ‹
              </button>
            )}

            <img
              src={galeriaImagenes[galeriaIndice]}
              alt="vista ampliada"
              className={`wa-gallery-image ${galeriaZoomed ? "zoomed" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setGaleriaZoomed((prev) => !prev);
              }}
            />

            {galeriaImagenes.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setGaleriaZoomed(false);
                  setGaleriaIndice((prev) =>
                    (prev + 1) % galeriaImagenes.length
                  );
                }}
                className="wa-gallery-arrow wa-gallery-arrow-right"
                aria-label="Imagen siguiente"
              >
                ›
              </button>
            )}

            {galeriaImagenes.length > 1 && (
              <div className="wa-gallery-counter">
                {galeriaIndice + 1} / {galeriaImagenes.length}
              </div>
            )}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
};

export default Message;