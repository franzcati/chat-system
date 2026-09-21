import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Lock,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "feather-icons-react";

const ProjectMembersManager = ({
  mode = "create",
  projectId = null,
  selectedIds = [],
  onSelectedIdsChange,
  onCountChange,
}) => {
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedCache, setSelectedCache] = useState({});

  const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
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
  };

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          limit: "200",
        });

        if (search.trim()) {
          query.set("search", search.trim());
        }

        if (mode === "create") {
          const data = await fetchJson(
            `/api/proyecto/admin/member-candidates?${query.toString()}`
          );

          if (!cancelled) {
            setCandidates(
              Array.isArray(data?.usuarios)
                ? data.usuarios
                : []
            );
          }

          return;
        }

        if (!projectId) return;

        const [membersData, candidatesData] =
          await Promise.all([
            fetchJson(
              `/api/proyecto/admin/${projectId}/members?limit=200`
            ),
            fetchJson(
              `/api/proyecto/admin/${projectId}/member-candidates?${query.toString()}`
            ),
          ]);

        if (cancelled) return;

        const currentMembers = Array.isArray(
          membersData?.miembros
        )
          ? membersData.miembros
          : [];

        setMembers(currentMembers);

        setCandidates(
          Array.isArray(candidatesData?.usuarios)
            ? candidatesData.usuarios
            : []
        );

        if (typeof onCountChange === "function") {
          onCountChange(
            Number(
              membersData?.pagination?.total ??
                currentMembers.length
            )
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              "No se pudieron cargar los miembros."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, projectId, search, refreshKey]);

  const toggleCreateMember = (userId) => {
    if (typeof onSelectedIdsChange !== "function") return;

    const numericId = Number(userId);

    if (selectedIds.includes(numericId)) {
      onSelectedIdsChange(
        selectedIds.filter((id) => id !== numericId)
      );
    } else {
      onSelectedIdsChange([
        ...selectedIds,
        numericId,
      ]);
    }
  };

  const toggleEditCandidate = (userId) => {
    const numericId = Number(userId);

    setSelectedToAdd((prev) =>
      prev.includes(numericId)
        ? prev.filter((id) => id !== numericId)
        : [...prev, numericId]
    );
  };

  const addSelectedMembers = async () => {
    if (
      !projectId ||
      selectedToAdd.length === 0 ||
      busy
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await fetchJson(
        `/api/proyecto/admin/${projectId}/members`,
        {
          method: "POST",
          body: JSON.stringify({
            usuario_ids: selectedToAdd,
          }),
        }
      );

      setSelectedToAdd([]);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(
        err.message ||
          "No se pudieron agregar los miembros."
      );
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member) => {
    if (
      !projectId ||
      !member?.id ||
      member.es_proyecto_principal ||
      busy
    ) {
      return;
    }

    const nombre = `${member.nombre || ""} ${
      member.apellido || ""
    }`.trim();

    if (
      !window.confirm(
        `¿Quitar a ${nombre} de este proyecto?`
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await fetchJson(
        `/api/proyecto/admin/${projectId}/members/${member.id}`,
        {
          method: "DELETE",
        }
      );

      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(
        err.message ||
          "No se pudo quitar el miembro."
      );
    } finally {
      setBusy(false);
    }
  };

  const initials = (usuario) => {
    const a =
      String(usuario?.nombre || "").trim().charAt(0);
    const b =
      String(usuario?.apellido || "").trim().charAt(0);

    return `${a}${b}`.toUpperCase() || "U";
  };
  useEffect(() => {
    if (mode !== "create") return;

    setSelectedCache((prev) => {
      const next = { ...prev };
      let changed = false;

      candidates.forEach((usuario) => {
        const id = Number(usuario?.id);
        if (!Number.isNaN(id) && selectedIds.includes(id)) {
          next[id] = usuario;
          changed = true;
        }
      });

      Object.keys(next).forEach((key) => {
        if (!selectedIds.includes(Number(key))) {
          delete next[key];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [candidates, mode, selectedIds]);

  const selectedUsers = useMemo(() => {
    const pool = [...members, ...candidates, ...Object.values(selectedCache)];
    const byId = new Map();

    pool.forEach((usuario) => {
      const id = Number(usuario?.id);
      if (!Number.isNaN(id) && !byId.has(id)) {
        byId.set(id, usuario);
      }
    });

    return (selectedIds || [])
      .map((id) => byId.get(Number(id)))
      .filter(Boolean);
  }, [candidates, members, selectedCache, selectedIds]);


  return (
    <section className="pmm-box">
      <div className="pmm-heading">
        <div>
          <Users size={19} />
        </div>

        <span>
          <strong>
            {mode === "create"
              ? "Miembros iniciales"
              : "Miembros del proyecto"}
          </strong>

          <small>
            Ser miembro no cambia el proyecto principal
            ni el correo del usuario.
          </small>
        </span>
      </div>

      {mode === "edit" && (
        <div className="pmm-current">
          <div className="pmm-section-title">
            <span>Miembros actuales</span>
            <b>{members.length}</b>
          </div>

          {loading && members.length === 0 ? (
            <div className="pmm-empty">
              Cargando miembros...
            </div>
          ) : members.length === 0 ? (
            <div className="pmm-empty">
              Este proyecto todavía no tiene miembros.
            </div>
          ) : (
            <div className="pmm-member-list">
              {members.map((member) => (
                <div
                  className="pmm-member"
                  key={member.id}
                >
                  <div
                    className="pmm-avatar"
                    style={{
                      background:
                        member.background ||
                        "#168cff",
                    }}
                  >
                    {member.url_imagen ? (
                      <img
                        src={member.url_imagen}
                        alt=""
                      />
                    ) : (
                      initials(member)
                    )}
                  </div>

                  <div className="pmm-user-info">
                    <strong>
                      {member.nombre} {member.apellido}
                    </strong>
                    <small>{member.correo}</small>
                  </div>

                  {member.es_proyecto_principal ? (
                    <span
                      className="pmm-primary-badge"
                      title="Este es su proyecto principal"
                    >
                      <Lock size={12} />
                      Principal
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="pmm-remove"
                      title="Quitar del proyecto"
                      aria-label={`Quitar a ${[member.nombre, member.apellido].filter(Boolean).join(" ").trim() || "usuario"} del proyecto`}
                      disabled={busy}
                      onClick={() =>
                        removeMember(member)
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="pmm-section-title pmm-available-title">
        <span>
          {mode === "create"
            ? "Seleccionar usuarios"
            : "Agregar miembros"}
        </span>

        <b>
          {mode === "create"
            ? selectedIds.length
            : selectedToAdd.length}{" "}
          seleccionados
        </b>
      </div>

      <div className={`pmm-search ${mode === "create" ? "is-create" : ""}`}>
        {mode === "create" && (
          <div className="pmm-inline-selected" aria-hidden="true">
            {selectedUsers.length === 0 ? (
              <span className="pmm-inline-placeholder">Sin miembros</span>
            ) : (
              <>
                {selectedUsers.slice(0, 4).map((usuario) => (
                  <span
                    key={usuario.id}
                    className="pmm-inline-avatar"
                    style={{ background: usuario.background || "#168cff" }}
                  >
                    {usuario.url_imagen ? (
                      <img src={usuario.url_imagen} alt="" />
                    ) : (
                      initials(usuario)
                    )}
                  </span>
                ))}

                {selectedUsers.length > 4 && (
                  <span className="pmm-inline-more">+{selectedUsers.length - 4}</span>
                )}
              </>
            )}
          </div>
        )}

        <Search size={16} />

        <input
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder={
            mode === "create"
              ? "Buscar y agregar miembros..."
              : "Buscar por nombre o correo..."
          }
          aria-label="Buscar usuarios para el proyecto"
        />

        {mode === "create" && <ChevronDown size={16} className="pmm-inline-chevron" />}
      </div>

      <div className="pmm-candidates">
        {loading ? (
          <div className="pmm-empty">
            Cargando usuarios...
          </div>
        ) : candidates.length === 0 ? (
          <div className="pmm-empty">
            No hay usuarios disponibles.
          </div>
        ) : (
          candidates.map((usuario) => {
            const checked =
              mode === "create"
                ? selectedIds.includes(
                    Number(usuario.id)
                  )
                : selectedToAdd.includes(
                    Number(usuario.id)
                  );

            return (
              <button
                type="button"
                key={usuario.id}
                className={`pmm-candidate ${
                  checked ? "selected" : ""
                }`}
                aria-pressed={checked}
                onClick={() =>
                  mode === "create"
                    ? toggleCreateMember(usuario.id)
                    : toggleEditCandidate(usuario.id)
                }
              >
                <span
                  className="pmm-check"
                  aria-hidden="true"
                >
                  {checked && <Check size={14} />}
                </span>

                <span
                  className="pmm-avatar"
                  style={{
                    background:
                      usuario.background ||
                      "#168cff",
                  }}
                >
                  {usuario.url_imagen ? (
                    <img
                      src={usuario.url_imagen}
                      alt=""
                    />
                  ) : (
                    initials(usuario)
                  )}
                </span>

                <span className="pmm-user-info">
                  <strong>
                    {usuario.nombre}{" "}
                    {usuario.apellido}
                  </strong>

                  <small>
                    {usuario.correo}
                  </small>
                </span>

                {usuario.proyecto_principal_id && (
                  <span className="pmm-project-ref">
                    Principal #
                    {usuario.proyecto_principal_id}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {error && (
        <div className="pmm-error">{error}</div>
      )}

      {mode === "edit" && (
        <button
          type="button"
          className="pmm-add-btn"
          disabled={
            selectedToAdd.length === 0 ||
            busy
          }
          onClick={addSelectedMembers}
        >
          <UserPlus size={17} />

          {busy
            ? "Procesando..."
            : `Agregar seleccionados (${selectedToAdd.length})`}
        </button>
      )}
    </section>
  );
};

export default ProjectMembersManager;
