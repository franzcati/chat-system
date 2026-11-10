// Borradores locales: cada usuario y conversación tiene su propio texto.
// No se transmiten al backend, y no se mezclan entre cuentas del mismo navegador.
export const CHAT_DRAFTS_EVENT = "quickchat:drafts-changed";
const PREFIX = "quickchat:text-drafts:v1:";
const storageKey = (userId) => `${PREFIX}${String(userId)}`;

export const getDraftChatKey = (chat) => {
  if (!chat) return null;
  const group = chat.tipo === "grupo";
  const rawId = group ? chat.grupo_id : chat.usuario_id;
  if (rawId === undefined || rawId === null || String(rawId).trim() === "") return null;
  return `${group ? "grupo" : "privado"}-${rawId}`;
};

export const readUserDrafts = (userId) => {
  if (userId === undefined || userId === null || typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) =>
      /^(grupo|privado)-[^\s]+$/.test(key) && typeof value === "string" && value.trim()
    ));
  } catch {
    return {};
  }
};

export const readChatDraft = (userId, chatKey) => {
  if (!chatKey) return "";
  return readUserDrafts(userId)[chatKey] || "";
};

// Cambios sin debounce: al cambiar de chat o cerrar la pestaña no se pierde
// el último carácter que el usuario acaba de escribir.
export const saveChatDraft = (userId, chatKey, text) => {
  if (!chatKey || userId === undefined || userId === null || typeof localStorage === "undefined") return false;
  const nextText = String(text || "");
  const drafts = readUserDrafts(userId);
  if ((drafts[chatKey] || "") === nextText) return true;
  if (nextText.trim()) drafts[chatKey] = nextText;
  else delete drafts[chatKey];
  try {
    const key = storageKey(userId);
    if (Object.keys(drafts).length) localStorage.setItem(key, JSON.stringify(drafts));
    else localStorage.removeItem(key);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CHAT_DRAFTS_EVENT, { detail: { userId: String(userId), chatKey } }));
    }
    return true;
  } catch (error) {
    console.warn("No se pudo guardar el borrador en este navegador:", error);
    return false;
  }
};

export const clearUserDrafts = (userId) => {
  if (userId === undefined || userId === null || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(userId));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CHAT_DRAFTS_EVENT, { detail: { userId: String(userId) } }));
    }
  } catch (error) {
    console.warn("No se pudieron limpiar los borradores locales:", error);
  }
};

export const isDraftStorageKey = (userId, key) => key === storageKey(userId);
