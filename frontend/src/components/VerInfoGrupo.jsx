import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import "../css/emoji.css";
import GroupAvatar from "./GroupAvatar";
import { getAvatarUrl } from "../utils/url";
import { getMessagePreview } from "../utils/messagePreview";
import socket from "../socket";

const BASE_URL = "";

const getInitial = (text) => {
  const value = String(text || "").trim();
  return value ? value.charAt(0).toUpperCase() : "U";
};

const getMemberName = (member = {}) =>
  `${member.nombre || ""} ${member.apellido || ""}`.trim() || member.correo || "Usuario";

const VerInfoGrupo = ({
  chat,
  visible,
  onClose,
  setMostrarVerArchivos,
  setOffcanvasGrupo,
  user,
  onActualizarChat,
  onJumpToMessage,
  searchRequestToken,
}) => {
  const [editandoCampo, setEditandoCampo] = useState(null);
  const [nuevoValor, setNuevoValor] = useState("");
  const [mostrarEmojisNombre, setMostrarEmojisNombre] = useState(false);
  const [mostrarEmojisDesc, setMostrarEmojisDesc] = useState(false);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [menuMiembroId, setMenuMiembroId] = useState(null);
  const [accionMiembroId, setAccionMiembroId] = useState(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [mostrarMenuImagen, setMostrarMenuImagen] = useState(false);
  const [imagenVistaPrevia, setImagenVistaPrevia] = useState(null);
  const [modoBusqueda, setModoBusqueda] = useState(false);
  const [textoBusqueda, setTextoBusqueda] = useState("");
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [buscandoMensajes, setBuscandoMensajes] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState("");
  const [estadosUsuarios, setEstadosUsuarios] = useState({});
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const imageMenuRef = useRef(null);

  const miembros = Array.isArray(chat?.miembros) ? chat.miembros : [];
  const miRol = miembros.find((m) => Number(m.id) === Number(user?.id))?.rol;
  const puedeEditar = ["propietario", "admin"].includes(miRol);
  const esPropietario = miRol === "propietario";

  useEffect(() => {
    const cargarEstados = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/usuarios/estados/presencia`);
        const data = await res.json();
        setEstadosUsuarios(data || {});
      } catch (error) {
        console.error("❌ Error cargando estados de miembros:", error);
      }
    };

    cargarEstados();

    const handleActualizarUsuarios = (payload) => {
      setEstadosUsuarios(payload || {});
    };

    socket.on("actualizarUsuarios", handleActualizarUsuarios);
    return () => socket.off("actualizarUsuarios", handleActualizarUsuarios);
  }, []);

  const getPresenceInfo = (targetUserId) => {
    const estado = estadosUsuarios?.[String(targetUserId)] || estadosUsuarios?.[Number(targetUserId)] || null;
    const rawStatus = estado?.estado || "desconectado";
    const dispositivo = estado?.dispositivo || "desktop";

    const meta = {
      online: {
        label: dispositivo === "mobile" ? "En línea desde teléfono" : "En línea desde PC",
        className: "online",
        iconClass: dispositivo === "mobile" ? "fa-solid fa-mobile-screen-button" : "fa-solid fa-desktop",
      },
      inactivo: { label: "Inactivo", className: "idle", iconClass: "fa-solid fa-moon" },
      no_molestar: { label: "No molestar", className: "dnd", iconClass: "fa-solid fa-minus" },
      desconectado: { label: "Sin conexión", className: "offline", iconClass: "fa-regular fa-circle" },
    };

    return meta[rawStatus] || meta.desconectado;
  };

  const renderPresenceBadge = (targetUserId) => {
    const presence = getPresenceInfo(targetUserId);
    return (
      <span className={`wa-presence-badge ${presence.className}`} title={presence.label}>
        <i className={presence.iconClass} aria-hidden="true" />
      </span>
    );
  };

  const miembrosOrdenados = useMemo(() => {
    return [...miembros].sort((a, b) => {
      if (Number(a.id) === Number(user?.id)) return -1;
      if (Number(b.id) === Number(user?.id)) return 1;
      if (a.rol === "propietario" && b.rol !== "propietario") return -1;
      if (b.rol === "propietario" && a.rol !== "propietario") return 1;
      if (a.rol === "admin" && b.rol !== "admin") return -1;
      if (b.rol === "admin" && a.rol !== "admin") return 1;
      return getMemberName(a).localeCompare(getMemberName(b));
    });
  }, [miembros, user?.id]);

  const miembrosVisibles = mostrarTodos ? miembrosOrdenados : miembrosOrdenados.slice(0, 8);

  const archivos = Array.isArray(chat?.archivos) ? chat.archivos : [];
  const ultimasImagenes = archivos
    .filter((a) => /image\//i.test(a.tipo_archivo || "") || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.archivo_url || ""))
    .slice(-4)
    .reverse();

  const fixUrl = (url) => {
    if (!url) return "";
    return String(url).startsWith("http") ? url : `${BASE_URL}${url}`;
  };

  const actualizarCampoLocal = (campo, valor) => {
    if (!onActualizarChat) return;
    onActualizarChat(campo, valor);
    if (campo === "usuario_nombre") onActualizarChat("nombre", valor);
  };

  const handleEditarGrupo = async (campo, valor) => {
    const cleanValue = String(valor || "").trim();
    if (!cleanValue && campo === "nombre") {
      toast.error("El nombre del grupo no puede estar vacío");
      return;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/editar-info`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuarioId: user.id,
          [campo]: cleanValue,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.error || "Error al actualizar");
        return;
      }

      if (campo === "nombre") actualizarCampoLocal("usuario_nombre", cleanValue);
      if (campo === "descripcion") actualizarCampoLocal("descripcion", cleanValue);

      setEditandoCampo(null);
      setMostrarEmojisNombre(false);
      setMostrarEmojisDesc(false);
      toast.success("Grupo actualizado");
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    }
  };

  const handleCambiarPrivacidad = async (nuevoEstado) => {
    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/privacidad`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId: user.id, privacidad: nuevoEstado }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        toast.error(result.error || "Error al cambiar privacidad");
        return;
      }

      actualizarCampoLocal("privacidad", nuevoEstado);
      toast.success("Privacidad actualizada");
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    }
  };

  const handleImagenGrupo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona una imagen válida");
      return;
    }

    const formData = new FormData();
    formData.append("imagen", file);
    formData.append("usuarioId", user.id);

    setSubiendoImagen(true);
    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/imagen`, {
        method: "PUT",
        body: formData,
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        toast.error(result.error || "No se pudo actualizar la imagen");
        return;
      }

      actualizarCampoLocal("imagen_url", result.imagen_url);
      toast.success("Imagen del grupo actualizada");
    } catch (err) {
      console.error(err);
      toast.error("Error al subir la imagen");
    } finally {
      setSubiendoImagen(false);
    }
  };

  const handleEliminarImagenGrupo = async () => {
    if (!chat?.imagen_url) {
      setMostrarMenuImagen(false);
      return;
    }

    if (!window.confirm("¿Quitar la foto del grupo?")) return;

    setSubiendoImagen(true);
    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/imagen`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId: user.id }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        toast.error(result.error || "No se pudo quitar la foto");
        return;
      }

      actualizarCampoLocal("imagen_url", null);
      setMostrarMenuImagen(false);
      toast.success("Foto del grupo quitada");
    } catch (err) {
      console.error(err);
      toast.error("Error al quitar la foto");
    } finally {
      setSubiendoImagen(false);
    }
  };

  useEffect(() => {
    if (!mostrarMenuImagen) return;

    const cerrarMenu = (event) => {
      if (imageMenuRef.current && !imageMenuRef.current.contains(event.target)) {
        setMostrarMenuImagen(false);
      }
    };

    document.addEventListener("mousedown", cerrarMenu);
    return () => document.removeEventListener("mousedown", cerrarMenu);
  }, [mostrarMenuImagen]);

  useEffect(() => {
    if (!modoBusqueda || !chat?.grupo_id) return;

    const query = textoBusqueda.trim();
    if (!query) {
      setResultadosBusqueda([]);
      setErrorBusqueda("");
      setBuscandoMensajes(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBuscandoMensajes(true);
      setErrorBusqueda("");

      try {
        const params = new URLSearchParams({ q: query, limit: "40" });
        const res = await fetch(`${BASE_URL}/api/mensajes/grupo/${chat.grupo_id}/buscar?${params.toString()}`, {
          signal: controller.signal,
        });
        const result = await res.json();

        if (!res.ok) {
          setErrorBusqueda(result.error || "No se pudo buscar");
          setResultadosBusqueda([]);
          return;
        }

        setResultadosBusqueda(Array.isArray(result.mensajes) ? result.mensajes : []);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error(err);
          setErrorBusqueda("Error al buscar mensajes");
        }
      } finally {
        if (!controller.signal.aborted) setBuscandoMensajes(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [modoBusqueda, textoBusqueda, chat?.grupo_id]);

  const abrirBusquedaGrupo = () => {
    setModoBusqueda(true);
    setTextoBusqueda("");
    setResultadosBusqueda([]);
    setErrorBusqueda("");
  };

  const cerrarBusquedaGrupo = () => {
    setModoBusqueda(false);
    setTextoBusqueda("");
    setResultadosBusqueda([]);
    setErrorBusqueda("");
  };

  useEffect(() => {
    if (!visible || !searchRequestToken) return;
    abrirBusquedaGrupo();
  }, [visible, searchRequestToken]);

  const seleccionarResultadoBusqueda = (messageId) => {
    if (!messageId) return;
    if (onJumpToMessage) onJumpToMessage(messageId);
  };

  const actualizarMiembrosLocal = (nuevosMiembros = []) => {
    actualizarCampoLocal("miembros", nuevosMiembros);
  };

  const handleCambiarRolMiembro = async (member, rolDestino) => {
    setAccionMiembroId(member.id);
    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/miembros/${member.id}/rol`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId: user.id, rol: rolDestino }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        toast.error(result.error || "No se pudo actualizar el rol");
        return;
      }

      actualizarMiembrosLocal(result.miembros);
      setMenuMiembroId(null);
      toast.success(
        rolDestino === "admin"
          ? `${getMemberName(member)} ahora es admin del grupo`
          : `${getMemberName(member)} dejó de ser admin del grupo`
      );
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    } finally {
      setAccionMiembroId(null);
    }
  };

  const handleDesignarAdmin = (member) => handleCambiarRolMiembro(member, "admin");
  const handleDescartarAdmin = (member) => handleCambiarRolMiembro(member, "miembro");

  const handleCederPropiedad = async (member) => {
    if (!window.confirm(`¿Ceder la propiedad del grupo a ${getMemberName(member)}? Seguirás dentro como admin.`)) return;

    setAccionMiembroId(member.id);
    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/propietario`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId: user.id, nuevoPropietarioId: member.id }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        toast.error(result.error || "No se pudo ceder la propiedad");
        return;
      }

      actualizarMiembrosLocal(result.miembros);
      if (result.propietario_id) actualizarCampoLocal("propietario_id", result.propietario_id);
      setMenuMiembroId(null);
      toast.success(`${getMemberName(member)} ahora es propietario del grupo`);
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    } finally {
      setAccionMiembroId(null);
    }
  };

  const handleQuitarMiembro = async (member) => {
    if (!window.confirm(`¿Quitar a ${getMemberName(member)} del grupo?`)) return;

    setAccionMiembroId(member.id);
    try {
      const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/miembros/${member.id}/quitar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuarioId: user.id }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        toast.error(result.error || "No se pudo quitar el miembro");
        return;
      }

      actualizarMiembrosLocal(result.miembros);
      setMenuMiembroId(null);
      toast.success("Miembro quitado del grupo");
    } catch (err) {
      console.error(err);
      toast.error("Error de conexión");
    } finally {
      setAccionMiembroId(null);
    }
  };

  const puedeAdministrarMiembro = (member) => {
    if (!puedeEditar) return false;
    if (Number(member.id) === Number(user?.id)) return false;
    if (member.rol === "propietario") return false;

    // El propietario puede administrar a cualquier miembro/admin.
    if (esPropietario) return true;

    // Un admin solo puede gestionar miembros normales; no puede tocar otros admins.
    return miRol === "admin" && member.rol !== "admin";
  };

  const comenzarEdicion = (campo) => {
    setEditandoCampo(campo);
    setNuevoValor(campo === "nombre" ? chat.usuario_nombre || chat.nombre || "" : chat.descripcion || "");
  };

  return (
    <aside className={`wa-group-info-panel ${visible ? "is-open" : ""}`} aria-hidden={!visible}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="d-none"
        onChange={handleImagenGrupo}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="d-none"
        onChange={handleImagenGrupo}
      />

      <div className="wa-group-info-inner">
        <div className="wa-group-info-topbar">
          {modoBusqueda ? (
            <button type="button" className="wa-info-icon-btn" onClick={cerrarBusquedaGrupo} title="Volver">
              <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="wa-info-icon-btn" onClick={onClose} title="Cerrar">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
          <span>{modoBusqueda ? "Buscar mensajes" : "Info. del grupo"}</span>
        </div>

        {modoBusqueda ? (
          <GroupSearchView
            chat={chat}
            value={textoBusqueda}
            onChange={setTextoBusqueda}
            results={resultadosBusqueda}
            loading={buscandoMensajes}
            error={errorBusqueda}
            onSelect={seleccionarResultadoBusqueda}
          />
        ) : (
        <div className="wa-group-info-scroll">
          <section className="wa-info-card wa-group-profile-card text-center">
            <div className="wa-group-profile-avatar-wrap">
              <div className="wa-avatar-menu-anchor" ref={imageMenuRef}>
                <GroupAvatar
                  group={chat}
                  members={miembros}
                  size={164}
                  editable
                  canEdit={puedeEditar}
                  onEditImage={() => setMostrarMenuImagen((prev) => !prev)}
                />
                {mostrarMenuImagen && puedeEditar && (
                  <div className="wa-avatar-image-menu">
                    <button
                      type="button"
                      disabled={!chat.imagen_url}
                      onClick={() => {
                        if (chat.imagen_url) setImagenVistaPrevia(chat.imagen_url);
                        setMostrarMenuImagen(false);
                      }}
                    >
                      <i className="fa-regular fa-eye" aria-hidden="true" />
                      Ver foto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarMenuImagen(false);
                        cameraInputRef.current?.click();
                      }}
                    >
                      <i className="fa-solid fa-camera" aria-hidden="true" />
                      Tomar foto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarMenuImagen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <i className="fa-regular fa-folder" aria-hidden="true" />
                      Subir foto
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMostrarMenuImagen(false);
                        toast("Emoji y sticker para imagen de grupo se puede agregar después");
                      }}
                    >
                      <i className="fa-regular fa-face-smile" aria-hidden="true" />
                      Emoji y sticker
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={!chat.imagen_url}
                      onClick={handleEliminarImagenGrupo}
                    >
                      <i className="fa-regular fa-trash-can" aria-hidden="true" />
                      Quitar foto
                    </button>
                  </div>
                )}
              </div>
              {subiendoImagen && <div className="wa-group-uploading">Subiendo...</div>}
            </div>

            {editandoCampo === "nombre" ? (
              <EditField
                id="group-name"
                value={nuevoValor}
                onChange={setNuevoValor}
                placeholder="Nombre del grupo"
                onSave={() => handleEditarGrupo("nombre", nuevoValor)}
                onCancel={() => {
                  setEditandoCampo(null);
                  setMostrarEmojisNombre(false);
                }}
                showEmoji={mostrarEmojisNombre}
                onToggleEmoji={() => setMostrarEmojisNombre((prev) => !prev)}
                onEmoji={(emoji) => setNuevoValor((prev) => prev + emoji.native)}
              />
            ) : (
              <div className="wa-group-title-row">
                <h2>{chat.usuario_nombre || chat.nombre || "Grupo"}</h2>
                {puedeEditar && (
                  <button type="button" className="wa-info-small-btn" onClick={() => comenzarEdicion("nombre")} title="Editar nombre">
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <p className="wa-group-subtitle">Grupo · {miembros.length} miembros</p>
          </section>

          <section className="wa-info-card wa-group-actions-grid">
            <button type="button" className="wa-group-action-btn" disabled>
              <i className="fa-solid fa-phone" aria-hidden="true" />
              <span>Voz</span>
            </button>
            <button type="button" className="wa-group-action-btn" disabled>
              <i className="fa-solid fa-video" aria-hidden="true" />
              <span>Video</span>
            </button>
            <button type="button" className="wa-group-action-btn" onClick={() => setOffcanvasGrupo((prev) => (prev ? null : chat))} disabled={!puedeEditar}>
              <i className="fa-solid fa-user-plus" aria-hidden="true" />
              <span>Añadir</span>
            </button>
            <button type="button" className="wa-group-action-btn" onClick={abrirBusquedaGrupo}>
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <span>Busca</span>
            </button>
          </section>

          <section className="wa-info-card wa-description-card">
            {editandoCampo === "descripcion" ? (
              <EditField
                id="group-description"
                textarea
                value={nuevoValor}
                onChange={setNuevoValor}
                placeholder="Añade una descripción del grupo"
                onSave={() => handleEditarGrupo("descripcion", nuevoValor)}
                onCancel={() => {
                  setEditandoCampo(null);
                  setMostrarEmojisDesc(false);
                }}
                showEmoji={mostrarEmojisDesc}
                onToggleEmoji={() => setMostrarEmojisDesc((prev) => !prev)}
                onEmoji={(emoji) => setNuevoValor((prev) => prev + emoji.native)}
              />
            ) : (
              <>
                <div className="wa-description-header">
                  <DescripcionConFormato texto={chat.descripcion || "Añade una descripción del grupo"} empty={!chat.descripcion} />
                  {puedeEditar && (
                    <button type="button" className="wa-info-small-btn" onClick={() => comenzarEdicion("descripcion")} title="Editar descripción">
                      <i className="fa-solid fa-pen" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="wa-created-text">Grupo creado el {chat.fecha_creacion ? new Date(chat.fecha_creacion).toLocaleDateString() : ""}</p>
              </>
            )}
          </section>

          <section className="wa-info-card wa-media-card" onClick={() => setMostrarVerArchivos(true)}>
            <div className="wa-info-section-row">
              <div className="wa-info-section-title">
                <i className="fa-regular fa-images" aria-hidden="true" />
                <span>Archivos, enlaces y documentos</span>
              </div>
              <span className="wa-info-count">{archivos.length}</span>
            </div>
            {ultimasImagenes.length > 0 && (
              <div className="wa-media-preview-strip">
                {ultimasImagenes.map((archivo) => (
                  <img
                    key={archivo.id || archivo.archivo_url}
                    src={fixUrl(archivo.archivo_url)}
                    alt={archivo.nombre_archivo || "archivo"}
                    className="wa-media-preview-thumb"
                  />
                ))}
              </div>
            )}
          </section>

          <section className="wa-info-card wa-privacy-card">
            <div className="wa-info-section-row">
              <div>
                <h3>Grupo {chat.privacidad === "privado" ? "privado" : "público"}</h3>
                <p>{chat.privacidad === "privado" ? "Solo administradores y propietario pueden añadir personas" : "Todos los miembros pueden añadir personas"}</p>
              </div>
              <label className="wa-switch">
                <input
                  type="checkbox"
                  checked={chat.privacidad === "privado"}
                  disabled={!esPropietario}
                  onChange={(e) => handleCambiarPrivacidad(e.target.checked ? "privado" : "publico")}
                />
                <span />
              </label>
            </div>
          </section>

          <section className="wa-info-card wa-members-card">
            <div className="wa-info-section-row mb-2">
              <h3>Miembros ({miembros.length})</h3>
              {puedeEditar && (
                <button type="button" className="wa-add-member-btn" onClick={() => setOffcanvasGrupo((prev) => (prev ? null : chat))}>
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                  Añadir miembro
                </button>
              )}
            </div>

            <ul className="wa-member-list">
              {miembrosVisibles.map((member) => {
                const nombre = getMemberName(member);
                const esActual = Number(member.id) === Number(user?.id);
                const canManage = puedeAdministrarMiembro(member);
                const isOpen = menuMiembroId === member.id;

                return (
                  <li key={member.id} className="wa-member-item-wrap">
                    <div className={`wa-member-item ${canManage ? "can-manage" : ""}`}>
                      <div className="wa-member-avatar wa-presence-wrapper">
                        {member.url_imagen ? (
                          <img src={getAvatarUrl(member.url_imagen)} alt={nombre} />
                        ) : (
                          <div style={{ backgroundColor: member.background || "#6c757d" }}>{getInitial(nombre)}</div>
                        )}
                        {renderPresenceBadge(member.id)}
                      </div>

                      <div className="wa-member-main">
                        <div className="wa-member-name-row">
                          <span className="wa-member-name">{esActual ? "Tú" : nombre}</span>
                          {member.rol === "propietario" && <span className="wa-role-badge owner">Propietario</span>}
                          {member.rol === "admin" && <span className="wa-role-badge admin">Admin. del grupo</span>}
                        </div>
                        <span className="wa-member-subtitle">{getPresenceInfo(member.id).label} · {member.correo || member.estado || "Disponible"}</span>
                      </div>

                      {canManage && (
                        <button
                          type="button"
                          className="wa-member-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuMiembroId((prev) => (prev === member.id ? null : member.id));
                          }}
                          title="Opciones del miembro"
                        >
                          <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {canManage && isOpen && (
                      <div className="wa-member-context-menu">
                        {member.rol === "admin" ? (
                          esPropietario && (
                            <button type="button" disabled={accionMiembroId === member.id} onClick={() => handleDescartarAdmin(member)}>
                              <i className="fa-solid fa-user-minus" aria-hidden="true" />
                              Descartar como admin.
                            </button>
                          )
                        ) : (
                          <button type="button" disabled={accionMiembroId === member.id} onClick={() => handleDesignarAdmin(member)}>
                            <i className="fa-solid fa-user-shield" aria-hidden="true" />
                            Designar como admin. del grupo
                          </button>
                        )}

                        {esPropietario && (
                          <button type="button" disabled={accionMiembroId === member.id} onClick={() => handleCederPropiedad(member)}>
                            <i className="fa-solid fa-crown" aria-hidden="true" />
                            Ceder propiedad del grupo
                          </button>
                        )}

                        <button type="button" className="danger" disabled={accionMiembroId === member.id} onClick={() => handleQuitarMiembro(member)}>
                          <i className="fa-regular fa-circle-minus" aria-hidden="true" />
                          Quitar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {miembros.length > 8 && (
              <button type="button" className="wa-show-more-members" onClick={() => setMostrarTodos((prev) => !prev)}>
                {mostrarTodos ? "Mostrar menos" : `Ver ${miembros.length - 8} miembros más`}
              </button>
            )}
          </section>

          <section className="wa-info-card wa-danger-card">
            {miRol === "propietario" ? (
              <button
                type="button"
                className="wa-danger-action"
                onClick={async () => {
                  if (!window.confirm("¿Seguro que deseas eliminar este grupo? Esta acción no se puede deshacer.")) return;
                  try {
                    const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/eliminar`, {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ usuarioId: user.id }),
                    });
                    const result = await res.json();
                    if (!res.ok || !result.success) {
                      toast.error(result.error || "Error al eliminar grupo");
                      return;
                    }
                    toast.success("Grupo eliminado");
                    onClose();
                  } catch (err) {
                    console.error(err);
                    toast.error("Error de conexión al eliminar grupo");
                  }
                }}
              >
                <i className="fa-regular fa-trash-can" aria-hidden="true" />
                Eliminar grupo
              </button>
            ) : (
              <button
                type="button"
                className="wa-danger-action"
                onClick={async () => {
                  if (!window.confirm("¿Seguro que deseas salir de este grupo?")) return;
                  try {
                    const res = await fetch(`${BASE_URL}/api/grupos/${chat.grupo_id}/salir`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ usuarioId: user.id }),
                    });
                    const result = await res.json();
                    if (!res.ok || !result.success) {
                      toast.error(result.error || "Error al salir del grupo");
                      return;
                    }
                    toast.success("Has salido del grupo");
                    onClose();
                  } catch (err) {
                    console.error(err);
                    toast.error("Error de conexión al salir del grupo");
                  }
                }}
              >
                <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
                Salir del grupo
              </button>
            )}
          </section>
        </div>
        )}
      </div>

      {imagenVistaPrevia && (
        <div className="wa-photo-viewer-backdrop" onClick={() => setImagenVistaPrevia(null)}>
          <button type="button" className="wa-photo-viewer-close" onClick={() => setImagenVistaPrevia(null)} title="Cerrar">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
          <img src={fixUrl(imagenVistaPrevia)} alt={chat.usuario_nombre || chat.nombre || "Foto del grupo"} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </aside>
  );
};

const formatSearchDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
};

const GroupSearchView = ({ chat, value, onChange, results, loading, error, onSelect }) => {
  const groupName = chat?.usuario_nombre || chat?.nombre || "este grupo";

  return (
    <div className="wa-group-search-view">
      <div className="wa-group-search-input-row">
        <i className="fa-regular fa-calendar" aria-hidden="true" />
        <div className="wa-group-search-input-wrap">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Busca"
          />
          {value && (
            <button type="button" onClick={() => onChange("")} title="Limpiar búsqueda">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {!value.trim() ? (
        <div className="wa-search-empty-state">Buscar mensajes con {groupName}</div>
      ) : loading ? (
        <div className="wa-search-empty-state">Buscando...</div>
      ) : error ? (
        <div className="wa-search-empty-state text-danger">{error}</div>
      ) : results.length === 0 ? (
        <div className="wa-search-empty-state">No se encontraron mensajes</div>
      ) : (
        <div className="wa-search-results-list">
          {results.map((message) => {
            const preview = getMessagePreview(message);
            const author = getMemberName(message);

            return (
              <button
                type="button"
                key={message.id}
                className="wa-search-result-item"
                onClick={() => onSelect(message.id)}
              >
                <div className="wa-search-result-avatar">
                  {message.url_imagen ? (
                    <img src={getAvatarUrl(message.url_imagen)} alt={author} />
                  ) : (
                    <div style={{ backgroundColor: message.background || "#6c757d" }}>{getInitial(author)}</div>
                  )}
                </div>
                <div className="wa-search-result-main">
                  <div className="wa-search-result-title">
                    <span>{author}</span>
                    <time>{formatSearchDate(message.fecha_envio)}</time>
                  </div>
                  <div className="wa-search-result-preview">
                    {preview.iconClass && <i className={preview.iconClass} aria-hidden="true" />}
                    <span>{preview.text}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const EditField = ({
  id,
  value,
  onChange,
  placeholder,
  onSave,
  onCancel,
  showEmoji,
  onToggleEmoji,
  onEmoji,
  textarea = false,
}) => (
  <div className="wa-edit-field">
    {textarea ? (
      <textarea id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} rows={3} />
    ) : (
      <input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    )}

    <div className="wa-edit-actions">
      <button type="button" onClick={onToggleEmoji} title="Añadir emoji">
        <i className="fa-regular fa-face-smile" aria-hidden="true" />
      </button>
      <button type="button" className="success" onClick={onSave} title="Guardar">
        <i className="fa-solid fa-check" aria-hidden="true" />
      </button>
      <button type="button" className="danger" onClick={onCancel} title="Cancelar">
        <i className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </div>

    {showEmoji && (
      <div className="wa-edit-emoji-picker">
        <Picker
          data={data}
          onEmojiSelect={onEmoji}
          theme="light"
          previewPosition="none"
          searchPosition="none"
        />
      </div>
    )}
  </div>
);

const DescripcionConFormato = ({ texto, empty = false }) => {
  const [mostrarTodo, setMostrarTodo] = useState(false);
  const lineas = String(texto || "").split(/\r?\n/);
  const limiteLineas = 4;
  const esLargo = lineas.length > limiteLineas || String(texto || "").length > 160;
  const textoVisible = mostrarTodo ? lineas.join("\n") : lineas.slice(0, limiteLineas).join("\n");

  return (
    <div className={`wa-description-text ${empty ? "is-empty" : ""}`}>
      {textoVisible}
      {esLargo && (
        <button type="button" onClick={() => setMostrarTodo((prev) => !prev)}>
          {mostrarTodo ? "Mostrar menos" : "...Mostrar más"}
        </button>
      )}
    </div>
  );
};

export default VerInfoGrupo;
