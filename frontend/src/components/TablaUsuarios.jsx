import { useState, useMemo, useEffect } from "react";
import { getAvatarUrl } from "../utils/url";
import "bootstrap-icons/font/bootstrap-icons.css";

export default function TablaUsuarios({ usuarios, setEditando, eliminarUsuario }) {

  const [busqueda, setBusqueda] = useState("");
  const [filtroProyecto, setFiltroProyecto] = useState("");
  const [proyectosActivos, setProyectosActivos] = useState([]);

  // 🔹 PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState(7); // ⬅️ selector dinámico

  useEffect(() => {
    fetch("/api/proyecto")
      .then((res) => res.json())
      .then((data) => setProyectosActivos(data));
  }, []);

  // 🔎 FILTROS
  const usuariosFiltrados = useMemo(() => {
    const filtrados = usuarios.filter((u) => {
      const matchBusqueda =
        (u.nombre + " " + u.apellido + " " + u.usuario)
          .toLowerCase()
          .includes(busqueda.toLowerCase());

      const matchProyecto =
        !filtroProyecto ||
        u.proyectos_detallados.some((p) => p.nombre === filtroProyecto);

      return matchBusqueda && matchProyecto;
    });

    setPaginaActual(1); // Reinicia la paginación al filtrar
    return filtrados;
  }, [busqueda, filtroProyecto, usuarios]);

  // 🔢 Cálculo de paginación
  const totalPaginas = Math.ceil(usuariosFiltrados.length / registrosPorPagina);
  const indiceInicio = (paginaActual - 1) * registrosPorPagina;

  const usuariosPaginados = usuariosFiltrados.slice(
    indiceInicio,
    indiceInicio + registrosPorPagina
  );

  // 🔹 Generador estilo DataTables
  const generarPaginas = () => {
    const paginas = [];
    if (totalPaginas <= 5) {
      for (let i = 1; i <= totalPaginas; i++) paginas.push(i);
    } else {
      paginas.push(1);

      if (paginaActual > 3) paginas.push("...");

      let inicio = Math.max(2, paginaActual - 1);
      let fin = Math.min(totalPaginas - 1, paginaActual + 1);

      for (let i = inicio; i <= fin; i++) paginas.push(i);

      if (paginaActual < totalPaginas - 2) paginas.push("...");

      paginas.push(totalPaginas);
    }
    return paginas;
  };

  return (
    <div className="border rounded-xl overflow-hidden shadow-lg">

      {/* ======================== */}
      {/*     BARRA SUPERIOR       */}
      {/* ======================== */}
      <div className="flex items-center justify-between bg-gray-100 px-4 py-3 gap-5">

        {/* IZQUIERDA: Buscador */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Buscar..."
            className="form-control w-72"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        {/* DERECHA: Filtro de proyecto + select registros */}
        <div className="flex items-center gap-4">

          {/* FILTRO PROYECTO */}
          <select
            className="form-select w-60"
            value={filtroProyecto}
            onChange={(e) => setFiltroProyecto(e.target.value)}
          >
            <option value="">Todos los proyectos</option>
            {proyectosActivos.map((p) => (
              <option key={p.id} value={p.nombre}>
                {p.nombre}
              </option>
            ))}
          </select>

          {/* 🔥 SELECTOR DE MOSTRAR X REGISTROS */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Mostrar:</span>
            <select
              className="form-select w-20"
              value={registrosPorPagina}
              onChange={(e) => {
                setRegistrosPorPagina(Number(e.target.value));
                setPaginaActual(1);
              }}
            >
              <option value="7">7</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
          </div>

        </div>
      </div>

      {/* ======================== */}
      {/*          TABLA           */}
      {/* ======================== */}
      <table className="table table-hover align-middle mb-0">
        <thead className="table-light">
          <tr>
            <th className="text-center" style={{ width: "60px" }}>#</th>
            <th>Avatar</th>
            <th>Nombre</th>
            <th>Usuario</th>
            <th>Proyectos</th>
            <th className="text-center" style={{ width: "150px" }}>Acciones</th>
          </tr>
        </thead>

        <tbody>
          {usuariosPaginados.map((u, index) => {
            const inicial = u.nombre?.charAt(0)?.toUpperCase() || "?";

            return (
              <tr key={u.id}>

                {/* # */}
                <td className="text-center fw-bold">
                  {indiceInicio + index + 1}
                </td>

                <td>
                  {u.url_imagen ? (
                    <img
                      src={getAvatarUrl(u.url_imagen)}
                      className="rounded-circle"
                      style={{
                        width: "48px",
                        height: "48px",
                        objectFit: "cover",
                        border: "2px solid #ddd",
                      }}
                    />
                  ) : (
                    <div
                      className="rounded-circle d-flex justify-content-center align-items-center text-white shadow"
                      style={{
                        width: "48px",
                        height: "48px",
                        background: u.background || "#3b82f6",
                        fontSize: "20px",
                        fontWeight: "bold",
                      }}
                    >
                      {inicial}
                    </div>
                  )}
                </td>

                <td className="fw-semibold">{u.nombre} {u.apellido}</td>
                <td>{u.usuario}</td>

                <td>
                  {u.proyectos_detallados.map((p) => p.nombre).join(", ") || "—"}
                </td>

                <td className="text-center">
                  <button
                    className="btn btn-warning btn-sm me-2"
                    onClick={() => setEditando(u)}
                  >
                    <i className="bi bi-pencil-square"></i>
                  </button>

                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => eliminarUsuario(u.id)}
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </td>

              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ======================== */}
      {/*      PIE + PAGINACIÓN    */}
      {/* ======================== */}
      <div className="bg-light p-3 text-secondary small flex justify-between items-center">

        <span>
          Mostrando {usuariosPaginados.length} de {usuariosFiltrados.length} registros
        </span>

        <div className="flex items-center gap-2">

          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={paginaActual === 1}
            onClick={() => setPaginaActual(1)}
          >
            Primero
          </button>

          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={paginaActual === 1}
            onClick={() => setPaginaActual(paginaActual - 1)}
          >
            Anterior
          </button>

          {generarPaginas().map((p, i) =>
            p === "..." ? (
              <span key={i}>...</span>
            ) : (
              <button
                key={i}
                className={`btn btn-sm ${
                  paginaActual === p ? "btn-primary" : "btn-outline-secondary"
                }`}
                onClick={() => setPaginaActual(p)}
              >
                {p}
              </button>
            )
          )}

          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={paginaActual === totalPaginas}
            onClick={() => setPaginaActual(paginaActual + 1)}
          >
            Siguiente
          </button>

          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={paginaActual === totalPaginas}
            onClick={() => setPaginaActual(totalPaginas)}
          >
            Último
          </button>

        </div>
      </div>

    </div>
  );
}
