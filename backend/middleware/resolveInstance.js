const pool = require("../db");
const {
  resolvePortalFromRequest,
} = require("../utils/portalInstance");

async function resolveInstance(req, res, next) {
  try {
    const portal = resolvePortalFromRequest(req);

    const [rows] = await pool.query(
      `SELECT
          id,
          codigo,
          nombre,
          dominio_base,
          estado
       FROM instancia
       WHERE codigo = ?
         AND estado = 'activo'
       LIMIT 1`,
      [portal.code]
    );

    if (!rows.length) {
      const error = new Error(
        "La instancia correspondiente al portal no está configurada"
      );
      error.status = 503;
      error.code = "INSTANCE_NOT_CONFIGURED";
      throw error;
    }

    const instancia = rows[0];

    req.instanciaActual = {
      id: Number(instancia.id),
      codigo: instancia.codigo,
      nombre: instancia.nombre,
      dominio_base: instancia.dominio_base,
      host: portal.host,
      detectadaPor: portal.source,
    };

    next();
  } catch (error) {
    const status = Number(error?.status || 500);

    if (status >= 500) {
      console.error(
        "Error resolviendo instancia actual:",
        error
      );
    }

    return res.status(status).json({
      code: error?.code || "INSTANCE_RESOLUTION_ERROR",
      error:
        status >= 500
          ? "No se pudo determinar la instancia actual"
          : error.message,
    });
  }
}

module.exports = {
  resolveInstance,
};
