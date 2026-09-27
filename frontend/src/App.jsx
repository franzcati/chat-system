import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from "react-hot-toast";

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import './App.css';

import PrivateRoute from './components/PrivateRoute';

const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const Messenger = lazy(() => import('./pages/Messenger'));

const RUNTIME_VERSION_KEY = "qc_runtime_version";
const VERSION_CHECK_INTERVAL_MS = 30000;

function AppUpdateGuard() {
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let requestInFlight = false;

    const scheduleNext = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(checkVersion, VERSION_CHECK_INTERVAL_MS);
    };

    const reloadWithFreshDocument = (version) => {
      try {
        sessionStorage.setItem(RUNTIME_VERSION_KEY, version);
      } catch {}

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("qc_update", String(Date.now()));
      window.location.replace(nextUrl.toString());
    };

    const checkVersion = async () => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;

      try {
        const response = await fetch(`/api/system/version?_=${Date.now()}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });

        if (!response.ok) return;
        const data = await response.json();
        const version = String(data?.version || "").trim();
        if (!version) return;

        let previous = null;
        try {
          previous = sessionStorage.getItem(RUNTIME_VERSION_KEY);
        } catch {}

        if (!previous) {
          try {
            sessionStorage.setItem(RUNTIME_VERSION_KEY, version);
          } catch {}
          return;
        }

        if (previous !== version) {
          // No cerramos la sesión ni borramos localStorage. Sólo recargamos el
          // documento para tomar el frontend nuevo y reconectar API/Socket.IO.
          reloadWithFreshDocument(version);
        }
      } catch {
        // Durante el reinicio del backend es normal que una comprobación falle.
        // La siguiente ejecución volverá a intentarlo sin sacar al usuario.
      } finally {
        requestInFlight = false;
        scheduleNext();
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkVersion();
    };
    const checkNow = () => checkVersion();

    checkVersion();
    window.addEventListener("focus", checkNow);
    window.addEventListener("online", checkNow);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkNow);
      window.removeEventListener("online", checkNow);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  return null;
}

function RouteLoader() {
  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100">
      <div className="spinner-border" role="status" aria-label="Cargando">
        <span className="visually-hidden">Cargando...</span>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <AppUpdateGuard />
      <Router>
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/mensajes"
            element={
              <PrivateRoute>
                <Messenger />
              </PrivateRoute>
            }
          />
        </Routes>
      </Suspense>

      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      </Router>
    </>
  );
}

export default App;
