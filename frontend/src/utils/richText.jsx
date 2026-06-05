import React from "react";

const INLINE_RULES = [
  { key: "color", open: "[color=", close: "[/color]", tag: "span", className: "wa-rich-color", color: true },
  { key: "bold", open: "**", close: "**", tag: "strong", className: "wa-rich-bold" },
  { key: "underline", open: "__", close: "__", tag: "span", className: "wa-rich-underline" },
  { key: "strike2", open: "~~", close: "~~", tag: "del", className: "wa-rich-strike" },
  { key: "code", open: "`", close: "`", tag: "code", className: "wa-rich-code", raw: true },
  { key: "italic", open: "_", close: "_", tag: "em", className: "wa-rich-italic" },
  { key: "strike", open: "~", close: "~", tag: "del", className: "wa-rich-strike" },
];

const normalizeText = (value = "") => String(value ?? "");

const normalizeRichTextColor = (color = "") => {
  const value = String(color || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  return "";
};

const ADAPTIVE_RICH_TEXT_COLORS = new Set([
  "#000000",
  "#FFFFFF",
  "#111B21",
  "#202C33",
  "#E9EDEF",
  "#AEBAC1",
  "#D1D7DB",
]);

const isAdaptiveRichTextColor = (color = "") => {
  const normalized = normalizeRichTextColor(color);
  if (!normalized) return false;
  if (ADAPTIVE_RICH_TEXT_COLORS.has(normalized)) return true;

  const match = normalized.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/);
  if (!match) return false;

  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  // Blanco, negro y grises casi puros son colores del tema, no colores
  // elegidos por el usuario. No deben quedar fijos al copiar/pegar.
  return max - min <= 10 && (max <= 42 || min >= 222);
};

export const RICH_HTML_PREFIX = "[rich-html]";

export const isRichHtmlValue = (value = "") =>
  String(value || "").startsWith(RICH_HTML_PREFIX);

export const decodeRichHtmlValue = (value = "") => {
  const raw = String(value || "");
  if (!raw.startsWith(RICH_HTML_PREFIX)) return "";

  try {
    return decodeURIComponent(raw.slice(RICH_HTML_PREFIX.length));
  } catch {
    return raw.slice(RICH_HTML_PREFIX.length);
  }
};

const ALLOWED_RICH_TAGS = new Set([
  "div", "p", "br", "strong", "b", "em", "i", "u", "del", "s", "strike",
  "code", "span", "ul", "ol", "li", "blockquote"
]);

const BLOCK_RICH_TAGS = new Set(["div", "p", "ul", "ol", "li", "blockquote"]);

const escapeHtmlValue = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");

const extractColorFromStyleValue = (styleValue = "") => {
  const style = String(styleValue || "");
  const hexMatch = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6})/i);
  if (hexMatch) return normalizeRichTextColor(hexMatch[1]);

  const rgbMatch = style.match(/(?:^|;)\s*color\s*:\s*rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgbMatch) return "";

  const toHex = (value) => Number(value).toString(16).padStart(2, "0");
  return normalizeRichTextColor(`#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`);
};

const sanitizeRichNode = (node, doc) => {
  if (!node) return doc.createDocumentFragment();

  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.nodeValue || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return doc.createDocumentFragment();
  }

  let tag = String(node.tagName || "").toLowerCase();
  if (["script", "style", "iframe", "object", "embed", "img", "picture", "source", "video", "audio"].includes(tag)) {
    return doc.createDocumentFragment();
  }

  if (tag === "font") tag = "span";
  if (tag === "strike") tag = "s";
  if (!ALLOWED_RICH_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment();
    Array.from(node.childNodes || []).forEach((child) => {
      fragment.appendChild(sanitizeRichNode(child, doc));
    });
    return fragment;
  }

  const el = doc.createElement(tag);

  if (tag === "strong" || tag === "b") el.className = "wa-rich-bold";
  if (tag === "em" || tag === "i") el.className = "wa-rich-italic";
  if (tag === "u") el.className = "wa-rich-underline";
  if (tag === "del" || tag === "s") el.className = "wa-rich-strike";
  if (tag === "code") el.className = "wa-rich-code";

  if (tag === "ol") {
    const start = Number(node.getAttribute("start"));
    if (Number.isFinite(start) && start > 1) el.setAttribute("start", String(start));
  }

  const styleValue = node.getAttribute("style") || "";
  const color = normalizeRichTextColor(
    node.getAttribute("data-color") ||
    node.getAttribute("color") ||
    extractColorFromStyleValue(styleValue)
  );

  if (color && !isAdaptiveRichTextColor(color)) {
    el.classList.add("wa-rich-color");
    el.dataset.color = color;
    el.style.color = color;
  }

  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(styleValue) && tag === "span") el.classList.add("wa-rich-bold");
  if (/font-style\s*:\s*italic/i.test(styleValue) && tag === "span") el.classList.add("wa-rich-italic");
  if (/text-decoration[^;]*underline/i.test(styleValue) && tag === "span") el.classList.add("wa-rich-underline");
  if (/text-decoration[^;]*(line-through|strike)/i.test(styleValue) && tag === "span") el.classList.add("wa-rich-strike");

  Array.from(node.childNodes || []).forEach((child) => {
    el.appendChild(sanitizeRichNode(child, doc));
  });

  if (tag === "span" && !el.getAttribute("style") && !el.className) {
    const fragment = doc.createDocumentFragment();
    while (el.firstChild) fragment.appendChild(el.firstChild);
    return fragment;
  }

  return el;
};

