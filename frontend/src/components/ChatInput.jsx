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
import {
  decodeRichHtmlValue,
  encodeRichHtmlValue,
  isRichHtmlValue,
  richHtmlHasFormatting,
  sanitizeRichHtml,
} from "../utils/richText.jsx";

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

const normalizeNewlines = (text = "") =>
  String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");

const cleanPastedText = (text = "") =>
  normalizeNewlines(text)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !IMAGE_PLACEHOLDER_LINE.test(line.trim()))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

const BLOCK_LIKE_CLASSES = new Set([
  "wa-rich-line",
  "wa-rich-empty-line",
  "wa-rich-quote-line",
]);

const isBlockLikeElement = (tagName = "", node = null) => {
  if (
    [
      "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV",
      "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
      "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI",
      "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY",
      "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
    ].includes(String(tagName || "").toUpperCase())
  ) {
    return true;
  }

  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  return Array.from(BLOCK_LIKE_CLASSES).some((className) => node.classList?.contains(className));
};

const htmlNodeToClipboardText = (node) => {
  if (!node) return "";

  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue || "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.tagName.toUpperCase();
  if (["IMG", "PICTURE", "SOURCE", "STYLE", "SCRIPT", "NOSCRIPT"].includes(tag)) {
    return "";
  }

  if (tag === "BR") return "\n";
  if (node.classList?.contains("wa-rich-empty-line")) return "\n";

  const childrenText = Array.from(node.childNodes || [])
    .map((child) => htmlNodeToClipboardText(child))
    .join("");

  if (tag === "LI") return `- ${childrenText.trim()}\n`;
  if (tag === "TD" || tag === "TH") return `${childrenText.trim()}\t`;
  if (tag === "TR") return `${childrenText.replace(/[\t ]+$/g, "")}\n`;
  if (tag === "PRE") return `${childrenText}\n`;

  if (isBlockLikeElement(tag, node)) {
    const value = childrenText.replace(/\n{3,}/g, "\n\n");
    return value.endsWith("\n") ? value : `${value}\n`;
  }

  return childrenText;
};

const getTextFromHtmlWithoutImages = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return "";

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("img, picture, source").forEach((node) => node.remove());
    const structuredText = htmlNodeToClipboardText(doc.body || doc);
    return cleanPastedText(structuredText || doc.body?.innerText || doc.body?.textContent || "");
  } catch (err) {
    logDev("No se pudo limpiar el HTML pegado:", err);
    return "";
  }
};

const htmlNodeToMarkdownText = (node) => {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const tag = node.tagName.toUpperCase();
  if (["IMG", "PICTURE", "SOURCE", "STYLE", "SCRIPT", "NOSCRIPT"].includes(tag)) return "";
  if (tag === "BR") return "\n";
  if (node.classList?.contains("wa-rich-empty-line")) return "\n";

  const styleValue = node.getAttribute("style") || "";
  const children = Array.from(node.childNodes || []).map((child) => htmlNodeToMarkdownText(child)).join("");
  const color = normalizeTextColor(
    node.getAttribute("data-color") ||
    node.getAttribute("color") ||
    extractColorFromStyle(styleValue)
  );

  let formatted = children;

  // No usar else-if: al copiar desde mensajes o desde el navegador un mismo
  // nodo puede traer color + negrita + cursiva. Si solo aplicamos el primer
  // formato, el color se pierde o queda aplicado solo en una parte.
  if (tag === "CODE" || node.classList?.contains("wa-rich-code")) formatted = wrapInlineMarkdown("`", "`", formatted);
  if (tag === "DEL" || tag === "S" || tag === "STRIKE" || node.classList?.contains("wa-rich-strike") || /text-decoration[^;]*(line-through|strike)/i.test(styleValue)) formatted = wrapInlineMarkdown("~", "~", formatted);
  if (tag === "U" || node.classList?.contains("wa-rich-underline") || /text-decoration[^;]*underline/i.test(styleValue)) formatted = wrapInlineMarkdown("__", "__", formatted);
  if (tag === "EM" || tag === "I" || node.classList?.contains("wa-rich-italic") || /font-style\s*:\s*italic/i.test(styleValue)) formatted = wrapInlineMarkdown("_", "_", formatted);
  if (tag === "STRONG" || tag === "B" || node.classList?.contains("wa-rich-bold") || /font-weight\s*:\s*(bold|[6-9]00)/i.test(styleValue)) formatted = wrapInlineMarkdown("**", "**", formatted);
  if (color && !isAdaptiveTextColor(color)) formatted = wrapInlineMarkdown(`[color=${color}]`, "[/color]", formatted);

  if (tag === "LI") return `- ${cleanPastedText(formatted)}\n`;
  if (tag === "TD" || tag === "TH") return `${cleanPastedText(formatted)}\t`;
  if (tag === "TR") return `${formatted.replace(/[\t ]+$/g, "")}\n`;
  if (tag === "PRE") return `${formatted}\n`;

  if (isBlockLikeElement(tag, node)) {
    const value = formatted.replace(/\n{3,}/g, "\n\n");
    return value.endsWith("\n") ? value : `${value}\n`;
  }

  return formatted;
};

