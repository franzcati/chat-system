import { useState } from "react";
import { UserPlus, Edit3, Users, MessageSquare, Bell, Grid, Sun, Settings } from 'feather-icons-react';
import { logDev } from "../utils/logger";
import ProfileModal from "../components/ProfileModal";
import { getAvatarUrl } from "../utils/url";

const Sidebar = ({ usuario, active, setActive }) => {
  const [showModal, setShowModal] = useState(false);

  const canCrearGrupo = Boolean(usuario?.permisos_chat?.crear_grupos);
  const canCrearUsuarios = usuario?.rol_permisos?.includes("crear_usuarios");
  const canEditarUsuarios = usuario?.rol_permisos?.includes("editar_usuarios");
  const canCrearProyectos = usuario?.rol_permisos?.includes("crear_proyectos");

  const icons = [
    
    //{ id: "users", icon: <Users /> },-
        
    // Crear Proyectos
    ...(canCrearProyectos ? [{ id: "add-project", icon: <Grid /> }] : []),
    ...(canCrearUsuarios ? [{ id: "add-user", icon: <UserPlus /> }] : []),
    // Editar Usuarios
    ...(canEditarUsuarios ? [{ id: "edit-user", icon: <Users /> }] : []),
    
    // SOLO se muestra si tiene permiso
    ...(canCrearGrupo ? [{ id: "edit", icon: <Edit3 /> }] : []),
    { id: "chat", icon: <MessageSquare />, badge: null },
    //{ id: "notifications", icon: <Bell /> },
    //{ id: "grid", icon: <Grid /> },
    { id: "sun", icon: <Sun /> },
    { id: "settings", icon: <Settings /> },
  ];

  const getInitial = (correo) => correo?.charAt(0).toUpperCase();

  const handleLogout = () => {
    logDev("Sesión cerrada");
    window.location.href = "/";
  };

  return (
    <div
      className="d-flex flex-column align-items-center bg-white border-end py-4"
      style={{ width: "64px", height: "100vh" }}
    >
      {/* Logo */}
      <div className="mb-5">
        <img src="/logo2.png" alt="Logo" style={{ width: "32px", height: "32px" }} />
      </div>

      {/* Íconos */}
      <div className="d-flex flex-column align-items-center gap-4 w-100 px-1">
        {icons.map(({ id, icon, badge }) => {
          const isActive = active === id;
          return (
            <div
              key={id}
              className={`nav-item ${isActive ? "active" : ""}`}
              onClick={() => setActive(id)}
              style={{ cursor: "pointer" }}
            >
              <div
                className="icon icon-xl position-relative d-flex justify-content-center align-items-center"
                style={{
                  padding: "0.75rem",
                  borderRadius: "1rem",
                  backgroundColor: isActive ? "#e7f1ff" : "transparent",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ color: isActive ? "#8672FF" : "#a0aec0" }}>
                  {icon}
                </div>
                {badge && (
                  <div
                    className="position-absolute top-0 start-100 translate-middle badge badge-circle bg-primary"
                    style={{
                      fontSize: "0.6rem",
                      padding: "4px",
                      borderRadius: "50%",
                    }}
                  >
                    <span>{badge}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Avatar */}
      <div className="mt-auto mb-2" onClick={() => setShowModal(true)} style={{ cursor: "pointer" }}>
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
      </div>

      <ProfileModal
        usuario={usuario}       // el usuario que se está mostrando
        miUsuario={usuario}     // 👈 en Sidebar siempre es TU usuario
        show={showModal}
        onClose={() => setShowModal(false)}
        onLogout={handleLogout}
      />
    </div>
  );
};

export default Sidebar;