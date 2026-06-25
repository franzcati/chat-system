import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { getAvatarUrl } from "../utils/url";

const BASE_URL = "";

const getInitial = (value = "") => {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() : "U";
};

const getContactName = (chat = {}, contacto = {}) => {
  const fromContact = `${contacto?.nombre || ""} ${contacto?.apellido || ""}`.trim();
  return fromContact || chat?.usuario_nombre || chat?.nombre || "Contacto";
};

const fixUrl = (url = "") => {
  if (!url) return "";
  const value = String(url || "").trim();
  if (/^https?:\/\//i.test(value)) return getAvatarUrl(value) || value;
  if (value.startsWith("/api/uploads/")) return getAvatarUrl(value.replace("/api", "")) || value.replace("/api", "");
  if (value.startsWith("/uploads/")) return getAvatarUrl(value) || value;
  if (value.startsWith("uploads/")) return getAvatarUrl(`/${value}`) || `/${value}`;
  return value;
};

const ContactAvatar = ({ chat, contacto, size = 156 }) => {
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
        backgroundColor: contacto?.background || chat?.background || "#d9e1e6",
      }}
    >
      {getInitial(name)}
    </div>
  );
};

const VerInfoContacto = ({
  chat,
  user,
  visible,
  onClose,
  onBuscarEnChat,
  onOpenFiles,
  onEnviarMensaje,
  onAddToList,
  onInfoLoaded,
}) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !chat?.usuario_id || !user?.id) return undefined;

    let cancelled = false;

    const cargarInfo = async () => {
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
  const archivos = useMemo(() => {
    const fromInfo = Array.isArray(info?.archivos) ? info.archivos : [];
    const fromChat = Array.isArray(chat?.archivos) ? chat.archivos : [];
    return fromInfo.length ? fromInfo : fromChat;
  }, [info?.archivos, chat?.archivos]);

  const ultimasImagenes = archivos
    .filter((archivo) => /image\//i.test(archivo.tipo_archivo || "") || /\.(jpg|jpeg|png|gif|webp)$/i.test(archivo.archivo_url || ""))
    .slice(0, 4);

  const gruposComunes = Array.isArray(info?.grupos_comunes) ? info.grupos_comunes : [];
  const estadoTexto = contacto?.perfil_estado_mensaje || contacto?.estado || contacto?.correo || "Disponible";

  return (
    <aside className={`wa-group-info-panel wa-contact-info-panel ${visible ? "is-open" : ""}`} aria-hidden={!visible}>
      <div className="wa-group-info-inner wa-contact-info-inner">
        <div className="wa-group-info-topbar wa-contact-info-topbar">
          <button type="button" className="wa-info-icon-btn" onClick={onClose} title="Cerrar">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
          <span>Info. del contacto</span>
          <button
            type="button"
            className="wa-info-icon-btn ms-auto"
            onClick={() => toast("Edición del contacto disponible próximamente")}
            title="Editar contacto"
          >
            <i className="fa-solid fa-pen" aria-hidden="true" />
          </button>
        </div>

        <div className="wa-group-info-scroll wa-contact-info-scroll">
          <section className="wa-info-card wa-contact-profile-card text-center">
            <div className="wa-contact-info-avatar mx-auto">
              <ContactAvatar chat={chat} contacto={contacto} />
            </div>
            <h2>{nombreContacto}</h2>
            <p className="wa-group-subtitle">{contacto?.correo || chat?.usuario_correo || chat?.correo || "Sin correo"}</p>
            {loading && <span className="wa-contact-loading">Cargando información...</span>}
          </section>

          <section className="wa-info-card wa-group-actions-grid wa-contact-actions-grid">
            <button type="button" className="wa-group-action-btn" disabled>
              <i className="fa-solid fa-phone" aria-hidden="true" />
              <span>Voz</span>
            </button>
            <button type="button" className="wa-group-action-btn" disabled>
              <i className="fa-solid fa-video" aria-hidden="true" />
              <span>Video</span>
            </button>
            <button type="button" className="wa-group-action-btn" onClick={onBuscarEnChat}>
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <span>Busca</span>
            </button>
          </section>

          <section className="wa-info-card wa-description-card">
            <div className="wa-contact-info-label">Info.</div>
            <p className="wa-contact-bio">{estadoTexto}</p>
          </section>

          <section className="wa-info-card wa-media-card" onClick={onOpenFiles}>
            <div className="wa-info-section-row">
              <div className="wa-info-section-title">
                <i className="fa-regular fa-images" aria-hidden="true" />
                <span>Archivos, enlaces y documentos</span>
              </div>
              <span className="wa-info-count">{archivos.length}</span>
            </div>
            {ultimasImagenes.length > 0 ? (
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
            ) : (
              <p className="wa-contact-empty-text">Aún no hay archivos compartidos.</p>
            )}
          </section>

          <section className="wa-info-card wa-contact-option-list">
            <button type="button" className="wa-contact-option-row">
              <i className="fa-regular fa-star" aria-hidden="true" />
              <span>Mensajes destacados</span>
            </button>
            <button type="button" className="wa-contact-option-row">
              <i className="fa-regular fa-bell-slash" aria-hidden="true" />
              <span>Ajustes de notificaciones</span>
            </button>
            <button type="button" className="wa-contact-option-row">
              <i className="fa-regular fa-clock" aria-hidden="true" />
              <span>Mensajes temporales</span>
              <small>Desactivados</small>
            </button>
            <button type="button" className="wa-contact-option-row">
              <i className="fa-solid fa-shield-halved" aria-hidden="true" />
              <span>Privacidad avanzada del chat</span>
              <small>Desactivado</small>
            </button>
            <button type="button" className="wa-contact-option-row">
              <i className="fa-solid fa-lock" aria-hidden="true" />
              <span>Cifrado</span>
              <small>Los mensajes están cifrados de extremo a extremo.</small>
            </button>
          </section>

          {gruposComunes.length > 0 && (
            <section className="wa-info-card wa-common-groups-card">
              <h3>{gruposComunes.length} grupos en común</h3>
              <ul className="wa-common-groups-list">
                {gruposComunes.map((grupo) => (
                  <li key={grupo.grupo_id}>
                    <div className="wa-common-group-avatar">
                      {grupo.imagen_url ? (
                        <img src={getAvatarUrl(grupo.imagen_url)} alt={grupo.nombre} />
                      ) : (
                        <i className="fa-solid fa-user-group" aria-hidden="true" />
                      )}
                    </div>
                    <div>
                      <strong>{grupo.nombre}</strong>
                      <span>{grupo.total_miembros || 0} miembros</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="wa-info-card wa-contact-danger-list">
            <button type="button" className="wa-contact-option-row" onClick={() => toast("Añadido a favoritos") }>
              <i className="fa-regular fa-heart" aria-hidden="true" />
              <span>Añadir a Favoritos</span>
            </button>
            <button type="button" className="wa-contact-option-row" onClick={() => onAddToList?.(chat)}>
              <i className="fa-regular fa-address-book" aria-hidden="true" />
              <span>Añadir a la lista</span>
            </button>
            <button type="button" className="wa-contact-option-row danger" onClick={() => toast("Opción no configurada") }>
              <i className="fa-regular fa-circle-xmark" aria-hidden="true" />
              <span>Vaciar chat</span>
            </button>
            <button type="button" className="wa-contact-option-row danger" onClick={() => toast("Opción no configurada") }>
              <i className="fa-solid fa-ban" aria-hidden="true" />
              <span>Bloquear a {nombreContacto}</span>
            </button>
            <button type="button" className="wa-contact-option-row danger" onClick={() => toast("Opción no configurada") }>
              <i className="fa-regular fa-thumbs-down" aria-hidden="true" />
              <span>Reportar a {nombreContacto}</span>
            </button>
            <button type="button" className="wa-contact-option-row danger" onClick={() => toast("Opción no configurada") }>
              <i className="fa-regular fa-trash-can" aria-hidden="true" />
              <span>Eliminar chat</span>
            </button>
          </section>
        </div>
      </div>
    </aside>
  );
};

export default VerInfoContacto;
