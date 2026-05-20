import { useEffect, useState } from "react";
import { UserPlus, Edit3, Users, MessageSquare, Sun, Moon, Settings } from 'feather-icons-react';
import { logDev } from "../utils/logger";
import SidebarProfilePanel from "../components/SidebarProfilePanel";
import { getAvatarUrl } from "../utils/url";
import { useTheme } from "../context/ThemeContext.jsx"; // ✅
import socket from "../socket";

const Sidebar = ({ usuario, active, setActive, onUsuarioUpdate }) => {
  const [showModal, setShowModal] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const [estadosUsuarios, setEstadosUsuarios] = useState({});


  useEffect(() => {
    const handleEstados = (estados = {}) => {
      setEstadosUsuarios(estados || {});
    };

    socket.on("actualizarUsuarios", handleEstados);
    fetch("/api/usuarios/estados/presencia")
      .then((res) => res.ok ? res.json() : {})
      .then((data) => setEstadosUsuarios(data || {}))
      .catch(() => {});

    return () => {
      socket.off("actualizarUsuarios", handleEstados);
    };
  }, []);

  const getPresenceInfo = () => {
    const estado = estadosUsuarios?.[String(usuario?.id)] || estadosUsuarios?.[Number(usuario?.id)] || null;
    const rawStatus = estado?.estado || usuario?.estado_presencia_actual || "desconectado";
    const dispositivo = estado?.dispositivo || "desktop";
    const meta = {
      online: { label: dispositivo === "mobile" ? "En línea desde teléfono" : "En línea desde PC", className: "online", iconClass: dispositivo === "mobile" ? "fa-solid fa-mobile-screen-button" : "fa-solid fa-desktop" },
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

  const icons = [
    ...(canCrearUsuarios ? [{ id: "add-user", label: "Añadir usuarios", icon: <UserPlus /> }] : []),
    ...(canEditarUsuarios ? [{ id: "edit-user", label: "Usuarios", icon: <Users /> }] : []),
    ...(canCrearGrupo ? [{ id: "edit", label: "Crear grupo", icon: <Edit3 /> }] : []),
    { id: "chat", label: "Chats", icon: <MessageSquare />, badge: null },
    { id: "theme", label: isDark ? "Modo claro" : "Modo oscuro", icon: isDark ? <Sun /> : <Moon /> },
    { id: "settings", label: "Configuración", icon: <Settings /> },
  ];

  const getInitial = (correo) => correo?.charAt(0).toUpperCase();

  const handleLogout = () => {
    logDev("Sesión cerrada");
    window.location.href = "/";
  };

  return (
    <div className="wa-app-rail">
      {/* Logo */}
      <button type="button" className="wa-rail-logo" title="Chat" onClick={() => setActive("chat")}>
        <img src="/logo2.png" alt="Logo" />
      </button>

      {/* Íconos */}
      <div className="wa-rail-nav">
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
            </button>
          );
        })}
      </div>

      {/* Avatar */}
      <button type="button" className="wa-rail-profile" onClick={() => setShowModal(true)} title="Perfil">
        <span className="wa-presence-wrapper wa-rail-profile-presence">
          {usuario?.url_imagen ? (
            <img
              src={getAvatarUrl(usuario.url_imagen)}
              alt="User"
              className="rounded-circle border border-warning"
              style={{ width: "40px", height: "40px", objectFit: "cover" }}
            />
          ) : (
            <div
              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
              style={{
                width: "40px",
                height: "40px",
                backgroundColor: usuario?.background,
                fontSize: "18px",
              }}
            >
              {getInitial(usuario?.correo || "U")}
            </div>
          )}
          {renderRailPresence()}
        </span>
      </button>

      <SidebarProfilePanel
        usuario={usuario}
        show={showModal}
        onClose={() => setShowModal(false)}
        onLogout={handleLogout}
        onUsuarioUpdate={onUsuarioUpdate}
      />
    </div>
  );
};

export default Sidebar;