import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Briefcase,
  Clock,
  Edit2,
  Eye,
  Folder,
  Globe,
  Headphones,
  Info,
  MessageCircle,
  Plus,
  Power,
  Search,
  Shield,
  Users,
  X,
} from "feather-icons-react";
import "../css/ProjectManagement.css";
import ProjectMembersManager from "./ProjectMembersManager";

const EMPTY_FORM = {
  nombre: "",
  dominio: "",
  descripcion: "",
  tipo: "operativo",
  color: "#168cff",
  icono: "folder",
  estado: "activo",
};

const PROJECT_TYPES = [
  { value: "operativo", label: "Operativo", description: "Procesos y operaciones", icon: Activity },
  { value: "comercial", label: "Comercial", description: "Ventas y clientes", icon: Briefcase },
  { value: "soporte", label: "Soporte", description: "Atención al cliente", icon: Headphones },
  { value: "personalizado", label: "Personalizado", description: "Otro tipo de proyecto", icon: Users },
];

const PROJECT_COLORS = [
  "#168cff",
  "#6941ff",
  "#a43cff",
  "#ff496c",
  "#ff7a21",
  "#ffad0d",
  "#15b77e",
  "#00b8d9",
];

const PROJECT_ICONS = [
  { value: "folder", icon: Folder },
  { value: "message", icon: MessageCircle },
  { value: "users", icon: Users },
  { value: "headphones", icon: Headphones },
  { value: "shield", icon: Shield },
  { value: "briefcase", icon: Briefcase },
];

const ProjectIcon = ({ icon = "folder", size = 20 }) => {
  const found = PROJECT_ICONS.find((item) => item.value === icon);
  const Icon = found?.icon || Folder;
  return <Icon size={size} />;
};

