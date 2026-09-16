const express = require("express");
const pool = require("../db");
const {
  requireAuth,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/requireAuth");
const { resolveInstance } = require("../middleware/resolveInstance");

const router = express.Router();

const PROJECT_MANAGEMENT_PERMISSIONS = [
  "crear_proyectos",
  "editar_proyectos",
  "eliminar_proyectos",
];

const TIPOS_VALIDOS = new Set([
  "operativo",
  "comercial",
  "soporte",
  "personalizado",
]);

const LIMITES_VALIDOS = new Set([10, 25, 50, 100]);

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizarBusqueda(value) {
  return String(value || "").trim().slice(0, 100);
}

function normalizarNombreProyecto(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizarDominioProyecto(value) {
  let dominio = String(value || "").trim().toLowerCase();

  if (!dominio) {
    return {
      ok: false,
      error: "El dominio del proyecto es obligatorio",
    };
  }

  dominio = dominio
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/\.$/, "");

  if (dominio.startsWith("www.")) {
    dominio = dominio.slice(4);
  }

  if (
    dominio.length > 190 ||
    dominio.includes(":") ||
    dominio.includes("@") ||
    !dominio.includes(".")
  ) {
    return {
      ok: false,
      error: "El dominio del proyecto no es válido",
    };
  }

  const etiquetas = dominio.split(".");

  const etiquetaValida = etiquetas.every((etiqueta) => {
    if (!etiqueta || etiqueta.length > 63) return false;
    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(etiqueta);
  });

  if (!etiquetaValida) {
    return {
      ok: false,
      error: "El dominio del proyecto no es válido",
    };
  }

  return {
    ok: true,
    value: dominio,
  };
}

function normalizarColorProyecto(value) {
  const color = String(value || "#168cff").trim();

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return null;
  }

  return color.toLowerCase();
}

function normalizarIconoProyecto(value) {
  const icono = String(value || "folder").trim().toLowerCase();

  if (!/^[a-z0-9_-]{1,40}$/.test(icono)) {
    return null;
  }

  return icono;
}

async function buscarDominioEnOtraInstancia(dominio, instanciaId, excluirProyectoId = null) {
  const params = [dominio, instanciaId];
  let extra = "";

  if (excluirProyectoId) {
    extra = " AND id <> ?";
    params.push(excluirProyectoId);
  }

  const [rows] = await pool.query(
    `SELECT id, nombre, instancia_id
     FROM proyecto
     WHERE dominio = ?
       AND instancia_id <> ?
       ${extra}
     LIMIT 1`,
    params
  );

  return rows[0] || null;
}

function validarAccesoInstancia(req, res, next) {
  const instanciaUsuario = req.auth?.usuario?.instancia_id;
  const instanciaPortal = req.instanciaActual?.id;

  if (!instanciaPortal) {
    return res.status(500).json({
      code: "INSTANCE_CONTEXT_MISSING",
      error: "No se pudo determinar la instancia actual",
    });
  }

  // Las cuentas con instancia definida no pueden administrar otro portal.
  // Una cuenta especial con instancia_id NULL queda ligada al portal
  // desde el cual está realizando la operación.
  if (
    instanciaUsuario !== null &&
    Number(instanciaUsuario) !== Number(instanciaPortal)
  ) {
    return res.status(403).json({
      code: "INSTANCE_ACCESS_DENIED",
      error: "Tu cuenta no pertenece a esta instancia",
    });
  }

  next();
}

router.use(
  requireAuth,
  resolveInstance,
  requireAnyPermission(PROJECT_MANAGEMENT_PERMISSIONS),
  validarAccesoInstancia
);

