// Reúne focus, visibility, online y connect. El estado final también se
// consulta si las señales llegaron en mitad de una sincronización anterior.
const REFRESH_WINDOW_MS = 200;

export function createChatListRefreshScheduler({ getInFlight, refresh }) {
  let timer = null;
  let pending = false;
  let disposed = false;

  function schedule() {
    if (disposed || pending) return;
    pending = true;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await getInFlight();
      } finally {
        pending = false;
        if (!disposed) void refresh();
      }
    }, REFRESH_WINDOW_MS);
  }

  function dispose() {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
  }

  return { schedule, dispose };
}
