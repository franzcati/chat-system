import { useEffect, useMemo, useState } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../css/MfaAdmin.css";

const DEFAULT_PERMISSIONS = {
  crear_grupos: 0,
  editar_mensajes: 0,
  eliminar_mensajes: 0,
  enviar_audios: 0,
};

const parsePermissions = (value) => {
  let parsed = value;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = {};
  }

  return {
    crear_grupos: Number(parsed.crear_grupos || 0),
    editar_mensajes: Number(parsed.editar_mensajes || 0),
    eliminar_mensajes: Number(parsed.eliminar_mensajes || 0),
    enviar_audios: Number(parsed.enviar_audios || 0),
  };
};

const deriveBaseFromEmail = (email) => {
  const text = String(email || "").trim();
  if (!text.includes("@")) return text.toLowerCase();
  return text.split("@")[0].trim().toLowerCase();
};

const getInitialProjects = (editando) =>
  Array.isArray(editando?.proyectos_detallados)
    ? editando.proyectos_detallados
        .filter((p) => p && p.id != null)
        .map((p) => Number(p.id))
    : [];

export default function FormEditarUsuario({
  editando,
  setEditando,
  obtenerUsuarios,
  rolUsuarioActual,
  usuarioActualId,
}) {
  const esNuevo = !editando?.id;

  const [proyectosDisponibles, setProyectosDisponibles] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permisosRoles, setPermisosRoles] = useState([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [mfaAdminStatus, setMfaAdminStatus] = useState(null);
  const [mfaAdminLoading, setMfaAdminLoading] = useState(false);
  const [mfaAdminError, setMfaAdminError] = useState("");
  const [mfaResetLoading, setMfaResetLoading] = useState(false);

  const [form, setForm] = useState(() => ({
    nombre: editando?.nombre || "",
    apellido: editando?.apellido || "",

    usuario_base:
      editando?.usuario_base ||
      deriveBaseFromEmail(editando?.correo || editando?.usuario),

    correo:
      editando?.correo ||
      editando?.usuario ||
      "",

    contrasena: "",

    permisos_chat: parsePermissions(
      editando?.permisos_chat || DEFAULT_PERMISSIONS
    ),

    proyectos: getInitialProjects(editando),

    proyecto_principal_id:
      editando?.proyecto_principal_id != null
        ? Number(editando.proyecto_principal_id)
        : "",

    correo_gestionado_proyecto: esNuevo
      ? 1
      : Number(editando?.correo_gestionado_proyecto || 0),

    rol_id: Number(editando?.rol_id || 4),
  }));

  const tienePermiso = (permiso) => {
    const permisosDeRol = permisosRoles.filter(
      (p) => Number(p.rol_id) === Number(rolUsuarioActual)
    );

    return permisosDeRol.some((p) => p.permiso === permiso);
  };

  const proyectoPrincipal = useMemo(() => {
    const id = Number(form.proyecto_principal_id);

    if (!id) return null;

    return (
      proyectosDisponibles.find(
        (project) => Number(project.id) === id
      ) || null
    );
  }, [form.proyecto_principal_id, proyectosDisponibles]);

  const correoResultante = useMemo(() => {
    if (!form.correo_gestionado_proyecto) {
      return String(form.correo || "").trim();
    }

    const base = String(form.usuario_base || "")
      .trim()
      .toLowerCase();

    const dominio = String(proyectoPrincipal?.dominio || "")
      .trim()
      .toLowerCase();

    if (!base || !dominio) return "";

    return `${base}@${dominio}`;
  }, [
    form.correo,
    form.usuario_base,
    form.correo_gestionado_proyecto,
    proyectoPrincipal,
  ]);

  const proyectosSecundarios = useMemo(
    () =>
      form.proyectos.filter(
        (id) =>
          Number(id) !== Number(form.proyecto_principal_id)
      ),
    [form.proyectos, form.proyecto_principal_id]
  );

  const cargarProyectos = async () => {
    setLoadingProjects(true);

    try {
      const res = await fetch("/api/usuarios/admin/projects", {
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error || "No se pudieron cargar los proyectos"
        );
      }

      setProyectosDisponibles(
        Array.isArray(data.proyectos) ? data.proyectos : []
      );
    } catch (error) {
      console.error("Error cargando proyectos:", error);
      setFormError(error.message);
      setProyectosDisponibles([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  const cargarEstadoMfaAdmin = async () => {
    if (
      !editando?.id ||
      !usuarioActualId ||
      !tienePermiso("gestionar_mfa")
    ) {
      return;
    }

    setMfaAdminLoading(true);
    setMfaAdminError("");

    try {
      const res = await fetch(
        `/api/mfa/admin/users/${editando.id}/status`,
        {
          credentials: "include",
          headers: {
            "X-QC-User-Id": String(usuarioActualId),
          },
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error || "No se pudo consultar MFA"
        );
      }

      setMfaAdminStatus(data);
    } catch (error) {
      setMfaAdminError(
        error.message || "No se pudo consultar MFA"
      );
    } finally {
      setMfaAdminLoading(false);
    }
  };

  const restablecerMfaAdmin = async () => {
    if (
      !editando?.id ||
      !usuarioActualId ||
      !tienePermiso("gestionar_mfa")
    ) {
      return;
    }

    const first = window.confirm(
      `¿Restablecer toda la seguridad MFA de ${
        editando.nombre || editando.usuario || "este usuario"
      }?\n\nSe revocarán Authenticator, correo MFA, dispositivos confiables y códigos de recuperación. Los mensajes y la contraseña NO se modificarán.`
    );

    if (!first) return;

    const typed = window.prompt(
      "Para confirmar escribe exactamente: RESTABLECER"
    );

    if (typed !== "RESTABLECER") {
      alert("Operación cancelada.");
      return;
    }

    setMfaResetLoading(true);
    setMfaAdminError("");

    try {
      const res = await fetch(
        `/api/mfa/admin/users/${editando.id}/reset`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-QC-User-Id": String(usuarioActualId),
          },
          body: JSON.stringify({ confirm: true }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error || "No se pudo restablecer MFA"
        );
      }

      alert(data.mensaje || "MFA restablecido correctamente");
      await cargarEstadoMfaAdmin();
    } catch (error) {
      setMfaAdminError(
        error.message || "No se pudo restablecer MFA"
      );
    } finally {
      setMfaResetLoading(false);
    }
  };

  useEffect(() => {
    cargarProyectos();

    fetch("/api/roles")
      .then((r) => r.json())
      .then((data) => setRoles(Array.isArray(data) ? data : []))
      .catch(() => setRoles([]));

    fetch("/api/roles_permisos")
      .then((r) => r.json())
      .then((data) =>
        setPermisosRoles(Array.isArray(data) ? data : [])
      )
      .catch(() => setPermisosRoles([]));
  }, []);

  useEffect(() => {
    if (
      editando?.id &&
      usuarioActualId &&
      tienePermiso("gestionar_mfa")
    ) {
      cargarEstadoMfaAdmin();
    }
  }, [editando?.id, usuarioActualId, permisosRoles]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePermiso = (permiso, checked) => {
    setForm((prev) => ({
      ...prev,
      permisos_chat: {
        ...prev.permisos_chat,
        [permiso]: checked ? 1 : 0,
      },
    }));
  };

  const handlePrincipal = (value) => {
    const id = Number(value) || "";

    setForm((prev) => {
      let proyectos = [...prev.proyectos];

      if (id && !proyectos.includes(id)) {
        proyectos.push(id);
      }

      return {
        ...prev,
        proyecto_principal_id: id,
        proyectos,
      };
    });
  };

  const handleCheckboxProyecto = (projectId) => {
    const id = Number(projectId);

    if (Number(form.proyecto_principal_id) === id) {
      return;
    }

    setForm((prev) => {
      const exists = prev.proyectos.includes(id);

      return {
        ...prev,
        proyectos: exists
          ? prev.proyectos.filter((item) => item !== id)
          : [...prev.proyectos, id],
      };
    });
  };

  const toggleGestionado = (managed) => {
    setForm((prev) => ({
      ...prev,
      correo_gestionado_proyecto: managed ? 1 : 0,
    }));
  };

  const guardarUsuario = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!form.nombre.trim() || !form.apellido.trim()) {
      setFormError("Nombre y apellido son obligatorios.");
      return;
    }

    if (
      form.correo_gestionado_proyecto &&
      !form.usuario_base.trim()
    ) {
      setFormError(
        "El usuario base es obligatorio para una cuenta gestionada."
      );
      return;
    }

    if (
      (esNuevo || form.correo_gestionado_proyecto) &&
      !Number(form.proyecto_principal_id)
    ) {
      setFormError("Debes seleccionar un proyecto principal.");
      return;
    }

    if (
      form.correo_gestionado_proyecto &&
      !proyectoPrincipal?.dominio
    ) {
      setFormError(
        "El proyecto principal no tiene dominio. Usa correo manual o selecciona otro proyecto."
      );
      return;
    }

    if (
      !form.correo_gestionado_proyecto &&
      !String(form.correo || "").trim()
    ) {
      setFormError("Debes indicar el correo manual.");
      return;
    }

    if (esNuevo && !form.contrasena) {
      setFormError(
        "La contraseña es obligatoria para un usuario nuevo."
      );
      return;
    }

    const proyectos = [...new Set(
      form.proyectos.map(Number).filter(Boolean)
    )];

    const principalId = Number(form.proyecto_principal_id) || null;

    if (principalId && !proyectos.includes(principalId)) {
      proyectos.unshift(principalId);
    }

    const payload = {
      nombre: form.nombre.trim(),
      apellido: form.apellido.trim(),
      usuario_base: form.usuario_base.trim(),
      correo: form.correo.trim(),
      contrasena: form.contrasena,
      rol_id: Number(form.rol_id),
      permisos_chat: form.permisos_chat,
      proyecto_principal_id: principalId,
      proyectos,
      correo_gestionado_proyecto:
        Number(form.correo_gestionado_proyecto),
    };

    setSaving(true);

    try {
      const url = esNuevo
        ? "/api/usuarios/admin"
        : `/api/usuarios/admin/${editando.id}`;

      const res = await fetch(url, {
        method: esNuevo ? "POST" : "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFormError(
          data.error || "No se pudo guardar el usuario."
        );
        return;
      }

      alert(
        esNuevo
          ? "Usuario creado correctamente"
          : "Usuario actualizado correctamente"
      );

      await obtenerUsuarios();
      setEditando(null);
    } catch (error) {
      console.error("Error guardando usuario:", error);
      setFormError("Error de comunicación al guardar el usuario.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="qc-user-admin-form"
      onSubmit={guardarUsuario}
    >
      <section className="qc-user-admin-section">
        <div className="qc-user-admin-section-head">
          <span className="qc-user-admin-section-icon">
            <i className="bi bi-person-vcard" />
          </span>
          <div>
            <h4>Identidad del usuario</h4>
            <p>
              Datos personales, usuario base y correo de acceso.
            </p>
          </div>
        </div>

        <div className="qc-user-admin-grid">
          <label className="qc-user-admin-field">
            <span>Nombre</span>
            <input
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Nombre"
            />
          </label>

          <label className="qc-user-admin-field">
            <span>Apellido</span>
            <input
              name="apellido"
              value={form.apellido}
              onChange={handleChange}
              placeholder="Apellido"
            />
          </label>

          <label className="qc-user-admin-field">
            <span>Usuario base</span>
            <input
              name="usuario_base"
              value={form.usuario_base}
              onChange={handleChange}
              placeholder="ej. juangonzales"
            />
            <small>
              Sin @ ni dominio. Se usa para generar el correo.
            </small>
          </label>

          <label className="qc-user-admin-field">
            <span>
              Contraseña {esNuevo ? "" : "(opcional)"}
            </span>
            <input
              type="password"
              name="contrasena"
              value={form.contrasena}
              onChange={handleChange}
              placeholder={
                esNuevo
                  ? "Contraseña inicial"
                  : "Dejar vacío para conservarla"
              }
            />
          </label>
        </div>
      </section>

      <section className="qc-user-admin-section">
        <div className="qc-user-admin-section-head">
          <span className="qc-user-admin-section-icon">
            <i className="bi bi-envelope-at" />
          </span>
          <div>
            <h4>Correo y proyecto principal</h4>
            <p>
              El proyecto principal controla el dominio de las cuentas gestionadas.
            </p>
          </div>
        </div>

        <div className="qc-user-account-mode">
          <button
            type="button"
            className={
              form.correo_gestionado_proyecto
                ? "is-active"
                : ""
            }
            onClick={() => toggleGestionado(true)}
          >
            <i className="bi bi-link-45deg" />
            <strong>Gestionado por proyecto</strong>
            <small>
              El backend genera usuario_base@dominio.
            </small>
          </button>

          <button
            type="button"
            className={
              !form.correo_gestionado_proyecto
                ? "is-active"
                : ""
            }
            onClick={() => toggleGestionado(false)}
          >
            <i className="bi bi-pencil-square" />
            <strong>Correo manual / especial</strong>
            <small>
              No cambia automáticamente con el proyecto.
            </small>
          </button>
        </div>

        <div className="qc-user-admin-grid">
          <label className="qc-user-admin-field">
            <span>Proyecto principal</span>

            <select
              value={form.proyecto_principal_id}
              onChange={(e) => handlePrincipal(e.target.value)}
            >
              <option value="">
                Sin proyecto principal
              </option>

              {proyectosDisponibles.map((project) => (
                <option
                  key={project.id}
                  value={project.id}
                  disabled={
                    esNuevo &&
                    project.estado !== "activo"
                  }
                >
                  {project.nombre}
                  {project.estado !== "activo"
                    ? " (Inactivo)"
                    : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="qc-user-admin-field">
            <span>Dominio del proyecto</span>
            <div className="qc-user-readonly">
              <i className="bi bi-globe2" />
              {proyectoPrincipal?.dominio ||
                "Sin dominio"}
            </div>
          </div>

          {form.correo_gestionado_proyecto ? (
            <div className="qc-user-admin-field qc-user-admin-span-2">
              <span>Correo resultante</span>
              <div className="qc-user-email-preview">
                <i className="bi bi-envelope-check" />
                <strong>
                  {correoResultante ||
                    "Selecciona un proyecto con dominio"}
                </strong>
              </div>
            </div>
          ) : (
            <label className="qc-user-admin-field qc-user-admin-span-2">
              <span>Correo manual</span>
              <input
                type="email"
                name="correo"
                value={form.correo}
                onChange={handleChange}
                placeholder="usuario@dominio.com"
              />
              <small>
                Esta cuenta queda excluida de cambios automáticos de dominio.
              </small>
            </label>
          )}
        </div>
      </section>

      <section className="qc-user-admin-section">
        <div className="qc-user-admin-section-head">
          <span className="qc-user-admin-section-icon">
            <i className="bi bi-folder2-open" />
          </span>
          <div>
            <h4>Proyectos asignados</h4>
            <p>
              El principal siempre está incluido. Los demás son membresías secundarias.
            </p>
          </div>
        </div>

        {loadingProjects ? (
          <div className="qc-user-admin-loading">
            Cargando proyectos...
          </div>
        ) : (
          <div className="qc-user-project-grid">
            {proyectosDisponibles.map((project) => {
              const id = Number(project.id);
              const isPrincipal =
                id === Number(form.proyecto_principal_id);
              const selected =
                form.proyectos.includes(id);

              return (
                <button
                  type="button"
                  key={project.id}
                  className={[
                    "qc-user-project-option",
                    selected ? "is-selected" : "",
                    isPrincipal ? "is-principal" : "",
                  ].join(" ")}
                  onClick={() =>
                    handleCheckboxProyecto(id)
                  }
                >
                  <span className="qc-user-project-check">
                    <i
                      className={
                        selected
                          ? "bi bi-check-lg"
                          : "bi bi-folder"
                      }
                    />
                  </span>

                  <span className="qc-user-project-copy">
                    <strong>{project.nombre}</strong>
                    <small>
                      {project.dominio ||
                        "Proyecto sin dominio"}
                    </small>
                  </span>

                  {isPrincipal && (
                    <span className="qc-user-principal-badge">
                      <i className="bi bi-lock-fill" />
                      Principal
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="qc-user-project-summary">
          <span>
            <strong>{form.proyectos.length}</strong>
            {" "}proyectos asignados
          </span>

          <span>
            <strong>{proyectosSecundarios.length}</strong>
            {" "}secundarios
          </span>
        </div>
      </section>

      <section className="qc-user-admin-section">
        <div className="qc-user-admin-section-head">
          <span className="qc-user-admin-section-icon">
            <i className="bi bi-person-gear" />
          </span>
          <div>
            <h4>Rol del usuario</h4>
            <p>Define el nivel general de acceso.</p>
          </div>
        </div>

        <div className="qc-user-role-grid">
          {roles.map((role) => {
            const selected =
              Number(form.rol_id) === Number(role.id);

            return (
              <button
                type="button"
                key={role.id}
                className={
                  selected ? "is-selected" : ""
                }
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    rol_id: Number(role.id),
                  }))
                }
              >
                <i
                  className={
                    Number(role.id) === 1
                      ? "bi bi-shield-check"
                      : Number(role.id) === 2
                      ? "bi bi-tools"
                      : Number(role.id) === 3
                      ? "bi bi-question-circle"
                      : "bi bi-person"
                  }
                />

                <strong>{role.nombre}</strong>
                <small>
                  {role.descripcion ||
                    "Rol del sistema"}
                </small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="qc-user-admin-section">
        <div className="qc-user-admin-section-head">
          <span className="qc-user-admin-section-icon">
            <i className="bi bi-chat-square-text" />
          </span>
          <div>
            <h4>Permisos del chat</h4>
            <p>
              Capacidades específicas dentro de las conversaciones.
            </p>
          </div>
        </div>

        <div className="qc-user-permission-grid">
          {PERMISOS_UI.map((permission) => {
            const enabled =
              Number(
                form.permisos_chat[permission.campo]
              ) === 1;

            return (
              <label
                className="qc-user-permission-option"
                key={permission.campo}
              >
                <span className="qc-user-permission-icon">
                  <i className={permission.icono} />
                </span>

                <span>
                  <strong>{permission.titulo}</strong>
                  <small>
                    {permission.descripcion}
                  </small>
                </span>

                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    handlePermiso(
                      permission.campo,
                      e.target.checked
                    )
                  }
                />
              </label>
            );
          })}
        </div>
      </section>

      {editando?.id &&
        tienePermiso("gestionar_mfa") && (
          <section className="qc-mfa-admin-card">
            <div className="qc-mfa-admin-head">
              <div className="qc-mfa-admin-icon">
                <i className="bi bi-shield-lock" />
              </div>

              <div>
                <h4>Seguridad MFA</h4>
                <p>
                  Estado de autenticación en dos pasos y herramientas de recuperación administrativa.
                </p>
              </div>

              <button
                type="button"
                className="qc-mfa-admin-refresh"
                onClick={cargarEstadoMfaAdmin}
                disabled={mfaAdminLoading}
                title="Actualizar estado MFA"
              >
                <i
                  className={`bi bi-arrow-clockwise ${
                    mfaAdminLoading
                      ? "qc-spin"
                      : ""
                  }`}
                />
              </button>
            </div>

            {mfaAdminError && (
              <div className="qc-mfa-admin-error">
                {mfaAdminError}
              </div>
            )}

            {mfaAdminLoading &&
            !mfaAdminStatus ? (
              <div className="qc-mfa-admin-loading">
                Consultando seguridad...
              </div>
            ) : mfaAdminStatus ? (
              <>
                <div className="qc-mfa-admin-stats">
                  <div>
                    <span>Authenticator</span>
                    <strong>
                      {mfaAdminStatus.totp_enabled
                        ? "Activo"
                        : "No configurado"}
                    </strong>
                  </div>

                  <div>
                    <span>Correo MFA</span>
                    <strong>
                      {mfaAdminStatus.email_enabled
                        ? mfaAdminStatus.masked_email ||
                          "Activo"
                        : "No configurado"}
                    </strong>
                  </div>

                  <div>
                    <span>Dispositivos</span>
                    <strong>
                      {mfaAdminStatus.trusted_devices ||
                        0}
                    </strong>
                  </div>

                  <div>
                    <span>Códigos recuperación</span>
                    <strong>
                      {mfaAdminStatus
                        .recovery_codes_available || 0}
                    </strong>
                  </div>
                </div>

                <div className="qc-mfa-admin-danger">
                  <div>
                    <strong>
                      Restablecer autenticación MFA
                    </strong>
                    <p>
                      Revoca los métodos MFA y dispositivos confiables. No modifica contraseña ni mensajes.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={restablecerMfaAdmin}
                    disabled={mfaResetLoading}
                  >
                    <i className="bi bi-arrow-counterclockwise" />
                    {mfaResetLoading
                      ? "Restableciendo..."
                      : "Restablecer MFA"}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        )}

      {formError && (
        <div className="qc-user-admin-error">
          <i className="bi bi-exclamation-triangle" />
          {formError}
        </div>
      )}

      <div className="qc-user-admin-actions">
        <button
          type="button"
          className="btn btn-secondary px-4"
          onClick={() => setEditando(null)}
          disabled={saving}
        >
          Cancelar
        </button>

        <button
          type="submit"
          className="btn btn-primary px-4"
          disabled={saving}
        >
          <i className="bi bi-check2-circle me-2" />
          {saving
            ? "Guardando..."
            : esNuevo
            ? "Crear usuario"
            : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

const PERMISOS_UI = [
  {
    campo: "crear_grupos",
    titulo: "Crear grupos",
    descripcion: "Permite crear nuevos grupos",
    icono: "bi bi-people",
  },
  {
    campo: "editar_mensajes",
    titulo: "Editar mensajes",
    descripcion: "Permite editar mensajes enviados",
    icono: "bi bi-pencil-square",
  },
  {
    campo: "enviar_audios",
    titulo: "Grabar audios",
    descripcion: "Permite grabar notas de voz",
    icono: "bi bi-mic",
  },
  {
    campo: "eliminar_mensajes",
    titulo: "Eliminar mensajes",
    descripcion: "Permite borrar mensajes enviados",
    icono: "bi bi-trash",
  },
];
