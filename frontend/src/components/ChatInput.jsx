import React, { useState, useRef, forwardRef, useImperativeHandle } from "react";
import "../css/emoji.css";
import { logDev } from "../utils/logger";

const ChatInput = forwardRef(({ onSend, onPasteFiles }, ref) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  useImperativeHandle(ref, () => ({
    reset: () => setValue(""),
    send: () => {
      if (typeof onSend === "function") {
        onSend(value);          // 👈 siempre mandamos el valor, aunque esté vacío
      }
      setValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    },
    insertEmoji: (emoji) => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;

      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;

      const newValue = value.slice(0, start) + emoji + value.slice(end);
      setValue(newValue);

      // Recolocar cursor después del emoji
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + emoji.length;
        el.setSelectionRange(caret, caret);
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      });
    },
  }));

  const handleChange = (e) => {
    setValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (typeof onSend === "function") {
        onSend(value);           // 👈 mandamos texto (aunque esté vacío)
      }
      setValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  // 👇 AQUÍ ES DONDE SE CAPTURAN LAS IMÁGENES PEGADAS (Ctrl+V)
  const handlePaste = (e) => {
    const cd = e.clipboardData;
    if (!cd) return;

    // 1️⃣ primero intentamos con cd.files
    const filesFromFiles = Array.from(cd.files || []).filter((f) =>
      f.type.startsWith("image/")
    );

    // 2️⃣ si no viene nada en files, probamos con items
    let imageFiles = filesFromFiles;
    if (!imageFiles.length && cd.items) {
      imageFiles = Array.from(cd.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
    }

    logDev("📋 PASTE - imágenes detectadas:", imageFiles);

    if (imageFiles.length && typeof onPasteFiles === "function") {
      e.preventDefault();          // evita que pegue "blob:..." en el textarea
      onPasteFiles(imageFiles);    // solo se envía una vez
      return;
    }

    // si no hay imágenes, se comporta como pegado normal de texto
  };

  return (
    <textarea 
      rows={1}
      ref={textareaRef}
      className="form-control"  // ✅ importante
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}     // 👈 importante
      placeholder="Escribe un mensaje..."
      style={{
        overflow: "hidden",
        resize: "none",
        minHeight: "47px",
        maxHeight: "270px",
        width: "100%",
      }}
    />
  );
});

export default React.memo(ChatInput);