import React, { useEffect, useState } from "react";
import axios from "axios";
import socket from "../socket";
import { logDev } from "../utils/logger";
import { formatChatTime, parseToDate } from "../utils/date";
import { getAvatarUrl } from "../utils/url";
import { Star } from "lucide-react";
import toast from "react-hot-toast";



const ChatList = ({ onSelectChat, userId, selectedChat, setSelectedChat }) => {
  const [mensajes, setMensajes] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [chats, setChats] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [favoritos, setFavoritos] = useState([]);
  const [usuariosComunes, setUsuariosComunes] = useState([]);

  const getTimestamp = (fecha) => {
    const d = parseToDate(fecha);
    return d ? d.getTime() : 0;
  };
  const getInitial = (text) => (text ? text.charAt(0).toUpperCase() : "U");

  // -------------------------------
  // 🔹 Agrupar mensajes privados
  const agruparChatsPrivados = (mensajes, userId) => {
    if (!mensajes || mensajes.length === 0) return [];

    const grouped = {};

    mensajes.forEach((msg) => {
      const esEmisor = msg.usuario_envia_id === userId;
      const otherUserId = esEmisor ? msg.usuario_recibe_id : msg.usuario_envia_id;
      const eliminado = msg.eliminado ?? 0;

      const otherUserNombre = esEmisor
        ? `${msg.receptor_nombre || ""} ${msg.receptor_apellido || ""}`.trim() || msg.receptor_nombre || "Usuario"
        : `${msg.emisor_nombre || ""} ${msg.emisor_apellido || ""}`.trim() || msg.emisor_nombre || "Usuario";

      const otherUserCorreo = esEmisor ? msg.receptor_correo || "" : msg.emisor_correo || "";
      const otherUserAvatar = esEmisor ? msg.receptor_avatar || null : msg.emisor_avatar || null;
      const otherUserBackground = esEmisor ? msg.receptor_background || "#6c757d" : msg.emisor_background || "#6c757d";

      const msgTime = getTimestamp(msg.fecha_envio);
      const mensajeMostrado = eliminado === 1 ? "Se eliminó este mensaje" : msg.mensaje;

      if (!grouped[otherUserId]) {
        grouped[otherUserId] = {
          tipo: "privado",
          usuario_id: otherUserId,
          usuario_nombre: otherUserNombre,
          usuario_correo: otherUserCorreo,
          url_imagen: otherUserAvatar,
          background: otherUserBackground,
          mensajes_no_leidos: msg.usuario_recibe_id === userId && msg.visto === 0 ? 1 : 0,
          eliminado,
          ultimo_mensaje: mensajeMostrado,
          ultimo_mensaje_id: msg.id,
          fecha_envio: msg.fecha_envio,
          tipo_mensaje: esEmisor ? "enviado" : "recibido",
          visto: msg.visto,
          lastTime: msgTime,
        };
      } else {
        if (msg.id === grouped[otherUserId].ultimo_mensaje_id) {
          grouped[otherUserId].ultimo_mensaje = mensajeMostrado;
          grouped[otherUserId].eliminado = eliminado;
          grouped[otherUserId].tipo_mensaje = esEmisor ? "enviado" : "recibido";
          grouped[otherUserId].visto = msg.visto;
        }

        if (msgTime > grouped[otherUserId].lastTime) {
          grouped[otherUserId].ultimo_mensaje = mensajeMostrado;
          grouped[otherUserId].ultimo_mensaje_id = msg.id;
          grouped[otherUserId].fecha_envio = msg.fecha_envio;
          grouped[otherUserId].tipo_mensaje = esEmisor ? "enviado" : "recibido";
          grouped[otherUserId].visto = msg.visto;
          grouped[otherUserId].lastTime = msgTime;
        }

        if (msg.usuario_recibe_id === userId && msg.visto === 0) {
          grouped[otherUserId].mensajes_no_leidos += 1;
        }
      }
    });

    return Object.values(grouped);
  };

  // -------------------------------
  // 🔹 Cargar privados, grupos y favoritos
  useEffect(() => {
    if (!userId) return;

    const fetchData = async () => {
      try {
        const [resMensajes, resGrupos, resFavoritos] = await Promise.all([
          axios.get(`/api/chats/${userId}`),
          axios.get(`/api/grupos/usuario/${userId}`),
          axios.get(`/api/chats/favoritos/${userId}`)
        ]);

        setMensajes(resMensajes.data);
        setGrupos(resGrupos.data);
        setFavoritos(resFavoritos.data);

        console.group("📋 Chats cargados al inicio");
        console.log("🗨️ Mensajes privados:", resMensajes.data);
        console.log("👥 Grupos:", resGrupos.data);
        console.log("⭐ Favoritos:", resFavoritos.data);
        console.groupEnd();

      } catch (error) {
        console.error("❌ Error cargando datos iniciales del ChatList:", error);
      }
    };

    fetchData();
  }, [userId]);

  // -------------------------------
  // 🔹 Unificar privados + grupos
  useEffect(() => {
    if (!userId) return;

    const privados = agruparChatsPrivados(mensajes.filter((m) => !m.grupo_id), userId);

    const gruposAdaptados = grupos.map((g) => {
      const eliminado = g.eliminado ?? 0;
      const mensajeMostrado =
        eliminado === 1 ? "Se eliminó este mensaje" : g.ultimo_mensaje || "Nuevo grupo creado";
      const mensajesNoLeidos = g.miembros?.some((m) => m.id === userId)
        ? g.mensajes_no_leidos || 0
        : 0;

      return {
        // 🔹 Identificación general
        tipo: "grupo",
        grupo_id: g.grupo_id,
        user_id: userId,
        usuario_id: g.grupo_id,
        usuario_nombre: g.nombre,

        // 🔹 Imagen y colores
        imagen_url: g.imagen_url,
        background: "#6c757d",

        // 🔹 Estado de mensajes
        mensajes_no_leidos: mensajesNoLeidos,
        eliminado: g.eliminado,
        ultimo_mensaje: mensajeMostrado,
        ultimo_mensaje_id: g.ultimo_mensaje_id || null,
        ultimo_remitente: g.ultimo_remitente || null,
        ultimo_remitente_avatar: g.ultimo_remitente_avatar || null,
        ultimo_remitente_background: g.ultimo_remitente_background,
        fecha_envio: g.fecha_envio || g.fecha_creacion,
        tipo_mensaje: g.tipo_mensaje,
        visto: g.visto,
        lastTime: g.fecha_envio
          ? getTimestamp(g.fecha_envio)
          : getTimestamp(g.fecha_creacion),

        // 🔹 NUEVOS CAMPOS — información extendida del grupo
        descripcion: g.descripcion || "",
        fecha_creacion: g.fecha_creacion,
        privacidad: g.privacidad,
        propietario: g.propietario || null,
        admins: g.admins || [],
        archivos: g.archivos || [],
        es_favorito: g.es_favorito || false,
        miembros: g.miembros || [],
      };
    });

    setChats([...privados, ...gruposAdaptados].sort((a, b) => b.lastTime - a.lastTime));
  }, [mensajes, grupos, userId]);

  // -------------------------------
  // 🔹 Socket.IO
  useEffect(() => {
    if (!userId) return;

    if (!socket.connected) socket.connect();
    socket.emit("registrarUsuario", userId);
    logDev("🔌 Usuario registrado en Socket:", userId);

    const handleNuevoMensaje = (msg) => {
      if (msg.usuario_envia_id === userId || msg.usuario_recibe_id === userId) {
        setMensajes((prev) => {
          const updated = [...prev, msg];

          // 🔹 Reordenar chats directamente
          setChats((prevChats) => {
            return prevChats.map((chat) => {
              if (
                chat.tipo === "privado" &&
                ((chat.usuario_id === msg.usuario_envia_id && msg.usuario_recibe_id === userId) ||
                (chat.usuario_id === msg.usuario_recibe_id && msg.usuario_envia_id === userId))
              ) {
                return { ...chat, ultimo_mensaje: msg.mensaje, ultimo_mensaje_id: msg.id, fecha_envio: msg.fecha_envio, lastTime: getTimestamp(msg.fecha_envio) };
              }
              return chat;
            }).sort((a, b) => b.lastTime - a.lastTime);
          });

          return updated;
        });
      }
    };

    const handleNuevoMensajeGrupo = (msg) => {
      setMensajes((prev) => [
        ...prev,
        { ...msg, tipo_mensaje: msg.usuario_id === userId ? "enviado" : "recibido" }
      ]);

      setGrupos((prev) => {
        const updatedGrupos = prev.map((g) => {
          if (g.grupo_id === msg.grupo_id) {
            const soyRemitente = msg.usuario_id === userId;
            // 🔹 Si yo NO envié el mensaje, aumento el contador
            const nuevosNoVistos = soyRemitente
              ? g.mensajes_no_leidos || 0
              : (g.mensajes_no_leidos || 0) + 1;

            return {
              ...g,
              eliminado: 0,
              ultimo_mensaje: msg.mensaje,
              ultimo_mensaje_id: msg.id,
              ultimo_remitente: `${msg.nombre} ${msg.apellido}`,
              ultimo_remitente_id: msg.usuario_id,
              ultimo_remitente_avatar: msg.url_imagen,
              ultimo_remitente_background: msg.background,
              fecha_envio: msg.fecha_envio,
              tipo_mensaje: soyRemitente ? "enviado" : "recibido",
              lastTime: getTimestamp(msg.fecha_envio),
              mensajes_no_leidos: nuevosNoVistos,
              visto: soyRemitente ? 0 : g.visto, // 👈 resetear solo para quien envía
            };
          }
          return g;
        });

        // 🔹 Reordenar chats después de actualizar grupo
        setChats((prevChats) => {
          const privadoChats = prevChats.filter((c) => c.tipo === "privado");
          const grupoChats = updatedGrupos.map((g) => ({
            tipo: "grupo",
            grupo_id: g.grupo_id,
            usuario_id: g.grupo_id,
            usuario_nombre: g.nombre,
            imagen_url: g.imagen_url,
            background: "#6c757d",
            mensajes_no_leidos: g.mensajes_no_leidos || 0,
            eliminado: g.eliminado,
            ultimo_mensaje: g.ultimo_mensaje,
            ultimo_mensaje_id: g.ultimo_mensaje_id,
            ultimo_remitente: g.ultimo_remitente,
            ultimo_remitente_avatar: g.ultimo_remitente_avatar,
            fecha_envio: g.fecha_envio,
            tipo_mensaje: g.tipo_mensaje,
            visto: g.visto,
            lastTime: g.lastTime,
            miembros: g.miembros || [],
          }));
          return [...privadoChats, ...grupoChats].sort((a, b) => b.lastTime - a.lastTime);
        });

        return updatedGrupos;
      });
    };

    // 🧩 Grupo nuevo (cuando te agregan a uno)
    const handleGrupoCreado = (nuevoGrupo) => {
      console.log("🟢 NUEVO GRUPO CREADO (socket):", nuevoGrupo);
      setGrupos((prev) => [...prev, nuevoGrupo]);

      setChats((prevChats) => {
        const privadoChats = prevChats.filter((c) => c.tipo === "privado");
        const grupoChats = [
          ...prevChats.filter((c) => c.tipo === "grupo"),
          {
            tipo: "grupo",
            grupo_id: nuevoGrupo.grupo_id,
            usuario_id: nuevoGrupo.grupo_id,
            usuario_nombre: nuevoGrupo.nombre,
            imagen_url: nuevoGrupo.imagen_url,
            background: "#6c757d",
            miembros: nuevoGrupo.miembros,
            ultimo_mensaje: "",
            fecha_envio: nuevoGrupo.fecha_creacion,
            lastTime: getTimestamp(nuevoGrupo.fecha_creacion),
          },
        ];
        return [...privadoChats, ...grupoChats].sort((a, b) => b.lastTime - a.lastTime);
      });
    };

    const handleMensajesVistos = ({ emisorId, receptorId }) =>
      setMensajes((prev) =>
        prev.map((msg) =>
          msg.usuario_envia_id === emisorId && msg.usuario_recibe_id === receptorId
            ? { ...msg, visto: 1 }
            : msg
        )
    );

    const handleMensajesVistosGrupo = ({ userId: vistoPor, grupoId }) =>
      setMensajes((prev) =>
        prev.map((msg) =>
          msg.grupo_id === grupoId && msg.usuario_id === vistoPor
            ? { ...msg, visto: 1 }
            : msg
        )
    );

     // 🟢 NUEVO: actualizar contador no vistos en tiempo real
    const handleActualizarNoVistosGrupo = ({ grupoId, incremento, reset }) => {
      setGrupos((prev) =>
        prev.map((g) => {
          if (g.grupo_id === grupoId) {
            let nuevosNoVistos = g.mensajes_no_leidos || 0;
            if (reset) nuevosNoVistos = 0;
            else nuevosNoVistos += incremento || 0;

            return { ...g, mensajes_no_leidos: nuevosNoVistos };
          }
          return g;
        })
      );

      setChats((prevChats) =>
        prevChats.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? {
                ...c,
                mensajes_no_leidos: reset
                  ? 0
                  : (c.mensajes_no_leidos || 0) + (incremento || 0),
              }
            : c
        )
      );
    };

    const handleTodosMensajesVistosGrupo = ({ grupoId, mensajeId }) => {
      console.log("🔹 Evento TODOS MENSAJES VISTOS recibido:", { grupoId, mensajeId });

      // 1️⃣ Actualizar mensajes del grupo
      setMensajes(prev => prev.map(msg =>
        msg.grupo_id === grupoId && msg.id <= mensajeId
          ? { ...msg, visto: 1 }
          : msg
      ));

      // 2️⃣ Actualizar grupos
      setGrupos(prev => prev.map(g =>
        g.grupo_id === grupoId
          ? { ...g, mensajes_no_leidos: 0, visto: 1 }
          : g
      ));

      // 3️⃣ Actualizar chats
      setChats(prev => prev.map(c =>
        c.tipo === "grupo" && c.grupo_id === grupoId
          ? { ...c, mensajes_no_leidos: 0, visto: 1 }
          : c
      ));
    };

    // --- ⬇️ NUEVO: grupo actualizado ---
    const handleGrupoActualizado = (data) => {
      console.log("📢 [SOCKET] Grupo actualizado:", data);

      const grupoId = Number(data.id); // 👈 Convertir a número

      // Actualiza tanto la lista de grupos como los chats
      setGrupos((prev) =>
        prev.map((g) =>
          g.grupo_id === grupoId
            ? {
                ...g,
                nombre: data.nombre ?? g.nombre,
                descripcion: data.descripcion ?? g.descripcion,
              }
            : g
        )
      );

      setChats((prev) =>
        prev.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? {
                ...c,
                usuario_nombre: data.nombre ?? c.usuario_nombre,
                descripcion: data.descripcion ?? c.descripcion,
              }
            : c
        )
      );
    };
    
    // 🟢 Nuevo: privacidad actualizada
    const handlePrivacidadActualizada = (data) => {
      console.log("🔐 [SOCKET] Privacidad actualizada:", data);

      const grupoId = Number(data.id);

      setGrupos((prev) =>
        prev.map((g) =>
          g.grupo_id === grupoId
            ? { ...g, privacidad: data.privacidad }
            : g
        )
      );

      setChats((prev) =>
        prev.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? { ...c, privacidad: data.privacidad }
            : c
        )
      );
    };

    // 🧩 Nuevo: miembros actualizados en tiempo real
    const handleMiembrosActualizados = (data) => {
      console.log("👥 [SOCKET] Miembros actualizados (ChatList):", data);

      const grupoId = Number(data.id);

      // Actualizamos los arrays locales de grupos y chats
      setGrupos((prev) =>
        prev.map((g) =>
          g.grupo_id === grupoId
            ? { ...g, miembros: data.miembros }
            : g
        )
      );

      setChats((prev) =>
        prev.map((c) =>
          c.tipo === "grupo" && c.grupo_id === grupoId
            ? { ...c, miembros: data.miembros }
            : c
        )
      );
    };
    // 🧩 Grupo eliminado (si te sacan del grupo)
    const handleGrupoEliminado = (data) => {
      const grupoId = Number(data.id);
      console.log("🚫 [SOCKET] Eliminando grupo del ChatList:", grupoId);

      setGrupos((prev) => {
        const existe = prev.some((g) => g.grupo_id === grupoId);
        if (!existe) return prev;
        console.log("🗑️ Eliminado de grupos:", grupoId);
        return prev.filter((g) => g.grupo_id !== grupoId);
      });

      setChats((prev) => {
        const existe = prev.some((c) => c.tipo === "grupo" && c.grupo_id === grupoId);
        if (!existe) return prev;
        console.log("🗑️ Eliminado de chats:", grupoId);
        return prev.filter((c) => !(c.tipo === "grupo" && c.grupo_id === grupoId));
      });

      console.log("🗑️ selectedChat actual:", selectedChat);

      // 💡 Forzar limpieza del chat actual si corresponde
      if (!selectedChat || (selectedChat.tipo === "grupo" && Number(selectedChat.grupo_id) === grupoId)) {
        console.log("🧹 Cerrando chat actual...");
        setSelectedChat(null);
      }

      toast.error("🚫 Grupo eliminado o ya no perteneces a él");
    };

    socket.on("nuevoMensaje", handleNuevoMensaje);
    socket.on("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
    socket.on("grupoCreado", handleGrupoCreado);
    socket.on("mensajesVistos", handleMensajesVistos);
    socket.on("mensajesVistosGrupo", handleMensajesVistosGrupo);
    socket.on("actualizarNoVistosGrupo", handleActualizarNoVistosGrupo);
    socket.on("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
    socket.on("grupoActualizado", handleGrupoActualizado);
    socket.on("privacidadActualizada", handlePrivacidadActualizada);
    socket.on("miembrosActualizados", handleMiembrosActualizados);
    socket.on("grupoEliminado", handleGrupoEliminado);

    return () => {
      socket.off("nuevoMensaje", handleNuevoMensaje);
      socket.off("nuevoMensajeGrupo", handleNuevoMensajeGrupo);
      socket.off("grupoCreado", handleGrupoCreado);
      socket.off("mensajesVistos", handleMensajesVistos);
      socket.off("mensajesVistosGrupo", handleMensajesVistosGrupo);
      socket.off("actualizarNoVistosGrupo", handleActualizarNoVistosGrupo);
      socket.off("todosMensajesVistosGrupo", handleTodosMensajesVistosGrupo);
      socket.off("grupoActualizado", handleGrupoActualizado);
      socket.off("privacidadActualizada", handlePrivacidadActualizada);
      socket.off("miembrosActualizados", handleMiembrosActualizados);
      socket.off("grupoEliminado", handleGrupoEliminado);
    };
  }, [userId]);

  // -------------------------------
  // 🔹 Socket.IO PARA ELIMINAR MENSAJES, DESHACER ELIMINADO, EDITAR MENSAJE
  useEffect(() => {
    if (!userId) return;

    const actualizarChat = (msg) => {
      const esGrupo = !!msg.grupo_id;

      // Actualizar la lista de mensajes localmente
      setMensajes((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));

      if (esGrupo) {
        setGrupos((prevGrupos) => {
          const updatedGrupos = prevGrupos.map((g) => {
            // Solo actualizar el grupo si coincide
            if (g.grupo_id !== msg.grupo_id) return g;

            // 🧠 Verificar si este mensaje es el último
            const esUltimo = g.ultimo_mensaje_id === msg.id;

            // Si NO es el último → no modificar el preview
            if (!esUltimo) {
              return {
                ...g,
                mensajes_no_leidos: g.mensajes_no_leidos || 0, // mantener contadores
              };
            }

            // Si SÍ es el último → actualizamos el preview correctamente
            return {
              ...g,
              eliminado: msg.eliminado ?? g.eliminado,
              editado: msg.editado ?? g.editado,
              ultimo_mensaje: msg.eliminado
                ? "Mensaje eliminado"
                : msg.mensaje ?? g.ultimo_mensaje,
              ultimo_mensaje_id: msg.id,
              ultimo_remitente: msg.nombre
                ? `${msg.nombre} ${msg.apellido}`
                : g.ultimo_remitente,
              ultimo_remitente_avatar: msg.url_imagen ?? g.ultimo_remitente_avatar,
              fecha_envio: msg.fecha_envio ?? g.fecha_envio,
              lastTime: getTimestamp(msg.fecha_envio || g.fecha_creacion),
            };
          });

          // 🔹 Reflejar también en la lista de chats
          setChats((prevChats) => {
            const privadoChats = prevChats.filter((c) => c.tipo === "privado");

            const grupoChats = updatedGrupos.map((g) => ({
              tipo: "grupo",
              grupo_id: g.grupo_id,
              usuario_id: g.grupo_id,
              usuario_nombre: g.nombre,
              imagen_url: g.imagen_url,
              background: "#6c757d",
              mensajes_no_leidos: g.miembros?.some((m) => m.id === userId)
                ? g.mensajes_no_leidos || 0
                : 0,
              eliminado: g.eliminado,
              ultimo_mensaje: g.ultimo_mensaje,
              ultimo_mensaje_id: g.ultimo_mensaje_id,
              ultimo_remitente: g.ultimo_remitente,
              ultimo_remitente_avatar: g.ultimo_remitente_avatar,
              fecha_envio: g.fecha_envio,
              tipo_mensaje: g.tipo_mensaje,
              visto: g.visto,
              lastTime: g.lastTime,
              miembros: g.miembros || [],
            }));

            return [...privadoChats, ...grupoChats].sort(
              (a, b) => b.lastTime - a.lastTime
            );
          });

          return updatedGrupos;
        });
      } else {
        // 🔹 CHAT PRIVADO (ya funcionaba bien)
        setChats((prevChats) =>
          prevChats.map((chat) => {
            const esEsteChat =
              chat.tipo === "privado" &&
              ((chat.usuario_id === msg.usuario_envia_id &&
                msg.usuario_recibe_id === userId) ||
                (chat.usuario_id === msg.usuario_recibe_id &&
                  msg.usuario_envia_id === userId));

            if (!esEsteChat) return chat;

            // Solo actualizar si el mensaje afectado es el último
            const esUltimo = chat.ultimo_mensaje_id === msg.id;

            if (!esUltimo) return chat;

            return {
              ...chat,
              ultimo_mensaje: msg.eliminado
                ? "Mensaje eliminado"
                : msg.mensaje ?? chat.ultimo_mensaje,
              eliminado: msg.eliminado ?? chat.eliminado,
              editado: msg.editado ?? chat.editado,
            };
          })
        );
      }
    };

    socket.on("mensajeEliminado", actualizarChat);
    socket.on("mensajeEliminadoGrupo", actualizarChat);
    socket.on("mensajeDeshecho", actualizarChat);
    socket.on("mensajeDeshechoGrupo", actualizarChat);
    socket.on("mensajeEditado", actualizarChat);
    socket.on("mensajeEditadoGrupo", actualizarChat);

    return () => {
      socket.off("mensajeEliminado", actualizarChat);
      socket.off("mensajeEliminadoGrupo", actualizarChat);
      socket.off("mensajeDeshecho", actualizarChat);
      socket.off("mensajeDeshechoGrupo", actualizarChat);
      socket.off("mensajeEditado", actualizarChat);
      socket.off("mensajeEditadoGrupo", actualizarChat);
    };
  }, [userId]);

  // -------------------------------
  // 🔹 Filtrar usuarios comunes
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setUsuariosComunes([]);
      return;
    }

    fetch(`/api/chats/usuarios/comunes/${userId}?search=${searchTerm}`)
      .then((res) => res.json())
      .then((data) => setUsuariosComunes(data))
      .catch((err) => console.error("Error cargando usuarios comunes", err));
  }, [searchTerm, userId]);

  // -------------------------------
  // 🔹 Funciones
  const toggleFavorito = async (chat) => {
    const isFavorito = favoritos.some(
      (f) => f.chat_id === (chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id) && f.tipo === chat.tipo
    );

    if (isFavorito) {
      await axios.delete("/api/chats/favoritos", {
        data: { usuarioId: userId, chatId: chat.usuario_id, tipo: chat.tipo },
      });
      setFavoritos((prev) =>
        prev.filter((f) => !(f.chat_id === chat.usuario_id && f.tipo === chat.tipo))
      );
    } else {
      await axios.post("/api/chats/favoritos", {
        usuarioId: userId,
        chatId: chat.usuario_id,
        tipo: chat.tipo,
      });
      setFavoritos((prev) => [
        ...prev,
        { usuario_id: userId, chat_id: chat.usuario_id, tipo: chat.tipo },
      ]);
    }
  };

  const handleSelectUsuarioComun = (usuario) => {
    const nuevoChat = {
      tipo: "privado",
      usuario_id: usuario.id,
      usuario_nombre: `${usuario.nombre} ${usuario.apellido}`,
      usuario_apellido: usuario.apellido,
      url_imagen: usuario.url_imagen,
      background: usuario.background,
      correo: usuario.correo,
      mensajes: [],
      esNuevo: true,
      lastTime: Date.now(), // ⚡ Importante
    };

    setChats((prev) => {
      const yaExiste = prev.some((c) => c.tipo === "privado" && c.usuario_id === usuario.id);
      if (!yaExiste) return [nuevoChat, ...prev].sort((a, b) => b.lastTime - a.lastTime);
      return prev;
    });

    onSelectChat(nuevoChat);
  };

  // -------------------------------
  // 🔹 Filtrar chats por búsqueda
  const filteredChats = chats.filter((chat) => {
    const search = searchTerm.toLowerCase();
    const nombre =
      chat.tipo === "grupo" ? (chat.usuario_nombre || "").toLowerCase() : (chat.usuario_nombre || "").toLowerCase();
    const apellido = (chat.usuario_apellido || "").toLowerCase();
    const ultimoMensaje = (chat.ultimo_mensaje || "").toLowerCase();
    const miembros = chat.miembros
      ? chat.miembros.map((m) => `${m.nombre} ${m.apellido}`.toLowerCase()).join(" ")
      : "";

    return nombre.includes(search) || apellido.includes(search) || ultimoMensaje.includes(search) || miembros.includes(search);
  });

  const favoritosChats = filteredChats.filter((chat) =>
    favoritos.some((f) => f.chat_id === (chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id) && f.tipo === chat.tipo)
  );

  const otrosChats = filteredChats.filter(
    (chat) =>
      !favoritos.some((f) => f.chat_id === (chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id) && f.tipo === chat.tipo)
  );

  const handleSelectChat = async (chat) => {
    onSelectChat(chat);
    try {
      if (chat.tipo === "grupo") {
         console.log("📡 Chat grupo seleccionado:", chat);
        if (!chat.ultimo_mensaje) return;

        await axios.put("/api/mensajes/grupo/marcar-vistos-grupo", {
          userId,
          grupoId: chat.grupo_id,
        });

        setMensajes((prev) =>
          prev.map((msg) =>
            msg.grupo_id === chat.grupo_id
              ? { ...msg, vistos: [...(msg.vistos || []), userId] }
              : msg
          )
        );
      } else {
        if (!chat.ultimo_mensaje) return;

        await axios.put("/api/mensajes/marcar-vistos", {
          userId,
          contactoId: chat.usuario_id,
        });

        setMensajes((prev) =>
          prev.map((msg) =>
            msg.usuario_envia_id === chat.usuario_id && msg.usuario_recibe_id === userId
              ? { ...msg, visto: 1 }
              : msg
          )
        );
      }
    } catch (err) {
      console.error("❌ Error al marcar mensajes como vistos:", err);
    }
  };

  return (
    <aside className="sidebar bg-light">
      <div className="tab-pane fade h-100 active show" id="tab-content-chats" role="tabpanel">
        <div className="d-flex flex-column h-100 position-relative">
          <div className="hide-scrollbar">
            <div className="container py-4">
              <div className="mb-8">
                <h2 className="fw-bold m-0">Chats</h2>
              </div>

              {/* Search */}
              <div className="mb-6">
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
                    placeholder="Buscar mensajes o usuarios"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              {/* Chats */}
              <div className="card-list">
                {usuariosComunes.length > 0 && (
                    <div className="mt-3">
                      <h6 className="fw-bold text-muted mb-2">👥 Personas en proyectos comunes</h6>
                      {usuariosComunes.map((u) => (
                        <div
                          key={u.id}
                          className="card border-0 text-reset"
                          style={{ cursor: "pointer" }}
                          onClick={(e) => {
                            e.preventDefault();
                            handleSelectUsuarioComun(u);
                          }}// función para crear nuevo chat privado
                        >
                          <div className="card-body d-flex align-items-center">
                            {u.url_imagen ? (
                              <img
                                src={getAvatarUrl(u.url_imagen)}
                                alt={u.nombre}
                                className="rounded-circle me-2"
                                style={{ width: "40px", height: "40px", objectFit: "cover" }}
                              />
                            ) : (
                              <div
                                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold me-2"
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  backgroundColor: u.background || "#6c757d",
                                }}
                              >
                                {u.nombre.charAt(0).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <div className="fw-bold">{u.nombre} {u.apellido}</div>
                              <div className="fst-italic text-muted">¡Iniciar conversación!</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                )}
                {/* ⭐ Favoritos */}
                {favoritosChats.length > 0 && (
                  <div className="mb-4">
                    <h6 className="fw-bold text-muted mb-2">⭐ Favoritos</h6>
                    <div className="card-list">
                      {favoritosChats.map((chat) => (
                        <a
                          key={`${chat.tipo}-${chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id}`}
                          href="#"
                          className="card border-0 text-reset"
                          onClick={(e) => {
                            e.preventDefault();
                            handleSelectChat(chat);
                          }}
                        >
                          {/* 🔹 Reutilizo tu render de arriba */}
                          <div className="card-body">
                            <div className="row gx-5">
                              <div className="chat-row">
                                <div className="col-auto">
                                  <div className="avatar avatar-xl">
                                    {/* 👇 Avatares / iniciales (igual que tu código) */}
                                    {chat.tipo === "grupo" && chat.ultimo_mensaje ? (
                                      chat.ultimo_remitente_avatar ? (
                                        <img
                                          src={getAvatarUrl(chat.ultimo_remitente_avatar)}
                                          alt={chat.ultimo_remitente}
                                          className="avatar-img rounded-circle"
                                          style={{ width: "40px", height: "40px", objectFit: "cover" }}
                                        />
                                      ) : chat.ultimo_remitente_background ? (
                                        <div
                                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                          style={{
                                            width: "40px",
                                            height: "40px",
                                            backgroundColor: chat.ultimo_remitente_background || "#6c757d",
                                            fontSize: "18px",
                                          }}
                                        >
                                          {chat.ultimo_remitente?.[0] || "?"}
                                        </div>
                                      ) : chat.imagen_url ? (
                                        <img
                                          src={chat.imagen_url}
                                          alt={chat.usuario_nombre}
                                          className="avatar-img rounded-circle"
                                          style={{ width: "40px", height: "40px", objectFit: "cover" }}
                                        />
                                      ) : (
                                        <div
                                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                          style={{
                                            width: "40px",
                                            height: "40px",
                                            backgroundColor: chat.background || "#6c757d",
                                            fontSize: "18px",
                                          }}
                                        >
                                          {getInitial(chat.usuario_nombre)}
                                        </div>
                                      )
                                    ) : chat.url_imagen ? (
                                      <img
                                        src={getAvatarUrl(chat.url_imagen)}
                                        alt={chat.usuario_nombre}
                                        className="avatar-img rounded-circle"
                                        style={{ width: "40px", height: "40px", objectFit: "cover" }}
                                      />
                                    ) : (
                                      <div
                                        className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                        style={{
                                          width: "40px",
                                          height: "40px",
                                          backgroundColor: chat.background || "#6c757d",
                                          fontSize: "18px",
                                        }}
                                      >
                                        {getInitial(chat.usuario_nombre)}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="col">
                                  <div className="d-flex align-items-center mb-3">
                                    <h5 className="me-auto mb-0">
                                      {chat.tipo === "grupo"
                                        ? chat.ultimo_remitente || chat.usuario_nombre
                                        : chat.usuario_nombre}
                                    </h5>
                                    <span className="text-muted extra-small ms-2">
                                      {formatChatTime(chat.fecha_envio)}
                                    </span>
                                    {/* ⭐ Favorito (siempre amarillo en la lista de favoritos) */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleFavorito(chat); // igual se puede quitar de favoritos
                                      }}
                                      className="btn btn-sm border-0 bg-transparent p-0 ms-2"
                                    >
                                      <Star
                                        size={18}
                                        fill="currentColor"   // 👉 relleno del mismo color que el texto
                                        stroke="currentColor" // 👉 el borde también del mismo color
                                        className="text-warning"
                                      />
                                    </button>
                                  </div>

                                  <div className="d-flex align-items-baseline">
                                    {/* ✅ Vistos (igual que tu código) */}
                                    {chat.tipo_mensaje === "enviado" && chat.eliminado === 0 && (
                                      <span className="me-2 d-inline-flex">
                                        {chat.visto === 0 ? (
                                          <span className="svg15 double-check"></span>
                                        ) : (
                                          <span className="svg15 double-check-blue"></span>
                                        )}
                                      </span>
                                    )}
                                    <div className="line-clamp me-auto d-flex align-items-center gap-1">
                                      {chat.eliminado === 1 && (
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          width="14"
                                          height="14"
                                          fill="currentColor"
                                          viewBox="0 0 24 24"
                                          strokeWidth={2}
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6-7h-1V7a5 5 0 0 0-10 0v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-3 0H9V7a3 3 0 0 1 6 0v3Z"
                                          />
                                        </svg>
                                      )}
                                      <span className={chat.eliminado === 1 ? "fst-italic text-muted" : "text-truncate"}>
                                        {chat.eliminado === 1 ? "Se eliminó este mensaje" : chat.ultimo_mensaje}
                                      </span>
                                    </div>
                                    {chat.mensajes_no_leidos > 0 && (
                                      <div className="badge badge-circle bg-primary ms-3">
                                        <span>{chat.mensajes_no_leidos}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Footer SOLO si es grupo */}
                          {chat.tipo === "grupo" && (
                            <div className="card-footer">
                              <div className="row align-items-center gx-4">
                                <div className="col-auto">
                                  <div className="avatar avatar-xs">
                                    <img
                                      src={chat.imagen_url || "/default-group.png"}
                                      alt={chat.usuario_nombre}
                                      className="avatar-img"
                                    />
                                  </div>
                                </div>
                                <div className="col">
                                  <h6 className="mb-0">{chat.usuario_nombre}</h6>
                                </div>
                                <div className="col-auto">
                                  <div className="avatar-group">
                                    {chat.miembros?.slice(0, 3).map((m) => {
                                      const initials = `${m.nombre?.[0] || ""}`.toUpperCase();
                                      return (
                                        <div
                                          className="avatar avatar-xs rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                          key={m.id}
                                          style={{
                                            backgroundColor: !m.url_imagen ? m.background || "#ccc" : "transparent",
                                          }}
                                        >
                                          {m.url_imagen ? (
                                            <img
                                              src={getAvatarUrl(m.url_imagen)}
                                              alt={m.nombre}
                                              className="avatar-img"
                                            />
                                          ) : (
                                            <span>{initials}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {chat.miembros?.length > 3 && (
                                      <div className="avatar avatar-xs" style={{ fontSize: "0.7rem" }}>
                                        <span className="avatar-text">
                                          +{chat.miembros.length - 3}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {/* 🔽 Otros chats */}
                <div className="card-list">
                  {otrosChats.map((chat) => (
                    <a
                      key={`${chat.tipo}-${chat.tipo === "grupo" ? chat.grupo_id : chat.usuario_id}`}
                      href="#"
                      className="card border-0 text-reset"
                      onClick={(e) => {
                        e.preventDefault();
                        handleSelectChat(chat);
                      }}
                    >
                      {/* 🔹 Reutilizo tu mismo render de arriba */}
                      <div className="card-body">
                        <div className="row gx-5">
                          <div className="chat-row">
                            <div className="col-auto">
                              <div className="avatar avatar-xl">
                                    {/* 👇 Avatares / iniciales (igual que tu código) */}
                                    {chat.tipo === "grupo" && chat.ultimo_mensaje ? (
                                      chat.ultimo_remitente_avatar ? (
                                        <img
                                          src={getAvatarUrl(chat.ultimo_remitente_avatar)}
                                          alt={chat.ultimo_remitente}
                                          className="avatar-img rounded-circle"
                                          style={{ width: "40px", height: "40px", objectFit: "cover" }}
                                        />
                                      ) : chat.ultimo_remitente_background ? (
                                        <div
                                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                          style={{
                                            width: "40px",
                                            height: "40px",
                                            backgroundColor: chat.ultimo_remitente_background || "#6c757d",
                                            fontSize: "18px",
                                          }}
                                        >
                                          {chat.ultimo_remitente?.[0] || "?"}
                                        </div>
                                      ) : chat.imagen_url ? (
                                        <img
                                          src={chat.imagen_url}
                                          alt={chat.usuario_nombre}
                                          className="avatar-img rounded-circle"
                                          style={{ width: "40px", height: "40px", objectFit: "cover" }}
                                        />
                                      ) : (
                                        <div
                                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                          style={{
                                            width: "40px",
                                            height: "40px",
                                            backgroundColor: chat.background || "#6c757d",
                                            fontSize: "18px",
                                          }}
                                        >
                                          {getInitial(chat.usuario_nombre)}
                                        </div>
                                      )
                                    ) : chat.url_imagen ? (
                                      <img
                                        src={getAvatarUrl(chat.url_imagen)}
                                        alt={chat.usuario_nombre}
                                        className="avatar-img rounded-circle"
                                        style={{ width: "40px", height: "40px", objectFit: "cover" }}
                                      />
                                    ) : (
                                      <div
                                        className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                        style={{
                                          width: "40px",
                                          height: "40px",
                                          backgroundColor: chat.background || "#6c757d",
                                          fontSize: "18px",
                                        }}
                                      >
                                        {getInitial(chat.usuario_nombre)}
                                      </div>
                                    )}
                              </div>
                            </div>

                            <div className="col">
                                  <div className="d-flex align-items-center mb-3">
                                    <h5 className="me-auto mb-0">
                                      {chat.tipo === "grupo"
                                        ? chat.ultimo_remitente || chat.usuario_nombre
                                        : chat.usuario_nombre}
                                    </h5>
                                    
                                      
                                    <span className="text-muted extra-small ms-2">
                                      {formatChatTime(chat.fecha_envio)}
                                    </span>
                                    {/* ⭐ Botón de favorito */}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation(); // evita que abra el chat
                                          toggleFavorito(chat); // función que guarda/quita en favoritos
                                        }}
                                        className="btn btn-sm border-0 bg-transparent p-0 ms-2"
                                      >
                                        <Star
                                          size={18}
                                          className={`transition-colors ${
                                            chat.esFavorito ? "text-warning fill-warning" : "text-muted"
                                          }`}
                                        />
                                      </button>
                                  </div>

                                  <div className="d-flex align-items-baseline">
                                    {/* ✅ Vistos (igual que tu código) */}
                                    {chat.tipo_mensaje === "enviado" && chat.eliminado === 0 && (
                                      <span className="me-2 d-inline-flex">
                                        {chat.visto === 0 ? (
                                          <span className="svg15 double-check"></span>
                                        ) : (
                                          <span className="svg15 double-check-blue"></span>
                                        )}
                                      </span>
                                    )}
                                    <div className="line-clamp me-auto d-flex align-items-center gap-1">
                                      {chat.eliminado === 1 && (
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          width="14"
                                          height="14"
                                          fill="currentColor"
                                          viewBox="0 0 24 24"
                                          strokeWidth={2}
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6-7h-1V7a5 5 0 0 0-10 0v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-3 0H9V7a3 3 0 0 1 6 0v3Z"
                                          />
                                        </svg>
                                      )}
                                      <span className={chat.eliminado === 1 ? "fst-italic text-muted" : "text-truncate"}>
                                        {chat.eliminado === 1 ? "Se eliminó este mensaje" : chat.ultimo_mensaje}
                                      </span>
                                    </div>
                                    {chat.mensajes_no_leidos > 0 && (
                                      <div className="badge badge-circle bg-primary ms-3">
                                        <span>{chat.mensajes_no_leidos}</span>
                                      </div>
                                    )}
                                  </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer SOLO si es grupo */}
                      {chat.tipo === "grupo" && (
                            <div className="card-footer">
                              <div className="row align-items-center gx-4">
                                <div className="col-auto">
                                  <div className="avatar avatar-xs">
                                    {chat.imagen_url ? (
                                      <img
                                        src={chat.imagen_url || "/default-group.png"}
                                        alt={chat.usuario_nombre}
                                        className="avatar-img"
                                      />
                                    ) : (
                                      <div
                                        className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                        style={{
                                          width: "22px",
                                          height: "22px",
                                          backgroundColor: chat.background || "#6c757d",
                                          fontSize: "9px",
                                        }}
                                      >
                                        {getInitial(chat.usuario_nombre)}
                                      </div>
                                    )}
                                    
                                  </div>
                                </div>
                                <div className="col">
                                  <h6 className="mb-0">{chat.usuario_nombre}</h6>
                                </div>
                                <div className="col-auto">
                                  <div className="avatar-group">
                                    {chat.miembros?.slice(0, 3).map((m) => {
                                      const initials = `${m.nombre?.[0] || ""}`.toUpperCase();
                                      return (
                                        <div
                                          className="avatar avatar-xs rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                                          key={m.id}
                                          style={{
                                            backgroundColor: !m.url_imagen ? m.background || "#ccc" : "transparent",
                                          }}
                                        >
                                          {m.url_imagen ? (
                                            <img
                                              src={getAvatarUrl(m.url_imagen)}
                                              alt={m.nombre}
                                              className="avatar-img"
                                            />
                                          ) : (
                                            <span>{initials}</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {chat.miembros?.length > 3 && (
                                      <div className="avatar avatar-xs" style={{ fontSize: "0.7rem" }}>
                                        <span className="avatar-text">
                                          +{chat.miembros.length - 3}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                      )}
                    </a>
                  ))}

                  
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default ChatList;