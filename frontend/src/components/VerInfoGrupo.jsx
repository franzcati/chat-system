import toast from "react-hot-toast";
import React, { useState } from "react";
import "../css/emoji.css";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import socket from "../socket";


const BASE_URL = ""; // 🔹 Para imágenes relativas

const VerInfoGrupo = ({
  chat,
  visible,
  onClose,
  setMostrarVerArchivos,
  setOffcanvasGrupo,
  user,
  onActualizarChat,

}) => {
  const [editandoCampo, setEditandoCampo] = useState(null);
  const [nuevoValor, setNuevoValor] = useState("");
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  const [mostrarEmojisNombre, setMostrarEmojisNombre] = useState(false);
  const [mostrarEmojisDesc, setMostrarEmojisDesc] = useState(false);


  const puedeEditar = chat.miembros?.some(
    (m) =>
      m.id === chat.user_id &&
      (m.rol === "propietario" || m.rol === "admin")
  );

  // 🔹 Corrige URLs relativas
  const fixUrl = (url) => {
    if (!url) return "/default-avatar.png";
    return url.startsWith("http") ? url : `${BASE_URL}${url}`;
  };

  // 🔹 Filtra solo imágenes o GIFs y muestra las últimas 4
  const imagenes = chat.archivos?.filter((a) =>
    /\.(jpg|jpeg|png|gif)$/i.test(a.archivo_url)
  ) || [];
  const ultimas = imagenes.slice(-4); // 👈 Solo las 4 más recientes

  // 👉 Función para sacar inicial (si no hay avatar)
  const getInitial = (text) => {
    if (!text) return "U";
    return text.charAt(0).toUpperCase();
  };

  const [mostrarTodos, setMostrarTodos] = useState(false);

  // 👉 Ordenar miembros: primero yo, luego propietario, luego admins, luego el resto
  const miembrosOrdenados = [...(chat.miembros || [])].sort((a, b) => {
    if (a.id === chat.user_id) return -1;
    if (b.id === chat.user_id) return 1;
    if (a.rol === "propietario") return -1;
    if (b.rol === "propietario") return 1;
    if (a.rol === "admin") return -1;
    if (b.rol === "admin") return 1;
    return a.nombre.localeCompare(b.nombre);
  });

  // 👉 Mostrar los primeros 4 si no se han expandido
  const miembrosVisibles = mostrarTodos
    ? miembrosOrdenados
    : miembrosOrdenados.slice(0, 4);

  // 🧩 Editar nombre o descripción (ya sin setChats)
  const handleEditarGrupo = async (campo, valor) => {
    try {
      const res = await fetch(
        `${BASE_URL}/api/grupos/${chat.grupo_id}/editar-info`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuarioId: user.id,
            [campo]: valor,
          }),
        }
      );

      const data = await res.json();
      if (data.success) {
        toast.success("✅ Grupo actualizado correctamente");

        // 🔹 Actualiza localmente para feedback inmediato
        chat[campo === "nombre" ? "usuario_nombre" : "descripcion"] = valor;

        // 🔹 Cierra edición
        setEditandoCampo(null);
        setMostrarEmojisNombre(false);
        setMostrarEmojisDesc(false);
      } else {
        toast.error(data.error || "Error al actualizar");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    }
  };

  // 🧩 Cambiar privacidad (también sin setChats)
  const handleCambiarPrivacidad = async (nuevoValor) => {
    try {
      const res = await fetch(
        `${BASE_URL}/api/grupos/${chat.grupo_id}/privacidad`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuarioId: user.id,
            privacidad: nuevoValor,
          }),
        }
      );

      const data = await res.json();
      if (data.success) {
        toast.success("🔒 Privacidad actualizada");
        // ✅ Actualiza localmente para feedback inmediato
        onActualizarChat("privacidad", nuevoValor);
      } else {
        toast.error(data.error || "Error al cambiar privacidad");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    }
  };

  return (
    <div
      className={`fixed top-0 right-0 h-full bg-white shadow-lg border-l border-gray-200 transition-all duration-300 ease-in-out z-50
      ${visible ? "w-80 md:w-96" : "w-0 overflow-hidden"}`}
    >
      <div className="flex flex-col h-full"> {/* 👈 contenedor principal con flex */}
        {/* 🔹 Header superior */}
        {/* Header */}
        <div className="relative profile-img text-primary rounded-top flex-shrink-0">
          
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 400 140.74"
          >  
                                    
            <defs>
              <style>{".cls-2{fill:#fff;opacity:0.1;}"}</style>
            </defs>
                            
            <g>
              <g>
                <path d="M400,125A1278.49,1278.49,0,0,1,0,125V0H400Z"></path>
                  <path
                    className="cls-2"
                    d="M361.13,128c.07.83.15,1.65.27,2.46h0Q380.73,128,400,125V87l-1,0a38,38,0,0,0-38,38c0,.86,0,1.71.09,2.55C361.11,127.72,361.12,127.88,361.13,128Z"
                  ></path>
                  <path
                    className="cls-2"
                    d="M12.14,119.53c.07.79.15,1.57.26,2.34v0c.13.84.28,1.66.46,2.48l.07.3c.18.8.39,1.59.62,2.37h0q33.09,4.88,66.36,8,.58-1,1.09-2l.09-.18a36.35,36.35,0,0,0,1.81-4.24l.08-.24q.33-.94.6-1.9l.12-.41a36.26,36.26,0,0,0,.91-4.42c0-.19,0-.37.07-.56q.11-.86.18-1.73c0-.21,0-.42,0-.63,0-.75.08-1.51.08-2.28a36.5,36.5,0,0,0-73,0c0,.83,0,1.64.09,2.45C12.1,119.15,12.12,119.34,12.14,119.53Z"
                  ></path>
                    <circle className="cls-2" cx="94.5" cy="57.5" r="22.5"></circle>
                  <path
                    className="cls-2"
                    d="M276,0a43,43,0,0,0,43,43A43,43,0,0,0,362,0Z"
                  ></path>
              </g>
              
            </g>
            
                
          </svg>
          <div className="absolute top-0 left-0 w-full flex items-center justify-between px-4 py-3 text-white">
          
            <div className="position-absolute top-0 start-0 py-6 px-5">
              <button
                onClick={onClose}
                className="flex items-center gap-2 hover:text-gray-900 transition btn-close btn-close-white"
              >
                
              </button>
              <span className="position-absolute top-5 start-0 ml-20 text-white font-semibold text-base whitespace-nowrap">Info. del grupo</span>
            </div>
          </div>

          
        </div>

        {/* 🔹 Contenido scrollable */}
        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 scrollbar-hide">
          {/* Imagen + nombre */}
          <div className="flex flex-col items-center text-center relative">
            <img
              src={fixUrl(chat.imagen_url)}
              alt={chat.usuario_nombre}
              className="w-24 h-24 rounded-full object-cover border mb-2"
            />

            {/* ===================== NOMBRE EDITABLE ===================== */}
            <div className="flex flex-col w-full">
              {editandoCampo === "nombre" ? (
                <div className="relative w-full">
                  {/* Input flotante para editar el nombre */}
                  <div className="form-floating">
                    <input
                      type="text"
                      className="form-control"
                      id="chatName"
                      placeholder="Nombre del grupo"
                      value={nuevoValor}
                      onChange={(e) => setNuevoValor(e.target.value)}
                    />
                    <label htmlFor="chatName">Nombre del grupo</label>
                  </div>

                  {/* Botones de acción */}
                  <div className="flex gap-2 mt-2 justify-end items-center">
                    {/* Emoji SVG */}
                    <button
                      onClick={() => setMostrarEmojisNombre((prev) => !prev)}
                      className="p-1 hover:bg-gray-100 rounded-full"
                      title="Añadir emoji"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-5 h-5 text-yellow-500"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                    </button>

                    {/* Check (guardar) */}
                    <button
                      onClick={() => handleEditarGrupo("nombre", nuevoValor)}
                      className="p-1 text-green-600 hover:bg-green-100 rounded-full"
                      title="Guardar"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        className="w-5 h-5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>

                    {/* X (cancelar) */}
                    <button
                      onClick={() => {
                        setEditandoCampo(null);
                        setMostrarEmojisNombre(false);
                        setNuevoValor(chat.usuario_nombre);
                      }}
                      className="p-1 text-red-500 hover:bg-red-100 rounded-full"
                      title="Cancelar"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-5 h-5"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  {/* Emoji Picker debajo del input */}
                  {mostrarEmojisNombre && (
                    <div className="mt-2 z-50 bg-white shadow-lg rounded-lg border w-fit">
                      <Picker
                        data={data}
                        onEmojiSelect={(emoji) =>
                          setNuevoValor((prev) => prev + emoji.native)
                        }
                        theme="light"
                        previewPosition="none"
                        searchPosition="none"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex justify-center items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-800 text-center m-0">
                    {chat.usuario_nombre}
                  </h2>

                  {puedeEditar && (
                    <button
                      onClick={() => {
                        setEditandoCampo("nombre");
                        setNuevoValor(chat.usuario_nombre || "");
                      }}
                      className="p-1 hover:bg-gray-100 rounded-full transition"
                      title="Editar nombre del grupo"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4 text-gray-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15.232 5.232l3.536 3.536M4 13.5V19h5.5l9.793-9.793a1 1 0 000-1.414L17.207 4.5a1 1 0 00-1.414 0L4 16.293z"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="text-sm text-gray-500">
              {chat.miembros?.length || 0} miembros
            </p>
          </div>

          {/* ===================== DESCRIPCIÓN EDITABLE ===================== */}
          <div className="flex justify-center items-start gap-2 w-full">
            {editandoCampo === "descripcion" ? (
              <div className="relative w-full">
                {/* Textarea flotante */}
                <div className="form-floating">
                  <textarea
                    className="form-control"
                    placeholder="Descripción del grupo"
                    id="chatDescription"
                    rows="8"
                    style={{ minHeight: "100px", resize: "none" }}
                    value={nuevoValor}
                    onChange={(e) => setNuevoValor(e.target.value)}
                  />
                  <label htmlFor="chatDescription" className="text-gray-500">
                    ¿Cuál es su propósito?
                  </label>
                </div>

                {/* Botones debajo del textarea */}
                <div className="flex gap-2 mt-2 justify-end items-center relative">
                  {/* Emoji SVG */}
                  <button
                    onClick={() => setMostrarEmojisDesc((prev) => !prev)}
                    className="p-1 hover:bg-gray-100 rounded-full"
                    title="Añadir emoji"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5 text-yellow-500"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" y1="9" x2="9.01" y2="9" />
                      <line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  </button>

                  {/* Check (guardar) */}
                  <button
                    onClick={() => handleEditarGrupo("descripcion", nuevoValor)}
                    className="p-1 text-green-600 hover:bg-green-100 rounded-full"
                    title="Guardar"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="w-5 h-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>

                  {/* X (cancelar) */}
                  <button
                    onClick={() => {
                      setEditandoCampo(null);
                      setMostrarEmojisDesc(false);
                      setNuevoValor(chat.descripcion);
                    }}
                    className="p-1 text-red-500 hover:bg-red-100 rounded-full"
                    title="Cancelar"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Emoji Picker debajo del textarea */}
                {mostrarEmojisDesc && (
                  <div className="mt-2 z-50 bg-white shadow-lg rounded-lg border w-fit">
                    <Picker
                      data={data}
                      onEmojiSelect={(emoji) =>
                        setNuevoValor((prev) => prev + emoji.native)
                      }
                      theme="light"
                      previewPosition="none"
                      searchPosition="none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* ✅ Texto de descripción con saltos de línea y mostrar más/menos */}
                <DescripcionConFormato texto={chat.descripcion || "Añade una descripción del grupo"} />

                {puedeEditar && (
                  <button
                    onClick={() => {
                      setEditandoCampo("descripcion");
                      setNuevoValor(chat.descripcion || "");
                    }}
                    className="p-1 hover:bg-gray-100 rounded-full transition"
                    title="Editar descripción"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4 text-gray-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.232 5.232l3.536 3.536M4 13.5V19h5.5l9.793-9.793a1 1 0 000-1.414L17.207 4.5a1 1 0 00-1.414 0L4 16.293z"
                      />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>

          {/* 🔹 Archivos (solo 4 imágenes o GIFs recientes) */}
          {ultimas.length > 0 && (
            <div className="mt-4">
              <div
                className="cursor-pointer"
                onClick={() => setMostrarVerArchivos(true)} // 👈 Abrirá el panel VerArchivos.jsx
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-gray-700 font-semibold">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-blue-500"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <path d="M21 15l-5-5L5 21"></path>
                    </svg>
                    <span>Archivos, enlaces y documentos</span>
                  </div>

                  {/* Contador total de archivos */}
                  <span className="text-gray-500 text-sm font-medium">
                    {chat.archivos.length}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto py-1">
                {ultimas.map((a) => (
                  <img
                    key={a.id}
                    src={fixUrl(a.archivo_url)}
                    alt={a.nombre_archivo}
                    className="w-18 h-18 rounded-lg object-cover border border-gray-200 shadow-sm cursor-pointer hover:scale-105 hover:shadow-md transition-transform duration-200"
                  />
                ))}
              </div>
            </div>
          )}
          {/* Privacidad */}
          <div className="border-t border-gray-200 pt-3">
            <div className="flex justify-between items-center">
              {/* 🟢 Título + tipo */}
              <span className="font-medium text-gray-700">
                Grupo {chat.privacidad === "privado" ? "Privado" : "Público"}
              </span>

              {/* 🟢 Switch */}

              <div className="form-check form-switch flex items-center gap-2">
                <input
                className="form-check-input cursor-pointer disabled:opacity-60"
                type="checkbox"
                checked={chat.privacidad === "privado"}
                disabled={
                  !chat.miembros?.some(
                    (m) => m.id === chat.user_id && m.rol === "propietario"
                  )
                }
                onChange={(e) =>
                  handleCambiarPrivacidad(e.target.checked ? "privado" : "publico")
                }
              />
              </div>
              
            </div>
                
            

            {/* 🟢 Texto explicativo debajo */}
            <small className="text-gray-500 text-xs mt-1 block">
              {chat.privacidad === "publico"
                ? "Todos los miembros pueden añadir personas"
                : "Solo el propietario puede añadir personas"}
            </small>
          </div>

          {/* Miembros */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h5 className="font-semibold text-gray-700">
                Miembros ({chat.miembros?.length || 0})
              </h5>

              {/* 🔹 Botón "Añadir miembro" solo visible para propietario o admin */}
              {(chat.miembros?.some(
                (m) =>
                  m.id === chat.user_id &&
                  (m.rol === "propietario" || m.rol === "admin")
              )) && (
                <button
                  onClick={() =>
                    setOffcanvasGrupo((prev) =>
                      prev ? null : chat // 🔁 si ya está abierto lo cierra, si no, lo abre
                    )
                  }
                  className="flex items-center gap-2 transparent hover:bg-green-200 text-green-700 text-sm font-medium px-3 py-1 rounded-full transition"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Añadir miembro
                </button>
              )}
            </div>

            <ul className="space-y-3">
              {miembrosVisibles.map((m) => {
                const tieneImagen = m.url_imagen && m.url_imagen.trim() !== "";
                const inicial = getInitial(m.nombre);
                const esActual = m.id === chat.user_id;

                return (
                  <li key={m.id} className="flex items-center gap-3 pr-2">
                    <div className="flex items-center gap-3 h-13 flex-1 min-w-0">
                      {tieneImagen ? (
                        <img
                          src={fixUrl(m.url_imagen)}
                          alt={m.nombre}
                          className="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-base font-semibold text-white border border-gray-200 flex-shrink-0"
                          style={{ backgroundColor: m.background || "#6c757d" }}
                        >
                          {inicial}
                        </div>
                      )}

                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center justify-between w-full">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {esActual ? "Tú" : `${m.nombre} ${m.apellido || ""}`}
                          </p>

                          {m.rol === "propietario" && (
                            <span className="text-[11px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                              Propietario
                            </span>
                          )}
                          {m.rol === "admin" && (
                            <span className="text-[11px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                              Admin
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-gray-500 truncate pl-0.5">{m.correo}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Mostrar más / menos */}
            {chat.miembros?.length > 4 && (
              <div className="mt-3 text-center">
                <button
                  onClick={() => setMostrarTodos(!mostrarTodos)}
                  className="text-sm text-blue-600 hover:underline font-medium"
                >
                  {mostrarTodos
                    ? "Mostrar menos"
                    : `${chat.miembros.length - 4} más`}
                </button>
              </div>
            )}
          </div>

          {/* Botones finales */}
          <div className="pt-4 border-t border-gray-200 space-y-2">
            {(() => {
              const miRol = chat.miembros?.find((m) => m.id === user.id)?.rol;

              // 🧩 Si soy propietario → botón eliminar grupo
              if (miRol === "propietario") {
                return (
                  <button
                    onClick={async () => {
                      if (!window.confirm("¿Seguro que deseas eliminar este grupo? Esta acción no se puede deshacer.")) return;

                      try {
                        const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/eliminar`, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ usuarioId: user.id }),
                        });
                        const data = await res.json();

                        if (data.success) {
                          toast.success("🗑️ Grupo eliminado correctamente");
                          // ✅ Ya no emitimos nada: el backend emite el evento "grupoEliminado"
                          onClose();
                        } else {
                          toast.error(data.error || "Error al eliminar grupo");
                        }
                      } catch (err) {
                        console.error(err);
                        toast.error("Error de conexión al eliminar grupo");
                      }
                    }}
                    className="w-full py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    🗑️ Eliminar grupo
                  </button>
                );
              }

              // 🧩 Si soy miembro o admin → botón salir del grupo
              return (
                <button
                  onClick={async () => {
                    if (!window.confirm("¿Seguro que deseas salir de este grupo?")) return;

                    try {
                      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/salir`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ usuarioId: user.id }),
                      });
                      const data = await res.json();

                      if (data.success) {
                        toast.success("🚪 Has salido del grupo");
                        // ✅ El backend emite "grupoEliminado" solo para ti
                        onClose();
                      } else {
                        toast.error(data.error || "Error al salir del grupo");
                      }
                    } catch (err) {
                      console.error(err);
                      toast.error("Error de conexión al salir del grupo");
                    }
                  }}
                  className="w-full py-2 text-sm font-semibold text-red-500 hover:bg-red-50 rounded-lg"
                >
                  🚪 Salir del grupo
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

// 🔹 Componente para mostrar descripción con saltos de línea + mostrar más/menos
const DescripcionConFormato = ({ texto }) => {
  const [mostrarTodo, setMostrarTodo] = useState(false);

  if (!texto) {
    return <p className="text-gray-500 italic">Añade una descripción del grupo</p>;
  }

  // 🔹 Dividimos el texto en líneas (respetando los saltos de línea)
  const lineas = texto.split(/\r?\n/);
  const limiteLineas = 3;
  const esLargo = lineas.length > limiteLineas;
  const textoVisible = mostrarTodo
    ? lineas.join("\n")
    : lineas.slice(0, limiteLineas).join("\n");

  return (
    <div className="text-gray-700 whitespace-pre-line break-words text-left">
      {textoVisible}
      {esLargo && (
        <div className="text-center mt-1">
          <button
            onClick={() => setMostrarTodo((prev) => !prev)}
            className="text-blue-600 hover:underline text-sm font-medium"
          >
            {mostrarTodo ? "Mostrar menos" : "...Mostrar más"}
          </button>
        </div>
      )}
    </div>
  );
};

export default VerInfoGrupo;