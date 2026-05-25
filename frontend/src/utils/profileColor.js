const DEFAULT_LIGHT_COLOR = "#128c7e";
const DEFAULT_DARK_COLOR = "#7dd3fc";

export const parseColorToRgb = (color) => {
  if (!color || typeof color !== "string") return null;
  const value = color.trim();

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => char + char).join("")
      : hex[1];

    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }

  const rgb = value.match(/^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgb) return null;

  return {
    r: Math.max(0, Math.min(255, Number(rgb[1]))),
    g: Math.max(0, Math.min(255, Number(rgb[2]))),
    b: Math.max(0, Math.min(255, Number(rgb[3]))),
  };
};

export const mixRgb = (rgb, target, ratio) => ({
  r: Math.round(rgb.r + (target.r - rgb.r) * ratio),
  g: Math.round(rgb.g + (target.g - rgb.g) * ratio),
  b: Math.round(rgb.b + (target.b - rgb.b) * ratio),
});

export const rgbToHex = (rgb) =>
  `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;

export const getLuminance = (rgb) => {
  const toLinear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
};

export const getReadableProfileColor = (color, theme = "light") => {
  const rgb = parseColorToRgb(color);
  if (!rgb) return theme === "dark" ? DEFAULT_DARK_COLOR : DEFAULT_LIGHT_COLOR;

  const luminance = getLuminance(rgb);

  if (theme === "dark") {
    if (luminance < 0.34) {
      return rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.56));
    }

    if (luminance < 0.48) {
      return rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.28));
    }

    return rgbToHex(rgb);
  }

  if (luminance > 0.72) {
    return rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.44));
  }

  return rgbToHex(rgb);
};

export const getMessageSenderId = (message = {}) =>
  message.usuario_id ??
  message.usuario_envia_id ??
  message.reply_usuario_id ??
  message.emisor_id ??
  null;

export const getProfileBackgroundFromMessage = (message = {}, currentUser = null) => {
  const senderId = getMessageSenderId(message);

  if (
    currentUser?.id &&
    senderId &&
    Number(senderId) === Number(currentUser.id) &&
    currentUser.background
  ) {
    return currentUser.background;
  }

  return (
    message.background ||
    message.emisor_background ||
    message.usuario_background ||
    message.reply_usuario_background ||
    message.reply_background ||
    message.sender_background ||
    message.color_perfil ||
    null
  );
};

export const getProfileTitleStyle = (message = {}, currentUser = null, theme = "light") => {
  const color = getReadableProfileColor(
    getProfileBackgroundFromMessage(message, currentUser),
    theme
  );

  const outline = theme === "dark"
    ? "0 1px 1px rgba(0,0,0,.85), 0 0 1px rgba(255,255,255,.35)"
    : "0 1px 1px rgba(255,255,255,.85), 0 0 1px rgba(0,0,0,.28)";

  return {
    "--profile-title-color": color,
    "--profile-title-shadow": outline,
    "--sender-name-color": color,
  };
};