export const sanitizeRichHtml = (html = "") => {
  const raw = String(html || "");
  if (!raw.trim()) return "";

  if (typeof document === "undefined") return escapeHtmlValue(raw);

  const template = document.createElement("template");
  template.innerHTML = raw;
  const out = document.createElement("div");

  Array.from(template.content.childNodes || []).forEach((node) => {
    out.appendChild(sanitizeRichNode(node, document));
  });

  return out.innerHTML
    .replace(/<div><br><\/div>$/i, "")
    .replace(/(<div><br><\/div>){3,}/gi, "<div><br></div><div><br></div>");
};

export const encodeRichHtmlValue = (html = "") => {
  const safeHtml = sanitizeRichHtml(html);
  return safeHtml ? `${RICH_HTML_PREFIX}${encodeURIComponent(safeHtml)}` : "";
};

const appendRichPlainText = (node, output = []) => {
  if (!node) return output;

  if (node.nodeType === Node.TEXT_NODE) {
    output.push(node.nodeValue || "");
    return output;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return output;

  const tag = String(node.tagName || "").toLowerCase();
  if (tag === "br") {
    output.push("\n");
    return output;
  }

  if (tag === "li") {
    Array.from(node.childNodes || []).forEach((child) => appendRichPlainText(child, output));
    output.push("\n");
    return output;
  }

  Array.from(node.childNodes || []).forEach((child) => appendRichPlainText(child, output));
  if (BLOCK_RICH_TAGS.has(tag)) output.push("\n");
  return output;
};

export const richHtmlToPlainText = (htmlOrValue = "") => {
  const html = isRichHtmlValue(htmlOrValue) ? decodeRichHtmlValue(htmlOrValue) : String(htmlOrValue || "");
  if (!html.trim()) return "";

  if (typeof DOMParser === "undefined") {
    return html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), "text/html");
  return appendRichPlainText(doc.body, [])
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const richHtmlHasFormatting = (html = "") => {
  const raw = String(html || "");
  if (!raw.trim() || typeof DOMParser === "undefined") return false;

  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    if (doc.querySelector("strong,b,em,i,u,del,s,strike,code,ul,ol,blockquote")) {
      return true;
    }

    if (Array.from(doc.querySelectorAll("[data-color],[style*='color'],font[color]")).some((el) => {
      const color = normalizeRichTextColor(
        el.getAttribute("data-color") ||
        el.getAttribute("color") ||
        extractColorFromStyleValue(el.getAttribute("style") || "")
      );
      return color && !isAdaptiveRichTextColor(color);
    })) {
      return true;
    }

    return Array.from(doc.querySelectorAll("span,div,p")).some((el) => {
      const style = el.getAttribute("style") || "";
      return /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) ||
        /font-style\s*:\s*italic/i.test(style) ||
        /text-decoration[^;]*(underline|line-through|strike)/i.test(style);
    });
  } catch {
    return false;
  }
};


const stripColorSyntaxOnce = (value = "") => {
  const source = String(value || "");
  const tokenRegex = /\[color=#[0-9a-fA-F]{3,6}\]|\[\/color\]/g;
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(source))) {
    output += source.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
  }

  return output + source.slice(lastIndex);
};

