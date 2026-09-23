import React, { useEffect, useMemo, useState } from "react";
import { toLocalDate } from "../utils/date";
import { getAvatarUrl } from "../utils/url";

const IMAGE_RE = /\.(avif|bmp|gif|jpe?g|png|webp)(?:$|[?#])/i;
const VIDEO_RE = /\.(m4v|mov|mp4|mpeg|mpg|webm)(?:$|[?#])/i;
const DOC_RE = /\.(docx?|pdf|pptx?|rar|rtf|txt|xlsx?|zip)(?:$|[?#])/i;

const MONTHS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

const VerArchivos = ({ chat, visible, onClose, embedded = false, loading = false, error = "" }) => {
  const [tabActiva, setTabActiva] = useState("multimedia");
  const [seleccionados, setSeleccionados] = useState([]);

  const chatKey = chat?.grupo_id || chat?.usuario_id || chat?.id || "chat";

  useEffect(() => {
    setTabActiva("multimedia");
    setSeleccionados([]);
  }, [chatKey]);

  const fixUrl = (url = "") => {
    if (!url) return "";

    if (/^https?:\/\//i.test(url)) {
      return getAvatarUrl(url) || url.replace("http://", "https://");
    }

    if (url.startsWith("/api/uploads/")) {
      return getAvatarUrl(url.replace("/api", "")) || url.replace("/api", "");
    }

    if (url.startsWith("/uploads/")) {
      return getAvatarUrl(url) || url;
    }

    if (url.startsWith("uploads/")) {
      return getAvatarUrl(`/${url}`) || `/${url}`;
    }

    return url;
  };

  const allFiles = useMemo(
    () => (Array.isArray(chat?.archivos) ? chat.archivos : []),
    [chat?.archivos]
  );

  const isImage = (file = {}) => {
    const mime = String(file.tipo_archivo || file.mime || "").toLowerCase();
    return mime.startsWith("image/") || IMAGE_RE.test(file.archivo_url || file.nombre_archivo || "");
  };

  const isVideo = (file = {}) => {
    const mime = String(file.tipo_archivo || file.mime || "").toLowerCase();
    return mime.startsWith("video/") || VIDEO_RE.test(file.archivo_url || file.nombre_archivo || "");
  };

  const isDocument = (file = {}) => {
    if (isImage(file) || isVideo(file)) return false;
    const mime = String(file.tipo_archivo || file.mime || "").toLowerCase();
    if (mime && !mime.startsWith("image/") && !mime.startsWith("video/") && !mime.startsWith("audio/")) {
      return true;
    }
    return DOC_RE.test(file.archivo_url || file.nombre_archivo || "");
  };

  const multimedia = useMemo(
    () => allFiles.filter((file) => isImage(file) || isVideo(file)),
    [allFiles]
  );

  const documentos = useMemo(
    () => allFiles.filter(isDocument),
    [allFiles]
  );

  const enlaces = useMemo(() => {
    const raw = Array.isArray(chat?.enlaces) ? chat.enlaces : [];
    return raw.filter(Boolean);
  }, [chat?.enlaces]);

  const getFileDate = (item = {}) =>
    toLocalDate(item.fecha_envio || item.fecha || item.created_at || item.fecha_creacion);

  const groupByMonth = (items) => {
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const groups = new Map();

    items.forEach((item) => {
      const date = getFileDate(item);
      const valid = date && !Number.isNaN(date.getTime());
      const year = valid ? date.getFullYear() : 0;
      const month = valid ? date.getMonth() : -1;
      const key = valid ? `${year}-${String(month + 1).padStart(2, "0")}` : "unknown";

      if (!groups.has(key)) groups.set(key, { key, year, month, items: [] });
      groups.get(key).items.push(item);
    });

    return [...groups.values()]
      .sort((a, b) => {
        if (a.key === "unknown") return 1;
        if (b.key === "unknown") return -1;
        return b.key.localeCompare(a.key);
      })
      .map((group) => {
        let label = "SIN FECHA";
        if (group.key === currentKey) {
          label = "ESTE MES";
        } else if (group.month >= 0) {
          label = MONTHS[group.month];
          if (group.year !== now.getFullYear()) label += ` ${group.year}`;
        }

        return {
          ...group,
          label,
          items: [...group.items].sort((a, b) => {
            const aDate = getFileDate(a)?.getTime() || 0;
            const bDate = getFileDate(b)?.getTime() || 0;
            return bDate - aDate;
          }),
        };
      });
  };

  const multimediaPorMes = useMemo(() => groupByMonth(multimedia), [multimedia]);
  const documentosPorMes = useMemo(() => groupByMonth(documentos), [documentos]);
  const enlacesPorMes = useMemo(() => groupByMonth(enlaces), [enlaces]);

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  };

  const handleDescargar = async (urlArchivo, nombreLimpio) => {
    try {
      const response = await fetch(urlArchivo);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = nombreLimpio || "archivo";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("❌ Error al descargar:", error);
      window.open(urlArchivo, "_blank", "noopener,noreferrer");
    }
  };

  const openMedia = (file) => {
    const url = fixUrl(file?.archivo_url);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const cleanFileName = (file = {}) => {
    const raw = file.nombre_archivo || String(file.archivo_url || "").split("/").pop() || "Archivo";
    return String(raw).replace(/^\d+_/, "");
  };

  const formatDate = (value) => {
    const date = toLocalDate(value);
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatBytes = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / 1024 ** index;
    return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
  };

  const documentKind = (file = {}) => {
    const name = cleanFileName(file).toLowerCase();
    const mime = String(file.tipo_archivo || "").toLowerCase();
    if (name.endsWith(".pdf") || mime.includes("pdf")) return { label: "PDF", className: "pdf", icon: "fa-file-pdf" };
    if (/\.docx?$/.test(name) || mime.includes("word")) return { label: "DOC", className: "word", icon: "fa-file-word" };
    if (/\.xlsx?$/.test(name) || mime.includes("sheet") || mime.includes("excel")) return { label: "XLS", className: "excel", icon: "fa-file-excel" };
    if (/\.zip$|\.rar$/.test(name) || mime.includes("zip") || mime.includes("rar")) return { label: "ZIP", className: "archive", icon: "fa-file-zipper" };
    if (/\.txt$/.test(name) || mime.includes("text")) return { label: "TXT", className: "text", icon: "fa-file-lines" };
    return { label: "FILE", className: "generic", icon: "fa-file" };
  };

  const groupName = chat?.usuario_nombre || chat?.nombre || chat?.nombre_grupo || "Chat";
  const memberCount = Array.isArray(chat?.miembros)
    ? chat.miembros.length
    : Number(chat?.cantidad_miembros || chat?.miembros_count || 0);

  const renderEmpty = (type) => {
    const data = {
      multimedia: ["fa-images", "No hay archivos multimedia compartidos"],
      documentos: ["fa-file-lines", "No hay documentos compartidos"],
      enlaces: ["fa-link", "No hay enlaces compartidos"],
    }[type];

    return (
      <div className="wa-files-empty">
        <span className="wa-files-empty-icon"><i className={`fa-solid ${data[0]}`} aria-hidden="true" /></span>
        <strong>{data[1]}</strong>
        <span>Cuando se compartan elementos en este chat, aparecerán aquí.</span>
      </div>
    );
  };

  return (
    <section
      className={`${embedded ? "wa-files-panel-inline" : "wa-group-info-panel wa-files-panel-standalone"} ${visible ? "is-visible is-open" : ""}`}
      aria-hidden={!visible}
    >
      <header className="wa-files-header">
        <div className="wa-files-header-copy">
          <button
            type="button"
            className="wa-files-back-btn"
            onClick={onClose}
            title={embedded ? "Volver a Info. del grupo" : "Cerrar archivos"}
            aria-label={embedded ? "Volver a Info. del grupo" : "Cerrar archivos"}
          >
            <i className={`fa-solid ${embedded ? "fa-arrow-left" : "fa-xmark"}`} aria-hidden="true" />
          </button>
          <div className="wa-files-heading-text">
            <h2>Archivos</h2>
            <p>{groupName}</p>
            {memberCount > 0 && <span>{memberCount} {memberCount === 1 ? "miembro" : "miembros"}</span>}
          </div>
        </div>

        <div className="wa-files-folder-art" aria-hidden="true">
          <i className="fa-solid fa-folder" />
        </div>
      </header>

      <nav className="wa-files-tabs" aria-label="Categorías de archivos">
        <button
          type="button"
          onClick={() => setTabActiva("multimedia")}
          className={`wa-files-tab ${tabActiva === "multimedia" ? "is-active" : ""}`}
          aria-pressed={tabActiva === "multimedia"}
        >
          <i className="fa-regular fa-image" aria-hidden="true" />
          <span>Archivos<br />multimedia</span>
        </button>
        <button
          type="button"
          onClick={() => setTabActiva("documentos")}
          className={`wa-files-tab ${tabActiva === "documentos" ? "is-active" : ""}`}
          aria-pressed={tabActiva === "documentos"}
        >
          <i className="fa-regular fa-file-lines" aria-hidden="true" />
          <span>Documentos</span>
        </button>
        <button
          type="button"
          onClick={() => setTabActiva("enlaces")}
          className={`wa-files-tab ${tabActiva === "enlaces" ? "is-active" : ""}`}
          aria-pressed={tabActiva === "enlaces"}
        >
          <i className="fa-solid fa-link" aria-hidden="true" />
          <span>Enlaces</span>
        </button>
      </nav>

      <div className="wa-files-content">
        {loading ? (
          <div className="wa-files-empty">
            <span className="wa-files-empty-icon"><i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /></span>
            <strong>Cargando archivos compartidos…</strong>
            <span>Estamos sincronizando los recursos reales de este chat.</span>
          </div>
        ) : error ? (
          <div className="wa-files-empty">
            <span className="wa-files-empty-icon"><i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /></span>
            <strong>No se pudieron cargar los archivos</strong>
            <span>{error}</span>
          </div>
        ) : (<>
        {tabActiva === "multimedia" && (
          multimediaPorMes.length ? multimediaPorMes.map((group) => (
            <section key={group.key} className="wa-files-month-section">
              <div className="wa-files-month-heading">
                <h3>{group.label}</h3>
                <span>{group.items.length} {group.items.length === 1 ? "archivo" : "archivos"}</span>
              </div>
              <div className="wa-files-media-grid">
                {group.items.map((file, index) => {
                  const url = fixUrl(file.archivo_url);
                  const video = isVideo(file);
                  return (
                    <button
                      type="button"
                      key={file.id || `${file.archivo_url}-${index}`}
                      className="wa-files-media-item"
                      onClick={() => openMedia(file)}
                      title={cleanFileName(file)}
                    >
                      {video ? (
                        <video src={url} muted preload="metadata" playsInline />
                      ) : (
                        <img src={url} alt={cleanFileName(file)} loading="lazy" />
                      )}
                      {video && <span className="wa-files-video-badge"><i className="fa-solid fa-play" /></span>}
                    </button>
                  );
                })}
              </div>
            </section>
          )) : renderEmpty("multimedia")
        )}

        {tabActiva === "documentos" && (
          documentosPorMes.length ? documentosPorMes.map((group) => (
            <section key={group.key} className="wa-files-month-section">
              <div className="wa-files-month-heading">
                <h3>{group.label}</h3>
                <span>{group.items.length} {group.items.length === 1 ? "archivo" : "archivos"}</span>
              </div>
              <div className="wa-files-doc-list">
                {group.items.map((doc, index) => {
                  const url = fixUrl(doc.archivo_url);
                  const name = cleanFileName(doc);
                  const kind = documentKind(doc);
                  const id = doc.id || `${doc.archivo_url}-${index}`;
                  return (
                    <article key={id} className={`wa-files-doc-row ${seleccionados.includes(id) ? "is-selected" : ""}`}>
                      <button
                        type="button"
                        className={`wa-files-doc-icon ${kind.className}`}
                        onClick={() => toggleSeleccion(id)}
                        title={`Seleccionar ${name}`}
                      >
                        <i className={`fa-solid ${kind.icon}`} aria-hidden="true" />
                      </button>
                      <div className="wa-files-doc-copy">
                        <strong title={name}>{name}</strong>
                        <span>
                          {formatDate(doc.fecha_envio)}
                          {formatBytes(doc.tamano) && <> · {formatBytes(doc.tamano)}</>}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="wa-files-download-btn"
                        onClick={() => handleDescargar(url, name)}
                        title="Descargar"
                        aria-label={`Descargar ${name}`}
                      >
                        <i className="fa-solid fa-arrow-down-to-line" aria-hidden="true" />
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          )) : renderEmpty("documentos")
        )}

        {tabActiva === "enlaces" && (
          enlacesPorMes.length ? enlacesPorMes.map((group) => (
            <section key={group.key} className="wa-files-month-section">
              <div className="wa-files-month-heading">
                <h3>{group.label}</h3>
                <span>{group.items.length} {group.items.length === 1 ? "enlace" : "enlaces"}</span>
              </div>
              <div className="wa-files-link-list">
                {group.items.map((link, index) => {
                  const href = link.url || link.enlace || link.href || "";
                  let domain = link.dominio || "";
                  try { if (!domain && href) domain = new URL(href).hostname; } catch { domain = ""; }
                  return (
                    <a
                      key={link.id || `${href}-${index}`}
                      className="wa-files-link-row"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="wa-files-link-icon"><i className="fa-solid fa-link" /></span>
                      <span className="wa-files-link-copy">
                        <strong>{link.titulo || domain || href || "Enlace"}</strong>
                        <span>{domain || href}</span>
                        {(link.fecha_envio || link.usuario_nombre) && (
                          <small>{[link.usuario_nombre, formatDate(link.fecha_envio)].filter(Boolean).join(" · ")}</small>
                        )}
                      </span>
                      <i className="fa-solid fa-arrow-up-right-from-square wa-files-link-open" aria-hidden="true" />
                    </a>
                  );
                })}
              </div>
            </section>
          )) : renderEmpty("enlaces")
        )}
        </>)}
      </div>
    </section>
  );
};

export default VerArchivos;
