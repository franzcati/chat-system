const UNSUPPORTED_SUMMARY = new Set([404, 405, 501]);

export async function getChatSummaryDataset(get, summaryUrl, legacyUrl) {
  try {
    const response = await get(summaryUrl);
    return { available: true, fallback: false, data: Array.isArray(response.data) ? response.data : [] };
  } catch (error) {
    // Usar el historial completo solo por compatibilidad con un servidor
    // sin la ruta de resumen, nunca como reacción a una caída o saturación.
    if (!UNSUPPORTED_SUMMARY.has(error.response?.status)) {
      return { available: false, fallback: false, data: [] };
    }
  }

  try {
    const response = await get(legacyUrl);
    return { available: true, fallback: true, data: Array.isArray(response.data) ? response.data : [] };
  } catch {
    return { available: false, fallback: true, data: [] };
  }
}
