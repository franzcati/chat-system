import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import "bootstrap-icons/font/bootstrap-icons.css";
import PersonasGrupos from "./PersonasGrupos";
import { getAvatarUrl } from "../utils/url";
import { logDev } from "../utils/logger";
import "../css/CreateChat.css";

const MAX_DESCRIPTION_LENGTH = 300;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CROP_STAGE_FALLBACK_SIZE = 388;
const CROP_CIRCLE_INSET_RATIO = 0.085;
const CROP_OUTPUT_SIZE = 900;

const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);


const getCropOffsetLimit = (zoom, stageSize = CROP_STAGE_FALLBACK_SIZE) => {
  const safeStageSize = Math.max(Number(stageSize) || CROP_STAGE_FALLBACK_SIZE, 1);
  const safeZoom = Math.max(Number(zoom) || 1, 1);
  const circleSize = safeStageSize * (1 - CROP_CIRCLE_INSET_RATIO * 2);
  return Math.max((safeStageSize * safeZoom - circleSize) / 2, 0);
};

const clampCropOffsets = (zoom, offsetX, offsetY, stageSize = CROP_STAGE_FALLBACK_SIZE) => {
  const limit = getCropOffsetLimit(zoom, stageSize);
  return {
    offsetX: clamp(offsetX, -limit, limit),
    offsetY: clamp(offsetY, -limit, limit),
  };
};

const getInitials = (usuario) => {
  const nombre = String(usuario?.nombre || "").trim();
  const apellido = String(usuario?.apellido || "").trim();
  return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase() || "U";
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const buildCroppedImage = async (editor, stageSize = CROP_STAGE_FALLBACK_SIZE) => {
  const image = await loadImage(editor.previewUrl);
  const canvas = document.createElement("canvas");
  canvas.width = CROP_OUTPUT_SIZE;
  canvas.height = CROP_OUTPUT_SIZE;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  /*
   * El usuario compone la imagen dentro del círculo visible del editor,
   * no dentro de todo el cuadrado. La exportación usa exactamente el
   * diámetro del círculo para que el avatar final coincida con lo visto.
   */
  const safeStageSize = Math.max(Number(stageSize) || CROP_STAGE_FALLBACK_SIZE, 1);
  const circleSize = safeStageSize * (1 - CROP_CIRCLE_INSET_RATIO * 2);
  const outputRatio = CROP_OUTPUT_SIZE / circleSize;

  // Replica el object-fit: cover del <img> cuadrado del editor.
  const baseScale = Math.max(safeStageSize / image.width, safeStageSize / image.height);
  const finalScale = baseScale * editor.zoom * outputRatio;
  const drawWidth = image.width * finalScale;
  const drawHeight = image.height * finalScale;

  ctx.save();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(
    canvas.width / 2 + editor.offsetX * outputRatio,
    canvas.height / 2 + editor.offsetY * outputRatio
  );
  ctx.rotate((editor.rotation * Math.PI) / 180);
  ctx.scale(editor.flipX, editor.flipY);
  ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen recortada"));
    }, "image/png", 0.95);
  });
};

const buildGifPreviewCrop = (editor, stageSize = CROP_STAGE_FALLBACK_SIZE) => {
  const safeStageSize = Math.max(Number(stageSize) || CROP_STAGE_FALLBACK_SIZE, 1);
  const circleRatio = 1 - CROP_CIRCLE_INSET_RATIO * 2;
  const circleSize = safeStageSize * circleRatio;

  /*
   * El GIF no se rasteriza para no perder su animación. En su lugar
   * reproducimos en el avatar exactamente la misma ventana circular del editor.
   * El editor dibuja la imagen sobre todo el cuadrado y el círculo ocupa solo
   * circleRatio de ese cuadrado; por eso el avatar necesita ese factor extra.
   */
  return {
    zoom: Math.max(Number(editor?.zoom) || 1, 1) / circleRatio,
    rotation: Number(editor?.rotation) || 0,
    flipX: Number(editor?.flipX) || 1,
    flipY: Number(editor?.flipY) || 1,
    offsetXPercent: ((Number(editor?.offsetX) || 0) / circleSize) * 100,
    offsetYPercent: ((Number(editor?.offsetY) || 0) / circleSize) * 100,
  };
};

