import React, { memo, useEffect, useMemo, useRef, useState } from "react";
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
  const detailed = Array.isArray(user?.proyectos_detallados) ? user.proyectos_detallados : [];
  let projects = [];

  if (detailed.length) {
    projects = detailed.map(getProjectName).filter(Boolean);
  } else if (Array.isArray(user?.proyectos)) {
    projects = user.proyectos.map(getProjectName).filter(Boolean);
  } else if (typeof user?.proyectos === "string") {
    projects = user.proyectos.split(",").map((project) => project.trim()).filter(Boolean);
  }

  return [...new Set(projects)];
};

const getRoleLabel = (user, rolesById = new Map()) => {
  const rawRole = String(user?.rol_nombre || user?.rol || user?.nombre_rol || "").trim();
  if (rawRole) return titleCase(rawRole);

  const roleFromCatalog = rolesById.get(Number(user?.rol_id));
  if (roleFromCatalog) return titleCase(roleFromCatalog);

  if (user?.rol_id !== undefined && user?.rol_id !== null) {
    return Number(user.rol_id) === 4 ? "Usuario" : "Administrador";
  }

  return "Usuario";
};

const isAdminRole = (roleLabel) => {
  const role = normalizeText(roleLabel);
  return role.includes("admin") || role.includes("super") || role.includes("owner") || role.includes("moder");
};

const getStatusInfo = (user) => {
  const rawValue = user?.estado_presencia_actual || user?.estado_presencia || user?.presencia || user?.estado || user?.status || user?.activo;

  if (typeof rawValue === "boolean") {
    return rawValue ? { label: "Activo", tone: "active" } : { label: "Inactivo", tone: "muted" };
  }

  const normalized = normalizeText(rawValue);
  if (!normalized || normalized === "aprobado" || normalized === "activo" || normalized === "online") return { label: "Activo", tone: "active" };
  if (normalized.includes("inactivo") || normalized.includes("idle")) return { label: "Inactivo", tone: "warning" };
  if (normalized.includes("molestar") || normalized.includes("dnd")) return { label: "No molestar", tone: "danger" };
  if (normalized.includes("desconect") || normalized.includes("offline")) return { label: "Desconectado", tone: "muted" };
  return { label: titleCase(rawValue), tone: "active" };
};

const UserRow = memo(function UserRow({
  user,
  rowNumber,
  selected,
  roleLabel,
  onToggle,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
  canSelect,
}) {
  const initial = user?.nombre?.charAt(0)?.toUpperCase() || user?.usuario?.charAt(0)?.toUpperCase() || "?";
  const fullName = `${user?.nombre || ""} ${user?.apellido || ""}`.trim();
  const projectNames = getProjectNames(user);
  const visibleProjects = projectNames.slice(0, 2);
  const hiddenProjects = Math.max(projectNames.length - visibleProjects.length, 0);
  const adminRole = isAdminRole(roleLabel);
  const statusInfo = getStatusInfo(user);

  return (
    <tr className={selected ? "is-selected" : ""}>
      <td className="qc-users-col-check">
        <label className="qc-users-check" title={selected ? "Quitar de la selección" : "Seleccionar usuario"}>
          <input type="checkbox" checked={selected} onChange={() => onToggle(user.id)} disabled={!canSelect} aria-label={`Seleccionar ${fullName || user?.usuario || "usuario"}`} />
          <span aria-hidden="true"><i className="bi bi-check-lg" /></span>
        </label>
      </td>
      <td className="qc-users-col-index">{rowNumber}</td>
      <td>
        {user?.url_imagen ? (
          <img src={getAvatarUrl(user.url_imagen)} alt={fullName || user?.usuario || "Usuario"} className="qc-users-avatar qc-users-avatar-img" />
        ) : (
          <span className="qc-users-avatar qc-users-avatar-fallback" style={{ background: user?.background || undefined }}>{initial}</span>
        )}
      </td>
      <td><strong className="qc-users-name">{fullName || "Sin nombre"}</strong></td>
      <td><span className="qc-users-email">{user?.usuario || user?.correo || "—"}</span></td>
      <td>
        <span className={`qc-role-badge ${adminRole ? "qc-role-badge-admin" : "qc-role-badge-user"}`}>
          <i className={adminRole ? "bi bi-shield-check" : "bi bi-person"} aria-hidden="true" />
          {roleLabel}
        </span>
      </td>
      <td>
        <div className="qc-project-list">
          {visibleProjects.length ? (
            <>
              {visibleProjects.map((projectName) => <span className="qc-project-chip" key={projectName}>{projectName}</span>)}
              {hiddenProjects > 0 && <span className="qc-project-chip qc-project-chip-more">+{hiddenProjects}</span>}
            </>
          ) : <span className="qc-users-empty">Sin proyectos</span>}
        </div>
      </td>
      <td><span className={`qc-status-pill qc-status-pill-${statusInfo.tone}`}><span aria-hidden="true" />{statusInfo.label}</span></td>
      <td>
        <div className="qc-users-actions">
          {canEdit && <button type="button" className="qc-action-btn qc-action-btn-edit" onClick={() => onEdit(user)} title="Editar usuario"><i className="bi bi-pencil-square" aria-hidden="true" /></button>}
          {canDelete && <button type="button" className="qc-action-btn qc-action-btn-delete" onClick={() => onDelete(user.id)} title="Eliminar usuario"><i className="bi bi-trash" aria-hidden="true" /></button>}
        </div>
      </td>
    </tr>
  );
});

