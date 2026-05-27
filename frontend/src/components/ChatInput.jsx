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

const IMAGE_PLACEHOLDER_LINE = /^(imagen|image|foto|archivo)[-_ ]?\d+$/i;

const cleanPastedText = (text = "") =>
  String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !IMAGE_PLACEHOLDER_LINE.test(line.trim()))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

const getTextFromHtmlWithoutImages = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return "";

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("img, picture, source").forEach((node) => node.remove());
    return cleanPastedText(doc.body?.innerText || doc.body?.textContent || "");
  } catch (err) {
    logDev("No se pudo limpiar el HTML pegado:", err);
    return "";
  }
};

const extractImageSourcesFromHtml = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return [];

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const seen = new Set();

    return Array.from(doc.querySelectorAll("img"))
      .map((img) => img.getAttribute("src") || "")
      .filter((src) => {
        const value = src.trim();
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return /^(data:image\/|blob:|https?:\/\/|\/)/i.test(value);
      });
  } catch (err) {
    logDev("No se pudieron leer imágenes del HTML pegado:", err);
    return [];
  }
};

const extensionFromMime = (mime = "") => {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("svg")) return "svg";
  return "jpg";
};

const dataUrlToFile = (dataUrl, index = 0) => {
  const [header, payload] = String(dataUrl).split(",");
  const mime = header?.match(/data:([^;]+)/)?.[1] || "image/png";
  const binary = atob(payload || "");
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], `imagen-pegada-${Date.now()}-${index}.${extensionFromMime(mime)}`, {
    type: mime,
  });
};

const imageSrcToFile = async (src, index = 0) => {
  if (!src) return null;

  if (src.startsWith("data:image/")) {
    return dataUrlToFile(src, index);
  }

  const response = await fetch(src);
  if (!response.ok) return null;

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) return null;

  return new File([blob], `imagen-pegada-${Date.now()}-${index}.${extensionFromMime(blob.type)}`, {
    type: blob.type,
  });
};

const FORMAT_ACTIONS = [
  { key: "bold", label: "B", title: "Negrita", shortcut: "Ctrl+B" },
  { key: "italic", label: "I", title: "Cursiva", shortcut: "Ctrl+I" },
  { key: "underline", label: "U", title: "Subrayado", shortcut: "Ctrl+U" },
  { key: "strike", label: "S", title: "Tachado" },
  { key: "code", label: "<>", title: "Monoespaciado / código" },
  { key: "ordered", label: "1.", iconClass: "fa-solid fa-list-ol", title: "Lista numerada" },
  { key: "bullet", label: "•", iconClass: "fa-solid fa-list-ul", title: "Lista con viñetas" },
  { key: "quote", label: "Quote", iconClass: "fa-solid fa-quote-right", title: "Cita" },
];

const INLINE_MARKDOWN_RULES = [
  { open: "**", close: "**", tag: "strong", className: "wa-rich-bold" },
  { open: "__", close: "__", tag: "u", className: "wa-rich-underline" },
  { open: "~~", close: "~~", tag: "del", className: "wa-rich-strike" },
  { open: "`", close: "`", tag: "code", className: "wa-rich-code", raw: true },
  { open: "_", close: "_", tag: "em", className: "wa-rich-italic" },
  { open: "~", close: "~", tag: "del", className: "wa-rich-strike" },
];

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const inlineMarkdownToHtml = (value = "", depth = 0) => {
  const text = String(value || "");
  if (!text) return "";
  if (depth > 8) return escapeHtml(text);

  let bestMatch = null;
  INLINE_MARKDOWN_RULES.forEach((rule) => {
    const openIndex = text.indexOf(rule.open);
    if (openIndex === -1) return;
    const closeIndex = text.indexOf(rule.close, openIndex + rule.open.length);
    if (closeIndex === -1 || closeIndex === openIndex + rule.open.length) return;
    if (!bestMatch || openIndex < bestMatch.openIndex || (openIndex === bestMatch.openIndex && rule.open.length > bestMatch.rule.open.length)) {
      bestMatch = { rule, openIndex, closeIndex };
    }
  });

  if (!bestMatch) return escapeHtml(text);

  const { rule, openIndex, closeIndex } = bestMatch;
  const before = inlineMarkdownToHtml(text.slice(0, openIndex), depth + 1);
  const content = text.slice(openIndex + rule.open.length, closeIndex);
  const after = inlineMarkdownToHtml(text.slice(closeIndex + rule.close.length), depth + 1);
  const inner = rule.raw ? escapeHtml(content) : inlineMarkdownToHtml(content, depth + 1);

  return `${before}<${rule.tag} class="${rule.className}">${inner}</${rule.tag}>${after}`;
};

