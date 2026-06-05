import { useEffect, useMemo, useState } from "react";
import { getAvatarUrl } from "../utils/url";
import "bootstrap-icons/font/bootstrap-icons.css";

const normalizeText = (value) => String(value || "").toLowerCase().trim();

const titleCase = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const getProjectName = (project) => {
  if (!project) return "";
  return String(project.nombre || project.name || project.titulo || project.proyecto || "").trim();
};

const getProjectNames = (user) => {
  const detailed = Array.isArray(user?.proyectos_detallados)
    ? user.proyectos_detallados
    : [];

  let projects = [];

  if (detailed.length) {
    projects = detailed.map(getProjectName).filter(Boolean);
  } else if (Array.isArray(user?.proyectos)) {
    projects = user.proyectos.map(getProjectName).filter(Boolean);
  } else if (typeof user?.proyectos === "string") {
    projects = user.proyectos
      .split(",")
      .map((project) => project.trim())
      .filter(Boolean);
  }

  return [...new Set(projects)];
};

const getRoleLabel = (user) => {
  const rawRole = String(user?.rol_nombre || user?.rol || user?.nombre_rol || "").trim();

  if (rawRole) return titleCase(rawRole);

  if (user?.rol_id !== undefined && user?.rol_id !== null) {
    return Number(user.rol_id) === 4 ? "Usuario" : "Administrador";
  }

  return "Usuario";
};

const isAdminRole = (roleLabel) => {
  const role = normalizeText(roleLabel);
  return (
    role.includes("admin") ||
    role.includes("super") ||
    role.includes("owner") ||
    role.includes("moder")
  );
};

const getStatusInfo = (user) => {
  const rawValue =
    user?.estado_presencia_actual ||
    user?.estado_presencia ||
    user?.presencia ||
    user?.estado ||
    user?.status ||
    user?.activo;

  if (typeof rawValue === "boolean") {
    return rawValue
      ? { label: "Activo", tone: "active" }
      : { label: "Inactivo", tone: "muted" };
  }

  const normalized = normalizeText(rawValue);

  if (!normalized || normalized === "aprobado" || normalized === "activo" || normalized === "online") {
    return { label: "Activo", tone: "active" };
  }

  if (normalized.includes("inactivo") || normalized.includes("idle")) {
    return { label: "Inactivo", tone: "warning" };
  }

  if (normalized.includes("molestar") || normalized.includes("dnd")) {
    return { label: "No molestar", tone: "danger" };
  }

  if (normalized.includes("desconect") || normalized.includes("offline")) {
    return { label: "Desconectado", tone: "muted" };
  }

  return { label: titleCase(rawValue), tone: "active" };
};

