const CHAT_LIST_CACHE_TTL_MS = 30 * 60 * 1000;
const CHAT_LIST_CACHE_VERSION = 3;
const CHAT_LIST_STORAGE_PREFIX = "quickchat:chat-list:snapshot:v3:";
const memoryCache = new Map();

const normalizeUserId = (userId) => {
  if (userId === undefined || userId === null) return "";
  return String(userId).trim();
};

const getStorageKey = (userId) =>
  `${CHAT_LIST_STORAGE_PREFIX}${normalizeUserId(userId)}`;

const isFreshSnapshot = (payload, userId) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!payload || !normalizedUserId) return false;
  if (Number(payload.version) !== CHAT_LIST_CACHE_VERSION) return false;
  if (normalizeUserId(payload.userId) !== normalizedUserId) return false;

  const updatedAt = Number(payload.updatedAt || 0);
  if (!updatedAt || Date.now() - updatedAt >= CHAT_LIST_CACHE_TTL_MS) return false;

  return true;
};

export const readChatListSnapshot = (userId) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;

  const memory = memoryCache.get(normalizedUserId);
  if (isFreshSnapshot(memory, normalizedUserId)) return memory;
  memoryCache.delete(normalizedUserId);

  if (typeof window === "undefined") return null;

  try {
    const key = getStorageKey(normalizedUserId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!isFreshSnapshot(parsed, normalizedUserId)) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    memoryCache.set(normalizedUserId, parsed);
    return parsed;
  } catch (error) {
    console.warn("⚠️ No se pudo leer el snapshot de conversaciones:", error);
    return null;
  }
};

export const persistChatListSnapshot = (userId, snapshot) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || !snapshot) return;

  const payload = {
    ...snapshot,
    version: CHAT_LIST_CACHE_VERSION,
    userId: normalizedUserId,
    updatedAt: Date.now(),
  };

  memoryCache.set(normalizedUserId, payload);

  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(getStorageKey(normalizedUserId), JSON.stringify(payload));
  } catch (error) {
    console.warn("⚠️ No se pudo guardar el snapshot de conversaciones:", error);
  }
};

export const clearChatListSnapshot = (userId) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;

  memoryCache.delete(normalizedUserId);

  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getStorageKey(normalizedUserId));
  } catch (error) {
    console.warn("⚠️ No se pudo limpiar el snapshot de conversaciones:", error);
  }
};

export const clearAllChatListSnapshots = () => {
  memoryCache.clear();
  if (typeof window === "undefined") return;

  try {
    const keysToRemove = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(CHAT_LIST_STORAGE_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (error) {
    console.warn("⚠️ No se pudieron limpiar los snapshots de conversaciones:", error);
  }
};
