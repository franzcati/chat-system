import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getAvatarUrl } from "../utils/url";
import { useTheme } from "../context/ThemeContext";

const PRESENCE_OPTIONS = [
  { value: "online", icon: "fa-solid fa-circle", className: "online" },
  { value: "inactivo", icon: "fa-solid fa-moon", className: "idle" },
  { value: "no_molestar", icon: "fa-solid fa-minus", className: "dnd" },
  { value: "invisible", icon: "fa-regular fa-circle", className: "offline" },
];

const CROP_CONFIG = {
  avatar: { initialFit: "cover", initialZoom: 1, minZoom: 1 },
  cover: { initialFit: "contain", initialZoom: 1, minZoom: 1 },
};

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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const hasSavedThemeValue = (value) => /^#[0-9a-fA-F]{6}$/.test(String(value || "").trim());

const sanitizeCssColor = (value) => {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return "";
};

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

const hexToRgb = (value) => {
  const hex = normalizeHex(value, "#0f172a").replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
};

const rgbToCss = ({ r, g, b }) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

const getReadableTextForHex = (value, fallback = "#ffffff") => {
  const text = expandShortHex(value);
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return fallback;
  return getLuminance(hexToRgb(text)) > 0.48 ? "#0f172a" : "#ffffff";
};

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

