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
import socket from "../socket";

const Messenger = () => {
  const [selectedChat, setSelectedChat] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [activeTab, setActiveTab] = useState("chat"); // 👈 pestaña activa
  const [perfilSeleccionado, setPerfilSeleccionado] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('usuario');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      // Convertir permisos_chat SI VIENE COMO STRING
      if (typeof parsedUser.permisos_chat === "string") {
        parsedUser.permisos_chat = JSON.parse(parsedUser.permisos_chat);
      }
      // Permisos rol
      if (typeof parsedUser.rol_permisos === "string") {
        parsedUser.rol_permisos = JSON.parse(parsedUser.rol_permisos);
      }

      setUsuario(parsedUser);
      logDev("✅ Usuario cargado desde localStorage:", parsedUser);
      
    } else {
      // ❌ Si no hay usuario, redirigir al login
      navigate('/');
    }
  }, []);

  // Cargar proyectos activos del backend
  useEffect(() => {
    const cargarProyectos = async () => {
      try {
        const res = await fetch("/api/proyecto");
        const data = await res.json();
        setProyectos(data);
        console.log("📌 Proyectos cargados:", data);
      } catch (err) {
        console.error("❌ Error cargando proyectos:", err);
      }
    };

    cargarProyectos();
  }, []);

  // 🔹 2. Una vez que tengamos usuario.id, pedir su proyectoId al backend
  useEffect(() => {
    if (usuario?.id) {
      const fetchProyectoId = async () => {
        try {
          const res = await fetch(`/api/grupos/${usuario.id}/proyecto`);
          const data = await res.json();
          logDev("👉 proyectoId del usuario:", data.proyectoId);
          logDev("📡 Proyecto cargado para usuario:", data);
          setUsuario((prev) => ({ ...prev, proyectoId: data.proyectoId }));
        } catch (err) {
          console.error("❌ Error trayendo proyecto:", err);
        }
      };

      fetchProyectoId();
    }
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


  return (
    <div className="flex h-screen bg-[#f8f9fd]">
      {/* Sidebar con iconos */}
      <Sidebar usuario={usuario} active={activeTab} setActive={setActiveTab} />
      
      {/* ===========================
          📌 1. CHAT LIST (solo si chat está activo)
          =========================== */}
      {activeTab === "chat" && (
        <ChatList
          onSelectChat={setSelectedChat}
          selectedChat={selectedChat}
          setSelectedChat={setSelectedChat}
          userId={usuario?.id}
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
        <div className="flex-1">
          {selectedChat ? (
            <ChatBox
              chat={selectedChat}
              user={usuario}
              setChat={setSelectedChat}  // 👈 Agregamos esto
              onOpenMembers={() => setIsMembersOpen(true)}
              onVerPerfil={(u) => {
                setPerfilSeleccionado(u);
                setShowModal(true);
              }}
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