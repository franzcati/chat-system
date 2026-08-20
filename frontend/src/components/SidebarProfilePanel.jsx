import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import toast from "react-hot-toast";
import { cambiarEstadoPresenciaSocket } from "../socket";
import { getAvatarUrl } from "../utils/url";
import { useTheme } from "../context/ThemeContext";
import TrustedDevicesModal from "./TrustedDevicesModal";

const EXPIRATION_OPTIONS = [
  { value: "never", label: "No eliminar" },
  { value: "30m", label: "30 minutos" },
  { value: "1h", label: "1 hora" },
  { value: "4h", label: "4 horas" },
  { value: "24h", label: "24 horas" },
];

const PRESENCE_OPTIONS = [
  {
    value: "online",
    label: "En línea",
    description: "Disponible para recibir mensajes.",
    icon: "fa-solid fa-circle",
    className: "online",
  },
  {
    value: "inactivo",
    label: "Inactivo",
    description: "Aparecerás como ausente.",
    icon: "fa-solid fa-moon",
    className: "idle",
  },
  {
    value: "no_molestar",
    label: "No molestar",
    description: "No recibirás notificaciones en el escritorio.",
    icon: "fa-solid fa-minus",
    className: "dnd",
  },
  {
    value: "invisible",
    label: "Invisible",
    description: "Aparecerás sin conexión.",
    icon: "fa-regular fa-circle",
    className: "offline",
  },
];

const STATUS_MAX_LENGTH = 128;
const BIO_MAX_LENGTH = 220;

const getInitial = (usuario) => {
  const text = usuario?.nombre || usuario?.correo || "U";
  return text.charAt(0).toUpperCase();
};

const getFullName = (usuario) => {
  const name = `${usuario?.nombre || ""} ${usuario?.apellido || ""}`.trim();
  return name || usuario?.correo || "Usuario";
};

const getPresenceOption = (value) => {
  const normalized = value || "online";
  return PRESENCE_OPTIONS.find((option) => option.value === normalized) || PRESENCE_OPTIONS[0];
};

const getExpirationDate = (value) => {
  if (!value || value === "never") return null;
  const minutes = value === "30m" ? 30 : value === "1h" ? 60 : value === "4h" ? 240 : 1440;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
};


const CROP_CONFIG = {
  avatar: {
    title: "Editar foto de perfil",
    helper: "Arrastra la imagen para centrarla. Usa el zoom y la rotación antes de aplicar.",
    frameWidth: 310,
    frameHeight: 310,
    outputWidth: 512,
    outputHeight: 512,
    minZoom: 1,
    maxZoom: 4,
    initialZoom: 1,
    initialFit: "cover",
  },
  cover: {
    title: "Editar cartel",
    helper: "Arrastra el cartel para elegir qué parte se verá en tu perfil.",
    frameWidth: 460,
    frameHeight: 161,
    outputWidth: 1280,
    outputHeight: 448,
    minZoom: 1,
    maxZoom: 4,
    initialZoom: 1,
    initialFit: "contain",
  },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isGifImage = (file) => file?.type === "image/gif" || /\.gif$/i.test(file?.name || "");

const normalizeCropTransform = (value, kind = "cover") => {
  const config = CROP_CONFIG[kind] || CROP_CONFIG.cover;
  let parsed = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      parsed = null;
    }
  }

  const fit = parsed?.fit === "contain" ? "contain" : parsed?.fit === "cover" ? "cover" : config.initialFit;
  const zoom = clamp(Number(parsed?.zoom) || config.initialZoom, config.minZoom, 6);
  const rotation = ((Number(parsed?.rotation) || 0) % 360 + 360) % 360;
  const offsetXRatio = clamp(Number(parsed?.offsetXRatio) || 0, -1, 1);
  const offsetYRatio = clamp(Number(parsed?.offsetYRatio) || 0, -1, 1);

  return { fit, zoom, rotation, offsetXRatio, offsetYRatio };
};

const getMediaTransformVars = (value, kind = "cover") => {
  const transform = normalizeCropTransform(value, kind);
  return {
    "--media-fit": transform.fit,
    "--media-zoom": transform.zoom,
    "--media-rotation": `${transform.rotation}deg`,
    "--media-offset-x": `${transform.offsetXRatio * 100}%`,
    "--media-offset-y": `${transform.offsetYRatio * 100}%`,
  };
};

const getCropOffsetLimits = (kind, zoom) => {
  const config = CROP_CONFIG[kind] || CROP_CONFIG.avatar;
  return {
    maxX: (config.frameWidth * Math.max(Number(zoom) - 1, 0)) / 2,
    maxY: (config.frameHeight * Math.max(Number(zoom) - 1, 0)) / 2,
  };
};

const clampCropOffset = (kind, zoom, offsetX, offsetY) => {
  const limits = getCropOffsetLimits(kind, zoom);
  return {
    offsetX: clamp(Number(offsetX) || 0, -limits.maxX, limits.maxX),
    offsetY: clamp(Number(offsetY) || 0, -limits.maxY, limits.maxY),
  };
};

const getCropTransformPayload = (editor) => {
  const config = CROP_CONFIG[editor.kind] || CROP_CONFIG.avatar;
  return {
    fit: editor.fit === "contain" ? "contain" : "cover",
    zoom: clamp(Number(editor.zoom) || config.initialZoom, config.minZoom, 6),
    rotation: ((Number(editor.rotation) || 0) % 360 + 360) % 360,
    offsetXRatio: clamp((Number(editor.offsetX) || 0) / config.frameWidth, -1, 1),
    offsetYRatio: clamp((Number(editor.offsetY) || 0) / config.frameHeight, -1, 1),
  };
};

const ProfileMedia = ({ src, transform, kind = "cover", alt = "" }) => {
  if (!src) return null;
  const normalized = normalizeCropTransform(transform, kind);
  return (
    <span className={`wa-profile-media ${normalized.fit === "contain" ? "is-contain" : "is-cover"}`} style={getMediaTransformVars(normalized, kind)}>
      {normalized.fit === "contain" && (
        <img className="wa-profile-media-bg" src={src} alt="" aria-hidden="true" draggable="false" />
      )}
      <img className="wa-profile-media-img" src={src} alt={alt} draggable="false" />
    </span>
  );
};

const getCoverImageVars = (url) => (url ? { "--profile-cover-image": `url(${url})` } : undefined);

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const hasHtmlMarkup = (value = "") => /<\/?[a-z][\s\S]*>/i.test(String(value || ""));

const plainTextFromHtml = (value = "") => {
  const text = String(value || "");
  if (typeof document === "undefined") {
    return text.replace(/<[^>]+>/g, "");
  }
  const div = document.createElement("div");
  div.innerHTML = text;
  return div.textContent || "";
};

const sanitizeCssColor = (value) => {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return "";
};

const sanitizeFontSize = (value) => {
  const text = String(value || "").trim();
  if (/^[1-7]$/.test(text)) return text;
  if (/^(0\.75|0\.875|1|1\.125|1\.25|1\.5)rem$/.test(text)) return text;
  if (/^(12|13|14|16|18|20|24)px$/.test(text)) return text;
  return "";
};