const markdownToEditorHtml = (markdown = "") => {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 1 && !lines[0]) return "";

  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      blocks.push("<div><br></div>");
      index += 1;
      continue;
    }

    const orderedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const startNumber = Number(orderedMatch[1]) || 1;
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*(\d+)\.\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${inlineMarkdownToHtml(match[2])}</li>`);
        index += 1;
      }
      blocks.push(`<ol start="${startNumber}">${items.join("")}</ol>`);
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    if (bulletMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*•]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${inlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*>\s?(.*)$/);
        if (!match) break;
        quoteLines.push(`<div>${inlineMarkdownToHtml(match[1]) || "<br>"}</div>`);
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.join("")}</blockquote>`);
      continue;
    }

    blocks.push(`<div>${inlineMarkdownToHtml(line)}</div>`);
    index += 1;
  }

  return blocks.join("");
};

const getChildrenMarkdown = (node) =>
  Array.from(node.childNodes || [])
    .map((child) => nodeToMarkdown(child))
    .join("");

const cleanSerializedMarkdown = (value = "") =>
  String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

const nodeToMarkdown = (node) => {
  if (!node) return "";

  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.tagName.toLowerCase();

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${getChildrenMarkdown(node)}**`;
  if (tag === "em" || tag === "i") return `_${getChildrenMarkdown(node)}_`;
  if (tag === "u") return `__${getChildrenMarkdown(node)}__`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~${getChildrenMarkdown(node)}~`;
  if (tag === "code") return `\`${getChildrenMarkdown(node)}\``;
  if (tag === "ul") {
    return Array.from(node.children || [])
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((li) => `- ${cleanSerializedMarkdown(getChildrenMarkdown(li))}`)
      .join("\n") + "\n";
  }
  if (tag === "ol") {
    const start = Number(node.getAttribute("start")) || 1;
    return Array.from(node.children || [])
      .filter((child) => child.tagName?.toLowerCase() === "li")
      .map((li, index) => `${start + index}. ${cleanSerializedMarkdown(getChildrenMarkdown(li))}`)
      .join("\n") + "\n";
  }
  if (tag === "blockquote") {
    const content = cleanSerializedMarkdown(getChildrenMarkdown(node));
    return content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n") + "\n";
  }
  if (["div", "p"].includes(tag)) return `${getChildrenMarkdown(node)}\n`;

  return getChildrenMarkdown(node);
};

const editorToMarkdown = (editor) => cleanSerializedMarkdown(getChildrenMarkdown(editor));

const getEditorPlainText = (editor) =>
  String(editor?.innerText || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n$/g, "");

const isSelectionInside = (root) => {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !root) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer);
};

const getSelectedText = (root) => {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !root) return "";
  if (!isSelectionInside(root)) return "";
  return selection.toString();
};

const getCaretOffset = (root) => {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !root || !isSelectionInside(root)) return getEditorPlainText(root).length;

  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
  return range.toString().length;
};

