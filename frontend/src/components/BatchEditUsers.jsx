import { useEffect, useMemo, useState } from "react";
import { getAvatarUrl } from "../utils/url";
import "bootstrap-icons/font/bootstrap-icons.css";

const DEFAULT_PERMISSIONS = {
  crear_grupos: 0,
  editar_mensajes: 0,
  enviar_audios: 0,
  eliminar_mensajes: 0,
  buscar_mensajes: 0,
  eliminar_cualquier_mensaje: 0,
};

const PERMISSION_OPTIONS = [
  { key: "crear_grupos", label: "Crear grupos", icon: "bi bi-people" },
  { key: "editar_mensajes", label: "Editar mensajes", icon: "bi bi-pencil-square" },
  { key: "enviar_audios", label: "Grabar audios", icon: "bi bi-mic" },
  { key: "eliminar_mensajes", label: "Eliminar sus mensajes", icon: "bi bi-trash" },
  { key: "buscar_mensajes", label: "Buscar mensajes", icon: "bi bi-search" },
  { key: "eliminar_cualquier_mensaje", label: "Eliminar cualquier mensaje", icon: "bi bi-shield-exclamation" },
];

const getProjectName = (project) => String(project?.nombre || project?.name || "").trim();
const getRoleName = (role) => String(role?.nombre || role?.name || "").trim();

