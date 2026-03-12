import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);

const STORAGE_KEY = "chat_theme";

export function ThemeProvider({ children }) {
  const getInitialTheme = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;

    // fallback: tema del sistema
    const prefersDark =
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;

    return prefersDark ? "dark" : "light";
  };

  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    // 👇 esto es lo que “pinta” el tema global
    document.documentElement.setAttribute("data-theme", theme);

    // (Opcional) Si usas Bootstrap 5.3+ esto ayuda mucho:
    document.documentElement.setAttribute("data-bs-theme", theme);

    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      isDark: theme === "dark",
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider />");
  return ctx;
}