const setTextSelectionByOffsets = (root, startOffset, endOffset = startOffset) => {
  if (!root || typeof document === "undefined") return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let currentOffset = 0;
  let startNode = null;
  let startNodeOffset = 0;
  let endNode = null;
  let endNodeOffset = 0;
  let node;

  while ((node = walker.nextNode())) {
    const length = node.nodeValue?.length || 0;
    const nextOffset = currentOffset + length;

    if (!startNode && startOffset <= nextOffset) {
      startNode = node;
      startNodeOffset = Math.max(0, startOffset - currentOffset);
    }

    if (!endNode && endOffset <= nextOffset) {
      endNode = node;
      endNodeOffset = Math.max(0, endOffset - currentOffset);
      break;
    }

    currentOffset = nextOffset;
  }

  if (!startNode) {
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode || startNode, endNode ? endNodeOffset : startNodeOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  root.focus();
};

const insertPlainTextAtSelection = (text = "") => {
  document.execCommand("insertText", false, text);
};

const ChatInput = forwardRef(({ onSend, onPasteFiles, onValueChange, mentionOptions = [] }, ref) => {
  const [value, setValue] = useState("");
  const [mentionMatch, setMentionMatch] = useState(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [activeFormats, setActiveFormats] = useState(() => new Set());
  const editorRef = useRef(null);
  const blurTimerRef = useRef(null);

  const syncValueFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return "";
    const nextValue = editorToMarkdown(editor);
    setValue(nextValue);
    if (typeof onValueChange === "function") onValueChange(nextValue);
    return nextValue;
  };

  const setEditorHtmlFromValue = (nextValue = "") => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = markdownToEditorHtml(nextValue);
  };

  const isNodeInsideTag = (node, tagNames = []) => {
    const editor = editorRef.current;
    if (!node || !editor) return false;
    const wantedTags = tagNames.map((tag) => String(tag).toUpperCase());
    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    while (current && current !== editor) {
      if (wantedTags.includes(current.tagName)) return true;
      current = current.parentElement;
    }

    return false;
  };

  const getSelectionActiveFormats = () => {
    const editor = editorRef.current;
    const selection = window.getSelection?.();
    const formats = new Set();

    if (!editor || !selection || selection.rangeCount === 0 || !isSelectionInside(editor)) {
      return formats;
    }

    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    const common = selection.getRangeAt(0).commonAncestorContainer;
    const inside = (tags) =>
      isNodeInsideTag(anchor, tags) ||
      isNodeInsideTag(focus, tags) ||
      isNodeInsideTag(common, tags);

    try { if (document.queryCommandState("bold")) formats.add("bold"); } catch {}
    try { if (document.queryCommandState("italic")) formats.add("italic"); } catch {}
    try { if (document.queryCommandState("underline")) formats.add("underline"); } catch {}
    try { if (document.queryCommandState("strikeThrough")) formats.add("strike"); } catch {}
    try { if (document.queryCommandState("insertOrderedList")) formats.add("ordered"); } catch {}
    try { if (document.queryCommandState("insertUnorderedList")) formats.add("bullet"); } catch {}

    if (inside(["STRONG", "B"])) formats.add("bold");
    if (inside(["EM", "I"])) formats.add("italic");
    if (inside(["U"])) formats.add("underline");
    if (inside(["DEL", "S", "STRIKE"])) formats.add("strike");
    if (inside(["CODE"])) formats.add("code");
    if (inside(["OL"])) formats.add("ordered");
    if (inside(["UL"])) formats.add("bullet");
    if (inside(["BLOCKQUOTE"])) formats.add("quote");

    return formats;
  };

  const updateFormatToolbarVisibility = () => {
    const editor = editorRef.current;
    if (!editor || document.activeElement !== editor || !isSelectionInside(editor)) {
      setShowFormatToolbar(false);
      setActiveFormats(new Set());
      return;
    }

    const selectedText = getSelectedText(editor);
    const hasSelection = selectedText.trim().length > 0;
    setShowFormatToolbar(hasSelection);
    setActiveFormats(hasSelection ? getSelectionActiveFormats() : new Set());
  };

  const updateFormatToolbarVisibilitySoon = () => {
    requestAnimationFrame(updateFormatToolbarVisibility);
  };

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

  const updateMentionMenu = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const plainText = getEditorPlainText(editor);
    const caretPosition = getCaretOffset(editor);
    const match = getMentionMatch(plainText, caretPosition);

    if (!match) {
      closeMentionMenu();
      return;
    }

    setMentionMatch(match);
    setActiveMentionIndex(0);
  };

  const clearInput = () => {
    setValue("");
    if (typeof onValueChange === "function") onValueChange("");
    closeMentionMenu();
    setShowFormatToolbar(false);
    setEditorHtmlFromValue("");
  };

  const sendCurrentValue = () => {
    const currentValue = syncValueFromEditor();
    if (typeof onSend === "function") {
      onSend(currentValue);
    }
    clearInput();
  };

  const insertMention = (option) => {
    if (!option || !mentionMatch || !editorRef.current) return;

    const mentionText = `@${option.label} `;
    setTextSelectionByOffsets(editorRef.current, mentionMatch.start, mentionMatch.end);
    insertPlainTextAtSelection(mentionText);
    syncValueFromEditor();
    closeMentionMenu();

    requestAnimationFrame(() => {
      editorRef.current?.focus();
      updateFormatToolbarVisibility();
    });
  };

  const unwrapNearestTag = (tagNames = []) => {
    const selection = window.getSelection?.();
    const editor = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !editor || !isSelectionInside(editor)) return false;

    const wantedTags = tagNames.map((tag) => String(tag).toUpperCase());
    let current = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;

    while (current && current !== editor) {
      if (wantedTags.includes(current.tagName)) {
        const parent = current.parentNode;
        const fragment = document.createDocumentFragment();
        while (current.firstChild) fragment.appendChild(current.firstChild);
        parent.replaceChild(fragment, current);
        return true;
      }
      current = current.parentElement;
    }

    return false;
  };

  const wrapSelectionWithTag = (tagName) => {
    const selection = window.getSelection?.();
    const editor = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !editor || !isSelectionInside(editor)) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    const wrapper = document.createElement(tagName);
    if (tagName === "code") wrapper.className = "wa-rich-code";

    try {
      range.surroundContents(wrapper);
      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(wrapper);
      selection.addRange(nextRange);
    } catch {
      const content = range.extractContents();
      wrapper.appendChild(content);
      range.insertNode(wrapper);
      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(wrapper);
      selection.addRange(nextRange);
    }
  };

  const replaceSelectionWithBlock = (actionKey) => {
    const selection = window.getSelection?.();
    const editor = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !editor || !isSelectionInside(editor)) return false;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return false;

    const selectedText = selection.toString();
    const selectedLines = selectedText
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+\.|>)\s?/, "").trimEnd())
      .filter((line, index, arr) => line.trim() || arr.length === 1 || index < arr.length - 1);

    if (!selectedLines.length || selectedLines.every((line) => !line.trim())) return false;

    let block;
    if (actionKey === "ordered") {
      block = document.createElement("ol");
      selectedLines.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line.trim() || " ";
        block.appendChild(li);
      });
    } else if (actionKey === "bullet") {
      block = document.createElement("ul");
      selectedLines.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line.trim() || " ";
        block.appendChild(li);
      });
    } else if (actionKey === "quote") {
      block = document.createElement("blockquote");
      selectedLines.forEach((line) => {
        const div = document.createElement("div");
        div.textContent = line || " ";
        block.appendChild(div);
      });
    } else {
      return false;
    }

    range.deleteContents();
    range.insertNode(block);
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(block);
    selection.addRange(nextRange);
    return true;
  };

  const applyFormat = (actionKey) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    if (!isSelectionInside(editor) || !getSelectedText(editor).trim()) return;

    const currentFormats = getSelectionActiveFormats();

    if (actionKey === "bold") document.execCommand("bold", false);
    else if (actionKey === "italic") document.execCommand("italic", false);
    else if (actionKey === "underline") document.execCommand("underline", false);
    else if (actionKey === "strike") document.execCommand("strikeThrough", false);
    else if (actionKey === "code") {
      if (currentFormats.has("code")) unwrapNearestTag(["CODE"]);
      else wrapSelectionWithTag("code");
    } else if (actionKey === "ordered") {
      if (currentFormats.has("ordered")) document.execCommand("insertOrderedList", false);
      else replaceSelectionWithBlock("ordered");
    } else if (actionKey === "bullet") {
      if (currentFormats.has("bullet")) document.execCommand("insertUnorderedList", false);
      else replaceSelectionWithBlock("bullet");
    } else if (actionKey === "quote") {
      if (currentFormats.has("quote")) document.execCommand("formatBlock", false, "div");
      else replaceSelectionWithBlock("quote");
    }

    syncValueFromEditor();

    requestAnimationFrame(() => {
      updateMentionMenu();
      updateFormatToolbarVisibility();
    });
  };

  useEffect(() => {
    if (activeMentionIndex >= mentionSuggestions.length) {
      setActiveMentionIndex(0);
    }
  }, [activeMentionIndex, mentionSuggestions.length]);

  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

  useImperativeHandle(ref, () => ({
    reset: clearInput,
    send: sendCurrentValue,
    focus: () => editorRef.current?.focus(),
    insertEmoji: (emoji) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      insertPlainTextAtSelection(emoji);
      syncValueFromEditor();

      requestAnimationFrame(() => {
        updateMentionMenu();
        updateFormatToolbarVisibility();
      });
    },
  }));

  const handleInput = () => {
    syncValueFromEditor();
    requestAnimationFrame(() => {
      updateMentionMenu();
      updateFormatToolbarVisibility();
    });
  };

  const handleKeyDown = (e) => {
    const shortcutKey = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(shortcutKey)) {
      e.preventDefault();
      const action = shortcutKey === "b" ? "bold" : shortcutKey === "i" ? "italic" : "underline";
      applyFormat(action);
      return;
    }

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
    updateMentionMenu();
    updateFormatToolbarVisibilitySoon();
  };

  const handleSelectionChange = () => {
    updateMentionMenu();
    updateFormatToolbarVisibilitySoon();
  };

  const handleFocus = () => {
    clearTimeout(blurTimerRef.current);
    updateFormatToolbarVisibilitySoon();
  };

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => {
      setShowFormatToolbar(false);
      closeMentionMenu();
    }, 180);
  };

  const insertPastedText = (textToInsert) => {
    const cleanText = cleanPastedText(textToInsert);
    if (!cleanText || !editorRef.current) return;

    editorRef.current.focus();
    insertPlainTextAtSelection(cleanText);
    syncValueFromEditor();

    requestAnimationFrame(() => {
      updateMentionMenu();
      updateFormatToolbarVisibility();
    });
  };

  const handlePaste = (e) => {
    const cd = e.clipboardData;
    if (!cd) return;

    const html = cd.getData("text/html") || "";
    const plainText = cd.getData("text/plain") || "";
    const htmlText = getTextFromHtmlWithoutImages(html);
    const pastedText = htmlText || cleanPastedText(plainText);

    const filesFromFiles = Array.from(cd.files || []).filter((f) =>
      f.type.startsWith("image/")
    );

    const filesFromItems = cd.items
      ? Array.from(cd.items || [])
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter(Boolean)
      : [];

    const htmlImageSources = extractImageSourcesFromHtml(html);
    const hasClipboardImages = filesFromFiles.length || filesFromItems.length || htmlImageSources.length;

    e.preventDefault();

    if (hasClipboardImages && typeof onPasteFiles === "function") {
      const imageFiles = [...filesFromFiles, ...filesFromItems];
      const seenFiles = new Set();
      const uniqueImageFiles = imageFiles.filter((file) => {
        const key = `${file.name}-${file.size}-${file.type}-${file.lastModified}`;
        if (seenFiles.has(key)) return false;
        seenFiles.add(key);
        return true;
      });

      const htmlSourcesToConvert = uniqueImageFiles.length ? [] : htmlImageSources;
      const imageSourceFilesPromise = Promise.all(
        htmlSourcesToConvert.map((src, index) =>
          imageSrcToFile(src, index).catch((err) => {
            logDev("No se pudo convertir imagen pegada:", err);
            return null;
          })
        )
      );

      imageSourceFilesPromise.then((sourceFiles) => {
        const allImageFiles = [
          ...uniqueImageFiles,
          ...sourceFiles.filter(Boolean),
        ];

        if (allImageFiles.length) {
          onPasteFiles(allImageFiles, { source: "paste", text: pastedText });
        }

        insertPastedText(pastedText);
      });
      return;
    }

    insertPastedText(pastedText || plainText);
  };

  return (
    <div className="mention-input-wrapper wa-rich-input-wrapper">
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

      {showFormatToolbar && (
        <div
          className="wa-format-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          aria-label="Formato del mensaje"
        >
          {FORMAT_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`wa-format-btn wa-format-${action.key} ${activeFormats.has(action.key) ? "active" : ""}`}
              title={`${action.title}${action.shortcut ? ` (${action.shortcut})` : ""}`}
              aria-label={action.title}
              aria-pressed={activeFormats.has(action.key)}
              onClick={() => applyFormat(action.key)}
            >
              {action.iconClass ? (
                <i className={action.iconClass} aria-hidden="true" />
              ) : (
                <span>{action.label}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div
        ref={editorRef}
        className="form-control wa-rich-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder="Escribe un mensaje... Usa @ para mencionar"
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleSelectionChange}
        onMouseUp={handleSelectionChange}
        onSelect={handleSelectionChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPaste={handlePaste}
      />
    </div>
  );
});

export default React.memo(ChatInput);