export default function TablaUsuarios({ usuarios, setEditando, eliminarUsuario }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroProyecto, setFiltroProyecto] = useState("");
  const [proyectosActivos, setProyectosActivos] = useState([]);
  const [paginaActual, setPaginaActual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState(10);

  useEffect(() => {
    fetch("/api/proyecto")
      .then((res) => res.json())
      .then((data) => setProyectosActivos(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error("❌ Error cargando proyectos:", err);
        setProyectosActivos([]);
      });
  }, []);

  const opcionesProyecto = useMemo(() => {
    const names = new Set();

    proyectosActivos.forEach((project) => {
      const name = getProjectName(project);
      if (name) names.add(name);
    });

    usuarios.forEach((user) => {
      getProjectNames(user).forEach((name) => names.add(name));
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [proyectosActivos, usuarios]);

  const usuariosFiltrados = useMemo(() => {
    const search = normalizeText(busqueda);

    return usuarios.filter((user) => {
      const projectNames = getProjectNames(user);
      const roleLabel = getRoleLabel(user);
      const searchable = normalizeText(
        [
          user?.nombre,
          user?.apellido,
          user?.usuario,
          user?.correo,
          roleLabel,
          projectNames.join(" "),
        ].join(" ")
      );

      const matchBusqueda = !search || searchable.includes(search);
      const matchProyecto = !filtroProyecto || projectNames.includes(filtroProyecto);

      return matchBusqueda && matchProyecto;
    });
  }, [busqueda, filtroProyecto, usuarios]);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroProyecto, registrosPorPagina, usuarios]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(usuariosFiltrados.length / registrosPorPagina)
  );
  const paginaSegura = Math.min(paginaActual, totalPaginas);
  const indiceInicio = (paginaSegura - 1) * registrosPorPagina;
  const usuariosPaginados = usuariosFiltrados.slice(
    indiceInicio,
    indiceInicio + registrosPorPagina
  );
  const primerRegistro = usuariosFiltrados.length ? indiceInicio + 1 : 0;
  const ultimoRegistro = usuariosFiltrados.length
    ? indiceInicio + usuariosPaginados.length
    : 0;

  const generarPaginas = () => {
    const paginas = [];

    if (totalPaginas <= 5) {
      for (let page = 1; page <= totalPaginas; page += 1) paginas.push(page);
      return paginas;
    }

    paginas.push(1);

    if (paginaSegura > 3) paginas.push("...");

    const inicio = Math.max(2, paginaSegura - 1);
    const fin = Math.min(totalPaginas - 1, paginaSegura + 1);

    for (let page = inicio; page <= fin; page += 1) paginas.push(page);

    if (paginaSegura < totalPaginas - 2) paginas.push("...");

    paginas.push(totalPaginas);
    return paginas;
  };

  const goToPage = (page) => {
    setPaginaActual(Math.min(Math.max(page, 1), totalPaginas));
  };

  return (
    <div className="qc-users-table-shell">
      <div className="qc-users-toolbar">
        <label className="qc-users-search" htmlFor="qc-users-search-input">
          <i className="bi bi-search" aria-hidden="true" />
          <input
            id="qc-users-search-input"
            type="text"
            placeholder="Buscar usuario..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>

        <div className="qc-users-toolbar-actions">
          <label className="qc-users-select-wrap">
            <span className="visually-hidden">Filtrar por proyecto</span>
            <select
              className="qc-users-select"
              value={filtroProyecto}
              onChange={(e) => setFiltroProyecto(e.target.value)}
            >
              <option value="">Todos los proyectos</option>
              {opcionesProyecto.map((projectName) => (
                <option key={projectName} value={projectName}>
                  {projectName}
                </option>
              ))}
            </select>
            <i className="bi bi-chevron-down" aria-hidden="true" />
          </label>

          <label className="qc-users-select-wrap qc-users-select-wrap-small">
            <span className="qc-users-select-label">Mostrar</span>
            <select
              className="qc-users-select"
              value={registrosPorPagina}
              onChange={(e) => setRegistrosPorPagina(Number(e.target.value))}
            >
              <option value="7">7</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
            <i className="bi bi-chevron-down" aria-hidden="true" />
          </label>

          <a
            href="/api/usuarios/exportar"
            className="qc-users-export-btn"
            title="Exportar CSV"
          >
            <i className="bi bi-download" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="qc-users-table-wrap">
        <table className="qc-users-table">
          <thead>
            <tr>
              <th className="qc-users-col-index">#</th>
              <th>Avatar</th>
              <th>
                <span className="qc-users-th-sort">
                  Nombre <i className="bi bi-chevron-expand" aria-hidden="true" />
                </span>
              </th>
              <th>Usuario</th>
              <th>
                <span className="qc-users-th-sort">
                  Rol <i className="bi bi-record-circle" aria-hidden="true" />
                </span>
              </th>
              <th>Proyectos</th>
              <th>
                <span className="qc-users-th-sort">
                  Estado <i className="bi bi-chevron-expand" aria-hidden="true" />
                </span>
              </th>
              <th className="qc-users-col-actions">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {usuariosPaginados.length ? (
              usuariosPaginados.map((user, index) => {
                const initial =
                  user?.nombre?.charAt(0)?.toUpperCase() ||
                  user?.usuario?.charAt(0)?.toUpperCase() ||
                  "?";
                const fullName = `${user?.nombre || ""} ${user?.apellido || ""}`.trim();
                const projectNames = getProjectNames(user);
                const visibleProjects = projectNames.slice(0, 2);
                const hiddenProjects = Math.max(projectNames.length - visibleProjects.length, 0);
                const roleLabel = getRoleLabel(user);
                const adminRole = isAdminRole(roleLabel);
                const statusInfo = getStatusInfo(user);

                return (
                  <tr key={user.id || `${user.usuario}-${index}`}>
                    <td className="qc-users-col-index">
                      {indiceInicio + index + 1}
                    </td>

                    <td>
                      {user?.url_imagen ? (
                        <img
                          src={getAvatarUrl(user.url_imagen)}
                          alt={fullName || user?.usuario || "Usuario"}
                          className="qc-users-avatar qc-users-avatar-img"
                        />
                      ) : (
                        <span
                          className="qc-users-avatar qc-users-avatar-fallback"
                          style={{ background: user?.background || undefined }}
                        >
                          {initial}
                        </span>
                      )}
                    </td>

                    <td>
                      <strong className="qc-users-name">
                        {fullName || "Sin nombre"}
                      </strong>
                    </td>

                    <td>
                      <span className="qc-users-email">
                        {user?.usuario || user?.correo || "—"}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`qc-role-badge ${
                          adminRole ? "qc-role-badge-admin" : "qc-role-badge-user"
                        }`}
                      >
                        <i
                          className={adminRole ? "bi bi-shield-check" : "bi bi-person"}
                          aria-hidden="true"
                        />
                        {roleLabel}
                      </span>
                    </td>

                    <td>
                      <div className="qc-project-list">
                        {visibleProjects.length ? (
                          <>
                            {visibleProjects.map((projectName) => (
                              <span className="qc-project-chip" key={projectName}>
                                {projectName}
                              </span>
                            ))}
                            {hiddenProjects > 0 && (
                              <span className="qc-project-chip qc-project-chip-more">
                                +{hiddenProjects}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="qc-users-empty">Sin proyectos</span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className={`qc-status-pill qc-status-pill-${statusInfo.tone}`}>
                        <span aria-hidden="true" />
                        {statusInfo.label}
                      </span>
                    </td>

                    <td>
                      <div className="qc-users-actions">
                        <button
                          type="button"
                          className="qc-action-btn qc-action-btn-edit"
                          onClick={() => setEditando(user)}
                          title="Editar usuario"
                        >
                          <i className="bi bi-pencil-square" aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          className="qc-action-btn qc-action-btn-delete"
                          onClick={() => eliminarUsuario(user.id)}
                          title="Eliminar usuario"
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="8">
                  <div className="qc-users-empty-state">
                    <i className="bi bi-search" aria-hidden="true" />
                    <strong>No se encontraron usuarios</strong>
                    <span>Prueba con otra búsqueda o cambia el filtro de proyecto.</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="qc-users-table-footer">
        <span>
          Mostrando {primerRegistro} a {ultimoRegistro} de {usuariosFiltrados.length} registros
        </span>

        <nav className="qc-pagination" aria-label="Paginación de usuarios">
          <button
            type="button"
            className="qc-page-btn"
            disabled={paginaSegura === 1}
            onClick={() => goToPage(1)}
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
            Primero
          </button>

          <button
            type="button"
            className="qc-page-btn"
            disabled={paginaSegura === 1}
            onClick={() => goToPage(paginaSegura - 1)}
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
            Anterior
          </button>

          {generarPaginas().map((page, index) =>
            page === "..." ? (
              <span className="qc-page-ellipsis" key={`ellipsis-${index}`}>
                ...
              </span>
            ) : (
              <button
                type="button"
                key={page}
                className={`qc-page-btn qc-page-btn-number ${
                  paginaSegura === page ? "is-active" : ""
                }`}
                onClick={() => goToPage(page)}
              >
                {page}
              </button>
            )
          )}

          <button
            type="button"
            className="qc-page-btn"
            disabled={paginaSegura === totalPaginas}
            onClick={() => goToPage(paginaSegura + 1)}
          >
            Siguiente
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="qc-page-btn"
            disabled={paginaSegura === totalPaginas}
            onClick={() => goToPage(totalPaginas)}
          >
            Último
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
        </nav>
      </div>
    </div>
  );
}