export default function TablaUsuarios({
  usuarios,
  setEditando,
  eliminarUsuario,
  selectedIds,
  onToggleSelection,
  onSelectMany,
  onClearSelection,
  onBatchEdit,
  canEdit = true,
  canDelete = true,
  canBatch = true,
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroProyecto, setFiltroProyecto] = useState("");
  const [filtroRol, setFiltroRol] = useState("");
  const [proyectosActivos, setProyectosActivos] = useState([]);
  const [roles, setRoles] = useState([]);
  const [paginaActual, setPaginaActual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState(10);
  const selectPageRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/usuarios/admin/projects", { credentials: "include" }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar los proyectos");
        return Array.isArray(data?.proyectos) ? data.proyectos : [];
      }),
      fetch("/api/roles", { credentials: "include" }).then(async (res) => {
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error("No se pudieron cargar los roles");
        return Array.isArray(data) ? data : [];
      }),
    ])
      .then(([projects, rolesData]) => {
        if (cancelled) return;
        setProyectosActivos(projects);
        setRoles(rolesData);
      })
      .catch((err) => {
        console.error("❌ Error cargando filtros de usuarios:", err);
        if (!cancelled) {
          setProyectosActivos([]);
          setRoles([]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const rolesById = useMemo(() => new Map(roles.map((role) => [Number(role.id), String(role.nombre || role.name || "")])), [roles]);

  const opcionesProyecto = useMemo(() => {
    const names = new Set();
    proyectosActivos.forEach((project) => { const name = getProjectName(project); if (name) names.add(name); });
    usuarios.forEach((user) => getProjectNames(user).forEach((name) => names.add(name)));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [proyectosActivos, usuarios]);

  const opcionesRol = useMemo(() => {
    const roleOptions = new Map();
    roles.forEach((role) => {
      const id = Number(role.id);
      if (id) roleOptions.set(String(id), titleCase(role.nombre || role.name || `Rol ${id}`));
    });
    usuarios.forEach((user) => {
      const id = Number(user?.rol_id);
      if (id && !roleOptions.has(String(id))) roleOptions.set(String(id), getRoleLabel(user, rolesById));
    });
    return Array.from(roleOptions.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [roles, usuarios, rolesById]);

  const usuariosFiltrados = useMemo(() => {
    const search = normalizeText(busqueda);
    return usuarios.filter((user) => {
      const projectNames = getProjectNames(user);
      const roleLabel = getRoleLabel(user, rolesById);
      const searchable = normalizeText([user?.nombre, user?.apellido, user?.usuario_base, user?.usuario, user?.correo, user?.proyecto_principal_nombre, user?.proyecto_principal_dominio, roleLabel, projectNames.join(" ")].join(" "));
      const matchBusqueda = !search || searchable.includes(search);
      const matchProyecto = !filtroProyecto || projectNames.includes(filtroProyecto);
      const matchRol = !filtroRol || String(user?.rol_id ?? "") === filtroRol;
      return matchBusqueda && matchProyecto && matchRol;
    });
  }, [busqueda, filtroProyecto, filtroRol, usuarios, rolesById]);

  useEffect(() => { setPaginaActual(1); }, [busqueda, filtroProyecto, filtroRol, registrosPorPagina, usuarios]);

  const totalPaginas = Math.max(1, Math.ceil(usuariosFiltrados.length / registrosPorPagina));
  const paginaSegura = Math.min(paginaActual, totalPaginas);
  const indiceInicio = (paginaSegura - 1) * registrosPorPagina;
  const usuariosPaginados = usuariosFiltrados.slice(indiceInicio, indiceInicio + registrosPorPagina);
  const primerRegistro = usuariosFiltrados.length ? indiceInicio + 1 : 0;
  const ultimoRegistro = usuariosFiltrados.length ? indiceInicio + usuariosPaginados.length : 0;
  const pageIds = useMemo(() => usuariosPaginados.map((user) => Number(user.id)).filter(Boolean), [usuariosPaginados]);
  const filteredIds = useMemo(() => usuariosFiltrados.map((user) => Number(user.id)).filter(Boolean), [usuariosFiltrados]);
  const selectedCount = selectedIds.size;
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const selectedFilteredCount = filteredIds.filter((id) => selectedIds.has(id)).length;
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const somePageSelected = selectedOnPage > 0 && !allPageSelected;
  const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;

  useEffect(() => {
    if (selectPageRef.current) selectPageRef.current.indeterminate = somePageSelected;
  }, [somePageSelected]);

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

  const goToPage = (page) => setPaginaActual(Math.min(Math.max(page, 1), totalPaginas));
  const toggleCurrentPage = () => onSelectMany(pageIds, !allPageSelected);
  const toggleAllFiltered = () => onSelectMany(filteredIds, !allFilteredSelected);

  return (
    <div className="qc-users-table-shell qc-users-table-shell-batch">
      <div className="qc-users-toolbar qc-users-toolbar-multi">
        <label className="qc-users-search" htmlFor="qc-users-search-input">
          <i className="bi bi-search" aria-hidden="true" />
          <input id="qc-users-search-input" type="text" placeholder="Buscar usuarios por nombre, correo o usuario..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </label>

        <div className="qc-users-toolbar-actions qc-users-filter-actions">
          <label className="qc-users-select-wrap">
            <i className="bi bi-folder" aria-hidden="true" />
            <span className="visually-hidden">Filtrar por proyecto</span>
            <select className="qc-users-select" value={filtroProyecto} onChange={(e) => setFiltroProyecto(e.target.value)}>
              <option value="">Todos los proyectos</option>
              {opcionesProyecto.map((projectName) => <option key={projectName} value={projectName}>{projectName}</option>)}
            </select>
            <i className="bi bi-chevron-down" aria-hidden="true" />
          </label>

          <label className="qc-users-select-wrap">
            <i className="bi bi-shield-check" aria-hidden="true" />
            <span className="visually-hidden">Filtrar por rol</span>
            <select className="qc-users-select" value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)}>
              <option value="">Todos los roles</option>
              {opcionesRol.map(([roleId, roleName]) => <option key={roleId} value={roleId}>{roleName}</option>)}
            </select>
            <i className="bi bi-chevron-down" aria-hidden="true" />
          </label>
        </div>
      </div>

      <div className="qc-users-selection-bar">
        <div className="qc-users-selection-left">
          <label className="qc-users-select-screen">
            <span className="qc-users-check">
              <input ref={selectPageRef} type="checkbox" checked={allPageSelected} onChange={toggleCurrentPage} disabled={!pageIds.length || !canBatch} />
              <span aria-hidden="true"><i className="bi bi-check-lg" /></span>
            </span>
            <span>Seleccionar todo en pantalla</span>
          </label>

          <button
            type="button"
            className={`qc-users-select-filtered-btn ${allFilteredSelected ? "is-active" : ""}`}
            onClick={toggleAllFiltered}
            disabled={!filteredIds.length || !canBatch}
            title={allFilteredSelected ? "Quitar de la selección todos los usuarios filtrados" : "Seleccionar todos los usuarios que coinciden con los filtros actuales"}
          >
            <i className={allFilteredSelected ? "bi bi-check2-all" : "bi bi-ui-checks-grid"} aria-hidden="true" />
            <span>{allFilteredSelected ? "Quitar todos los filtrados" : `Seleccionar todos (${filteredIds.length})`}</span>
          </button>
        </div>

        <div className="qc-users-selection-actions">
          {selectedCount > 0 && <span className="qc-users-selected-pill"><i className="bi bi-check2-circle" /> {selectedCount} {selectedCount === 1 ? "usuario seleccionado" : "usuarios seleccionados"}</span>}
          <button type="button" className="qc-users-clear-btn" onClick={onClearSelection} disabled={!selectedCount}><i className="bi bi-trash3" /> Limpiar selección</button>
          {canBatch && <button type="button" className="qc-users-batch-btn" onClick={onBatchEdit} disabled={!selectedCount}><i className="bi bi-pencil-square" /> Editar lote</button>}
        </div>
      </div>

      <div className="qc-users-table-wrap">
        <table className="qc-users-table qc-users-table-selectable">
          <thead>
            <tr>
              <th className="qc-users-col-check">
                <label className="qc-users-check" title="Seleccionar usuarios de esta página">
                  <input type="checkbox" checked={allPageSelected} onChange={toggleCurrentPage} ref={(node) => { if (node) node.indeterminate = somePageSelected; }} disabled={!pageIds.length || !canBatch} />
                  <span aria-hidden="true"><i className="bi bi-check-lg" /></span>
                </label>
              </th>
              <th className="qc-users-col-index">#</th><th>Avatar</th>
              <th><span className="qc-users-th-sort">Nombre <i className="bi bi-chevron-expand" aria-hidden="true" /></span></th>
              <th>Usuario</th>
              <th><span className="qc-users-th-sort">Rol <i className="bi bi-record-circle" aria-hidden="true" /></span></th>
              <th>Proyectos</th>
              <th><span className="qc-users-th-sort">Estado <i className="bi bi-chevron-expand" aria-hidden="true" /></span></th>
              <th className="qc-users-col-actions">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuariosPaginados.length ? usuariosPaginados.map((user, index) => (
              <UserRow
                key={user.id || `${user.usuario}-${index}`}
                user={user}
                rowNumber={indiceInicio + index + 1}
                selected={selectedIds.has(Number(user.id))}
                roleLabel={getRoleLabel(user, rolesById)}
                onToggle={onToggleSelection}
                onEdit={setEditando}
                onDelete={eliminarUsuario}
                canEdit={canEdit}
                canDelete={canDelete}
                canSelect={canBatch}
              />
            )) : (
              <tr><td colSpan="9"><div className="qc-users-empty-state"><i className="bi bi-search" aria-hidden="true" /><strong>No se encontraron usuarios</strong><span>Prueba con otra búsqueda o cambia los filtros.</span></div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="qc-users-table-footer qc-users-table-footer-batch">
        <span>Mostrando {primerRegistro} a {ultimoRegistro} de {usuariosFiltrados.length} usuarios</span>
        <div className="qc-users-footer-right">
          <label className="qc-users-select-wrap qc-users-select-wrap-small">
            <span className="qc-users-select-label">Mostrar</span>
            <select className="qc-users-select" value={registrosPorPagina} onChange={(e) => setRegistrosPorPagina(Number(e.target.value))}>
              <option value="7">7</option><option value="10">10</option><option value="20">20</option>
            </select><i className="bi bi-chevron-down" aria-hidden="true" />
          </label>
          <nav className="qc-pagination" aria-label="Paginación de usuarios">
            <button type="button" className="qc-page-btn qc-page-btn-icon" disabled={paginaSegura === 1} onClick={() => goToPage(paginaSegura - 1)} aria-label="Página anterior"><i className="bi bi-chevron-left" /></button>
            {generarPaginas().map((page, index) => page === "..." ? <span className="qc-page-ellipsis" key={`ellipsis-${index}`}>...</span> : <button type="button" key={page} className={`qc-page-btn qc-page-btn-number ${paginaSegura === page ? "is-active" : ""}`} onClick={() => goToPage(page)}>{page}</button>)}
            <button type="button" className="qc-page-btn qc-page-btn-icon" disabled={paginaSegura === totalPaginas} onClick={() => goToPage(paginaSegura + 1)} aria-label="Página siguiente"><i className="bi bi-chevron-right" /></button>
          </nav>
        </div>
      </div>
    </div>
  );
}
