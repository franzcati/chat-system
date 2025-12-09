import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import ChatBody from "../components/ChatBody";
import MiembrosGrupos from "../components/MiembrosGrupos";
import VerInfoGrupo from "../components/VerInfoGrupo";
import VerArchivos from "../components/VerArchivos";
import ProfileModal from "../components/ProfileModal";
import socket from "../socket";
import * as bootstrap from "bootstrap";
import { logDev } from "../utils/logger";
import { getAvatarUrl } from "../utils/url";
import ChatInput from "../components/ChatInput";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import "../css/emoji.css";


const ChatBox = ({ chat, user, setChat, onVerPerfil }) => {

  const [messages, setMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false); // 👈 control del picker
  const [offcanvasGrupo, setOffcanvasGrupo] = useState(null);
  const [mostrarInfoGrupo, setMostrarInfoGrupo] = useState(false);
  const [mostrarVerArchivos, setMostrarVerArchivos] = useState(false);
  // 👇 referencia al último mensaje
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null); // ref para el ChatInput optimizado
  // arriba de tu componente
  const emojiRef = useRef(null);   // ref para el contenedor del picker
  const emojiBtnRef = useRef(null); // ref para el botón
  const gifRef = useRef(null);   // ref para el contenedor del picker
  const gifBtnRef = useRef(null); // ref para el botón
  const stickerRef = useRef(null);   // ref para el contenedor del picker
  const stickerBtnRef = useRef(null); // ref para el botón
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState(""); // texto a buscar
  const [gifResults, setGifResults] = useState([]); // resultados de la API
  // STICKER
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [stickers, setStickers] = useState([
    // stickers predeterminados (puedes reemplazar con tus URLs)
    "../assets/stickers/chanclaso.png",
    "../assets/stickers/perro.png",
  ]);

  

  // 👇 Nueva función para agregar mensaje de grupo al estado (reutilizable)
  const agregarMensajeGrupo = (msg) => {
    if (!chat || !user) return;
    if (msg.grupo_id !== chat.grupo_id) return;

    const tipoMensaje = msg.usuario_id === user.id ? "enviado" : "recibido";
    const mensajeTransformado = {
      ...msg,
      tipo_mensaje: tipoMensaje,
      visto: 0,
    };

    setMessages(prev => {
      const mapPrev = new Map(prev.map(m => [m.id, m]));
      const mensajePrev = mapPrev.get(msg.id);
      return [
        ...prev,
        {
          ...mensajeTransformado,
          reacciones: mensajePrev?.reacciones || mensajeTransformado.reacciones || [],
        }
      ];
    });
  };

  // 👇 cada vez que cambien los mensajes, hacemos scroll al final
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 🔹 Cargar historial y mensajes fijados cuando cambia el chat
  useEffect(() => {
    if (!chat || !user) return;

    const cargarMensajes = async () => {
      try {
        let resMensajes;

        if (chat.tipo === "grupo") {
          // ✅ Un solo endpoint ahora devuelve ambos: mensajes y fijados
          resMensajes = await axios.get(`/api/mensajes/grupo/${chat.grupo_id}`);
        } else {
          // 🔹 Chats privados (mantiene dos endpoints)
          const [resPrivados, resFijadosPrivados] = await Promise.all([
            axios.get("/api/mensajes", {
              params: { usuario1: user.id, usuario2: chat.usuario_id },
            }),
            axios.get("/api/mensajes/fijados", {
              params: { usuario1: user.id, usuario2: chat.usuario_id },
            }),
          ]);

          // Combinar igual que en grupo
          const nuevosMensajes = Array.isArray(resPrivados.data)
            ? resPrivados.data
            : Array.isArray(resPrivados.data.mensajes)
              ? resPrivados.data.mensajes
              : [];

          const mensajesFijados = Array.isArray(resFijadosPrivados.data)
            ? resFijadosPrivados.data
            : Array.isArray(resFijadosPrivados.data.mensajes_fijados)
              ? resFijadosPrivados.data.mensajes_fijados
              : [];

          combinarMensajes(nuevosMensajes, mensajesFijados);
          return;
        }

        // 📦 Para grupos
        const nuevosMensajes = Array.isArray(resMensajes.data)
          ? resMensajes.data
          : Array.isArray(resMensajes.data.mensajes)
            ? resMensajes.data.mensajes
            : [];

        const mensajesFijados = Array.isArray(resMensajes.data.mensajes_fijados)
          ? resMensajes.data.mensajes_fijados
          : [];

        console.log("📨 Mensajes cargados:", nuevosMensajes);
        console.log("📌 Fijados cargados:", mensajesFijados);

        combinarMensajes(nuevosMensajes, mensajesFijados);
      } catch (err) {
        console.error("❌ Error cargando historial o fijados:", err);
      }
    };

    const combinarMensajes = (nuevosMensajes, mensajesFijados) => {
      // 🔹 Marca los mensajes fijados dentro del array principal
      const mensajesCombinados = nuevosMensajes.map((m) => {
        const estaFijado = mensajesFijados.some((f) => f.mensaje_id === m.id);
        return {
          ...m,
          fijado: estaFijado ? 1 : 0,
          fecha_fijado: estaFijado
            ? mensajesFijados.find((f) => f.mensaje_id === m.id)?.fecha_fijado
            : null,
        };
      });

      // 🔹 Mergear reacciones previas para no perderlas
      setMessages((prev) => {
        const mapPrev = new Map(prev.map((m) => [m.id, m]));
        return mensajesCombinados.map((m) => ({
          ...m,
          reacciones: mapPrev.get(m.id)?.reacciones || m.reacciones || [],
        }));
      });

      console.log("✅ Mensajes combinados:", mensajesCombinados);
    };

    cargarMensajes();
  }, [chat, user]);

  // Escuchar nuevos mensajes en tiempo real
  useEffect(() => {
    if (!chat || !user) return;

    if (chat.tipo === "grupo") {
      // 👉 Unirse al grupo en socket.io
      socket.emit("joinGrupo", chat.grupo_id);

      // Nuevo mensaje de grupo
      const handleNuevoMensajeGrupo = agregarMensajeGrupo;

      // Todos los miembros vieron hasta cierto mensaje
      const handleTodosMensajesVistosGrupo = ({ grupoId, mensajeId }) => {
        if (grupoId !== chat.grupo_id) return;
        setMessages(prev =>
          prev.map(msg =>
            msg.id <= mensajeId && msg.grupo_id === grupoId
              ? { ...msg, visto: 1 }
              : msg
          )
        );
      };

      const handleMensajeEliminadoGrupo = ({ id }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, eliminado: 1 } : m
          )
        );
      };

      const handleMensajeDeshechoGrupo = (msg) => {
        setMessages(prev =>
          prev.map(m => (m.id === msg.id ? { ...m, ...msg, eliminado: 0 } : m))
        );
      };

      // 👇 Nuevo: mensaje editado en grupo
      const handleMensajeEditadoGrupo = (msg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, ...msg } : m
          )
        );
      };

      // dentro del useEffect en ChatBox (donde registras otros listeners)
      const handleReaccionGrupo = ({ mensajeGrupoId, usuarioId, emoji, accion, usuario }) => {
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== mensajeGrupoId) return m;

            if (accion === "agregada") {
              // evitar duplicados
              const ya = (m.reacciones || []).some(r => r.usuario_id === usuarioId && r.emoji === emoji);
              if (ya) return m;
              return {
                ...m,
                reacciones: [
                  ...(m.reacciones || []),
                  { mensaje_id: mensajeGrupoId, usuario_id: usuarioId, emoji, usuario }
                ],
              };
            } else {
              // eliminada
              return {
                ...m,
                reacciones: (m.reacciones || []).filter(
                  r => !(r.usuario_id === usuarioId && r.emoji === emoji)
                ),
              };
            }
          })
        );
      };

      // 📌 Escuchar mensajes fijados en grupo
      // 🧩 NUEVO: fijar y desfijar en tiempo real
      const handleMensajeFijadoGrupo = (data) => {
        const {
          accion,
          grupo_id,
          mensaje_id,
          usuario_id,
          usuario,
          mensaje,
          fecha_fijado,
          fecha_expiracion,
          duracion,
        } = data;

        if (grupo_id !== chat.grupo_id) return;

        console.log("📌 [SOCKET] mensajeFijadoGrupo recibido:", data);

        // ✅ Actualizar mensajes del chat
        setMessages((prev) =>
          prev.map((m) =>
            m.id === mensaje_id
              ? { ...m, fijado: accion === "fijado" ? 1 : 0, fecha_fijado }
              : m
          )
        );

        // ✅ Actualizar los fijados visuales (máx 3)
        setPinnedMessages((prev) => {
          if (accion === "fijado") {
            // evitar duplicados
            const yaExiste = prev.some((f) => f.mensaje_id === mensaje_id);
            if (yaExiste) return prev;

            const nuevo = {
              id: mensaje_id,
              grupo_id,
              mensaje_id,
              usuario_id,
              mensaje: mensaje.mensaje,
              fijado_por: usuario,
              fecha_fijado,
              duracion,
              fecha_expiracion,
            };

            // límite de 3
            const nuevos = [...prev, nuevo];
            return nuevos.slice(-3);
          } else {
            // eliminar si fue desfijado
            return prev.filter((f) => f.mensaje_id !== mensaje_id);
          }
        });
      };

      // 🔹 Grupo actualizado (nombre o descripción)
      const handleGrupoActualizado = (data) => {
        if (Number(data.id) !== chat.grupo_id) return;
        console.log("📢 [SOCKET] Grupo actualizado:", data);
        setChat((prev) => ({
          ...prev,
          ...(data.nombre && { usuario_nombre: data.nombre }),
          ...(data.descripcion && { descripcion: data.descripcion }),
        }));
      };

      // 🟢 Nuevo: privacidad actualizada
      const handlePrivacidadActualizada = (data) => {
        if (Number(data.id) !== chat.grupo_id) return;

        console.log("🔐 [SOCKET] Privacidad actualizada:", data);

        setChat((prev) => ({
          ...prev,
          privacidad: data.privacidad,
        }));
      };

      // 🧩 Nuevo: miembros actualizados en tiempo real
      const handleMiembrosActualizados = (data) => {
        if (Number(data.id) !== chat.grupo_id) return;

        console.log("👥 [SOCKET] Miembros actualizados:", data);

        setChat((prev) => ({
          ...prev,
          miembros: data.miembros,
        }));
      };

      socket.on("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
      socket.on("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
      socket.on("mensajeEliminadoGrupo", handleMensajeEliminadoGrupo);
      socket.on("mensajeDeshechoGrupo", handleMensajeDeshechoGrupo);
      socket.on("mensajeEditadoGrupo", handleMensajeEditadoGrupo);
      socket.on("reaccionActualizadaGrupo", handleReaccionGrupo);
      socket.on("mensajeFijadoGrupo", handleMensajeFijadoGrupo);
      socket.on("grupoActualizado", handleGrupoActualizado);
      socket.on("privacidadActualizada", handlePrivacidadActualizada);
      socket.on("miembrosActualizados", handleMiembrosActualizados);

      return () => {
        socket.emit("leaveGrupo", chat.grupo_id);
        socket.off("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
        socket.off("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
        socket.off("mensajeEliminadoGrupo", handleMensajeEliminadoGrupo);
        socket.off("mensajeDeshechoGrupo", handleMensajeDeshechoGrupo);
        socket.off("mensajeEditadoGrupo", handleMensajeEditadoGrupo);
        socket.off("reaccionActualizadaGrupo", handleReaccionGrupo);
        socket.off("mensajeFijadoGrupo", handleMensajeFijadoGrupo);
        socket.off("grupoActualizado", handleGrupoActualizado);
        socket.off("privacidadActualizada", handlePrivacidadActualizada);
        socket.off("miembrosActualizados", handleMiembrosActualizados);
      };
    } else {
      // Chat individual
      const handleNuevoMensaje = (msg) => {
        if (
          (msg.usuario_envia_id === chat.usuario_id && msg.usuario_recibe_id === user.id) ||
          (msg.usuario_envia_id === user.id && msg.usuario_recibe_id === chat.usuario_id)
        ) {
          setMessages(prev => {
            // 🔹 Verificar si el mensaje ya existía (por si hubo reacciones)
            const mapPrev = new Map(prev.map(m => [m.id, m]));
            const mensajePrev = mapPrev.get(msg.id);
            return [
              ...prev,
              {
                ...msg,
                reacciones: mensajePrev?.reacciones || msg.reacciones || [],
              }
            ];
          });
        }
      };

      const handleMensajeEliminado = ({ id }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, eliminado: 1 } : m
          )
        );
      };

      const handleMensajeDeshecho = (msg) => {
        setMessages(prev =>
          prev.map(m => (m.id === msg.id ? { ...m, ...msg, eliminado: 0 } : m))
        );
      };

      // 👇 Nuevo: mensaje editado en chat privado
      const handleMensajeEditado = ({ id, mensaje, editado }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, mensaje, editado } : m
          )
        );
      };

      // 👇 AÑADE ESTO
      const handleMensajeFijado = ({ accion, mensajeId, usuarioId, usuario, mensaje, fecha_fijado }) => {
        console.log("📌 [SOCKET] Evento mensajeFijado recibido:", { accion, mensajeId });
        setMessages(prev =>
          prev.map(m =>
            m.id === mensajeId
              ? { ...m, fijado: accion === "fijado" ? 1 : 0, fecha_fijado }
              : m
          )
        );
      };

      // 👇 Nuevo: manejar cuando ambos han visto los mensajes
      const handleMensajesVistos = ({ emisorId, receptorId }) => {
        // Solo si el evento corresponde a este chat actual
        if (
          (chat.usuario_id === emisorId && user.id === receptorId) ||
          (chat.usuario_id === receptorId && user.id === emisorId)
        ) {
          console.log("🔹 Evento MENSAJES VISTOS recibido:", { emisorId, receptorId });

          setMessages(prev =>
            prev.map(m =>
              m.usuario_envia_id === emisorId && m.usuario_recibe_id === receptorId
                ? { ...m, visto: 1 }
                : m
            )
          );
        }
      };

      // Chat individual
      const handleReaccionActualizada = ({ mensajeId, usuarioId, emoji, accion, usuario }) => {
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== mensajeId) return m;

            let nuevasReacciones = [...m.reacciones];

            if (accion === "agregada") {
              nuevasReacciones.push({ mensaje_id: mensajeId, usuario_id: usuarioId, emoji, usuario });
            } else if (accion === "eliminada") {
              nuevasReacciones = nuevasReacciones.filter(
                r => !(r.usuario_id === usuarioId && r.emoji === emoji)
              );
            }

            return { ...m, reacciones: nuevasReacciones };
          })
        );
      };

      socket.on("nuevoMensaje", handleNuevoMensaje);
      socket.on("mensajeEliminado", handleMensajeEliminado);
      socket.on("mensajeDeshecho", handleMensajeDeshecho);
      socket.on("mensajeEditado", handleMensajeEditado);
      socket.on("mensajeFijado", handleMensajeFijado); // 👈 AQUÍ
      socket.on("mensajesVistos", handleMensajesVistos); // 👈 nuevo
      socket.on("reaccionActualizada", handleReaccionActualizada);
      return () => {
        socket.off("nuevoMensaje", handleNuevoMensaje);
        socket.off("mensajeEliminado", handleMensajeEliminado);
        socket.off("mensajeDeshecho", handleMensajeDeshecho);
        socket.off("mensajeEditado", handleMensajeEditado);
        socket.off("mensajeFijado", handleMensajeFijado); // 👈 LIMPIEZA
        socket.off("mensajesVistos", handleMensajesVistos); // 👈 nuevo
        socket.off("reaccionActualizada", handleReaccionActualizada);
      };
    }
  }, [chat, user, setChat]);
  
  // cerrar al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        emojiRef.current &&
        !emojiRef.current.contains(e.target) && // si el click NO está dentro del picker
        emojiBtnRef.current &&
        !emojiBtnRef.current.contains(e.target) // y tampoco dentro del botón

      ) {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (

        gifRef.current &&
        !gifRef.current.contains(e.target) && // si el click NO está dentro del picker
        gifBtnRef.current &&
        !gifBtnRef.current.contains(e.target) // y tampoco dentro del botón

      ) {
        setShowGifPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (

        stickerRef.current &&
        !stickerRef.current.contains(e.target) && // si el click NO está dentro del picker
        stickerBtnRef.current &&
        !stickerBtnRef.current.contains(e.target) // y tampoco dentro del botón

      ) {
        setShowStickerPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);
  
  // cerrar con ESC
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        setShowEmojiPicker(false);
        setShowGifPicker(false);
        setShowStickerPicker(false);
      }
    };

    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);
  // Función para enviar mensaje
  const handleSendMessage = async (messageText) => {
    if (!messageText.trim()) return;
    console.log("📝 Enviando mensaje:", { chat, user, messageText });
    try {
      if (chat.tipo === "grupo") {
        // 🔹 Grupo
        await axios.post("/api/mensajes/grupo", {
          grupoId: chat.grupo_id,
          usuarioId: user.id,
          mensaje: messageText,
        });
      } else {
        // 🔹 Privado
        await axios.post("/api/mensajes", {
          senderId: user.id,
          receiverId: chat.usuario_id,
          message: messageText,
        });
      }
      inputRef.current?.reset();
    } catch (err) {
      console.error("❌ Error enviando mensaje:", err);
    }
  };

  // 👇 handler cuando clickeas un emoji
  const handleEmojiClick = (emojiData) => {
    inputRef.current?.insertEmoji(emojiData.emoji);
  };

  const fetchGifs = async (query) => {
    if (!query.trim()) return;
    try {
      const res = await axios.get("https://api.giphy.com/v1/gifs/search", {
        params: {
          api_key: "eYpoeaOCfdA8NSzbqDSoFsA3xrqDxwZR",
          q: query,
          limit: 20,
          rating: "pg",
        },
      });
      console.log("Giphy response:", res.data); // para depurar
      setGifResults(res.data.data);
    } catch (err) {
      console.error("❌ Error buscando GIFs:", err);
    }
  };

  const fetchTrendingGifs = async () => {
    try {
      const res = await axios.get("https://api.giphy.com/v1/gifs/trending", {
        params: {
          api_key: "eYpoeaOCfdA8NSzbqDSoFsA3xrqDxwZR",
          limit: 20,
          rating: "pg",
        },
      });
      setGifResults(res.data.data);
    } catch (err) {
      console.error("❌ Error cargando GIFs trending:", err);
    }
  };

  // 👇 Subir Sticker
  const handleStickerUpload = (file) => {
    if (!file) return;

    const url = URL.createObjectURL(file); // temporal, cambia por URL del servidor si lo subes a backend

    // agregar al catálogo
    setStickers((prev) => [url, ...prev]);

    // enviar mensaje
    handleSendMessage(`[sticker]${url}`);
    setShowStickerPicker(false);
  };

  // 👉 Función para sacar inicial (si no hay avatar)
  const getInitial = (text) => {
    if (!text) return "U";
      return text.charAt(0).toUpperCase();
  };

  // 👉 Scroll hasta el mensaje fijado en el cuerpo del chat
  const scrollToMessage = (mensajeId) => {
    const elemento = document.getElementById(`mensaje-${mensajeId}`);
    if (elemento) {
      elemento.scrollIntoView({ behavior: "smooth", block: "center" });
      elemento.classList.add("highlight-pinned");
      setTimeout(() => elemento.classList.remove("highlight-pinned"), 1500);
    }
  };

  const handleArchivoSeleccionado = async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;

    if (archivo.size > 70 * 1024 * 1024) {
      alert("⚠️ El archivo supera los 70 MB permitidos.");
      return;
    }

    const formData = new FormData();
    formData.append("archivo", archivo);

    try {
      let res;

      if (chat.tipo === "grupo") {
        // 🔹 Subida para grupo
        res = await axios.post(
          `/api/mensajes/grupo/archivo?grupo_id=${chat.grupo_id}&usuario_id=${user.id}`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" } }
        );
      } else {
        // 🔹 Subida para chat individual
        res = await axios.post(
          `/api/mensajes/archivo?sender_id=${user.id}&receiver_id=${chat.usuario_id}`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" } }
        );
      }

      console.log("📁 Archivo subido:", res.data);

      if (res.data.success && res.data.mensaje) {
        const archivoMsg = `${res.data.mensaje.archivo_url}`;
        await handleSendMessage(archivoMsg);
      }
    } catch (err) {
      console.error("❌ Error subiendo archivo:", err);
      alert("Error al subir archivo");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <main className="main is-visible" data-dropzone-area="">
      <div className="container h-100">
        <div 
          className={`d-flex flex-column h-100 position-relativetransition-all duration-300 ${
            mostrarInfoGrupo ? "mr-80 md:mr-96" : "mr-0"
          }`}
        >
          {/* Header del chat */}
          <div className="chat-header border-bottom py-4 py-lg-7">
            <div className="row align-items-center">
              {/* Mobile: close */}
              <div className="col-2 d-xl-none">
                <a
                  className="icon icon-lg text-muted"
                  href="#"
                  onClick={() => onCloseChat()}
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
                    className="feather feather-chevron-left"
                  >
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </a>
              </div>
              {/* Mobile: close */}

              {/* Content */}
              <div className="col-8 col-xl-12">
                <div className="row align-items-center text-center text-xl-start">
                  {/* Title */}
                  <div className="col-12 col-xl-6">
                    <div className="row align-items-center gx-5">
                      <div className="col-auto">
                        {chat.tipo === "grupo" ? (
                        <>
                          <div 
                            className="d-flex align-items-center cursor-pointer"
                            onClick={() => setMostrarInfoGrupo(true)} // 👈 al hacer clic abrimos la info
                          >
                            {/* Avatar o icono del grupo */}
                            <div className="avatar me-3">
                              {chat.imagen_url ? (
                                <img
                                  src={chat.imagen_url}
                                  alt={chat.usuario_nombre}
                                  className="avatar-img rounded-circle"
                                  style={{ width: "44px", height: "44px", objectFit: "cover" }}
                                />
                              ) : (
                                <div
                                  className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                  style={{ width: "44px", height: "44px", backgroundColor: "#6c757d" }}
                                >
                                  {chat.usuario_nombre?.charAt(0).toUpperCase() || "?"}
                                </div>
                              )}
                            </div>

                            {/* Nombre + info */}
                            <div className="col overflow-hidden">
                              <h5 className="text-truncate">
                                {chat.usuario_nombre || "?"}
                              </h5>

                              <div className="d-flex flex-column">
                                <h6 className="mb-0 fw-bold">{chat.nombre}</h6>
                                <small className="text-muted">
                                  {chat.miembros?.length || 0} miembros, {chat.online || 0} online
                                </small>
                              </div>
                            </div>
                          </div>
                          {/* 🔹 Sidebar deslizante */}

                          

                          {/* Avatares de miembros */}

                        </>
                        ) : (
                        <>
                          <div className="d-flex align-items-center">
                            <div className="avatar d-none d-xl-inline-block me-3">
                              {chat?.url_imagen ? (
                                <img
                                  src={getAvatarUrl(chat.url_imagen)}
                                  alt={chat.usuario_nombre}
                                  className="avatar-img"
                                  style={{
                                    width: "44px",
                                    height: "44px",
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <div
                                  className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                  style={{
                                    width: "44px",
                                    height: "44px",
                                    backgroundColor: chat?.background || "#6c757d",
                                    fontSize: "18px",
                                  }}
                                >
                                  {getInitial(chat?.usuario_nombre || "U")}
                                </div>
                              )}
                            </div>
                            <div className="col overflow-hidden">
                              <h5 className="text-truncate">
                                {chat.usuario_nombre}
                              </h5>

                              <p className="text-truncate">
                                {/*
                                <span className="text-truncate">
                                  Escribiendo
                                  <span className="typing-dots">
                                    <span>.</span>
                                    <span>.</span>
                                    <span>.</span>
                                  </span>
                                </span>
                                */}
                              </p>
                            </div>
                          </div>
                        </>
                        )}
                      </div>

                      
                    </div>
                  </div>
                  {/* Title */}

                  {/* Toolbar (desktop) */}
                  <div className="col-xl-6 d-none d-xl-block">
                    <div className="row align-items-center justify-content-end gx-6">
                      <div className="col-auto">
                        <a
                          href="#"
                          className="icon icon-lg text-muted"
                          data-bs-toggle="offcanvas"
                          data-bs-target="#offcanvas-more"
                          aria-controls="offcanvas-more"
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
                            className="feather feather-more-horizontal"
                          >
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="19" cy="12" r="1"></circle>
                            <circle cx="5" cy="12" r="1"></circle>
                          </svg>
                        </a>
                      </div>

                      {/* Avatares: si es grupo mostramos miembros, si es individual el usuario + yo */}
                      <div className="col-auto">
                        <div className="avatar-group">
                          {chat.tipo === "grupo" ? (
                            <>
                              {/* Primeros 3 miembros */}
                              {chat.miembros?.slice(0, 3).map((m) => (
                                <div
                                  key={m.id}
                                  className="avatar avatar-sm"
                                  style={{ cursor: "pointer" }}
                                  onClick={() => 
                                    onVerPerfil({
                                      id: m.id,
                                      nombre: m.nombre,
                                      apellido: m.apellido || "",
                                      url_imagen: m.url_imagen,
                                      correo: m.correo || "",
                                      background: m.background || "#6c757d",
                                    })
                                  }
                                >
                                  {m.url_imagen ? (
                                    <img
                                      className="avatar-img rounded-circle"
                                      src={getAvatarUrl(m.url_imagen)}
                                      alt={m.nombre}
                                      style={{ objectFit: "cover" }}
                                    />
                                  ) : (
                                    <div
                                      className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                      style={{
                                        width: "34px",
                                        height: "34px",
                                        backgroundColor: m.background || "#6c757d",
                                        fontSize: "14px",
                                      }}
                                    >
                                      {getInitial(m.nombre, m.apellido)}
                                    </div>
                                  )}
                                </div>
                              ))}

                              {/* Avatar azul con + o +N (abre offcanvas de miembros) */}
                              <a
                                href="#"
                                className="avatar avatar-sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  console.log("👉 Abriendo modal miembros grupo:", chat.grupo_id);
                                  setOffcanvasGrupo(chat); // mantiene la referencia del grupo actual
                                }}
                              >
                                <div
                                  className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                  style={{
                                    width: "34px",
                                    height: "34px",
                                    backgroundColor: "#007bff",
                                    fontSize: chat.miembros?.length > 3 ? "12px" : "18px",
                                  }}
                                >
                                  {chat.miembros?.length > 3
                                    ? `+${chat.miembros.length - 3}`
                                    : "+"}
                                </div>
                              </a>
                            </>
                          ) : (
                            <>
                              {/* Avatar del otro usuario */}
                              <div
                                className="avatar avatar-sm"
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  const partes = (chat.usuario_nombre || "").split(" ");
                                  const nombre = partes[0] || "";
                                  const apellido = partes.slice(1).join(" ") || "";

                                  onVerPerfil({
                                    id: chat.usuario_id,
                                    ...chat,
                                    nombre,        // 👈 solo "Carlos"
                                    apellido,      // 👈 solo "Ramirez"
                                    url_imagen: chat.url_imagen,
                                    correo: chat.usuario_correo || "",
                                  });
                                }}
                              >
                                {chat?.url_imagen ? (
                                  <img
                                    className="avatar-img rounded-circle"
                                    src={getAvatarUrl(chat.url_imagen)}
                                    alt={chat.usuario_nombre}
                                    style={{ objectFit: "cover" }}
                                  />
                                ) : (
                                  <div
                                    className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                    style={{
                                      width: "34px",
                                      height: "34px",
                                      backgroundColor: chat?.background || "#6c757d",
                                      fontSize: "14px",
                                    }}
                                  >
                                    {getInitial(chat?.usuario_nombre || "U")}
                                  </div>
                                )}
                              </div>

                              {/* Avatar del usuario logueado */}
                              <div
                                className="avatar avatar-sm"
                                style={{ cursor: "pointer" }}
                                onClick={() => 
                                  onVerPerfil({
                                      ...user,
                                    url_imagen: user.url_imagen,  // 👈 aseguramos imagen
                                    correo: user.correo || "",    // 👈 aseguramos correo
                                  })
                                }
                              >
                                {user?.url_imagen ? (
                                  <img
                                    className="avatar-img rounded-circle"
                                    src={getAvatarUrl(user.url_imagen)}
                                    alt={user.nombre}
                                    style={{
                                      width: "32px",
                                      height: "32px",
                                      objectFit: "cover",
                                    }}
                                  />
                                ) : (
                                  <div
                                    className="avatar-img rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                    style={{
                                      width: "34px",
                                      height: "34px",
                                      backgroundColor: user?.background || "#6c757d",
                                      fontSize: "14px",
                                    }}
                                  >
                                    {getInitial(user?.nombre || "U")}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Toolbar */}
                </div>
              </div>
              {/* Content */}

              {/* Mobile: more */}
              <div className="col-2 d-xl-none text-end">
                <a
                  href="#"
                  className="icon icon-lg text-muted"
                  data-bs-toggle="offcanvas"
                  data-bs-target="#offcanvas-more"
                  aria-controls="offcanvas-more"
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
              </div>
              {/* Mobile: more */}
            </div>
          </div>
          
          {/* 🔹 Mensajes fijados estilo WhatsApp */}
          {messages.some(m => m.fijado === 1) && (
            <div className="pinned-bar d-flex align-items-center justify-content-between px-3 py-1 border-bottom">
              
              {/* Lista horizontal de fijados */}
              <div className="pinned-list d-flex align-items-center overflow-auto" style={{ flex: 1 }}>
                {messages
                  .filter(m => m.fijado === 1)
                  .map((msg, i) => (
                    <div 
                      key={msg.id} 
                      className="pinned-item position-relative d-flex align-items-center mx-1"
                      onClick={() => scrollToMessage(msg.id)}
                    >
                      <div className="pinned-content px-3 py-2 bg-white rounded-pill shadow-sm d-flex align-items-center">
                        <i className="bi bi-pin-angle-fill text-primary me-2"></i>
                        <span className="text-truncate small" style={{ maxWidth: 180 }}>
                          {msg.mensaje || "Mensaje fijado"}
                        </span>
                      </div>

                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Cuerpo del chat */}
          <div className="chat-body hide-scrollbar flex-1 overflow-auto">
            <div className="chat-body-inner h-100" >
                {messages.length === 0 ? (
                  <>
                  <div className="d-flex flex-column align-items-center justify-content-center h-100">
                      {/* iniciar Conversacion*/}
                      <div className="text-center mb-6">
                        <span className="icon icon-xl text-muted">
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
                            className="feather feather-send"
                          >
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                          </svg>
                        </span>
                      </div>

  
                      <p className="text-center text-muted">
                        Aún no hay mensajes, <br /> ¡inicia la conversación!
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="d-flex flex-column justify-content-center">
                      <ChatBody
                        messages={messages}
                        user={user}
                        chat={chat}   // 👈 aquí ya está el "tipo"
                        tipo={chat.tipo} // 👈 pasamos el tipo directamente
                        socket={socket}   // 👈 ahora sí lo pasamos
                        onVerPerfil={onVerPerfil}  // 👈 usamos el callback del padre
                      />
                  </div>
                )}
            </div>
          </div>

          {/* Input del chat */}
          <div className="chat-footer pb-3 pb-lg-7">
    

            {/* Chat: Form */}
            <form
              className="chat-form rounded-pill bg-dark"
              data-emoji-form=""
              onSubmit={(e) => {
                e.preventDefault();
                inputRef.current?.send(); // Llamamos al método de ChatInput
              }}
            >
              <div className="row align-items-center gx-0">
                {/* Botón para adjuntar archivo */}
                <div className="col-auto">
                  <input
                    type="file"
                    id="fileInput"
                    hidden
                    onChange={handleArchivoSeleccionado}
                  />
                  <button
                    className="btn btn-icon btn-link text-body rounded-circle"
                    onClick={() => document.getElementById("fileInput").click()}
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
                      className="feather feather-paperclip"
                    >
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                    </svg>
                  </button>
                </div>

                {/* Input de texto */}
                <div className="col position-relative">
                  <div className="input-group">
                    <div style={{ display: "flex", flex: 1 }}>
                      <ChatInput
                        ref={inputRef}
                        onSend={(msg) => {
                          handleSendMessage(msg);
                        }}
                      />
                    </div>

                    <a
                      href="#"
                      ref={emojiBtnRef}   // 👈 botón con ref
                      className="input-group-text text-body pe-0"
                      data-emoji-btn=""
                      onClick={(e) => {
                        e.preventDefault();
                        setShowEmojiPicker((prev) => !prev);
                      }}
                    >
                      <span className="icon icon-lg">
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
                          className="feather feather-smile"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                          <line x1="9" y1="9" x2="9.01" y2="9"></line>
                          <line x1="15" y1="9" x2="15.01" y2="9"></line>
                        </svg>
                      </span>
                    </a>
                     {/* Botón GIF */}
                    <a
                      href="#"
                      ref={gifBtnRef}   // 👈 botón con ref-
                      className="input-group-text text-body pe-0"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowGifPicker((prev) => !prev);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                        fetchTrendingGifs();
                      }}
                    >
                      <span className="icon icon-lg">
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
                        >
                          <path d="M3 4h18v16H3z"></path>
                          <path d="M3 10h18"></path>
                          <path d="M8 4v6"></path>
                          <path d="M16 4v6"></path>
                        </svg>
                      </span>
                    </a>

                    {/* Botón Stickers */}
                    <a
                      href="#"
                      ref={stickerBtnRef}   // 👈 botón con ref
                      className="input-group-text text-body pe-0"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowStickerPicker((prev) => !prev);
                        setShowEmojiPicker(false);
                        setShowGifPicker(false);
                      }}
                    >
                      <span className="icon icon-lg">
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
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <path d="M21 15l-5-5L5 21"></path>
                        </svg>
                      </span>
                    </a>
                  </div>
                  {/* Picker flotante */}
                  {showEmojiPicker && (
                  <div
                    ref={emojiRef}  // 👈 contenedor con ref
                    style={{
                      position: "absolute",
                      bottom: "60px",
                      right: "0",
                      zIndex: 1000,
                    }}
                  >
                    <Picker
                      data={data}
                      onEmojiSelect={(emoji) => handleEmojiClick({ emoji: emoji.native })}
                      previewPosition="none"   // sin preview abajo
                      skinTonePosition="search" // tonos arriba al lado del buscador
                      theme="light"
                      locale="es"               // idioma español
                      style={{ width: "350px", height: "450px" }}
                    />
                  </div>
                  )}
                  {/* GIF Picker (placeholder) */}
                  {showGifPicker && (
                    <div
                      ref={gifRef}  // 👈 contenedor con ref
                      style={{
                        position: "absolute",
                        bottom: "60px",
                        right: "50px",
                        zIndex: 1000,
                        width: "350px",
                        height: "450px",
                        background: "white",
                        border: "1px solid #ddd",
                        overflow: "auto",
                        padding: "10px",
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Buscar GIFs..."
                        value={gifSearch}
                        onChange={(e) => setGifSearch(e.target.value)}
                        onKeyUp={(e) => e.key === "Enter" && fetchGifs(gifSearch)}
                        style={{ width: "100%", marginBottom: "10px", padding: "5px" }}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {gifResults.map((gif) => (
                          <img
                            key={gif.id}
                            src={gif.images.fixed_height_small.url}
                            alt={gif.title}
                            style={{ width: "80px", cursor: "pointer" }}
                            onClick={() => {
                              handleSendMessage(gif.images.original.url); // envía la URL del GIF
                              setShowGifPicker(false);
                              setGifSearch("");
                              setGifResults([]);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Sticker / GIF Picker */}
                  {showStickerPicker && (
                    <div
                      ref={stickerRef}  // 👈 contenedor con ref
                      style={{
                        position: "absolute",
                        bottom: "60px",
                        right: "100px",
                        zIndex: 1000,
                        width: "300px",
                        background: "white",
                        border: "1px solid #ddd",
                        padding: "10px",
                        maxHeight: "400px",
                        overflow: "auto",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)", // 👈 3 por fila
                          gap: "10px",
                        }}
                      >
                        {/* Botón Crear */}
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <button
                            style={{
                              width: "70px",
                              height: "70px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "16px",
                              border: "1px solid #ddd",
                              background: "#fff",
                              cursor: "pointer",
                              transition: "all 0.2s ease",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept = "image/*,video/gif";
                              input.onchange = (e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  handleSendMessage(`[sticker]${url}`);
                                  setShowStickerPicker(false);
                                }
                              };
                              input.click();
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="28"
                              height="28"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#a7a7a6"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <line x1="12" y1="5" x2="12" y2="19"></line>
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                            
                          </button>
                          
                        </div>

                        {/* Stickers */}
                        {stickers.map((sticker, idx) => (
                          <div
                            key={idx}
                            style={{ display: "flex", justifyContent: "center" }}
                          >
                            <img
                              src={sticker.url}
                              alt="sticker"
                              style={{
                                width: "70px",
                                height: "70px",
                                borderRadius: "16px",
                                objectFit: "cover",
                                /*border: "1px solid #ddd",*/
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                handleSendMessage(`[sticker]${sticker.url}`);
                                setShowStickerPicker(false);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Botón enviar */}
                <div className="col-auto">
                  <button
                    type="submit"
                    className="btn btn-icon btn-primary rounded-circle ms-5"
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
                      className="feather feather-send"
                    >
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
            {/* Chat: Form */}

          </div>
        </div>
      </div>
      {/* 👇 Offcanvas MiembrosGrupos controlado por estado */}
      {offcanvasGrupo && (
        <MiembrosGrupos
          grupo={offcanvasGrupo}
          usuarioId={user?.id}
          onClose={() => setOffcanvasGrupo(null)} // cerrar desde dentro
        />
      )}

      {/* Panel de información del grupo */}
      <VerInfoGrupo
        chat={chat}
        visible={mostrarInfoGrupo}
        onClose={() => setMostrarInfoGrupo(false)}
        setMostrarVerArchivos={setMostrarVerArchivos}
        setOffcanvasGrupo={setOffcanvasGrupo}
        user={user}
        onActualizarChat={(campo, valor) => setChat(prev => ({ ...prev, [campo]: valor }))}
      />
      {/* 🔹 Panel de archivos */}
      <VerArchivos
        chat={chat}
        visible={mostrarVerArchivos}
        onClose={() => setMostrarVerArchivos(false)}
      />
      
    </main>
  );
};

export default ChatBox;