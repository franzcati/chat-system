import React, { useEffect, useMemo, useState } from "react";
import socket from "../socket";
import { getAvatarUrl } from "../utils/url";

/**
 * PersonasGrupos
 *
 * Props:
 *  - proyectoId (number) optional: proyectId a mostrar (usa mock data si no se pasan usuarios)
 *  - usuarios (array) optional: lista de usuarios ya filtrada por proyecto (anula proyectoId)
 *  - onSelectionChange (fn) optional: callback(selectedIds) cuando cambian selecciones
 */
const PersonasGrupos = ({ proyectoId, usuarioId, onSelectionChange }) => {
  // Mock de usuarios (basado en tu INSERT de ejemplo)
  const [usuarios, setUsuarios] = useState([]);
  const [usuariosSocket, setUsuariosSocket] = useState({});
  // Selección de miembros
  const [selectedIds, setSelectedIds] = useState([]);


  // 👇 Cargar usuarios reales desde la API
  useEffect(() => {
    const fetchUsuarios = async () => {
      try {
        // ✅ ahora pedimos todos los usuarios de todos los proyectos de este usuario
        const res = await fetch(`/api/grupos/${usuarioId}/todos-usuarios`);
        const data = await res.json();
        setUsuarios(data);
      } catch (error) {
        console.error("Error cargando usuarios:", error);
      }
    };

    if (usuarioId) fetchUsuarios();
  }, [usuarioId]);

  // 👉 Conectarse al socket y escuchar cambios de estado
  useEffect(() => {
    if (!usuarioId) return;

    socket.emit("registrarUsuario", usuarioId);

    socket.on("actualizarUsuarios", (data) => {
      setUsuariosSocket(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [usuarioId]);

  // 👉 Filtrar: no mostrar al logueado
  const usuariosProyecto = useMemo(() => {
    return usuarios.filter((u) => u.id !== usuarioId);
  }, [usuarios, usuarioId]);

  // Agrupar por inicial
  const grouped = useMemo(() => {
    const map = {};
    usuariosProyecto.forEach((u) => {
      const inicial = (u.nombre || "?").charAt(0).toUpperCase();
      if (!map[inicial]) map[inicial] = [];
      map[inicial].push(u);
    });
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => a.nombre.localeCompare(b.nombre));
    });
    return map;
  }, [usuariosProyecto]);

  

  const toggleMember = (id) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (typeof onSelectionChange === "function") onSelectionChange(next);
      return next;
    });
  };

  
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      console.log("✅ Nuevo estado de selección:", next);
      // ❌ Quitar esta línea porque ya notificamos en el useEffect
      // if (typeof onSelectionChange === "function") onSelectionChange(next);
      return next;
    });
  };

  // 🔹 Cada vez que cambia la selección, avisamos al padre
  useEffect(() => {
    if (onSelectionChange) {
      console.log("📤 Notificando selección al padre:", selectedIds);
      onSelectionChange(selectedIds);
    }
  }, [selectedIds, onSelectionChange]);

  
  // 👉 Renderizar el estado de cada usuario
  const renderEstado = (usuario) => {
    const estadoSocket = usuariosSocket[usuario.id];

    if (!estadoSocket) {
      return <span className="text-muted">Desconectado</span>;
    }

    if (estadoSocket.estado === "desconectado") {
      const fecha = estadoSocket.ultimaConexion
        ? new Date(estadoSocket.ultimaConexion).toLocaleString("es-ES")
        : "";

      return (
        <span className="text-muted">
          Desconectado {fecha && `(${fecha})`}
        </span>
      );
    }

    return <span>{estadoSocket.estado}</span>;
  };
  
  return (
    <nav>
      {Object.keys(grouped).length === 0 ? (
        <p className="text-muted">No hay usuarios en este proyecto</p>
      ) : (
        Object.keys(grouped)
          .sort()
          .map((inicial) => (
            <div key={inicial}>
              <div className="my-5">
                <small className="text-uppercase text-muted">{inicial}</small>
              </div>

              {grouped[inicial].map((usuario) => (
                <div className="card border-0 mt-5" key={usuario.id}>
                  <div className="card-body">
                    <div className="row align-items-center gx-5">
                      <div className="col-auto">
                        <div className="avatar avatar-xl">
                          {usuario.url_imagen ? (
                            <img
                              src={getAvatarUrl(usuario.url_imagen)}
                              alt={`${usuario.nombre} ${usuario.apellido}`}
                              className="rounded-circle border border-warning"
                              style={{ width: "40px", height: "40px", objectFit: "cover" }}
                            />
                          ) : (
                            <div
                              className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                              style={{
                                width: "40px",
                                height: "40px",
                                backgroundColor: usuario.background || "#6c757d",
                                fontSize: "18px",
                              }}
                            >
                              {(usuario.nombre || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col">
                        <h5>{`${usuario.nombre} ${usuario.apellido}`}</h5>
                        <p className="mb-0">{renderEstado(usuario)}</p>
                      </div>

                      <div className="col-auto">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            value={usuario.id}
                            id={`id-member-${usuario.id}`}
                            checked={selectedIds.includes(usuario.id)}
                            onChange={() => toggleSelect(usuario.id)} // 👈 usamos toggleSelect
                          />
                          <label className="form-check-label" htmlFor={`id-member-${usuario.id}`}></label>
                        </div>
                      </div>
                    </div>

                    <label className="stretched-label" htmlFor={`id-member-${usuario.id}`}></label>
                  </div>
                </div>
              ))}
            </div>
          ))
      )}
    </nav>
  );
};

export default PersonasGrupos;