const getMarkdownTextFromHtmlWithoutImages = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return "";

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("img, picture, source").forEach((node) => node.remove());
    return cleanPastedText(htmlNodeToMarkdownText(doc.body || doc));
  } catch (err) {
    logDev("No se pudo convertir HTML pegado a texto con formato:", err);
    return "";
  }
};


const normalizeClipboardRichLineHtml = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

  doc.querySelectorAll(".wa-rich-empty-line").forEach((node) => {
    const div = doc.createElement("div");
    div.appendChild(doc.createElement("br"));
    node.parentNode?.replaceChild(div, node);
  });

  doc.querySelectorAll(".wa-rich-line, .wa-rich-quote-line").forEach((node) => {
    const div = doc.createElement("div");
    Array.from(node.attributes || []).forEach((attr) => {
      if (attr.name !== "class") div.setAttribute(attr.name, attr.value);
    });
    while (node.firstChild) div.appendChild(node.firstChild);
    node.parentNode?.replaceChild(div, node);
  });

  doc.querySelectorAll(".wa-rich-line-content").forEach((node) => {
    const fragment = doc.createDocumentFragment();
    while (node.firstChild) fragment.appendChild(node.firstChild);
    node.parentNode?.replaceChild(fragment, node);
  });

  return doc.body.innerHTML;
};

const unwrapNodeKeepingChildren = (node, doc) => {
  const parent = node?.parentNode;
  if (!parent) return;

  const fragment = doc.createDocumentFragment();
  while (node.firstChild) fragment.appendChild(node.firstChild);
  parent.replaceChild(fragment, node);
};

const stripAdaptiveTextColorsFromHtml = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return sanitizeRichHtml(html);

  try {
    const normalizedHtml = normalizeClipboardRichLineHtml(html);
    const doc = new DOMParser().parseFromString(String(normalizedHtml || ""), "text/html");

    doc.querySelectorAll("[style*='color'], [data-color], font[color]").forEach((node) => {
      const color = normalizeTextColor(
        node.getAttribute("data-color") ||
        node.getAttribute("color") ||
        extractColorFromStyle(node.getAttribute("style") || "")
      );

      if (!isAdaptiveTextColor(color)) return;

      node.style?.removeProperty("color");
      node.removeAttribute("data-color");
      node.removeAttribute("color");
      node.classList?.remove("wa-rich-color");

      if (!String(node.getAttribute("style") || "").trim()) node.removeAttribute("style");
    });

    const safeHtml = sanitizeRichHtml(doc.body.innerHTML);
    const cleanDoc = new DOMParser().parseFromString(safeHtml, "text/html");

    cleanDoc.querySelectorAll("span").forEach((node) => {
      const hasAttrs = Array.from(node.attributes || []).some((attr) => {
        if (attr.name === "class" && !attr.value.trim()) return false;
        if (attr.name === "style" && !attr.value.trim()) return false;
        return true;
      });
      if (!hasAttrs) unwrapNodeKeepingChildren(node, cleanDoc);
    });

    return cleanDoc.body.innerHTML;
  } catch (err) {
    logDev("No se pudieron limpiar colores adaptativos del HTML pegado:", err);
    return sanitizeRichHtml(html);
  }
};

const countTextLines = (text = "") =>
  cleanPastedText(text)
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