// ============================================================
// ESTADÍSTICAS DE GESTIÓN DE PROYECTOS
// GET /api/proyecto/admin/stats
// ============================================================
router.get("/stats", async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);

    const [projectRows] = await pool.query(
      `SELECT
         COUNT(*) AS total_proyectos,
         COALESCE(SUM(estado = 'activo'), 0) AS proyectos_activos,
         COALESCE(SUM(estado = 'inactivo'), 0) AS proyectos_inactivos
       FROM proyecto
       WHERE instancia_id = ?`,
      [instanciaId]
    );

    const [userRows] = await pool.query(
      `SELECT COUNT(DISTINCT up.usuario_id) AS total_usuarios
       FROM usuario_proyecto up
       INNER JOIN proyecto p ON p.id = up.proyecto_id
       WHERE p.instancia_id = ?`,
      [instanciaId]
    );

    const stats = projectRows[0] || {};
    const users = userRows[0] || {};

    return res.json({
      instancia: {
        id: instanciaId,
        codigo: req.instanciaActual.codigo,
        nombre: req.instanciaActual.nombre,
        dominio_base: req.instanciaActual.dominio_base,
      },
      total_proyectos: Number(stats.total_proyectos || 0),
      total_usuarios: Number(users.total_usuarios || 0),
      proyectos_activos: Number(stats.proyectos_activos || 0),
      proyectos_inactivos: Number(stats.proyectos_inactivos || 0),
    });
  } catch (error) {
    console.error("Error cargando estadísticas de proyectos:", error);
    return res.status(500).json({
      code: "PROJECT_STATS_ERROR",
      error: "No se pudieron cargar las estadísticas de proyectos",
    });
  }
});

// ============================================================
// LISTADO PAGINADO
// GET /api/proyecto/admin
//
// Query:
// ?page=1
// &limit=10
// &search=vistatrade
// &estado=activo|inactivo
// &tipo=operativo|comercial|soporte|personalizado
// ============================================================
router.get("/", async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);

    const requestedPage = parsePositiveInt(req.query.page, 1);
    const requestedLimit = parsePositiveInt(req.query.limit, 10);
    const limit = LIMITES_VALIDOS.has(requestedLimit)
      ? requestedLimit
      : 10;

    const search = normalizarBusqueda(req.query.search);
    const estadoRaw = String(req.query.estado || "")
      .trim()
      .toLowerCase();
    const tipoRaw = String(req.query.tipo || "")
      .trim()
      .toLowerCase();

    if (
      estadoRaw &&
      estadoRaw !== "todos" &&
      !["activo", "inactivo"].includes(estadoRaw)
    ) {
      return res.status(400).json({
        code: "INVALID_PROJECT_STATUS",
        error: "El estado indicado no es válido",
      });
    }

    if (
      tipoRaw &&
      tipoRaw !== "todos" &&
      !TIPOS_VALIDOS.has(tipoRaw)
    ) {
      return res.status(400).json({
        code: "INVALID_PROJECT_TYPE",
        error: "El tipo de proyecto indicado no es válido",
      });
    }

    const where = ["p.instancia_id = ?"];
    const params = [instanciaId];

    if (search) {
      where.push(`(
        p.nombre LIKE ?
        OR COALESCE(p.dominio, '') LIKE ?
        OR COALESCE(p.descripcion, '') LIKE ?
      )`);

      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (estadoRaw && estadoRaw !== "todos") {
      where.push("p.estado = ?");
      params.push(estadoRaw);
    }

    if (tipoRaw && tipoRaw !== "todos") {
      where.push("p.tipo = ?");
      params.push(tipoRaw);
    }

    const whereSql = where.join(" AND ");

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM proyecto p
       WHERE ${whereSql}`,
      params
    );

    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.nombre,
         p.dominio,
         p.instancia_id,
         i.codigo AS instancia_codigo,
         i.nombre AS instancia_nombre,
         p.descripcion,
         p.tipo,
         p.color,
         p.icono,
         p.estado,
         p.created_at,
         p.updated_at,
         (
           SELECT COUNT(*)
           FROM usuario_proyecto up
           WHERE up.proyecto_id = p.id
         ) AS usuarios
       FROM proyecto p
       INNER JOIN instancia i ON i.id = p.instancia_id
       WHERE ${whereSql}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${limit}
       OFFSET ${offset}`,
      params
    );

    return res.json({
      instancia: {
        id: instanciaId,
        codigo: req.instanciaActual.codigo,
        nombre: req.instanciaActual.nombre,
        dominio_base: req.instanciaActual.dominio_base,
      },
      proyectos: rows.map((row) => ({
        ...row,
        id: Number(row.id),
        instancia_id: Number(row.instancia_id),
        usuarios: Number(row.usuarios || 0),
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        from: total === 0 ? 0 : offset + 1,
        to: Math.min(offset + rows.length, total),
      },
      filters: {
        search,
        estado: estadoRaw || "todos",
        tipo: tipoRaw || "todos",
      },
    });
  } catch (error) {
    console.error("Error cargando proyectos administrativos:", error);
    return res.status(500).json({
      code: "PROJECT_LIST_ERROR",
      error: "No se pudo cargar la lista de proyectos",
    });
  }
});

