import { useState, useEffect } from "react";

export default function FormEditarUsuario({ editando, setEditando, obtenerUsuarios, rolUsuarioActual }) {

  const [proyectosDisponibles, setProyectosDisponibles] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permisosRoles, setPermisosRoles] = useState([]);

  // 🔹 Estado del usuario
  const [form, setForm] = useState({
    nombre: editando.nombre || "",
    apellido: editando.apellido || "",
    usuario: editando.usuario || "",
    contrasena: "",
    permisos_chat: editando.permisos_chat || {},
    proyectos: (editando.proyectos_detallados || [])
      .filter(p => p && p.id != null)
      .map(p => Number(p.id)),
    rol_id: editando.rol_id || 4,
  });

  // 🔹 Estado para creación / edición de proyectos
  const [mostrarModalProyecto, setMostrarModalProyecto] = useState(false);
  const [modoProyecto, setModoProyecto] = useState("crear"); // "crear" | "editar"
  const [proyectoEditando, setProyectoEditando] = useState(null);
  const [formProyecto, setFormProyecto] = useState({
    nombre: "",
    descripcion: "",
  });

  const tienePermiso = (permiso) => {
    const permisosDeRol = permisosRoles.filter(
      p => p.rol_id === rolUsuarioActual
    );
    return permisosDeRol.some(p => p.permiso === permiso);
  };

  // ===============================
  //   Cargar proyectos + roles
  // ===============================
  const cargarProyectos = async () => {
    const res = await fetch("/api/proyecto");
    const data = await res.json();
    setProyectosDisponibles(data);
  };

  useEffect(() => {
    cargarProyectos();
    fetch("/api/roles").then(r => r.json()).then(setRoles);
    fetch("/api/roles_permisos").then(r => r.json()).then(setPermisosRoles);
  }, []);

  // ===============================
  //   Handlers de usuario
  // ===============================
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCheckboxProyecto = (id) => {
    let nuevos = [...form.proyectos];
    if (nuevos.includes(id)) {
      nuevos = nuevos.filter(x => x !== id);
    } else {
      nuevos.push(id);
    }
    setForm({ ...form, proyectos: nuevos });
  };

  const handlePermiso = (permiso, checked) => {
    setForm({
      ...form,
      permisos_chat: {
        ...form.permisos_chat,
        [permiso]: checked
      }
    });
  };

    const guardarUsuario = async (e) => {
        e.preventDefault();

        // Validación básica
        if (!form.nombre || !form.apellido || !form.usuario) {
        alert("Nombre, apellido y usuario son obligatorios");
        return;
        }

        const esNuevo = !editando.id; // 👈 si no hay id, estamos creando

        try {
        let url = "";
        let method = "";
        let payload = {};

        if (esNuevo) {
            // 🚨 Tu backend en POST espera `proyecto` (uno solo), no `proyectos` (array)
            if (!form.proyectos || form.proyectos.length === 0) {
            alert("Debes asignar al menos un proyecto al nuevo usuario.");
            return;
            }

            url = "/api/usuarios";
            method = "POST";
            payload = {
            nombre: form.nombre,
            apellido: form.apellido,
            usuario: form.usuario,
            contrasena: form.contrasena,
            rol_id: form.rol_id,
            permisos_chat: form.permisos_chat,
            proyecto: form.proyectos[0], // 👈 primer proyecto seleccionado
            };
        } else {
            // ✏️ Actualizar usuario existente (PUT /api/usuarios/:id)
            url = `/api/usuarios/${editando.id}`;
            method = "PUT";
            payload = {
            ...form,
            // nos aseguramos de mandar un array de números
            proyectos: (form.proyectos || []).map(Number),
            };
        }

        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            console.error("❌ Error guardando usuario:", data);
            alert(data.error || "Error al guardar usuario");
            return;
        }

        alert(esNuevo ? "Usuario creado correctamente" : "Usuario actualizado correctamente");
        await obtenerUsuarios();
        setEditando(null);

        } catch (err) {
        console.error("❌ Error en guardarUsuario:", err);
        alert("Error al guardar usuario");
        }
    };

  // ===============================
  //   CREAR / EDITAR PROYECTOS
  // ===============================
  const abrirCrearProyecto = () => {
    setModoProyecto("crear");
    setProyectoEditando(null);
    setFormProyecto({
      nombre: "",
      descripcion: "",
    });
    setMostrarModalProyecto(true);
  };

  const abrirEditarProyecto = (proyecto) => {
    setModoProyecto("editar");
    setProyectoEditando(proyecto);
    setFormProyecto({
      nombre: proyecto.nombre || "",
      descripcion: proyecto.descripcion || "",
    });
    setMostrarModalProyecto(true);
  };

  const handleChangeProyecto = (e) => {
    setFormProyecto({
      ...formProyecto,
      [e.target.name]: e.target.value,
    });
  };

  const guardarProyecto = async (e) => {
    e.preventDefault();

    try {
      let url = "/api/proyecto";
      let method = "POST";

      if (modoProyecto === "editar" && proyectoEditando) {
        url = `/api/proyecto/${proyectoEditando.id}`;
        method = "PUT";
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formProyecto),
      });

      if (!res.ok) {
        alert("Error al guardar proyecto");
        return;
      }

      // Recargar lista de proyectos
      await cargarProyectos();

      // Si es creación, podrías marcarlo automáticamente como asignado al usuario:
      // if (modoProyecto === "crear") {
      //   const nuevo = await res.json();
      //   setForm(prev => ({
      //     ...prev,
      //     proyectos: [...prev.proyectos, nuevo.id]
      //   }));
      // }

      setMostrarModalProyecto(false);

    } catch (err) {
      console.error("❌ Error guardando proyecto:", err);
      alert("Error al guardar proyecto");
    }
  };

  const eliminarProyecto = async (proyectoId) => {
    const confirmar = window.confirm(
        "¿Seguro que deseas eliminar este proyecto? Esta acción no se puede deshacer."
    );
    if (!confirmar) return;

    try {
        const res = await fetch(`/api/proyecto/${proyectoId}`, {
        method: "DELETE",
        });

        if (!res.ok) {
        alert("Error al eliminar proyecto");
        return;
        }

        // 1) Sacarlo de la lista de proyectos disponibles
        setProyectosDisponibles((prev) => prev.filter((p) => p.id !== proyectoId));

        // 2) Si estaba asignado al usuario, quitarlo también del form
        setForm((prev) => ({
        ...prev,
        proyectos: prev.proyectos.filter((id) => id !== proyectoId),
        }));

    } catch (err) {
        console.error("❌ Error eliminando proyecto:", err);
        alert("Error al eliminar proyecto");
    }
  };


  return (
    <>
      <form className="grid grid-cols-2 gap-6" onSubmit={guardarUsuario}>

        {/* ====================== */}
        {/*  NOMBRE Y APELLIDO    */}
        {/* ====================== */}
        <div>
          <label className="font-semibold">Nombre</label>
          <input
            className="form-control"
            name="nombre"
            value={form.nombre}
            onChange={handleChange}
          />
        </div>

        <div>
          <label className="font-semibold">Apellido</label>
          <input
            className="form-control"
            name="apellido"
            value={form.apellido}
            onChange={handleChange}
          />
        </div>

        {/* ====================== */}
        {/*    USUARIO / EMAIL    */}
        {/* ====================== */}
        <div>
          <label className="font-semibold">Usuario (Correo)</label>
          <input
            className="form-control"
            name="usuario"
            value={form.usuario}
            onChange={handleChange}
          />
        </div>

        {/* ====================== */}
        {/*     CONTRASEÑA        */}
        {/* ====================== */}
        <div>
          <label className="font-semibold">
            Contraseña <span className="text-gray-500">(opcional)</span>
          </label>
          <input
            className="form-control"
            type="password"
            name="contrasena"
            value={form.contrasena}
            onChange={handleChange}
          />
        </div>

        {/* ====================== */}
        {/*         ROLES         */}
        {/* ====================== */}
        <div className="col-span-2">
          <h4 className="font-semibold mb-3">Rol del usuario</h4>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {roles.map((r) => (
              <div
                key={r.id}
                className={`card shadow-sm cursor-pointer border ${form.rol_id === r.id ? "border-primary" : ""}`}
                onClick={() => setForm({ ...form, rol_id: r.id })}
              >
                <div className="card-body text-center">
                  <div className="mb-2 flex justify-center">
                    <div className="btn btn-dark btn-icon btn-sm">
                      {/* ICONOS SEGÚN ROL */}
                      {r.id === 1 && (
                        <svg xmlns="http://www.w3.org/2000/svg"
                          width="20" height="20" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          viewBox="0 0 22 22" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      )}
                      {r.id === 2 && (
                        <svg xmlns="http://www.w3.org/2000/svg"
                          width="20" height="20" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          viewBox="0 0 18 18" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14.7 6.3a5 5 0 0 1-6.4 6.4L3 18l-2-2 5.3-5.3a5 5 0 0 1 6.4-6.4l2 2z" />
                        </svg>
                      )}
                      {r.id === 3 && (
                        <svg xmlns="http://www.w3.org/2000/svg"
                          width="20" height="20" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4" />
                          <circle cx="12" cy="17" r="1" />
                        </svg>
                      )}
                      {r.id === 4 && (
                        <svg xmlns="http://www.w3.org/2000/svg"
                          width="20" height="20" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-3-3.87M7 21v-2a4 4 0 0 1 3-3.87" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      )}
                    </div>
                  </div>

                  <h5 className="mb-1 text-capitalize">{r.nombre}</h5>
                  <p className="small text-muted">{r.descripcion || "Rol del sistema"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ====================== */}
        {/*      PERMISOS CHAT     */}
        {/* ====================== */}
        <div className="col-span-2">
          <h4 className="font-semibold mb-3">Permisos del Chat</h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PERMISOS_UI.map((p) => (
              <div key={p.campo} className="card border-0 shadow-sm">
                <div className="card-body">
                  <div className="row gx-5">
                    <div className="col-auto">
                      <div className="btn btn-sm btn-icon btn-dark">
                        {p.icono}
                      </div>
                    </div>

                    <div className="col">
                      <h5>{p.titulo}</h5>
                      <p className="text-muted small">{p.descripcion}</p>
                    </div>

                    <div className="col-auto align-self-center">
                      <div className="form-check form-switch ps-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={form.permisos_chat[p.campo] === 1}
                          onChange={(e) =>
                            handlePermiso(p.campo, e.target.checked ? 1 : 0)
                          }
                        />
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ====================== */}
        {/*     PROYECTOS          */}
        {/* ====================== */}
        <div className="col-span-2 mt-3">
          <h4 className="font-semibold mb-3">Proyectos asignados</h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* BOTÓN CREAR PROYECTO */}
            {tienePermiso("crear_proyectos") && (
              <div
                className="card shadow-sm border flex flex-col justify-center items-center py-6 cursor-pointer 
                            hover:bg-gray-50 transition"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                onClick={abrirCrearProyecto}
              >
                <svg xmlns="http://www.w3.org/2000/svg"
                  width="20" height="20" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  viewBox="0 0 24 24"
                  strokeLinecap="round" strokeLinejoin="round"
                  className="text-gray-600"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>

                <p className="small text-muted">
                  Crear un nuevo Proyecto
                </p>
              </div>
            )}


            {/* LISTA DE PROYECTOS */}
            {proyectosDisponibles.map((p) => (
            <div
                key={p.id}
                className="card shadow-sm border relative cursor-pointer group"
                onClick={() => handleCheckboxProyecto(p.id)}
            >
                <div className="card-body flex justify-between items-center">

                {/* IZQUIERDA: icono carpeta + textos */}
                <div className="flex items-center gap-3">
                    <div className="btn btn-dark btn-icon btn-sm">
                    <svg xmlns="http://www.w3.org/2000/svg"
                        width="20" height="20" fill="none"
                        stroke="currentColor" strokeWidth="2"
                        viewBox="0 0 24 24"
                        strokeLinecap="round" strokeLinejoin="round"
                    >
                        <path d="M3 7h5l2 3h11v8a2 2 0 0 1-2 2H3z" />
                        <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h9a2 2 0 0 1 2 2v3H3z" />
                    </svg>
                    </div>

                    <div>
                    <h6 className="fw-bold">{p.nombre}</h6>
                    <p className="small text-muted">{p.descripcion}</p>
                    </div>
                </div>

                    {/* DERECHA: checkbox*/}
                    <div className="flex flex-col items-end gap-2">
                        {/* checkbox asignación */}
                        <input
                        type="checkbox"
                        className="form-check-input"
                        checked={form.proyectos.includes(p.id)}
                        onChange={() => handleCheckboxProyecto(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        />

                        
                    </div>
                </div>

                {/* botón eliminar proyecto */}
                {tienePermiso("eliminar_proyectos") && (
                <button
                    type="button"
                    onClick={(e) => {
                    e.stopPropagation();
                    eliminarProyecto(p.id);
                    }}
                    className="absolute top-15 right-78
                            text-gray-300 hover:text-red-500
                            bg-transparent hover:bg-transparent
                            focus:bg-transparent active:bg-transparent
                            border-0 shadow-none p-0
                            text-xs transition-colors"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                     
                </button>
                )}

                {/* botón editar arriba a la derecha (como ya lo tenías) */}
                {tienePermiso("editar_proyectos") && (
                <button
                    type="button"
                    onClick={(e) => {
                    e.stopPropagation();
                    abrirEditarProyecto(p);
                    }}
                    className="absolute top-2 right-2
                            opacity-70 group-hover:opacity-100
                            text-gray-300 hover:text-gray-600
                            bg-transparent hover:bg-transparent
                            focus:bg-transparent active:bg-transparent
                            border-0 shadow-none p-0
                            transition-colors"
                >
                    <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                </button>
                )}
            </div>
            ))}

          </div>
        </div>

        {/* BOTONES DE ACCIÓN */}
        <div className="col-span-2 flex justify-end gap-3 mt-5">
          <button
            type="button"
            onClick={() => setEditando(null)}
            className="btn btn-secondary px-4"
          >
            Cancelar
          </button>

          <button
            type="submit"
            className="btn btn-primary px-4"
          >
            Guardar
          </button>
        </div>
      </form>

      {/* ====================== */}
      {/*    MODAL PROYECTO      */}
      {/* ====================== */}
      {mostrarModalProyecto && (
        <div className="modal d-block" tabIndex="-1" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={guardarProyecto}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {modoProyecto === "crear" ? "Crear Proyecto" : "Editar Proyecto"}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setMostrarModalProyecto(false)}
                />
              </div>

              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Nombre del proyecto</label>
                  <input
                    type="text"
                    name="nombre"
                    className="form-control"
                    value={formProyecto.nombre}
                    onChange={handleChangeProyecto}
                    required
                  />
                </div>

                <div className="mb-3">
                  <label className="form-label">Descripción</label>
                  <textarea
                    name="descripcion"
                    className="form-control"
                    rows="3"
                    value={formProyecto.descripcion}
                    onChange={handleChangeProyecto}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMostrarModalProyecto(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  {modoProyecto === "crear" ? "Crear" : "Guardar cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// Puedes dejar PERMISOS_UI fuera del componente si quieres.
const PERMISOS_UI = [
  {
    campo: "crear_grupos",
    titulo: "Crear grupos",
    descripcion: "Permite crear nuevos grupos",
    icono: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="feather feather-users">
        <path d="M17 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M7 21v-2a4 4 0 0 1 3-3.87" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    campo: "editar_mensajes",
    titulo: "Editar mensajes",
    descripcion: "Permite editar mensajes enviados",
    icono: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="feather feather-edit">
        <path d="M11 4H4a2 2 0 0 0-2 2v14l4-4h9a2 2 0 0 0 2-2v-1" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L14 13l-4 1 1-4 7.5-7.5z" />
      </svg>
    )
  },
  {
    campo: "eliminar_mensajes",
    titulo: "Eliminar mensajes",
    descripcion: "Permite borrar mensajes enviados",
    icono: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="feather feather-trash">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    )
  }
];
