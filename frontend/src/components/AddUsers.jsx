import React, { useEffect, useMemo, useRef, useState } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../css/UsersManagement.css";

const MAX_BATCH_USERS = 100;
const CSV_HEADERS = ["nombre", "apellido", "usuario_base", "contrasena"];

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

const normalizeCsvHeader = (value) =>
  String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const detectCsvDelimiter = (source) => {
  const normalized = String(source || "").replace(/^\uFEFF/, "");
  const firstLine = normalized.split(/\r?\n/, 1)[0].trim();
  const sepDirective = /^sep=(.)$/i.exec(firstLine);

  if (sepDirective) {
    return sepDirective[1];
  }

  let commas = 0;
  let semicolons = 0;
  let insideQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '"') {
      if (insideQuotes && normalized[index + 1] === '"') {
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (!insideQuotes && (character === "\n" || character === "\r")) {
      break;
    }

    if (!insideQuotes && character === ",") commas += 1;
    if (!insideQuotes && character === ";") semicolons += 1;
  }

  return semicolons > commas ? ";" : ",";
};

const parseCsv = (text) => {
  let source = String(text || "").replace(/^\uFEFF/, "");
  const firstLineEnd = source.search(/\r?\n/);
  const firstLine = (firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)).trim();
  const sepDirective = /^sep=(.)$/i.exec(firstLine);
  const delimiter = sepDirective?.[1] || detectCsvDelimiter(source);

  if (sepDirective) {
    source = firstLineEnd === -1 ? "" : source.slice(firstLineEnd).replace(/^\r?\n/, "");
  }

  const parsedRows = [];
  let currentRow = [];
  let currentField = "";
  let insideQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '"') {
      if (insideQuotes && source[index + 1] === '"') {
        currentField += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === delimiter && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && source[index + 1] === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      parsedRows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += character;
  }

  if (insideQuotes) {
    throw new Error("El CSV contiene comillas sin cerrar.");
  }

  currentRow.push(currentField);
  parsedRows.push(currentRow);

  return parsedRows;
};

const rowIsEmpty = (row) =>
  !String(row?.nombre || "").trim() &&
  !String(row?.apellido || "").trim() &&
  !String(row?.usuario_base || "").trim() &&
  !String(row?.contrasena || "").trim();

const roleIcon = (role) => {
  const name = String(role?.nombre || "").toLowerCase();

  if (name.includes("admin")) return "bi bi-shield-check";
  if (name.includes("mod")) return "bi bi-tools";
  if (name.includes("help") || name.includes("soporte")) {
    return "bi bi-question-circle";
  }

  return "bi bi-person";
};

const syncRowsWithGenericPassword = (sourceRows, password) => {
  let changed = false;

  const nextRows = sourceRows.map((row) => {
    if (row.contrasena === password) {
      return row;
    }

    changed = true;
    return { ...row, contrasena: password };
  });

  return changed ? nextRows : sourceRows;
};