function SectionToggle({ checked, onChange, label }) {
  return (
    <label className="qc-batch-toggle" title={`${checked ? "Desactivar" : "Activar"} ${label}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" />
      <span className="visually-hidden">{checked ? "Desactivar" : "Activar"} {label}</span>
    </label>
  );
}

function BatchAvatar({ user }) {
  const name = `${user?.nombre || ""} ${user?.apellido || ""}`.trim();
  const initial = user?.nombre?.charAt(0)?.toUpperCase() || user?.usuario?.charAt(0)?.toUpperCase() || "?";
  return user?.url_imagen ? (
    <img className="qc-batch-user-avatar" src={getAvatarUrl(user.url_imagen)} alt={name || "Usuario"} />
  ) : (
    <span className="qc-batch-user-avatar qc-batch-user-avatar-fallback" style={{ background: user?.background || undefined }}>{initial}</span>
  );
}

export default function BatchEditUsers({ selectedUsers, onBack, onSaved }) {
  const [projects, setProjects] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [enabled, setEnabled] = useState({
    project: true,
    password: false,
    role: true,
    permissions: false,
  });

  const [projectId, setProjectId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);

  useEffect(() => {
    let cancelled = false;
    setLoadingCatalogs(true);

    Promise.all([
      fetch("/api/usuarios/admin/projects", { credentials: "include" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los proyectos");
        return Array.isArray(data?.proyectos) ? data.proyectos : [];
      }),
      fetch("/api/roles/assignable", { credentials: "include" }).then(async (response) => {
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error("No se pudieron cargar los roles");
        return Array.isArray(data?.roles) ? data.roles : [];
      }),
    ])
      .then(([projectRows, roleRows]) => {
        if (cancelled) return;
        setProjects(projectRows);
        setRoles(roleRows);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || "No se pudieron cargar los datos necesarios");
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalogs(false);
      });

    return () => { cancelled = true; };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => Number(project.id) === Number(projectId)) || null,
    [projects, projectId]
  );
  const selectedRole = useMemo(
    () => roles.find((role) => Number(role.id) === Number(roleId)) || null,
    [roles, roleId]
  );
  const permissionCount = useMemo(
    () => Object.values(permissions).filter((value) => Number(value) === 1).length,
    [permissions]
  );

  const previewUsers = selectedUsers.slice(0, 5);
  const remainingUsers = Math.max(0, selectedUsers.length - previewUsers.length);

  const setSection = (section, value) => {
    setEnabled((current) => ({ ...current, [section]: value }));
    setError("");
  };

  const togglePermission = (key) => {
    setPermissions((current) => ({ ...current, [key]: Number(current[key]) === 1 ? 0 : 1 }));
  };

  const validate = () => {
    if (!selectedUsers.length) return "No hay usuarios seleccionados.";
    if (!Object.values(enabled).some(Boolean)) return "Activa al menos una sección para aplicar cambios.";
    if (enabled.project && !Number(projectId)) return "Selecciona un proyecto principal o desactiva esa sección.";
    if (enabled.password && !String(password).trim()) return "Ingresa la contraseña del lote o desactiva esa sección.";
    if (enabled.role && !Number(roleId)) return "Selecciona un rol o desactiva esa sección.";
    return "";
  };

  const saveChanges = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const changes = {
      project: { enabled: enabled.project },
      password: { enabled: enabled.password },
      role: { enabled: enabled.role },
      chat_permissions: { enabled: enabled.permissions },
    };

    if (enabled.project) changes.project.proyecto_principal_id = Number(projectId);
    if (enabled.password) changes.password.contrasena = password;
    if (enabled.role) changes.role.rol_id = Number(roleId);
    if (enabled.permissions) changes.chat_permissions.permisos_chat = permissions;

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/usuarios/admin/batch", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: selectedUsers.map((user) => Number(user.id)),
          changes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudieron guardar los cambios del lote");
      await onSaved(data);
    } catch (saveError) {
      setError(saveError.message || "No se pudieron guardar los cambios del lote");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="qc-users-page qc-batch-page">
      <div className="qc-users-bg-decor" aria-hidden="true">
        <span className="qc-users-orb qc-users-orb-one" />
        <span className="qc-users-orb qc-users-orb-two" />
        <span className="qc-users-chat-line qc-users-chat-line-one" />
        <i className="bi bi-chat-dots qc-users-floating-icon qc-users-floating-icon-one" />
      </div>

      <header className="qc-batch-topbar">
        <div>
          <span className="qc-batch-kicker">USUARIOS</span>
          <div className="qc-batch-title-row">
            <h1 className="qc-users-title">Editar lote</h1>
            <span className="qc-users-count-pill">{selectedUsers.length} {selectedUsers.length === 1 ? "usuario seleccionado" : "usuarios seleccionados"}</span>
          </div>
          <p className="qc-users-subtitle">Aplica cambios masivos a los usuarios seleccionados de forma rápida y segura.</p>
        </div>
        <button type="button" className="qc-batch-back-btn" onClick={onBack}><i className="bi bi-arrow-left" /> Volver a la lista</button>
      </header>

      <section className="qc-batch-selected-card">
        <span className="qc-batch-card-icon"><i className="bi bi-people" /></span>
        <div className="qc-batch-selected-copy">
          <h2>Usuarios seleccionados</h2>
          <p>Se aplicarán los mismos cambios solo a los usuarios seleccionados en las secciones habilitadas.</p>
        </div>
        <div className="qc-batch-selected-users">
          {previewUsers.map((user) => {
            const name = `${user?.nombre || ""} ${user?.apellido || ""}`.trim();
            return (
              <div className="qc-batch-user-mini" key={user.id}>
                <BatchAvatar user={user} />
                <strong>{name || user?.usuario || "Usuario"}</strong>
              </div>
            );
          })}
          {remainingUsers > 0 && <><span className="qc-batch-more-avatar">+{remainingUsers}</span><span className="qc-batch-more-copy">Y {remainingUsers} {remainingUsers === 1 ? "usuario más" : "usuarios más"}</span></>}
        </div>
      </section>

      {error && <div className="qc-batch-error" role="alert"><i className="bi bi-exclamation-triangle" /> {error}</div>}

      <div className="qc-batch-layout">
        <div className="qc-batch-main-column">
          <section className={`qc-batch-section ${enabled.project ? "is-enabled" : "is-disabled"}`}>
            <div className="qc-batch-section-head">
              <SectionToggle checked={enabled.project} onChange={(value) => setSection("project", value)} label="Proyecto principal" />
              <span className="qc-batch-section-icon"><i className="bi bi-folder" /></span>
              <div><h3>Proyecto principal</h3><p>Define el proyecto al que se asignarán los usuarios seleccionados.</p></div>
            </div>
            <div className="qc-batch-project-grid qc-batch-controls" aria-disabled={!enabled.project}>
              <label><span>Proyecto principal</span><select disabled={!enabled.project || loadingCatalogs} value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Selecciona un proyecto</option>{projects.map((project) => <option value={project.id} key={project.id}>{getProjectName(project)}</option>)}</select></label>
              <label><span>Dominio resultante</span><div className="qc-batch-domain"><i className="bi bi-globe2" /><strong>{selectedProject?.dominio || "Selecciona un proyecto"}</strong></div></label>
              <div className="qc-batch-info"><i className="bi bi-info-circle" /><span>Solo se cambiará el proyecto de los usuarios seleccionados. Los usuarios de otros proyectos no se verán afectados.</span></div>
            </div>
          </section>

          <section className={`qc-batch-section ${enabled.password ? "is-enabled" : "is-disabled"}`}>
            <div className="qc-batch-section-head">
              <SectionToggle checked={enabled.password} onChange={(value) => setSection("password", value)} label="Contraseña del lote" />
              <span className="qc-batch-section-icon"><i className="bi bi-lock" /></span>
              <div><h3>Contraseña del lote</h3><p>Define la contraseña que se aplicará a todos los usuarios seleccionados.</p></div>
            </div>
            <div className="qc-batch-password-grid qc-batch-controls" aria-disabled={!enabled.password}>
              <div className="qc-batch-same-password"><i className="bi bi-check-square" /><div><strong>Aplicar la misma contraseña</strong><span>Todos los usuarios seleccionados recibirán esta contraseña.</span></div></div>
              <label className="qc-batch-password-field"><span>Nueva contraseña</span><div><input disabled={!enabled.password} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Ingrese la nueva contraseña" /><button type="button" disabled={!enabled.password} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}><i className={`bi ${showPassword ? "bi-eye-slash" : "bi-eye"}`} /></button></div></label>
              <div className="qc-batch-recommend"><strong><i className="bi bi-info-circle" /> Recomendaciones</strong><ul><li>Usa al menos 8 caracteres</li><li>Combina letras, números y símbolos</li><li>La contraseña reemplazará la actual únicamente si esta sección está habilitada</li></ul></div>
            </div>
          </section>

          <section className={`qc-batch-section ${enabled.role ? "is-enabled" : "is-disabled"}`}>
            <div className="qc-batch-section-head">
              <SectionToggle checked={enabled.role} onChange={(value) => setSection("role", value)} label="Rol y permisos" />
              <span className="qc-batch-section-icon"><i className="bi bi-person-gear" /></span>
              <div><h3>Rol y permisos</h3><p>Se aplicará el mismo rol a todos los usuarios seleccionados.</p></div>
            </div>
            <div className="qc-batch-role-grid qc-batch-controls" aria-disabled={!enabled.role}>
              {roles.map((role, index) => {
                const selected = Number(roleId) === Number(role.id);
                const icons = ["bi-shield-check", "bi-tools", "bi-question-circle", "bi-person"];
                return <button type="button" disabled={!enabled.role} key={role.id} className={selected ? "is-selected" : ""} onClick={() => setRoleId(String(role.id))}><i className={`bi ${icons[index % icons.length]}`} /><strong>{getRoleName(role)}</strong><small>{role.descripcion || "Rol del sistema"}</small></button>;
              })}
            </div>
          </section>

          <section className={`qc-batch-section ${enabled.permissions ? "is-enabled" : "is-disabled"}`}>
            <div className="qc-batch-section-head">
              <SectionToggle checked={enabled.permissions} onChange={(value) => setSection("permissions", value)} label="Permisos del chat" />
              <span className="qc-batch-section-icon"><i className="bi bi-chat-square-text" /></span>
              <div><h3>Permisos del chat</h3><p>Selecciona los permisos que se aplicarán a todos los usuarios seleccionados.</p></div>
            </div>
            <div className="qc-batch-permission-grid qc-batch-controls" aria-disabled={!enabled.permissions}>
              {PERMISSION_OPTIONS.map((permission) => {
                const checked = Number(permissions[permission.key]) === 1;
                return <label className={checked ? "is-selected" : ""} key={permission.key}><i className={permission.icon} /><span><strong>{permission.label}</strong><small>Aplicar a {selectedUsers.length} usuarios</small></span><input disabled={!enabled.permissions} type="checkbox" checked={checked} onChange={() => togglePermission(permission.key)} /></label>;
              })}
            </div>
          </section>
        </div>

        <aside className="qc-batch-sidebar">
          <section className="qc-batch-summary-card">
            <div className="qc-batch-summary-head"><span><i className="bi bi-list-check" /></span><div><h3>Cambios a aplicar</h3><p>Resumen de las modificaciones en la selección.</p></div></div>
            <div className="qc-batch-summary-list">
              <div><span><i className="bi bi-folder" /> Proyecto principal</span><strong className={enabled.project && selectedProject ? "has-change" : ""}>{enabled.project ? (getProjectName(selectedProject) || "Pendiente") : "Sin cambios"}</strong></div>
              <div><span><i className="bi bi-lock" /> Contraseña</span><strong className={enabled.password && password ? "has-change" : ""}>{enabled.password ? (password ? "Se actualizará" : "Pendiente") : "Sin cambios"}</strong></div>
              <div><span><i className="bi bi-person-gear" /> Rol</span><strong className={enabled.role && selectedRole ? "has-change" : ""}>{enabled.role ? (getRoleName(selectedRole) || "Pendiente") : "Sin cambios"}</strong></div>
              <div><span><i className="bi bi-chat-square-text" /> Permisos del chat</span><strong className={enabled.permissions ? "has-change" : ""}>{enabled.permissions ? `${permissionCount} de ${PERMISSION_OPTIONS.length} permisos` : "Sin cambios"}</strong></div>
            </div>
            <div className="qc-batch-summary-note"><i className="bi bi-info-circle" /><span>Solo se aplicarán los cambios de las secciones habilitadas. Las secciones deshabilitadas no modificarán la configuración actual de los usuarios seleccionados.</span></div>
          </section>

          <div className="qc-batch-actions">
            <button type="button" className="qc-batch-cancel-btn" onClick={onBack} disabled={saving}>Cancelar</button>
            <button type="button" className="qc-batch-save-btn" onClick={saveChanges} disabled={saving || loadingCatalogs}>{saving ? <><span className="spinner-border spinner-border-sm" /> Guardando...</> : <><i className="bi bi-floppy" /> Guardar cambios</>}</button>
          </div>
        </aside>
      </div>
    </main>
  );
}
