import React, { useState, useRef, forwardRef, useImperativeHandle } from "react";
import "../css/emoji.css";

const ChatInput = forwardRef(({ onSend }, ref) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  useImperativeHandle(ref, () => ({
    reset: () => setValue(""),
    send: () => {
      if (value.trim()) {
        onSend(value);
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
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
      if (value.trim()) {
        onSend(value);
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    }
  };

  return (
    <textarea 
      rows={1}
      ref={textareaRef}
      className="form-control"  // ✅ importante
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
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