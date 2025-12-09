import React, { useMemo, useState } from "react";
import { toLocalDate } from "../utils/date"; // 👈 importa tu función

const VerArchivos = ({ chat, visible, onClose }) => {
  const [tabActiva, setTabActiva] = useState("multimedia");
  const [seleccionados, setSeleccionados] = useState([]);
  // 🔹 Ajustar URL para rutas relativas
  const fixUrl = (url) => url.startsWith("http") ? url : `/api${url.startsWith("/") ? "" : "/"}${url}`;

  const imagenes = chat.archivos?.filter((a) =>
    /\.(jpg|jpeg|png|gif)$/i.test(a.archivo_url)
  ) || [];

  // 🔹 Filtrar solo archivos tipo documento (no imágenes ni videos)
  const documentos = chat.archivos?.filter((a) =>
    /\.(pdf|docx?|xlsx?|zip|rar|txt)$/i.test(a.archivo_url)
  ) || [];

   // 🔹 Obtener nombre del mes (en español) o “ESTE MES”
  const getMesNombre = (fechaEnvio) => {
    const meses = [
      "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
      "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
    ];

    const fecha = toLocalDate(fechaEnvio);
    if (!fecha || isNaN(fecha.getTime())) return "DESCONOCIDO";

    const mes = fecha.getMonth();
    const año = fecha.getFullYear();

    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const añoActual = hoy.getFullYear();

    if (mes === mesActual && año === añoActual) return "ESTE MES";
    return meses[mes];
  };

  // 🔹 Agrupar imágenes por mes
  const imagenesPorMes = useMemo(() => {
    const grupos = {};

    imagenes.forEach((img) => {
      const mes = getMesNombre(img.fecha_envio);
      if (!grupos[mes]) grupos[mes] = [];
      grupos[mes].push(img);
    });

    // Ordenar meses (ESTE MES primero)
    const mesesOrden = Object.keys(grupos).sort((a, b) => {
      if (a === "ESTE MES") return -1;
      if (b === "ESTE MES") return 1;

      const meses = {
        ENERO: 0, FEBRERO: 1, MARZO: 2, ABRIL: 3, MAYO: 4, JUNIO: 5,
        JULIO: 6, AGOSTO: 7, SEPTIEMBRE: 8, OCTUBRE: 9, NOVIEMBRE: 10, DICIEMBRE: 11,
      };
      return meses[b] - meses[a]; // más reciente primero
    });

    return mesesOrden.map((mes) => ({
      mes,
      archivos: grupos[mes],
    }));
  }, [imagenes]);

   // 🔹 Agrupar documentos por mes
  const documentosPorMes = useMemo(() => {
    const grupos = {};
    documentos.forEach((doc) => {
      const mes = getMesNombre(doc.fecha_envio);
      if (!grupos[mes]) grupos[mes] = [];
      grupos[mes].push(doc);
    });

    const mesesOrden = Object.keys(grupos).sort((a, b) => {
      if (a === "ESTE MES") return -1;
      if (b === "ESTE MES") return 1;
      const orden = {
        ENERO: 0, FEBRERO: 1, MARZO: 2, ABRIL: 3, MAYO: 4, JUNIO: 5,
        JULIO: 6, AGOSTO: 7, SEPTIEMBRE: 8, OCTUBRE: 9, NOVIEMBRE: 10, DICIEMBRE: 11
      };
      return orden[b] - orden[a];
    });

    return mesesOrden.map((mes) => ({ mes, archivos: grupos[mes] }));
  }, [documentos]);

   // ✅ Manejo selección de documentos
  const toggleSeleccion = (id) => {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleDescargar = async (urlArchivo, nombreLimpio) => {
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
    <div
      className={`fixed top-0 right-0 h-full bg-white shadow-lg border-l border-gray-200 transition-transform duration-300 ease-in-out z-50 ${
        visible ? "translate-x-0" : "translate-x-full"
      }`}
      style={{ width: "400px" }}
    >
      {/* 🔹 Header */}
      <div className="profile-img text-primary rounded-top">
        
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          viewBox="0 0 400 140.74"
        >
          <defs>
            <style>{".cls-2{fill:#fff;opacity:0.1;}"}</style>
          </defs>
                          
          <g>
            <g>
              <path d="M400,125A1278.49,1278.49,0,0,1,0,125V0H400Z"></path>
                <path
                  className="cls-2"
                  d="M361.13,128c.07.83.15,1.65.27,2.46h0Q380.73,128,400,125V87l-1,0a38,38,0,0,0-38,38c0,.86,0,1.71.09,2.55C361.11,127.72,361.12,127.88,361.13,128Z"
                ></path>
                <path
                  className="cls-2"
                  d="M12.14,119.53c.07.79.15,1.57.26,2.34v0c.13.84.28,1.66.46,2.48l.07.3c.18.8.39,1.59.62,2.37h0q33.09,4.88,66.36,8,.58-1,1.09-2l.09-.18a36.35,36.35,0,0,0,1.81-4.24l.08-.24q.33-.94.6-1.9l.12-.41a36.26,36.26,0,0,0,.91-4.42c0-.19,0-.37.07-.56q.11-.86.18-1.73c0-.21,0-.42,0-.63,0-.75.08-1.51.08-2.28a36.5,36.5,0,0,0-73,0c0,.83,0,1.64.09,2.45C12.1,119.15,12.12,119.34,12.14,119.53Z"
                ></path>
                  <circle className="cls-2" cx="94.5" cy="57.5" r="22.5"></circle>
                <path
                  className="cls-2"
                  d="M276,0a43,43,0,0,0,43,43A43,43,0,0,0,362,0Z"
                ></path>
            </g>
            
          </g>
        </svg>
        <div className="absolute top-0 left-0 w-full flex items-center justify-between px-4 py-3 text-white">
        
          <div className="position-absolute top-0 start-0 py-6 px-5">
            <button
              onClick={onClose}
              className="flex items-center gap-2 hover:text-gray-900 transition btn-close btn-close-white"
            >
              
            </button>
            <span className="position-absolute top-5 start-0 ml-20 text-white font-semibold text-base whitespace-nowrap">Archivos</span>
          </div>
        </div>
      </div>

      {/* 🔹 Tabs */}
      <div className="bg-white rounded-pill shadow-sm d-flex text-sm font-semibold">
        <button
          onClick={() => setTabActiva("multimedia")}
          className={`flex-1 py-2 transition ${
            tabActiva === "multimedia"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-gray-500 hover:text-blue-500"
          } focus:outline-none`}
        >
          Archivos multimedia
        </button>

        <button
          onClick={() => setTabActiva("documentos")}
          className={`flex- py-2 transition ${
            tabActiva === "documentos"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-gray-500 hover:text-blue-500"
          } focus:outline-none`}
        >
          Documentos
        </button>

        <button
          onClick={() => setTabActiva("enlaces")}
          className={`flex-1 py-2 transition ${
            tabActiva === "enlaces"
              ? "border-b-2 border-blue-500 text-blue-600"
              : "text-gray-500 hover:text-blue-500"
          } focus:outline-none`}
        >
          Enlaces
        </button>
      </div>

      {/* 🔹 Contenido dinámico */}
      <div className="p-4 overflow-y-auto h-[calc(100%-110px)]">
        {/* --- 🖼 Archivos multimedia --- */}
        {tabActiva === "multimedia" && (
          <>
            {imagenesPorMes.map(({ mes, archivos }) => (
              <div key={mes} className="mb-6">
                <h2 className="text-[11px] text-gray-500 font-semibold mb-2">{mes}</h2>
                <div className="grid grid-cols-3 gap-2">
                  {archivos.map((a) => (
                    <div
                      key={a.id}
                      className="relative rounded-lg cursor-pointer group"
                    >
                      <img
                        src={fixUrl(a.archivo_url)}
                        alt={a.nombre_archivo}
                        className="w-full h-28 object-cover group-hover:opacity-90 transition"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {/* --- 📄 Documentos --- */}
        {tabActiva === "documentos" && 
          documentosPorMes.map(({ mes, archivos }) => (
            <div key={mes} className="mb-6">
              <h2 className="text-[11px] text-gray-500 font-semibold mb-2">{mes}</h2>
              <div className="space-y-3">
                {archivos.map((doc) => {
                  const urlArchivo = fixUrl(doc.archivo_url);
                  const nombreLimpio = (doc.nombre_archivo || "").replace(/^\d+_/, "");
                  const fecha = toLocalDate(doc.fecha_envio);
                  const fechaTexto = fecha
                    ? fecha.toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "";

                  return (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 p-3 border rounded-lg transition ${
                        seleccionados.includes(doc.id)
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={seleccionados.includes(doc.id)}
                        onChange={() => toggleSeleccion(doc.id)}
                        className="w-4 h-4 accent-blue-500 cursor-pointer"
                      />
                      <div className="flex-2">
                        <div className="flex items-center gap-2">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-gray-600"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-gray-800 truncate max-w-[180px]">
                              {nombreLimpio}
                            </p>
                            <p className="text-xs text-gray-500">{fechaTexto}</p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDescargar(urlArchivo, nombreLimpio)}
                        className="p-2 rounded-full hover:bg-gray-200 transition"
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
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
        ))}

        {/* --- 🔗 Enlaces (a futuro) --- */}
        {tabActiva === "enlaces" && (
          <p className="text-sm text-gray-500 text-center mt-5">No hay enlaces aún.</p>
        )}
      </div>
    </div>
  );
};

export default VerArchivos;