const chooseBestPastedText = (htmlText = "", plainText = "") => {
  const cleanHtmlText = cleanPastedText(htmlText);
  const cleanPlainText = cleanPastedText(plainText);

  if (!cleanHtmlText) return cleanPlainText;
  if (!cleanPlainText) return cleanHtmlText;

  const htmlLineCount = countTextLines(cleanHtmlText);
  const plainLineCount = countTextLines(cleanPlainText);

  // Cuando se copia texto de WhatsApp, bancos, tablas o mensajes con saltos de
  // línea, algunos navegadores entregan un text/html donde todo queda pegado en
  // una sola línea. En ese caso usamos text/plain, que suele conservar el orden.
  if (plainLineCount >= 2 && plainLineCount > htmlLineCount) return cleanPlainText;

  const htmlHasTabsOrBreaks = /[\t\n]/.test(cleanHtmlText);
  const plainHasTabsOrBreaks = /[\t\n]/.test(cleanPlainText);
  if (plainHasTabsOrBreaks && !htmlHasTabsOrBreaks) return cleanPlainText;

  return cleanHtmlText;
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

const getClipboardImageFileKey = (file) => {
  if (!file) return "";
  // En algunos navegadores la misma imagen pegada llega duplicada como
  // DataTransfer.files y DataTransfer.items con nombres/lastModified distintos.
  // Para pegado desde portapapeles deduplicamos por tipo + tamaño, que es
  // estable para esos duplicados.
  return `${file.type || "image"}:${file.size || 0}`;
};

const uniqueClipboardImageFiles = (files = []) => {
  const seen = new Set();

  return Array.from(files || []).filter((file) => {
    if (!file || !file.type?.startsWith("image/")) return false;
    const key = getClipboardImageFileKey(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
  { key: "color", label: "A", iconClass: "fa-solid fa-palette", title: "Color de texto" },
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

const TEXT_COLOR_OPTIONS = [
  "#2787F5",
  "#00A884",
  "#FF6B6B",
  "#FF9F1A",
  "#FFD43B",
  "#845EF7",
  "#F06595",
  "#12B886",
];

const normalizeTextColor = (color = "") => {
  const value = String(color || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  return "";
};

const ADAPTIVE_TEXT_COLORS = new Set([
  "#000000",
  "#FFFFFF",
  "#111B21",
  "#202C33",
  "#E9EDEF",
  "#AEBAC1",
]);

const isAdaptiveTextColor = (color = "") => {
  const normalized = normalizeTextColor(color);
  if (!normalized) return false;
  if (ADAPTIVE_TEXT_COLORS.has(normalized)) return true;

  const match = normalized.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/);
  if (!match) return false;

  const [, rHex, gHex, bHex] = match;
  const r = parseInt(rHex, 16);
  const g = parseInt(gHex, 16);
  const b = parseInt(bHex, 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  // Negro/blanco/grises muy cercanos al color base deben seguir el tema
  // claro/oscuro. No se guardan como formato real de color al pegar/copiar.
  return max - min <= 8 && (max <= 36 || min >= 232);
};

const extractColorFromStyle = (styleValue = "") => {
  const style = String(styleValue || "");
  const hexMatch = style.match(/color\s*:\s*(#[0-9a-fA-F]{3,6})/i);
  if (hexMatch) return normalizeTextColor(hexMatch[1]);

  const rgbMatch = style.match(/color\s*:\s*rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgbMatch) return "";

  const [, r, g, b] = rgbMatch;
  const toHex = (value) => Number(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const wrapInlineMarkdown = (open, close, content = "") => {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  if (!normalized.includes("\n")) return `${open}${normalized}${close}`;

  return normalized
    .split("\n")
    .map((line) => (line ? `${open}${line}${close}` : ""))
    .join("\n");
};

const findBalancedColorToken = (text = "") => {
  const source = String(text || "");
  const openRegex = /\[color=(#[0-9a-fA-F]{3,6})\]/g;
  const firstOpen = openRegex.exec(source);
  if (!firstOpen) return null;

  let depth = 1;
  let cursor = firstOpen.index + firstOpen[0].length;
  const tokenRegex = /\[color=#[0-9a-fA-F]{3,6}\]|\[\/color\]/g;
  tokenRegex.lastIndex = cursor;

  let match;
  while ((match = tokenRegex.exec(source))) {
    if (match[0].startsWith("[color=")) depth += 1;
    else depth -= 1;

    if (depth === 0) {
      return {
        color: normalizeTextColor(firstOpen[1]),
        openIndex: firstOpen.index,
        openLength: firstOpen[0].length,
        closeIndex: match.index,
        endIndex: match.index + match[0].length,
        content: source.slice(firstOpen.index + firstOpen[0].length, match.index),
      };
    }
  }

  return null;
};

const inlineMarkdownToHtml = (value = "", depth = 0) => {
  const text = String(value || "");
  if (!text) return "";
  if (depth > 12) return escapeHtml(text);

  const colorToken = findBalancedColorToken(text);
  let bestMatch = null;

  if (colorToken) {
    bestMatch = {
      rule: { key: "color", open: text.slice(colorToken.openIndex, colorToken.openIndex + colorToken.openLength), close: "[/color]", tag: "span", className: "wa-rich-color", color: colorToken.color },
      openIndex: colorToken.openIndex,
      closeIndex: colorToken.closeIndex,
      content: colorToken.content,
      endIndex: colorToken.endIndex,
    };
  }

  INLINE_MARKDOWN_RULES.forEach((rule) => {
    const openIndex = text.indexOf(rule.open);
    if (openIndex === -1) return;
    const closeIndex = text.indexOf(rule.close, openIndex + rule.open.length);
    if (closeIndex === -1 || closeIndex === openIndex + rule.open.length) return;
    if (!bestMatch || openIndex < bestMatch.openIndex || (openIndex === bestMatch.openIndex && rule.open.length > bestMatch.rule.open.length)) {
      bestMatch = { rule, openIndex, closeIndex, endIndex: closeIndex + rule.close.length };
    }
  });

  if (!bestMatch) return escapeHtml(text);

  const { rule, openIndex, closeIndex } = bestMatch;
  const before = inlineMarkdownToHtml(text.slice(0, openIndex), depth + 1);
  const content = bestMatch.content ?? text.slice(openIndex + rule.open.length, closeIndex);
  const after = inlineMarkdownToHtml(text.slice(bestMatch.endIndex ?? (closeIndex + rule.close.length)), depth + 1);
  const inner = rule.raw ? escapeHtml(content) : inlineMarkdownToHtml(content, depth + 1);

  if (rule.key === "color") {
    const color = normalizeTextColor(rule.color);
    if (!color || isAdaptiveTextColor(color)) return `${before}${inner}${after}`;
    return `${before}<span class="wa-rich-color" data-color="${color}" style="color:${color}">${inner}</span>${after}`;
  }

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
  const styleValue = node.getAttribute("style") || "";
  const color = normalizeTextColor(
    node.getAttribute("data-color") ||
    node.getAttribute("color") ||
    extractColorFromStyle(styleValue)
  );

  let inlineContent = getChildrenMarkdown(node);

  if (tag === "code" || node.classList?.contains("wa-rich-code")) inlineContent = wrapInlineMarkdown("`", "`", inlineContent);
  if (tag === "del" || tag === "s" || tag === "strike" || node.classList?.contains("wa-rich-strike") || /text-decoration[^;]*(line-through|strike)/i.test(styleValue)) inlineContent = wrapInlineMarkdown("~", "~", inlineContent);
  if (tag === "u" || node.classList?.contains("wa-rich-underline") || /text-decoration[^;]*underline/i.test(styleValue)) inlineContent = wrapInlineMarkdown("__", "__", inlineContent);
  if (tag === "em" || tag === "i" || node.classList?.contains("wa-rich-italic") || /font-style\s*:\s*italic/i.test(styleValue)) inlineContent = wrapInlineMarkdown("_", "_", inlineContent);
  if (tag === "strong" || tag === "b" || node.classList?.contains("wa-rich-bold") || /font-weight\s*:\s*(bold|[6-9]00)/i.test(styleValue)) inlineContent = wrapInlineMarkdown("**", "**", inlineContent);
  if (color && !isAdaptiveTextColor(color)) inlineContent = wrapInlineMarkdown(`[color=${color}]`, "[/color]", inlineContent);

  if (["span", "strong", "b", "em", "i", "u", "del", "s", "strike", "code"].includes(tag)) {
    return inlineContent;
  }
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

const editorHasRichFormatting = (editor) => {
  if (!editor) return false;

  if (
    editor.querySelector(
      "strong,b,em,i,u,del,s,strike,code,ul,ol,blockquote,span[data-color],span[style*='color'],.wa-rich-color,.wa-rich-bold,.wa-rich-italic,.wa-rich-underline,.wa-rich-strike,.wa-rich-code"
    )
  ) {
    return true;
  }

  return Array.from(editor.querySelectorAll("span,div,p")).some((node) => {
    const style = node.getAttribute("style") || "";
    return /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) ||
      /font-style\s*:\s*italic/i.test(style) ||
      /text-decoration[^;]*(underline|line-through|strike)/i.test(style) ||
      /(?:^|;)\s*color\s*:/i.test(style);
  });
};

const editorToMessageValue = (editor) => {
  if (!editor) return "";

  const plainText = getEditorPlainText(editor)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

  if (!editorHasRichFormatting(editor)) return plainText;

  // Guardamos el mensaje rico como texto con marcadores propios en lugar de
  // guardar el HTML crudo del contentEditable. Los navegadores suelen dejar
  // estructuras como <b><i>Hola<div>como</div></i></b> después de mezclar
  // saltos de línea, negrita, cursiva, subrayado y tachado; al enviarlas como
  // HTML esos bloques internos pueden terminar renderizándose en una sola línea.
  // La serialización a markdown conserva los saltos visuales y los estilos por
  // línea, y el render del mensaje ya interpreta esos marcadores.
  const markdown = editorToMarkdown(editor);
  return markdown || plainText;
};

const clipboardHtmlShouldKeepRichFormatting = (html = "") => {
  if (!html || typeof DOMParser === "undefined") return false;
  return richHtmlHasFormatting(html);
};

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

const insertMarkdownAtSelection = (markdown = "") => {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) {
    document.execCommand("insertHTML", false, markdownToEditorHtml(markdown));
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const holder = document.createElement("div");
  holder.innerHTML = markdownToEditorHtml(markdown);
  const fragment = document.createDocumentFragment();
  let lastNode = null;

  while (holder.firstChild) {
    lastNode = holder.firstChild;
    fragment.appendChild(lastNode);
  }

  range.insertNode(fragment);

  if (lastNode) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
};

const insertRichHtmlAtSelection = (html = "") => {
  const safeHtml = sanitizeRichHtml(html);
  if (!safeHtml) return;

  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) {
    document.execCommand("insertHTML", false, safeHtml);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const holder = document.createElement("div");
  holder.innerHTML = safeHtml;
  const fragment = document.createDocumentFragment();
  let lastNode = null;

  while (holder.firstChild) {
    lastNode = holder.firstChild;
    fragment.appendChild(lastNode);
  }

  range.insertNode(fragment);

  if (lastNode) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
};

const ChatInput = forwardRef(({
  onSend,
  onPasteFiles,
  onValueChange,
  mentionOptions = [],
  initialValue = "",
  placeholder = "Escribe un mensaje... Usa @ para mencionar",
  autoFocus = false,
  variant = "default",
}, ref) => {
  const [value, setValue] = useState(initialValue || "");
  const [mentionMatch, setMentionMatch] = useState(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [activeFormats, setActiveFormats] = useState(() => new Set());
  const [activeColor, setActiveColor] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const editorRef = useRef(null);
  const savedSelectionRangeRef = useRef(null);
  const blurTimerRef = useRef(null);
  const lastInitialValueRef = useRef(undefined);

  const syncValueFromEditor = () => {
    const editor = editorRef.current;
    if (!editor) return "";
    const nextValue = editorToMessageValue(editor);
    setValue(nextValue);
    if (typeof onValueChange === "function") onValueChange(nextValue);
    return nextValue;
  };

  const setEditorHtmlFromValue = (nextValue = "") => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = isRichHtmlValue(nextValue)
      ? sanitizeRichHtml(decodeRichHtmlValue(nextValue))
      : markdownToEditorHtml(nextValue);
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

  const getNearestColorNode = (node) => {
    const editor = editorRef.current;
    if (!node || !editor) return null;
    let current = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    while (current && current !== editor) {
      if (current.tagName === "SPAN" && (current.dataset?.color || extractColorFromStyle(current.getAttribute("style") || ""))) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  };

  const getSelectionColor = () => {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return "";
    const node = getNearestColorNode(selection.anchorNode) || getNearestColorNode(selection.focusNode) || getNearestColorNode(selection.getRangeAt(0).commonAncestorContainer);
    return normalizeTextColor(node?.dataset?.color || extractColorFromStyle(node?.getAttribute?.("style") || ""));
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
    const colorNode = getNearestColorNode(anchor) || getNearestColorNode(focus) || getNearestColorNode(common);
    if (colorNode) formats.add("color");

    return formats;
  };

  const saveCurrentSelectionRange = () => {
    const editor = editorRef.current;
    const selection = window.getSelection?.();
    if (!editor || !selection || selection.rangeCount === 0 || !isSelectionInside(editor)) return;
    savedSelectionRangeRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSavedSelectionRange = () => {
    const editor = editorRef.current;
    const selection = window.getSelection?.();
    const range = savedSelectionRangeRef.current;
    if (!editor || !selection || !range) return false;

    try {
      selection.removeAllRanges();
      selection.addRange(range);
      editor.focus();
      return true;
    } catch {
      return false;
    }
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
    setActiveColor(hasSelection ? getSelectionColor() : "");
    if (hasSelection) saveCurrentSelectionRange();
    if (!hasSelection) setShowColorPicker(false);
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
    setShowColorPicker(false);
    setActiveColor("");
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

  const unwrapColorElementsInside = (root) => {
    if (!root) return;

    const colorNodes = root.querySelectorAll?.(".wa-rich-color, span[data-color], span[style*='color']") || [];
    Array.from(colorNodes).forEach((colorNode) => {
      colorNode.style?.removeProperty("color");
      colorNode.removeAttribute("data-color");
      colorNode.classList?.remove("wa-rich-color");

      if (colorNode.tagName === "SPAN" && !colorNode.getAttribute("style") && !colorNode.className) {
        const parent = colorNode.parentNode;
        if (!parent) return;
        const fragment = document.createDocumentFragment();
        while (colorNode.firstChild) fragment.appendChild(colorNode.firstChild);
        parent.replaceChild(fragment, colorNode);
      }
    });
  };

  const unwrapSingleColorNode = (colorNode) => {
    if (!colorNode?.parentNode) return false;
    const parent = colorNode.parentNode;
    const fragment = document.createDocumentFragment();
    while (colorNode.firstChild) fragment.appendChild(colorNode.firstChild);
    parent.replaceChild(fragment, colorNode);
    return true;
  };

  const unwrapNearestColor = () => {
    const selection = window.getSelection?.();
    const editor = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !editor || !isSelectionInside(editor)) return false;

    const colorNode = getNearestColorNode(selection.anchorNode) || getNearestColorNode(selection.focusNode);
    return unwrapSingleColorNode(colorNode);
  };

  const resetSelectionColor = () => {
    const selection = window.getSelection?.();
    const editor = editorRef.current;
    if (!selection || selection.rangeCount === 0 || !editor || !isSelectionInside(editor)) return false;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return unwrapNearestColor();

    const fragment = range.extractContents();
    const holder = document.createElement("div");
    holder.appendChild(fragment);
    unwrapColorElementsInside(holder);

    const cleaned = document.createDocumentFragment();
    let lastNode = null;
    while (holder.firstChild) {
      lastNode = holder.firstChild;
      cleaned.appendChild(lastNode);
    }

    range.insertNode(cleaned);

    if (lastNode) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(lastNode);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }

    unwrapColorElementsInside(editor);
    return true;
  };

  const wrapSelectionWithColor = (color) => {
    const normalizedColor = normalizeTextColor(color);
    const selection = window.getSelection?.();
    const editor = editorRef.current;
    if (!normalizedColor || !selection || selection.rangeCount === 0 || !editor || !isSelectionInside(editor)) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    if (activeColor === normalizedColor && unwrapNearestColor()) return;

    const wrapper = document.createElement("span");
    wrapper.className = "wa-rich-color";
    wrapper.dataset.color = normalizedColor;
    wrapper.style.color = normalizedColor;

    try {
      const content = range.extractContents();
      const holder = document.createElement("div");
      holder.appendChild(content);
      unwrapColorElementsInside(holder);
      while (holder.firstChild) wrapper.appendChild(holder.firstChild);
      range.insertNode(wrapper);
    } catch {
      const content = range.extractContents();
      const holder = document.createElement("div");
      holder.appendChild(content);
      unwrapColorElementsInside(holder);
      while (holder.firstChild) wrapper.appendChild(holder.firstChild);
      range.insertNode(wrapper);
    }

    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection.addRange(nextRange);
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

    if (actionKey === "color") {
      saveCurrentSelectionRange();
      setShowColorPicker((prev) => !prev);
      return;
    }

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

  const applyColor = (color) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSavedSelectionRange();
    editor.focus();

    const normalizedColor = normalizeTextColor(color);
    if (normalizedColor) {
      wrapSelectionWithColor(normalizedColor);
      setActiveColor(normalizedColor);
    } else {
      resetSelectionColor();
      setActiveColor("");
    }

    setShowColorPicker(false);
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

  useEffect(() => {
    const normalizedInitialValue = initialValue || "";
    if (lastInitialValueRef.current === normalizedInitialValue) return;
    lastInitialValueRef.current = normalizedInitialValue;
    setValue(normalizedInitialValue);
    setEditorHtmlFromValue(normalizedInitialValue);
    if (typeof onValueChange === "function") onValueChange(normalizedInitialValue);
    if (autoFocus) requestAnimationFrame(() => editorRef.current?.focus());
  }, [initialValue, autoFocus]);

  useImperativeHandle(ref, () => ({
    reset: clearInput,
    send: sendCurrentValue,
    focus: () => editorRef.current?.focus(),
    setValue: (nextValue = "") => {
      setValue(nextValue);
      setEditorHtmlFromValue(nextValue);
      if (typeof onValueChange === "function") onValueChange(nextValue);
    },
    applyFormat,
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
      setShowColorPicker(false);
      closeMentionMenu();
    }, 180);
  };

  const insertPastedText = (textToInsert) => {
    const cleanText = cleanPastedText(textToInsert);
    if (!cleanText || !editorRef.current) return;

    editorRef.current.focus();
    insertMarkdownAtSelection(cleanText);
    syncValueFromEditor();

    requestAnimationFrame(() => {
      updateMentionMenu();
      updateFormatToolbarVisibility();
    });
  };

  const insertPastedRichHtml = (htmlToInsert) => {
    const safeHtml = stripAdaptiveTextColorsFromHtml(htmlToInsert);
    if (!safeHtml || !editorRef.current) return;

    editorRef.current.focus();
    insertRichHtmlAtSelection(safeHtml);
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
    const htmlMarkdownText = getMarkdownTextFromHtmlWithoutImages(html);
    const pastedText = chooseBestPastedText(htmlMarkdownText || htmlText, plainText);

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
    const plainLineCount = countTextLines(plainText);
    const htmlLineCount = countTextLines(htmlMarkdownText || htmlText);
    const shouldPreferPlainLineBreaks = plainLineCount >= 2 && (plainLineCount > htmlLineCount || htmlLineCount <= 1);
    const htmlWithoutAdaptiveColors = stripAdaptiveTextColorsFromHtml(html);
    const shouldKeepRichHtml = !hasClipboardImages && !shouldPreferPlainLineBreaks && clipboardHtmlShouldKeepRichFormatting(htmlWithoutAdaptiveColors);

    e.preventDefault();

    if (shouldKeepRichHtml) {
      insertPastedRichHtml(htmlWithoutAdaptiveColors);
      return;
    }

    if (hasClipboardImages && typeof onPasteFiles === "function") {
      const imageFiles = [...filesFromFiles, ...filesFromItems];
      const uniqueImageFiles = uniqueClipboardImageFiles(imageFiles);

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
        const allImageFiles = uniqueClipboardImageFiles([
          ...uniqueImageFiles,
          ...sourceFiles.filter(Boolean),
        ]);

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
    <div className={`mention-input-wrapper wa-rich-input-wrapper wa-rich-input-${variant}`}>
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
              {action.key === "color" && activeColor ? (
                <span className="wa-format-color-swatch" style={{ backgroundColor: activeColor }} />
              ) : action.iconClass ? (
                <i className={action.iconClass} aria-hidden="true" />
              ) : (
                <span>{action.label}</span>
              )}
            </button>
          ))}
          {showColorPicker && (
            <div className="wa-format-color-popover" onMouseDown={(e) => e.preventDefault()}>
              <div className="wa-format-color-title">Color del texto</div>
              <div className="wa-format-color-grid">
                <button
                  type="button"
                  className={`wa-format-color-dot wa-format-color-reset ${!activeColor ? "active" : ""}`}
                  aria-label="Restablecer color del texto"
                  title="Restablecer color"
                  onClick={() => applyColor("")}
                />
                {TEXT_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`wa-format-color-dot ${activeColor === color ? "active" : ""}`}
                    style={{ backgroundColor: color }}
                    aria-label={`Color ${color}`}
                    onClick={() => applyColor(color)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}


      <div
        ref={editorRef}
        className="form-control wa-rich-editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
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
