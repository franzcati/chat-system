import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom'; // 👈
import { logDev } from "../utils/logger";
import Sidebar from './Sidebar';
import ChatList from './ChatList';
import ChatBox from './ChatBox';
import CreateChat from '../components/CreateChat';
import ProfileModal from "../components/ProfileModal";
import AddUsers from "../components/AddUsers";
import EditUsers from "../components/EditUsers";
import socket, { conectarUsuarioSocket, emitirActividadUsuario } from "../socket";

const Messenger = () => {
  const [selectedChat, setSelectedChat] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [activeTab, setActiveTab] = useState("chat");
  const [perfilSeleccionado, setPerfilSeleccionado] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [addToListTarget, setAddToListTarget] = useState(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [estadosUsuarios, setEstadosUsuarios] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('usuario');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);

      if (typeof parsedUser.permisos_chat === "string") {
        parsedUser.permisos_chat = JSON.parse(parsedUser.permisos_chat);
      }

      if (typeof parsedUser.rol_permisos === "string") {
        parsedUser.rol_permisos = JSON.parse(parsedUser.rol_permisos);
      }

      setUsuario(parsedUser);
      logDev("✅ Usuario cargado desde localStorage:", parsedUser);
    } else {
      navigate('/');
    }
  }, []);

  // Los proyectos sólo son necesarios al abrir las pantallas administrativas.
  // No bloqueamos la carga inicial del chat con estas consultas.
  useEffect(() => {
    const necesitaProyectos = ["edit", "add-user", "edit-user"].includes(activeTab);
    if (!necesitaProyectos || proyectos.length > 0) return;

    const cargarProyectos = async () => {
      try {
        const res = await fetch("/api/proyecto");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setProyectos(data);
        logDev("📌 Proyectos cargados:", data?.length || 0);
      } catch (err) {
        console.error("❌ Error cargando proyectos:", err);
      }
    };

    cargarProyectos();
  }, [activeTab, proyectos.length]);

  useEffect(() => {
    if (activeTab !== "edit" || !usuario?.id || usuario?.proyectoId) return;

    const fetchProyectoId = async () => {
      try {
        const res = await fetch(`/api/grupos/${usuario.id}/proyecto`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setUsuario((prev) => ({ ...prev, proyectoId: data.proyectoId }));
      } catch (err) {
        console.error("❌ Error trayendo proyecto:", err);
      }
    };

    fetchProyectoId();
  }, [activeTab, usuario?.id, usuario?.proyectoId]);

  useEffect(() => {
    if (!usuario?.id) return;
    let cancelled = false;

    fetch("/api/usuarios/estados/presencia")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        if (!cancelled) setEstadosUsuarios(data || {});
      })
      .catch(() => {});

    const handleActualizarUsuarios = (payload = {}) => {
      setEstadosUsuarios(payload || {});
    };

    socket.on("actualizarUsuarios", handleActualizarUsuarios);
    return () => {
      cancelled = true;
      socket.off("actualizarUsuarios", handleActualizarUsuarios);
    };
  }, [usuario?.id]);

  useEffect(() => {
    if (selectedChat) {
      logDev("📩 selectedChat enviado a ChatBox:", selectedChat);
    }
  }, [selectedChat]);

  useEffect(() => {
    if (usuario) {
      logDev("📩 usuario enviado a ChatBox:", usuario);
    }
  }, [selectedChat]);

  useEffect(() => {
    if (!usuario?.id) return;

    let lastActivitySent = 0;
    const sendActivity = () => {
      const now = Date.now();
      if (now - lastActivitySent < 15000) return;
      lastActivitySent = now;
      emitirActividadUsuario(usuario.id);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, sendActivity, { passive: true }));

    const handleVisibilityChange = () => {
      if (!document.hidden) sendActivity();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    sendActivity();

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, sendActivity));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [usuario?.id]);

  useEffect(() => {
    if (!usuario?.id) return;

    const actualizarUsuarioLocal = (payload = {}) => {
      if (Number(payload.usuarioId) !== Number(usuario.id)) return;

      setUsuario((prev) => {
        if (!prev) return prev;

        const next = {
          ...prev,
          ...(payload.rol_id != null ? { rol_id: Number(payload.rol_id) } : {}),
          ...(Array.isArray(payload.rol_permisos) ? { rol_permisos: payload.rol_permisos } : {}),
          ...(payload.permisos_chat && typeof payload.permisos_chat === "object"
            ? { permisos_chat: payload.permisos_chat }
            : {}),
        };

        try {
          localStorage.setItem("usuario", JSON.stringify(next));
        } catch (error) {
          console.warn("⚠️ No se pudo actualizar localStorage del usuario:", error);
        }

        return next;
      });
    };

    const handlePermisosChatActualizados = (payload = {}) => {
      actualizarUsuarioLocal(payload);
      logDev("🔐 Permisos de chat actualizados en tiempo real:", payload.permisos_chat);
    };

    const handleRolUsuarioActualizado = (payload = {}) => {
      actualizarUsuarioLocal(payload);
      logDev("👤 Rol/permisos de rol actualizados en tiempo real:", payload);
    };

    const handleCuentaDesactivada = (payload = {}) => {
      if (Number(payload.usuarioId) !== Number(usuario.id)) return;

      const mensaje = payload.motivo ||
        "Tu cuenta ha sido desactivada. Comunícate con un administrador.";

      try {
        localStorage.removeItem("usuario");
      } catch (error) {
        console.warn("⚠️ No se pudo limpiar la sesión local:", error);
      }

      try {
        socket.disconnect();
      } catch (error) {
        console.warn("⚠️ No se pudo desconectar Socket.IO:", error);
      }

      window.alert(mensaje);
      navigate("/");
    };

    socket.on("permisosChatActualizados", handlePermisosChatActualizados);
    socket.on("rolUsuarioActualizado", handleRolUsuarioActualizado);
    socket.on("cuentaDesactivada", handleCuentaDesactivada);

    return () => {
      socket.off("permisosChatActualizados", handlePermisosChatActualizados);
      socket.off("rolUsuarioActualizado", handleRolUsuarioActualizado);
      socket.off("cuentaDesactivada", handleCuentaDesactivada);
    };
  }, [usuario?.id, navigate]);

  useEffect(() => {
    if (!usuario?.id) return;

    logDev("🔌 Messenger va a conectar socket", usuario.id);
    conectarUsuarioSocket(usuario.id);

    const onConnect = () => {
      logDev("✅ Socket conectado en Messenger:", socket.id);
    };

    const onNuevoMensaje = (msg) => {
      logDev("📨 Messenger recibió nuevoMensaje:", msg);
    };

    socket.on("connect", onConnect);
    socket.on("nuevoMensaje", onNuevoMensaje);

    return () => {
      socket.off("connect", onConnect);
      socket.off("nuevoMensaje", onNuevoMensaje);
    };
  }, [usuario?.id]);

  // 👇 AGREGALOS AQUI
  logDev("🧩 Messenger render", {
    activeTab,
    usuarioId: usuario?.id,
    selectedChat,
  });

  logDev("🧩 Va a renderizar ChatList?", activeTab === "chat");

  return (
    <div className="flex h-screen bg-[#f8f9fd]">
      {/* Sidebar con iconos */}
      <Sidebar
        usuario={usuario}
        active={activeTab}
        setActive={setActiveTab}
        onUsuarioUpdate={(nextUsuario) => setUsuario((prev) => ({ ...(prev || {}), ...(nextUsuario || {}) }))}
        unreadTotal={unreadTotal}
        estadosUsuarios={estadosUsuarios}
      />

      {activeTab === "chat" && (
        <ChatList
          onSelectChat={setSelectedChat}
          selectedChat={selectedChat}
          setSelectedChat={setSelectedChat}
          userId={usuario?.id}
          addToListTarget={addToListTarget}
          onAddToListHandled={() => setAddToListTarget(null)}
          onUnreadTotalChange={setUnreadTotal}
          estadosUsuarios={estadosUsuarios}
        />
      )}
      {activeTab === "edit" && (
        <CreateChat proyectoId={usuario?.proyectoId} usuarioId={usuario?.id} />
      )}
      {activeTab === "add-user" && (
        <div className="flex-1">
          <AddUsers
            proyectos={proyectos}        // 👈 AHORA SÍ SE PASAN LOS PROYECTOS
            onCancel={() => setActive("chat")}
          />
        </div>
      )}
      {activeTab === "edit-user" && (
        <div className="flex-1">
          <EditUsers
            proyectos={proyectos}
            usuarioLogueado={usuario}  // 👈 AQUI LO MANDAS
            onCancel={() => setActive("chat")}
          />
        </div>
      )}                     

      {activeTab === "users" && <div>Users list</div>}

      {/* ===========================
        📌 5. CHATBOX (solo si activeTab === "chat")
        =========================== */}
      {activeTab === "chat" && (
        <div className="wa-chat-stage flex-1">
          {selectedChat ? (
            <ChatBox
              chat={selectedChat}
              user={usuario}
              setChat={setSelectedChat}  // 👈 Agregamos esto
              onVerPerfil={(u) => {
                setPerfilSeleccionado(u);
                setShowModal(true);
              }}
              onAddToList={(chatToAdd) => setAddToListTarget(chatToAdd)}
              estadosUsuarios={estadosUsuarios}
            />
          ) : (
            <div className="d-flex flex-column h-100 justify-content-center text-center">
              <div className="mb-6">
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
                    className="feather feather-message-square"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </span>
              </div>

              <p className="text-muted">
                Elige una persona del menú de la izquierda, <br /> y comienza una
                conversación.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 🔹 Modal de perfil */}
      <ProfileModal
        usuario={perfilSeleccionado}
        miUsuario={usuario}
        show={showModal}
        onClose={() => setShowModal(false)}
        onLogout={() => {
          localStorage.removeItem("usuario");
          navigate("/");
        }}
        onEnviarMensaje={(usuarioDestino) => {
          setSelectedChat({
            tipo: "privado",
            usuario_id: usuarioDestino.id,
            usuario_nombre: `${usuarioDestino.nombre} ${usuarioDestino.apellido}`, // 👈 aquí
            apellido: usuarioDestino.apellido,
            url_imagen: usuarioDestino.url_imagen,
            background: usuarioDestino.background,
            correo: usuarioDestino.correo,
          });
          setShowModal(false);
        }}
      />
    </div>
  );
};

export default Messenger;