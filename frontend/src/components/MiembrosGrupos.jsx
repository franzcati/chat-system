import { useEffect, useState } from "react";
import { getAvatarUrl } from "../utils/url";

const getInitials = (nombre = "", apellido = "") =>
  (nombre?.charAt(0)?.toUpperCase() || "") +
  (apellido?.charAt(0)?.toUpperCase() || "");

const MiembrosGrupos = ({ grupo, usuarioId, onClose }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [grupoInfo, setGrupoInfo] = useState({ privacidad: "publico", rol: "miembro" });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [originalSeleccionados, setOriginalSeleccionados] = useState(new Set()); // 👈 Guarda el estado inicial
  const [searchTerm, setSearchTerm] = useState("");
  const grupoId = grupo.id || grupo.grupo_id;

  // 🔹 Cargar usuarios
  useEffect(() => {
    if (!grupo || !usuarioId) return;
    const fetchUsuarios = async () => {
      try {
        const url = `/api/grupos/${grupoId}/usuarios-comunes/${usuarioId}`;
        const res = await fetch(url);
        const text = await res.text();
        const data = JSON.parse(text);

        const seleccionInicial = new Set(
          (data.usuarios || []).filter(u => u.en_grupo === 1).map(u => u.id)
        );

        setUsuarios(data.usuarios || []);
        setGrupoInfo(data.grupo || { privacidad: "publico", rol: "miembro" });
        setSeleccionados(seleccionInicial);
        setOriginalSeleccionados(new Set(seleccionInicial)); // 👈 Guarda copia original
      } catch (err) {
        console.error("❌ Error cargando usuarios:", err);
      }
    };
    fetchUsuarios();
  }, [grupo, usuarioId]);

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  };

  const handleAceptar = async () => {
    try {
      const body = { miembros: Array.from(seleccionados), usuarioId };

      const res = await fetch(
        `/api/grupos/${grupoId}/actualizar-miembros`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) throw new Error("Error al actualizar miembros");

      const data = await res.json();
      console.log("✅ Miembros actualizados:", data);

      // ✅ Mostrar una notificación suave (reemplaza alert)
      // Puedes usar toastify, sweetalert2, o un pequeño aviso temporal si prefieres
      alert("✅ Miembros actualizados correctamente");

      // 👇 Cierra el modal
      if (onClose) onClose();

    } catch (err) {
      console.error("❌ Error actualizando miembros:", err);
      alert("❌ Ocurrió un error al actualizar los miembros");
    }
  };

   // 👇 Detecta si hubo cambios
  const hayCambios = (() => {
    if (seleccionados.size !== originalSeleccionados.size) return true;
    for (let id of seleccionados) {
      if (!originalSeleccionados.has(id)) return true;
    }
    return false;
  })();

  const usuariosFiltrados = usuarios.filter((m) =>
    `${m.nombre} ${m.apellido}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!grupo) return null;

  return (
    <div
      className="modal fade show d-block"
      tabIndex="-1"
      role="dialog"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.5)", // 👈 oscurece solo el fondo
        zIndex: 1050, // asegura que quede encima del contenido
      }}
    >
      <div 
        className="modal-dialog modal-dialog-centered"
        role="document"
        style={{
          width: "clamp(320px, 90%, 460px)", // 👈 se ajusta automáticamente
        }}
      >
        <div className="modal-content rounded-3 shadow-lg">
          {/* Header */}
          <div className="modal-header border-0 pb-0">
            
            <h5 className="modal-title fw-semibold">Añadir miembro</h5>
            <button
              type="button"
              className="btn-close"
              data-bs-dismiss="modal"
              aria-label="Close"
              onClick={onClose}
            ></button>
          </div>

          {/* Search */}
          <div className="px-4 mt-6 mb-7">
            <input
              type="text"
              className="form-control form-control-lg rounded-pill border-2 border-success"
              placeholder="Buscar un nombre o número"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Body */}
          <div
            className="modal-body pt-0"
            style={{ maxHeight: "60vh", overflowY: "auto" }}
          >
            <h6 className="text-muted small ms-2 mb-2">Contactos</h6>
            <ul className="list-group list-group-flush">
              {usuariosFiltrados.map((m) => {
                const yaEnGrupo = seleccionados.has(m.id); // 👈 Saber si ya pertenece

                return (
                  <li key={m.id} className="list-group-item border-0 px-2 py-2">
                    <div className="d-flex align-items-center">
                      {/* ✅ Check primero */}
                      <div className="me-3">
                        <input
                          type="checkbox"
                          className="form-check-input border-success"
                          style={{
                            width: "18px",
                            height: "18px",
                            cursor: "pointer",
                          }}
                          checked={yaEnGrupo}
                          onChange={() => toggleSeleccion(m.id)}
                          disabled={
                            grupoInfo.rol === "miembro" ||
                            (grupoInfo.rol === "admin" && m.rol === "propietario")
                          }
                        />
                      </div>

                      {/* Avatar */}
                      <div className="me-3 flex-shrink-0">
                        {m.url_imagen ? (
                          <img
                            src={getAvatarUrl(m.url_imagen)}
                            alt={m.nombre}
                            className="rounded-circle"
                            style={{ width: 40, height: 40, objectFit: "cover" }}
                          />
                        ) : (
                          <div
                            className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                            style={{
                              width: "40px",
                              height: "40px",
                              background: m.background || "#6c757d",
                              fontSize: "16px",
                            }}
                          >
                            {getInitials(m.nombre)}
                          </div>
                        )}
                      </div>

                      {/* Nombre y estado */}
                      <div className="flex-grow-1 text-truncate">
                        <strong
                          className="d-block small"
                          style={{ color: yaEnGrupo ? "" : "#000" }} // 👈 gris si ya está, negro si no
                        >
                          {m.nombre} {m.apellido}
                        </strong>

                        {yaEnGrupo ? (
                          <em className="fst-italic text-muted small">Ya forma parte del grupo</em>
                        ) : (
                          <span className="small">
                            {m.estado || "Disponible"}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          
          {/* Footer */}
          <div className="modal-footer border-0 d-flex justify-content-end align-items-center gap-3">
            <small className="text-muted">
              {grupoInfo.privacidad === "publico"
                ? "Todos los miembros pueden añadir a otras personas a este grupo."
                : "Solo los administradores y el propietario pueden añadir a otras personas a este grupo."}
            </small>

            {/* 👇 Solo aparece si hay cambios */}
            {hayCambios && (
              <button
                type="button"
                className="rounded-circle d-flex align-items-center justify-content-center"
                style={{
                  width: "45px",
                  height: "45px",
                  padding: "0",
                  borderRadius: "150%",
                  backgroundColor: "#25D366",
                  border: "none",
                  transition: "background-color 0.2s ease-in-out, transform 0.15s",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                }}
                onClick={handleAceptar}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#20b955";
                  e.currentTarget.style.transform = "scale(1.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#25D366";
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  style={{ width: "50%", height: "50%" }}
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MiembrosGrupos;
