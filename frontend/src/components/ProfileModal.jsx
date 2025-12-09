// components/ProfileModal.js
import React from "react";
import { getAvatarUrl } from "../utils/url";

const ProfileModal = ({ usuario, miUsuario, show, onClose, onLogout, onEnviarMensaje }) => {
  if (!show) return null;

  const getInitial = (correo) => correo?.charAt(0).toUpperCase();

  const esMiPerfil = usuario?.id === miUsuario?.id;

  return (
    <div
      className="modal fade show d-block"
      tabIndex="-1"
      role="dialog"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div className="modal-dialog modal-dialog-centered modal-fullscreen-xl-down">
        <div className="modal-content">
          <div className="modal-body py-0">
            <div className="profile modal-gx-n">

              {/* Fondo SVG superior */}
              <div className="profile-img text-primary rounded-top-xl position-relative">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="currentColor"
                  viewBox="0 0 400 140.74"
                >
                  <defs>
                    <style>{`.cls-2{fill:#fff;opacity:0.1;}`}</style>
                  </defs>
                    <g>
                      <g>
                        <path d="M400,125A1278.49,1278.49,0,0,1,0,125V0H400Z" />
                        {/* Este path puedes completarlo según tu diseño */}
                        <path className="cls-2" d="M361.13,128c.07.83.15,1.65.27,2.46h0Q380.73,128,400,125V87l-1,0a38,38,0,0,0-38,38c0,.86,0,1.71.09,2.55C361.11,127.72,361.12,127.88,361.13,128Z"></path>
                        <path className="cls-2" d="M12.14,119.53c.07.79.15,1.57.26,2.34v0c.13.84.28,1.66.46,2.48l.07.3c.18.8.39,1.59.62,2.37h0q33.09,4.88,66.36,8,.58-1,1.09-2l.09-.18a36.35,36.35,0,0,0,1.81-4.24l.08-.24q.33-.94.6-1.9l.12-.41a36.26,36.26,0,0,0,.91-4.42c0-.19,0-.37.07-.56q.11-.86.18-1.73c0-.21,0-.42,0-.63,0-.75.08-1.51.08-2.28a36.5,36.5,0,0,0-73,0c0,.83,0,1.64.09,2.45C12.1,119.15,12.12,119.34,12.14,119.53Z"></path>
                        <circle className="cls-2" cx="94.5" cy="57.5" r="22.5"></circle>
                        <path className="cls-2" d="M276,0a43,43,0,0,0,43,43A43,43,0,0,0,362,0Z"></path>
                      </g>
                    </g>
                </svg>

                {/* Botón de cerrar */}
                <div className="position-absolute top-0 start-0 py-6 px-5">
                  <button
                    type="button"
                    className="btn-close btn-close-white btn-close-arrow opacity-100"
                    data-bs-dismiss="modal" 
                    aria-label="Close"
                    onClick={onClose}
                  ></button>
                </div>
              </div>

              {/* Información del usuario */}
              <div className="profile-body text-center">
                <div className="d-flex justify-content-center">
                  <div className="avatar avatar-xl">
                    {usuario?.url_imagen ? (
                      <img
                        src={getAvatarUrl(usuario.url_imagen)}
                        alt="User"
                        className="rounded-circle border border-warning"
                        style={{ width: "74px", height: "74px", objectFit: "cover" }}
                      />
                    ) : (
                      <div
                        className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                        style={{
                          width: "74px",
                          height: "74px",
                          backgroundColor: usuario?.background,
                          fontSize: "27px",
                        }}
                      >
                        {getInitial(usuario?.nombre || "U")}
                      </div>
                    )}
                  </div>
                </div>
                <h4 className="mb-1">
                  {usuario?.nombre || usuario?.apellido
                    ? `${usuario?.nombre || ""} ${usuario?.apellido || ""}`.trim()
                    : "Nombre no disponible"}
                </h4>
                {/*<p>Última conexión hace 5 minutos</p>*/}
              </div>
            </div>

            <hr className="hr-bold modal-gx-n my-0" />

            {/* Detalles adicionales */}
            <ul className="list-group list-group-flush">
              <li className="list-group-item">
                <div className="row align-items-center gx-6">
                  <div className="col">
                    <h5>E-mail</h5>
                    <p>{usuario?.correo || "correo@ejemplo.com"}</p>
                  </div>
                  {/* ICONO */}
                  <div className="col-auto">
                      <div className="btn btn-sm btn-icon btn-dark">
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            width="24" height="24" viewBox="0 0 24 24" 
                            fill="none" stroke="currentColor" 
                            strokeWidth="2" 
                            strokeLinecap="round" 
                            strokeLinejoin="round" 
                            className="feather feather-mail"
                          >
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                          <polyline points="22,6 12,13 2,6"></polyline>
                          </svg>
                      </div>
                  </div>

                </div>

              </li>
              {/* CELULAR */}
              <li className="list-group-item">
                <div className="row align-items-center gx-6">
                  <div className="col">
                    <h5>Celular</h5>
                    <p>1-800-275-2273</p>
                  </div>

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
                        className="feather feather-phone-call"
                      >
                        <path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                      </svg>
                    </div>
                  </div>
                </div>
              </li>
              
            </ul>
            <hr className="hr-bold modal-gx-n my-0" />

            <ul className="list-group list-group-flush">
              <li className="list-group-item">
                {esMiPerfil ? (
                  <button onClick={onLogout} className="btn btn-link text-danger">
                    Cerrar Sesión
                  </button>
                ) : (
                  <button
                    onClick={() => onEnviarMensaje(usuario)}
                    className="btn btn-link "
                  >
                    Enviar mensaje
                  </button>
                )}
              </li>
            </ul>

          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
