import React, { useEffect, useMemo, useState } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../css/UsersManagement.css";

const EMPTY_ROW = () => ({
  nombre: "",
  apellido: "",
  usuario_base: "",
  contrasena: "",
});

const DEFAULT_PERMISSIONS = {
  crear_grupos: 0,
  editar_mensajes: 0,
  eliminar_mensajes: 0,
  enviar_audios: 0,
};

const AddUsers = ({ onCancel }) => {
  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [proyectos, setProyectos] = useState([]);
  const [roles, setRoles] = useState([]);

  const [proyectoPrincipalId, setProyectoPrincipalId] =
    useState("");

  const [proyectosSecundarios, setProyectosSecundarios] =
    useState([]);

  const [rolId, setRolId] = useState(4);

  const [permisosChat, setPermisosChat] = useState(
    DEFAULT_PERMISSIONS
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const cargarDatos = async () => {
      setLoading(true);
      setError("");

      try {
        const [projectsRes, rolesRes] = await Promise.all([
          fetch("/api/usuarios/admin/projects", {
            credentials: "include",
          }),
          fetch("/api/roles", {
            credentials: "include",
          }),
        ]);

        const projectsData =
          await projectsRes.json().catch(() => ({}));

        const rolesData =
          await rolesRes.json().catch(() => []);

        if (!projectsRes.ok) {
          throw new Error(
            projectsData.error ||
              "No se pudieron cargar los proyectos"
          );
        }

        setProyectos(
          Array.isArray(projectsData?.proyectos)
            ? projectsData.proyectos
            : []
        );

        setRoles(
          Array.isArray(rolesData)
            ? rolesData
            : []
        );
      } catch (err) {
        console.error(
          "Error cargando datos de creación masiva:",
          err
        );

        setError(
          err.message ||
            "No se pudieron cargar los datos"
        );
      } finally {
        setLoading(false);
      }
    };

    cargarDatos();
  }, []);

  const proyectoPrincipal = useMemo(() => {
    const id = Number(proyectoPrincipalId);

    if (!id) return null;

    return (
      proyectos.find(
        (project) => Number(project.id) === id
      ) || null
    );
  }, [proyectoPrincipalId, proyectos]);

  const dominioPrincipal =
    String(
      proyectoPrincipal?.dominio || ""
    ).trim();

  const proyectosFinales = useMemo(() => {
    const principal =
      Number(proyectoPrincipalId);

    const ids = proyectosSecundarios
      .map(Number)
      .filter(Boolean);

    if (
      principal &&
      !ids.includes(principal)
    ) {
      ids.unshift(principal);
    }

    return [...new Set(ids)];
  }, [
    proyectoPrincipalId,
    proyectosSecundarios,
  ]);

  const addRow = () => {
    if (rows.length >= 100) {
      setError(
        "Puedes crear como máximo 100 usuarios por lote."
      );
      return;
    }

    setRows((prev) => [
      ...prev,
      EMPTY_ROW(),
    ]);
  };

  const removeRow = (index) => {
    if (rows.length === 1) return;

    setRows((prev) =>
      prev.filter(
        (_, currentIndex) =>
          currentIndex !== index
      )
    );
  };

  const handleRowChange = (
    index,
    field,
    value
  ) => {
    setRows((prev) =>
      prev.map((row, currentIndex) =>
        currentIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  };

  const handlePrincipalChange = (value) => {
    const id = Number(value) || "";

    setProyectoPrincipalId(id);

    if (id) {
      setProyectosSecundarios(
        (prev) =>
          prev.filter(
            (projectId) =>
              Number(projectId) !== id
          )
      );
    }
  };

  const toggleSecondaryProject = (
    projectId
  ) => {
    const id = Number(projectId);

    if (
      id === Number(proyectoPrincipalId)
    ) {
      return;
    }

    setProyectosSecundarios((prev) =>
      prev.includes(id)
        ? prev.filter(
            (item) => item !== id
          )
        : [...prev, id]
    );
  };

  const handlePermission = (
    field,
    checked
  ) => {
    setPermisosChat((prev) => ({
      ...prev,
      [field]: checked ? 1 : 0,
    }));
  };

  const correoPreview = (
    usuarioBase
  ) => {
    const base =
      String(usuarioBase || "")
        .trim()
        .toLowerCase();

    if (!base || !dominioPrincipal) {
      return "—";
    }

    return `${base}@${dominioPrincipal.toLowerCase()}`;
  };

  const handleSubmit = async () => {
    setError("");

    if (!Number(proyectoPrincipalId)) {
      setError(
        "Debes seleccionar un proyecto principal."
      );
      return;
    }

    if (!dominioPrincipal) {
      setError(
        "El proyecto principal no tiene dominio. Para cuentas manuales utiliza Gestión de Usuarios."
      );
      return;
    }

    const filaIncompleta =
      rows.findIndex(
        (row) =>
          !row.nombre.trim() ||
          !row.apellido.trim() ||
          !row.usuario_base.trim() ||
          !row.contrasena
      );

    if (filaIncompleta !== -1) {
      setError(
        `Completa todos los campos de la fila ${
          filaIncompleta + 1
        }.`
      );
      return;
    }

    setSaving(true);

    try {
      const resp = await fetch(
        "/api/usuarios/admin/batch",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            proyecto_principal_id:
              Number(proyectoPrincipalId),

            proyectos:
              proyectosFinales,

            rol_id:
              Number(rolId),

            permisos_chat:
              permisosChat,

            usuarios: rows.map(
              (row) => ({
                nombre:
                  row.nombre.trim(),

                apellido:
                  row.apellido.trim(),

                usuario_base:
                  row.usuario_base
                    .trim()
                    .toLowerCase(),

                contrasena:
                  row.contrasena,
              })
            ),
          }),
        }
      );

      const data =
        await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setError(
          data.error ||
            "No se pudieron crear los usuarios."
        );
        return;
      }

      alert(
        data.mensaje ||
          `${rows.length} usuarios creados correctamente`
      );

      if (typeof onCancel === "function") {
        onCancel();
      }
    } catch (err) {
      console.error(
        "Error creando usuarios:",
        err
      );

      setError(
        "Error de comunicación al crear los usuarios."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="qc-batch-page">
      <div
        className="qc-users-bg-decor"
        aria-hidden="true"
      >
        <span className="qc-users-orb qc-users-orb-one" />
        <span className="qc-users-orb qc-users-orb-two" />
      </div>

      <header className="qc-batch-header">
        <div>
          <span className="qc-batch-kicker">
            CREACIÓN MASIVA
          </span>

          <h1>Nuevo usuario</h1>

          <p>
            Crea uno o varios usuarios utilizando un
            proyecto principal y correo administrado
            automáticamente.
          </p>
        </div>

        <button
          type="button"
          className="qc-batch-back"
          onClick={onCancel}
        >
          <i className="bi bi-arrow-left" />
          Volver
        </button>
      </header>

      <section className="qc-batch-panel">
        <section className="qc-user-admin-section">
          <div className="qc-user-admin-section-head">
            <span className="qc-user-admin-section-icon">
              <i className="bi bi-folder2-open" />
            </span>

            <div>
              <h4>
                Proyecto principal
              </h4>

              <p>
                Define el dominio que utilizarán todos
                los usuarios del lote.
              </p>
            </div>
          </div>

          <div className="qc-user-admin-grid">
            <label className="qc-user-admin-field">
              <span>
                Proyecto principal
              </span>

              <select
                value={proyectoPrincipalId}
                disabled={loading}
                onChange={(e) =>
                  handlePrincipalChange(
                    e.target.value
                  )
                }
              >
                <option value="">
                  Seleccionar proyecto
                </option>

                {proyectos.map(
                  (project) => (
                    <option
                      key={project.id}
                      value={project.id}
                      disabled={
                        project.estado !==
                        "activo"
                      }
                    >
                      {project.nombre}
                      {project.estado !==
                      "activo"
                        ? " (Inactivo)"
                        : ""}
                    </option>
                  )
                )}
              </select>
            </label>

            <div className="qc-user-admin-field">
              <span>
                Dominio resultante
              </span>

              <div className="qc-user-readonly">
                <i className="bi bi-globe2" />

                {dominioPrincipal ||
                  "Selecciona un proyecto"}
              </div>
            </div>
          </div>

          {proyectoPrincipalId && (
            <>
              <div className="qc-batch-subtitle">
                Otros proyectos
              </div>

              <div className="qc-user-project-grid">
                {proyectos.map(
                  (project) => {
                    const id =
                      Number(project.id);

                    const principal =
                      id ===
                      Number(
                        proyectoPrincipalId
                      );

                    const selected =
                      principal ||
                      proyectosSecundarios.includes(
                        id
                      );

                    return (
                      <button
                        type="button"
                        key={project.id}
                        className={[
                          "qc-user-project-option",
                          selected
                            ? "is-selected"
                            : "",
                          principal
                            ? "is-principal"
                            : "",
                        ].join(" ")}
                        onClick={() =>
                          toggleSecondaryProject(
                            id
                          )
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
                          <strong>
                            {project.nombre}
                          </strong>

                          <small>
                            {project.dominio ||
                              "Sin dominio"}
                          </small>
                        </span>

                        {principal && (
                          <span className="qc-user-principal-badge">
                            <i className="bi bi-lock-fill" />
                            Principal
                          </span>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            </>
          )}
        </section>

        <section className="qc-user-admin-section">
          <div className="qc-user-admin-section-head">
            <span className="qc-user-admin-section-icon">
              <i className="bi bi-people" />
            </span>

            <div>
              <h4>
                Usuarios del lote
              </h4>

              <p>
                Cada usuario tendrá el mismo proyecto
                principal, rol y proyectos secundarios.
              </p>
            </div>
          </div>

          <div className="qc-batch-toolbar">
            <span>
              <strong>
                {rows.length}
              </strong>{" "}
              {rows.length === 1
                ? "usuario"
                : "usuarios"}
            </span>

            <button
              type="button"
              onClick={addRow}
            >
              <i className="bi bi-plus-lg" />
              Agregar fila
            </button>
          </div>

          <div className="qc-batch-table-wrap">
            <table className="qc-batch-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Apellido</th>
                  <th>Usuario base</th>
                  <th>Contraseña</th>
                  <th>
                    Correo resultante
                  </th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {rows.map(
                  (row, index) => (
                    <tr key={index}>
                      <td className="qc-batch-index">
                        {index + 1}
                      </td>

                      <td>
                        <input
                          value={row.nombre}
                          placeholder="Juan"
                          onChange={(e) =>
                            handleRowChange(
                              index,
                              "nombre",
                              e.target.value
                            )
                          }
                        />
                      </td>

                      <td>
                        <input
                          value={
                            row.apellido
                          }
                          placeholder="Pérez"
                          onChange={(e) =>
                            handleRowChange(
                              index,
                              "apellido",
                              e.target.value
                            )
                          }
                        />
                      </td>

                      <td>
                        <input
                          value={
                            row.usuario_base
                          }
                          placeholder="juan.perez"
                          onChange={(e) =>
                            handleRowChange(
                              index,
                              "usuario_base",
                              e.target.value
                            )
                          }
                        />
                      </td>

                      <td>
                        <input
                          type="password"
                          value={
                            row.contrasena
                          }
                          placeholder="Contraseña"
                          onChange={(e) =>
                            handleRowChange(
                              index,
                              "contrasena",
                              e.target.value
                            )
                          }
                        />
                      </td>

                      <td>
                        <div className="qc-batch-email">
                          <i className="bi bi-envelope" />
                          <span>
                            {correoPreview(
                              row.usuario_base
                            )}
                          </span>
                        </div>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="qc-batch-remove"
                          disabled={
                            rows.length === 1
                          }
                          onClick={() =>
                            removeRow(index)
                          }
                          title="Eliminar fila"
                        >
                          <i className="bi bi-trash" />
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="qc-user-admin-section">
          <div className="qc-user-admin-section-head">
            <span className="qc-user-admin-section-icon">
              <i className="bi bi-person-gear" />
            </span>

            <div>
              <h4>
                Rol y permisos
              </h4>

              <p>
                Se aplicarán por igual a todos los
                usuarios del lote.
              </p>
            </div>
          </div>

          <div className="qc-user-role-grid">
            {roles.map((role) => {
              const selected =
                Number(rolId) ===
                Number(role.id);

              return (
                <button
                  key={role.id}
                  type="button"
                  className={
                    selected
                      ? "is-selected"
                      : ""
                  }
                  onClick={() =>
                    setRolId(
                      Number(role.id)
                    )
                  }
                >
                  <i
                    className={
                      Number(role.id) ===
                      1
                        ? "bi bi-shield-check"
                        : Number(
                            role.id
                          ) === 2
                        ? "bi bi-tools"
                        : Number(
                            role.id
                          ) === 3
                        ? "bi bi-question-circle"
                        : "bi bi-person"
                    }
                  />

                  <strong>
                    {role.nombre}
                  </strong>

                  <small>
                    {role.descripcion ||
                      "Rol del sistema"}
                  </small>
                </button>
              );
            })}
          </div>

          <div className="qc-batch-subtitle">
            Permisos del chat
          </div>

          <div className="qc-user-permission-grid">
            {[
              [
                "crear_grupos",
                "Crear grupos",
                "bi bi-people",
              ],
              [
                "editar_mensajes",
                "Editar mensajes",
                "bi bi-pencil-square",
              ],
              [
                "enviar_audios",
                "Grabar audios",
                "bi bi-mic",
              ],
              [
                "eliminar_mensajes",
                "Eliminar mensajes",
                "bi bi-trash",
              ],
            ].map(
              ([
                field,
                label,
                icon,
              ]) => (
                <label
                  className="qc-user-permission-option"
                  key={field}
                >
                  <span className="qc-user-permission-icon">
                    <i className={icon} />
                  </span>

                  <span>
                    <strong>
                      {label}
                    </strong>

                    <small>
                      Aplicar a todos
                    </small>
                  </span>

                  <input
                    type="checkbox"
                    checked={
                      Number(
                        permisosChat[
                          field
                        ]
                      ) === 1
                    }
                    onChange={(e) =>
                      handlePermission(
                        field,
                        e.target.checked
                      )
                    }
                  />
                </label>
              )
            )}
          </div>
        </section>

        {error && (
          <div className="qc-user-admin-error">
            <i className="bi bi-exclamation-triangle" />
            {error}
          </div>
        )}

        <div className="qc-user-admin-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={
              saving ||
              loading
            }
          >
            <i className="bi bi-person-plus me-2" />

            {saving
              ? "Creando..."
              : `Crear ${
                  rows.length
                } ${
                  rows.length === 1
                    ? "usuario"
                    : "usuarios"
                }`}
          </button>
        </div>
      </section>
    </main>
  );
};

export default AddUsers;