// ============================================================
// DETALLE DE UN PROYECTO
// GET /api/proyecto/admin/:id
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const proyectoId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({
        code: "INVALID_PROJECT_ID",
        error: "El identificador del proyecto no es válido",
      });
    }

    const instanciaId = Number(req.instanciaActual.id);

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.nombre,
         p.dominio,
         p.instancia_id,
         i.codigo AS instancia_codigo,
         i.nombre AS instancia_nombre,
         i.dominio_base AS instancia_dominio_base,
         p.descripcion,
         p.tipo,
         p.color,
         p.icono,
         p.estado,
         p.created_at,
         p.updated_at,
         (
           SELECT COUNT(*)
           FROM usuario_proyecto up
           WHERE up.proyecto_id = p.id
         ) AS usuarios
       FROM proyecto p
       INNER JOIN instancia i ON i.id = p.instancia_id
       WHERE p.id = ?
         AND p.instancia_id = ?
       LIMIT 1`,
      [proyectoId, instanciaId]
    );

    if (!rows.length) {
      return res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        error: "Proyecto no encontrado en esta instancia",
      });
    }

    const proyecto = rows[0];

    return res.json({
      proyecto: {
        ...proyecto,
        id: Number(proyecto.id),
        instancia_id: Number(proyecto.instancia_id),
        usuarios: Number(proyecto.usuarios || 0),
      },
    });
  } catch (error) {
    console.error("Error cargando detalle del proyecto:", error);
    return res.status(500).json({
      code: "PROJECT_DETAIL_ERROR",
      error: "No se pudo cargar el proyecto",
    });
  }
});


// ============================================================
// CREAR PROYECTO
// POST /api/proyecto/admin
// ============================================================
router.post("/", requirePermission("crear_proyectos"), async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);

    const nombre = normalizarNombreProyecto(req.body?.nombre);
    const descripcion = String(req.body?.descripcion || "").trim() || null;
    const tipo = String(req.body?.tipo || "operativo").trim().toLowerCase();
    const estado = String(req.body?.estado || "activo").trim().toLowerCase();
    const color = normalizarColorProyecto(req.body?.color);
    const icono = normalizarIconoProyecto(req.body?.icono);

    if (!nombre || nombre.length > 100) {
      return res.status(400).json({
        code: "INVALID_PROJECT_NAME",
        error: "El nombre del proyecto es obligatorio y debe tener máximo 100 caracteres",
      });
    }

    if (!TIPOS_VALIDOS.has(tipo)) {
      return res.status(400).json({
        code: "INVALID_PROJECT_TYPE",
        error: "El tipo de proyecto indicado no es válido",
      });
    }

    if (!["activo", "inactivo"].includes(estado)) {
      return res.status(400).json({
        code: "INVALID_PROJECT_STATUS",
        error: "El estado indicado no es válido",
      });
    }

    if (!color) {
      return res.status(400).json({
        code: "INVALID_PROJECT_COLOR",
        error: "El color debe tener formato hexadecimal, por ejemplo #168cff",
      });
    }

    if (!icono) {
      return res.status(400).json({
        code: "INVALID_PROJECT_ICON",
        error: "El icono indicado no es válido",
      });
    }

    const dominioResult = normalizarDominioProyecto(req.body?.dominio);

    if (!dominioResult.ok) {
      return res.status(400).json({
        code: "INVALID_PROJECT_DOMAIN",
        error: dominioResult.error,
      });
    }

    const dominio = dominioResult.value;

    // Permitimos compartir dominio entre proyectos de la MISMA instancia,
    // porque existen escenarios SALE / RETEN que pueden usar el mismo dominio.
    // No permitimos reutilizarlo accidentalmente entre portales distintos.
    const conflictoOtraInstancia = await buscarDominioEnOtraInstancia(
      dominio,
      instanciaId
    );

    if (conflictoOtraInstancia) {
      return res.status(409).json({
        code: "PROJECT_DOMAIN_OTHER_INSTANCE",
        error: "Ese dominio ya está siendo utilizado por un proyecto de otra instancia",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO proyecto (
         nombre,
         dominio,
         instancia_id,
         descripcion,
         tipo,
         color,
         icono,
         estado
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nombre,
        dominio,
        instanciaId,
        descripcion,
        tipo,
        color,
        icono,
        estado,
      ]
    );

    return res.status(201).json({
      mensaje: "Proyecto creado correctamente",
      proyecto: {
        id: Number(result.insertId),
        nombre,
        dominio,
        instancia_id: instanciaId,
        instancia_codigo: req.instanciaActual.codigo,
        instancia_nombre: req.instanciaActual.nombre,
        descripcion,
        tipo,
        color,
        icono,
        estado,
        usuarios: 0,
      },
    });
  } catch (error) {
    console.error("Error creando proyecto:", error);

    return res.status(500).json({
      code: "PROJECT_CREATE_ERROR",
      error: "No se pudo crear el proyecto",
    });
  }
});

// ============================================================
// EDITAR PROYECTO
//
// IMPORTANTE:
// El dominio NO se cambia desde esta ruta.
// Tendrá un flujo separado con análisis de impacto.
// ============================================================
router.put("/:id", requirePermission("editar_proyectos"), async (req, res) => {
  try {
    const proyectoId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({
        code: "INVALID_PROJECT_ID",
        error: "El identificador del proyecto no es válido",
      });
    }

    const instanciaId = Number(req.instanciaActual.id);

    const [actualRows] = await pool.query(
      `SELECT *
       FROM proyecto
       WHERE id = ?
         AND instancia_id = ?
       LIMIT 1`,
      [proyectoId, instanciaId]
    );

    if (!actualRows.length) {
      return res.status(404).json({
        code: "PROJECT_NOT_FOUND",
        error: "Proyecto no encontrado en esta instancia",
      });
    }

    const actual = actualRows[0];

    if (
      req.body?.instancia_id !== undefined &&
      Number(req.body.instancia_id) !== instanciaId
    ) {
      return res.status(400).json({
        code: "PROJECT_INSTANCE_IMMUTABLE",
        error: "No se puede mover un proyecto a otra instancia desde esta operación",
      });
    }

    if (req.body?.dominio !== undefined) {
      const dominioResult = normalizarDominioProyecto(req.body.dominio);

      if (!dominioResult.ok) {
        return res.status(400).json({
          code: "INVALID_PROJECT_DOMAIN",
          error: dominioResult.error,
        });
      }

      const dominioActual = String(actual.dominio || "").trim().toLowerCase();

      if (dominioResult.value !== dominioActual) {
        return res.status(400).json({
          code: "PROJECT_DOMAIN_CHANGE_REQUIRES_PREVIEW",
          error: "El dominio debe cambiarse desde el flujo de cambio de dominio con vista previa de impacto",
        });
      }
    }

    const nombre =
      req.body?.nombre !== undefined
        ? normalizarNombreProyecto(req.body.nombre)
        : actual.nombre;

    const descripcion =
      req.body?.descripcion !== undefined
        ? String(req.body.descripcion || "").trim() || null
        : actual.descripcion;

    const tipo =
      req.body?.tipo !== undefined
        ? String(req.body.tipo || "").trim().toLowerCase()
        : actual.tipo;

    const color =
      req.body?.color !== undefined
        ? normalizarColorProyecto(req.body.color)
        : actual.color;

    const icono =
      req.body?.icono !== undefined
        ? normalizarIconoProyecto(req.body.icono)
        : actual.icono;

    if (!nombre || nombre.length > 100) {
      return res.status(400).json({
        code: "INVALID_PROJECT_NAME",
        error: "El nombre del proyecto es obligatorio y debe tener máximo 100 caracteres",
      });
    }

    if (!TIPOS_VALIDOS.has(tipo)) {
      return res.status(400).json({
        code: "INVALID_PROJECT_TYPE",
        error: "El tipo de proyecto indicado no es válido",
      });
    }

    if (!color) {
      return res.status(400).json({
        code: "INVALID_PROJECT_COLOR",
        error: "El color debe tener formato hexadecimal, por ejemplo #168cff",
      });
    }

    if (!icono) {
      return res.status(400).json({
        code: "INVALID_PROJECT_ICON",
        error: "El icono indicado no es válido",
      });
    }

    await pool.query(
      `UPDATE proyecto
       SET nombre = ?,
           descripcion = ?,
           tipo = ?,
           color = ?,
           icono = ?
       WHERE id = ?
         AND instancia_id = ?`,
      [
        nombre,
        descripcion,
        tipo,
        color,
        icono,
        proyectoId,
        instanciaId,
      ]
    );

    const [rows] = await pool.query(
      `SELECT
         p.id,
         p.nombre,
         p.dominio,
         p.instancia_id,
         p.descripcion,
         p.tipo,
         p.color,
         p.icono,
         p.estado,
         p.created_at,
         p.updated_at,
         (
           SELECT COUNT(*)
           FROM usuario_proyecto up
           WHERE up.proyecto_id = p.id
         ) AS usuarios
       FROM proyecto p
       WHERE p.id = ?
         AND p.instancia_id = ?
       LIMIT 1`,
      [proyectoId, instanciaId]
    );

    const proyecto = rows[0];

    return res.json({
      mensaje: "Proyecto actualizado correctamente",
      proyecto: {
        ...proyecto,
        id: Number(proyecto.id),
        instancia_id: Number(proyecto.instancia_id),
        usuarios: Number(proyecto.usuarios || 0),
      },
    });
  } catch (error) {
    console.error("Error actualizando proyecto:", error);

    return res.status(500).json({
      code: "PROJECT_UPDATE_ERROR",
      error: "No se pudo actualizar el proyecto",
    });
  }
});

// ============================================================
// ACTIVAR / DESACTIVAR PROYECTO
// PATCH /api/proyecto/admin/:id/estado
// ============================================================
router.patch(
  "/:id/estado",
  requirePermission("eliminar_proyectos"),
  async (req, res) => {
    try {
      const proyectoId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
        return res.status(400).json({
          code: "INVALID_PROJECT_ID",
          error: "El identificador del proyecto no es válido",
        });
      }

      const estado = String(req.body?.estado || "").trim().toLowerCase();

      if (!["activo", "inactivo"].includes(estado)) {
        return res.status(400).json({
          code: "INVALID_PROJECT_STATUS",
          error: "El estado debe ser activo o inactivo",
        });
      }

      const instanciaId = Number(req.instanciaActual.id);

      const [rows] = await pool.query(
        `SELECT
           p.id,
           p.nombre,
           p.estado,
           (
             SELECT COUNT(*)
             FROM usuario_proyecto up
             WHERE up.proyecto_id = p.id
           ) AS usuarios,
           (
             SELECT COUNT(*)
             FROM usuario u
             WHERE u.proyecto_principal_id = p.id
           ) AS usuarios_principales
         FROM proyecto p
         WHERE p.id = ?
           AND p.instancia_id = ?
         LIMIT 1`,
        [proyectoId, instanciaId]
      );

      if (!rows.length) {
        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const actual = rows[0];

      if (actual.estado === estado) {
        return res.json({
          mensaje:
            estado === "activo"
              ? "El proyecto ya se encuentra activo"
              : "El proyecto ya se encuentra inactivo",
          proyecto: {
            id: Number(actual.id),
            nombre: actual.nombre,
            estado,
            usuarios: Number(actual.usuarios || 0),
            usuarios_principales: Number(actual.usuarios_principales || 0),
          },
        });
      }

      await pool.query(
        `UPDATE proyecto
         SET estado = ?
         WHERE id = ?
           AND instancia_id = ?`,
        [estado, proyectoId, instanciaId]
      );

      return res.json({
        mensaje:
          estado === "activo"
            ? "Proyecto activado correctamente"
            : "Proyecto desactivado correctamente",
        proyecto: {
          id: Number(actual.id),
          nombre: actual.nombre,
          estado,
          usuarios: Number(actual.usuarios || 0),
          usuarios_principales: Number(actual.usuarios_principales || 0),
        },
      });
    } catch (error) {
      console.error("Error cambiando estado del proyecto:", error);

      return res.status(500).json({
        code: "PROJECT_STATUS_ERROR",
        error: "No se pudo cambiar el estado del proyecto",
      });
    }
  }
);

module.exports = router;
