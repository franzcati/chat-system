import { useEffect, useMemo, useState } from "react";
import { getAvatarUrl } from "../utils/url";
import "../css/RoleManagement.css";

const ADMIN_OPTIONS = [
  ["ver_usuarios", "Ver usuarios", "Puede ver la lista de usuarios.", "bi-eye"],
  ["crear_usuarios", "Crear usuarios", "Puede crear nuevos usuarios.", "bi-person-plus"],
  ["editar_usuarios", "Editar usuarios", "Puede editar información de usuarios.", "bi-pencil-square"],
  ["editar_usuarios_lote", "Editar por lote", "Puede editar usuarios en lote.", "bi-people"],
  ["gestionar_permisos_chat", "Gestionar permisos del chat", "Puede configurar permisos del chat.", "bi-shield-check"],
  ["asignar_roles", "Asignar roles", "Puede asignar roles a usuarios.", "bi-person-badge"],
  ["eliminar_usuarios", "Eliminar usuarios", "Puede desactivar usuarios.", "bi-trash3"],
  ["gestionar_proyectos_usuario", "Añadir/quitar de proyecto", "Puede modificar los proyectos de usuarios.", "bi-folder2-open"],
];

const CHAT_OPTIONS = [
  ["chat_crear_grupos", "Crear grupos", "Puede crear grupos en los chats.", "bi-people"],
  ["chat_enviar_audios", "Grabar audios", "Puede grabar y enviar mensajes de audio.", "bi-mic"],
  ["chat_editar_mensajes", "Editar mensajes", "Puede editar sus propios mensajes.", "bi-pencil-square"],
  ["chat_eliminar_mensajes", "Eliminar sus mensajes", "Puede eliminar sus propios mensajes.", "bi-trash3"],
  ["chat_eliminar_cualquier_mensaje", "Eliminar cualquier mensaje", "Puede eliminar mensajes de cualquier usuario.", "bi-shield-exclamation"],
  ["chat_buscar_mensajes", "Buscar mensajes", "Puede buscar en el historial de mensajes.", "bi-search"],
];

const ROLE_ADMIN_OPTIONS = [
  ["gestionar_roles", "Ver gestión de roles"],
  ["crear_roles", "Crear roles"],
  ["editar_roles", "Editar roles"],
  ["eliminar_roles", "Eliminar roles"],
];

const AUDIT_OPTIONS = [
  ["ver_registros", "Ver registros", "Puede acceder al historial de auditoría.", "bi-file-earmark-text"],
  ["ver_registros_admin", "Registros administrativos", "Puede consultar acciones administrativas.", "bi-person-gear"],
  ["ver_registros_chat", "Registros de chat", "Puede consultar eventos de chats privados.", "bi-chat-square-dots"],
  ["ver_registros_grupo", "Registros grupales", "Puede consultar eventos de chats grupales.", "bi-people"],
  ["ver_registros_seguridad", "Registros de seguridad", "Puede revisar actividad de autenticación y seguridad.", "bi-shield-lock"],
  ["ver_blacklist", "Ver blacklist", "Puede revisar detecciones y reglas de blacklist.", "bi-ban"],
  ["gestionar_blacklist", "Gestionar blacklist", "Puede crear, editar y eliminar reglas.", "bi-shield-exclamation"],
  ["exportar_registros", "Exportar registros", "Puede exportar reportes CSV.", "bi-download"],
];

const initials = (name) => String(name || "R").trim().charAt(0).toUpperCase();
const title = (value) => String(value || "").trim().toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
const roleDescription = (role) => role.descripcion || "Rol del sistema con permisos configurables.";

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button type="button" className={`qc-role-toggle ${checked ? "on" : ""}`} onClick={() => !disabled && onChange(!checked)} disabled={disabled} aria-pressed={checked}>
      <span />
    </button>
  );
}

