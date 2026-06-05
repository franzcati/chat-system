import { useEffect, useMemo, useState } from "react";
import TablaUsuarios from "./TablaUsuarios";
import FormEditarUsuario from "./FormEditarUsuario";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../css/UsersManagement.css";

const getProjectName = (project) => {
  if (!project) return "";
  return String(project.nombre || project.name || project.titulo || project.proyecto || "").trim();
};

const getUserProjects = (user) => {
  const detailed = Array.isArray(user?.proyectos_detallados)
    ? user.proyectos_detallados
    : [];

  if (detailed.length) {
    return detailed.map(getProjectName).filter(Boolean);
  }

  if (Array.isArray(user?.proyectos)) {
    return user.proyectos.map(getProjectName).filter(Boolean);
  }

  if (typeof user?.proyectos === "string") {
    return user.proyectos
      .split(",")
      .map((project) => project.trim())
      .filter(Boolean);
  }

  return [];
};

const isAdminUser = (user) => {
  const roleText = String(user?.rol_nombre || user?.rol || "").toLowerCase();

  if (roleText) {
    return (
      roleText.includes("admin") ||
      roleText.includes("super") ||
      roleText.includes("owner") ||
      roleText.includes("moder")
    );
  }

  if (user?.rol_id !== undefined && user?.rol_id !== null) {
    return Number(user.rol_id) !== 4;
  }

  return false;
};

