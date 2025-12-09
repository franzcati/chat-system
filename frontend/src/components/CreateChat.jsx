import React, { useState } from "react";
import PersonasGrupos from "./PersonasGrupos"; // 👈 Importar componente

const CreateChat = ({ proyectoId, usuarioId }) => {
  const [activeTab, setActiveTab] = useState("info");
  const [preview, setPreview] = useState(null);

    // 🔹 Estado para los usuarios seleccionados
  const [selectedMembers, setSelectedMembers] = useState([]);

  // 🔹 Para nombre y descripción
  const [chatName, setChatName] = useState("");
  const [chatDescription, setChatDescription] = useState("");

  const [file, setFile] = useState(null); // 🔹 Guardamos el archivo real


  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
    }
  };

  const handleCreateChat = async () => {
    // 🧩 Validación básica
    if (!usuarioId) {
      alert("No se encontró el ID del usuario propietario.");
      return;
    }

    if (selectedMembers.length === 0) {
      alert("Debes seleccionar al menos un usuario.");
      return;
    }

    try {
      // 🧱 Crear el FormData para enviar al backend
      const formData = new FormData();
      formData.append("propietarioId", usuarioId);

      // ✅ Convertimos la lista de miembros a IDs (filtrando nulos)
      const memberIds = selectedMembers
        .map((m) => (typeof m === "object" ? m.id : m))
        .filter((id) => !!id && id !== usuarioId);

      // ⚙️ Serializamos correctamente los miembros
      formData.append("miembros", JSON.stringify(memberIds));

      // 📝 Nombre y descripción
      formData.append("nombre", chatName?.trim() || "Chat privado");
      formData.append("descripcion", chatDescription?.trim() || "");

      // 🖼️ Imagen opcional
      if (file) {
        formData.append("imagen", file);
      }

      console.log("📤 Enviando al backend:");
      console.log("propietarioId:", usuarioId);
      console.log("miembros:", memberIds);
      console.log("nombre:", chatName);
      console.log("descripcion:", chatDescription);

      // 🚀 Petición al backend
      const res = await fetch(`/api/grupos`, {
        method: "POST",
        body: formData,
      });

      // 🧩 Manejo de errores HTTP
      if (!res.ok) {
        const errorText = await res.text();
        console.error("❌ Error HTTP:", res.status, errorText);
        alert("Error creando el grupo. Revisa la consola.");
        return;
      }

      const data = await res.json();
      console.log("✅ Grupo creado:", data);

      if (data.success) {
        alert(`✅ Grupo creado: ${data.grupo.nombre}`);
        // Aquí podrías limpiar el formulario o actualizar la UI
      } else {
        alert(`⚠️ Error: ${data.error || "Error desconocido"}`);
      }
    } catch (error) {
      console.error("❌ Error creando chat:", error);
      alert("Error al crear el grupo. Ver consola para más detalles.");
    }
  };

  const handleSelectionChange = (ids) => {
    console.log("📩 Usuarios seleccionados:", ids);
    setSelectedMembers(ids);
  };


  return (
    <aside className="sidebar bg-light">
      <div className="tab-pane fade h-100 active show" id="tab-content-chats" role="tabpanel">
        <div className="d-flex flex-column h-100 position-relative">
          <div className="hide-scrollbar">
            <div className="container py-4">
              {/* Title */}
              <div className="mb-8">
                <h2 className="fw-bold m-0">Crear Chat</h2>
              </div>

              {/* Search */}
              <div className="mb-6">
                <div className="mb-5">
                  <form>
                    <div className="input-group">
                      <div className="input-group-text">
                        <div className="icon icon-lg">
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
                            className="feather feather-search"
                          >
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                        </div>
                      </div>
                      <input
                        type="text"
                        className="form-control form-control-lg ps-0"
                        placeholder="Buscar usuario"
                      />
                    </div>
                  </form>
                </div>

                <ul className="nav nav-pills nav-justified" role="tablist">
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === "info" ? "active" : ""}`}
                      data-bs-toggle="pill"
                      href="#create-chat-info"
                      role="tab"
                      onClick={() => setActiveTab("info")}
                    >
                      Detalles
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className={`nav-link ${activeTab === "members" ? "active" : ""}`}
                      data-bs-toggle="pill"
                      href="#create-chat-members"
                      role="tab"
                      onClick={() => setActiveTab("members")}
                    >
                      Personas
                    </button>
                  </li>
                </ul>
              </div>

              {/* Tabs content */}
              <div className="tab-content">
                {activeTab === "info" && (
                <div className="tab-pane fade show active" id="create-chat-info" role="tabpanel">
                  <div className="card border-0">
                    {/* PROFILE */}
                    <div className="profile">
                      <div className="profile-img text-primary rounded-top">
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
                      </div>

                      <div className="profile-body p-0">
                        <div className="avatar avatar-lg position-relative">
                          {preview ? (
                            <img
                              src={preview}
                              alt="Preview"
                              className="rounded-circle w-100 h-100"
                              style={{ objectFit: "cover" }}
                            />
                          ) : (
                            <span className="avatar-text bg-primary">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="feather feather-image"
                              >
                                <rect
                                  x="3"
                                  y="3"
                                  width="18"
                                  height="18"
                                  rx="2"
                                  ry="2"
                                ></rect>
                                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                <polyline points="21 15 16 10 5 21"></polyline>
                              </svg>
                            </span>
                          )}

                          <div className="badge badge-lg badge-circle bg-primary border-outline position-absolute bottom-0 end-0">
                            {/* Ícono + */}
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
                              className="feather feather-plus"
                            >
                              <line x1="12" y1="5" x2="12" y2="19"></line>
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                          

                            {/* Input oculto */}
                            <input
                              id="upload-chat-img"
                              className="d-none"
                              type="file"
                              accept="image/*"
                              onChange={handleFileChange}
                            />

                            {/* Label que cubre el círculo */}
                            <label
                              htmlFor="upload-chat-img"
                              className="position-absolute top-0 start-0 w-100 h-100"
                              style={{ cursor: "pointer" }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="card-body">
                      <form autoComplete="off">
                        <div className="row gy-6">
                          <div className="col-12">
                            <div className="form-floating">
                              <input
                                type="text"
                                className="form-control"
                                id="chatName"
                                placeholder="Enter a chat name"
                                value={chatName}
                                onChange={(e) => setChatName(e.target.value)}
                              />
                              <label htmlFor="chatName">Nombre de Grupo</label>
                            </div>
                          </div>
                          <div className="col-12">
                            <div className="form-floating">
                              <textarea
                                  className="form-control"
                                  placeholder="Description"
                                  id="chatDescription"
                                  rows="8"
                                  style={{ minHeight: "100px" }}
                                  value={chatDescription}
                                  onChange={(e) => setChatDescription(e.target.value)}
                                />
                              <label htmlFor="chatDescription">¿Cual es su propósito?</label>
                            </div>
                          </div>
                        </div>
                      </form>
                    </div>
                    
                  </div>

                  <div className="d-flex align-items-center mt-4 px-6">
                    <small className="text-muted me-auto">
                      Ingrese Nombre del chat y agregue una foto.
                    </small>
                  </div>
                  {/* options */}
                  <div className="mt-8">
                    <div className="d-flex align-items-center mb-4 px-6">
                      <small className="text-muted me-auto">Options</small>
                    </div>

                    <div className="card border-0">
                      <div className="card-body">
                        <div className="row gx-5">
                          <div className="col-auto">
                            <div className="btn btn-sm btn-icon btn-dark">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="feather feather-lock"
                              >
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                              </svg>
                            </div>
                          </div>

                          <div className="col">
                            <h5>Grupo Privado</h5>
                            <p>Solo el admin puede agregar</p>
                          </div>

                          <div className="col-auto align-self-center">
                            <div className="form-check form-switch ps-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="new-chat-options-1"
                              />
                              <label
                                className="form-check-label"
                                htmlFor="new-chat-options-1"
                              ></label>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {activeTab === "members" && (
                
 
                <div className="tab-pane fade show active" id="create-chat-members" role="tabpanel">
                  <PersonasGrupos 
                    proyectoId={proyectoId} 
                    usuarioId={usuarioId} 
                    onSelectionChange={handleSelectionChange} // 👈 aquí conectas
                  />
                </div>
                )}
              </div>
            </div>
          </div>

          {/* Button */}
          <div className="container mt-n4 mb-8 position-relative">
            <button
              className="btn btn-lg btn-primary w-100 d-flex align-items-center"
              type="button"
              onClick={handleCreateChat} // 👈 Ahora llama al backend
            >
              Iniciar Chat
              <span className="icon ms-auto" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="feather feather-chevron-right"
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default CreateChat;