const defaultEditorState = (file, previewUrl) => ({
  file,
  previewUrl,
  zoom: 1,
  rotation: 0,
  flipX: 1,
  flipY: 1,
  offsetX: 0,
  offsetY: 0,
});

const CreateChat = ({ proyectoId, usuarioId, onCancel }) => {
  const [activeTab, setActiveTab] = useState("info");
  const [preview, setPreview] = useState(null);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [chatName, setChatName] = useState("");
  const [chatDescription, setChatDescription] = useState("");
  const [file, setFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [cropEditor, setCropEditor] = useState(null);
  const [applyingCrop, setApplyingCrop] = useState(false);
  const [gifPreviewCrop, setGifPreviewCrop] = useState(null);

  const detailsRef = useRef(null);
  const peopleRef = useRef(null);
  const imageInputRef = useRef(null);
  const cropStageRef = useRef(null);
  const cropDragRef = useRef(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    return () => {
      if (cropEditor?.previewUrl) URL.revokeObjectURL(cropEditor.previewUrl);
    };
  }, [cropEditor?.previewUrl]);

  const openImagePicker = () => {
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
      imageInputRef.current.click();
    }
  };

  const closeCropEditor = () => {
    if (cropEditor?.previewUrl) URL.revokeObjectURL(cropEditor.previewUrl);
    setCropEditor(null);
  };

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;

    if (!ALLOWED_IMAGE_TYPES.has(nextFile.type)) {
      toast.error("Selecciona una imagen JPG, PNG, WEBP o GIF.");
      event.target.value = "";
      return;
    }

    if (nextFile.size > MAX_IMAGE_SIZE) {
      toast.error("La imagen no puede superar los 5 MB.");
      event.target.value = "";
      return;
    }

    const objectUrl = URL.createObjectURL(nextFile);
    setCropEditor(defaultEditorState(nextFile, objectUrl));

    if (nextFile.type === "image/gif") {
      toast("GIF animado detectado. Se conservará la animación al aplicarlo.");
    }
  };

  const updateCropEditor = (patch) => {
    setCropEditor((current) => (current ? { ...current, ...patch } : current));
  };

  const handleCropPointerDown = (event) => {
    if (!cropEditor) return;
    cropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: cropEditor.offsetX,
      offsetY: cropEditor.offsetY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleCropPointerMove = (event) => {
    const drag = cropDragRef.current;
    if (!drag) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    const stageSize = cropStageRef.current?.getBoundingClientRect?.().width || CROP_STAGE_FALLBACK_SIZE;
    const nextOffsets = clampCropOffsets(
      cropEditor?.zoom || 1,
      drag.offsetX + deltaX,
      drag.offsetY + deltaY,
      stageSize
    );

    updateCropEditor(nextOffsets);
  };

  const handleCropPointerUp = (event) => {
    if (cropDragRef.current?.pointerId === event.pointerId) {
      cropDragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleCropWheel = (event) => {
    event.preventDefault();
    if (!cropEditor) return;
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    const nextZoom = clamp(cropEditor.zoom + delta, 1, 3.5);
    const stageSize = cropStageRef.current?.getBoundingClientRect?.().width || CROP_STAGE_FALLBACK_SIZE;
    updateCropEditor({
      zoom: nextZoom,
      ...clampCropOffsets(nextZoom, cropEditor.offsetX, cropEditor.offsetY, stageSize),
    });
  };

  const handleResetCrop = () => {
    setCropEditor((current) =>
      current ? { ...current, zoom: 1, rotation: 0, flipX: 1, flipY: 1, offsetX: 0, offsetY: 0 } : current
    );
  };

  const handleCropZoomChange = (value) => {
    const nextZoom = clamp(value, 1, 3.5);
    const stageSize = cropStageRef.current?.getBoundingClientRect?.().width || CROP_STAGE_FALLBACK_SIZE;

    setCropEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        zoom: nextZoom,
        ...clampCropOffsets(nextZoom, current.offsetX, current.offsetY, stageSize),
      };
    });
  };

  const handleApplyCrop = async () => {
    if (!cropEditor) return;

    setApplyingCrop(true);
    try {
      /*
       * Un GIF animado no puede pasarse por canvas sin perder sus frames.
       * Para conservar la animación mantenemos el archivo GIF original y
       * dejamos que el avatar circular lo recorte visualmente con object-fit: cover.
       * JPG/PNG/WEBP sí se rasterizan con el recorte exacto del editor.
       */
      if (cropEditor.file?.type === "image/gif") {
        const stageSize = cropStageRef.current?.getBoundingClientRect?.().width || CROP_STAGE_FALLBACK_SIZE;
        const nextPreview = URL.createObjectURL(cropEditor.file);

        setPreview((current) => {
          if (current) URL.revokeObjectURL(current);
          return nextPreview;
        });
        setGifPreviewCrop(buildGifPreviewCrop(cropEditor, stageSize));
        setFile(cropEditor.file);
        toast.success("GIF animado listo.");
        closeCropEditor();
        return;
      }

      const stageSize = cropStageRef.current?.getBoundingClientRect?.().width || CROP_STAGE_FALLBACK_SIZE;
      const blob = await buildCroppedImage(cropEditor, stageSize);
      const safeName = (cropEditor.file?.name || "grupo").replace(/\.[^.]+$/, "") || "grupo";
      const nextFile = new File([blob], `${safeName}.png`, { type: "image/png" });
      const nextPreview = URL.createObjectURL(blob);

      setPreview((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextPreview;
      });
      setGifPreviewCrop(null);
      setFile(nextFile);
      toast.success("Foto del grupo lista.");
      closeCropEditor();
    } catch (error) {
      console.error("❌ Error aplicando recorte:", error);
      toast.error("No se pudo aplicar el recorte.");
    } finally {
      setApplyingCrop(false);
    }
  };

  const handleCreateChat = async () => {
    if (!usuarioId) {
      toast.error("No se encontró el ID del usuario propietario.");
      return;
    }

    if (selectedMembers.length === 0) {
      toast.error("Debes seleccionar al menos un usuario.");
      return;
    }

    setCreating(true);

    try {
      const formData = new FormData();
      formData.append("propietarioId", usuarioId);

      const memberIds = selectedMembers
        .map((member) => (typeof member === "object" ? member.id : member))
        .filter((id) => Boolean(id) && Number(id) !== Number(usuarioId));

      formData.append("miembros", JSON.stringify(memberIds));
      formData.append("nombre", chatName?.trim() || "Chat privado");
      formData.append("descripcion", chatDescription?.trim() || "");

      if (file) {
        formData.append("imagen", file);
      }

      logDev("📤 Enviando al backend:");
      logDev("propietarioId:", usuarioId);
      logDev("miembros:", memberIds);
      logDev("nombre:", chatName);
      logDev("descripcion:", chatDescription);

      const response = await fetch("/api/grupos", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("❌ Error HTTP:", response.status, data);
        toast.error(data.error || "No se pudo crear el grupo.");
        return;
      }

      logDev("✅ Grupo creado:", data);

      if (data.success) {
        toast.success(`Grupo creado: ${data.grupo?.nombre || chatName || "Chat privado"}`);
      } else {
        toast.error(data.error || "No se pudo crear el grupo.");
      }
    } catch (error) {
      console.error("❌ Error creando chat:", error);
      toast.error("Error de comunicación al crear el grupo.");
    } finally {
      setCreating(false);
    }
  };

  const handleTabNavigation = (tab) => {
    setActiveTab(tab);
    const target = tab === "info" ? detailsRef.current : peopleRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleRemoveMember = (memberId) => {
    setSelectedMembers((current) =>
      current.filter((member) => Number(member.id) !== Number(memberId))
    );
  };

  const handleClearMembers = () => {
    setSelectedMembers([]);
  };

  return (
    <>
      <main className="qc-group-create-page">
        <div className="qc-group-bg" aria-hidden="true">
          <span className="qc-group-bg-orb qc-group-bg-orb-one" />
          <span className="qc-group-bg-orb qc-group-bg-orb-two" />
          <i className="bi bi-chat-dots qc-group-bg-chat" />
          <i className="bi bi-people qc-group-bg-people" />
        </div>

        <section className="qc-group-shell">
          <header className="qc-group-header">
            <div className="qc-group-title-wrap">
              <span className="qc-group-title-icon" aria-hidden="true">
                <i className="bi bi-people" />
              </span>
              <div>
                <h1>Chat Grupal</h1>
                <p>Crea y configura un chat grupal para tu equipo.</p>
              </div>
            </div>

            <div className="qc-group-header-decor" aria-hidden="true">
              <span className="qc-group-header-bubble">
                <i className="bi bi-chat-dots" />
              </span>
              <strong>Equipos más conectados,<br />mejores conversaciones.</strong>
            </div>
          </header>

          <div className="qc-group-grid">
            <section ref={detailsRef} className="qc-group-card qc-group-details-card">
              <div className="qc-group-tabs" role="tablist" aria-label="Secciones del chat grupal">
                <button
                  type="button"
                  className={activeTab === "info" ? "is-active" : ""}
                  onClick={() => handleTabNavigation("info")}
                  role="tab"
                  aria-selected={activeTab === "info"}
                >
                  <i className="bi bi-pencil" aria-hidden="true" />
                  Detalles
                </button>
                <button
                  type="button"
                  className={activeTab === "members" ? "is-active" : ""}
                  onClick={() => handleTabNavigation("members")}
                  role="tab"
                  aria-selected={activeTab === "members"}
                >
                  <i className="bi bi-people" aria-hidden="true" />
                  Personas
                </button>
              </div>

              <div className="qc-group-details-content">
                <div className="qc-group-section-label">Foto del grupo</div>

                <div className="qc-group-cover-shell">
                  <div className="qc-group-cover" aria-hidden="true">
                    <div className="qc-group-cover-art">
                      <span className="qc-group-cover-planet qc-group-cover-planet-one" />
                      <span className="qc-group-cover-planet qc-group-cover-planet-two" />
                      <span className="qc-group-cover-star qc-group-cover-star-one">✦</span>
                      <span className="qc-group-cover-star qc-group-cover-star-two">✦</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`qc-group-avatar-picker ${preview ? "has-image" : ""}`}
                    onClick={openImagePicker}
                    title={preview ? "Cambiar foto del grupo" : "Subir foto del grupo"}
                  >
                    {preview ? (
                      gifPreviewCrop && file?.type === "image/gif" ? (
                        <span className="qc-group-avatar-preview-stage">
                          <img
                            src={preview}
                            alt="Vista previa de la foto del grupo"
                            className="qc-group-avatar-preview-gif"
                            style={{
                              left: `calc(50% + ${gifPreviewCrop.offsetXPercent}%)`,
                              top: `calc(50% + ${gifPreviewCrop.offsetYPercent}%)`,
                              transform: `translate(-50%, -50%) rotate(${gifPreviewCrop.rotation}deg) scale(${gifPreviewCrop.zoom * gifPreviewCrop.flipX}, ${gifPreviewCrop.zoom * gifPreviewCrop.flipY})`,
                            }}
                          />
                        </span>
                      ) : (
                        <img src={preview} alt="Vista previa de la foto del grupo" />
                      )
                    ) : (
                      <span className="qc-group-avatar-picker-empty">
                        <i className="bi bi-image" aria-hidden="true" />
                      </span>
                    )}
                  </button>

                  <div className="qc-group-cover-copy">
                    <strong>{preview ? "Cambiar foto del grupo" : "Agrega una foto de grupo"}</strong>
                    <small>JPG, PNG, WEBP o GIF. Máx. 5 MB.</small>
                  </div>


                  <input
                    ref={imageInputRef}
                    id="qc-group-image-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleFileChange}
                    hidden
                  />
                </div>

                <label className="qc-group-field">
                  <span>Nombre del grupo</span>
                  <div className="qc-group-input-wrap">
                    <i className="bi bi-people" aria-hidden="true" />
                    <input
                      type="text"
                      value={chatName}
                      placeholder="Ej. Equipo de Marketing"
                      autoComplete="off"
                      onChange={(event) => setChatName(event.target.value)}
                    />
                  </div>
                </label>

                <label className="qc-group-field">
                  <span>¿Cuál es su propósito?</span>
                  <div className="qc-group-textarea-wrap">
                    <i className="bi bi-file-earmark-text" aria-hidden="true" />
                    <textarea
                      value={chatDescription}
                      maxLength={MAX_DESCRIPTION_LENGTH}
                      placeholder="Describe el propósito de este grupo..."
                      onChange={(event) => setChatDescription(event.target.value)}
                    />
                  </div>
                  <small className="qc-group-char-count">
                    {chatDescription.length}/{MAX_DESCRIPTION_LENGTH}
                  </small>
                </label>

                <div className="qc-group-options">
                  <div className="qc-group-options-title">Opciones del grupo</div>

                  <div className="qc-group-option-row">
                    <span className="qc-group-option-icon">
                      <i className="bi bi-lock" aria-hidden="true" />
                    </span>
                    <span className="qc-group-option-copy">
                      <strong>Grupo privado</strong>
                      <small>Los grupos nuevos se crean como privados.</small>
                    </span>
                    <span className="qc-group-switch is-on is-locked" title="Configuración actual del sistema" aria-label="Grupo privado activado">
                      <span />
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section ref={peopleRef} className="qc-group-card qc-group-users-card">
              <div className="qc-group-card-heading">
                <span className="qc-group-heading-icon">
                  <i className="bi bi-person" aria-hidden="true" />
                </span>
                <div>
                  <h2>Buscar usuarios</h2>
                  <p>Encuentra y selecciona miembros para tu grupo.</p>
                </div>
              </div>

              <PersonasGrupos
                proyectoId={proyectoId}
                usuarioId={usuarioId}
                selectedMembers={selectedMembers}
                onSelectionChange={setSelectedMembers}
              />
            </section>

            <section className="qc-group-card qc-group-selected-card">
              <div className="qc-group-selected-head">
                <div className="qc-group-card-heading">
                  <span className="qc-group-heading-icon">
                    <i className="bi bi-people" aria-hidden="true" />
                  </span>
                  <div>
                    <h2>Miembros seleccionados ({selectedMembers.length})</h2>
                    <p>Aquí verás los miembros que formarán parte del grupo.</p>
                  </div>
                </div>

                {selectedMembers.length > 0 && (
                  <button type="button" className="qc-group-clear" onClick={handleClearMembers}>
                    Limpiar todo
                    <i className="bi bi-trash" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="qc-group-selected-body">
                {selectedMembers.length === 0 ? (
                  <div className="qc-group-empty">
                    <div className="qc-group-empty-art" aria-hidden="true">
                      <span className="qc-group-empty-ring" />
                      <i className="bi bi-people" />
                      <span className="qc-group-empty-plus">+</span>
                    </div>
                    <strong>Aún no has seleccionado miembros</strong>
                    <p>Busca usuarios en la lista y agrégalos al grupo.</p>
                  </div>
                ) : (
                  <div className="qc-group-selected-list">
                    {selectedMembers.map((member) => (
                      <div className="qc-group-selected-row" key={member.id}>
                        <span className="qc-group-member-avatar" style={{ background: member.background || "#2f7cf6" }}>
                          {member.url_imagen ? (
                            <img src={getAvatarUrl(member.url_imagen)} alt="" />
                          ) : (
                            getInitials(member)
                          )}
                        </span>
                        <span className="qc-group-selected-copy">
                          <strong>{`${member.nombre || ""} ${member.apellido || ""}`.trim()}</strong>
                          <small>{member.correo || "Usuario del sistema"}</small>
                        </span>
                        <button
                          type="button"
                          className="qc-group-remove-member"
                          onClick={() => handleRemoveMember(member.id)}
                          aria-label={`Quitar a ${member.nombre || "usuario"}`}
                          title="Quitar miembro"
                        >
                          <i className="bi bi-x-lg" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="qc-group-tip">
                  <span><i className="bi bi-lightbulb" aria-hidden="true" /></span>
                  <div>
                    <strong>Tip</strong>
                    <p>Puedes seleccionar múltiples usuarios para agregarlos al chat grupal.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <footer className="qc-group-actions">
            <button
              type="button"
              className="qc-group-cancel"
              onClick={() => onCancel?.()}
              disabled={creating}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="qc-group-create"
              onClick={handleCreateChat}
              disabled={creating}
            >
              <i className="bi bi-people" aria-hidden="true" />
              {creating ? "Creando..." : "Crear chat grupal"}
            </button>
          </footer>
        </section>
      </main>

      {cropEditor && (
        <div className="qc-group-photo-editor-backdrop" role="presentation">
          <div className="qc-group-photo-editor" role="dialog" aria-modal="true" aria-label="Editar foto de perfil">
            <button type="button" className="qc-group-photo-close" onClick={closeCropEditor} aria-label="Cerrar editor">
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>

            <div className="qc-group-photo-head">
              <span className="qc-group-photo-head-icon" aria-hidden="true">
                <i className="bi bi-image" />
              </span>
              <div>
                <h3>Editar foto de perfil</h3>
                <p>Arrastra la imagen para centrarla. Usa el zoom y la rotación antes de aplicar.</p>
              </div>
            </div>

            <div className="qc-group-photo-body">
              <div
                className="qc-group-photo-stage"
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerCancel={handleCropPointerUp}
                onWheel={handleCropWheel}
              >
                <div ref={cropStageRef} className="qc-group-photo-stage-frame">
                  <img
                    className="qc-group-photo-stage-img"
                    src={cropEditor.previewUrl}
                    alt="Vista previa editable"
                    draggable="false"
                    style={{
                      left: `calc(50% + ${cropEditor.offsetX}px)`,
                      top: `calc(50% + ${cropEditor.offsetY}px)`,
                      transform: `translate(-50%, -50%) rotate(${cropEditor.rotation}deg) scale(${cropEditor.zoom * cropEditor.flipX}, ${cropEditor.zoom * cropEditor.flipY})`,
                    }}
                  />
                  <span className="qc-group-photo-grid" aria-hidden="true" />
                  <span className="qc-group-photo-circle" aria-hidden="true">
                    <span className="handle top" />
                    <span className="handle right" />
                    <span className="handle bottom" />
                    <span className="handle left" />
                  </span>
                </div>
              </div>

              <div className="qc-group-photo-tools">
                <button type="button" className="is-active">
                  <i className="bi bi-crop" aria-hidden="true" />
                  <span>Recortar</span>
                </button>
                <button type="button" onClick={() => updateCropEditor({ rotation: cropEditor.rotation - 90 })}>
                  <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                  <span>Rotar</span>
                </button>
                <button type="button" onClick={() => updateCropEditor({ flipX: cropEditor.flipX * -1 })}>
                  <i className="bi bi-symmetry-horizontal" aria-hidden="true" />
                  <span>Voltear</span>
                </button>
              </div>
            </div>

            <div className="qc-group-photo-controls">
              <div className="qc-group-photo-zoom-wrap">
                <button type="button" onClick={() => handleCropZoomChange(cropEditor.zoom - 0.08)} aria-label="Alejar">
                  <i className="bi bi-zoom-out" aria-hidden="true" />
                </button>
                <input
                  type="range"
                  min="1"
                  max="3.5"
                  step="0.01"
                  value={cropEditor.zoom}
                  style={{
                    "--zoom-progress": `${((cropEditor.zoom - 1) / (3.5 - 1)) * 100}%`,
                  }}
                  onChange={(event) => handleCropZoomChange(event.target.value)}
                  aria-label="Nivel de zoom"
                />
                <button type="button" onClick={() => handleCropZoomChange(cropEditor.zoom + 0.08)} aria-label="Acercar">
                  <i className="bi bi-zoom-in" aria-hidden="true" />
                </button>
              </div>

              <div className="qc-group-photo-rotate-wrap">
                <button type="button" onClick={() => updateCropEditor({ rotation: cropEditor.rotation - 90 })} aria-label="Rotar a la izquierda">
                  <i className="bi bi-arrow-counterclockwise" aria-hidden="true" />
                </button>
                <div className="qc-group-photo-angle">{cropEditor.rotation}°</div>
                <button type="button" onClick={() => updateCropEditor({ rotation: cropEditor.rotation + 90 })} aria-label="Rotar a la derecha">
                  <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="qc-group-photo-footer">
              <button type="button" className="qc-group-photo-secondary" onClick={handleResetCrop}>
                <i className="bi bi-arrow-counterclockwise" aria-hidden="true" />
                Reiniciar
              </button>

              <div className="qc-group-photo-footer-actions">
                <button type="button" className="qc-group-photo-ghost" onClick={closeCropEditor}>
                  Cancelar
                </button>
                <button type="button" className="qc-group-photo-apply" onClick={handleApplyCrop} disabled={applyingCrop}>
                  <i className="bi bi-check-lg" aria-hidden="true" />
                  {applyingCrop ? "Aplicando..." : "Aplicar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CreateChat;