const getCreationDate = (user) => {
  const value =
    user?.fecha_creacion ||
    user?.fecha_registro ||
    user?.created_at ||
    user?.createdAt ||
    user?.creado_en ||
    user?.created;

  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const EditUsers = ({ usuarioLogueado, proyectos = [] }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [editando, setEditando] = useState(null);
  const [, setUsuariosOriginal] = useState([]);

  useEffect(() => {
    obtenerUsuarios();
  }, []);

  const obtenerUsuarios = async () => {
    try {
      const res = await fetch("/api/usuarios");
      const data = await res.json();
      const usuariosSeguro = Array.isArray(data) ? data : [];

      setUsuarios(usuariosSeguro);
      setUsuariosOriginal(usuariosSeguro);
    } catch (err) {
      console.error("❌ Error cargando usuarios:", err);
      setUsuarios([]);
      setUsuariosOriginal([]);
    }
  };

  const abrirNuevoUsuario = () => {
    setEditando({
      id: null,
      nombre: "",
      apellido: "",
      usuario: "",
      proyectos: [],
    });
  };

  const estadisticas = useMemo(() => {
    const usuariosSeguros = Array.isArray(usuarios) ? usuarios : [];
    const proyectosUnicos = new Set();

    if (Array.isArray(proyectos)) {
      proyectos.forEach((project) => {
        const nombre = getProjectName(project);
        if (nombre) proyectosUnicos.add(nombre.toLowerCase());
      });
    }

    usuariosSeguros.forEach((user) => {
      getUserProjects(user).forEach((project) => {
        if (project) proyectosUnicos.add(project.toLowerCase());
      });
    });

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const nuevos = usuariosSeguros.filter((user) => {
      const date = getCreationDate(user);
      return date ? date >= sevenDaysAgo && date <= now : false;
    }).length;

    return {
      activos: usuariosSeguros.length,
      administradores: usuariosSeguros.filter(isAdminUser).length,
      proyectos: proyectosUnicos.size,
      nuevos,
    };
  }, [usuarios, proyectos]);

  return (
    <main className="qc-users-page">
      <div className="qc-users-bg-decor" aria-hidden="true">
        <span className="qc-users-orb qc-users-orb-one" />
        <span className="qc-users-orb qc-users-orb-two" />
        <span className="qc-users-chat-line qc-users-chat-line-one" />
        <span className="qc-users-chat-line qc-users-chat-line-two" />
        <i className="bi bi-chat-dots qc-users-floating-icon qc-users-floating-icon-one" />
        <i className="bi bi-chat-left-text qc-users-floating-icon qc-users-floating-icon-two" />
      </div>

      <header className="qc-users-topbar">
        <div>
          <h1 className="qc-users-title">Gestión de usuarios</h1>
          <p className="qc-users-subtitle">
            Administra los miembros de tu organización y sus accesos.
          </p>
        </div>

        <button
          type="button"
          className="qc-users-new-btn"
          onClick={abrirNuevoUsuario}
          title="Registrar nuevo usuario"
        >
          <i className="bi bi-plus-lg" aria-hidden="true" />
          <span>Nuevo usuario</span>
        </button>
      </header>

      <section className="qc-users-panel">
        <div className="qc-users-panel-hero">
          <div className="qc-users-hero-main">
            <span className="qc-users-hero-icon">
              <i className="bi bi-people" aria-hidden="true" />
            </span>

            <div>
              <div className="qc-users-hero-heading">
                <h2>Lista de usuarios</h2>
                <span className="qc-users-count-pill">
                  {usuarios.length} usuarios
                </span>
              </div>
              <p>Administra y supervisa los usuarios registrados.</p>
            </div>
          </div>

          <i className="bi bi-people-fill qc-users-hero-watermark" aria-hidden="true" />
        </div>

        {!editando && (
          <>
            <div className="qc-users-stats" aria-label="Resumen de usuarios">
              <article className="qc-users-stat-card">
                <span className="qc-users-stat-icon qc-users-stat-icon-blue">
                  <i className="bi bi-people" aria-hidden="true" />
                </span>
                <div>
                  <strong>{estadisticas.activos}</strong>
                  <span>Activos</span>
                  <small>Usuarios activos</small>
                </div>
              </article>

              <article className="qc-users-stat-card">
                <span className="qc-users-stat-icon qc-users-stat-icon-violet">
                  <i className="bi bi-shield-check" aria-hidden="true" />
                </span>
                <div>
                  <strong>{estadisticas.administradores}</strong>
                  <span>Administradores</span>
                  <small>Con permisos elevados</small>
                </div>
              </article>

              <article className="qc-users-stat-card">
                <span className="qc-users-stat-icon qc-users-stat-icon-cyan">
                  <i className="bi bi-folder2-open" aria-hidden="true" />
                </span>
                <div>
                  <strong>{estadisticas.proyectos}</strong>
                  <span>Proyectos</span>
                  <small>En total</small>
                </div>
              </article>

              <article className="qc-users-stat-card">
                <span className="qc-users-stat-icon qc-users-stat-icon-pink">
                  <i className="bi bi-person-plus" aria-hidden="true" />
                </span>
                <div>
                  <strong>{estadisticas.nuevos}</strong>
                  <span>Nuevos</span>
                  <small>Últimos 7 días</small>
                </div>
              </article>
            </div>

            <TablaUsuarios
              usuarios={usuarios}
              setEditando={setEditando}
              eliminarUsuario={(id) => {
                if (confirm("¿Seguro deseas eliminar este usuario?")) {
                  fetch(`/api/usuarios/${id}`, { method: "DELETE" }).then(() =>
                    obtenerUsuarios()
                  );
                }
              }}
            />
          </>
        )}

        {editando && (
          <div className="qc-users-edit-card">
            <div className="qc-users-edit-head">
              <div>
                <span className="qc-users-edit-kicker">
                  {editando.id ? "Edición" : "Nuevo registro"}
                </span>
                <h3>{editando.id ? "Editar usuario" : "Registrar usuario"}</h3>
                <p>
                  Mantén actualizados los datos, permisos y proyectos asignados.
                </p>
              </div>

              <button
                type="button"
                className="qc-page-btn qc-page-btn-soft"
                onClick={() => setEditando(null)}
              >
                <i className="bi bi-arrow-left" aria-hidden="true" />
                Volver a la lista
              </button>
            </div>

            <FormEditarUsuario
              editando={editando}
              setEditando={setEditando}
              obtenerUsuarios={obtenerUsuarios}
              rolUsuarioActual={usuarioLogueado?.rol_id}
            />
          </div>
        )}
      </section>
    </main>
  );
};

export default EditUsers;