export const stripRichTextSyntax = (value = "") => {
  if (isRichHtmlValue(value)) return richHtmlToPlainText(value).replace(/\s+/g, " ").trim();

  let text = normalizeText(value).replace(/\r\n/g, "\n");

  // Primero limpiamos marcadores de bloque que WhatsApp no muestra en previews.
  text = text
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, "").replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+\.\s+/, ""))
    .join(" ");

  let previous;
  do {
    previous = text;
    text = stripColorSyntaxOnce(text)
      .replace(/\*\*([^*\n][\s\S]*?[^*\n]|[^*\n])\*\*/g, "$1")
      .replace(/__([^_\n][\s\S]*?[^_\n]|[^_\n])__/g, "$1")
      .replace(/~~([^~\n][\s\S]*?[^~\n]|[^~\n])~~/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/_([^_\n]+)_/g, "$1")
      .replace(/~([^~\n]+)~/g, "$1");
  } while (text !== previous);

  return text.replace(/\s+/g, " ").trim();
};

const renderFormattedNode = (rule, content, key, depth, renderPlainText) => {
  const children = rule.raw
    ? content
    : renderRichTextInline(content, `${key}-inner`, depth + 1, renderPlainText);

  if (rule.key === "color") {
    const color = normalizeRichTextColor(rule.currentColor);
    return color && !isAdaptiveRichTextColor(color) ? <span key={key} className={rule.className} style={{ color }}>{children}</span> : <React.Fragment key={key}>{children}</React.Fragment>;
  }
  if (rule.tag === "strong") return <strong key={key} className={rule.className}>{children}</strong>;
  if (rule.tag === "em") return <em key={key} className={rule.className}>{children}</em>;
  if (rule.tag === "del") return <del key={key} className={rule.className}>{children}</del>;
  if (rule.tag === "code") return <code key={key} className={rule.className}>{children}</code>;
  return <span key={key} className={rule.className}>{children}</span>;
};

const findBalancedRichColorToken = (text = "") => {
  const source = String(text || "");
  const openRegex = /\[color=(#[0-9a-fA-F]{3,6})\]/g;
  const firstOpen = openRegex.exec(source);
  if (!firstOpen) return null;

  let depth = 1;
  const tokenRegex = /\[color=#[0-9a-fA-F]{3,6}\]|\[\/color\]/g;
  tokenRegex.lastIndex = firstOpen.index + firstOpen[0].length;

  let match;
  while ((match = tokenRegex.exec(source))) {
    if (match[0].startsWith("[color=")) depth += 1;
    else depth -= 1;

    if (depth === 0) {
      return {
        color: normalizeRichTextColor(firstOpen[1]),
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

export const renderRichTextInline = (
  value = "",
  keyPrefix = "rich-inline",
  depth = 0,
  renderPlainText = (text, key) => <React.Fragment key={key}>{text}</React.Fragment>
) => {
  const text = normalizeText(value);
  if (!text) return [];
  if (depth > 12) return [renderPlainText(text, `${keyPrefix}-plain`)];

  let bestMatch = null;

  const colorToken = findBalancedRichColorToken(text);
  if (colorToken) {
    bestMatch = {
      rule: { ...INLINE_RULES.find((rule) => rule.key === "color"), currentColor: colorToken.color },
      openIndex: colorToken.openIndex,
      closeIndex: colorToken.closeIndex,
      content: colorToken.content,
      endIndex: colorToken.endIndex,
    };
  }

  INLINE_RULES.filter((rule) => !rule.color).forEach((rule) => {
    const openIndex = text.indexOf(rule.open);
    if (openIndex === -1) return;

    const closeIndex = text.indexOf(rule.close, openIndex + rule.open.length);
    if (closeIndex === -1) return;
    if (closeIndex === openIndex + rule.open.length) return;

    if (
      !bestMatch ||
      openIndex < bestMatch.openIndex ||
      (openIndex === bestMatch.openIndex && rule.open.length > bestMatch.rule.open.length)
    ) {
      bestMatch = { rule, openIndex, closeIndex, endIndex: closeIndex + rule.close.length };
    }
  });

  if (!bestMatch) return [renderPlainText(text, `${keyPrefix}-plain`)];

  const { rule, openIndex, closeIndex } = bestMatch;
  const before = text.slice(0, openIndex);
  const content = bestMatch.content ?? text.slice(openIndex + rule.open.length, closeIndex);
  const after = text.slice(bestMatch.endIndex ?? (closeIndex + rule.close.length));

  return [
    ...renderRichTextInline(before, `${keyPrefix}-before`, depth + 1, renderPlainText),
    renderFormattedNode(rule, content, `${keyPrefix}-${rule.key}-${openIndex}`, depth, renderPlainText),
    ...renderRichTextInline(after, `${keyPrefix}-after`, depth + 1, renderPlainText),
  ];
};

export const hasRichTextSyntax = (value = "") => isRichHtmlValue(value) || stripRichTextSyntax(value) !== normalizeText(value).replace(/\s+/g, " ").trim();
