import { useEffect, useMemo, useState } from "react";
import { getAvatarUrl } from "../utils/url";
import { logDev } from "../utils/logger";

const getInitials = (nombre = "", apellido = "") => {
  const first = String(nombre || "").trim().charAt(0);
  const last = String(apellido || "").trim().charAt(0);
  return `${first}${last}`.trim().toUpperCase() || "U";
};

const MiembrosGrupos = ({ grupo, usuarioId, onClose }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [grupoInfo, setGrupoInfo] = useState({ privacidad: "publico", rol: "miembro" });
  const [miembrosActuales, setMiembrosActuales] = useState(new Set());
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const grupoId = grupo?.id || grupo?.grupo_id;

  useEffect(() => {
    if (!grupoId || !usuarioId) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    const fetchUsuarios = async () => {
      setCargando(true);
      setErrorCarga("");
      setUsuarios([]);
      setMiembrosActuales(new Set());
      setSeleccionados(new Set());
      setGrupoInfo({ privacidad: "publico", rol: "miembro" });

      try {
        const url = `/api/grupos/${grupoId}/usuarios-comunes/${usuarioId}`;
        const res = await fetch(url, { signal: controller.signal });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};

        if (!res.ok) {
          throw new Error(data?.error || "No se pudieron cargar los contactos");
        }

        if (cancelled) return;

        const listaUsuarios = Array.isArray(data?.usuarios) ? data.usuarios : [];
        const idsMiembros = new Set(
          listaUsuarios
            .filter((usuario) => Number(usuario?.en_grupo) === 1)
            .map((usuario) => Number(usuario.id))
        );

        setUsuarios(listaUsuarios);
        setGrupoInfo(data?.grupo || { privacidad: "publico", rol: "miembro" });
        setMiembrosActuales(idsMiembros);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("❌ Error cargando usuarios:", err);
        if (!cancelled) {
          setUsuarios([]);
          setMiembrosActuales(new Set());
          setErrorCarga(err?.message || "No se pudieron cargar los contactos");
        }
      } finally {
        if (!cancelled) setCargando(false);
      }
    };

    fetchUsuarios();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [grupoId, usuarioId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !guardando) onClose?.();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [guardando, onClose]);

  const puedeAgregar = ["propietario", "admin"].includes(grupoInfo?.rol);

  const toggleSeleccion = (id) => {
    const numericId = Number(id);
    if (!puedeAgregar || miembrosActuales.has(numericId) || guardando) return;

    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(numericId)) nuevo.delete(numericId);
      else nuevo.add(numericId);
      return nuevo;
    });
  };

  const handleAceptar = async () => {
    if (!grupoId || !usuarioId || !puedeAgregar || seleccionados.size === 0 || guardando) return;

    setGuardando(true);

    try {
      // El endpoint actual reemplaza la lista de miembros. Para que este modal siga siendo
      // exclusivamente de “Añadir miembro”, enviamos los miembros existentes + los nuevos.
      const miembros = Array.from(new Set([
        ...Array.from(miembrosActuales),
        ...Array.from(seleccionados),
      ]));

      const res = await fetch(`/api/grupos/${grupoId}/actualizar-miembros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ miembros, usuarioId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Error al actualizar miembros");

      logDev("✅ Miembros actualizados:", data);
      alert("✅ Miembros actualizados correctamente");

      if (onClose) onClose();
    } catch (err) {
      console.error("❌ Error actualizando miembros:", err);
      alert(`❌ ${err?.message || "Ocurrió un error al actualizar los miembros"}`);
    } finally {
      setGuardando(false);
    }
  };

  const usuariosFiltrados = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return usuarios;

    return usuarios.filter((usuario) => {
      const searchable = [
        usuario?.nombre,
        usuario?.apellido,
        usuario?.correo,
        usuario?.telefono,
        usuario?.celular,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(needle);
    });
  }, [usuarios, searchTerm]);

  const seleccionCount = seleccionados.size;
  const seleccionLabel = `${seleccionCount} ${seleccionCount === 1 ? "seleccionado" : "seleccionados"}`;

  if (!grupo) return null;

  return (
    <div className="wa-add-member-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !guardando) onClose?.();
    }}>
      <section
        className="wa-add-member-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-add-member-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="wa-add-member-header">
          <div className="wa-add-member-heading">
            <span className="wa-add-member-heading-icon" aria-hidden="true">
              <i className="fa-solid fa-user-plus" />
            </span>
            <div>
              <h2 id="wa-add-member-title">Añadir miembro</h2>
              <p>Busca y selecciona contactos para añadir al grupo</p>
            </div>
          </div>

          <button
            type="button"
            className="wa-add-member-close"
            aria-label="Cerrar"
            title="Cerrar"
            onClick={onClose}
            disabled={guardando}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="wa-add-member-search-wrap">
          <label className="wa-add-member-search" htmlFor="wa-add-member-search-input">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input
              id="wa-add-member-search-input"
              type="search"
              placeholder="Buscar un nombre o número"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </label>
        </div>

        <div className="wa-add-member-list-shell">
          <div className="wa-add-member-list-label">Contactos</div>

          <div className="wa-add-member-list" role="list">
            {cargando ? (
              <div className="wa-add-member-state" role="status">
                <span className="wa-add-member-spinner" aria-hidden="true" />
                <span>Cargando contactos…</span>
              </div>
            ) : errorCarga ? (
              <div className="wa-add-member-state is-error" role="alert">
                <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                <span>{errorCarga}</span>
              </div>
            ) : usuariosFiltrados.length === 0 ? (
              <div className="wa-add-member-state">
                <i className="fa-regular fa-user" aria-hidden="true" />
                <span>No se encontraron contactos</span>
              </div>
            ) : (
              usuariosFiltrados.map((usuario) => {
                const id = Number(usuario.id);
                const yaEnGrupo = Number(usuario?.en_grupo) === 1 || miembrosActuales.has(id);
                const seleccionado = seleccionados.has(id);
                const disabled = yaEnGrupo || !puedeAgregar || guardando;
                const nombreCompleto = `${usuario?.nombre || ""} ${usuario?.apellido || ""}`.trim() || "Usuario";

                return (
                  <div
                    key={usuario.id}
                    className={`wa-add-member-row${seleccionado ? " is-selected" : ""}${yaEnGrupo ? " is-member" : ""}${disabled ? " is-disabled" : ""}`}
                    role="listitem"
                    onClick={() => !disabled && toggleSeleccion(id)}
                  >
                    <label className="wa-add-member-check-wrap" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="wa-add-member-check"
                        checked={seleccionado}
                        onChange={() => toggleSeleccion(id)}
                        disabled={disabled}
                        aria-label={yaEnGrupo ? `${nombreCompleto} ya forma parte del grupo` : `Seleccionar ${nombreCompleto}`}
                      />
                      <span className="wa-add-member-check-ui" aria-hidden="true">
                        <i className="fa-solid fa-check" />
                      </span>
                    </label>

                    <div className="wa-add-member-avatar" aria-hidden="true">
                      {usuario.url_imagen ? (
                        <img src={getAvatarUrl(usuario.url_imagen)} alt="" />
                      ) : (
                        <span style={{ background: usuario.background || "#60758f" }}>
                          {getInitials(usuario.nombre, usuario.apellido)}
                        </span>
                      )}
                    </div>

                    <div className="wa-add-member-user-copy">
                      <strong>{nombreCompleto}</strong>
                      {yaEnGrupo ? (
                        <span className="wa-add-member-member-status">Ya forma parte del grupo</span>
                      ) : (
                        <span className="wa-add-member-available-status">
                          <i aria-hidden="true" />
                          {usuario.estado || "Disponible"}
                        </span>
                      )}
                    </div>

                    {yaEnGrupo && (
                      <span className="wa-add-member-member-badge">En el grupo</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="wa-add-member-helper-row">
          <div className="wa-add-member-helper-copy">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            <span>
              {grupoInfo.privacidad === "publico"
                ? "Todos los miembros pueden añadir a otras personas a este grupo."
                : "Solo los administradores y el propietario pueden añadir a otras personas a este grupo."}
            </span>
          </div>
          <strong>{seleccionLabel}</strong>
        </div>

        <footer className="wa-add-member-footer">
          <button
            type="button"
            className="wa-add-member-cancel"
            onClick={onClose}
            disabled={guardando}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="wa-add-member-submit"
            onClick={handleAceptar}
            disabled={!puedeAgregar || seleccionCount === 0 || cargando || guardando}
          >
            {guardando ? (
              <span className="wa-add-member-submit-loading" aria-hidden="true" />
            ) : (
              <i className="fa-solid fa-user-plus" aria-hidden="true" />
            )}
            <span>{guardando ? "Añadiendo…" : "Añadir seleccionados"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
};

export default MiembrosGrupos;