const sanitizeBioHtml = (value = "") => {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  if (typeof document === "undefined") return escapeHtml(raw).replace(/\n/g, "<br>");

  const template = document.createElement("template");
  template.innerHTML = hasHtmlMarkup(raw) ? raw : escapeHtml(raw).replace(/\n/g, "<br>");
  const allowedTags = new Set(["B", "I", "U", "S", "STRONG", "EM", "UL", "OL", "LI", "SPAN", "DIV", "P", "BR", "FONT"]);

  const cleanNode = (node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node;
    const tag = element.tagName;

    if (!allowedTags.has(tag)) {
      const parent = element.parentNode;
      if (!parent) return;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      element.remove();
      return;
    }

    const rawStyle = element.getAttribute("style") || "";
    const styleProbe = document.createElement("span");
    styleProbe.setAttribute("style", rawStyle);
    const fontWeight = String(styleProbe.style.fontWeight || "").toLowerCase();
    const fontStyle = String(styleProbe.style.fontStyle || "").toLowerCase();
    const decoration = String(styleProbe.style.textDecoration || styleProbe.style.textDecorationLine || "").toLowerCase();

    [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));

    const safeStyles = [];
    if (fontWeight === "bold" || Number(fontWeight) >= 600) safeStyles.push("font-weight: 800");
    if (fontStyle === "italic") safeStyles.push("font-style: italic");
    if (decoration.includes("underline") && decoration.includes("line-through")) {
      safeStyles.push("text-decoration-line: underline line-through");
    } else if (decoration.includes("underline")) {
      safeStyles.push("text-decoration-line: underline");
    } else if (decoration.includes("line-through")) {
      safeStyles.push("text-decoration-line: line-through");
    }
    if (safeStyles.length) element.setAttribute("style", safeStyles.join("; "));
  };

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(cleanNode);
  return template.innerHTML.trim();
};

const getRichTextLength = (value = "") => plainTextFromHtml(value).trim().length;
const renderBioHtml = (value = "") => sanitizeBioHtml(value);

const RichBioEditor = ({ value, onChange, maxLength = BIO_MAX_LENGTH }) => {
  const editorRef = useRef(null);
  const savedSelectionRef = useRef(null);
  const [plainLength, setPlainLength] = useState(getRichTextLength(value));

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    editor.innerHTML = sanitizeBioHtml(value);
    setPlainLength(getRichTextLength(value));
  }, [value]);

  const saveSelection = () => {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return;
    const editor = editorRef.current;
    if (editor && editor.contains(selection.anchorNode)) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const selection = window.getSelection?.();
    const range = savedSelectionRef.current;
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const sanitized = sanitizeBioHtml(editor.innerHTML);
    const length = getRichTextLength(sanitized);
    setPlainLength(length);
    onChange(sanitized);
  };

  const runCommand = (command) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    editor.focus();
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(command, false, null);

    if ((command === "insertUnorderedList" || command === "insertOrderedList") && !editor.querySelector("ul, ol")) {
      const lines = (editor.textContent || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const listTag = command === "insertOrderedList" ? "ol" : "ul";
      if (lines.length) {
        editor.innerHTML = `<${listTag}>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</${listTag}>`;
      }
    }

    window.setTimeout(() => {
      saveSelection();
      emitChange();
    }, 0);
  };

  const handleCommandMouseDown = (event, command) => {
    event.preventDefault();
    event.stopPropagation();
    runCommand(command);
  };

  const handleBeforeInput = (event) => {
    const incoming = event.data || "";
    if (!incoming) return;
    const selection = window.getSelection?.();
    const selectedText = selection?.toString?.() || "";
    if (plainLength - selectedText.length + incoming.length > maxLength) {
      event.preventDefault();
      toast.error(`La biografía permite máximo ${maxLength} caracteres`);
    }
  };

  const handlePaste = (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    const selection = window.getSelection?.();
    const selectedText = selection?.toString?.() || "";
    const remaining = maxLength - (plainLength - selectedText.length);
    if (remaining <= 0) return;
    document.execCommand("insertText", false, text.slice(0, remaining));
    emitChange();
  };

  return (
    <div className="wa-profile-rich-editor">
      <div className="wa-profile-rich-toolbar">
        <button type="button" onMouseDown={(event) => handleCommandMouseDown(event, "bold")} title="Negrita"><i className="fa-solid fa-bold" /></button>
        <button type="button" onMouseDown={(event) => handleCommandMouseDown(event, "italic")} title="Cursiva"><i className="fa-solid fa-italic" /></button>
        <button type="button" onMouseDown={(event) => handleCommandMouseDown(event, "underline")} title="Subrayado"><i className="fa-solid fa-underline" /></button>
        <button type="button" onMouseDown={(event) => handleCommandMouseDown(event, "strikeThrough")} title="Tachado"><i className="fa-solid fa-strikethrough" /></button>
        <span className="wa-profile-rich-divider" />
        <button type="button" onMouseDown={(event) => handleCommandMouseDown(event, "insertUnorderedList")} title="Lista de viñetas"><i className="fa-solid fa-list-ul" /></button>
        <button type="button" onMouseDown={(event) => handleCommandMouseDown(event, "insertOrderedList")} title="Lista numerada"><i className="fa-solid fa-list-ol" /></button>
      </div>
      <div
        ref={editorRef}
        className="wa-profile-bio-editor wa-profile-bio-rich-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Escribe tu biografía"
        onInput={emitChange}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onBlur={saveSelection}
        onBeforeInput={handleBeforeInput}
        onPaste={handlePaste}
      />
      <div className="wa-profile-char-count">{plainLength}/{maxLength}</div>
    </div>
  );
};


const loadImageElement = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    image.src = src;
  });

const createCroppedFile = async (editor) => {
  const config = CROP_CONFIG[editor.kind] || CROP_CONFIG.avatar;
  const image = await loadImageElement(editor.previewUrl);
  const canvas = document.createElement("canvas");
  canvas.width = config.outputWidth;
  canvas.height = config.outputHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar el editor de imagen");

  const scaleX = config.outputWidth / config.frameWidth;
  const scaleY = config.outputHeight / config.frameHeight;
  const baseScale = Math.max(config.frameWidth / image.naturalWidth, config.frameHeight / image.naturalHeight);
  const finalScale = baseScale * editor.zoom;
  const drawWidth = image.naturalWidth * finalScale;
  const drawHeight = image.naturalHeight * finalScale;

  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.translate(config.frameWidth / 2 + editor.offsetX, config.frameHeight / 2 + editor.offsetY);
  ctx.rotate((editor.rotation * Math.PI) / 180);
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();

  const mimeType = editor.file?.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
  if (!blob) throw new Error("No se pudo recortar la imagen");

  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  return new File([blob], `perfil_${editor.kind}_${Date.now()}.${extension}`, { type: mimeType });
};


const getDefaultProfileTheme = (appTheme = "light") => {
  if (appTheme === "dark") {
    return {
      primary: "#030202",
      secondary: "#1da1f2",
    };
  }

  return {
    primary: "#ffffff",
    secondary: "#aee3ff",
  };
};

const hasSavedThemeValue = (value) => /^#[0-9a-fA-F]{6}$/.test(String(value || "").trim());


const expandShortHex = (value) => {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return text;
};

const normalizeHex = (value, fallback) => {
  const text = expandShortHex(value);
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
};

const isLegacyDefaultProfileTheme = (primaryValue, secondaryValue) => {
  const primary = normalizeHex(primaryValue, "").toLowerCase();
  const secondary = normalizeHex(secondaryValue, "").toLowerCase();
  return primary === "#030202" && secondary === "#e7b5bf";
};

const hasCustomProfileTheme = (usuario) => {
  if (!usuario) return false;
  if (!hasSavedThemeValue(usuario.perfil_tema_principal) || !hasSavedThemeValue(usuario.perfil_tema_secundario)) return false;
  return !isLegacyDefaultProfileTheme(usuario.perfil_tema_principal, usuario.perfil_tema_secundario);
};

