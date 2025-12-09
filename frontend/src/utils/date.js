// src/utils/date.js

// Helper: acepta string | Date | number y devuelve Date (interpretando MySQL DATETIME como UTC)
export function parseToDate(input) {
  if (!input && input !== 0) return null;

  // Si ya es Date
  if (input instanceof Date) return input;

  // Si es número (timestamp)
  if (typeof input === "number") return new Date(input);

  // Si es string
  if (typeof input === "string") {
    const s = input.trim();

    // Caso típico MySQL DATETIME: "2025-10-04 07:16:17" (sin 'T' ni 'Z')
    // Lo interpretamos como UTC -> "2025-10-04T07:16:17Z"
    const mysqlDatetimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    if (mysqlDatetimeRegex.test(s)) {
      return new Date(s.replace(" ", "T") + "Z");
    }

    // Si contiene 'T' o termina en 'Z' (ISO), dejar que Date lo interprete
    // También cubre formatos como "2025-10-04T12:16:17.000Z"
    if (s.includes("T") || s.endsWith("Z")) {
      return new Date(s);
    }

    // Fallback: intentar convertir directamente (por ejemplo "2025-10-04")
    return new Date(s);
  }

  // Último recurso: stringify y parsear
  return new Date(String(input));
}

// Convierte cualquier fecha a hora local y formato "Hoy / Ayer / DD/MM/YYYY"
export function formatChatTime(fechaEnvio) {
  if (!fechaEnvio) return "";

  const fecha = parseToDate(fechaEnvio);
  if (!fecha || isNaN(fecha.getTime())) return "";

  const ahora = new Date();

  //console.log("🕒 [formatChatTime]");
  //console.log("   📩 fechaEnvio (raw):", fechaEnvio);
  //console.log("   🗓️ fecha interpretada:", fecha.toString());
  //console.log("   🌎 zona horaria navegador:", Intl.DateTimeFormat().resolvedOptions().timeZone);
  //console.log("   ⏰ hora local navegador ahora:", ahora.toString());

  const esHoy =
    fecha.getFullYear() === ahora.getFullYear() &&
    fecha.getMonth() === ahora.getMonth() &&
    fecha.getDate() === ahora.getDate();

  const ayer = new Date();
  ayer.setDate(ahora.getDate() - 1);

  const esAyer =
    fecha.getFullYear() === ayer.getFullYear() &&
    fecha.getMonth() === ayer.getMonth() &&
    fecha.getDate() === ayer.getDate();

  if (esHoy) {
    return fecha.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  } else if (esAyer) {
    return "Ayer " + fecha.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  } else {
    return fecha.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
  }
}

// Para mostrar la fecha en cabecera sticky (Hoy, Ayer, DD/MM/YYYY)
export function formatChatDate(fechaEnvio) {
  if (!fechaEnvio) return "";

  const fechaLocal = parseToDate(fechaEnvio);
  if (!fechaLocal || isNaN(fechaLocal.getTime())) return "";

  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);

  //console.log("🕒 [formatChatDate]");
  //console.log("   📩 fechaEnvio (raw):", fechaEnvio);
  //console.log("   🗓️ fecha interpretada:", fechaLocal.toString());

  const esMismoDia = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (esMismoDia(fechaLocal, hoy)) return "Hoy";
  if (esMismoDia(fechaLocal, ayer)) return "Ayer";

  return fechaLocal.toLocaleDateString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Convierte fecha a hora local (solo HH:mm a.m./p.m.)
export function formatChatTimeOnly(fechaEnvio) {
  if (!fechaEnvio) return "";

  const fecha = parseToDate(fechaEnvio);
  if (!fecha || isNaN(fecha.getTime())) return "";

  //console.log("🕒 [formatChatTimeOnly]");
  //console.log("   📩 fechaEnvio (raw):", fechaEnvio);
  //console.log("   🗓️ fecha interpretada:", fecha.toString());

  const hours = fecha.getHours();
  const minutes = fecha.getMinutes();
  const ampm = hours >= 12 ? "p. m." : "a. m.";
  const hora12 = hours % 12 || 12;

  return `${hora12}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

// Devuelve objeto Date local desde UTC (o string MySQL -> Date)
export function toLocalDate(fechaEnvio) {
  if (!fechaEnvio) return null;

  const fecha = parseToDate(fechaEnvio);
  //console.log("🕒 [toLocalDate]");
  //console.log("   📩 fechaEnvio (raw):", fechaEnvio);
  //console.log("   🗓️ fecha interpretada:", fecha ? fecha.toString() : fecha);

  return fecha;
}