function CheckCard({ checked, onChange, icon, label, description, disabled }) {
  return (
    <label className={`qc-role-check-card ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="qc-role-checkbox"><i className="bi bi-check-lg" /></span>
      {icon && <i className={`bi ${icon} qc-role-check-icon`} />}
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>
  );
}

export default function RoleManagement({ usuarioLogueado, onBackToChat }) {
  const [data, setData] = useState({ roles: [], resumen: {} });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState({ nombre: "", descripcion: "" });

  const perms = new Set(usuarioLogueado?.rol_permisos || []);
  const canCreate = perms.has("crear_roles");
  const canEdit = perms.has("editar_roles");
  const canDelete = perms.has("eliminar_roles");

  const loadRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/roles/manage", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar los roles");
      setData(json);
    } catch (error) {
      alert(error.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadRoles(); }, []);

  const roles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.roles || []).filter((role) => {
      if (q && !`${role.nombre} ${role.descripcion || ""}`.toLowerCase().includes(q)) return false;
      if (scopeFilter && role.alcance_admin !== scopeFilter) return false;
      if (statusFilter && role.estado !== statusFilter) return false;
      return true;
    });
  }, [data.roles, query, scopeFilter, statusFilter]);

  const openRole = async (id, onlyView = false) => {
    try {
      const res = await fetch(`/api/roles/manage/${id}`, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se pudo cargar el rol");
      setSelectedRoleId(Number(id));
      setViewOnly(onlyView);
      setDetail(json);
      setForm({
        descripcion: json.role?.descripcion || "",
        alcance_admin: json.role?.alcance_admin || "proyectos",
        estado: json.role?.estado || "activo",
        permissions: new Set(json.permissions || []),
        assignableRoleIds: new Set((json.assignable_role_ids || []).map(Number)),
        sections: {
          users: ADMIN_OPTIONS.some(([key]) => (json.permissions || []).includes(key)),
          scope: ADMIN_OPTIONS.some(([key]) => (json.permissions || []).includes(key)),
          assign: (json.assignable_role_ids || []).length > 0,
          chat: CHAT_OPTIONS.some(([key]) => (json.permissions || []).includes(key)),
          audit: AUDIT_OPTIONS.some(([key]) => (json.permissions || []).includes(key)),
        },
      });
    } catch (error) { alert(error.message); }
  };

  const togglePermission = (permission, checked) => {
    setForm((prev) => {
      const next = new Set(prev.permissions);
      checked ? next.add(permission) : next.delete(permission);
      return { ...prev, permissions: next };
    });
  };

  const setSectionEnabled = (section, enabled) => {
    setForm((prev) => {
      const next = { ...prev, sections: { ...prev.sections, [section]: enabled } };
      if (!enabled && section === "users") {
        const permissions = new Set(prev.permissions);
        ADMIN_OPTIONS.forEach(([key]) => permissions.delete(key));
        next.permissions = permissions;
      }
      if (!enabled && section === "chat") {
        const permissions = new Set(next.permissions || prev.permissions);
        CHAT_OPTIONS.forEach(([key]) => permissions.delete(key));
        next.permissions = permissions;
      }
      if (!enabled && section === "audit") {
        const permissions = new Set(next.permissions || prev.permissions);
        AUDIT_OPTIONS.forEach(([key]) => permissions.delete(key));
        next.permissions = permissions;
      }
      if (!enabled && section === "assign") next.assignableRoleIds = new Set();
      return next;
    });
  };

  const saveRole = async () => {
    if (!selectedRoleId || !form || viewOnly || !canEdit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/roles/manage/${selectedRoleId}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: form.descripcion,
          alcance_admin: form.alcance_admin,
          estado: form.estado,
          permissions: [...form.permissions],
          assignable_role_ids: [...form.assignableRoleIds],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se pudo guardar el rol");
      await loadRoles();
      await openRole(selectedRoleId, false);
      alert(`Rol actualizado. ${Number(json.usuarios_actualizados || 0)} usuario(s) sincronizado(s).`);
    } catch (error) { alert(error.message); } finally { setSaving(false); }
  };

  const createRole = async () => {
    try {
      const res = await fetch("/api/roles/manage", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newRole) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se pudo crear el rol");
      setNewRoleOpen(false); setNewRole({ nombre: "", descripcion: "" });
      await loadRoles();
      if (json.role_id) openRole(json.role_id, false);
    } catch (error) { alert(error.message); }
  };

  const deleteRole = async (role) => {
    if (!canDelete || Number(role.es_sistema) === 1) return;
    if (!window.confirm(`¿Eliminar el rol ${role.nombre}?`)) return;
    const res = await fetch(`/api/roles/manage/${role.id}`, { method: "DELETE", credentials: "include" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json.error || "No se pudo eliminar el rol");
    loadRoles();
  };

  if (selectedRoleId && detail && form) {
    const role = detail.role;
    const isAdmin = String(role.nombre).toLowerCase() === "admin";
    const adminSelected = ADMIN_OPTIONS.filter(([key]) => form.permissions.has(key)).length;
    const chatSelected = CHAT_OPTIONS.filter(([key]) => form.permissions.has(key)).length;
    const auditSelected = AUDIT_OPTIONS.filter(([key]) => form.permissions.has(key)).length;
    return (
      <main className="qc-roles-page qc-role-edit-page">
        <div className="qc-roles-bg" aria-hidden="true" />
        <header className="qc-role-edit-top">
          <div><span className="qc-role-eyebrow">ROLES</span><div className="qc-role-title-row"><h1>{viewOnly ? "Ver rol" : "Editar rol"}</h1><span className="qc-role-name-pill">{role.nombre}</span></div><p>Configura los permisos y el alcance de este rol.</p></div>
          <button className="qc-role-back" onClick={() => { setSelectedRoleId(null); setDetail(null); }}><i className="bi bi-arrow-left" /> Volver a la lista</button>
        </header>

        <section className="qc-role-users-strip">
          <div className="qc-role-section-icon"><i className="bi bi-people" /></div>
          <div className="qc-role-users-copy"><strong>Usuarios con este rol</strong><small>Estos usuarios tienen actualmente el rol {role.nombre} asignado.</small></div>
          <div className="qc-role-user-preview">
            {(detail.users || []).slice(0, 4).map((u) => <div className="qc-role-preview-user" key={u.id}><span className="qc-role-avatar">{u.url_imagen ? <img src={getAvatarUrl(u.url_imagen)} alt="" /> : initials(u.nombre)}</span><strong>{title(`${u.nombre || ""} ${u.apellido || ""}`)}</strong></div>)}
            {(detail.users || []).length > 4 && <><span className="qc-role-more">+{detail.users.length - 4}</span><small>Y {detail.users.length - 4} usuarios más</small></>}
          </div>
        </section>

        <div className="qc-role-edit-grid">
          <div className="qc-role-edit-main">
            <section className="qc-role-config-card">
              <div className="qc-role-config-head"><Toggle checked={form.sections.users} onChange={(v) => setSectionEnabled("users", v)} disabled={viewOnly || isAdmin} /><span className="qc-role-section-icon"><i className="bi bi-person-gear" /></span><div><h3>Acceso a gestión de usuarios</h3><p>Define qué acciones de administración de usuarios puede realizar este rol.</p></div></div>
              <div className="qc-role-options-grid four">{ADMIN_OPTIONS.map(([key,label,desc,icon]) => <CheckCard key={key} checked={form.permissions.has(key)} onChange={(v) => togglePermission(key, v)} icon={icon} label={label} description={desc} disabled={viewOnly || isAdmin || !form.sections.users} />)}</div>
            </section>

            <section className="qc-role-config-card">
              <div className="qc-role-config-head"><Toggle checked={form.sections.scope} onChange={(v) => setSectionEnabled("scope", v)} disabled={viewOnly || isAdmin} /><span className="qc-role-section-icon"><i className="bi bi-bullseye" /></span><div><h3>Alcance de administración</h3><p>Define qué usuarios puede administrar este rol.</p></div></div>
              <div className="qc-role-scope-grid">
                {[['organizacion','Toda la organización','Puede gestionar todos los usuarios de todos los proyectos y dominios.'],['proyectos','Solo usuarios de sus proyectos','Puede gestionar únicamente los usuarios de los proyectos en los que tiene acceso.']].map(([value,label,desc]) => <button key={value} type="button" disabled={viewOnly || isAdmin || !form.sections.scope} onClick={() => setForm((p) => ({ ...p, alcance_admin: value }))} className={`qc-role-scope-option ${form.alcance_admin === value ? 'selected' : ''}`}><span className="qc-role-radio" /><span><strong>{label}</strong><small>{desc}</small></span></button>)}
              </div>
            </section>

            <section className="qc-role-config-card">
              <div className="qc-role-config-head"><Toggle checked={form.sections.assign} onChange={(v) => setSectionEnabled("assign", v)} disabled={viewOnly || isAdmin} /><span className="qc-role-section-icon"><i className="bi bi-shield-check" /></span><div><h3>Roles que puede asignar</h3><p>Define qué roles puede asignar este rol a otros usuarios.</p></div></div>
              <div className="qc-role-options-grid four">{(data.roles || []).map((r) => <CheckCard key={r.id} checked={form.assignableRoleIds.has(Number(r.id))} onChange={(v) => setForm((prev) => { const next=new Set(prev.assignableRoleIds); v?next.add(Number(r.id)):next.delete(Number(r.id)); return {...prev, assignableRoleIds:next}; })} icon={String(r.nombre).toLowerCase()==='admin'?'bi-shield':'bi-person'} label={r.nombre} description="Rol del sistema" disabled={viewOnly || isAdmin || !form.sections.assign} />)}</div>
            </section>

            <section className="qc-role-config-card">
              <div className="qc-role-config-head"><Toggle checked={form.sections.chat} onChange={(v) => setSectionEnabled("chat", v)} disabled={viewOnly || isAdmin} /><span className="qc-role-section-icon"><i className="bi bi-chat-square-text" /></span><div><h3>Permisos del chat</h3><p>Selecciona los permisos que tendrá este rol en los chats.</p></div></div>
              <div className="qc-role-options-grid three">{CHAT_OPTIONS.map(([key,label,desc,icon]) => <CheckCard key={key} checked={form.permissions.has(key)} onChange={(v) => togglePermission(key, v)} icon={icon} label={label} description={desc} disabled={viewOnly || isAdmin || !form.sections.chat} />)}</div>
            </section>

            <section className="qc-role-config-card">
              <div className="qc-role-config-head"><Toggle checked={form.sections.audit} onChange={(v) => setSectionEnabled("audit", v)} disabled={viewOnly || isAdmin} /><span className="qc-role-section-icon"><i className="bi bi-file-earmark-text" /></span><div><h3>Registros y auditoría</h3><p>Controla el acceso al historial, seguridad, blacklist y exportación.</p></div></div>
              <div className="qc-role-options-grid four">{AUDIT_OPTIONS.map(([key,label,desc,icon]) => <CheckCard key={key} checked={form.permissions.has(key)} onChange={(v) => togglePermission(key, v)} icon={icon} label={label} description={desc} disabled={viewOnly || isAdmin || !form.sections.audit} />)}</div>
            </section>

            {canEdit && !viewOnly && <section className="qc-role-config-card qc-role-extra-card"><div><h3>Permisos de Gestión de Roles</h3><p>Controla quién puede administrar esta misma sección.</p></div><div className="qc-role-inline-checks">{ROLE_ADMIN_OPTIONS.map(([key,label]) => <label key={key}><input type="checkbox" checked={form.permissions.has(key)} onChange={(e)=>togglePermission(key,e.target.checked)} disabled={isAdmin}/><span>{label}</span></label>)}</div></section>}
          </div>

          <aside className="qc-role-summary">
            <div className="qc-role-summary-head"><span className="qc-role-section-icon"><i className="bi bi-card-checklist" /></span><div><h3>Resumen del rol</h3><p>Vista general de la configuración actual.</p></div></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-person-badge" /> Nombre del rol</span><strong className="qc-role-name-pill">{role.nombre}</strong></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-people" /> Usuarios asignados</span><strong>{detail.users?.length || 0}</strong></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-bullseye" /> Alcance de administración</span><strong>{form.alcance_admin === 'organizacion' ? 'Toda la organización' : 'Solo sus proyectos'}</strong></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-person-gear" /> Gestión de usuarios</span><strong>{adminSelected} de {ADMIN_OPTIONS.length}</strong></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-shield-check" /> Roles asignables</span><strong>{form.assignableRoleIds.size} de {data.roles?.length || 0}</strong></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-chat-square-text" /> Permisos del chat</span><strong>{chatSelected} de {CHAT_OPTIONS.length}</strong></div>
            <div className="qc-role-summary-row"><span><i className="bi bi-file-earmark-text" /> Registros y auditoría</span><strong>{auditSelected} de {AUDIT_OPTIONS.length}</strong></div>
            <div className="qc-role-summary-note"><i className="bi bi-info-circle" /><span>Los cambios se aplicarán inmediatamente a los usuarios que tienen este rol. La autorización sensible también se valida en backend.</span></div>
            <div className="qc-role-summary-actions"><button onClick={() => { setSelectedRoleId(null); setDetail(null); }} className="secondary">Cancelar</button>{!viewOnly && canEdit && <button onClick={saveRole} disabled={saving} className="primary"><i className="bi bi-floppy" /> {saving ? 'Guardando...' : 'Guardar cambios'}</button>}</div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="qc-roles-page">
      <div className="qc-roles-bg" aria-hidden="true">
        <span className="qc-roles-orb qc-roles-orb-one" />
        <span className="qc-roles-orb qc-roles-orb-two" />
        <span className="qc-roles-chat-line qc-roles-chat-line-one" />
        <span className="qc-roles-chat-line qc-roles-chat-line-two" />
        <i className="bi bi-chat-dots qc-roles-floating-icon qc-roles-floating-icon-one" />
        <i className="bi bi-chat-left-text qc-roles-floating-icon qc-roles-floating-icon-two" />
      </div>
      <header className="qc-roles-topbar"><div><h1>Gestión de roles</h1><p>Administra los roles del sistema y los permisos asociados.</p></div>{canCreate && <button className="qc-roles-new" onClick={() => setNewRoleOpen(true)}><i className="bi bi-plus-lg" /> Nuevo rol</button>}</header>
      <section className="qc-roles-panel">
        <div className="qc-roles-hero">
          <div className="qc-roles-hero-main">
            <span className="qc-roles-hero-icon"><i className="bi bi-shield" /></span>
            <div className="qc-roles-hero-heading">
              <div className="qc-roles-hero-title"><h2>Lista de roles</h2><span>{data.resumen?.roles || 0} roles</span></div>
              <p>Administra los roles del sistema y los permisos asociados.</p>
            </div>
          </div>
          <i className="bi bi-shield qc-roles-watermark" aria-hidden="true" />
        </div>
        <section className="qc-roles-stats">
          <article className="qc-role-stat blue"><div className="qc-role-stat-icon"><i className="bi bi-shield" /></div><div><strong>{data.resumen?.roles || 0}</strong><b>Roles</b><small>En total</small></div></article>
          <article className="qc-role-stat green"><div className="qc-role-stat-icon"><i className="bi bi-people" /></div><div><strong>{data.resumen?.usuarios_asignados || 0}</strong><b>Usuarios asignados</b><small>En todos los roles</small></div></article>
          <article className="qc-role-stat violet"><div className="qc-role-stat-icon"><i className="bi bi-globe" /></div><div><strong>{data.resumen?.roles_globales || 0}</strong><b>Roles globales</b><small>De alcance global</small></div></article>
          <article className="qc-role-stat pink"><div className="qc-role-stat-icon"><i className="bi bi-folder" /></div><div><strong>{data.resumen?.roles_proyecto || 0}</strong><b>Roles por proyecto</b><small>De alcance específico</small></div></article>
        </section>
        <div className="qc-roles-table-card">
          <div className="qc-roles-toolbar">
            <label className="qc-roles-search"><i className="bi bi-search"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar roles..." /></label>
            <div className="qc-roles-filters">
              <select value={scopeFilter} onChange={(e)=>setScopeFilter(e.target.value)}><option value="">Todos los alcances</option><option value="organizacion">Global</option><option value="proyectos">Solo sus proyectos</option></select>
              <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="">Todos los estados</option><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select>
              <select defaultValue="recent"><option value="recent">Más recientes</option></select>
            </div>
          </div>
          <div className="qc-roles-table-wrap"><table><thead><tr><th>#</th><th>Nombre del rol</th><th>Descripción</th><th>Alcance</th><th>Usuarios asignados</th><th>Permisos clave</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{loading ? <tr><td colSpan="8" className="qc-role-empty">Cargando roles...</td></tr> : roles.map((role,index)=>{const visible=(role.permisos||[]).filter(p=>!p.startsWith('chat_')).slice(0,2); const extra=Math.max(0,(role.permisos||[]).length-visible.length); return <tr key={role.id}><td>{index+1}</td><td><div className="qc-role-name"><span>{initials(role.nombre)}</span><strong>{role.nombre}</strong></div></td><td className="qc-role-desc">{roleDescription(role)}</td><td><span className={`qc-role-scope-badge ${role.alcance_admin}`}><i className={`bi ${role.alcance_admin==='organizacion'?'bi-globe':'bi-folder'}`}/>{role.alcance_admin==='organizacion'?'Global':'Solo sus proyectos'}</span></td><td className="center"><strong>{role.usuarios_asignados}</strong></td><td><div className="qc-role-perm-pills">{visible.length?visible.map(p=><span key={p}>{p.replaceAll('_',' ')}</span>):<span>Sin permisos</span>}{extra>0&&<b>+{extra}</b>}</div></td><td><span className={`qc-role-status ${role.estado}`}><i/> {title(role.estado)}</span></td><td><div className="qc-role-actions"><button className="qc-role-action view" title="Ver" onClick={()=>openRole(role.id,true)}><i className="bi bi-eye"/></button>{canEdit&&<button className="qc-role-action edit" title="Editar" onClick={()=>openRole(role.id,false)}><i className="bi bi-pencil"/></button>}{canDelete&&(Number(role.es_sistema)!==1?<button className="qc-role-action danger" title="Eliminar" onClick={()=>deleteRole(role)}><i className="bi bi-trash3"/></button>:<button className="qc-role-action danger is-protected" title="Rol del sistema protegido" disabled><i className="bi bi-trash3"/></button>)}</div></td></tr>})}</tbody></table></div>
          <footer className="qc-roles-pagination"><span>Mostrando 1 a {roles.length} de {roles.length} roles</span><div className="qc-roles-pagination-controls"><button type="button" disabled aria-label="Página anterior">‹</button><strong aria-current="page">1</strong><button type="button" disabled aria-label="Página siguiente">›</button></div></footer>
        </div>
      </section>
      {newRoleOpen && <div className="qc-role-modal-backdrop" onMouseDown={()=>setNewRoleOpen(false)}><div className="qc-role-modal" onMouseDown={(e)=>e.stopPropagation()}><div className="qc-role-modal-head"><div><h3>Nuevo rol</h3><p>Crea el rol y luego configura sus permisos.</p></div><button onClick={()=>setNewRoleOpen(false)}>×</button></div><label>Nombre del rol<input value={newRole.nombre} onChange={(e)=>setNewRole(p=>({...p,nombre:e.target.value}))} placeholder="ej. supervisor" /></label><label>Descripción<textarea value={newRole.descripcion} onChange={(e)=>setNewRole(p=>({...p,descripcion:e.target.value}))} placeholder="Describe el propósito del rol" /></label><div className="qc-role-modal-actions"><button onClick={()=>setNewRoleOpen(false)}>Cancelar</button><button className="primary" onClick={createRole}>Crear rol</button></div></div></div>}
    </main>
  );
}
