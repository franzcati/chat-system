import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { cambiarEstadoPresenciaSocket } from "../socket";
import { getAvatarUrl } from "../utils/url";
import { useTheme } from "../context/ThemeContext";

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


const getDefaultProfileTheme = (isDark) => ({
  primary: isDark ? "#2f8ee8" : "#2f96f2",
  secondary: isDark ? "#0b2a44" : "#bfe7ff",
});

const hasSavedThemeValue = (value) => /^#[0-9a-fA-F]{6}$/.test(String(value || "").trim());

const normalizeHex = (value, fallback) => {
  const text = String(value || "").trim();
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

const buildProfileThemeVars = (primaryValue, secondaryValue) => {
  const primaryHex = normalizeHex(primaryValue, "#030202");
  const secondaryHex = normalizeHex(secondaryValue, "#e7b5bf");
  const primary = hexToRgb(primaryHex);
  const secondary = hexToRgb(secondaryHex);
  const white = { r: 255, g: 255, b: 255 };
  const ink = { r: 15, g: 23, b: 42 };
  const nearBlack = { r: 7, g: 11, b: 20 };
  const averageLight = (getLuminance(primary) + getLuminance(secondary)) / 2;
  const isLightTheme = averageLight > 0.34;

  const panelA = isLightTheme ? mixRgb(primary, white, 0.74) : mixRgb(primary, nearBlack, 0.50);
  const panelB = isLightTheme ? mixRgb(secondary, white, 0.68) : mixRgb(secondary, ink, 0.52);
  const panelC = isLightTheme ? mixRgb(mixRgb(primary, secondary, 0.52), white, 0.64) : mixRgb(mixRgb(primary, secondary, 0.52), nearBlack, 0.42);
  const statusBase = isLightTheme ? mixRgb(white, panelC, 0.12) : mixRgb(ink, panelC, 0.30);
  const statusHover = isLightTheme ? mixRgb(white, panelC, 0.04) : mixRgb(ink, panelC, 0.22);
  const buttonA = isLightTheme ? mixRgb(primary, secondary, 0.38) : mixRgb(primary, secondary, 0.26);
  const buttonB = isLightTheme ? mixRgb(secondary, primary, 0.28) : mixRgb(secondary, primary, 0.34);
  const borderMid = mixRgb(primary, secondary, 0.50);

  return {
    "--profile-primary": primaryHex,
    "--profile-secondary": secondaryHex,
    "--profile-text": isLightTheme ? "#172033" : "#f8fafc",
    "--profile-title": isLightTheme ? "#101827" : "#ffffff",
    "--profile-muted": isLightTheme ? "rgba(23, 32, 51, 0.72)" : "rgba(248, 250, 252, 0.74)",
    "--profile-bio": isLightTheme ? "rgba(16, 24, 39, 0.86)" : "rgba(248, 250, 252, 0.88)",
    "--profile-card-bg": `linear-gradient(145deg, ${rgbToCss(panelA)} 0%, ${rgbToCss(panelC)} 52%, ${rgbToCss(panelB)} 100%)`,
    "--profile-panel-gradient": `linear-gradient(145deg, ${rgbToCss(panelA)} 0%, ${rgbToCss(panelC)} 48%, ${rgbToCss(panelB)} 100%)`,
    "--profile-border-gradient": `linear-gradient(135deg, ${primaryHex} 0%, ${rgbToCss(borderMid)} 48%, ${secondaryHex} 100%)`,
    "--profile-button-gradient": `linear-gradient(135deg, ${rgbToCss(buttonA)} 0%, ${rgbToCss(buttonB)} 100%)`,
    "--profile-glass": isLightTheme ? "rgba(255, 255, 255, 0.34)" : "rgba(255, 255, 255, 0.10)",
    "--profile-glass-strong": isLightTheme ? "rgba(255, 255, 255, 0.50)" : "rgba(255, 255, 255, 0.15)",
    "--profile-status-bg": `${rgbToCss(statusBase).replace("rgb", "rgba").replace(")", isLightTheme ? ", 0.88)" : ", 0.82)")}`,
    "--profile-status-bg-hover": `${rgbToCss(statusHover).replace("rgb", "rgba").replace(")", isLightTheme ? ", 0.96)" : ", 0.92)")}`,
    "--profile-status-text": isLightTheme ? "#172033" : "#ffffff",
    "--profile-shadow": isLightTheme ? "0 22px 60px rgba(15, 23, 42, 0.22)" : "0 24px 70px rgba(2, 6, 23, 0.42)",
    "--profile-avatar-ring": isLightTheme ? "rgba(255, 255, 255, 0.78)" : "rgba(15, 23, 42, 0.88)",
    "--profile-divider": isLightTheme ? "rgba(15, 23, 42, 0.10)" : "rgba(255, 255, 255, 0.11)",
  };
};

const SidebarProfilePanel = ({ usuario, show, onClose, onLogout, onUsuarioUpdate }) => {
  const { isDark } = useTheme();
  const defaultProfileTheme = useMemo(() => getDefaultProfileTheme(isDark), [isDark]);
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
  const [recentAvatars, setRecentAvatars] = useState([]);

  const userId = usuario?.id;

  const currentUser = useMemo(() => ({ ...(usuario || {}), ...(perfil || {}) }), [usuario, perfil]);
  const profileName = getFullName(currentUser);
  const avatarUrl = getAvatarUrl(currentUser?.url_imagen);
  const coverUrl = getAvatarUrl(currentUser?.perfil_cartel);
  const statusMessage = currentUser?.perfil_estado_mensaje || "";
  const biografia = currentUser?.perfil_biografia || "";
  const hasSavedProfileTheme = hasSavedThemeValue(currentUser?.perfil_tema_principal) && hasSavedThemeValue(currentUser?.perfil_tema_secundario);
  const profilePrimary = normalizeHex(hasSavedProfileTheme ? currentUser?.perfil_tema_principal : defaultProfileTheme.primary, defaultProfileTheme.primary);
  const profileSecondary = normalizeHex(hasSavedProfileTheme ? currentUser?.perfil_tema_secundario : defaultProfileTheme.secondary, defaultProfileTheme.secondary);
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

  const recentAvatarStorageKey = useMemo(() => `chat_recent_avatars_${userId || "guest"}`, [userId]);

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
        setPrimaryColor(hasSavedThemeValue(res.data?.perfil_tema_principal) ? res.data.perfil_tema_principal : defaultProfileTheme.primary);
        setSecondaryColor(hasSavedThemeValue(res.data?.perfil_tema_secundario) ? res.data.perfil_tema_secundario : defaultProfileTheme.secondary);
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
        if (statusModalOpen) setStatusModalOpen(false);
        else if (editOpen) setEditOpen(false);
        else onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show, statusModalOpen, editOpen, onClose]);

  if (!show) return null;

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
    const trimmed = statusText.trim();
    await updateProfile(
      {
        perfil_biografia: bioDraft,
        perfil_estado_mensaje: trimmed,
        perfil_estado_expira: getExpirationDate(statusExpiration),
        perfil_tema_principal: primaryColor,
        perfil_tema_secundario: secondaryColor,
      },
      trimmed ? "Estado actualizado" : "Estado eliminado"
    );
    setStatusModalOpen(false);
  };

  const clearCustomStatus = async () => {
    setStatusText("");
    await updateProfile(
      {
        perfil_biografia: bioDraft,
        perfil_estado_mensaje: "",
        perfil_estado_expira: null,
        perfil_tema_principal: primaryColor,
        perfil_tema_secundario: secondaryColor,
      },
      "Estado eliminado"
    );
  };

  const resetThemeToDefault = () => {
    setPrimaryColor(defaultProfileTheme.primary);
    setSecondaryColor(defaultProfileTheme.secondary);
    toast.success("Tema restablecido. Guarda los cambios para aplicarlo.");
  };

  const saveProfileDetails = async () => {
    await updateProfile(
      {
        perfil_biografia: bioDraft,
        perfil_estado_mensaje: statusText,
        perfil_estado_expira: currentUser?.perfil_estado_expira || null,
        perfil_tema_principal: normalizeHex(primaryColor, defaultProfileTheme.primary),
        perfil_tema_secundario: normalizeHex(secondaryColor, defaultProfileTheme.secondary),
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

  const uploadImage = async (kind, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("imagen", file);
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
    } catch (error) {
      console.error("❌ Error subiendo imagen:", error);
      toast.error("No se pudo subir la imagen");
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
    setImagePicker(kind);
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
      <div className="wa-profile-popover" role="dialog" aria-label="Perfil de usuario">
        <div className="wa-profile-card" style={profileThemeStyle}>
          <div
            className={`wa-profile-cover ${coverUrl ? "has-image" : ""}`}
            style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
          >
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
                title="Cambiar foto de perfil"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={profileName} />
                ) : (
                  <span style={{ backgroundColor: currentUser?.background || "#2787f5" }}>{getInitial(currentUser)}</span>
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
              <button type="button" className="wa-profile-status-text" onClick={() => setStatusModalOpen(true)}>
                {statusMessage || "Establecer tu estado"}
              </button>
              {statusMessage && (
                <div className="wa-profile-status-actions">
                  <button type="button" onClick={() => setStatusModalOpen(true)} title="Editar estado" data-tooltip="Editar">
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
            <p className="wa-profile-bio">{biografia || "Añade una biografía para que otros sepan más de ti."}</p>

            <div className="wa-profile-actions-card">
              <button type="button" onClick={() => setEditOpen(true)}>
                <i className="fa-solid fa-pen" />
                <span>Editar perfil</span>
                <i className="fa-solid fa-chevron-right" />
              </button>
              <button type="button" onClick={() => setPresenceMenuOpen((v) => !v)}>
                <i className={`${currentPresence.icon} wa-status-icon-${currentPresence.className}`} />
                <span>{currentPresence.label} / estado</span>
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
          <div className="wa-presence-menu-panel">
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

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => uploadImage("avatar", e.target.files?.[0])}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => uploadImage("cover", e.target.files?.[0])}
      />

      {imagePicker && (
        <div className="wa-profile-modal-backdrop">
          <div className="wa-profile-image-picker-modal" role="dialog" aria-label="Seleccionar una imagen">
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

              {imagePicker === "cover" && (
                <button
                  type="button"
                  className="wa-profile-image-picker-tile gif"
                  onClick={() => coverInputRef.current?.click()}
                >
                  <div className="wa-profile-gif-collage">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <strong>GIF</strong>
                  <em><i className="fa-solid fa-magnifying-glass" /> Seleccionar GIF</em>
                </button>
              )}
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
      )}

      {statusModalOpen && (
        <div className="wa-profile-modal-backdrop">
          <div className="wa-profile-status-modal">
            <button type="button" className="wa-profile-modal-close" onClick={() => setStatusModalOpen(false)}>
              <i className="fa-solid fa-xmark" />
            </button>
            <h3>Establecer tu estado</h3>
            <div
              className={`wa-profile-status-preview ${coverUrl ? "has-image" : ""}`}
              style={coverUrl ? { ...profileThemeStyle, backgroundImage: `url(${coverUrl})` } : profileThemeStyle}
            >
              <div className="wa-profile-status-preview-fade" />
              <div className="wa-profile-status-preview-content">
                <div className="wa-profile-status-preview-avatar">
                  {avatarUrl ? <img src={avatarUrl} alt={profileName} /> : <span>{getInitial(currentUser)}</span>}
                </div>
                <div>
                  <strong>{profileName}</strong>
                  <span>{currentUser?.correo}</span>
                </div>
                <p>{statusText || "Tu estado aparecerá aquí..."}</p>
              </div>
            </div>
            <label className="wa-profile-field-label">Estado</label>
            <div className="wa-profile-status-input">
              <i className="fa-solid fa-cat" />
              <textarea
                value={statusText}
                onChange={(e) => setStatusText(e.target.value.slice(0, 180))}
                placeholder="Escribe tu estado"
                rows={2}
              />
              {statusText && (
                <button type="button" onClick={() => setStatusText("")}>
                  <i className="fa-solid fa-circle-xmark" />
                </button>
              )}
            </div>
            <div className="wa-profile-modal-footer">
              <select value={statusExpiration} onChange={(e) => setStatusExpiration(e.target.value)}>
                {EXPIRATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button type="button" onClick={saveCustomStatus}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="wa-profile-modal-backdrop">
          <div className="wa-profile-edit-modal" style={editThemeStyle}>
            <button type="button" className="wa-profile-modal-close" onClick={() => setEditOpen(false)}>
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
                <textarea
                  className="wa-profile-bio-editor"
                  value={bioDraft}
                  maxLength={220}
                  onChange={(e) => setBioDraft(e.target.value)}
                  placeholder="Escribe tu biografía"
                />
                <div className="wa-profile-char-count">{bioDraft.length}/220</div>
              </section>
              <section>
                <h4>Previsualizar</h4>
                <div className="wa-profile-preview-card" style={editThemeStyle}>
                  <div
                    className={`wa-profile-preview-cover-area ${coverUrl ? "has-image" : ""}`}
                    style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
                  >
                    <button type="button" className="wa-profile-preview-cover" onClick={() => openImagePicker("cover")}>
                      <i className="fa-solid fa-pen" /> Cambiar cartel
                    </button>
                  </div>
                  <div className="wa-profile-preview-body">
                    <div className="wa-profile-preview-avatar">
                      {avatarUrl ? <img src={avatarUrl} alt={profileName} /> : <span>{getInitial(currentUser)}</span>}
                      <span className={`wa-profile-preview-presence-dot ${currentPresence.className}`}>
                        <i className={currentPresence.icon} />
                      </span>
                      <button type="button" onClick={() => openImagePicker("avatar")} title="Cambiar foto de perfil">
                        <i className="fa-solid fa-pen" />
                      </button>
                    </div>
                    <div className="wa-profile-preview-status">
                      <i className="fa-solid fa-cat" />
                      <span>{statusText || statusMessage || "Establecer tu estado"}</span>
                      <div className="wa-profile-status-actions wa-profile-preview-status-actions">
                        <button type="button" onClick={() => setStatusModalOpen(true)} title="Editar" data-tooltip="Editar">
                          <i className="fa-solid fa-pen" />
                        </button>
                        <button type="button" onClick={() => setStatusText("")} title="Borrar" data-tooltip="Borrar">
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </div>
                    <strong>{profileName}</strong>
                    <span>{currentUser?.correo}</span>
                    <p>{bioDraft || "Tu biografía aparecerá aquí."}</p>
                    <button type="button" className="wa-profile-preview-sample">Botón de ejemplo</button>
                  </div>
                </div>
              </section>
            </div>
            <div className="wa-profile-edit-footer">
              <button type="button" className="secondary" onClick={() => setEditOpen(false)}>Cancelar</button>
              <button type="button" onClick={saveProfileDetails}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SidebarProfilePanel;