const normalizeDomain = (value = "") =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const ProjectManagement = () => {
  const [stats, setStats] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [createMemberIds, setCreateMemberIds] = useState([]);

  const [selectedProject, setSelectedProject] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [stateBusyId, setStateBusyId] = useState(null);

  const [editLoading, setEditLoading] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [domainImpact, setDomainImpact] = useState(null);
  const [domainImpactLoading, setDomainImpactLoading] = useState(false);
  const [changingDomain, setChangingDomain] = useState(false);

  const fetchJson = useCallback(async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        body?.error ||
        body?.message ||
        `HTTP ${response.status}`
      );
      err.status = response.status;
      err.body = body;
      throw err;
    }

    return body;
  }, []);

  const cargarStats = useCallback(async () => {
    try {
      const data = await fetchJson("/api/proyecto/admin/stats");
      setStats(data);
    } catch (err) {
      console.error("Error cargando estadísticas:", err);
    }
  }, [fetchJson]);

  const cargarProyectos = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (search.trim()) params.set("search", search.trim());
      if (estado) params.set("estado", estado);

      const data = await fetchJson(`/api/proyecto/admin?${params.toString()}`);

      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.proyectos)
          ? data.proyectos
          : Array.isArray(data?.data)
            ? data.data
            : [];

      const paginacion = data?.paginacion || data?.pagination || {};

      const totalRegistros = Number(
        paginacion.total ??
        data?.total ??
        rows.length
      );

      const paginas = Number(
        paginacion.total_paginas ??
        paginacion.totalPages ??
        data?.total_paginas ??
        data?.totalPages ??
        Math.max(1, Math.ceil(totalRegistros / limit))
      );

      setProyectos(rows);
      setTotal(totalRegistros);
      setTotalPages(Math.max(1, paginas || 1));
    } catch (err) {
      console.error("Error cargando proyectos:", err);
      setError(err.message || "No se pudieron cargar los proyectos");
      setProyectos([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [fetchJson, page, limit, search, estado]);

  useEffect(() => {
    cargarStats();
  }, [cargarStats, refreshKey]);

  useEffect(() => {
    cargarProyectos();
  }, [cargarProyectos, refreshKey]);

  const refreshAll = () => setRefreshKey((value) => value + 1);

  const handleBuscar = (event) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError("");
    setCreateMemberIds([]);
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (creating) return;
    setShowCreate(false);
    setFormError("");
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setFormError("");

    const nombre = form.nombre.trim();
    const dominio = normalizeDomain(form.dominio);

    if (!nombre) {
      setFormError("Ingresa el nombre del proyecto.");
      return;
    }

    if (!dominio) {
      setFormError("Ingresa el dominio del proyecto.");
      return;
    }

    setCreating(true);

    try {
      await fetchJson("/api/proyecto/admin", {
        method: "POST",
        body: JSON.stringify({
          nombre,
          dominio,
          descripcion: form.descripcion.trim(),
          tipo: form.tipo,
          color: form.color,
          icono: form.icono,
          estado: form.estado,
          usuario_ids: createMemberIds,
        }),
      });

      setShowCreate(false);
      setForm(EMPTY_FORM);
      setCreateMemberIds([]);
      setPage(1);
      refreshAll();
    } catch (err) {
      setFormError(err.message || "No se pudo crear el proyecto.");
    } finally {
      setCreating(false);
    }
  };

  const handleView = async (id) => {
    setDetailLoading(true);
    setSelectedProject(null);

    try {
      const data = await fetchJson(`/api/proyecto/admin/${id}`);
      setSelectedProject(data?.proyecto || data);
    } catch (err) {
      setError(err.message || "No se pudo cargar el proyecto.");
    } finally {
      setDetailLoading(false);
    }
  };


  const handleEdit = async (id) => {
    setEditLoading(true);
    setEditError("");
    setDomainImpact(null);

    try {
      const data = await fetchJson(`/api/proyecto/admin/${id}`);
      const proyecto = data?.proyecto || data;

      setEditingProject(proyecto);
      setEditForm({
        nombre: proyecto?.nombre || "",
        dominio: proyecto?.dominio || "",
        descripcion: proyecto?.descripcion || "",
        tipo: proyecto?.tipo || "operativo",
        color: proyecto?.color || "#168cff",
        icono: proyecto?.icono || "folder",
        estado: proyecto?.estado || "activo",
      });
    } catch (err) {
      setError(err.message || "No se pudo cargar el proyecto.");
    } finally {
      setEditLoading(false);
    }
  };

  const closeEdit = () => {
    if (savingEdit || changingDomain) return;

    setEditingProject(null);
    setEditError("");
    setDomainImpact(null);
  };

  const saveProjectMetadataAndState = async () => {
    if (!editingProject?.id) return;

    const nombre = editForm.nombre.trim();

    if (!nombre) {
      throw new Error("El nombre del proyecto es obligatorio.");
    }

    await fetchJson(`/api/proyecto/admin/${editingProject.id}`, {
      method: "PUT",
      body: JSON.stringify({
        nombre,
        descripcion: editForm.descripcion.trim(),
        tipo: editForm.tipo,
        color: editForm.color,
        icono: editForm.icono,
      }),
    });

    if (editForm.estado !== editingProject.estado) {
      await fetchJson(
        `/api/proyecto/admin/${editingProject.id}/estado`,
        {
          method: "PATCH",
          body: JSON.stringify({
            estado: editForm.estado,
          }),
        }
      );
    }
  };

  const handleSubmitEdit = async (event) => {
    event.preventDefault();

    if (!editingProject?.id) return;

    setEditError("");

    const nombre = editForm.nombre.trim();

    if (!nombre) {
      setEditError("El nombre del proyecto es obligatorio.");
      return;
    }

    const dominioActual = normalizeDomain(
      editingProject.dominio || ""
    );

    const dominioNuevo = normalizeDomain(
      editForm.dominio || ""
    );

    // Si el dominio cambió, NO usamos PUT.
    // Primero pedimos al backend el análisis de impacto.
    if (dominioNuevo !== dominioActual) {
      if (!dominioNuevo) {
        setEditError(
          "Para cambiar el dominio debes ingresar un dominio válido."
        );
        return;
      }

      setDomainImpactLoading(true);

      try {
        const data = await fetchJson(
          `/api/proyecto/admin/${editingProject.id}/domain-impact?dominio=${encodeURIComponent(
            dominioNuevo
          )}`
        );

        setDomainImpact(data);
      } catch (err) {
        setEditError(
          err.message ||
          "No se pudo calcular el impacto del cambio de dominio."
        );
      } finally {
        setDomainImpactLoading(false);
      }

      return;
    }

    // Si NO cambia el dominio, guardamos normalmente.
    setSavingEdit(true);

    try {
      await saveProjectMetadataAndState();

      setEditingProject(null);
      setEditError("");
      setDomainImpact(null);
      refreshAll();
    } catch (err) {
      setEditError(
        err.message || "No se pudieron guardar los cambios."
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDomainChange = async () => {
    if (
      !editingProject?.id ||
      !domainImpact?.puede_confirmar ||
      changingDomain
    ) {
      return;
    }

    const dominioNuevo = normalizeDomain(editForm.dominio);

    setChangingDomain(true);
    setEditError("");

    try {
      // Primero cambiamos el dominio de forma transaccional.
      // Si el backend detecta un conflicto nuevo, hará rollback
      // y NO ejecutaremos el PUT de metadatos.
      await fetchJson(
        `/api/proyecto/admin/${editingProject.id}/change-domain`,
        {
          method: "POST",
          body: JSON.stringify({
            dominio: dominioNuevo,
            confirmar: true,
          }),
        }
      );

      // Una vez confirmado el dominio, guardamos el resto
      // de la información del proyecto.
      await saveProjectMetadataAndState();

      setDomainImpact(null);
      setEditingProject(null);
      setEditError("");
      refreshAll();
    } catch (err) {
      const nuevosConflictos =
        err?.body?.conflictos ||
        err?.body?.impacto?.conflictos;

      if (Array.isArray(nuevosConflictos)) {
        setDomainImpact((prev) => ({
          ...(prev || {}),
          conflictos: nuevosConflictos,
          puede_confirmar: false,
        }));
      }

      setEditError(
        err.message ||
        "No se pudo completar el cambio de dominio."
      );
    } finally {
      setChangingDomain(false);
    }
  };

  const handleToggleState = async (proyecto) => {
    if (!proyecto?.id) return;

    const nuevoEstado =
      proyecto.estado === "inactivo" ? "activo" : "inactivo";

    const texto =
      nuevoEstado === "inactivo"
        ? `¿Desactivar el proyecto "${proyecto.nombre}"?`
        : `¿Activar el proyecto "${proyecto.nombre}"?`;

    if (!window.confirm(texto)) return;

    setStateBusyId(proyecto.id);

    try {
      await fetchJson(`/api/proyecto/admin/${proyecto.id}/estado`, {
        method: "PATCH",
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      refreshAll();
    } catch (err) {
      setError(err.message || "No se pudo cambiar el estado.");
    } finally {
      setStateBusyId(null);
    }
  };

  const shownFrom = total === 0 ? 0 : (page - 1) * limit + 1;
  const shownTo = Math.min(page * limit, total);

  const selectedType = useMemo(
    () => PROJECT_TYPES.find((item) => item.value === form.tipo) || PROJECT_TYPES[0],
    [form.tipo]
  );

  return (
    <section className="pm2-page">
      <header className="pm2-header">
        <div>
          <h1>Gestión de proyectos</h1>
          <p>Crea y administra tus proyectos de chat y sus dominios.</p>
        </div>

        <button type="button" className="pm2-new-btn" onClick={openCreate}>
          <Plus size={19} />
          Nuevo proyecto
        </button>
      </header>

      <section className="pm2-stats">
        <article className="pm2-stat pm2-stat-blue">
          <div className="pm2-stat-icon"><Folder /></div>
          <div>
            <strong>{stats?.total_proyectos ?? "—"}</strong>
            <span>Proyectos</span>
            <small>En total</small>
          </div>
        </article>

        <article className="pm2-stat pm2-stat-green">
          <div className="pm2-stat-icon"><Users /></div>
          <div>
            <strong>{stats?.total_usuarios ?? "—"}</strong>
            <span>Usuarios</span>
            <small>Asignados</small>
          </div>
        </article>

        <article className="pm2-stat pm2-stat-purple">
          <div className="pm2-stat-icon"><Activity /></div>
          <div>
            <strong>{stats?.proyectos_activos ?? "—"}</strong>
            <span>Proyectos activos</span>
            <small>En funcionamiento</small>
          </div>
        </article>

        <article className="pm2-stat pm2-stat-red">
          <div className="pm2-stat-icon"><Clock /></div>
          <div>
            <strong>{stats?.proyectos_inactivos ?? "—"}</strong>
            <span>Proyectos inactivos</span>
            <small>Desactivados</small>
          </div>
        </article>
      </section>

      <section className="pm2-panel">
        <div className="pm2-toolbar">
          <form className="pm2-search" onSubmit={handleBuscar}>
            <Search size={18} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar proyectos..."
            />
          </form>

          <div className="pm2-filters">
            <select
              value={estado}
              onChange={(event) => {
                setEstado(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos los estados</option>
              <option value="activo">Activos</option>
              <option value="inactivo">Inactivos</option>
            </select>

            <select
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={10}>Mostrar 10</option>
              <option value={25}>Mostrar 25</option>
              <option value={50}>Mostrar 50</option>
              <option value={100}>Mostrar 100</option>
            </select>
          </div>
        </div>

        {error && <div className="pm2-error">{error}</div>}

        <div className="pm2-table-wrap">
          <table className="pm2-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre del proyecto</th>
                <th>Dominio</th>
                <th>Usuarios</th>
                <th>Estado</th>
                <th>Fecha de creación</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="pm2-empty">
                    Cargando proyectos...
                  </td>
                </tr>
              ) : proyectos.length === 0 ? (
                <tr>
                  <td colSpan="7" className="pm2-empty">
                    No se encontraron proyectos.
                  </td>
                </tr>
              ) : (
                proyectos.map((proyecto, index) => {
                  const initial = (proyecto.nombre || "P").charAt(0).toUpperCase();

                  return (
                    <tr key={proyecto.id}>
                      <td className="pm2-number">
                        {(page - 1) * limit + index + 1}
                      </td>

                      <td>
                        <div className="pm2-project-name">
                          <span
                            className="pm2-avatar"
                            style={{
                              background: `linear-gradient(135deg, ${
                                proyecto.color || "#168cff"
                              }, #6c38ff)`,
                            }}
                          >
                            {initial}
                          </span>

                          <div>
                            <strong>{proyecto.nombre}</strong>
                            <small>ID #{proyecto.id}</small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span className="pm2-domain">
                          {proyecto.dominio || "Sin dominio"}
                        </span>
                      </td>

                      <td>
                        <span className="pm2-users-count">
                          {proyecto.usuarios ??
                           proyecto.total_usuarios ??
                           proyecto.total_miembros ??
                           0}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`pm2-status ${
                            proyecto.estado === "inactivo"
                              ? "is-inactive"
                              : "is-active"
                          }`}
                        >
                          <i />
                          {proyecto.estado === "inactivo" ? "Inactivo" : "Activo"}
                        </span>
                      </td>

                      <td>
                        {proyecto.created_at
                          ? new Date(proyecto.created_at.replace(" ", "T"))
                              .toLocaleDateString("es-PE")
                          : "—"}
                      </td>

                      <td>
                        <div className="pm2-actions">
                          <button
                            type="button"
                            className="pm2-action view"
                            title="Ver proyecto"
                            onClick={() => handleView(proyecto.id)}
                          >
                            <Eye size={17} />
                          </button>

                          <button
                            type="button"
                            className="pm2-action edit"
                            title="Editar proyecto"
                            onClick={() => handleEdit(proyecto.id)}
                          >
                            <Edit2 size={17} />
                          </button>

                          <button
                            type="button"
                            className={`pm2-action power ${
                              proyecto.estado === "inactivo" ? "activate" : ""
                            }`}
                            title={
                              proyecto.estado === "inactivo"
                                ? "Activar proyecto"
                                : "Desactivar proyecto"
                            }
                            disabled={stateBusyId === proyecto.id}
                            onClick={() => handleToggleState(proyecto)}
                          >
                            <Power size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="pm2-pagination">
          <span>
            Mostrando {shownFrom} a {shownTo} de {total} proyectos
          </span>

          <div>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              ‹
            </button>

            <strong>{page}</strong>

            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
            >
              ›
            </button>
          </div>
        </footer>
      </section>

      <div className="pm2-domain-note">
        <Info size={22} />
        <div>
          <strong>Dominio del proyecto</strong>
          <p>
            El dominio principal determina el correo administrado de los usuarios
            cuyo proyecto principal utiliza gestión automática de correo.
          </p>
        </div>
      </div>

      {showCreate && (
        <div className="pm2-modal-backdrop" onMouseDown={closeCreate}>
          <div
            className="pm2-modal pm2-create-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="pm2-modal-close"
              onClick={closeCreate}
              disabled={creating}
            >
              <X size={22} />
            </button>

            <div className="pm2-modal-title">
              <div className="pm2-modal-title-icon">
                <Folder size={30} />
              </div>
              <div>
                <h2>Crear nuevo proyecto</h2>
                <p>Configura un espacio de trabajo para tu equipo.</p>
              </div>
            </div>

            <form onSubmit={handleCreate}>
              <div className="pm2-create-grid">
                <div className="pm2-form-side">
                  <label className="pm2-field">
                    <span>Nombre del proyecto</span>
                    <input
                      value={form.nombre}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          nombre: event.target.value,
                        }))
                      }
                      placeholder="Ej. VISTATRADE RET"
                      maxLength={100}
                    />
                  </label>

                  <label className="pm2-field">
                    <span>Dominio del proyecto</span>
                    <div className="pm2-domain-input">
                      <Globe size={18} />
                      <input
                        value={form.dominio}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            dominio: event.target.value,
                          }))
                        }
                        placeholder="Ej. vistatrade.com"
                      />
                    </div>
                    <small>
                      El backend verificará que el dominio no pertenezca a otra instancia.
                    </small>
                  </label>

                  <label className="pm2-field">
                    <span>Descripción</span>
                    <textarea
                      value={form.descripcion}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          descripcion: event.target.value,
                        }))
                      }
                      placeholder="Describe el objetivo o uso del proyecto..."
                      maxLength={200}
                    />
                    <small className="pm2-counter">
                      {form.descripcion.length}/200
                    </small>
                  </label>

                  <div className="pm2-field">
                    <span>Tipo de proyecto</span>
                    <div className="pm2-type-grid">
                      {PROJECT_TYPES.map((type) => {
                        const Icon = type.icon;
                        return (
                          <button
                            type="button"
                            key={type.value}
                            className={
                              form.tipo === type.value ? "selected" : ""
                            }
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                tipo: type.value,
                              }))
                            }
                          >
                            <Icon size={21} />
                            <strong>{type.label}</strong>
                            <small>{type.description}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pm2-field">
                    <span>Color / Identidad visual</span>
                    <div className="pm2-colors">
                      {PROJECT_COLORS.map((color) => (
                        <button
                          type="button"
                          key={color}
                          className={
                            form.color === color ? "selected" : ""
                          }
                          style={{ background: color }}
                          onClick={() =>
                            setForm((prev) => ({ ...prev, color }))
                          }
                          aria-label={`Seleccionar color ${color}`}
                        >
                          {form.color === color ? "✓" : ""}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pm2-field">
                    <span>Ícono del proyecto</span>
                    <div className="pm2-icons">
                      {PROJECT_ICONS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            type="button"
                            key={item.value}
                            className={
                              form.icono === item.value ? "selected" : ""
                            }
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                icono: item.value,
                              }))
                            }
                          >
                            <Icon size={21} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="pm2-field">
                    <span>Estado del proyecto</span>
                    <select
                      value={form.estado}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          estado: event.target.value,
                        }))
                      }
                    >
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                    </select>
                  </label>

                  <ProjectMembersManager
                    mode="create"
                    selectedIds={createMemberIds}
                    onSelectedIdsChange={setCreateMemberIds}
                  />

                  {formError && (
                    <div className="pm2-form-error">{formError}</div>
                  )}
                </div>

                <aside className="pm2-preview">
                  <h3>Vista previa del proyecto</h3>

                  <div className="pm2-preview-card">
                    <div
                      className="pm2-preview-icon"
                      style={{
                        background: `linear-gradient(135deg, ${form.color}, #713cff)`,
                      }}
                    >
                      <ProjectIcon icon={form.icono} size={38} />
                    </div>

                    <h2>{form.nombre.trim() || "NUEVO PROYECTO"}</h2>

                    <span
                      className={`pm2-status ${
                        form.estado === "inactivo"
                          ? "is-inactive"
                          : "is-active"
                      }`}
                    >
                      <i />
                      {form.estado === "inactivo" ? "Inactivo" : "Activo"}
                    </span>

                    <div className="pm2-preview-row">
                      <Users size={21} />
                      <div>
                        <strong>0</strong>
                        <small>Usuarios iniciales</small>
                      </div>
                    </div>

                    <div className="pm2-preview-row">
                      {React.createElement(selectedType.icon, { size: 21 })}
                      <div>
                        <strong>{selectedType.label}</strong>
                        <small>Tipo de proyecto</small>
                      </div>
                    </div>

                    <div className="pm2-preview-row full">
                      <Globe size={21} />
                      <div>
                        <small>Dominio</small>
                        <strong>
                          {normalizeDomain(form.dominio) || "sin-dominio.com"}
                        </strong>
                      </div>
                    </div>

                    <div className="pm2-preview-description">
                      <small>Descripción</small>
                      <p>
                        {form.descripcion.trim() ||
                          "Describe el objetivo o uso del proyecto..."}
                      </p>
                    </div>
                  </div>
                </aside>
              </div>

              <div className="pm2-modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={closeCreate}
                  disabled={creating}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="primary"
                  disabled={creating}
                >
                  {creating ? "Creando..." : "Crear proyecto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(selectedProject || detailLoading) && (
        <div
          className="pm2-modal-backdrop"
          onMouseDown={() => !detailLoading && setSelectedProject(null)}
        >
          <div
            className="pm2-modal pm2-detail-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="pm2-modal-close"
              onClick={() => setSelectedProject(null)}
            >
              <X size={22} />
            </button>

            {detailLoading ? (
              <div className="pm2-detail-loading">
                Cargando proyecto...
              </div>
            ) : (
              <>
                <div className="pm2-modal-title">
                  <div
                    className="pm2-modal-title-icon"
                    style={{
                      background: `linear-gradient(135deg, ${
                        selectedProject?.color || "#168cff"
                      }, #713cff)`,
                    }}
                  >
                    <ProjectIcon
                      icon={selectedProject?.icono}
                      size={29}
                    />
                  </div>

                  <div>
                    <h2>{selectedProject?.nombre}</h2>
                    <p>Detalle del proyecto</p>
                  </div>
                </div>

                <div className="pm2-detail-grid">
                  <div>
                    <span>Dominio</span>
                    <strong>
                      {selectedProject?.dominio || "Sin dominio"}
                    </strong>
                  </div>

                  <div>
                    <span>Usuarios</span>
                    <strong>{selectedProject?.usuarios ?? 0}</strong>
                  </div>

                  <div>
                    <span>Tipo</span>
                    <strong>{selectedProject?.tipo || "—"}</strong>
                  </div>

                  <div>
                    <span>Estado</span>
                    <strong>{selectedProject?.estado || "—"}</strong>
                  </div>

                  <div className="wide">
                    <span>Descripción</span>
                    <strong>
                      {selectedProject?.descripcion || "Sin descripción"}
                    </strong>
                  </div>
                </div>

                <div className="pm2-modal-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSelectedProject(null)}
                  >
                    Cerrar
                  </button>

                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const proyectoId = selectedProject?.id;
                      setSelectedProject(null);

                      if (proyectoId) {
                        handleEdit(proyectoId);
                      }
                    }}
                  >
                    Editar proyecto
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {(editingProject || editLoading) && (
        <div
          className="pm2-modal-backdrop"
          onMouseDown={closeEdit}
        >
          <div
            className="pm2-modal pm2-edit-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="pm2-modal-close"
              onClick={closeEdit}
              disabled={savingEdit || changingDomain}
            >
              <X size={22} />
            </button>

            {editLoading ? (
              <div className="pm2-detail-loading">
                Cargando proyecto...
              </div>
            ) : (
              <>
                <div className="pm2-modal-title">
                  <div
                    className="pm2-modal-title-icon"
                    style={{
                      background: `linear-gradient(135deg, ${
                        editForm.color || "#168cff"
                      }, #713cff)`,
                    }}
                  >
                    <Edit2 size={29} />
                  </div>

                  <div>
                    <h2>Editar proyecto</h2>
                    <p>
                      Modifica la información del proyecto.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubmitEdit}>
                  <div className="pm2-create-grid">
                    <div className="pm2-form-side">
                      <label className="pm2-field">
                        <span>Nombre del proyecto</span>
                        <input
                          value={editForm.nombre}
                          onChange={(event) =>
                            setEditForm((prev) => ({
                              ...prev,
                              nombre: event.target.value,
                            }))
                          }
                          maxLength={100}
                        />

                        <small>
                          El nombre identifica al proyecto en la plataforma
                          y no cambia por sí solo el dominio ni los correos.
                        </small>
                      </label>

                      <label className="pm2-field">
                        <span>Dominio del proyecto</span>

                        <div className="pm2-domain-input">
                          <Globe size={18} />

                          <input
                            value={editForm.dominio}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                dominio: event.target.value,
                              }))
                            }
                            placeholder="Ej. vistatrade.com"
                          />
                        </div>
                      </label>

                      {normalizeDomain(editForm.dominio || "") !==
                        normalizeDomain(editingProject?.dominio || "") && (
                        <div className="pm2-domain-change-hint">
                          <Globe size={19} />

                          <div>
                            <strong>
                              El dominio será tratado como un cambio especial
                            </strong>

                            <span>
                              Antes de modificarlo se comprobarán los correos
                              gestionados, usuarios excluidos y posibles
                              conflictos.
                            </span>
                          </div>
                        </div>
                      )}

                      <label className="pm2-field">
                        <span>Descripción</span>

                        <textarea
                          value={editForm.descripcion}
                          onChange={(event) =>
                            setEditForm((prev) => ({
                              ...prev,
                              descripcion: event.target.value,
                            }))
                          }
                          maxLength={200}
                        />

                        <small className="pm2-counter">
                          {editForm.descripcion.length}/200
                        </small>
                      </label>

                      <div className="pm2-edit-row">
                        <label className="pm2-field">
                          <span>Tipo de proyecto</span>

                          <select
                            value={editForm.tipo}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                tipo: event.target.value,
                              }))
                            }
                          >
                            {PROJECT_TYPES.map((type) => (
                              <option
                                key={type.value}
                                value={type.value}
                              >
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="pm2-field">
                          <span>Estado del proyecto</span>

                          <select
                            value={editForm.estado}
                            onChange={(event) =>
                              setEditForm((prev) => ({
                                ...prev,
                                estado: event.target.value,
                              }))
                            }
                          >
                            <option value="activo">
                              Activo
                            </option>

                            <option value="inactivo">
                              Inactivo
                            </option>
                          </select>
                        </label>
                      </div>

                      <div className="pm2-field">
                        <span>Color / Identidad visual</span>

                        <div className="pm2-colors">
                          {PROJECT_COLORS.map((color) => (
                            <button
                              type="button"
                              key={color}
                              className={
                                editForm.color === color
                                  ? "selected"
                                  : ""
                              }
                              style={{ background: color }}
                              onClick={() =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  color,
                                }))
                              }
                            >
                              {editForm.color === color
                                ? "✓"
                                : ""}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pm2-field">
                        <span>Ícono del proyecto</span>

                        <div className="pm2-icons">
                          {PROJECT_ICONS.map((item) => {
                            const Icon = item.icon;

                            return (
                              <button
                                type="button"
                                key={item.value}
                                className={
                                  editForm.icono === item.value
                                    ? "selected"
                                    : ""
                                }
                                onClick={() =>
                                  setEditForm((prev) => ({
                                    ...prev,
                                    icono: item.value,
                                  }))
                                }
                              >
                                <Icon size={21} />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <ProjectMembersManager
                        mode="edit"
                        projectId={editingProject?.id}
                        onCountChange={(count) => {
                          setEditingProject((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  usuarios: count,
                                }
                              : prev
                          );
                        }}
                      />

                      {editError && (
                        <div className="pm2-form-error">
                          {editError}
                        </div>
                      )}
                    </div>

                    <aside className="pm2-preview">
                      <h3>Vista previa del proyecto</h3>

                      <div className="pm2-preview-card">
                        <div
                          className="pm2-preview-icon"
                          style={{
                            background: `linear-gradient(135deg, ${
                              editForm.color || "#168cff"
                            }, #713cff)`,
                          }}
                        >
                          <ProjectIcon
                            icon={editForm.icono}
                            size={38}
                          />
                        </div>

                        <h2>
                          {editForm.nombre.trim() ||
                            "PROYECTO"}
                        </h2>

                        <span
                          className={`pm2-status ${
                            editForm.estado === "inactivo"
                              ? "is-inactive"
                              : "is-active"
                          }`}
                        >
                          <i />
                          {editForm.estado === "inactivo"
                            ? "Inactivo"
                            : "Activo"}
                        </span>

                        <div className="pm2-preview-row">
                          <Users size={21} />

                          <div>
                            <strong>
                              {editingProject?.usuarios ?? 0}
                            </strong>
                            <small>Usuarios</small>
                          </div>
                        </div>

                        <div className="pm2-preview-row">
                          <Activity size={21} />

                          <div>
                            <strong>
                              {
                                PROJECT_TYPES.find(
                                  (type) =>
                                    type.value === editForm.tipo
                                )?.label
                              }
                            </strong>

                            <small>Tipo de proyecto</small>
                          </div>
                        </div>

                        <div className="pm2-preview-row full">
                          <Globe size={21} />

                          <div>
                            <small>Dominio</small>

                            <strong>
                              {normalizeDomain(
                                editForm.dominio
                              ) || "Sin dominio"}
                            </strong>
                          </div>
                        </div>

                        <div className="pm2-preview-description">
                          <small>Descripción</small>

                          <p>
                            {editForm.descripcion.trim() ||
                              "Sin descripción"}
                          </p>
                        </div>
                      </div>
                    </aside>
                  </div>

                  <div className="pm2-modal-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={closeEdit}
                      disabled={
                        savingEdit ||
                        domainImpactLoading ||
                        changingDomain
                      }
                    >
                      Cancelar
                    </button>

                    <button
                      type="submit"
                      className="primary"
                      disabled={
                        savingEdit ||
                        domainImpactLoading ||
                        changingDomain
                      }
                    >
                      {domainImpactLoading
                        ? "Analizando dominio..."
                        : savingEdit
                          ? "Guardando..."
                          : "Guardar cambios"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {domainImpact && editingProject && (
        <div
          className="pm2-modal-backdrop pm2-impact-backdrop"
          onMouseDown={() => {
            if (!changingDomain) {
              setDomainImpact(null);
            }
          }}
        >
          <div
            className="pm2-modal pm2-impact-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="pm2-modal-close"
              disabled={changingDomain}
              onClick={() => setDomainImpact(null)}
            >
              <X size={22} />
            </button>

            <div className="pm2-impact-warning-icon">
              <Info size={34} />
            </div>

            <div className="pm2-impact-title">
              <h2>Confirmar cambio de dominio</h2>

              <p>
                Revisa el impacto antes de modificar el dominio
                del proyecto.
              </p>
            </div>

            <div className="pm2-domain-comparison">
              <div>
                <span>Dominio actual</span>
                <strong>
                  {editingProject.dominio || "Sin dominio"}
                </strong>
              </div>

              <b>→</b>

              <div>
                <span>Nuevo dominio</span>
                <strong>
                  {normalizeDomain(editForm.dominio)}
                </strong>
              </div>
            </div>

            <div className="pm2-impact-counts">
              <div>
                <span>Usuarios principales</span>
                <strong>
                  {domainImpact?.impacto
                    ?.usuarios_principales ?? 0}
                </strong>
              </div>

              <div>
                <span>Correos gestionados</span>
                <strong>
                  {domainImpact?.impacto
                    ?.usuarios_gestionados ?? 0}
                </strong>
              </div>

              <div>
                <span>Se actualizarán</span>
                <strong>
                  {domainImpact?.impacto
                    ?.usuarios_actualizables ?? 0}
                </strong>
              </div>

              <div>
                <span>Excluidos</span>
                <strong>
                  {domainImpact?.impacto
                    ?.usuarios_excluidos ?? 0}
                </strong>
              </div>
            </div>

            <div className="pm2-impact-info">
              <Info size={20} />

              <div>
                <strong>
                  Los correos gestionados se actualizarán
                  automáticamente.
                </strong>

                <span>
                  Los usuarios especiales o históricos marcados
                  como no gestionados permanecerán sin cambios.
                </span>
              </div>
            </div>

            {Array.isArray(domainImpact.conflictos) &&
              domainImpact.conflictos.length > 0 && (
                <div className="pm2-impact-conflicts">
                  <strong>
                    Se encontraron{" "}
                    {domainImpact.conflictos.length} conflicto
                    {domainImpact.conflictos.length === 1
                      ? ""
                      : "s"}
                  </strong>

                  {domainImpact.conflictos.map(
                    (conflict, index) => (
                      <div
                        className="pm2-conflict-row"
                        key={`${conflict.tipo}-${index}`}
                      >
                        <span>
                          {conflict.tipo ||
                            "CONFLICTO"}
                        </span>

                        <p>
                          {conflict.mensaje ||
                            "El cambio de dominio no puede realizarse."}
                        </p>

                        {conflict.correo_nuevo && (
                          <code>
                            {conflict.correo_nuevo}
                          </code>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}

            {editError && (
              <div className="pm2-form-error">
                {editError}
              </div>
            )}

            <div className="pm2-modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={changingDomain}
                onClick={() => setDomainImpact(null)}
              >
                Volver
              </button>

              <button
                type="button"
                className="primary"
                disabled={
                  !domainImpact.puede_confirmar ||
                  changingDomain
                }
                onClick={handleConfirmDomainChange}
              >
                {changingDomain
                  ? "Cambiando dominio..."
                  : domainImpact.puede_confirmar
                    ? "Sí, cambiar dominio"
                    : "No se puede cambiar"}
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
};

export default ProjectManagement;