const getStoredCustomTheme = (usuario) => {
  if (!hasCustomProfileTheme(usuario)) return { primary: null, secondary: null };
  return {
    primary: usuario.perfil_tema_principal,
    secondary: usuario.perfil_tema_secundario,
  };
};

const hexToRgb = (value) => {
  const hex = normalizeHex(value, "#0f172a").replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
};

const rgbToCss = ({ r, g, b }) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

const mixRgb = (a, b, weight = 0.5) => ({
  r: a.r * (1 - weight) + b.r * weight,
  g: a.g * (1 - weight) + b.g * weight,
  b: a.b * (1 - weight) + b.b * weight,
});

const getLuminance = ({ r, g, b }) => {
  const normalize = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * normalize(r) + 0.7152 * normalize(g) + 0.0722 * normalize(b);
};

const getReadableTextForHex = (value, fallback = "#ffffff") => {
  const text = expandShortHex(value);
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return getLuminance(hexToRgb(text)) > 0.48 ? "#0f172a" : "#ffffff";
};

const buildProfileThemeVars = (primaryValue, secondaryValue) => {
  const primaryHex = normalizeHex(primaryValue, "#030202");
  const secondaryHex = normalizeHex(secondaryValue, "#aee3ff");
  const primary = hexToRgb(primaryHex);
  const secondary = hexToRgb(secondaryHex);
  const white = { r: 255, g: 255, b: 255 };
  const ink = { r: 15, g: 23, b: 42 };
  const nearBlack = { r: 7, g: 11, b: 20 };
  const primaryLightness = getLuminance(primary);
  const secondaryLightness = getLuminance(secondary);
  // El cuerpo del perfil se basa sobre todo en el color Principal. Si el
  // secundario es claro pero el principal es oscuro, el panel debe seguir
  // siendo oscuro y los textos deben quedar claros.
  const isLightTheme = primaryLightness > 0.50 || (primaryLightness > 0.38 && secondaryLightness > 0.62);

  const panelA = isLightTheme ? mixRgb(primary, white, 0.74) : mixRgb(primary, nearBlack, 0.50);
  const panelB = isLightTheme ? mixRgb(secondary, white, 0.68) : mixRgb(secondary, ink, 0.52);
  const panelC = isLightTheme ? mixRgb(mixRgb(primary, secondary, 0.52), white, 0.64) : mixRgb(mixRgb(primary, secondary, 0.52), nearBlack, 0.42);
  const statusBase = isLightTheme ? mixRgb(white, panelC, 0.12) : mixRgb(ink, panelC, 0.30);
  const statusHover = isLightTheme ? mixRgb(white, panelC, 0.04) : mixRgb(ink, panelC, 0.22);
  const statusText = getLuminance(statusBase) > 0.48 ? "#172033" : "#ffffff";
  const buttonA = isLightTheme ? mixRgb(primary, secondary, 0.38) : mixRgb(primary, secondary, 0.26);
  const buttonB = isLightTheme ? mixRgb(secondary, primary, 0.28) : mixRgb(secondary, primary, 0.34);
  const buttonAverage = mixRgb(buttonA, buttonB, 0.50);
  const borderMid = mixRgb(primary, secondary, 0.50);
  const buttonText = getLuminance(buttonAverage) > 0.48 ? "#0f172a" : "#ffffff";

  const avatarFallbackBg = rgbToCss(mixRgb(primary, secondary, 0.38));
  const avatarFallbackText = getLuminance(mixRgb(primary, secondary, 0.38)) > 0.48 ? "#0f172a" : "#ffffff";

  return {
    "--profile-primary": primaryHex,
    "--profile-secondary": secondaryHex,
    "--profile-cover-gradient": `linear-gradient(135deg, ${primaryHex} 0%, ${rgbToCss(borderMid)} 48%, ${secondaryHex} 100%)`,
    "--profile-avatar-fallback-bg": avatarFallbackBg,
    "--profile-avatar-fallback-text": avatarFallbackText,
    "--profile-text": isLightTheme ? "#172033" : "#f8fafc",
    "--profile-title": isLightTheme ? "#101827" : "#ffffff",
    "--profile-muted": isLightTheme ? "rgba(23, 32, 51, 0.72)" : "rgba(248, 250, 252, 0.74)",
    "--profile-bio": isLightTheme ? "rgba(16, 24, 39, 0.86)" : "rgba(248, 250, 252, 0.88)",
    "--profile-card-bg": `linear-gradient(145deg, ${rgbToCss(panelA)} 0%, ${rgbToCss(panelC)} 52%, ${rgbToCss(panelB)} 100%)`,
    "--profile-panel-gradient": `linear-gradient(145deg, ${rgbToCss(panelA)} 0%, ${rgbToCss(panelC)} 48%, ${rgbToCss(panelB)} 100%)`,
    "--profile-border-gradient": `linear-gradient(135deg, ${primaryHex} 0%, ${rgbToCss(borderMid)} 48%, ${secondaryHex} 100%)`,
    "--profile-button-gradient": `linear-gradient(135deg, ${rgbToCss(buttonA)} 0%, ${rgbToCss(buttonB)} 100%)`,
    "--profile-button-text": buttonText,
    "--profile-control-bg": isLightTheme ? "rgba(255, 255, 255, 0.56)" : "rgba(15, 23, 42, 0.42)",
    "--profile-control-bg-hover": isLightTheme ? "rgba(255, 255, 255, 0.76)" : "rgba(15, 23, 42, 0.62)",
    "--profile-control-border": isLightTheme ? "rgba(15, 23, 42, 0.12)" : "rgba(255, 255, 255, 0.12)",
    "--profile-glass": isLightTheme ? "rgba(255, 255, 255, 0.34)" : "rgba(255, 255, 255, 0.10)",
    "--profile-glass-strong": isLightTheme ? "rgba(255, 255, 255, 0.50)" : "rgba(255, 255, 255, 0.15)",
    "--profile-status-bg": `${rgbToCss(statusBase).replace("rgb", "rgba").replace(")", isLightTheme ? ", 0.88)" : ", 0.82)")}`,
    "--profile-status-bg-hover": `${rgbToCss(statusHover).replace("rgb", "rgba").replace(")", isLightTheme ? ", 0.96)" : ", 0.92)")}`,
    "--profile-status-text": statusText,
    "--profile-shadow": isLightTheme ? "0 22px 60px rgba(15, 23, 42, 0.22)" : "0 24px 70px rgba(2, 6, 23, 0.42)",
    "--profile-avatar-ring": isLightTheme ? "rgba(255, 255, 255, 0.78)" : "rgba(15, 23, 42, 0.88)",
    "--profile-divider": isLightTheme ? "rgba(15, 23, 42, 0.10)" : "rgba(255, 255, 255, 0.11)",
  };
};

