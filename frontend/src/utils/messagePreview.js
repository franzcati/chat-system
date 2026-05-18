const URL_LIKE_RE = /^(https?:\/\/|\/uploads\/|blob:)/i;

export const cleanUploadFileName = (value = "") => {
  const raw = String(value || "").split("?")[0].split("#")[0];
  const last = raw.split("/").pop() || "";
  try {
    return decodeURIComponent(last).replace(/^\d+[_-]/, "").replace(/_/g, " ").trim();
  } catch {
    return last.replace(/^\d+[_-]/, "").replace(/_/g, " ").trim();
  }
};

export const getMediaKind = (message = {}) => {
  const text = String(message?.mensaje ?? message?.ultimo_mensaje ?? "");
  const fileUrl = String(message?.archivo_url || message?.ultimo_archivo_url || text || "");
  const mime = String(message?.tipo_archivo || message?.ultimo_tipo_archivo || "").toLowerCase();
  const lowerUrl = fileUrl.toLowerCase().split("?")[0];

  if (text.startsWith("[sticker]")) return "sticker";
  if (Array.isArray(message?.imagenes) && message.imagenes.length > 0) return "image";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(lowerUrl)) return "image";
  if (/\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i.test(lowerUrl)) return "video";
  if (/\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(lowerUrl)) return "audio";
  if (
    mime ||
    /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|exe|msi|apk)$/i.test(lowerUrl) ||
    (fileUrl && URL_LIKE_RE.test(fileUrl) && String(message?.archivo_url || message?.ultimo_archivo_url || ""))
  ) {
    return "file";
  }

  return "text";
};

export const getMessageCaption = (message = {}) => {
  const text = String(message?.mensaje ?? message?.ultimo_mensaje ?? "").trim();
  const fileUrl = String(message?.archivo_url || message?.ultimo_archivo_url || "").trim();

  if (!text) return "";
  if (text.startsWith("[sticker]")) return "";
  if (fileUrl && text === fileUrl) return "";
  if (URL_LIKE_RE.test(text)) return "";
  return text;
};

export const getMessagePreview = (message = {}) => {
  if (!message) {
    return { kind: "text", icon: "", text: "Mensaje", label: "Mensaje" };
  }

  if (Number(message.eliminado) === 1 || message.eliminado === true) {
    return { kind: "deleted", icon: "", text: "Se eliminó este mensaje", label: "Se eliminó este mensaje" };
  }

  const kind = getMediaKind(message);
  const caption = getMessageCaption(message);
  const fileName = cleanUploadFileName(
    message.nombre_archivo ||
      message.ultimo_nombre_archivo ||
      message.archivo_url ||
      message.ultimo_archivo_url ||
      message.mensaje ||
      message.ultimo_mensaje ||
      ""
  );

  if (kind === "image") {
    return {
      kind,
      icon: "",
      iconClass: "fa-regular fa-image",
      text: caption || "Foto",
      label: caption || "Foto",
    };
  }

  if (kind === "video") {
    return {
      kind,
      icon: "",
      iconClass: "fa-solid fa-video",
      text: caption || "Video",
      label: caption || "Video",
    };
  }

  if (kind === "audio") {
    return {
      kind,
      icon: "",
      iconClass: "fa-solid fa-microphone",
      text: "Audio",
      label: "Audio",
    };
  }

  if (kind === "sticker") {
    return {
      kind,
      icon: "",
      iconClass: "fa-regular fa-note-sticky",
      text: "Sticker",
      label: "Sticker",
    };
  }

  if (kind === "file") {
    return {
      kind,
      icon: "",
      iconClass: "fa-regular fa-file-lines",
      text: fileName || "Archivo",
      label: fileName || "Archivo",
    };
  }

  const text = String(message.mensaje ?? message.ultimo_mensaje ?? "").trim();
  return { kind: "text", icon: "", text: text || "Mensaje", label: text || "Mensaje" };
};

export const getReplyAuthorName = (message = {}, myUserId) => {
  const senderId = message.usuario_id ?? message.usuario_envia_id ?? message.reply_usuario_id;
  if (myUserId && Number(senderId) === Number(myUserId)) return "Tú";

  const fullName = [
    message.nombre ?? message.emisor_nombre ?? message.usuario_nombre ?? message.reply_usuario_nombre,
    message.apellido ?? message.emisor_apellido ?? message.usuario_apellido ?? message.reply_usuario_apellido,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const baseName = fullName || "Usuario";
  const sourceGroup =
    message.source_group_name ||
    message.reply_source_group_name ||
    message.grupo_nombre ||
    "";

  if (sourceGroup && (message.reply_source === "grupo" || message.reply_to_tipo === "grupo" || message.source_group_id || message.reply_to_grupo_id)) {
    return `${baseName} · ${sourceGroup}`;
  }

  return baseName;
};
