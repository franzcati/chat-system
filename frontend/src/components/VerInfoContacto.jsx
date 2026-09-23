import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { getAvatarUrl } from "../utils/url";
import GroupAvatar from "./GroupAvatar";
import VerArchivos from "./VerArchivos";

const BASE_URL = "";

const getInitial = (value = "") => {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() : "U";
};

const getContactName = (chat = {}, contacto = {}) => {
  const fromContact = `${contacto?.nombre || ""} ${contacto?.apellido || ""}`.trim();
  return fromContact || chat?.usuario_nombre || chat?.nombre || "Contacto";
};

const ContactAvatar = ({ chat, contacto, size = 148 }) => {
  const name = getContactName(chat, contacto);
  const imageUrl = contacto?.url_imagen || chat?.url_imagen;

  if (imageUrl) {
    return (
      <img
        src={getAvatarUrl(imageUrl)}
        alt={name}
        className="wa-contact-info-avatar-img"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="wa-contact-info-avatar-fallback"
      style={{
        width: size,
        height: size,
        backgroundColor: contacto?.background || chat?.background || "#5573a9",
      }}
      aria-label={name}
    >
      {getInitial(name)}
    </div>
  );
};

const copyText = async (value) => {
  const text = String(value || "").trim();
  if (!text) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("No se pudo usar Clipboard API:", error);
  }

  try {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch (error) {
    console.warn("No se pudo copiar el texto:", error);
    return false;
  }
};

const VerInfoContacto = ({
  chat,
  user,
  visible,
  onClose,
  onBuscarEnChat,
  mostrarVerArchivos,
  setMostrarVerArchivos,
  onEnviarMensaje,
  onInfoLoaded,
  onOpenCommonGroup,
  presence,
  pinnedCount = 0,
}) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mostrarTodosGrupos, setMostrarTodosGrupos] = useState(false);

  useEffect(() => {
    setMostrarTodosGrupos(false);
  }, [chat?.usuario_id]);

  useEffect(() => {
    if (!visible || !chat?.usuario_id || !user?.id) return undefined;

    let cancelled = false;

    const cargarInfo = async () => {
      setInfo(null);
      setLoading(true);
      try {
        const res = await fetch(`${BASE_URL}/api/chats/contacto-info/${user.id}/${chat.usuario_id}`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setInfo(data);
          onInfoLoaded?.(data);
        }
      } catch (error) {
        console.error("❌ Error cargando info del contacto:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    cargarInfo();
    return () => {
      cancelled = true;
    };
  }, [visible, chat?.usuario_id, user?.id]);

  const contacto = info?.usuario || {
    id: chat?.usuario_id,
    nombre: chat?.usuario_nombre,
    apellido: chat?.usuario_apellido || chat?.apellido,
    correo: chat?.usuario_correo || chat?.correo,
    url_imagen: chat?.url_imagen,
    background: chat?.background,
  };

  const nombreContacto = getContactName(chat, contacto);
  const correoContacto = contacto?.correo || chat?.usuario_correo || chat?.correo || "Sin correo";

  const archivos = useMemo(() => {
    const fromInfo = Array.isArray(info?.archivos) ? info.archivos : [];
    const fromChat = Array.isArray(chat?.archivos) ? chat.archivos : [];
    return fromInfo.length ? fromInfo : fromChat;
  }, [info?.archivos, chat?.archivos]);

  const enlaces = Array.isArray(chat?.enlaces) ? chat.enlaces : [];
  const totalRecursos = archivos.length + enlaces.length;
  const gruposComunes = Array.isArray(info?.grupos_comunes) ? info.grupos_comunes : [];
  const gruposVisibles = mostrarTodosGrupos ? gruposComunes : gruposComunes.slice(0, 2);

  const presenceClass = presence?.className || "offline";
  const presenceLabel = presenceClass === "online"
    ? "En línea"
    : (presence?.label || "Sin conexión");

  const handleCopyEmail = async () => {
    if (!correoContacto || correoContacto === "Sin correo") {
      toast.error("Este contacto no tiene correo disponible");
      return;
    }

    const copied = await copyText(correoContacto);
    if (copied) toast.success("Correo copiado");
    else toast.error("No se pudo copiar el correo");
  };

  return (
    <aside className={`wa-group-info-panel wa-contact-info-panel ${visible ? "is-open" : ""}`} aria-hidden={!visible}>
      <div className="wa-group-info-inner wa-contact-info-inner">
        {mostrarVerArchivos ? (
          <VerArchivos
            chat={{ ...chat, archivos, enlaces }}
            visible
            embedded
            backLabel="Volver a Info. del contacto"
            onClose={() => setMostrarVerArchivos?.(false)}
          />
        ) : (
          <>
            <div className="wa-group-info-topbar wa-contact-info-topbar">
              <button type="button" className="wa-info-icon-btn" onClick={onClose} title="Cerrar" aria-label="Cerrar info. del contacto">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
              <span>Info. del contacto</span>
              <button
                type="button"
                className="wa-info-icon-btn ms-auto"
                onClick={() => toast("Edición del contacto disponible próximamente")}
                title="Editar contacto"
                aria-label="Editar contacto"
              >
                <i className="fa-solid fa-pen" aria-hidden="true" />
              </button>
            </div>

            <div className="wa-group-info-scroll wa-contact-info-scroll">
              <section className="wa-contact-profile-card">
                <div className="wa-contact-info-avatar">
                  <ContactAvatar chat={chat} contacto={contacto} />
                  <span className={`wa-contact-avatar-presence ${presenceClass}`} title={presenceLabel} aria-label={presenceLabel}>
                    <i className={presenceClass === "online" ? "fa-solid fa-circle-check" : presence?.iconClass || "fa-solid fa-circle"} aria-hidden="true" />
                  </span>
                </div>

                <h2>{nombreContacto}</h2>
                <p className="wa-contact-profile-email">{correoContacto}</p>
                <span className={`wa-contact-presence-pill ${presenceClass}`}>{presenceLabel}</span>
                {loading && <span className="wa-contact-loading">Cargando información...</span>}
              </section>

              <section className="wa-contact-actions-grid" aria-label="Acciones del contacto">
                <button type="button" className="wa-contact-action-btn" disabled title="Llamada de voz">
                  <i className="fa-solid fa-phone" aria-hidden="true" />
                  <span>Llamar</span>
                </button>
                <button type="button" className="wa-contact-action-btn is-video" disabled title="Videollamada">
                  <i className="fa-solid fa-video" aria-hidden="true" />
                  <span>Video</span>
                </button>
                <button type="button" className="wa-contact-action-btn is-message" onClick={onEnviarMensaje} title="Volver al chat">
                  <i className="fa-solid fa-message" aria-hidden="true" />
                  <span>Mensaje</span>
                </button>
                <button type="button" className="wa-contact-action-btn is-search" onClick={onBuscarEnChat} title="Buscar en el chat">
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                  <span>Buscar</span>
                </button>
              </section>

              <section className="wa-contact-info-card">
                <span className="wa-contact-info-card-icon" aria-hidden="true">
                  <i className="fa-solid fa-info" />
                </span>
                <div className="wa-contact-info-card-copy">
                  <strong>Información</strong>
                  <span>{correoContacto}</span>
                </div>
                <button type="button" className="wa-contact-copy-btn" onClick={handleCopyEmail} title="Copiar correo" aria-label="Copiar correo">
                  <i className="fa-regular fa-copy" aria-hidden="true" />
                </button>
              </section>

              <section className="wa-contact-settings-list" aria-label="Opciones del contacto">
                <button type="button" className="wa-contact-setting-row" onClick={() => setMostrarVerArchivos?.(true)}>
                  <span className="wa-contact-setting-icon"><i className="fa-regular fa-file-lines" aria-hidden="true" /></span>
                  <span className="wa-contact-setting-main">Archivos, enlaces y documentos</span>
                  <span className="wa-contact-setting-value">{totalRecursos}</span>
                  <i className="fa-solid fa-chevron-right wa-contact-setting-chevron" aria-hidden="true" />
                </button>

                <button type="button" className="wa-contact-setting-row">
                  <span className="wa-contact-setting-icon"><i className="fa-regular fa-star" aria-hidden="true" /></span>
                  <span className="wa-contact-setting-main">Mensajes destacados</span>
                  <span className="wa-contact-setting-value">{Number(pinnedCount) || 0}</span>
                  <i className="fa-solid fa-chevron-right wa-contact-setting-chevron" aria-hidden="true" />
                </button>

                <button type="button" className="wa-contact-setting-row">
                  <span className="wa-contact-setting-icon"><i className="fa-regular fa-bell-slash" aria-hidden="true" /></span>
                  <span className="wa-contact-setting-main">Ajustes de notificaciones</span>
                  <i className="fa-solid fa-chevron-right wa-contact-setting-chevron" aria-hidden="true" />
                </button>

                <button type="button" className="wa-contact-setting-row">
                  <span className="wa-contact-setting-icon"><i className="fa-regular fa-clock" aria-hidden="true" /></span>
                  <span className="wa-contact-setting-main">Mensajes temporales</span>
                  <span className="wa-contact-setting-value">Desactivados</span>
                  <i className="fa-solid fa-chevron-right wa-contact-setting-chevron" aria-hidden="true" />
                </button>

                <button type="button" className="wa-contact-setting-row">
                  <span className="wa-contact-setting-icon"><i className="fa-solid fa-shield-halved" aria-hidden="true" /></span>
                  <span className="wa-contact-setting-main">Privacidad avanzada del chat</span>
                  <span className="wa-contact-setting-value">Desactivado</span>
                  <i className="fa-solid fa-chevron-right wa-contact-setting-chevron" aria-hidden="true" />
                </button>

                <div className="wa-contact-setting-row wa-contact-encryption-row">
                  <span className="wa-contact-setting-icon"><i className="fa-solid fa-lock" aria-hidden="true" /></span>
                  <span className="wa-contact-setting-main">
                    <strong>Cifrado</strong>
                    <small>Los mensajes están cifrados de extremo a extremo.</small>
                  </span>
                </div>
              </section>

              {gruposComunes.length > 0 && (
                <section className="wa-common-groups-card-v25">
                  <div className="wa-common-groups-heading-v25">
                    <h3>{gruposComunes.length} {gruposComunes.length === 1 ? "grupo" : "grupos"} en común</h3>
                    <button type="button" onClick={() => setMostrarTodosGrupos((prev) => !prev)}>
                      <span>{mostrarTodosGrupos ? "Ver menos" : "Ver todos"}</span>
                      <i className={`fa-solid ${mostrarTodosGrupos ? "fa-chevron-up" : "fa-chevron-right"}`} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="wa-common-groups-list-v25">
                    {gruposVisibles.map((grupo) => (
                      <button
                        type="button"
                        key={grupo.grupo_id}
                        className="wa-common-group-row-v25"
                        onClick={() => onOpenCommonGroup?.(grupo)}
                        title={`Abrir ${grupo.nombre || "grupo"}`}
                      >
                        <GroupAvatar
                          group={{
                            ...grupo,
                            grupo_id: grupo.grupo_id,
                            nombre: grupo.nombre,
                            usuario_nombre: grupo.nombre,
                            imagen_url: grupo.imagen_url,
                          }}
                          size={48}
                          className="wa-common-group-avatar-v25"
                        />
                        <span className="wa-common-group-copy-v25">
                          <strong>{grupo.nombre || "Grupo"}</strong>
                          <small>{Number(grupo.total_miembros) || 0} {Number(grupo.total_miembros) === 1 ? "miembro" : "miembros"}</small>
                        </span>
                        <i className="fa-solid fa-chevron-right wa-common-group-chevron-v25" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="wa-contact-danger-actions">
                <button type="button" className="wa-contact-danger-btn" onClick={() => toast("Opción no configurada")}>
                  <i className="fa-solid fa-ban" aria-hidden="true" />
                  <span>Bloquear a {nombreContacto}</span>
                </button>
                <button type="button" className="wa-contact-danger-btn" onClick={() => toast("Opción no configurada")}>
                  <i className="fa-regular fa-trash-can" aria-hidden="true" />
                  <span>Vaciar chat</span>
                </button>
              </section>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

export default VerInfoContacto;
