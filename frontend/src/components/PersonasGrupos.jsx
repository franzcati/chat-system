import React, { useEffect, useMemo, useState } from "react";
import socket, { conectarUsuarioSocket } from "../socket";
import { getAvatarUrl } from "../utils/url";
import { logDev } from "../utils/logger";

const getInitials = (usuario) => {
  const nombre = String(usuario?.nombre || "").trim();
  const apellido = String(usuario?.apellido || "").trim();
  return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase() || "U";
};

const getPresence = (usuario, usuariosSocket) => {
  const socketState = usuariosSocket?.[String(usuario.id)] || usuariosSocket?.[Number(usuario.id)];
  const raw = socketState?.estado || "desconectado";

  if (raw === "online" || raw === "en_linea") {
    return { label: "En línea", className: "online" };
  }

  if (raw === "inactivo" || raw === "ausente") {
    return { label: "Ausente", className: "away" };
  }

  if (raw === "no_molestar") {
    return { label: "No molestar", className: "dnd" };
  }

  return { label: "Desconectado", className: "offline" };
};

const PersonasGrupos = ({ usuarioId, selectedMembers = [], onSelectionChange }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [usuariosSocket, setUsuariosSocket] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const fetchUsuarios = async () => {
      setLoading(true);
      setLoadError("");

      try {
        const response = await fetch(`/api/grupos/${usuarioId}/todos-usuarios`);
        const data = await response.json().catch(() => []);

        if (!response.ok) {
          throw new Error(data?.error || "No se pudieron cargar los usuarios");
        }

        setUsuarios(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error cargando usuarios:", error);
        setLoadError(error.message || "No se pudieron cargar los usuarios");
      } finally {
        setLoading(false);
      }
    };

    if (usuarioId) {
      fetchUsuarios();
    } else {
      setLoading(false);
    }
  }, [usuarioId]);

  useEffect(() => {
    if (!usuarioId) return undefined;

    conectarUsuarioSocket(usuarioId);

    const handleActualizarUsuarios = (data) => {
      setUsuariosSocket(data || {});
    };

    socket.on("actualizarUsuarios", handleActualizarUsuarios);

    return () => {
      socket.off("actualizarUsuarios", handleActualizarUsuarios);
    };
  }, [usuarioId]);

  const selectedIds = useMemo(
    () => new Set(selectedMembers.map((member) => Number(member?.id ?? member))),
    [selectedMembers]
  );

  const usuariosFiltrados = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return usuarios
      .filter((usuario) => Number(usuario.id) !== Number(usuarioId))
      .filter((usuario) => {
        if (!query) return true;
        const searchable = `${usuario.nombre || ""} ${usuario.apellido || ""} ${usuario.correo || ""}`.toLowerCase();
        return searchable.includes(query);
      })
      .sort((a, b) =>
        `${a.nombre || ""} ${a.apellido || ""}`.localeCompare(
          `${b.nombre || ""} ${b.apellido || ""}`,
          "es",
          { sensitivity: "base" }
        )
      );
  }, [usuarios, usuarioId, searchTerm]);

  const toggleMember = (usuario) => {
    const id = Number(usuario.id);
    const isSelected = selectedIds.has(id);

    const next = isSelected
      ? selectedMembers.filter((member) => Number(member?.id ?? member) !== id)
      : [...selectedMembers, usuario];

    logDev("📤 Notificando selección al padre:", next);
    onSelectionChange?.(next);
  };

  return (
    <div className="qc-group-users-browser">
      <div className="qc-group-search-wrap">
        <i className="bi bi-search" aria-hidden="true" />
        <input
          type="search"
          value={searchTerm}
          placeholder="Buscar usuarios por nombre o correo..."
          aria-label="Buscar usuarios"
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      <div className="qc-group-users-list" role="list">
        {loading && (
          <div className="qc-group-list-state">
            <span className="qc-group-spinner" aria-hidden="true" />
            <p>Cargando usuarios...</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="qc-group-list-state is-error">
            <i className="bi bi-exclamation-circle" aria-hidden="true" />
            <p>{loadError}</p>
          </div>
        )}

        {!loading && !loadError && usuariosFiltrados.length === 0 && (
          <div className="qc-group-list-state">
            <i className="bi bi-people" aria-hidden="true" />
            <p>{searchTerm ? "No encontramos usuarios con esa búsqueda." : "No hay usuarios disponibles."}</p>
          </div>
        )}

        {!loading && !loadError && usuariosFiltrados.map((usuario) => {
          const isSelected = selectedIds.has(Number(usuario.id));
          const presence = getPresence(usuario, usuariosSocket);

          return (
            <div className={`qc-group-user-row ${isSelected ? "is-selected" : ""}`} key={usuario.id} role="listitem">
              <span
                className="qc-group-member-avatar"
                style={{ background: usuario.background || "#2f7cf6" }}
              >
                {usuario.url_imagen ? (
                  <img src={getAvatarUrl(usuario.url_imagen)} alt="" />
                ) : (
                  getInitials(usuario)
                )}
              </span>

              <span className="qc-group-user-copy">
                <strong>{`${usuario.nombre || ""} ${usuario.apellido || ""}`.trim()}</strong>
                <small>{usuario.correo || "Usuario del sistema"}</small>
              </span>

              <span className={`qc-group-presence ${presence.className}`}>
                <span />
                {presence.label}
              </span>

              <button
                type="button"
                className="qc-group-add-member"
                onClick={() => toggleMember(usuario)}
                aria-label={isSelected ? `Quitar a ${usuario.nombre}` : `Agregar a ${usuario.nombre}`}
                title={isSelected ? "Quitar miembro" : "Agregar miembro"}
              >
                <i className={isSelected ? "bi bi-check-lg" : "bi bi-plus-lg"} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PersonasGrupos;
