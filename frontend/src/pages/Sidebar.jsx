import { useState } from "react";
import { UserPlus, Edit3, Users, MessageSquare, Sun, Moon, Settings } from "feather-icons-react";
import { logDev } from "../utils/logger";
import SidebarProfilePanel from "../components/SidebarProfilePanel";
import { getAvatarUrl } from "../utils/url";
import { useTheme } from "../context/ThemeContext.jsx";
import socket from "../socket";

const Sidebar = ({ usuario, active, setActive, onUsuarioUpdate, unreadTotal = 0, estadosUsuarios = {} }) => {
  const [showModal, setShowModal] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { isDark, toggleTheme } = useTheme();


  const getPresenceInfo = () => {
    const estado = estadosUsuarios?.[String(usuario?.id)] || estadosUsuarios?.[Number(usuario?.id)] || null;
    const rawStatus = estado?.estado || usuario?.estado_presencia_actual || "desconectado";
    const dispositivo = estado?.dispositivo || "desktop";
    const meta = {
      online: {
        label: dispositivo === "mobile" ? "En línea desde teléfono" : "En línea desde PC",
        className: "online",
        iconClass: dispositivo === "mobile" ? "fa-solid fa-mobile-screen-button" : "fa-solid fa-desktop",
      },
      inactivo: { label: "Inactivo", className: "idle", iconClass: "fa-solid fa-moon" },
      no_molestar: { label: "No molestar", className: "dnd", iconClass: "fa-solid fa-minus" },
      desconectado: { label: "Sin conexión", className: "offline", iconClass: "fa-regular fa-circle" },
    };
    return meta[rawStatus] || meta.desconectado;
  };

  const renderRailPresence = () => {
    const presence = getPresenceInfo();
    return (
      <span className={`wa-presence-badge ${presence.className}`} title={presence.label}>
        <i className={presence.iconClass} aria-hidden="true" />
      </span>
    );
  };

  const canCrearGrupo = Boolean(usuario?.permisos_chat?.crear_grupos);
  const canCrearUsuarios = usuario?.rol_permisos?.includes("crear_usuarios");
  const canEditarUsuarios = usuario?.rol_permisos?.includes("editar_usuarios");
  const canCrearProyectos = usuario?.rol_permisos?.includes("crear_proyectos");

  const unreadBadge = Number(unreadTotal) > 999 ? "999+" : Number(unreadTotal) || null;

  const icons = [
    { id: "chat", label: "Mensajes", icon: <MessageSquare />, badge: unreadBadge },
    ...(canEditarUsuarios ? [{ id: "edit-user", label: "Usuarios", icon: <Users /> }] : []),
    ...(canCrearUsuarios ? [{ id: "add-user", label: "Nuevo usuario", icon: <UserPlus /> }] : []),
    ...(canCrearGrupo ? [{ id: "edit", label: "Proyectos", icon: <Edit3 /> }] : []),
    { id: "theme", label: isDark ? "Modo claro" : "Modo oscuro", icon: isDark ? <Sun /> : <Moon /> },
    { id: "settings", label: "Configuración", icon: <Settings /> },
  ];

  const getInitial = (correo) => correo?.charAt(0).toUpperCase();

  const getUserDisplayName = () => {
    const fullName = `${usuario?.nombre || ""} ${usuario?.apellido || ""}`.trim();
    return fullName || usuario?.correo || "Usuario";
  };

  const getUserRoleLabel = () => {
    if (usuario?.rol_nombre) return usuario.rol_nombre;
    if (usuario?.rol) return usuario.rol;
    return canCrearUsuarios || canEditarUsuarios || canCrearGrupo || canCrearProyectos ? "Administrador" : "Usuario";
  };

  const handleLogout = () => {
    logDev("Sesión cerrada");
    window.location.href = "/";
  };

  return (
    <div className={`wa-app-rail ${sidebarExpanded ? "is-expanded" : "is-collapsed"}`}>
      <button
        type="button"
        className="wa-rail-toggle"
        onClick={() => setSidebarExpanded((prev) => !prev)}
        aria-label={sidebarExpanded ? "Contraer menú" : "Expandir menú"}
        aria-expanded={sidebarExpanded}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {sidebarExpanded ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
        </svg>
      </button>

      {/* Logo */}
      <button type="button" className="wa-rail-logo" title="Quick Chat" onClick={() => setActive("chat")}>
        <span className="wa-rail-logo-mark">
          <img src="/logo-quick-chat.png" alt="Logo Quick Chat" />
        </span>
        <span className="wa-rail-logo-text">
          Quick<span>Chat</span>
        </span>
      </button>

      {/* Íconos */}
      <div className="wa-rail-nav" aria-label="Navegación principal">
        {icons.map(({ id, icon, badge, label }) => {
          const isThemeBtn = id === "theme";
          const isActive = !isThemeBtn && active === id;
          return (
            <button
              type="button"
              key={id}
              className={`wa-rail-item ${isActive ? "active" : ""}`}
              onClick={() => {
                if (isThemeBtn) {
                  toggleTheme();
                  return;
                }
                setActive(id);
              }}
              title={label}
              aria-label={label}
            >
              <span className="wa-rail-icon">
                {icon}
                {badge && <span className="wa-rail-badge">{badge}</span>}
              </span>
              <span className="wa-rail-label">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="wa-rail-spacer" />

      <div className="wa-rail-support-card" aria-hidden={!sidebarExpanded}>
        <span className="wa-rail-support-icon">
          <i className="fa-solid fa-bolt" aria-hidden="true" />
        </span>
        <strong>Conecta rápido y seguro</strong>
        <p>Administra tu equipo y proyectos de forma eficiente.</p>
      </div>

      {/* Avatar */}
      <button type="button" className="wa-rail-profile" onClick={() => setShowModal(true)} title="Perfil">
        <span className="wa-presence-wrapper wa-rail-profile-presence">
          {usuario?.url_imagen ? (
            <img src={getAvatarUrl(usuario.url_imagen)} alt="User" className="wa-rail-avatar-img" />
          ) : (
            <span
              className="wa-rail-avatar-fallback"
              style={{
                backgroundColor: usuario?.background,
              }}
            >
              {getInitial(usuario?.correo || "U")}
            </span>
          )}
          {renderRailPresence()}
        </span>
        <span className="wa-rail-profile-info">
          <strong>{getUserDisplayName()}</strong>
          <small>{getUserRoleLabel()}</small>
        </span>
        <span className="wa-rail-profile-chevron" aria-hidden="true">
          <i className="fa-solid fa-chevron-down" />
        </span>
      </button>

      <SidebarProfilePanel
        usuario={usuario}
        show={showModal}
        onClose={() => setShowModal(false)}
        onLogout={handleLogout}
        onUsuarioUpdate={onUsuarioUpdate}
        sidebarExpanded={sidebarExpanded}
      />
    </div>
  );
};

export default Sidebar;