const getDefaultProfileTheme = (appTheme = "light") => {
  if (appTheme === "dark") {
    return { primary: "#030202", secondary: "#1da1f2" };
  }

  return { primary: "#ffffff", secondary: "#aee3ff" };
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

const buildProfileThemeVars = (primaryValue, secondaryValue) => {
  const primaryHex = normalizeHex(primaryValue, "#ffffff");
  const secondaryHex = normalizeHex(secondaryValue, "#aee3ff");
  const primary = hexToRgb(primaryHex);
  const secondary = hexToRgb(secondaryHex);
  const white = { r: 255, g: 255, b: 255 };
  const ink = { r: 15, g: 23, b: 42 };
  const nearBlack = { r: 7, g: 11, b: 20 };
  const primaryLightness = getLuminance(primary);
  const secondaryLightness = getLuminance(secondary);
  const isLightTheme = primaryLightness > 0.5 || (primaryLightness > 0.38 && secondaryLightness > 0.62);

  const panelA = isLightTheme ? mixRgb(primary, white, 0.74) : mixRgb(primary, nearBlack, 0.5);
  const panelB = isLightTheme ? mixRgb(secondary, white, 0.68) : mixRgb(secondary, ink, 0.52);
  const panelC = isLightTheme
    ? mixRgb(mixRgb(primary, secondary, 0.52), white, 0.64)
    : mixRgb(mixRgb(primary, secondary, 0.52), nearBlack, 0.42);
  const statusBase = isLightTheme ? mixRgb(white, panelC, 0.12) : mixRgb(ink, panelC, 0.3);
  const statusHover = isLightTheme ? mixRgb(white, panelC, 0.04) : mixRgb(ink, panelC, 0.22);
  const statusText = getLuminance(statusBase) > 0.48 ? "#172033" : "#ffffff";
  const buttonA = isLightTheme ? mixRgb(primary, secondary, 0.38) : mixRgb(primary, secondary, 0.26);
  const buttonB = isLightTheme ? mixRgb(secondary, primary, 0.28) : mixRgb(secondary, primary, 0.34);
  const buttonAverage = mixRgb(buttonA, buttonB, 0.5);
  const borderMid = mixRgb(primary, secondary, 0.5);
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

const ProfileMedia = ({ src, transform, kind = "cover", alt = "" }) => {
  if (!src) return null;
  const normalized = normalizeCropTransform(transform, kind);
  return (
    <span className={`wa-profile-media ${normalized.fit === "contain" ? "is-contain" : "is-cover"}`} style={getMediaTransformVars(normalized, kind)}>
      {normalized.fit === "contain" && <img className="wa-profile-media-bg" src={src} alt="" aria-hidden="true" draggable="false" />}
      <img className="wa-profile-media-img" src={src} alt={alt} draggable="false" />
    </span>
  );
};

const preloadImage = (src) =>
  new Promise((resolve) => {
    if (!src || typeof Image === "undefined") {
      resolve();
      return;
    }

    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;

    if (image.complete) resolve();
  });

const preloadProfileMedia = (profile) => {
  const urls = [getAvatarUrl(profile?.url_imagen), getAvatarUrl(profile?.perfil_cartel)].filter(Boolean);

  if (!urls.length) return Promise.resolve();

  return Promise.all(urls.map(preloadImage)).then(() => undefined);
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const hasHtmlMarkup = (value = "") => /<\/?[a-z][\s\S]*>/i.test(String(value || ""));

const sanitizeBioHtml = (value = "") => {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  if (typeof document === "undefined") return escapeHtml(raw).replace(/\n/g, "<br>");

  const template = document.createElement("template");
  template.innerHTML = hasHtmlMarkup(raw) ? raw : escapeHtml(raw).replace(/\n/g, "<br>");
  const allowedTags = new Set(["B", "I", "U", "S", "STRONG", "EM", "UL", "OL", "LI", "SPAN", "DIV", "P", "BR"]);

  const cleanNode = (node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node;

    if (!allowedTags.has(element.tagName)) {
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
    if (decoration.includes("underline") && decoration.includes("line-through")) safeStyles.push("text-decoration-line: underline line-through");
    else if (decoration.includes("underline")) safeStyles.push("text-decoration-line: underline");
    else if (decoration.includes("line-through")) safeStyles.push("text-decoration-line: line-through");
    if (safeStyles.length) element.setAttribute("style", safeStyles.join("; "));
  };

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(cleanNode);
  return template.innerHTML.trim();
};

const getCoverImageVars = (url) => (url ? { "--profile-cover-image": `url(${url})` } : {});

const ProfileModal = ({ usuario, miUsuario, show, onClose, onLogout, onEnviarMensaje }) => {
  const { theme: appTheme } = useTheme();
  const defaultTheme = useMemo(() => getDefaultProfileTheme(appTheme), [appTheme]);
  const [perfilCompleto, setPerfilCompleto] = useState(null);
  const [perfilPreparado, setPerfilPreparado] = useState({ id: null, listo: false });

  useEffect(() => {
    if (!show || !usuario?.id) {
      setPerfilCompleto(null);
      setPerfilPreparado({ id: null, listo: false });
      return undefined;
    }

    let activo = true;
    const usuarioId = usuario.id;

    setPerfilCompleto(null);
    setPerfilPreparado({ id: usuarioId, listo: false });

    axios
      .get(`/api/usuarios/${usuarioId}/perfil`)
      .then(async (res) => {
        const datosPerfil = res.data || null;
        await preloadProfileMedia({ ...(usuario || {}), ...(datosPerfil || {}) });

        if (activo) {
          setPerfilCompleto(datosPerfil);
          setPerfilPreparado({ id: usuarioId, listo: true });
        }
      })
      .catch(async () => {
        await preloadProfileMedia(usuario || {});

        if (activo) {
          setPerfilCompleto(null);
          setPerfilPreparado({ id: usuarioId, listo: true });
        }
      });

    return () => {
      activo = false;
    };
  }, [show, usuario?.id]);

  const perfilVisible = useMemo(
    () => ({ ...(usuario || {}), ...(perfilCompleto || {}) }),
    [usuario, perfilCompleto]
  );

  const themeStyle = useMemo(() => {
    const hasCustomTheme = hasCustomProfileTheme(perfilVisible);
    const primary = hasCustomTheme ? perfilVisible.perfil_tema_principal : defaultTheme.primary;
    const secondary = hasCustomTheme ? perfilVisible.perfil_tema_secundario : defaultTheme.secondary;
    const avatarBg = sanitizeCssColor(perfilVisible?.background);
    const avatarText = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(avatarBg) ? getReadableTextForHex(avatarBg) : "#ffffff";

    return {
      ...buildProfileThemeVars(primary, secondary),
      ...(avatarBg ? { "--profile-avatar-fallback-bg": avatarBg, "--profile-avatar-fallback-text": avatarText } : {}),
    };
  }, [
    perfilVisible?.perfil_tema_principal,
    perfilVisible?.perfil_tema_secundario,
    perfilVisible?.background,
    defaultTheme.primary,
    defaultTheme.secondary,
  ]);

  if (!show || !usuario) return null;
  if (!perfilPreparado.listo || perfilPreparado.id !== usuario.id) return null;

  const esMiPerfil = perfilVisible?.id === miUsuario?.id;
  const profileName = getFullName(perfilVisible);
  const avatarUrl = getAvatarUrl(perfilVisible?.url_imagen);
  const coverUrl = getAvatarUrl(perfilVisible?.perfil_cartel);
  const avatarTransform = normalizeCropTransform(perfilVisible?.perfil_avatar_transform, "avatar");
  const coverTransform = normalizeCropTransform(perfilVisible?.perfil_cartel_transform, "cover");
  const statusMessage = perfilVisible?.perfil_estado_mensaje || "";
  const biografia = perfilVisible?.perfil_biografia || "";
  const currentPresence = getPresenceOption(perfilVisible?.estado_presencia_actual || perfilVisible?.estado_presencia || perfilVisible?.estado || "online");
  const mergedStyle = { ...themeStyle, ...getCoverImageVars(coverUrl) };

  const handleMainAction = () => {
    if (esMiPerfil) {
      onLogout?.();
      return;
    }
    onEnviarMensaje?.(perfilVisible);
    onClose?.();
  };

  return (
    <div className="wa-profile-modal-backdrop wa-profile-bio-full-layer wa-user-profile-layer" role="presentation">
      <div className="wa-profile-bio-full-modal wa-user-profile-modal" role="dialog" aria-label={`Perfil de ${profileName}`} style={mergedStyle}>
        <button type="button" className="wa-profile-modal-close" onClick={onClose} aria-label="Cerrar perfil">
          <i className="fa-solid fa-xmark" />
        </button>
        <div className="wa-profile-bio-full-card wa-user-profile-card">
          <div className={`wa-profile-bio-full-cover ${coverUrl ? "has-image" : ""}`} style={getCoverImageVars(coverUrl)}>
            {coverUrl && <ProfileMedia src={coverUrl} transform={coverTransform} kind="cover" alt="Cartel de perfil" />}
          </div>
          <div className="wa-profile-bio-full-body">
            <div className="wa-profile-bio-full-avatar">
              {avatarUrl ? <ProfileMedia src={avatarUrl} transform={avatarTransform} kind="avatar" alt={profileName} /> : <span>{getInitial(perfilVisible)}</span>}
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
            <p className="wa-profile-userline">{perfilVisible?.correo || perfilVisible?.usuario || "Usuario"}</p>
            <div
              className={`wa-profile-bio-full-scroll wa-profile-rich-output ${!biografia ? "is-empty" : ""}`}
              dangerouslySetInnerHTML={{ __html: biografia ? sanitizeBioHtml(biografia) : "<em>Añade tu biografía!</em>" }}
            />
            <button type="button" className="wa-profile-bio-full-logout" onClick={handleMainAction}>
              {esMiPerfil ? "Cerrar sesión" : "Enviar mensaje"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
