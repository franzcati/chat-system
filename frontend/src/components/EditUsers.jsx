import { useState, useEffect } from "react";
import TablaUsuarios from "./TablaUsuarios";
import FormEditarUsuario from "./FormEditarUsuario";
import "bootstrap-icons/font/bootstrap-icons.css";

const EditUsers = ({ usuarioLogueado }) => {
  const [usuarios, setUsuarios] = useState([]);
  const [editando, setEditando] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [usuariosOriginal, setUsuariosOriginal] = useState([]);

  useEffect(() => {
    obtenerUsuarios();
  }, []);

  const obtenerUsuarios = async () => {
    try {
      const res = await fetch("/api/usuarios");
      const data = await res.json();
      setUsuarios(data);
      setUsuariosOriginal(data);
    } catch (err) {
      console.error("❌ Error cargando usuarios:", err);
    }
  };

  const filtrarBusqueda = (text) => {
    setBusqueda(text);
    if (text.trim() === "") return setUsuarios(usuariosOriginal);

    const filtrados = usuariosOriginal.filter((u) =>
      (u.nombre + " " + u.apellido + " " + u.usuario)
        .toLowerCase()
        .includes(text.toLowerCase())
    );

    setUsuarios(filtrados);
  };

  return (
    <div className="p-6 flex flex-col items-center">

      {/* TÍTULO */}
      <h1 className="text-center mt-5 mb-5 text-3xl font-bold">
        Gestión de Usuarios
      </h1>

      <div className="bg-white p-6 rounded-2xl shadow-lg w-full max-w-6xl">

        {/* ENCABEZADO SUPERIOR – estilo Bootstrap */}
        <h1 className="text-center text-2xl font-semibold mb-4 relative">

          {/* BOTÓN AGREGAR USUARIO */}
          <span className="absolute left-0 top-0">
            <button
              className="btn btn-success text-white p-3 rounded-circle text-xl"
              title="Registrar nuevo usuario"
              onClick={() =>
                setEditando({
                  id: null,
                  nombre: "",
                  apellido: "",
                  usuario: "",
                  proyectos: [],
                })
              }
            >
              <i className="bi bi-person-plus"></i>
            </button>
          </span>

          {/* TÍTULO PRINCIPAL */}
          Lista de usuarios ({usuarios.length})

          {/* EXPORTAR CSV */}
          <span className="absolute right-0 top-0">
            <a
              href="/api/usuarios/exportar"
              className="btn btn-success p-3 rounded-circle"
              title="Exportar a CSV"
            >
              <i className="bi bi-filetype-csv"></i>
            </a>
          </span>

          <hr className="mt-6" />
        </h1>

        {/* TABLA */}
        {!editando && (
          <TablaUsuarios
            usuarios={usuarios}
            setEditando={setEditando}
            eliminarUsuario={(id) => {
              if (confirm("¿Seguro deseas eliminar este usuario?")) {
                fetch(`/api/usuarios/${id}`, { method: "DELETE" })
                  .then(() => obtenerUsuarios());
              }
            }}
          />
        )}

        {/* FORMULARIO DE EDICIÓN */}
        {editando && (
          <div className="mt-5 p-4 bg-gray-100 shadow rounded">
            <h3 className="text-xl font-bold mb-3">
              {editando.id ? "Editar usuario" : "Registrar usuario"}
            </h3>

            <FormEditarUsuario
                editando={editando}
                setEditando={setEditando}
                obtenerUsuarios={obtenerUsuarios}
                rolUsuarioActual={usuarioLogueado.rol_id}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default EditUsers;
