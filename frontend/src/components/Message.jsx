// src/components/Message.jsx
import React, { useState, useRef, useEffect } from "react";
import { getAvatarUrl } from "../utils/url";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import twemoji from "twemoji";
import { formatChatTimeOnly, formatChatDate } from "../utils/date";
import { useTheme } from "../context/ThemeContext";
import { logDev } from "../utils/logger";

const reactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const Message = ({
  id,
  mensaje,
  hora,
  enviadoPorMi,
  usuario,
  miUsuario,
  reacciones: reaccionesDB = [],
  esGrupo,
  onVerPerfil,
  onGuardarStickerFavorito,
  onEliminarStickerFavorito,   // 👈 nuevo
  esStickerFavorito = false,    // 👈 nuevo
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [showEmojiPickerReactions, setShowEmojiPickerReactions] = useState(false);
  const [showEmojiPickerEdit, setShowEmojiPickerEdit] = useState(false);
  const [showReactionModal, setShowReactionModal] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState(null);
  const [showHistorial, setShowHistorial] = useState(false);
  const [historial, setHistorial] = useState([]);
  const [openDirection, setOpenDirection] = useState("up"); // "up" o "down"
  const messageRef = useRef(null);

  const [showFijarModal, setShowFijarModal] = useState(false);
  const [duracionFijado, setDuracionFijado] = useState("24h");
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [mensajePendienteFijar, setMensajePendienteFijar] = useState(null);
  // 🎞️ Galería tipo WhatsApp
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const [galeriaImagenes, setGaleriaImagenes] = useState([]); // urls normalizadas
  const [galeriaIndice, setGaleriaIndice] = useState(0);

  // 👇 AQUÍ pegamos lo del modal del sticker
  const [showStickerModal, setShowStickerModal] = useState(false);
  const [esFavLocal, setEsFavLocal] = useState(esStickerFavorito);

  // version oscura de emoji
  const { theme } = useTheme();
  const emojiTheme = theme === "dark" ? "dark" : "light";

  useEffect(() => {
    setEsFavLocal(esStickerFavorito);
  }, [esStickerFavorito]);

  const isMine = esGrupo
    ? mensaje.usuario_id === miUsuario?.id
    : mensaje.usuario_envia_id === miUsuario?.id;

  // 👉 Normalizamos mensaje
  const mensajeData =
    typeof mensaje === "string" ? { mensaje, eliminado: 0, editado: 0 } : mensaje;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(mensajeData.mensaje);

  const [estaFijado, setEstaFijado] = useState(mensajeData?.fijado || false);

  const esSticker = mensajeData.mensaje?.startsWith("[sticker]");
  const stickerUrl = esSticker
    ? mensajeData.mensaje.replace("[sticker]", "")
    : null;

  const puedeEditar =
    isMine &&
    !mensajeData.eliminado &&
    Date.now() - new Date(mensajeData.fecha_envio).getTime() < 15 * 60 * 1000;

  // 👇 estado local que parte de lo que vino del backend
  const reacciones = reaccionesDB || [];

  const dropdownRef = useRef(null);

  const toggleDropdown = (e) => {
    e.preventDefault();
    setDropdownOpen(!dropdownOpen);
    setShowEmojiPickerReactions(false);
    setShowReactions(false);
  };

  // Normaliza URLs de imágenes para evitar http / mixed content
  const normalizarUrlImagen = (rawUrl) => {
    let finalUrl = rawUrl || "";

    if (finalUrl.startsWith("http://chatvista.click")) {
      finalUrl = finalUrl.replace("http://chatvista.click", "https://chatvista.click");
    } else if (finalUrl.startsWith("http://")) {
      try {
        const u = new URL(finalUrl);
        finalUrl = `https://${u.host}${u.pathname}${u.search}`;
      } catch (e) {}
    }

    return finalUrl;
  };

  const abrirGaleria = (imagenes, indiceInicial = 0) => {
    if (!imagenes || !imagenes.length) return;
    const normalizadas = imagenes.map(normalizarUrlImagen);
    setGaleriaImagenes(normalizadas);
    setGaleriaIndice(indiceInicial);
    setGaleriaAbierta(true);
  };

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        !event.target.closest(".reactions-popover") &&
        !event.target.closest(".emoji-picker")
      ) {
        setDropdownOpen(false);
        setShowEmojiPickerReactions(false);
        setShowReactions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 🎹 Navegación de galería con teclado
  useEffect(() => {
    const handleKey = (e) => {
      if (!galeriaAbierta || galeriaImagenes.length === 0) return;

      if (e.key === "Escape") {
        setGaleriaAbierta(false);
      }
      if (e.key === "ArrowRight") {
        setGaleriaIndice((prev) => (prev + 1) % galeriaImagenes.length);
      }
      if (e.key === "ArrowLeft") {
        setGaleriaIndice((prev) =>
          prev - 1 < 0 ? galeriaImagenes.length - 1 : prev - 1
        );
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [galeriaAbierta, galeriaImagenes.length]);

  // 👉 Al reaccionar: actualiza UI y guarda en backend
  const handleReaction = async (emoji) => {
    logDev("👉 [FRONT] handleReaction llamado con:", emoji, "para mensaje:", id);

    try {
      const endpoint = esGrupo
        ? "/api/mensajes/grupo/reaccion"
        : "/api/mensajes/reaccion";

      const body = esGrupo
        ? { mensajeGrupoId: id, usuarioId: miUsuario?.id, emoji }
        : { mensajeId: id, usuarioId: miUsuario?.id, emoji };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ Backend respondió:", data);
    } catch (e) {
      console.error("❌ Error en fetch:", e);
    }
  };

  // 👇 función para renderizar emojis estilo WhatsApp
  const renderEmoji = (emoji, props = {}) => {
    const html = twemoji.parse(emoji, {
      folder: "svg",
      ext: ".svg",
      className: "twemoji",
    });

    return (
      <span
        {...props}
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ display: "inline-block", cursor: "pointer" }}
      />
    );
  };

  // 👉 Función para sacar inicial (si no hay avatar)
  const getInitial = (text) => {
    if (!text) return "U";
      return text.charAt(0).toUpperCase();
  };

  // 👉 Eliminar mensaje
  const handleEliminar = async (mensajeId) => {
    logDev("🗑️ [FRONT] Eliminando mensaje:", mensajeId);

    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/eliminar`
        : `/api/mensajes/${mensajeId}/eliminar`;

      const body = esGrupo
        ? { usuarioId: miUsuario.id, grupoId: usuario?.grupo_id }
        : { usuarioId: miUsuario.id };

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ [FRONT] Respuesta eliminar:", data);

      if (!res.ok) {
        console.error("❌ [FRONT] Error al eliminar:", data.error);
      }
    } catch (err) {
      console.error("❌ [FRONT] Error fetch eliminar:", err);
    }
  };

  // 👉 Deshacer el mensaje eliminado
  const handleDeshacer = async (mensajeId) => {
    logDev("↩️ [FRONT] Deshaciendo eliminación de:", mensajeId);

    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/deshacer`
        : `/api/mensajes/${mensajeId}/deshacer`;

      const body = { usuarioId: miUsuario.id };

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ [FRONT] Respuesta deshacer:", data);

      if (!res.ok) {
        console.error("❌ [FRONT] Error al deshacer:", data.error);
      }
    } catch (err) {
      console.error("❌ [FRONT] Error fetch deshacer:", err);
    }
  };

  // 👉 Editar mensaje
  const handleEditar = async (mensajeId, nuevoTexto) => {
    logDev("✏️ [FRONT] Editando mensaje:", mensajeId, "nuevo texto:", nuevoTexto);

    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/editar`
        : `/api/mensajes/${mensajeId}/editar`;

      const body = esGrupo
        ? { usuarioId: miUsuario.id, grupoId: usuario?.grupo_id, nuevoTexto }
        : { usuarioId: miUsuario.id, nuevoTexto };

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("✅ [FRONT] Respuesta editar:", data);

      if (!res.ok) {
        console.error("❌ [FRONT] Error al editar:", data.error);
      } else {
        // 👉 Actualiza el estado local
        setIsEditing(false);
        setEditText("");
      }
    } catch (err) {
      console.error("❌ [FRONT] Error fetch editar:", err);
    }
  };

  // 👉 Ver Mensajes Editados (Historial)
  const handleVerHistorial = async (mensajeId) => {
    try {
      const url = esGrupo
        ? `/api/mensajes/grupo/${mensajeId}/historial`
        : `/api/mensajes/${mensajeId}/historial`;

      const res = await fetch(url);
      const data = await res.json();
      setHistorial(data);
      setShowHistorial(true);
    } catch (err) {
      console.error("❌ Error cargando historial:", err);
    }
  };

  const emojiPickerEditRef = useRef(null);

  const handleFijar = async (e) => {
    e.preventDefault();
    setDropdownOpen(false);

    if (estaFijado) {
      desFijarMensaje();
    } else {
      try {
        // 🔹 Obtener cuántos mensajes están fijados actualmente
        let endpoint = "";

        if (esGrupo) {
          endpoint = `/api/mensajes/grupo/fijados/${mensaje.grupo_id}`;
        } else {
          const usuarioDestinoId =
            mensaje.usuario_envia_id === miUsuario.id
              ? mensaje.usuario_recibe_id
              : mensaje.usuario_envia_id;

          endpoint = `/api/mensajes/fijados?usuario1=${miUsuario.id}&usuario2=${usuarioDestinoId}`;
        }

        const res = await fetch(endpoint);
        const data = await res.json();
        const fijadosActuales = data || [];

        if (fijadosActuales.length >= 3) {
          setMensajePendienteFijar({ id: id, duracion: duracionFijado });
          setShowReplaceModal(true);
        } else {
          setShowFijarModal(true);
        }
      } catch (err) {
        console.error("❌ Error verificando mensajes fijados:", err);
        setShowFijarModal(true);
      }
    }
  };

  // 👉 Confirmar Fijado
  const confirmarFijado = async (idOverride = id, duracionOverride = duracionFijado) => {
    try {
      const endpoint = esGrupo ? "/api/mensajes/grupo/fijar" : "/api/mensajes/fijar";

      const body = esGrupo
        ? {
            grupo_id: mensaje.grupo_id,
            mensaje_id: idOverride,
            usuario_id: miUsuario.id,
            duracion: duracionOverride,
          }
        : {
            mensajeId: idOverride,
            usuarioId: miUsuario.id,
            duracion: duracionOverride,
          };

      logDev("📤 Enviando al backend:", { endpoint, body });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("📩 Respuesta del backend:", data);

      if (res.ok) {
        setEstaFijado(true);
        setShowFijarModal(false);
      } else {
        alert(data.error || "Error al fijar mensaje");
      }
    } catch (err) {
      console.error("❌ Error fijando mensaje:", err);
    }
  };

  // 👉 Desfijar mensaje
  const desFijarMensaje = async () => {
    try {
      const endpoint = esGrupo ? "/api/mensajes/grupo/fijar" : "/api/mensajes/fijar";

      const body = esGrupo
        ? {
            grupo_id: mensaje.grupo_id,
            mensaje_id: id,
            usuario_id: miUsuario.id,
          }
        : {
            mensajeId: id,
            usuarioId: miUsuario.id,
          };

      logDev("📤 Desfijando mensaje:", { endpoint, body });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      logDev("📌 Desfijado:", data);

      if (res.ok) setEstaFijado(false);
    } catch (err) {
      console.error("❌ Error al desfijar:", err);
    }
  };

  // 👉 Confirmar Reemplazo
  const confirmarReemplazo = async () => {
    try {
      const endpointList = esGrupo
        ? `/api/mensajes/grupo/fijados/${mensaje.grupo_id}`
        : `/api/mensajes/fijados?usuario1=${miUsuario.id}&usuario2=${
            mensaje.usuario_envia_id === miUsuario.id
              ? mensaje.usuario_recibe_id
              : mensaje.usuario_envia_id
          }`;

      const resList = await fetch(endpointList);
      const fijadosActuales = await resList.json();

      if (fijadosActuales.length === 0) {
        setShowReplaceModal(false);
        confirmarFijado();
        return;
      }

      const masAntiguo = fijadosActuales.sort(
        (a, b) => new Date(a.fecha_fijado) - new Date(b.fecha_fijado)
      )[0];

      if (esGrupo) {
        await fetch("/api/mensajes/grupo/fijar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grupo_id: mensaje.grupo_id,
            mensaje_id: masAntiguo.mensaje_id,
            usuario_id: miUsuario.id,
          }),
        });
      } else {
        await fetch("/api/mensajes/fijar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mensajeId: masAntiguo.mensaje_id,
            usuarioId: miUsuario.id,
          }),
        });
      }

      await confirmarFijado(
        mensajePendienteFijar?.id,
        mensajePendienteFijar?.duracion
      );
      setShowReplaceModal(false);
    } catch (err) {
      console.error("❌ Error reemplazando mensaje fijado:", err);
    }
  };

  useEffect(() => {
    if (
      (showEmojiPickerReactions || showReactions || dropdownOpen) &&
      messageRef.current
    ) {
      const rect = messageRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      if (rect.top < windowHeight / 2) {
        setOpenDirection("down");
      } else {
        setOpenDirection("up");
      }
    }
  }, [showEmojiPickerReactions, showReactions, dropdownOpen]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        emojiPickerEditRef.current &&
        !emojiPickerEditRef.current.contains(e.target)
      ) {
        setShowEmojiPickerEdit(false);
      }
    }

    if (showEmojiPickerEdit) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPickerEdit]);

  // 🧩 Texto normal con detección de enlaces
  const renderTextoConLinks = (texto = "") => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const partes = texto.split(urlRegex);

    return partes.map((parte, i) =>
      urlRegex.test(parte) ? (
        <a
          key={i}
          href={parte}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--link-color)",
            textDecoration: "underline",
            wordBreak: "break-word",
          }}
        >
          {parte}
        </a>
      ) : (
        <span key={i}>{parte}</span>
      )
    );
  };

  return (
    <div
      id={`mensaje-${id}`} // 👈 importante: para hacer scroll al fijado
      className={`message ${enviadoPorMi ? "message-out" : ""}`}
    >
      {/* Avatar del que envió */}
      <div
        className="avatar avatar-responsive"
        style={{ cursor: "pointer" }}
        onClick={() => onVerPerfil(enviadoPorMi ? miUsuario : usuario)}
      >
        {(enviadoPorMi ? miUsuario?.url_imagen : usuario?.url_imagen) ? (
          <img
            className="avatar-img"
            src={getAvatarUrl(
              enviadoPorMi ? miUsuario.url_imagen : usuario.url_imagen
            )}
            alt={(enviadoPorMi ? miUsuario?.nombre : usuario?.nombre) || "usuario"}
            style={{ width: "44px", height: "44px", objectFit: "cover" }}
          />
        ) : (
          <div
            className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
            style={{
              width: "44px",
              height: "44px",
              backgroundColor: enviadoPorMi
                ? miUsuario?.background || "#6c757d"
                : usuario?.background || "#6c757d",
              fontSize: "18px",
            }}
          >
            {getInitial(
              (enviadoPorMi ? miUsuario?.nombre : usuario?.nombre) || "U"
            )}
          </div>
        )}
      </div>

      <div ref={messageRef} className="message-inner" style={{ position: "relative" }}>
        <div className="message-body">
          {/* Nombre arriba si es grupo */}
          {esGrupo && !enviadoPorMi && (
            <div
              className="fw-bold small text-muted"
              style={{
                marginBottom: "4px",
                marginLeft: "6px",
              }}
            >
              {`${usuario?.nombre || ""} ${usuario?.apellido || ""}`}
            </div>
          )}

          <div className="message-content">
            <div className="message-text">
              {mensajeData.eliminado ? (
                <div className="fst-italic text-muted d-flex align-items-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    className="me-2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6-7h-1V7a5 5 0 0 0-10 0v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-3 0H9V7a3 3 0 0 1 6 0v3Z" />
                  </svg>
                  Se eliminó este mensaje
                </div>
              ) : (
                (() => {
                  // 🧩 0️⃣ Mensaje con varias imágenes + caption
                  if (
                    Array.isArray(mensajeData.imagenes) &&
                    mensajeData.imagenes.length > 0
                  ) {
                    const MAX_VISIBLE = 4;
                    const total = mensajeData.imagenes.length;
                    const visibles = mensajeData.imagenes.slice(0, MAX_VISIBLE);
                    const todasNormalizadas = mensajeData.imagenes.map(
                      normalizarUrlImagen
                    );

                    const esSoloIds =
                      typeof mensajeData.mensaje === "string" &&
                      mensajeData.mensaje.trim() !== "" &&
                      mensajeData.mensaje
                        .split("\n")
                        .every((line) =>
                          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                            line.trim()
                          )
                        );

                    const caption =
                      mensajeData.mensaje && !esSoloIds ? mensajeData.mensaje : "";

                    return (
                      <div className="d-flex flex-column">
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              total === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))",
                            gap: "4px",
                            maxWidth: total === 1 ? "260px" : "240px",
                          }}
                        >
                          {visibles.map((rawUrl, idx) => {
                            let finalUrl = todasNormalizadas[idx];

                            if (finalUrl?.startsWith("http://chatvista.click")) {
                              finalUrl = finalUrl.replace(
                                "http://chatvista.click",
                                "https://chatvista.click"
                              );
                            } else if (finalUrl?.startsWith("http://")) {
                              try {
                                const u = new URL(finalUrl);
                                finalUrl = `https://${u.host}${u.pathname}${u.search}`;
                              } catch (e) {}
                            }

                            const isLastVisible = idx === visibles.length - 1;
                            const showMoreBadge =
                              isLastVisible && total > MAX_VISIBLE;
                            const extraCount = total - MAX_VISIBLE + 1;

                            return (
                              <div
                                key={idx}
                                className="position-relative"
                                style={{
                                  borderRadius: 12,
                                  overflow: "hidden",
                                  cursor: "pointer",
                                }}
                                onClick={() =>
                                  abrirGaleria(todasNormalizadas, idx)
                                }
                              >
                                <img
                                  src={finalUrl}
                                  alt={`imagen-${idx}`}
                                  style={{
                                    width: "100%",
                                    height: total === 1 ? "auto" : 120,
                                    objectFit: "cover",
                                    display: "block",
                                  }}
                                />

                                {showMoreBadge && (
                                  <div
                                    className="d-flex align-items-center justify-content-center"
                                    style={{
                                      position: "absolute",
                                      inset: 0,
                                      backgroundColor: "rgba(0,0,0,0.45)",
                                      color: "#fff",
                                      fontSize: 24,
                                      fontWeight: 600,
                                    }}
                                  >
                                    +{extraCount}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {caption && (
                          <p className="mt-2 break-words whitespace-pre-wrap">
                            {renderTextoConLinks(caption)}
                          </p>
                        )}
                      </div>
                    );
                  }

                  // 🧩 1️⃣ Stickers tipo WhatsApp con modal de detalle
                  if (mensajeData.mensaje?.startsWith("[sticker]")) {
                    const raw = mensajeData.mensaje.replace("[sticker]", "");
                    const stickerUrl = normalizarUrlImagen(raw);

                    // Nombre del sticker sacado del archivo
                    const nombreArchivoSticker = (() => {
                      try {
                        const partes = stickerUrl.split("/");
                        const nombre = partes.pop() || "Sticker";
                        return decodeURIComponent(nombre.replace(/\.\w+$/, ""));
                      } catch {
                        return "Sticker";
                      }
                    })();

                    // Nombre del usuario que lo envió
                    const creadorNombre =
                      `${usuario?.nombre || ""} ${usuario?.apellido || ""}`.trim() ||
                      "Desconocido";

                    const handleFavClick = async (e) => {
                      e.stopPropagation();

                      try {
                        if (esFavLocal) {
                          // Eliminar de favoritos
                          if (onEliminarStickerFavorito) {
                            await onEliminarStickerFavorito(stickerUrl);
                          }
                          setEsFavLocal(false);
                        } else {
                          // Añadir a favoritos
                          if (onGuardarStickerFavorito) {
                            await onGuardarStickerFavorito(stickerUrl);
                          }
                          setEsFavLocal(true);
                        }
                      } catch (err) {
                        console.error("❌ Error al cambiar favorito:", err);
                      }
                    };

                    return (
                      <>
                        {/* Sticker dentro del chat */}
                        <div
                          className="position-relative d-inline-block"
                          style={{
                            borderRadius: 18,
                            overflow: "hidden",
                            backgroundColor: "var(--surface-2)",
                            padding: 6,
                            cursor: "pointer",
                          }}
                          onClick={() => setShowStickerModal(true)} // 👈 al hacer click, abrimos modal
                        >
                          <img
                            src={stickerUrl}
                            alt="sticker"
                            style={{
                              width: 120,
                              height: 120,
                              objectFit: "contain",
                              display: "block",
                            }}
                          />

                          {/* Estrellita pequeña arriba (opcional) */}
                          {esFavLocal && (
                            <span
                              className="position-absolute top-0 end-0 m-1"
                              style={{ fontSize: 16 }}
                            >
                              ⭐
                            </span>
                          )}
                        </div>

                        {/* Modal estilo WhatsApp */}
                        {showStickerModal && (
                          <div
                            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
                            style={{ backgroundColor: "rgba(0,0,0,0.6)", zIndex: 6000 }}
                            onClick={() => setShowStickerModal(false)}
                          >
                            <div
                              className="bg-white rounded-4 shadow p-4 text-center"
                              style={{ maxWidth: "360px", width: "90%" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <img
                                src={stickerUrl}
                                alt={nombreArchivoSticker}
                                style={{
                                  width: 240,
                                  height: 240,
                                  objectFit: "contain",
                                  borderRadius: "24px",
                                }}
                              />

                              {/* 👇 Aquí va exactamente lo que querías */}
                              <div className="mt-3 small text-muted">
                                <strong>{nombreArchivoSticker}</strong> · by {creadorNombre}
                              </div>

                              <button
                                type="button"
                                className={`btn mt-3 ${
                                  esFavLocal ? "btn-outline-danger" : "btn-success"
                                }`}
                                onClick={handleFavClick}
                              >
                                {esFavLocal ? "Eliminar de favoritos" : "Añadir a favoritos"}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  }

                  // 🧩 2️⃣ Archivos / imágenes sueltas
                  let urlArchivo = mensajeData.archivo_url || mensajeData.mensaje;
                  const tipo = mensajeData.tipo_archivo || "";
                  const nombre =
                    mensajeData.nombre_archivo ||
                    urlArchivo?.split("/").pop() ||
                    "archivo";
                  const tamano = mensajeData.tamano || 0;

                  urlArchivo = normalizarUrlImagen(urlArchivo);

                  if (urlArchivo?.startsWith("http://")) {
                    try {
                      const u = new URL(urlArchivo);
                      urlArchivo = `https://${u.host}${u.pathname}${u.search}`;
                    } catch (e) {}
                  }

                  if (urlArchivo) {
                    const esImagen =
                      /\.(jpe?g|png|webp|gif)$/i.test(urlArchivo) ||
                      (tipo && tipo.startsWith("image/"));

                    if (esImagen) {
                      const estado = mensajeData.estado;
                      const progreso = mensajeData.progreso;

                      return (
                        <div
                          style={{
                            position: "relative",
                            display: "inline-block",
                          }}
                        >
                          <img
                            src={urlArchivo}
                            alt={nombre}
                            className="rounded-lg cursor-pointer transition-transform hover:scale-105"
                            style={{
                              maxWidth: "200px",
                              opacity: estado === "subiendo" ? 0.8 : 1,
                            }}
                            onClick={() =>
                              estado !== "subiendo" && abrirGaleria([urlArchivo], 0)
                            }
                          />

                          {estado === "subiendo" && (
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "rgba(0,0,0,0.35)",
                                borderRadius: "12px",
                              }}
                            >
                              <div
                                className="spinner-border text-light"
                                role="status"
                                style={{
                                  width: "28px",
                                  height: "28px",
                                  borderWidth: "3px",
                                }}
                              />
                            </div>
                          )}

                          {estado === "error" && (
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "rgba(0,0,0,0.45)",
                                borderRadius: "12px",
                                color: "#fff",
                                fontSize: "24px",
                                fontWeight: "bold",
                              }}
                            >
                              ×
                            </div>
                          )}
                        </div>
                      );
                    }

                    const esArchivo =
                      !esImagen &&
                      (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|exe|msi|apk)$/i.test(
                        urlArchivo
                      ) ||
                        !!mensajeData.archivo_url ||
                        (!!tipo && !tipo.startsWith("image/")));

                    if (esArchivo) {
                      const nombreLimpio = (nombre || "").replace(/^\d+_/, "");

                      const handleDescargar = async () => {
                        try {
                          const response = await fetch(urlArchivo);
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);

                          const a = document.createElement("a");
                          a.href = url;
                          a.download = nombreLimpio;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                        } catch (error) {
                          console.error("❌ Error al descargar:", error);
                          alert("Error al intentar descargar el archivo.");
                        }
                      };

                      return (
                        <div className="flex items-center gap-2 mt-2">
                          <a
                            onClick={(e) => {
                              e.preventDefault();
                              handleDescargar();
                            }}
                            href={urlArchivo}
                            className="flex items-center justify-center bg-white text-gray-700 border border-gray-300 rounded-full shadow-sm hover:bg-gray-100 transition-all cursor-pointer"
                            style={{
                              width: "28px",
                              height: "28px",
                            }}
                            title={`Descargar ${nombreLimpio}`}
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
                              className="feather feather-download"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </a>

                          <span
                            className="text-sm truncate"
                            style={{ maxWidth: "180px" }}
                          >
                            {nombreLimpio}
                          </span>
                        </div>
                      );
                    }
                  }

                  // 🧩 Texto normal
                  return (
                    <p className="break-words whitespace-pre-wrap">
                      {renderTextoConLinks(mensajeData.mensaje)}
                    </p>
                  );
                })()
              )}

              {/* Footer con hora + acciones pequeñas */}
              <div className="message-footer">
                {mensajeData.eliminado === 1 && isMine && (
                  <button
                    className="btn btn-link btn-sm p-0 text-decoration-none"
                    style={{ fontSize: "10px" }}
                    onClick={() => handleDeshacer(id)}
                  >
                    Deshacer
                  </button>
                )}

                {mensajeData.editado === 1 && (
                  <button
                    type="button"
                    className="btn btn-link p-0 ms-2 btn-sm p-0 text-decoration-none"
                    style={{
                      fontSize: "10px",
                      fontStyle: "italic",
                    }}
                    onClick={() => handleVerHistorial(id)}
                  >
                    Editado
                  </button>
                )}

                <span
                  className="extra-small text-muted mt-1"
                  style={{
                    fontSize: "10px",
                    alignSelf: "flex-end",
                    marginLeft: "4px",
                  }}
                >
                  {hora}
                  {isMine && (
                    <span
                      className="ms-2"
                      style={{ fontSize: "0.65rem", opacity: 0.9 }}
                    >
                      {mensajeData.visto === 0 ? (
                        <span className="svg15 double-check"></span>
                      ) : (
                        <span className="svg15 double-check-blue"></span>
                      )}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Dropdown de acciones */}
            <div className="message-action" ref={dropdownRef}>
              <div className={`dropdown ${dropdownOpen ? "show" : ""}`}>
                <a
                  className="icon text-muted"
                  href="#"
                  role="button"
                  aria-expanded={dropdownOpen ? "true" : "false"}
                  onClick={toggleDropdown}
                >
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
                    className="feather feather-more-vertical"
                  >
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                  </svg>
                </a>

                <ul
                  className={`dropdown-menu ${dropdownOpen ? "show" : ""}`}
                  style={{
                    position: "absolute",
                    ...(openDirection === "up"
                      ? { bottom: "calc(100% + 6px)" }
                      : { top: "calc(100% + 6px)" }),
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 9999,
                  }}
                >
                  <li>
                    <a
                      className="dropdown-item d-flex align-items-center"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowReactions(!showReactions);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="me-auto">Reaccionar</span> 😀
                    </a>
                  </li>

                  {isMine && puedeEditar && (
                    <li>
                      <a
                        className="dropdown-item d-flex align-items-center"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setIsEditing(true);
                          setEditText(mensajeData.mensaje);
                          setDropdownOpen(false);
                        }}
                      >
                        <span className="me-auto">Editar</span>
                        <div className="icon">
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
                            className="feather feather-edit-2"
                          >
                            <path d="M17 3a2.828 2.828 0 0 1 4 4L7 21H3v-4L17 3z"></path>
                          </svg>
                        </div>
                      </a>
                    </li>
                  )}

                  <li>
                    <a className="dropdown-item d-flex align-items-center" href="#">
                      <span className="me-auto">Responder</span>
                      <div className="icon">
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
                          className="feather feather-corner-up-left"
                        >
                          <polyline points="9 14 4 9 9 4"></polyline>
                          <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                        </svg>
                      </div>
                    </a>
                  </li>

                  <li>
                    <a
                      className="dropdown-item d-flex align-items-center"
                      href="#"
                      onClick={(e) => handleFijar(e)}
                    >
                      <span className="me-auto">
                        {estaFijado ? "Desfijar mensaje" : "Fijar mensaje"}
                      </span>
                      <div className="icon">
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
                          className="feather feather-pin"
                          style={{
                            transform: estaFijado ? "rotate(45deg)" : "none",
                            transition: "transform 0.2s ease",
                          }}
                        >
                          <path d="M12 2v7l-2 3v9l2-2 2 2v-9l-2-3V2z" />
                        </svg>
                      </div>
                    </a>
                  </li>

                  {isMine && (
                    <>
                      <li>
                        <hr className="dropdown-divider" />
                      </li>
                      <li>
                        <a
                          className="dropdown-item d-flex align-items-center text-danger"
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            handleEliminar(id);
                            setDropdownOpen(false);
                          }}
                        >
                          <span className="me-auto">Eliminar</span>
                          <div className="icon">
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
                              className="feather feather-trash-2"
                            >
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              <line x1="10" y1="11" x2="10" y2="17"></line>
                              <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                          </div>
                        </a>
                      </li>
                    </>
                  )}

                  {esSticker && onGuardarStickerFavorito && (
                    <li>
                      <a
                        className="dropdown-item d-flex align-items-center"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onGuardarStickerFavorito(stickerUrl);
                          setDropdownOpen(false);
                        }}
                      >
                        <span className="me-auto">Guardar como sticker favorito</span>
                        <span>⭐</span>
                      </a>
                    </li>
                  )}
                </ul>
              </div>

              {/* Menú de reacciones rápidas */}
              {showReactions && (
                <div
                  className="reactions-popover d-flex align-items-center px-2 py-1 bg-white shadow rounded-pill"
                  style={{
                    position: "absolute",
                    ...(openDirection === "up"
                      ? { bottom: "calc(100% + 6px)" }
                      : { top: "calc(100% + 6px)" }),
                    left: "50%",
                    transform: isMine ? "translateX(-65%)" : "translateX(-30%)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    backgroundColor: "var(--surface)",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                    borderRadius: "9999px",
                    padding: "6px 10px",
                    zIndex: 99999,
                    transition: "all 0.2s ease",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex gap-2 mt-1">
                    {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji, idx) => {
                      const esMia = reacciones.some(
                        (r) => r.usuario_id === miUsuario?.id && r.emoji === emoji
                      );

                      return (
                        <span
                          key={idx}
                          onClick={() => handleReaction(emoji)}
                          style={{
                            fontSize: "20px",
                            cursor: "pointer",
                            padding: "4px 6px",
                            borderRadius: "50%",
                            transition: "background 0.2s ease",
                            backgroundColor: esMia ? "#e6e6e6" : "transparent",
                          }}
                        >
                          {emoji}
                        </span>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="plus-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEmojiPickerReactions(true);
                      setShowReactions(false);
                    }}
                    style={{
                      width: "28px",
                      height: "28px",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="12" fill="var(--surface-3)" />
                      <path
                        d="M12 7v10M7 12h10"
                        stroke="var(--text-muted-2)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Picker reacción extra */}
        {showEmojiPickerReactions && (
          <div
            className="emoji-picker"
            style={{
              position: "absolute",
              ...(openDirection === "up"
                ? { bottom: "calc(100% + 8px)" }
                : { top: "calc(100% + 8px)" }),
              left: "50%",
              transform: isMine ? "translateX(-65%)" : "translateX(-30%)",
              zIndex: 9999,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Picker
              data={data}
              onEmojiSelect={(emoji) => handleReaction(emoji.native)}
              theme={emojiTheme}
              previewPosition="none"
              searchPosition="top"
              locale="es"
            />
          </div>
        )}

        {/* Reacciones agrupadas */}
        {reacciones.length > 0 && (
          <div
            className="d-flex flex-row flex-wrap px-2 py-1 bg-light rounded-pill border"
            style={{
              fontSize: "10px",
              lineHeight: 1,
              cursor: "pointer",
              marginTop: "-5px",
              alignSelf: "flex-start",
            }}
            onClick={() => {
              setSelectedEmoji("ALL");
              setShowReactionModal(true);
            }}
          >
            {Object.keys(
              reacciones.reduce((acc, r) => {
                acc[r.emoji] = true;
                return acc;
              }, {})
            ).map((emoji, i) => (
              <span key={i} style={{ marginRight: "2px" }}>
                {emoji}
              </span>
            ))}

            <span className="ms-1 fw-bold">{reacciones.length}</span>
          </div>
        )}

        {/* Modal detalle reacciones */}
        {showReactionModal && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 3000 }}
            onClick={() => setShowReactionModal(false)}
          >
            <div
              className="bg-white rounded-4 shadow p-3"
              style={{ maxWidth: "420px", width: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="d-flex border-bottom mb-3">
                <div
                  onClick={() => setSelectedEmoji("ALL")}
                  className={`me-3 pb-2 ${
                    selectedEmoji === "ALL"
                      ? "border-bottom border-success fw-bold"
                      : "text-muted"
                  }`}
                  style={{ cursor: "pointer" }}
                >
                  Total {reacciones.length}
                </div>

                {Object.values(
                  reacciones.reduce((acc, r) => {
                    if (!acc[r.emoji]) {
                      acc[r.emoji] = { emoji: r.emoji, count: 0 };
                    }
                    acc[r.emoji].count += 1;
                    return acc;
                  }, {})
                ).map((item, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedEmoji(item.emoji)}
                    className={`me-3 pb-2 ${
                      selectedEmoji === item.emoji
                        ? "border-bottom border-success fw-bold"
                        : "text-muted"
                    }`}
                    style={{ cursor: "pointer" }}
                  >
                    {item.emoji} {item.count > 1 && item.count}
                  </div>
                ))}
              </div>

              <ul className="list-unstyled m-0">
                {reacciones
                  .filter(
                    (r) => selectedEmoji === "ALL" || r.emoji === selectedEmoji
                  )
                  .map((r, idx) => {
                    const isMineReaction = r.usuario_id === miUsuario?.id;
                    const avatarUrl = r.usuario?.url_imagen;
                    const bgColor = r.usuario?.background || "#6c757d";
                    const nombre = r.usuario?.nombre || "Usuario";

                    return (
                      <li
                        key={idx}
                        className="d-flex align-items-center justify-content-between mb-2 p-2 rounded hover-bg-light"
                      >
                        <div
                          className="d-flex align-items-center"
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            if (!isMineReaction) {
                              onVerPerfil(r.usuario);
                              setShowReactionModal(false);
                            }
                          }}
                        >
                          {avatarUrl ? (
                            <img
                              src={getAvatarUrl(avatarUrl)}
                              alt={nombre}
                              className="rounded-circle me-2"
                              style={{
                                width: "36px",
                                height: "36px",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <div
                              className="rounded-circle text-white d-flex align-items-center justify-content-center me-2 fw-bold"
                              style={{
                                width: "36px",
                                height: "36px",
                                backgroundColor: bgColor,
                                fontSize: "14px",
                              }}
                            >
                              {nombre.charAt(0).toUpperCase()}
                            </div>
                          )}

                          <div>
                            <div
                              className="fw-bold"
                              style={{ fontSize: "14px" }}
                            >
                              {isMineReaction
                                ? "Tú"
                                : `${r.usuario?.nombre || ""} ${
                                    r.usuario?.apellido || ""
                                  }`}
                            </div>
                            {isMineReaction && (
                              <div
                                className="text-muted"
                                style={{ fontSize: "12px" }}
                              >
                                Haz clic en el emoji para eliminarla
                              </div>
                            )}
                          </div>
                        </div>

                        <span
                          style={{ fontSize: "22px", cursor: "pointer" }}
                          onClick={() => handleReaction(r.emoji)}
                        >
                          {r.emoji}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          </div>
        )}

        {/* Modal de fijar mensaje */}
        {showFijarModal && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 5000 }}
            onClick={() => setShowFijarModal(false)}
          >
            <div
              className="bg-white rounded-4 shadow p-4"
              style={{ maxWidth: "360px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h6 className="fw-bold mb-3 text-center">Fijar mensaje</h6>
              <p className="text-muted small mb-4 text-center">
                Elige por cuánto tiempo quieres mantener este mensaje fijado.
              </p>

              <div className="d-flex flex-column gap-2 mb-4">
                {[
                  { value: "24h", label: "24 horas" },
                  { value: "7d", label: "7 días" },
                  { value: "30d", label: "30 días" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`border rounded-3 p-2 d-flex align-items-center justify-content-between ${
                      duracionFijado === opt.value ? "border-success bg-light" : ""
                    }`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDuracionFijado(opt.value)}
                  >
                    <span>{opt.label}</span>
                    {duracionFijado === opt.value && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="green"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="feather feather-check"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    )}
                  </label>
                ))}
              </div>

              <div className="d-flex justify-content-between">
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => setShowFijarModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => confirmarFijado()}
                >
                  Fijar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de reemplazo */}
        {showReplaceModal && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 5000 }}
            onClick={() => setShowReplaceModal(false)}
          >
            <div
              className="bg-white rounded-4 shadow p-4 text-center"
              style={{ maxWidth: "360px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h6 className="fw-bold mb-3">
                ¿Deseas reemplazar el mensaje fijado más antiguo?
              </h6>
              <p className="text-muted small mb-4">
                Tu nuevo mensaje fijado reemplazará al más antiguo.
              </p>

              <div className="d-flex justify-content-between">
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => setShowReplaceModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => confirmarReemplazo()}
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de editar */}
        {isEditing && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 4000 }}
          >
            <div
              className="bg-white rounded-4 shadow p-3 d-flex flex-column"
              style={{ maxWidth: "500px", width: "100%" }}
            >
              <div className="d-flex align-items-center mb-3">
                <button
                  className="btn btn-link p-0 me-2"
                  onClick={() => setIsEditing(false)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="feather feather-x"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <h6 className="m-0">Edita el mensaje</h6>
              </div>

              <div
                className="p-2 mb-3"
                style={{
                  background: "#2787F5",
                  borderRadius: "10px",
                  maxWidth: "80%",
                  alignSelf: "flex-end",
                }}
              >
                <div style={{ color: "#ffffffff" }}>
                  <span>{mensajeData.mensaje}</span>
                </div>
                <div
                  className="d-flex justify-content-end align-items-center"
                  style={{ fontSize: "0.5rem", color: "#ffffffff" }}
                >
                  {hora}{" "}
                  <span className="me-2">
                    {mensajeData.visto === 0 ? (
                      <span className="svg15 double-check"></span>
                    ) : (
                      <span className="svg15 double-check-blue"></span>
                    )}
                  </span>
                </div>
              </div>

              <div className="d-flex align-items-end gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-light p-2 d-flex align-items-center justify-content-center"
                  onClick={() =>
                    setShowEmojiPickerEdit(!showEmojiPickerEdit)
                  }
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="feather feather-smile"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                    <line x1="9" y1="9" x2="9.01" y2="9"></line>
                    <line x1="15" y1="9" x2="15.01" y2="9"></line>
                  </svg>
                </button>

                {showEmojiPickerEdit && (
                  <div
                    ref={emojiPickerEditRef}
                    style={{
                      position: "absolute",
                      bottom: "130px",
                      left: "420px",
                      zIndex: 9999,
                    }}
                  >
                    <Picker
                      data={data}
                      onEmojiSelect={(emoji) =>
                        setEditText((prev) => prev + emoji.native)
                      }
                      theme={emojiTheme}
                      previewPosition="none"
                      searchPosition="top"
                      locale="es"
                    />
                  </div>
                )}

                <textarea
                  className="form-control flex-grow-1"
                  style={{
                    resize: "none",
                    minHeight: "40px",
                    maxHeight: "100px",
                    overflowY: "auto",
                  }}
                  rows="1"
                  value={editText}
                  onChange={(e) => {
                    setEditText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(
                      e.target.scrollHeight,
                      100
                    )}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleEditar(id, editText);
                    }
                  }}
                />

                <button
                  type="button"
                  className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{
                    width: "57px",
                    height: "44px",
                    padding: "0",
                    borderRadius: "150%",
                    backgroundColor: "#25D366",
                    border: "none",
                    transition:
                      "background-color 0.2s ease-in-out, transform 0.15s",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                  }}
                  onClick={() => handleEditar(id, editText)}
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
                    style={{
                      width: "50%",
                      height: "50%",
                    }}
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal historial de ediciones */}
        {showHistorial && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 5000 }}
            onClick={() => setShowHistorial(false)}
          >
            <div
              className="bg-white rounded-4 shadow p-3"
              style={{ maxWidth: "420px", width: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="d-flex align-items-center mb-3">
                <button
                  className="btn btn-link p-0 me-2"
                  onClick={() => setShowHistorial(false)}
                >
                  ←
                </button>
                <h6 className="m-0">Historial de ediciones</h6>
              </div>

              {historial.length === 0 ? (
                <p className="text-muted text-center">
                  No hay ediciones registradas.
                </p>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {historial.map((h, index) => {
                    const hora = formatChatTimeOnly(h.fecha);
                    const fecha = formatChatDate(h.fecha);
                    const background = isMine ? "#2787f5" : "#f6f9fb";
                    const color = isMine ? "#fff" : "#95aac9";

                    return (
                      <div key={h.id} className="d-flex flex-column">
                        {index === 0 ||
                        formatChatDate(historial[index - 1].fecha) !== fecha ? (
                          <div className="date-sticky-wrapper text-center my-2">
                            <span
                              className="date-chip px-2 py-1 rounded-pill"
                              style={{
                                background: "#e9ecef",
                                fontSize: "0.75rem",
                                color: "#6c757d",
                              }}
                            >
                              {fecha}
                            </span>
                          </div>
                        ) : null}

                        <div
                          className="p-2"
                          style={{
                            background,
                            borderRadius: "10px",
                            maxWidth: "80%",
                            alignSelf: isMine ? "flex-end" : "flex-start",
                            color,
                          }}
                        >
                          <div>{h.texto_original}</div>

                          <div
                            className="d-flex justify-content-end align-items-center"
                            style={{ fontSize: "0.65rem", opacity: 0.9 }}
                          >
                            {hora}
                            <span className="ms-2">
                              {h.visto === 0 ? (
                                <span className="svg15 double-check"></span>
                              ) : (
                                <span className="svg15 double-check-blue"></span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Galería tipo WhatsApp */}
        {galeriaAbierta && galeriaImagenes.length > 0 && (
          <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
            style={{
              backgroundColor: "rgba(0,0,0,0.9)",
              zIndex: 9999,
              cursor: "zoom-out",
            }}
            onClick={() => setGaleriaAbierta(false)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGaleriaAbierta(false);
              }}
              className="btn btn-link text-white position-absolute top-0 start-0 m-3"
              style={{ fontSize: 24 }}
            >
              ✕
            </button>

            {galeriaImagenes.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setGaleriaIndice((prev) =>
                    prev - 1 < 0 ? galeriaImagenes.length - 1 : prev - 1
                  );
                }}
                className="btn btn-link text-white position-absolute start-0 ms-3"
                style={{ fontSize: 40 }}
              >
                ‹
              </button>
            )}

            <img
              src={galeriaImagenes[galeriaIndice]}
              alt="vista ampliada"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "90%",
                maxHeight: "90%",
                borderRadius: "12px",
                boxShadow: "0 0 20px rgba(0,0,0,0.6)",
              }}
            />

            {galeriaImagenes.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setGaleriaIndice((prev) =>
                    (prev + 1) % galeriaImagenes.length
                  );
                }}
                className="btn btn-link text-white position-absolute end-0 me-3"
                style={{ fontSize: 40 }}
              >
                ›
              </button>
            )}

            {galeriaImagenes.length > 1 && (
              <div
                className="position-absolute bottom-0 mb-3 px-3 py-1 rounded-pill text-white"
                style={{
                  backgroundColor: "rgba(0,0,0,0.5)",
                  fontSize: 12,
                }}
              >
                {galeriaIndice + 1} / {galeriaImagenes.length}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;