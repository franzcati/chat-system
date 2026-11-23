const { escapeTelegram } = require('./securityCenter');

async function securityProjectLines(conn, instanceId, userId) {
  const [main] = await conn.query(`SELECT p.nombre
    FROM usuario u LEFT JOIN proyecto p
      ON p.id=u.proyecto_principal_id AND p.instancia_id=u.instancia_id
    WHERE u.id=? AND u.instancia_id=? LIMIT 1`, [userId, instanceId]);
  const [secondary] = await conn.query(`SELECT DISTINCT p.nombre
    FROM usuario u JOIN usuario_proyecto up ON up.usuario_id=u.id
    JOIN proyecto p ON p.id=up.proyecto_id AND p.instancia_id=u.instancia_id
    WHERE u.id=? AND u.instancia_id=?
      AND (u.proyecto_principal_id IS NULL OR p.id<>u.proyecto_principal_id)
    ORDER BY p.nombre LIMIT 30`, [userId, instanceId]);
  return `Proyecto principal: ${escapeTelegram(main[0]?.nombre || 'No asignado')}\n` +
    `Proyectos secundarios: ${escapeTelegram(secondary.map(p => p.nombre).join(', ') || 'Ninguno')}`;
}

module.exports = { securityProjectLines };
