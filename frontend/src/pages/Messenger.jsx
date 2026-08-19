import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom'; // 👈
import { logDev } from "../utils/logger";
import "../css/MessengerShell.css";
import Sidebar from './Sidebar';
import ChatList from './ChatList';
import socket, { conectarUsuarioSocket, emitirActividadUsuario } from "../socket";

const ChatBox = lazy(() => import('./ChatBox'));
const CreateChat = lazy(() => import('../components/CreateChat'));
const ProfileModal = lazy(() => import("../components/ProfileModal"));
const AddUsers = lazy(() => import("../components/AddUsers"));
const EditUsers = lazy(() => import("../components/EditUsers"));

const LazyPanelFallback = () => (
  <div className="flex-1 d-flex align-items-center justify-content-center">
    <div className="spinner-border" role="status" aria-label="Cargando">
      <span className="visually-hidden">Cargando...</span>
    </div>
  </div>
);

const ChatBoxFallback = () => (
  <div className="d-flex align-items-center justify-content-center h-100 w-100">
    <div className="spinner-border" role="status" aria-label="Cargando conversación">
      <span className="visually-hidden">Cargando conversación...</span>
    </div>
  </div>
);

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
  const selectedChatRef = useRef(null);

  const isMobileViewport = useCallback(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  ), []);

  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  // Expone al CSS si una conversación móvil está abierta. En iPhone esto
  // permite bloquear el documento y dejar que sólo el chat use VisualViewport.
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const root = document.documentElement;
    const syncChatOpenClass = () => {
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      root.classList.toggle("qc-mobile-chat-open", Boolean(selectedChat) && mobile);
    };

    syncChatOpenClass();
    window.addEventListener("resize", syncChatOpenClass);

    return () => {
      window.removeEventListener("resize", syncChatOpenClass);
      root.classList.remove("qc-mobile-chat-open");
    };
  }, [selectedChat]);

  // Mantiene el alto REAL del navegador móvil.
  // Safari/iPhone no siempre redimensiona el layout viewport cuando aparece
  // el teclado. VisualViewport sí conoce el área visible y evitamos que Safari
  // "empuje" toda la conversación fuera de la pantalla al enfocar el editor.
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;

    const root = document.documentElement;
    const viewport = window.visualViewport;
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/i.test(ua)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    let rafId = 0;
    let focusTimer = 0;
    let viewportBaseline = Math.max(
      Math.round(window.innerHeight || 0),
      Math.round(viewport?.height || 0),
      Math.round(document.documentElement.clientHeight || 0)
    );

    root.classList.toggle("qc-ios", isIOS);

    const syncViewport = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const height = Math.max(
          1,
          Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0)
        );
        const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
        const mobile = window.matchMedia("(max-width: 767px)").matches;

        // Guardamos la altura normal más grande para distinguir teclado de
        // pequeños cambios de las barras de Safari.
        if (!root.classList.contains("qc-composer-focused") && height > viewportBaseline - 80) {
          viewportBaseline = Math.max(viewportBaseline, height);
        }

        const keyboardHeight = Math.max(0, viewportBaseline - height);
        const keyboardOpen =
          mobile
          && root.classList.contains("qc-composer-focused")
          && keyboardHeight >= 120;

        root.style.setProperty("--qc-mobile-vh", `${height}px`);
        root.style.setProperty("--qc-mobile-vtop", `${offsetTop}px`);
        root.style.setProperty("--qc-mobile-vbottom", `${Math.max(0, offsetTop + height)}px`);
        root.style.setProperty("--qc-mobile-keyboard-height", `${keyboardHeight}px`);
        root.classList.toggle("qc-mobile-keyboard-open", keyboardOpen);
      });
    };

    const isComposerTarget = (target) => (
      target instanceof Element
      && Boolean(target.closest(".wa-chat-form"))
      && (
        target.matches(".wa-rich-editor, textarea, input")
        || Boolean(target.closest(".wa-rich-editor"))
      )
    );

    const handleFocusIn = (event) => {
      if (!isComposerTarget(event.target)) return;

      root.classList.add("qc-composer-focused");
      syncViewport();

      // Safari actualiza VisualViewport en varias etapas al abrir el teclado.
      // No usamos window.scrollTo(): en iOS puede producir un salto negro del
      // viewport. Sólo re-sincronizamos las dimensiones visibles.
      if (isIOS) {
        requestAnimationFrame(syncViewport);
        window.clearTimeout(focusTimer);

        // Safari anima el teclado y el offset del VisualViewport en varias
        // etapas. Recalculamos durante esa animación para que el composer
        // permanezca visible sin que el usuario tenga que arrastrar la página.
        window.setTimeout(syncViewport, 60);
        window.setTimeout(syncViewport, 140);
        focusTimer = window.setTimeout(syncViewport, 280);
      }
    };

    const handleFocusOut = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        const active = document.activeElement;
        if (!isComposerTarget(active)) {
          root.classList.remove("qc-composer-focused");
          syncViewport();
        }
      }, 120);
    };

    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    window.addEventListener("resize", syncViewport);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(focusTimer);
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
      window.removeEventListener("resize", syncViewport);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      root.classList.remove(
        "qc-ios",
        "qc-mobile-keyboard-open",
        "qc-composer-focused"
      );
      root.style.removeProperty("--qc-mobile-vtop");
      root.style.removeProperty("--qc-mobile-vbottom");
      root.style.removeProperty("--qc-mobile-keyboard-height");
    };
  }, []);

  const handleSelectChat = useCallback((nextChat) => {
    if (!nextChat) return;

    setActiveTab("chat");

    if (isMobileViewport() && !window.history.state?.quickchatMobileChat) {
      window.history.pushState(
        { ...(window.history.state || {}), quickchatMobileChat: true },
        "",
        window.location.href
      );
    }

    setSelectedChat(nextChat);
  }, [isMobileViewport]);

  const handleCloseChat = useCallback(() => {
    if (isMobileViewport() && window.history.state?.quickchatMobileChat) {
      window.history.back();
      return;
    }

    setSelectedChat(null);
  }, [isMobileViewport]);

  // El botón Atrás de Android/Chrome cierra la conversación antes de abandonar /mensajes.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handlePopState = () => {
      if (isMobileViewport() && selectedChatRef.current) {
        setSelectedChat(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isMobileViewport]);

  const setSelectedChatFromList = useCallback((nextChat) => {
    if (typeof nextChat === "function") {
      setSelectedChat((prev) => nextChat(prev));
      return;
    }

    if (nextChat) {
      handleSelectChat(nextChat);
    } else {
      handleCloseChat();
    }
  }, [handleCloseChat, handleSelectChat]);

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
      logDev("✅ Usuario cargado desde localStorage", { usuarioId: parsedUser?.id });
    } else {
      navigate('/', { replace: true });
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
      navigate("/", { replace: true });
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

  return (
    <div className={`flex h-screen bg-[#f8f9fd] wa-messenger-root ${selectedChat ? "has-selected-chat" : "no-selected-chat"} active-tab-${activeTab}`}>
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
          onSelectChat={handleSelectChat}
          selectedChat={selectedChat}
          setSelectedChat={setSelectedChatFromList}
          userId={usuario?.id}
          addToListTarget={addToListTarget}
          onAddToListHandled={() => setAddToListTarget(null)}
          onUnreadTotalChange={setUnreadTotal}
          estadosUsuarios={estadosUsuarios}
        />
      )}
      {activeTab === "edit" && (
        <Suspense fallback={<LazyPanelFallback />}>
          <CreateChat proyectoId={usuario?.proyectoId} usuarioId={usuario?.id} />
        </Suspense>
      )}
      {activeTab === "add-user" && (
        <div className="flex-1">
          <Suspense fallback={<LazyPanelFallback />}>
            <AddUsers
              proyectos={proyectos}        // 👈 AHORA SÍ SE PASAN LOS PROYECTOS
              onCancel={() => setActive("chat")}
            />
          </Suspense>
        </div>
      )}
      {activeTab === "edit-user" && (
        <div className="flex-1">
          <Suspense fallback={<LazyPanelFallback />}>
            <EditUsers
              proyectos={proyectos}
              usuarioLogueado={usuario}  // 👈 AQUI LO MANDAS
              onCancel={() => setActive("chat")}
            />
          </Suspense>
        </div>
      )}                     

      {activeTab === "users" && <div>Users list</div>}

      {/* ===========================
        📌 5. CHATBOX (solo si activeTab === "chat")
        =========================== */}
      {activeTab === "chat" && (
        <div className="wa-chat-stage flex-1">
          {selectedChat ? (
            <Suspense fallback={<ChatBoxFallback />}>
              <ChatBox
                chat={selectedChat}
                user={usuario}
                setChat={setSelectedChat}  // Cambios internos entre conversaciones
                onCloseChat={handleCloseChat}
                onVerPerfil={(u) => {
                  setPerfilSeleccionado(u);
                  setShowModal(true);
                }}
                onAddToList={(chatToAdd) => setAddToListTarget(chatToAdd)}
                estadosUsuarios={estadosUsuarios}
              />
            </Suspense>
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
      {showModal && (
        <Suspense fallback={null}>
          <ProfileModal
            usuario={perfilSeleccionado}
            miUsuario={usuario}
            show={showModal}
            onClose={() => setShowModal(false)}
            onLogout={() => {
              localStorage.removeItem("usuario");
              navigate("/", { replace: true });
            }}
            onEnviarMensaje={(usuarioDestino) => {
              handleSelectChat({
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
        </Suspense>
      )}
    </div>
  );
};

export default Messenger;