const SidebarProfilePanel = ({ usuario, show, onClose, onLogout, onUsuarioUpdate, sidebarExpanded = false, onOpenMenu }) => {
  const { theme: appTheme } = useTheme();
  const defaultProfileTheme = useMemo(() => getDefaultProfileTheme(appTheme), [appTheme]);
  const [perfil, setPerfil] = useState(usuario || null);
  const [presenceMenuOpen, setPresenceMenuOpen] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [statusExpiration, setStatusExpiration] = useState("never");
  const [bioDraft, setBioDraft] = useState("");
  const [primaryColor, setPrimaryColor] = useState(defaultProfileTheme.primary);
  const [secondaryColor, setSecondaryColor] = useState(defaultProfileTheme.secondary);
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const [imagePicker, setImagePicker] = useState(null);
  const [cropEditor, setCropEditor] = useState(null);
  const [recentAvatars, setRecentAvatars] = useState([]);
  const [statusModalShake, setStatusModalShake] = useState(false);
  const [editModalShake, setEditModalShake] = useState(false);
  const [statusFooterExiting, setStatusFooterExiting] = useState(false);
  const [profileFooterExiting, setProfileFooterExiting] = useState(false);
  const [bioModalOpen, setBioModalOpen] = useState(false);
  const [trustedDevicesOpen, setTrustedDevicesOpen] = useState(false);
  const cropDragRef = useRef(null);

  const userId = usuario?.id;

  const currentUser = useMemo(() => ({ ...(usuario || {}), ...(perfil || {}) }), [usuario, perfil]);
  const profileName = getFullName(currentUser);
  const avatarUrl = getAvatarUrl(currentUser?.url_imagen);
  const coverUrl = getAvatarUrl(currentUser?.perfil_cartel);
  const avatarTransform = normalizeCropTransform(currentUser?.perfil_avatar_transform, "avatar");
  const coverTransform = normalizeCropTransform(currentUser?.perfil_cartel_transform, "cover");
  const statusMessage = currentUser?.perfil_estado_mensaje || "";
  const biografia = currentUser?.perfil_biografia || "";
  const shouldShowFullBioButton = getRichTextLength(biografia) > 110;
  const hasSavedProfileTheme = hasCustomProfileTheme(currentUser);
  const storedProfileTheme = getStoredCustomTheme(currentUser);
  const profilePrimary = normalizeHex(hasSavedProfileTheme ? storedProfileTheme.primary : defaultProfileTheme.primary, defaultProfileTheme.primary);
  const profileSecondary = normalizeHex(hasSavedProfileTheme ? storedProfileTheme.secondary : defaultProfileTheme.secondary, defaultProfileTheme.secondary);
  const currentPresence = getPresenceOption(
    currentUser?.estado_presencia_actual || currentUser?.estado_presencia || currentUser?.estado || "online"
  );
  const profileThemeStyle = useMemo(
    () => buildProfileThemeVars(profilePrimary, profileSecondary),
    [profilePrimary, profileSecondary]
  );
  const editThemeStyle = useMemo(
    () => buildProfileThemeVars(normalizeHex(primaryColor, defaultProfileTheme.primary), normalizeHex(secondaryColor, defaultProfileTheme.secondary)),
    [primaryColor, secondaryColor, defaultProfileTheme.primary, defaultProfileTheme.secondary]
  );
  const coverImageStyle = useMemo(() => getCoverImageVars(coverUrl) || {}, [coverUrl]);
  const avatarFallbackStyle = useMemo(() => {
    const avatarBg = sanitizeCssColor(currentUser?.background);
    const avatarText = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(avatarBg) ? getReadableTextForHex(avatarBg) : "#ffffff";
    return avatarBg ? { "--profile-avatar-fallback-bg": avatarBg, "--profile-avatar-fallback-text": avatarText } : {};
  }, [currentUser?.background]);
  const profileThemeWithCoverStyle = useMemo(
    () => ({ ...profileThemeStyle, ...avatarFallbackStyle, ...coverImageStyle }),
    [profileThemeStyle, avatarFallbackStyle, coverImageStyle]
  );
  const editThemeWithCoverStyle = useMemo(
    () => ({ ...editThemeStyle, ...avatarFallbackStyle, ...coverImageStyle }),
    [editThemeStyle, avatarFallbackStyle, coverImageStyle]
  );

  const recentAvatarStorageKey = useMemo(() => `chat_recent_avatars_${userId || "guest"}`, [userId]);


  const getSavedThemeDraft = () => {
    const storedTheme = getStoredCustomTheme(currentUser);
    return {
      primary: storedTheme.primary || defaultProfileTheme.primary,
      secondary: storedTheme.secondary || defaultProfileTheme.secondary,
    };
  };

  const resetStatusDraftToSaved = () => {
    setStatusText(currentUser?.perfil_estado_mensaje || "");
    setStatusExpiration("never");
  };

  const resetProfileDraftToSaved = () => {
    const savedTheme = getSavedThemeDraft();
    setStatusText(currentUser?.perfil_estado_mensaje || "");
    setStatusExpiration("never");
    setBioDraft(currentUser?.perfil_biografia || "");
    setPrimaryColor(savedTheme.primary);
    setSecondaryColor(savedTheme.secondary);
  };

  const hasStatusDraftChanges =
    statusText.trim() !== (currentUser?.perfil_estado_mensaje || "") || statusExpiration !== "never";

  const hasProfileDraftChanges =
    sanitizeBioHtml(bioDraft) !== sanitizeBioHtml(currentUser?.perfil_biografia || "") ||
    statusText.trim() !== (currentUser?.perfil_estado_mensaje || "") ||
    normalizeHex(primaryColor, defaultProfileTheme.primary) !== profilePrimary ||
    normalizeHex(secondaryColor, defaultProfileTheme.secondary) !== profileSecondary;

  const shakeStatusModal = () => {
    setStatusModalShake(false);
    window.requestAnimationFrame(() => setStatusModalShake(true));
    window.setTimeout(() => setStatusModalShake(false), 520);
  };

  const shakeEditModal = () => {
    setEditModalShake(false);
    window.requestAnimationFrame(() => setEditModalShake(true));
    window.setTimeout(() => setEditModalShake(false), 520);
  };

  const resetStatusDraftWithAnimation = () => {
    if (!hasStatusDraftChanges) return resetStatusDraftToSaved();
    setStatusFooterExiting(true);
    window.setTimeout(() => {
      resetStatusDraftToSaved();
      setStatusFooterExiting(false);
    }, 210);
  };

  const resetProfileDraftWithAnimation = () => {
    if (!hasProfileDraftChanges) return resetProfileDraftToSaved();
    setProfileFooterExiting(true);
    window.setTimeout(() => {
      resetProfileDraftToSaved();
      setProfileFooterExiting(false);
    }, 210);
  };

  const openStatusModal = () => {
    setPresenceMenuOpen(false);
    setStatusFooterExiting(false);
    resetStatusDraftToSaved();
    setStatusModalOpen(true);
  };

  const closeStatusModal = () => {
    if (hasStatusDraftChanges) {
      shakeStatusModal();
      return;
    }
    resetStatusDraftToSaved();
    setStatusModalOpen(false);
  };

  const openEditModal = () => {
    setPresenceMenuOpen(false);
    setProfileFooterExiting(false);
    resetProfileDraftToSaved();
    setEditOpen(true);
  };

  const closeEditModal = () => {
    if (hasProfileDraftChanges) {
      shakeEditModal();
      return;
    }
    resetProfileDraftToSaved();
    setEditOpen(false);
  };

  const mergeRecentAvatars = (items = []) => {
    const next = [];
    for (const item of items) {
      const url = typeof item === "string" ? item : item?.url || item?.url_imagen;
      if (url && !next.includes(url)) next.push(url);
      if (next.length >= 6) break;
    }
    return next;
  };

  const rememberRecentAvatar = (url) => {
    if (!url) return;
    setRecentAvatars((current) => {
      const next = mergeRecentAvatars([url, ...(current || [])]);
      try {
        localStorage.setItem(recentAvatarStorageKey, JSON.stringify(next));
      } catch (error) {}
      return next;
    });
  };

  useEffect(() => {
    if (!show || !userId) return;

    let mounted = true;
    axios
      .get(`/api/usuarios/${userId}/perfil`)
      .then((res) => {
        if (!mounted) return;
        setPerfil(res.data);
        setStatusText(res.data?.perfil_estado_mensaje || "");
        setBioDraft(res.data?.perfil_biografia || "");
        const fetchedTheme = getStoredCustomTheme(res.data);
        setPrimaryColor(fetchedTheme.primary || defaultProfileTheme.primary);
        setSecondaryColor(fetchedTheme.secondary || defaultProfileTheme.secondary);
        const storedAvatars = (() => {
          try { return JSON.parse(localStorage.getItem(recentAvatarStorageKey) || "[]"); } catch (error) { return []; }
        })();
        setRecentAvatars(mergeRecentAvatars([res.data?.url_imagen, ...(res.data?.perfil_avatares_recientes || []), ...storedAvatars]));
      })
      .catch((error) => {
        console.error("❌ Error cargando perfil:", error);
        setPerfil(usuario || null);
      });

    return () => {
      mounted = false;
    };
  }, [show, userId, defaultProfileTheme.primary, defaultProfileTheme.secondary, recentAvatarStorageKey]);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (cropEditor) closeCropEditor();
        else if (imagePicker) setImagePicker(null);
        else if (statusModalOpen) closeStatusModal();
        else if (editOpen) closeEditModal();
        else if (trustedDevicesOpen) setTrustedDevicesOpen(false);
        else if (bioModalOpen) setBioModalOpen(false);
        else onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show, cropEditor, imagePicker, statusModalOpen, editOpen, trustedDevicesOpen, bioModalOpen, onClose, closeStatusModal, closeEditModal]);

  useEffect(() => {
    return () => {
      if (cropEditor?.previewUrl) URL.revokeObjectURL(cropEditor.previewUrl);
    };
  }, [cropEditor?.previewUrl]);

  if (!show) return null;

  const renderModalPortal = (node) => {
    if (!node) return null;
    if (typeof document === "undefined") return node;
    return createPortal(node, document.body);
  };

  const syncUser = (nextUser) => {
    const merged = { ...(usuario || {}), ...(nextUser || {}) };
    setPerfil(merged);
    try {
      localStorage.setItem("usuario", JSON.stringify(merged));
    } catch (error) {}
    onUsuarioUpdate?.(merged);
  };

  const updateProfile = async (payload, successMessage = "Perfil actualizado") => {
    try {
      const res = await axios.put(`/api/usuarios/${userId}/perfil`, payload);
      syncUser(res.data?.usuario || payload);
      toast.success(successMessage);
      return res.data?.usuario;
    } catch (error) {
      console.error("❌ Error actualizando perfil:", error);
      toast.error("No se pudo actualizar el perfil");
      return null;
    }
  };

  const saveCustomStatus = async () => {
    const trimmed = statusText.trim().slice(0, STATUS_MAX_LENGTH);
    await updateProfile(
      {
        perfil_biografia: biografia,
        perfil_estado_mensaje: trimmed,
        perfil_estado_expira: getExpirationDate(statusExpiration),
        perfil_tema_principal: storedProfileTheme.primary,
        perfil_tema_secundario: storedProfileTheme.secondary,
      },
      trimmed ? "Estado actualizado" : "Estado eliminado"
    );
    setStatusText(trimmed);
    setStatusExpiration("never");
    setStatusModalOpen(false);
  };

  const clearCustomStatus = async () => {
    setStatusText("");
    await updateProfile(
      {
        perfil_biografia: biografia,
        perfil_estado_mensaje: "",
        perfil_estado_expira: null,
        perfil_tema_principal: storedProfileTheme.primary,
        perfil_tema_secundario: storedProfileTheme.secondary,
      },
      "Estado eliminado"
    );
    setStatusText("");
    setStatusExpiration("never");
  };

  const resetThemeToDefault = () => {
    setPrimaryColor(defaultProfileTheme.primary);
    setSecondaryColor(defaultProfileTheme.secondary);
    toast.success("Tema restablecido. Guarda los cambios para aplicarlo.");
  };

  const saveProfileDetails = async () => {
    await updateProfile(
      {
        perfil_biografia: sanitizeBioHtml(bioDraft),
        perfil_estado_mensaje: statusText.trim().slice(0, STATUS_MAX_LENGTH),
        perfil_estado_expira: currentUser?.perfil_estado_expira || null,
        perfil_tema_principal:
          normalizeHex(primaryColor, defaultProfileTheme.primary) === defaultProfileTheme.primary &&
          normalizeHex(secondaryColor, defaultProfileTheme.secondary) === defaultProfileTheme.secondary
            ? null
            : normalizeHex(primaryColor, defaultProfileTheme.primary),
        perfil_tema_secundario:
          normalizeHex(primaryColor, defaultProfileTheme.primary) === defaultProfileTheme.primary &&
          normalizeHex(secondaryColor, defaultProfileTheme.secondary) === defaultProfileTheme.secondary
            ? null
            : normalizeHex(secondaryColor, defaultProfileTheme.secondary),
      },
      "Cambios de perfil guardados"
    );
    setEditOpen(false);
  };

  const changePresence = async (estado) => {
    try {
      const res = await axios.put(`/api/usuarios/${userId}/estado-presencia`, { estado });
      cambiarEstadoPresenciaSocket(userId, estado);
      setPresenceMenuOpen(false);
      toast.success(`Estado cambiado a ${PRESENCE_OPTIONS.find((p) => p.value === estado)?.label || "En línea"}`);
      syncUser({ ...currentUser, estado_presencia_actual: res.data?.estado?.estado || estado });
    } catch (error) {
      console.error("❌ Error cambiando estado:", error);
      toast.error("No se pudo cambiar el estado");
    }
  };

  const uploadImage = async (kind, file, transform = null) => {
    if (!file) return false;
    const formData = new FormData();
    formData.append("imagen", file);
    if (transform) formData.append("transform", JSON.stringify(transform));
    try {
      const endpoint = kind === "avatar" ? "avatar" : "cartel";
      const res = await axios.post(`/api/usuarios/${userId}/perfil/${endpoint}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const nextUser = res.data?.usuario || {};
      syncUser(nextUser);
      if (kind === "avatar") rememberRecentAvatar(res.data?.url_imagen || nextUser?.url_imagen);
      setImagePicker(null);
      toast.success(kind === "avatar" ? "Foto de perfil actualizada" : "Cartel actualizado");
      return true;
    } catch (error) {
      console.error("❌ Error subiendo imagen:", error);
      toast.error("No se pudo subir la imagen");
      return false;
    }
  };

  const selectRecentAvatar = async (url) => {
    if (!url) return;
    try {
      const res = await axios.put(`/api/usuarios/${userId}/perfil/avatar-url`, { url_imagen: url });
      syncUser(res.data?.usuario || { url_imagen: url });
      rememberRecentAvatar(url);
      setImagePicker(null);
      toast.success("Foto de perfil actualizada");
    } catch (error) {
      console.error("❌ Error seleccionando avatar reciente:", error);
      toast.error("No se pudo cambiar la foto de perfil");
    }
  };

  const openImagePicker = (kind) => {
    setPresenceMenuOpen(false);
    setImagePicker(kind);
  };

  const closeCropEditor = () => {
    setCropEditor((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    cropDragRef.current = null;
  };

  const handleImageFileSelected = (kind, file) => {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      toast.error("Selecciona una imagen válida");
      return;
    }
    const config = CROP_CONFIG[kind] || CROP_CONFIG.avatar;
    setImagePicker(null);
    setCropEditor((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return {
        kind,
        file,
        previewUrl: URL.createObjectURL(file),
        isGif: isGifImage(file),
        fit: config.initialFit,
        zoom: config.initialZoom,
        rotation: 0,
        offsetX: 0,
        offsetY: 0,
      };
    });
  };

  const startCropDrag = (event) => {
    if (!cropEditor) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: cropEditor.offsetX,
      offsetY: cropEditor.offsetY,
    };
  };

  const moveCropDrag = (event) => {
    const drag = cropDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setCropEditor((current) => {
      if (!current) return current;
      const nextOffset = clampCropOffset(
        current.kind,
        current.zoom,
        drag.offsetX + event.clientX - drag.startX,
        drag.offsetY + event.clientY - drag.startY
      );
      return {
        ...current,
        ...nextOffset,
      };
    });
  };

  const stopCropDrag = (event) => {
    if (cropDragRef.current?.pointerId === event.pointerId) {
      cropDragRef.current = null;
    }
  };

  const zoomCrop = (value) => {
    setCropEditor((current) => {
      if (!current) return current;
      const config = CROP_CONFIG[current.kind] || CROP_CONFIG.avatar;
      const zoom = clamp(Number(value), config.minZoom, config.maxZoom);
      return { ...current, zoom, ...clampCropOffset(current.kind, zoom, current.offsetX, current.offsetY) };
    });
  };

  const rotateCrop = (degrees) => {
    setCropEditor((current) => (current ? { ...current, rotation: (current.rotation + degrees + 360) % 360 } : current));
  };

  const resetCrop = () => {
    setCropEditor((current) => {
      if (!current) return current;
      const config = CROP_CONFIG[current.kind] || CROP_CONFIG.avatar;
      return { ...current, fit: config.initialFit, zoom: config.initialZoom, rotation: 0, offsetX: 0, offsetY: 0 };
    });
  };

  const toggleCropFit = () => {
    setCropEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        fit: current.fit === "contain" ? "cover" : "contain",
        offsetX: 0,
        offsetY: 0,
      };
    });
  };

  const applyCrop = async () => {
    if (!cropEditor) return;
    try {
      const transform = getCropTransformPayload(cropEditor);
      const uploaded = await uploadImage(cropEditor.kind, cropEditor.file, transform);
      if (uploaded) closeCropEditor();
    } catch (error) {
      console.error("❌ Error recortando imagen:", error);
      toast.error("No se pudo aplicar el recorte");
    }
  };

  const deleteCover = async () => {
    try {
      const res = await axios.delete(`/api/usuarios/${userId}/perfil/cartel`);
      syncUser(res.data?.usuario || {});
      setImagePicker(null);
      toast.success("Cartel eliminado");
    } catch (error) {
      console.error("❌ Error eliminando cartel:", error);
      toast.error("No se pudo eliminar el cartel");
    }
  };

  return (
    <>
      {renderModalPortal(
        <div className={`wa-profile-popover ${sidebarExpanded ? "is-sidebar-expanded" : "is-sidebar-collapsed"}`} role="dialog" aria-label="Perfil de usuario">
        <div className="wa-profile-card" style={profileThemeWithCoverStyle}>
          <div
            className={`wa-profile-cover ${coverUrl ? "has-image" : ""}`}
            style={getCoverImageVars(coverUrl)}
          >
            {coverUrl && <ProfileMedia src={coverUrl} transform={coverTransform} kind="cover" alt="Cartel de perfil" />}
            <button type="button" className="wa-profile-close" onClick={onClose} aria-label="Cerrar">
              <i className="fa-solid fa-xmark" />
            </button>
            <button
              type="button"
              className="wa-profile-cover-edit"
              onClick={() => openImagePicker("cover")}
              title="Cambiar cartel"
            >
              <i className="fa-solid fa-pen" /> Cambiar cartel
            </button>
          </div>

          <div className="wa-profile-main">
            <div className="wa-profile-avatar-wrap">
              <button
                type="button"
                className="wa-profile-avatar"
                onClick={() => openImagePicker("avatar")}
                aria-label="Cambiar foto de perfil"
              >
                {avatarUrl ? (
                  <ProfileMedia src={avatarUrl} transform={avatarTransform} kind="avatar" alt={profileName} />
                ) : (
                  <span style={{ background: "var(--profile-avatar-fallback-bg)", color: "var(--profile-avatar-fallback-text)" }}>{getInitial(currentUser)}</span>
                )}
                <span className="wa-profile-avatar-hover">
                  <i className="fa-solid fa-pen" />
                </span>
              </button>
              <button
                type="button"
                className={`wa-profile-status-dot ${currentPresence.className}`}
                onClick={() => setPresenceMenuOpen((v) => !v)}
                title={`Cambiar estado: ${currentPresence.label}`}
              >
                <i className={currentPresence.icon} />
              </button>
            </div>

            <div className="wa-profile-status-bubble">
              <button type="button" className="wa-profile-status-text" onClick={openStatusModal}>
                {statusMessage || "Establecer tu estado"}
              </button>
              {statusMessage && (
                <div className="wa-profile-status-actions">
                  <button type="button" onClick={openStatusModal} title="Editar estado" data-tooltip="Editar">
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button type="button" onClick={clearCustomStatus} title="Eliminar estado" data-tooltip="Borrar">
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              )}
            </div>

            <h3>{profileName}</h3>
            <p className="wa-profile-userline">{currentUser?.correo || currentUser?.usuario || "Usuario"}</p>
            {biografia ? (
              <>
                <div
                  className={`wa-profile-bio wa-profile-rich-output ${shouldShowFullBioButton ? "is-truncated" : ""}`}
                  dangerouslySetInnerHTML={{ __html: renderBioHtml(biografia) }}
                />
                {shouldShowFullBioButton && (
                  <button type="button" className="wa-profile-bio-read-more" onClick={() => setBioModalOpen(true)}>
                    Ver Biografía completa
                  </button>
                )}
              </>
            ) : (
              <p className="wa-profile-bio">Añade una biografía para que otros sepan más de ti.</p>
            )}

            <div className="wa-profile-actions-card">
              <button type="button" onClick={openEditModal}>
                <i className="fa-solid fa-pen" />
                <span>Editar perfil</span>
                <i className="fa-solid fa-chevron-right" />
              </button>
              <button type="button" onClick={() => setPresenceMenuOpen((v) => !v)}>
                <i className={`${currentPresence.icon} wa-status-icon-${currentPresence.className}`} />
                <span>{currentPresence.label} / estado</span>
                <i className="fa-solid fa-chevron-right" />
              </button>
              <button type="button" onClick={() => setTrustedDevicesOpen(true)}>
                <i className="fa-solid fa-shield-halved" />
                <span>Seguridad y dispositivos</span>
                <i className="fa-solid fa-chevron-right" />
              </button>
            </div>

            <div className="wa-profile-actions-card muted">
              <button type="button" disabled>
                <i className="fa-solid fa-user-circle" />
                <span>Cambiar cuentas</span>
                <i className="fa-solid fa-chevron-right" />
              </button>
              <button type="button" disabled>
                <i className="fa-solid fa-id-card" />
                <span>Copiar ID del usuario</span>
              </button>
            </div>

            <button type="button" className="wa-profile-logout" onClick={onLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>

        {presenceMenuOpen && (
          <div className="wa-presence-menu-panel" style={profileThemeWithCoverStyle}>
            {PRESENCE_OPTIONS.map((option) => (
              <button key={option.value} type="button" onClick={() => changePresence(option.value)}>
                <span className={`wa-presence-menu-dot ${option.className}`}>
                  <i className={option.icon} />
                </span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <i className="fa-solid fa-chevron-right" />
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handleImageFileSelected("avatar", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handleImageFileSelected("cover", e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {renderModalPortal(imagePicker && (
        <div className="wa-profile-modal-backdrop wa-profile-image-picker-layer">
          <div className="wa-profile-image-picker-modal" role="dialog" aria-label="Seleccionar una imagen" style={editOpen ? editThemeWithCoverStyle : profileThemeWithCoverStyle}>
            <button type="button" className="wa-profile-modal-close" onClick={() => setImagePicker(null)}>
              <i className="fa-solid fa-xmark" />
            </button>
            <h3>Seleccionar una imagen</h3>
            <div className={`wa-profile-image-picker-grid ${imagePicker === "cover" ? "cover" : "avatar"}`}>
              <button
                type="button"
                className="wa-profile-image-picker-tile upload"
                onClick={() => (imagePicker === "avatar" ? avatarInputRef.current?.click() : coverInputRef.current?.click())}
              >
                <i className="fa-solid fa-image" />
                <span>Subir imagen</span>
              </button>
            </div>

            {imagePicker === "avatar" ? (
              <div className="wa-profile-recent-avatars">
                <h4>Avatares recientes</h4>
                <p>Accede a tus 6 avatares subidos más recientes.</p>
                <div className="wa-profile-recent-avatar-row">
                  {recentAvatars.length === 0 && <span className="wa-profile-empty-recent">Aún no tienes avatares recientes.</span>}
                  {recentAvatars.slice(0, 6).map((url) => (
                    <button key={url} type="button" onClick={() => selectRecentAvatar(url)} title="Usar avatar">
                      <img src={getAvatarUrl(url)} alt="Avatar reciente" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="wa-profile-image-picker-help">
                Sube un PNG, JPG o GIF de hasta 8 MB. Para mejor resultado usa una imagen horizontal.
              </p>
            )}
          </div>
        </div>
      ))}

      {renderModalPortal(statusModalOpen && (
        <div className="wa-profile-modal-backdrop wa-profile-status-layer">
          <div className={`wa-profile-status-modal ${statusModalShake ? "is-shaking" : ""}`} style={profileThemeWithCoverStyle}>
            <button type="button" className="wa-profile-modal-close" onClick={closeStatusModal}>
              <i className="fa-solid fa-xmark" />
            </button>
            <h3>Establecer tu estado</h3>
            <div
              className={`wa-profile-status-preview ${coverUrl ? "has-image" : ""}`}
              style={profileThemeWithCoverStyle}
            >
              <div className={`wa-profile-status-preview-cover ${coverUrl ? "has-image" : ""}`}>
                {coverUrl && <ProfileMedia src={coverUrl} transform={coverTransform} kind="cover" alt="Cartel de perfil" />}
              </div>
              <div className="wa-profile-status-preview-body">
                <div className="wa-profile-status-preview-avatar">
                  <div className="wa-profile-status-preview-avatar-clip">
                    {avatarUrl ? <ProfileMedia src={avatarUrl} transform={avatarTransform} kind="avatar" alt={profileName} /> : <span className="wa-profile-status-preview-avatar-initial">{getInitial(currentUser)}</span>}
                  </div>
                  <span className={`wa-profile-status-preview-presence-dot ${currentPresence.className}`}>
                    <i className={currentPresence.icon} />
                  </span>
                </div>
                <div className="wa-profile-status-preview-bubble">
                  <i className="fa-solid fa-cat" />
                  <span>{statusText || "Tu estado aparecerá aquí..."}</span>
                </div>
                <div className="wa-profile-status-preview-info">
                  <strong>{profileName}</strong>
                  <span>{currentUser?.correo}</span>
                </div>
              </div>
            </div>
            <label className="wa-profile-field-label">Estado</label>
            <div className="wa-profile-status-input">
              <i className="fa-solid fa-cat" />
              <textarea
                value={statusText}
                maxLength={STATUS_MAX_LENGTH}
                onChange={(e) => setStatusText(e.target.value.slice(0, STATUS_MAX_LENGTH))}
                placeholder="Escribe tu estado"
                rows={2}
              />
              {statusText && (
                <button type="button" onClick={() => setStatusText("")}>
                  <i className="fa-solid fa-circle-xmark" />
                </button>
              )}
            </div>
            <div className={`wa-profile-modal-footer ${hasStatusDraftChanges ? "has-unsaved" : ""} ${statusFooterExiting ? "is-exiting" : ""}`}>
              {hasStatusDraftChanges && <strong>¡Cuidado! ¡Tienes cambios sin guardar!</strong>}
              <select value={statusExpiration} onChange={(e) => setStatusExpiration(e.target.value)}>
                {EXPIRATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {hasStatusDraftChanges && (
                <button type="button" className="ghost" onClick={resetStatusDraftWithAnimation}>Reiniciar</button>
              )}
              <button type="button" onClick={saveCustomStatus}>Guardar</button>
            </div>
          </div>
        </div>
      ))}

      {renderModalPortal(editOpen && (
        <div className="wa-profile-modal-backdrop wa-profile-edit-layer">
          <div className={`wa-profile-edit-modal wa-profile-edit-modal-mobile-ready ${editModalShake ? "is-shaking" : ""}`} style={editThemeWithCoverStyle}>
            <button type="button" className="wa-profile-modal-close" onClick={closeEditModal}>
              <i className="fa-solid fa-xmark" />
            </button>
            <h3>Editar perfil</h3>
            <div className="wa-profile-edit-grid">
              <section>
                <h4>Cartel de perfil</h4>
                <div className="wa-profile-edit-buttons">
                  <button type="button" onClick={() => openImagePicker("cover")}>Cambiar cartel</button>
                  <button type="button" className="secondary" onClick={deleteCover}>Eliminar cartel</button>
                </div>
                <h4>Tema de perfil</h4>
                <div className="wa-profile-theme-controls">
                  <div className="wa-profile-theme-row">
                    <label style={{ backgroundColor: primaryColor }}>
                      <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                      <i className="fa-solid fa-pen" />
                      <span>Principal</span>
                    </label>
                    <label style={{ backgroundColor: secondaryColor }}>
                      <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
                      <i className="fa-solid fa-pen" />
                      <span>Secundario</span>
                    </label>
                  </div>
                  <button type="button" className="wa-profile-theme-reset" onClick={resetThemeToDefault}>
                    <i className="fa-solid fa-rotate-left" /> Restablecer
                  </button>
                </div>
                <h4>Información</h4>
                <p className="wa-profile-help">Puedes usar texto corto para tu biografía.</p>
                <RichBioEditor value={bioDraft} onChange={setBioDraft} maxLength={BIO_MAX_LENGTH} />
              </section>
              <section>
                <h4>Previsualizar</h4>
                <div className="wa-profile-preview-card" style={editThemeWithCoverStyle}>
                  <div
                    className={`wa-profile-preview-cover-area ${coverUrl ? "has-image" : ""}`}
                    style={getCoverImageVars(coverUrl)}
                  >
                    {coverUrl && <ProfileMedia src={coverUrl} transform={coverTransform} kind="cover" alt="Cartel de perfil" />}
                    <button type="button" className="wa-profile-preview-cover" onClick={() => openImagePicker("cover")}>
                      <i className="fa-solid fa-pen" /> Cambiar cartel
                    </button>
                  </div>
                  <div className="wa-profile-preview-body">
                    <div className="wa-profile-preview-avatar">
                      {avatarUrl ? <ProfileMedia src={avatarUrl} transform={avatarTransform} kind="avatar" alt={profileName} /> : <span>{getInitial(currentUser)}</span>}
                      <span className={`wa-profile-preview-presence-dot ${currentPresence.className}`}>
                        <i className={currentPresence.icon} />
                      </span>
                      <button type="button" className="wa-profile-preview-avatar-edit" onClick={() => openImagePicker("avatar")} aria-label="Cambiar foto de perfil">
                        <i className="fa-solid fa-pen" />
                      </button>
                    </div>
                    <div className="wa-profile-preview-status">
                      <i className="fa-solid fa-cat" />
                      <span>{statusText || statusMessage || "Establecer tu estado"}</span>
                      <div className="wa-profile-status-actions wa-profile-preview-status-actions">
                        <button type="button" onClick={openStatusModal} title="Editar" data-tooltip="Editar">
                          <i className="fa-solid fa-pen" />
                        </button>
                        <button type="button" onClick={() => setStatusText("")} title="Borrar" data-tooltip="Borrar">
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </div>
                    <strong>{profileName}</strong>
                    <span>{currentUser?.correo}</span>
                    {bioDraft ? (
                      <div className="wa-profile-preview-bio wa-profile-rich-output" dangerouslySetInnerHTML={{ __html: renderBioHtml(bioDraft) }} />
                    ) : (
                      <p className="wa-profile-preview-empty-bio">Añade tu biografía!</p>
                    )}
                    <button type="button" className="wa-profile-preview-sample">Botón de ejemplo</button>
                  </div>
                </div>
              </section>
            </div>
            <div className={`wa-profile-edit-footer ${hasProfileDraftChanges ? "has-unsaved" : ""} ${profileFooterExiting ? "is-exiting" : ""}`}>
              {hasProfileDraftChanges ? (
                <>
                  <strong>¡Cuidado! ¡Tienes cambios sin guardar!</strong>
                  <button type="button" className="ghost" onClick={resetProfileDraftWithAnimation}>Reiniciar</button>
                  <button type="button" onClick={saveProfileDetails}>Guardar cambios</button>
                </>
              ) : (
                <>
                  <button type="button" className="secondary" onClick={closeEditModal}>Cancelar</button>
                  <button type="button" onClick={saveProfileDetails}>Guardar cambios</button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {renderModalPortal(bioModalOpen && (
        <div className="wa-profile-modal-backdrop wa-profile-bio-full-layer">
          <div className="wa-profile-bio-full-modal" role="dialog" aria-label="Biografía completa" style={profileThemeWithCoverStyle}>
            <button type="button" className="wa-profile-modal-close" onClick={() => setBioModalOpen(false)} aria-label="Cerrar biografía">
              <i className="fa-solid fa-xmark" />
            </button>
            <div className="wa-profile-bio-full-card">
              <div className={`wa-profile-bio-full-cover ${coverUrl ? "has-image" : ""}`} style={getCoverImageVars(coverUrl)}>
                {coverUrl && <ProfileMedia src={coverUrl} transform={coverTransform} kind="cover" alt="Cartel de perfil" />}
              </div>
              <div className="wa-profile-bio-full-body">
                <div className="wa-profile-bio-full-avatar">
                  {avatarUrl ? <ProfileMedia src={avatarUrl} transform={avatarTransform} kind="avatar" alt={profileName} /> : <span>{getInitial(currentUser)}</span>}
                  <span className={`wa-profile-preview-presence-dot ${currentPresence.className}`}>
                    <i className={currentPresence.icon} />
                  </span>
                </div>
                {statusMessage && (
                  <div className="wa-profile-bio-full-status">
                    <i className="fa-solid fa-cat" />
                    <span>{statusMessage}</span>
                  </div>
                )}
                <h3>{profileName}</h3>
                <p className="wa-profile-userline">{currentUser?.correo || currentUser?.usuario || "Usuario"}</p>
                <div className="wa-profile-bio-full-scroll wa-profile-rich-output" dangerouslySetInnerHTML={{ __html: renderBioHtml(biografia) }} />
                <button type="button" className="wa-profile-bio-full-logout" onClick={onLogout}>Cerrar sesión</button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {renderModalPortal(trustedDevicesOpen && (
        <TrustedDevicesModal
          usuarioId={userId}
          onClose={() => setTrustedDevicesOpen(false)}
        />
      ))}

      {renderModalPortal(cropEditor && (() => {
        const config = CROP_CONFIG[cropEditor.kind] || CROP_CONFIG.avatar;
        return (
          <div className="wa-profile-modal-backdrop wa-profile-crop-layer">
            <div className="wa-profile-crop-modal" role="dialog" aria-label={config.title} style={editOpen ? editThemeWithCoverStyle : profileThemeWithCoverStyle}>
              <button type="button" className="wa-profile-modal-close" onClick={closeCropEditor}>
                <i className="fa-solid fa-xmark" />
              </button>
              <h3>{config.title}</h3>
              <p>{config.helper}</p>

              <div
                className={`wa-profile-crop-stage ${cropEditor.kind}`}
                style={{
                  "--crop-frame-width": `${config.frameWidth}px`,
                  "--crop-frame-aspect": `${config.frameWidth} / ${config.frameHeight}`,
                }}
                onPointerDown={startCropDrag}
                onPointerMove={moveCropDrag}
                onPointerUp={stopCropDrag}
                onPointerCancel={stopCropDrag}
                onWheel={(event) => {
                  event.preventDefault();
                  const nextZoom = cropEditor.zoom + (event.deltaY > 0 ? -0.08 : 0.08);
                  zoomCrop(Number(nextZoom.toFixed(2)));
                }}
              >
                <img
                  className="wa-profile-crop-stage-bg"
                  src={cropEditor.previewUrl}
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                />
                <img
                  className="wa-profile-crop-stage-img"
                  src={cropEditor.previewUrl}
                  alt="Imagen seleccionada"
                  draggable="false"
                  style={{
                    objectFit: cropEditor.fit === "contain" ? "contain" : "cover",
                    left: `calc(50% + ${cropEditor.offsetX}px)`,
                    top: `calc(50% + ${cropEditor.offsetY}px)`,
                    transform: `translate(-50%, -50%) rotate(${cropEditor.rotation}deg) scale(${cropEditor.zoom})`,
                  }}
                />
              </div>

              <div className="wa-profile-crop-toolbar">
                <button type="button" onClick={() => rotateCrop(-90)} title="Rotar a la izquierda">
                  <i className="fa-solid fa-rotate-left" />
                </button>
                <button type="button" className="wa-profile-crop-fit" onClick={toggleCropFit} title="Cambiar ajuste">
                  {cropEditor.fit === "contain" ? "Completo" : "Cubrir"}
                </button>
                <label>
                  <i className="fa-solid fa-image" />
                  <input
                    type="range"
                    min={config.minZoom}
                    max={config.maxZoom}
                    step="0.01"
                    value={cropEditor.zoom}
                    onChange={(event) => zoomCrop(event.target.value)}
                  />
                  <i className="fa-solid fa-image portrait" />
                </label>
                <button type="button" onClick={() => rotateCrop(90)} title="Rotar a la derecha">
                  <i className="fa-solid fa-rotate-right" />
                </button>
              </div>

              <div className="wa-profile-crop-footer">
                <button type="button" className="ghost" onClick={resetCrop}>Reiniciar</button>
                <span />
                <button type="button" className="secondary" onClick={closeCropEditor}>Cancelar</button>
                <button type="button" onClick={applyCrop}>Aplicar</button>
              </div>
            </div>
          </div>
        );
      })())}
    </>
  );
};

export default SidebarProfilePanel;