const AddUsers = ({ onCancel }) => {
  const [rows, setRows] = useState([EMPTY_ROW()]);
  const [proyectos, setProyectos] = useState([]);
  const [roles, setRoles] = useState([]);
  const [visiblePasswords, setVisiblePasswords] = useState(() => new Set());
  const [useGenericPassword, setUseGenericPassword] = useState(false);
  const [genericPassword, setGenericPassword] = useState("");
  const [genericPasswordVisible, setGenericPasswordVisible] = useState(false);

  const [proyectoPrincipalId, setProyectoPrincipalId] = useState("");
  const [proyectosSecundarios, setProyectosSecundarios] = useState([]);
  const [rolId, setRolId] = useState(4);
  const [permisosChat, setPermisosChat] = useState(DEFAULT_PERMISSIONS);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const csvInputRef = useRef(null);

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

        const projectsData = await projectsRes.json().catch(() => ({}));
        const rolesData = await rolesRes.json().catch(() => []);

        if (!projectsRes.ok) {
          throw new Error(
            projectsData.error || "No se pudieron cargar los proyectos"
          );
        }

        const nextProjects = Array.isArray(projectsData?.proyectos)
          ? projectsData.proyectos
          : [];
        const nextRoles = Array.isArray(rolesData) ? rolesData : [];

        setProyectos(nextProjects);
        setRoles(nextRoles);
        setRolId((currentRoleId) => {
          if (
            nextRoles.some(
              (role) => Number(role.id) === Number(currentRoleId)
            )
          ) {
            return currentRoleId;
          }

          return nextRoles.length ? Number(nextRoles[0].id) : "";
        });
      } catch (err) {
        console.error("Error cargando datos de creación masiva:", err);
        setError(err.message || "No se pudieron cargar los datos");
      } finally {
        setLoading(false);
      }
    };

    cargarDatos();
  }, []);

  useEffect(() => {
    if (!useGenericPassword) return;

    setRows((prev) => syncRowsWithGenericPassword(prev, genericPassword));
  }, [useGenericPassword, genericPassword]);

  const proyectoPrincipal = useMemo(() => {
    const id = Number(proyectoPrincipalId);

    if (!id) return null;

    return proyectos.find((project) => Number(project.id) === id) || null;
  }, [proyectoPrincipalId, proyectos]);

  const dominioPrincipal = String(proyectoPrincipal?.dominio || "").trim();

  const proyectosFinales = useMemo(() => {
    const principal = Number(proyectoPrincipalId);
    const ids = proyectosSecundarios.map(Number).filter(Boolean);

    if (principal && !ids.includes(principal)) {
      ids.unshift(principal);
    }

    return [...new Set(ids)];
  }, [proyectoPrincipalId, proyectosSecundarios]);

  const addRow = () => {
    if (rows.length >= MAX_BATCH_USERS) {
      setError("Puedes crear como máximo 100 usuarios por lote.");
      return;
    }

    setError("");
    setRows((prev) => [
      ...prev,
      useGenericPassword
        ? { ...EMPTY_ROW(), contrasena: genericPassword }
        : EMPTY_ROW(),
    ]);
  };

  const removeRow = (index) => {
    if (rows.length === 1) return;

    setRows((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    setVisiblePasswords((prev) => {
      const next = new Set();

      prev.forEach((currentIndex) => {
        if (currentIndex < index) next.add(currentIndex);
        if (currentIndex > index) next.add(currentIndex - 1);
      });

      return next;
    });
  };

  const handleRowChange = (index, field, value) => {
    if (field === "contrasena" && useGenericPassword) {
      return;
    }

    setRows((prev) =>
      prev.map((row, currentIndex) =>
        currentIndex === index ? { ...row, [field]: value } : row
      )
    );
  };

  const togglePasswordVisibility = (index) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  };

  const handlePrincipalChange = (value) => {
    const id = Number(value) || "";

    setProyectoPrincipalId(id);

    if (id) {
      setProyectosSecundarios((prev) =>
        prev.filter((projectId) => Number(projectId) !== id)
      );
    }
  };

  const toggleSecondaryProject = (projectId) => {
    const id = Number(projectId);

    if (id === Number(proyectoPrincipalId)) {
      return;
    }

    setProyectosSecundarios((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handlePermission = (field, checked) => {
    setPermisosChat((prev) => ({
      ...prev,
      [field]: checked ? 1 : 0,
    }));
  };

  const correoPreview = (usuarioBase) => {
    const base = String(usuarioBase || "").trim().toLowerCase();

    if (!base || !dominioPrincipal) {
      return "—";
    }

    return `${base}@${dominioPrincipal.toLowerCase()}`;
  };

  const handleGenericPasswordToggle = (checked) => {
    setUseGenericPassword(checked);

    if (!checked) {
      setGenericPasswordVisible(false);
      return;
    }

    const inheritedPassword =
      genericPassword ||
      rows.find((row) => String(row.contrasena || "").trim())?.contrasena ||
      "";

    setGenericPassword(inheritedPassword);
    setRows((prev) => syncRowsWithGenericPassword(prev, inheritedPassword));
  };

  const handleGenericPasswordChange = (value) => {
    setGenericPassword(value);
  };

  const handleCsvImport = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) return;

    setError("");

    try {
      const rawText = await file.text();
      const parsedRows = parseCsv(rawText);
      const firstMeaningfulIndex = parsedRows.findIndex((row) =>
        row.some((cell) => String(cell || "").trim() !== "")
      );

      if (firstMeaningfulIndex === -1) {
        throw new Error("El CSV no contiene usuarios para importar.");
      }

      const headerRow = parsedRows[firstMeaningfulIndex].map((cell) =>
        normalizeCsvHeader(cell)
      );

      CSV_HEADERS.forEach((header) => {
        if (!headerRow.includes(header)) {
          throw new Error(`El CSV no contiene la columna ${header}.`);
        }
      });

      const buildRowFromCsv = (csvRow) => {
        const getValue = (header) => {
          const columnIndex = headerRow.indexOf(header);
          return columnIndex === -1
            ? ""
            : String(csvRow[columnIndex] ?? "").trim();
        };

        return {
          nombre: getValue("nombre"),
          apellido: getValue("apellido"),
          usuario_base: getValue("usuario_base"),
          contrasena: useGenericPassword
            ? genericPassword
            : getValue("contrasena"),
        };
      };

      const importedRows = parsedRows
        .slice(firstMeaningfulIndex + 1)
        .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
        .map(buildRowFromCsv);

      if (!importedRows.length) {
        setError("El CSV no contiene usuarios para importar.");
        return;
      }

      if (importedRows.length > MAX_BATCH_USERS) {
        setError(
          "El archivo contiene más de 100 usuarios. El máximo permitido por lote es 100."
        );
        return;
      }

      const onlyInitialEmptyRow = rows.length === 1 && rowIsEmpty(rows[0]);
      const currentRowsCount = onlyInitialEmptyRow ? 0 : rows.length;

      if (currentRowsCount + importedRows.length > MAX_BATCH_USERS) {
        setError(
          `La importación superaría el máximo de ${MAX_BATCH_USERS} usuarios por lote. Actualmente hay ${rows.length} filas.`
        );
        return;
      }

      if (!onlyInitialEmptyRow) {
        const shouldAppend = window.confirm(
          "Ya existen usuarios en la tabla. ¿Deseas agregar los usuarios del CSV a las filas actuales?"
        );

        if (!shouldAppend) return;
      }

      setRows((prev) =>
        onlyInitialEmptyRow ? importedRows : [...prev, ...importedRows]
      );
      setVisiblePasswords(new Set());
    } catch (importError) {
      console.error("Error importando CSV:", importError);
      setError(importError.message || "No se pudo importar el archivo CSV.");
    } finally {
      input.value = "";
    }
  };

  const downloadCsvTemplate = () => {
    setError("");

    // Excel en configuraciones regionales en español suele usar punto y coma
    // como separador de columnas CSV. Así, al abrir el archivo directamente,
    // nombre / apellido / usuario_base / contrasena aparecen en 4 columnas.
    const content = `\uFEFF${CSV_HEADERS.join(";")}\r\n`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = "plantilla_usuarios.csv";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const handleSubmit = async () => {
    setError("");

    if (!Number(proyectoPrincipalId)) {
      setError("Debes seleccionar un proyecto principal.");
      return;
    }

    if (!dominioPrincipal) {
      setError(
        "El proyecto principal no tiene dominio. Para cuentas manuales utiliza Gestión de Usuarios."
      );
      return;
    }

    const filaIncompleta = rows.findIndex(
      (row) =>
        !row.nombre.trim() ||
        !row.apellido.trim() ||
        !row.usuario_base.trim() ||
        !row.contrasena
    );

    if (filaIncompleta !== -1) {
      setError(`Completa todos los campos de la fila ${filaIncompleta + 1}.`);
      return;
    }

    setSaving(true);

    try {
      const resp = await fetch("/api/usuarios/admin/batch", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proyecto_principal_id: Number(proyectoPrincipalId),
          proyectos: proyectosFinales,
          rol_id: Number(rolId),
          permisos_chat: permisosChat,
          usuarios: rows.map((row) => ({
            nombre: row.nombre.trim(),
            apellido: row.apellido.trim(),
            usuario_base: row.usuario_base.trim().toLowerCase(),
            contrasena: row.contrasena,
          })),
        }),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setError(data.error || "No se pudieron crear los usuarios.");
        return;
      }

      alert(data.mensaje || `${rows.length} usuarios creados correctamente`);

      if (typeof onCancel === "function") {
        onCancel();
      }
    } catch (err) {
      console.error("Error creando usuarios:", err);
      setError("Error de comunicación al crear los usuarios.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="qc-batch-page">
      <div className="qc-users-bg-decor" aria-hidden="true">
        <span className="qc-users-orb qc-users-orb-one" />
        <span className="qc-users-orb qc-users-orb-two" />
        <span className="qc-users-chat-line qc-users-chat-line-one" />
        <span className="qc-users-chat-line qc-users-chat-line-two" />
        <i className="bi bi-chat-dots qc-users-floating-icon qc-users-floating-icon-one" />
        <i className="bi bi-chat-left-text qc-users-floating-icon qc-users-floating-icon-two" />
      </div>

      <header className="qc-batch-header">
        <div>
          <span className="qc-batch-kicker">CREACIÓN MASIVA</span>
          <h1>Nuevo usuario</h1>
          <p>
            Crea uno o varios usuarios utilizando un proyecto principal y correo
            administrado automáticamente.
          </p>
        </div>

        <button type="button" className="qc-batch-back" onClick={onCancel}>
          <i className="bi bi-arrow-left" aria-hidden="true" />
          Volver
        </button>
      </header>

      <section className="qc-batch-panel">
        <section className="qc-user-admin-section qc-batch-card qc-batch-project-card">
          <div className="qc-batch-card-hero">
            <div className="qc-user-admin-section-head qc-batch-card-head">
              <span className="qc-user-admin-section-icon">
                <i className="bi bi-folder2-open" aria-hidden="true" />
              </span>

              <div>
                <h4>Proyecto principal</h4>
                <p>Define el dominio que utilizarán todos los usuarios del lote.</p>
              </div>
            </div>

            <i
              className="bi bi-folder-fill qc-batch-card-watermark"
              aria-hidden="true"
            />
          </div>

          <div className="qc-user-admin-grid">
            <label className="qc-user-admin-field">
              <span>Proyecto principal</span>

              <select
                value={proyectoPrincipalId}
                disabled={loading || saving}
                onChange={(event) => handlePrincipalChange(event.target.value)}
              >
                <option value="">Seleccionar proyecto</option>

                {proyectos.map((project) => (
                  <option
                    key={project.id}
                    value={project.id}
                    disabled={project.estado !== "activo"}
                  >
                    {project.nombre}
                    {project.estado !== "activo" ? " (Inactivo)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="qc-user-admin-field">
              <span>Dominio resultante</span>

              <div className="qc-user-readonly">
                <i className="bi bi-globe2" aria-hidden="true" />
                {dominioPrincipal || "Selecciona un proyecto"}
              </div>
            </div>
          </div>

          {proyectoPrincipalId && (
            <>
              <div className="qc-batch-subtitle">Otros proyectos</div>

              <div className="qc-user-project-grid">
                {proyectos.map((project) => {
                  const id = Number(project.id);
                  const principal = id === Number(proyectoPrincipalId);
                  const selected =
                    principal || proyectosSecundarios.includes(id);

                  return (
                    <button
                      type="button"
                      key={project.id}
                      className={[
                        "qc-user-project-option",
                        selected ? "is-selected" : "",
                        principal ? "is-principal" : "",
                      ].join(" ")}
                      onClick={() => toggleSecondaryProject(id)}
                      aria-pressed={selected}
                    >
                      <span className="qc-user-project-check">
                        <i
                          className={
                            selected ? "bi bi-check-lg" : "bi bi-folder"
                          }
                          aria-hidden="true"
                        />
                      </span>

                      <span className="qc-user-project-copy">
                        <strong>{project.nombre}</strong>
                        <small>{project.dominio || "Sin dominio"}</small>
                      </span>

                      {principal && (
                        <span className="qc-user-principal-badge">
                          <i className="bi bi-lock-fill" aria-hidden="true" />
                          Principal
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="qc-user-admin-section qc-batch-card qc-batch-users-card">
          <div className="qc-batch-section-topline">
            <div className="qc-user-admin-section-head qc-batch-card-head">
              <span className="qc-user-admin-section-icon">
                <i className="bi bi-people" aria-hidden="true" />
              </span>

              <div>
                <h4>Usuarios del lote</h4>
                <p>
                  Cada usuario tendrá el mismo proyecto principal, rol y proyectos
                  secundarios.
                </p>
              </div>
            </div>

            <div className="qc-batch-actions-toolbar" aria-label="Acciones del lote">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="qc-batch-file-input"
                onChange={handleCsvImport}
                tabIndex={-1}
                aria-hidden="true"
              />

              <button
                type="button"
                onClick={() => csvInputRef.current?.click()}
                disabled={saving}
              >
                <i className="bi bi-download" aria-hidden="true" />
                Importar CSV
              </button>

              <button type="button" onClick={downloadCsvTemplate} disabled={saving}>
                <i className="bi bi-file-earmark-spreadsheet" aria-hidden="true" />
                Descargar Plantilla
              </button>

              <button
                type="button"
                className="qc-batch-add-row"
                onClick={addRow}
                disabled={saving || rows.length >= MAX_BATCH_USERS}
              >
                <i className="bi bi-plus-lg" aria-hidden="true" />
                Agregar fila
              </button>
            </div>
          </div>

          <div className="qc-batch-users-meta">
            <div className="qc-batch-count-pill" aria-live="polite">
              <strong>{rows.length}</strong> {rows.length === 1 ? "usuario" : "usuarios"}
            </div>

            <div className="qc-batch-generic-bar">
              <label className="qc-batch-generic-check">
                <input
                  type="checkbox"
                  checked={useGenericPassword}
                  onChange={(event) =>
                    handleGenericPasswordToggle(event.target.checked)
                  }
                  disabled={saving}
                />
                <span>Contraseña genérica</span>
              </label>

              <button
                type="button"
                className="qc-batch-generic-info"
                tabIndex={-1}
                aria-hidden="true"
                title="Si la activas, la contraseña que escribas aquí se aplicará a todos los usuarios del lote."
              >
                <i className="bi bi-info-circle" aria-hidden="true" />
              </button>

              <div
                className={[
                  "qc-batch-generic-password-field",
                  !useGenericPassword ? "is-disabled" : "",
                ].join(" ")}
              >
                <span className="qc-batch-generic-prefix" aria-hidden="true">
                  <i className="bi bi-lock" />
                </span>

                <input
                  type={genericPasswordVisible ? "text" : "password"}
                  value={genericPassword}
                  disabled={!useGenericPassword || saving}
                  placeholder="Ingresa la contraseña"
                  autoComplete="new-password"
                  onChange={(event) =>
                    handleGenericPasswordChange(event.target.value)
                  }
                />

                <button
                  type="button"
                  className="qc-batch-password-toggle"
                  disabled={!useGenericPassword || saving}
                  aria-label={
                    genericPasswordVisible
                      ? "Ocultar contraseña genérica"
                      : "Mostrar contraseña genérica"
                  }
                  title={
                    genericPasswordVisible
                      ? "Ocultar contraseña genérica"
                      : "Mostrar contraseña genérica"
                  }
                  onClick={() =>
                    setGenericPasswordVisible((current) => !current)
                  }
                >
                  <i
                    className={
                      genericPasswordVisible ? "bi bi-eye-slash" : "bi bi-eye"
                    }
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
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
                  <th>Correo resultante</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => {
                  const passwordVisible = visiblePasswords.has(index);

                  return (
                    <tr key={index}>
                      <td className="qc-batch-index">{index + 1}</td>

                      <td>
                        <input
                          value={row.nombre}
                          placeholder="Juan"
                          disabled={saving}
                          onChange={(event) =>
                            handleRowChange(index, "nombre", event.target.value)
                          }
                        />
                      </td>

                      <td>
                        <input
                          value={row.apellido}
                          placeholder="Pérez"
                          disabled={saving}
                          onChange={(event) =>
                            handleRowChange(index, "apellido", event.target.value)
                          }
                        />
                      </td>

                      <td>
                        <input
                          value={row.usuario_base}
                          placeholder="juan.perez"
                          disabled={saving}
                          onChange={(event) =>
                            handleRowChange(index, "usuario_base", event.target.value)
                          }
                        />
                      </td>

                      <td>
                        <div
                          className={[
                            "qc-batch-password-field",
                            useGenericPassword ? "is-disabled" : "",
                          ].join(" ")}
                        >
                          <button
                            type="button"
                            className="qc-batch-password-toggle"
                            aria-label={
                              passwordVisible
                                ? "Ocultar contraseña"
                                : "Mostrar contraseña"
                            }
                            title={
                              passwordVisible
                                ? "Ocultar contraseña"
                                : "Mostrar contraseña"
                            }
                            onClick={() => togglePasswordVisibility(index)}
                            disabled={useGenericPassword || saving}
                          >
                            <i
                              className={
                                passwordVisible ? "bi bi-eye-slash" : "bi bi-eye"
                              }
                              aria-hidden="true"
                            />
                          </button>

                          <input
                            type={passwordVisible ? "text" : "password"}
                            value={row.contrasena}
                            placeholder={
                              useGenericPassword
                                ? "Contraseña genérica"
                                : "Contraseña"
                            }
                            autoComplete="new-password"
                            disabled={useGenericPassword || saving}
                            onChange={(event) =>
                              handleRowChange(index, "contrasena", event.target.value)
                            }
                          />
                        </div>
                      </td>

                      <td>
                        <div className="qc-batch-email">
                          <i className="bi bi-envelope" aria-hidden="true" />
                          <span>{correoPreview(row.usuario_base)}</span>
                        </div>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="qc-batch-remove"
                          disabled={rows.length === 1 || saving}
                          onClick={() => removeRow(index)}
                          title="Eliminar fila"
                          aria-label={`Eliminar fila ${index + 1}`}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="qc-user-admin-section qc-batch-card qc-batch-role-card">
          <div className="qc-user-admin-section-head qc-batch-card-head">
            <span className="qc-user-admin-section-icon">
              <i className="bi bi-person-gear" aria-hidden="true" />
            </span>

            <div>
              <h4>Rol y permisos</h4>
              <p>Se aplicarán por igual a todos los usuarios del lote.</p>
            </div>
          </div>

          <div className="qc-user-role-grid">
            {roles.map((role) => {
              const selected = Number(rolId) === Number(role.id);

              return (
                <button
                  key={role.id}
                  type="button"
                  className={selected ? "is-selected" : ""}
                  onClick={() => setRolId(Number(role.id))}
                  aria-pressed={selected}
                >
                  <i className={roleIcon(role)} aria-hidden="true" />
                  <strong>{role.nombre}</strong>
                  <small>{role.descripcion || "Rol del sistema"}</small>
                </button>
              );
            })}
          </div>

          <div className="qc-batch-subtitle">Permisos del chat</div>

          <div className="qc-user-permission-grid">
            {[
              ["crear_grupos", "Crear grupos", "bi bi-people"],
              ["editar_mensajes", "Editar mensajes", "bi bi-pencil-square"],
              ["enviar_audios", "Grabar audios", "bi bi-mic"],
              ["eliminar_mensajes", "Eliminar mensajes", "bi bi-trash"],
            ].map(([field, label, icon]) => (
              <label className="qc-user-permission-option" key={field}>
                <span className="qc-user-permission-icon">
                  <i className={icon} aria-hidden="true" />
                </span>

                <span>
                  <strong>{label}</strong>
                  <small>Aplicar a todos</small>
                </span>

                <input
                  type="checkbox"
                  checked={Number(permisosChat[field]) === 1}
                  onChange={(event) =>
                    handlePermission(field, event.target.checked)
                  }
                />
              </label>
            ))}
          </div>
        </section>

        {error && (
          <div className="qc-user-admin-error qc-batch-error" role="alert">
            <i className="bi bi-exclamation-triangle" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="qc-user-admin-actions qc-batch-final-actions">
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
            disabled={saving || loading}
          >
            <i className="bi bi-person-plus me-2" aria-hidden="true" />
            {saving
              ? "Creando..."
              : `Crear ${rows.length} ${rows.length === 1 ? "usuario" : "usuarios"}`}
          </button>
        </div>
      </section>
    </main>
  );
};

export default AddUsers;
