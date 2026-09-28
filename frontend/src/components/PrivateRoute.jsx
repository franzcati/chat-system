import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import axios from "axios";

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem("usuario");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export default function PrivateRoute({ children }) {
  const [hasLocalSession, setHasLocalSession] = useState(() => Boolean(readStoredUser()?.id));

  useEffect(() => {
    if (!hasLocalSession) return undefined;

    let cancelled = false;

    // localStorage permite entrar de inmediato, pero la cookie HTTP-only es la
    // autoridad real. Se valida en segundo plano para no dejar una pestaña
    // eternamente abierta con una sesión de servidor ya vencida.
    axios
      .get("/api/usuario/session", {
        withCredentials: true,
        timeout: 10000,
        headers: { "Cache-Control": "no-cache" },
      })
      .then((response) => {
        if (cancelled || !response.data?.authenticated || !response.data?.usuario?.id) return;

        try {
          const previous = readStoredUser() || {};
          const nextUser = { ...previous, ...response.data.usuario };
          localStorage.setItem("usuario", JSON.stringify(nextUser));
          window.dispatchEvent(new CustomEvent("quickchat:session-user-updated", { detail: nextUser }));
        } catch {}
      })
      .catch((error) => {
        if (cancelled) return;

        const status = Number(error?.response?.status || 0);
        const code = String(error?.response?.data?.code || "");
        const invalidSession =
          status === 401 ||
          code === "AUTH_REQUIRED" ||
          code === "SESSION_MISSING" ||
          code === "SESSION_INVALID" ||
          code === "AUTH_USER_NOT_FOUND" ||
          code === "AUTH_ACCOUNT_INACTIVE" ||
          code === "INSTANCE_ACCESS_DENIED";

        // Una caída temporal del backend durante un despliegue NO expulsa al
        // usuario. Sólo limpiamos la sesión si el servidor confirma que ya no
        // es válida. Así una actualización/reinicio conserva la autenticación.
        if (invalidSession) {
          try {
            localStorage.removeItem("usuario");
          } catch {}
          setHasLocalSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasLocalSession]);

  return hasLocalSession ? children : <Navigate to="/" replace />;
}
