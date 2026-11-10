// Notifica únicamente después del COMMIT. La DB sigue siendo la fuente de verdad.
// El aviso permite que las sesiones abiertas actualicen permisos sin volver a iniciar sesión.
async function notifyUpdatedUserPermissions(req, pool, userIds, instanciaId) {
  const enviarEventoAlUsuario = req.app.get("socketUtils")?.enviarEventoAlUsuario;
  if (typeof enviarEventoAlUsuario !== "function") return;
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.rol_id, u.permisos_chat, rp.permiso
         FROM usuario u
         LEFT JOIN roles_permisos rp ON rp.rol_id = u.rol_id
        WHERE u.id IN (?) AND u.instancia_id = ?`,
      [ids, instanciaId]
    );
    const byUser = new Map();
    for (const row of rows) {
      const id = Number(row.id);
      if (!byUser.has(id)) {
        let chatPermissions = row.permisos_chat || {};
        if (typeof chatPermissions === "string") {
          try { chatPermissions = JSON.parse(chatPermissions); } catch { chatPermissions = {}; }
        }
        byUser.set(id, {
          usuarioId: id,
          rol_id: Number(row.rol_id),
          rol_permisos: [],
          permisos_chat: chatPermissions && typeof chatPermissions === "object" && !Array.isArray(chatPermissions)
            ? chatPermissions : {},
        });
      }
      if (row.permiso) byUser.get(id).rol_permisos.push(String(row.permiso));
    }
    for (const [id, payload] of byUser) {
      enviarEventoAlUsuario(id, "permisosChatActualizados", payload);
      enviarEventoAlUsuario(id, "rolUsuarioActualizado", payload);
    }
  } catch (error) {
    // No devolver 500 tras un COMMIT exitoso: el cambio ya está guardado.
    console.error("No se pudo notificar cambio de permisos:", error);
  }
}

module.exports = { notifyUpdatedUserPermissions };
