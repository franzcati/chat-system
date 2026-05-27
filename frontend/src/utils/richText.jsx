import React from "react";

const INLINE_RULES = [
  { key: "bold", open: "**", close: "**", tag: "strong", className: "wa-rich-bold" },
  { key: "underline", open: "__", close: "__", tag: "span", className: "wa-rich-underline" },
  { key: "strike2", open: "~~", close: "~~", tag: "del", className: "wa-rich-strike" },
  { key: "code", open: "`", close: "`", tag: "code", className: "wa-rich-code", raw: true },
  { key: "italic", open: "_", close: "_", tag: "em", className: "wa-rich-italic" },
  { key: "strike", open: "~", close: "~", tag: "del", className: "wa-rich-strike" },
];

const normalizeText = (value = "") => String(value ?? "");

export const stripRichTextSyntax = (value = "") => {
  let text = normalizeText(value).replace(/\r\n/g, "\n");

  // Primero limpiamos marcadores de bloque que WhatsApp no muestra en previews.
  text = text
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, "").replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+\.\s+/, ""))
    .join(" ");

  let previous;
  do {
    previous = text;
    text = text
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

  if (rule.tag === "strong") return <strong key={key} className={rule.className}>{children}</strong>;
  if (rule.tag === "em") return <em key={key} className={rule.className}>{children}</em>;
  if (rule.tag === "del") return <del key={key} className={rule.className}>{children}</del>;
  if (rule.tag === "code") return <code key={key} className={rule.className}>{children}</code>;
  return <span key={key} className={rule.className}>{children}</span>;
};

export const renderRichTextInline = (
  value = "",
  keyPrefix = "rich-inline",
  depth = 0,
  renderPlainText = (text, key) => <React.Fragment key={key}>{text}</React.Fragment>
) => {
  const text = normalizeText(value);
  if (!text) return [];
  if (depth > 8) return [renderPlainText(text, `${keyPrefix}-plain`)];

  let bestMatch = null;

  INLINE_RULES.forEach((rule) => {
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
      bestMatch = { rule, openIndex, closeIndex };
    }
  });

  if (!bestMatch) return [renderPlainText(text, `${keyPrefix}-plain`)];

  const { rule, openIndex, closeIndex } = bestMatch;
  const before = text.slice(0, openIndex);
  const content = text.slice(openIndex + rule.open.length, closeIndex);
  const after = text.slice(closeIndex + rule.close.length);

  return [
    ...renderRichTextInline(before, `${keyPrefix}-before`, depth + 1, renderPlainText),
    renderFormattedNode(rule, content, `${keyPrefix}-${rule.key}-${openIndex}`, depth, renderPlainText),
    ...renderRichTextInline(after, `${keyPrefix}-after`, depth + 1, renderPlainText),
  ];
};

export const hasRichTextSyntax = (value = "") => stripRichTextSyntax(value) !== normalizeText(value).replace(/\s+/g, " ").trim();
