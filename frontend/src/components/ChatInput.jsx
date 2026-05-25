import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import "../css/emoji.css";
import { logDev } from "../utils/logger";

const normalizeMentionText = (text = "") =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const getMentionMatch = (text, caretPosition) => {
  const beforeCursor = text.slice(0, caretPosition);
  const atIndex = beforeCursor.lastIndexOf("@");

  if (atIndex === -1) return null;

  const charBeforeAt = atIndex > 0 ? beforeCursor[atIndex - 1] : "";
  if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;

  const query = beforeCursor.slice(atIndex + 1);

  if (query.length > 40) return null;
  if (/[\n\r]/.test(query)) return null;
  if (/[.,;:!?()[\]{}<>]/.test(query)) return null;
  if (query.endsWith(" ")) return null;

  return {
    start: atIndex,
    end: caretPosition,
    query,
  };
};

const ChatInput = forwardRef(({ onSend, onPasteFiles, onValueChange, mentionOptions = [] }, ref) => {
  const [value, setValue] = useState("");
  const [mentionMatch, setMentionMatch] = useState(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef(null);

  const normalizedMentionOptions = useMemo(() => {
    const seen = new Set();

    return (mentionOptions || [])
      .map((option) => {
        const label = String(option?.label || "").trim();
        if (!label) return null;

        const key = `${option.type || "user"}-${option.id || label}`;
        if (seen.has(key)) return null;
        seen.add(key);

        return {
          ...option,
          label,
          searchText: normalizeMentionText(
            `${label} ${option?.subtitle || ""} ${option?.correo || ""}`
          ),
        };
      })
      .filter(Boolean);
  }, [mentionOptions]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionMatch) return [];

    const query = normalizeMentionText(mentionMatch.query);

    const matches = normalizedMentionOptions.filter((option) => {
      if (!query) return true;
      return option.searchText.includes(query);
    });

    return matches.slice(0, 8);
  }, [mentionMatch, normalizedMentionOptions]);

  const closeMentionMenu = () => {
    setMentionMatch(null);
    setActiveMentionIndex(0);
  };

  const updateMentionMenu = (nextValue, caretPosition) => {
    const match = getMentionMatch(nextValue, caretPosition);
    if (!match) {
      closeMentionMenu();
      return;
    }

    setMentionMatch(match);
    setActiveMentionIndex(0);
  };

  const resizeTextarea = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  };

  const clearInput = () => {
    setValue("");
    if (typeof onValueChange === "function") onValueChange("");
    closeMentionMenu();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const sendCurrentValue = () => {
    if (typeof onSend === "function") {
      onSend(value);
    }
    clearInput();
  };

  const insertMention = (option) => {
    if (!option || !mentionMatch || !textareaRef.current) return;

    const mentionText = `@${option.label} `;
    const before = value.slice(0, mentionMatch.start);
    const after = value.slice(mentionMatch.end);
    const nextValue = `${before}${mentionText}${after}`;
    const caret = before.length + mentionText.length;

    setValue(nextValue);
    if (typeof onValueChange === "function") onValueChange(nextValue);
    closeMentionMenu();

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      resizeTextarea();
    });
  };

  useEffect(() => {
    if (activeMentionIndex >= mentionSuggestions.length) {
      setActiveMentionIndex(0);
    }
  }, [activeMentionIndex, mentionSuggestions.length]);

  useImperativeHandle(ref, () => ({
    reset: clearInput,
    send: sendCurrentValue,
    focus: () => textareaRef.current?.focus(),
    insertEmoji: (emoji) => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;

      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;

      const newValue = value.slice(0, start) + emoji + value.slice(end);
      const caret = start + emoji.length;
      setValue(newValue);
      if (typeof onValueChange === "function") onValueChange(newValue);

      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
        resizeTextarea();
        updateMentionMenu(newValue, caret);
      });
    },
  }));

  const handleChange = (e) => {
    const nextValue = e.target.value;
    const caretPosition = e.target.selectionStart ?? nextValue.length;

    setValue(nextValue);
    if (typeof onValueChange === "function") onValueChange(nextValue);
    requestAnimationFrame(resizeTextarea);
    updateMentionMenu(nextValue, caretPosition);
  };

  const handleKeyDown = (e) => {
    if (mentionSuggestions.length > 0 && mentionMatch) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex((prev) =>
          prev - 1 < 0 ? mentionSuggestions.length - 1 : prev - 1
        );
        return;
      }

      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionSuggestions[activeMentionIndex]);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        closeMentionMenu();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrentValue();
    }
  };

  const handleKeyUp = () => {
    if (!textareaRef.current) return;
    updateMentionMenu(value, textareaRef.current.selectionStart ?? value.length);
  };

  const handleClick = () => {
    if (!textareaRef.current) return;
    updateMentionMenu(value, textareaRef.current.selectionStart ?? value.length);
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
      e.preventDefault();
      onPasteFiles(imageFiles);
      return;
    }

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      updateMentionMenu(
        textareaRef.current.value,
        textareaRef.current.selectionStart ?? textareaRef.current.value.length
      );
      resizeTextarea();
    });
  };

  return (
    <div className="mention-input-wrapper">
      {mentionSuggestions.length > 0 && mentionMatch && (
        <div className="mention-suggestions" role="listbox">
          {mentionSuggestions.map((option, index) => {
            const active = index === activeMentionIndex;
            const isAll = option.type === "all";

            return (
              <button
                key={`${option.type || "user"}-${option.id || option.label}`}
                type="button"
                className={`mention-suggestion-item ${active ? "active" : ""}`}
                onMouseEnter={() => setActiveMentionIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(option);
                }}
              >
                <span
                  className={`mention-suggestion-avatar ${isAll ? "mention-all-avatar" : ""}`}
                  style={{ backgroundColor: option.background || "#2787F5" }}
                >
                  {isAll ? "@" : option.label.charAt(0).toUpperCase()}
                </span>
                <span className="mention-suggestion-text">
                  <strong>{isAll ? "@todos" : `@${option.label}`}</strong>
                  <small>{option.subtitle || (isAll ? "Mencionar a todos" : "Usuario")}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <textarea
        rows={1}
        ref={textareaRef}
        className="form-control"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleClick}
        onPaste={handlePaste}
        placeholder="Escribe un mensaje... Usa @ para mencionar"
        style={{
          overflow: "hidden",
          resize: "none",
          minHeight: "47px",
          maxHeight: "270px",
          width: "100%",
        }}
      />
    </div>
  );
});

export default React.memo(ChatInput);
