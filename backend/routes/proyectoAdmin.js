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
// CANDIDATOS PARA MIEMBROS INICIALES
// GET /api/proyecto/admin/member-candidates
//
// Se usa al crear un proyecto, cuando todavía no existe ID.
// Solo devuelve usuarios aprobados de la instancia actual.
// ============================================================
router.get(
  "/member-candidates",
  requirePermission("crear_proyectos"),
  async (req, res) => {
    try {
      const instanciaId = Number(req.instanciaActual.id);

      const search = String(req.query?.search || "").trim();

      const requestedPage = Math.max(
        1,
        Number.parseInt(req.query?.page, 10) || 1
      );

      const limit = Math.min(
        200,
        Math.max(
          1,
          Number.parseInt(req.query?.limit, 10) || 50
        )
      );

      const where = [
        "u.instancia_id = ?",
        "u.estado = 'aprobado'",
      ];

      const params = [instanciaId];

      if (search) {
        const like = `%${search}%`;

        where.push(
          `(u.nombre LIKE ?
            OR u.apellido LIKE ?
            OR u.correo LIKE ?)`
        );

        params.push(like, like, like);
      }

      const whereSql = where.join(" AND ");

      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM usuario u
         WHERE ${whereSql}`,
        params
      );

      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(
        1,
        Math.ceil(total / limit)
      );

      const page = Math.min(
        requestedPage,
        totalPages
      );

      const offset = (page - 1) * limit;

      const [rows] = await pool.query(
        `SELECT
           u.id,
           u.nombre,
           u.apellido,
           u.correo,
           u.rol_id,
           u.url_imagen,
           u.background,
           u.proyecto_principal_id,
           u.correo_gestionado_proyecto
         FROM usuario u
         WHERE ${whereSql}
         ORDER BY
           u.nombre ASC,
           u.apellido ASC,
           u.id ASC
         LIMIT ${limit}
         OFFSET ${offset}`,
        params
      );

      return res.json({
        usuarios: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          rol_id:
            row.rol_id === null
              ? null
              : Number(row.rol_id),
          proyecto_principal_id:
            row.proyecto_principal_id === null
              ? null
              : Number(row.proyecto_principal_id),
          correo_gestionado_proyecto:
            Number(
              row.correo_gestionado_proyecto || 0
            ),
        })),
        pagination: {
          page,
          limit,
          total,
          total_pages: totalPages,
          from:
            total === 0
              ? 0
              : offset + 1,
          to: Math.min(
            offset + rows.length,
            total
          ),
        },
      });
    } catch (error) {
      console.error(
        "Error cargando candidatos iniciales:",
        error
      );

      return res.status(500).json({
        code:
          "PROJECT_INITIAL_MEMBER_CANDIDATES_ERROR",
        error:
          "No se pudieron cargar los usuarios disponibles",
      });
    }
  }
);


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
// VISTA PREVIA DE CAMBIO DE DOMINIO
// GET /api/proyecto/admin/:id/domain-impact?dominio=nuevo.com
//
// IMPORTANTE:
// Esta ruta NO modifica ningún dato.
// Solo calcula usuarios afectados, excluidos y conflictos.
// ============================================================
router.get(
  "/:id/domain-impact",
  requirePermission("editar_proyectos"),
  async (req, res) => {
    try {
      const proyectoId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
        return res.status(400).json({
          code: "INVALID_PROJECT_ID",
          error: "El identificador del proyecto no es válido",
        });
      }

      const instanciaId = Number(req.instanciaActual.id);

      const dominioResult = normalizarDominioProyecto(req.query?.dominio);

      if (!dominioResult.ok) {
        return res.status(400).json({
          code: "INVALID_PROJECT_DOMAIN",
          error: dominioResult.error,
        });
      }

      const dominioNuevo = dominioResult.value;

      const [projectRows] = await pool.query(
        `SELECT
           id,
           nombre,
           dominio,
           instancia_id,
           estado
         FROM proyecto
         WHERE id = ?
           AND instancia_id = ?
         LIMIT 1`,
        [proyectoId, instanciaId]
      );

      if (!projectRows.length) {
        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const proyecto = projectRows[0];
      const dominioActual = String(proyecto.dominio || "")
        .trim()
        .toLowerCase();

      const mismoDominio = dominioActual === dominioNuevo;

      const conflictos = [];

      const proyectoOtraInstancia =
        await buscarDominioEnOtraInstancia(
          dominioNuevo,
          instanciaId,
          proyectoId
        );

      if (proyectoOtraInstancia) {
        conflictos.push({
          tipo: "DOMAIN_USED_BY_OTHER_INSTANCE",
          mensaje:
            "El nuevo dominio está siendo utilizado por un proyecto de otra instancia",
          proyecto_id: Number(proyectoOtraInstancia.id),
          proyecto_nombre: proyectoOtraInstancia.nombre,
          instancia_id: Number(proyectoOtraInstancia.instancia_id),
        });
      }

      const [userRows] = await pool.query(
        `SELECT
           id,
           nombre,
           apellido,
           correo,
           usuario_base,
           proyecto_principal_id,
           instancia_id,
           correo_gestionado_proyecto
         FROM usuario
         WHERE proyecto_principal_id = ?
         ORDER BY id`,
        [proyectoId]
      );

      const usuariosExcluidos = [];
      const candidatos = [];

      for (const row of userRows) {
        const gestionado =
          Number(row.correo_gestionado_proyecto || 0) === 1;

        if (!gestionado) {
          usuariosExcluidos.push({
            id: Number(row.id),
            nombre: row.nombre,
            apellido: row.apellido,
            correo_actual: row.correo,
            usuario_base: row.usuario_base,
            motivo: "correo_gestionado_proyecto=0",
          });

          continue;
        }

        const usuarioBase = String(row.usuario_base || "")
          .trim()
          .toLowerCase();

        if (
          !usuarioBase ||
          usuarioBase.length > 100 ||
          !/^[a-z0-9._+-]+$/.test(usuarioBase)
        ) {
          conflictos.push({
            tipo: "INVALID_USUARIO_BASE",
            usuario_id: Number(row.id),
            correo_actual: row.correo,
            usuario_base: row.usuario_base,
            mensaje:
              "El usuario gestionado no tiene un usuario_base válido",
          });

          continue;
        }

        candidatos.push({
          id: Number(row.id),
          nombre: row.nombre,
          apellido: row.apellido,
          correo_actual: row.correo,
          usuario_base: usuarioBase,
          correo_nuevo: `${usuarioBase}@${dominioNuevo}`,
        });
      }

      // ------------------------------------------------------
      // Detectar si dos usuarios afectados producirían
      // exactamente el mismo correo nuevo.
      // ------------------------------------------------------
      const targets = new Map();

      for (const usuario of candidatos) {
        const key = usuario.correo_nuevo.toLowerCase();

        if (!targets.has(key)) {
          targets.set(key, []);
        }

        targets.get(key).push(usuario);
      }

      for (const [correoNuevo, usuarios] of targets.entries()) {
        if (usuarios.length > 1) {
          conflictos.push({
            tipo: "DUPLICATE_GENERATED_EMAIL",
            correo: correoNuevo,
            usuarios: usuarios.map((usuario) => ({
              id: usuario.id,
              correo_actual: usuario.correo_actual,
              usuario_base: usuario.usuario_base,
            })),
            mensaje:
              "Más de un usuario generaría el mismo correo electrónico",
          });
        }
      }

      // ------------------------------------------------------
      // Buscar si los correos nuevos ya pertenecen a otros
      // usuarios existentes en la tabla usuario.
      // ------------------------------------------------------
      const correosObjetivo = [...new Set(
        candidatos.map((usuario) =>
          usuario.correo_nuevo.toLowerCase()
        )
      )];

      if (correosObjetivo.length > 0) {
        const placeholders = correosObjetivo
          .map(() => "?")
          .join(",");

        const [existingRows] = await pool.query(
          `SELECT
             id,
             correo
           FROM usuario
           WHERE LOWER(correo) IN (${placeholders})`,
          correosObjetivo
        );

        for (const existente of existingRows) {
          const correoExistente = String(existente.correo || "")
            .trim()
            .toLowerCase();

          const afectados = candidatos.filter(
            (usuario) =>
              usuario.correo_nuevo.toLowerCase() ===
              correoExistente
          );

          for (const afectado of afectados) {
            // Si el correo ya es del mismo usuario, no es conflicto.
            if (Number(existente.id) === Number(afectado.id)) {
              continue;
            }

            conflictos.push({
              tipo: "EMAIL_ALREADY_EXISTS",
              usuario_id: afectado.id,
              usuario_base: afectado.usuario_base,
              correo_nuevo: afectado.correo_nuevo,
              usuario_conflicto_id: Number(existente.id),
              correo_conflicto: existente.correo,
              mensaje:
                "El correo resultante ya pertenece a otro usuario",
            });
          }
        }
      }

      const puedeConfirmar =
        !mismoDominio &&
        conflictos.length === 0;

      return res.json({
        proyecto: {
          id: Number(proyecto.id),
          nombre: proyecto.nombre,
          instancia_id: Number(proyecto.instancia_id),
          dominio_actual: dominioActual || null,
          dominio_nuevo: dominioNuevo,
          estado: proyecto.estado,
        },

        impacto: {
          usuarios_principales: userRows.length,
          usuarios_gestionados: userRows.filter(
            (usuario) =>
              Number(usuario.correo_gestionado_proyecto || 0) === 1
          ).length,
          usuarios_actualizables: candidatos.length,
          usuarios_excluidos: usuariosExcluidos.length,
          conflictos: conflictos.length,
        },

        usuarios_a_actualizar: candidatos,
        usuarios_excluidos: usuariosExcluidos,
        conflictos,

        mismo_dominio: mismoDominio,
        puede_confirmar: puedeConfirmar,
      });
    } catch (error) {
      console.error(
        "Error calculando impacto de cambio de dominio:",
        error
      );

      return res.status(500).json({
        code: "PROJECT_DOMAIN_IMPACT_ERROR",
        error:
          "No se pudo calcular el impacto del cambio de dominio",
      });
    }
  }
);


// ============================================================
// CONFIRMAR CAMBIO DE DOMINIO
// POST /api/proyecto/admin/:id/change-domain
//
// Body:
// {
//   "dominio": "nuevo-dominio.com",
//   "confirmar": true
// }
//
// Recalcula todo dentro de una transacción antes de modificar.
// ============================================================
router.post(
  "/:id/change-domain",
  requirePermission("editar_proyectos"),
  async (req, res) => {
    const proyectoId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({
        code: "INVALID_PROJECT_ID",
        error: "El identificador del proyecto no es válido",
      });
    }

    if (req.body?.confirmar !== true) {
      return res.status(400).json({
        code: "PROJECT_DOMAIN_CONFIRMATION_REQUIRED",
        error: "Debes confirmar explícitamente el cambio de dominio",
      });
    }

    const dominioResult = normalizarDominioProyecto(req.body?.dominio);

    if (!dominioResult.ok) {
      return res.status(400).json({
        code: "INVALID_PROJECT_DOMAIN",
        error: dominioResult.error,
      });
    }

    const dominioNuevo = dominioResult.value;
    const instanciaId = Number(req.instanciaActual.id);

    const connection = await pool.getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      // Bloquear el proyecto para evitar cambios concurrentes
      // mientras se vuelve a calcular el impacto.
      const [projectRows] = await connection.query(
        `SELECT
           id,
           nombre,
           dominio,
           instancia_id,
           estado
         FROM proyecto
         WHERE id = ?
           AND instancia_id = ?
         LIMIT 1
         FOR UPDATE`,
        [proyectoId, instanciaId]
      );

      if (!projectRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const proyecto = projectRows[0];
      const dominioAnterior = String(proyecto.dominio || "")
        .trim()
        .toLowerCase();

      if (dominioAnterior === dominioNuevo) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "PROJECT_DOMAIN_UNCHANGED",
          error: "El nuevo dominio es igual al dominio actual",
        });
      }

      // No permitir reutilizar accidentalmente el mismo dominio
      // en otra instancia / portal.
      const [otherProjectRows] = await connection.query(
        `SELECT
           id,
           nombre,
           instancia_id
         FROM proyecto
         WHERE dominio = ?
           AND instancia_id <> ?
           AND id <> ?
         LIMIT 1`,
        [dominioNuevo, instanciaId, proyectoId]
      );

      if (otherProjectRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          code: "PROJECT_DOMAIN_OTHER_INSTANCE",
          error: "Ese dominio ya está siendo utilizado por un proyecto de otra instancia",
          conflicto: {
            proyecto_id: Number(otherProjectRows[0].id),
            proyecto_nombre: otherProjectRows[0].nombre,
            instancia_id: Number(otherProjectRows[0].instancia_id),
          },
        });
      }

      // Bloquear los usuarios principales del proyecto durante
      // toda la operación.
      const [userRows] = await connection.query(
        `SELECT
           id,
           nombre,
           apellido,
           correo,
           usuario_base,
           proyecto_principal_id,
           instancia_id,
           correo_gestionado_proyecto
         FROM usuario
         WHERE proyecto_principal_id = ?
         ORDER BY id
         FOR UPDATE`,
        [proyectoId]
      );

      const usuariosExcluidos = [];
      const candidatos = [];
      const conflictos = [];

      for (const row of userRows) {
        const gestionado =
          Number(row.correo_gestionado_proyecto || 0) === 1;

        if (!gestionado) {
          usuariosExcluidos.push({
            id: Number(row.id),
            nombre: row.nombre,
            apellido: row.apellido,
            correo_actual: row.correo,
            usuario_base: row.usuario_base,
            motivo: "correo_gestionado_proyecto=0",
          });

          continue;
        }

        const usuarioBase = String(row.usuario_base || "")
          .trim()
          .toLowerCase();

        if (
          !usuarioBase ||
          usuarioBase.length > 100 ||
          !/^[a-z0-9._+-]+$/.test(usuarioBase)
        ) {
          conflictos.push({
            tipo: "INVALID_USUARIO_BASE",
            usuario_id: Number(row.id),
            correo_actual: row.correo,
            usuario_base: row.usuario_base,
            mensaje: "El usuario gestionado no tiene un usuario_base válido",
          });

          continue;
        }

        candidatos.push({
          id: Number(row.id),
          nombre: row.nombre,
          apellido: row.apellido,
          usuario_base: usuarioBase,
          correo_actual: row.correo,
          correo_nuevo: `${usuarioBase}@${dominioNuevo}`,
        });
      }

      // Detectar duplicados generados dentro del mismo lote.
      const targets = new Map();

      for (const usuario of candidatos) {
        const key = usuario.correo_nuevo.toLowerCase();

        if (!targets.has(key)) {
          targets.set(key, []);
        }

        targets.get(key).push(usuario);
      }

      for (const [correoNuevo, usuarios] of targets.entries()) {
        if (usuarios.length > 1) {
          conflictos.push({
            tipo: "DUPLICATE_GENERATED_EMAIL",
            correo: correoNuevo,
            usuarios: usuarios.map((usuario) => ({
              id: usuario.id,
              usuario_base: usuario.usuario_base,
              correo_actual: usuario.correo_actual,
            })),
            mensaje: "Más de un usuario generaría el mismo correo electrónico",
          });
        }
      }

      // Buscar conflictos con cualquier correo que ya exista.
      const correosObjetivo = [
        ...new Set(
          candidatos.map((usuario) =>
            usuario.correo_nuevo.toLowerCase()
          )
        ),
      ];

      if (correosObjetivo.length > 0) {
        const placeholders = correosObjetivo
          .map(() => "?")
          .join(",");

        const [existingRows] = await connection.query(
          `SELECT id, correo
           FROM usuario
           WHERE LOWER(correo) IN (${placeholders})
           FOR UPDATE`,
          correosObjetivo
        );

        for (const existente of existingRows) {
          const correoExistente = String(existente.correo || "")
            .trim()
            .toLowerCase();

          const afectados = candidatos.filter(
            (usuario) =>
              usuario.correo_nuevo.toLowerCase() ===
              correoExistente
          );

          for (const afectado of afectados) {
            // Su propio correo actual no genera conflicto.
            if (Number(existente.id) === Number(afectado.id)) {
              continue;
            }

            conflictos.push({
              tipo: "EMAIL_ALREADY_EXISTS",
              usuario_id: afectado.id,
              usuario_base: afectado.usuario_base,
              correo_nuevo: afectado.correo_nuevo,
              usuario_conflicto_id: Number(existente.id),
              correo_conflicto: existente.correo,
              mensaje: "El correo resultante ya pertenece a otro usuario",
            });
          }
        }
      }

      // Ante cualquier conflicto no se modifica absolutamente nada.
      if (conflictos.length > 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          code: "PROJECT_DOMAIN_CONFLICTS",
          error: "Existen conflictos que impiden cambiar el dominio",
          impacto: {
            usuarios_principales: userRows.length,
            usuarios_gestionados: candidatos.length + conflictos.filter(
              (item) => item.tipo === "INVALID_USUARIO_BASE"
            ).length,
            usuarios_actualizables: candidatos.length,
            usuarios_excluidos: usuariosExcluidos.length,
            conflictos: conflictos.length,
          },
          conflictos,
        });
      }

      // Actualizar únicamente usuarios gestionados por proyecto.
      for (const usuario of candidatos) {
        await connection.query(
          `UPDATE usuario
           SET correo = ?
           WHERE id = ?
             AND proyecto_principal_id = ?
             AND correo_gestionado_proyecto = 1`,
          [
            usuario.correo_nuevo,
            usuario.id,
            proyectoId,
          ]
        );
      }

      // Actualizar dominio del proyecto.
      await connection.query(
        `UPDATE proyecto
         SET dominio = ?
         WHERE id = ?
           AND instancia_id = ?`,
        [dominioNuevo, proyectoId, instanciaId]
      );

      // Auditoría del cambio.
      await connection.query(
        `INSERT INTO proyecto_dominio_historial (
           proyecto_id,
           dominio_anterior,
           dominio_nuevo,
           usuario_admin_id
         )
         VALUES (?, ?, ?, ?)`,
        [
          proyectoId,
          dominioAnterior || null,
          dominioNuevo,
          req.auth.userId,
        ]
      );

      await connection.commit();
      transactionStarted = false;

      return res.json({
        mensaje: "Dominio del proyecto actualizado correctamente",
        proyecto: {
          id: Number(proyecto.id),
          nombre: proyecto.nombre,
          instancia_id: Number(proyecto.instancia_id),
          dominio_anterior: dominioAnterior || null,
          dominio_nuevo: dominioNuevo,
        },
        impacto: {
          usuarios_principales: userRows.length,
          usuarios_actualizados: candidatos.length,
          usuarios_excluidos: usuariosExcluidos.length,
          conflictos: 0,
        },
        usuarios_actualizados: candidatos.map((usuario) => ({
          id: usuario.id,
          correo_anterior: usuario.correo_actual,
          correo_nuevo: usuario.correo_nuevo,
        })),
        usuarios_excluidos: usuariosExcluidos,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "Error ejecutando rollback de cambio de dominio:",
            rollbackError
          );
        }
      }

      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          code: "PROJECT_DOMAIN_EMAIL_DUPLICATE",
          error: "Se detectó un correo duplicado y no se realizó ningún cambio",
        });
      }

      console.error(
        "Error confirmando cambio de dominio:",
        error
      );

      return res.status(500).json({
        code: "PROJECT_DOMAIN_CHANGE_ERROR",
        error: "No se pudo cambiar el dominio del proyecto",
      });
    } finally {
      connection.release();
    }
  }
);

// ============================================================
// CREAR PROYECTO
// POST /api/proyecto/admin
//
// Puede recibir opcionalmente:
// {
//   ...
//   "usuario_ids": [25, 31]
// }
//
// Los miembros iniciales solo crean relaciones usuario_proyecto.
// NO cambian proyecto_principal_id.
// NO cambian el correo.
// ============================================================
router.post("/", requirePermission("crear_proyectos"), async (req, res) => {
  const instanciaId = Number(req.instanciaActual.id);

  const nombre = normalizarNombreProyecto(req.body?.nombre);
  const descripcion =
    String(req.body?.descripcion || "").trim() || null;
  const tipo =
    String(req.body?.tipo || "operativo").trim().toLowerCase();
  const estado =
    String(req.body?.estado || "activo").trim().toLowerCase();
  const color = normalizarColorProyecto(req.body?.color);
  const icono = normalizarIconoProyecto(req.body?.icono);

  const rawUsuarioIds = Array.isArray(req.body?.usuario_ids)
    ? req.body.usuario_ids
    : [];

  const usuarioIds = [
    ...new Set(
      rawUsuarioIds
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (!nombre || nombre.length > 100) {
    return res.status(400).json({
      code: "INVALID_PROJECT_NAME",
      error:
        "El nombre del proyecto es obligatorio y debe tener máximo 100 caracteres",
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
      error:
        "El color debe tener formato hexadecimal, por ejemplo #168cff",
    });
  }

  if (!icono) {
    return res.status(400).json({
      code: "INVALID_PROJECT_ICON",
      error: "El icono indicado no es válido",
    });
  }

  if (usuarioIds.length > 200) {
    return res.status(400).json({
      code: "PROJECT_MEMBER_LIMIT_EXCEEDED",
      error:
        "No puedes agregar más de 200 usuarios iniciales por operación",
    });
  }

  const dominioResult =
    normalizarDominioProyecto(req.body?.dominio);

  if (!dominioResult.ok) {
    return res.status(400).json({
      code: "INVALID_PROJECT_DOMAIN",
      error: dominioResult.error,
    });
  }

  const dominio = dominioResult.value;

  // Un dominio puede compartirse entre proyectos de la misma
  // instancia, pero no entre portales diferentes.
  const conflictoOtraInstancia =
    await buscarDominioEnOtraInstancia(
      dominio,
      instanciaId
    );

  if (conflictoOtraInstancia) {
    return res.status(409).json({
      code: "PROJECT_DOMAIN_OTHER_INSTANCE",
      error:
        "Ese dominio ya está siendo utilizado por un proyecto de otra instancia",
    });
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    // --------------------------------------------------------
    // Validar miembros iniciales ANTES de crear el proyecto.
    // Solo usuarios aprobados de la misma instancia.
    // --------------------------------------------------------
    if (usuarioIds.length > 0) {
      const placeholders =
        usuarioIds.map(() => "?").join(",");

      const [userRows] = await connection.query(
        `SELECT
           id,
           instancia_id,
           estado
         FROM usuario
         WHERE id IN (${placeholders})
           AND instancia_id = ?
           AND estado = 'aprobado'
         FOR UPDATE`,
        [...usuarioIds, instanciaId]
      );

      const validIds =
        userRows.map((row) => Number(row.id));

      const invalidIds =
        usuarioIds.filter(
          (id) => !validIds.includes(id)
        );

      if (invalidIds.length > 0) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "PROJECT_MEMBER_INVALID_USERS",
          error:
            "Uno o más miembros iniciales no existen, no están aprobados o pertenecen a otra instancia",
          usuario_ids_invalidos: invalidIds,
        });
      }
    }

    // --------------------------------------------------------
    // Crear proyecto.
    // --------------------------------------------------------
    const [result] = await connection.query(
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

    const proyectoId = Number(result.insertId);

    // --------------------------------------------------------
    // Crear relaciones de miembros iniciales.
    // No se toca proyecto_principal_id ni correo.
    // --------------------------------------------------------
    if (usuarioIds.length > 0) {
      const valuesSql =
        usuarioIds.map(() => "(?, ?)").join(", ");

      const values = [];

      for (const usuarioId of usuarioIds) {
        values.push(usuarioId, proyectoId);
      }

      await connection.query(
        `INSERT INTO usuario_proyecto (
           usuario_id,
           proyecto_id
         )
         VALUES ${valuesSql}`,
        values
      );
    }

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      mensaje: "Proyecto creado correctamente",
      proyecto: {
        id: proyectoId,
        nombre,
        dominio,
        instancia_id: instanciaId,
        instancia_codigo:
          req.instanciaActual.codigo,
        instancia_nombre:
          req.instanciaActual.nombre,
        descripcion,
        tipo,
        color,
        icono,
        estado,
        usuarios: usuarioIds.length,
      },
      miembros_iniciales: {
        total: usuarioIds.length,
        usuario_ids: usuarioIds,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (_) {}
    }

    console.error(
      "Error creando proyecto:",
      error
    );

    return res.status(500).json({
      code: "PROJECT_CREATE_ERROR",
      error: "No se pudo crear el proyecto",
    });
  } finally {
    connection.release();
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


// ============================================================
// MIEMBROS DEL PROYECTO
//
// IMPORTANTE:
// Estas rutas modifican únicamente usuario_proyecto.
// NO cambian proyecto_principal_id.
// NO cambian el correo del usuario.
// ============================================================

async function obtenerProyectoAdministrativo(proyectoId, instanciaId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, nombre, dominio, instancia_id, estado
     FROM proyecto
     WHERE id = ?
       AND instancia_id = ?
     LIMIT 1`,
    [proyectoId, instanciaId]
  );

  return rows[0] || null;
}


// ------------------------------------------------------------
// LISTAR MIEMBROS ACTUALES
// GET /api/proyecto/admin/:id/members
// ------------------------------------------------------------
router.get(
  "/:id/members",
  requireAnyPermission([
    "crear_proyectos",
    "editar_proyectos",
    "eliminar_proyectos",
  ]),
  async (req, res) => {
    try {
      const proyectoId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
        return res.status(400).json({
          code: "INVALID_PROJECT_ID",
          error: "El identificador del proyecto no es válido",
        });
      }

      const instanciaId = Number(req.instanciaActual.id);

      const proyecto = await obtenerProyectoAdministrativo(
        proyectoId,
        instanciaId
      );

      if (!proyecto) {
        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const search = String(req.query?.search || "").trim();
      const requestedPage = Math.max(
        1,
        Number.parseInt(req.query?.page, 10) || 1
      );
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(req.query?.limit, 10) || 20)
      );

      const where = [
        "up.proyecto_id = ?",
        "u.instancia_id = ?",
        "u.estado = 'aprobado'",
      ];

      const params = [proyectoId, instanciaId];

      if (search) {
        const like = `%${search}%`;

        where.push(
          `(u.nombre LIKE ?
            OR u.apellido LIKE ?
            OR u.correo LIKE ?)`
        );

        params.push(like, like, like);
      }

      const whereSql = where.join(" AND ");

      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM usuario_proyecto up
         INNER JOIN usuario u
           ON u.id = up.usuario_id
         WHERE ${whereSql}`,
        params
      );

      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * limit;

      const [rows] = await pool.query(
        `SELECT
           u.id,
           u.nombre,
           u.apellido,
           u.correo,
           u.estado,
           u.rol_id,
           u.url_imagen,
           u.background,
           u.proyecto_principal_id,
           u.correo_gestionado_proyecto,
           CASE
             WHEN u.proyecto_principal_id = ? THEN 1
             ELSE 0
           END AS es_proyecto_principal
         FROM usuario_proyecto up
         INNER JOIN usuario u
           ON u.id = up.usuario_id
         WHERE ${whereSql}
         ORDER BY u.nombre ASC, u.apellido ASC, u.id ASC
         LIMIT ${limit}
         OFFSET ${offset}`,
        [proyectoId, ...params]
      );

      return res.json({
        proyecto: {
          id: Number(proyecto.id),
          nombre: proyecto.nombre,
        },
        miembros: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          rol_id:
            row.rol_id === null
              ? null
              : Number(row.rol_id),
          proyecto_principal_id:
            row.proyecto_principal_id === null
              ? null
              : Number(row.proyecto_principal_id),
          correo_gestionado_proyecto:
            Number(row.correo_gestionado_proyecto || 0),
          es_proyecto_principal:
            Number(row.es_proyecto_principal || 0) === 1,
        })),
        pagination: {
          page,
          limit,
          total,
          total_pages: totalPages,
          from: total === 0 ? 0 : offset + 1,
          to: Math.min(offset + rows.length, total),
        },
      });
    } catch (error) {
      console.error("Error cargando miembros del proyecto:", error);

      return res.status(500).json({
        code: "PROJECT_MEMBERS_LIST_ERROR",
        error: "No se pudieron cargar los miembros del proyecto",
      });
    }
  }
);


// ------------------------------------------------------------
// USUARIOS DISPONIBLES PARA AGREGAR
// GET /api/proyecto/admin/:id/member-candidates
// ------------------------------------------------------------
router.get(
  "/:id/member-candidates",
  requireAnyPermission([
    "crear_proyectos",
    "editar_proyectos",
  ]),
  async (req, res) => {
    try {
      const proyectoId = Number.parseInt(req.params.id, 10);

      if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
        return res.status(400).json({
          code: "INVALID_PROJECT_ID",
          error: "El identificador del proyecto no es válido",
        });
      }

      const instanciaId = Number(req.instanciaActual.id);

      const proyecto = await obtenerProyectoAdministrativo(
        proyectoId,
        instanciaId
      );

      if (!proyecto) {
        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const search = String(req.query?.search || "").trim();
      const requestedPage = Math.max(
        1,
        Number.parseInt(req.query?.page, 10) || 1
      );
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(req.query?.limit, 10) || 20)
      );

      const where = [
        "u.instancia_id = ?",
        "u.estado = 'aprobado'",
        `NOT EXISTS (
           SELECT 1
           FROM usuario_proyecto up
           WHERE up.usuario_id = u.id
             AND up.proyecto_id = ?
         )`,
      ];

      const params = [instanciaId, proyectoId];

      if (search) {
        const like = `%${search}%`;

        where.push(
          `(u.nombre LIKE ?
            OR u.apellido LIKE ?
            OR u.correo LIKE ?)`
        );

        params.push(like, like, like);
      }

      const whereSql = where.join(" AND ");

      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM usuario u
         WHERE ${whereSql}`,
        params
      );

      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * limit;

      const [rows] = await pool.query(
        `SELECT
           u.id,
           u.nombre,
           u.apellido,
           u.correo,
           u.estado,
           u.rol_id,
           u.url_imagen,
           u.background,
           u.proyecto_principal_id,
           u.correo_gestionado_proyecto
         FROM usuario u
         WHERE ${whereSql}
         ORDER BY u.nombre ASC, u.apellido ASC, u.id ASC
         LIMIT ${limit}
         OFFSET ${offset}`,
        params
      );

      return res.json({
        proyecto: {
          id: Number(proyecto.id),
          nombre: proyecto.nombre,
        },
        usuarios: rows.map((row) => ({
          ...row,
          id: Number(row.id),
          rol_id:
            row.rol_id === null
              ? null
              : Number(row.rol_id),
          proyecto_principal_id:
            row.proyecto_principal_id === null
              ? null
              : Number(row.proyecto_principal_id),
          correo_gestionado_proyecto:
            Number(row.correo_gestionado_proyecto || 0),
        })),
        pagination: {
          page,
          limit,
          total,
          total_pages: totalPages,
          from: total === 0 ? 0 : offset + 1,
          to: Math.min(offset + rows.length, total),
        },
      });
    } catch (error) {
      console.error("Error cargando candidatos de proyecto:", error);

      return res.status(500).json({
        code: "PROJECT_MEMBER_CANDIDATES_ERROR",
        error: "No se pudieron cargar los usuarios disponibles",
      });
    }
  }
);


// ------------------------------------------------------------
// AGREGAR UNO O VARIOS MIEMBROS
// POST /api/proyecto/admin/:id/members
//
// Body:
// {
//   "usuario_ids": [25, 31]
// }
// ------------------------------------------------------------
router.post(
  "/:id/members",
  requirePermission("editar_proyectos"),
  async (req, res) => {
    const proyectoId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({
        code: "INVALID_PROJECT_ID",
        error: "El identificador del proyecto no es válido",
      });
    }

    const rawIds = Array.isArray(req.body?.usuario_ids)
      ? req.body.usuario_ids
      : [];

    const usuarioIds = [
      ...new Set(
        rawIds
          .map((id) => Number.parseInt(id, 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      ),
    ];

    if (usuarioIds.length === 0) {
      return res.status(400).json({
        code: "PROJECT_MEMBER_IDS_REQUIRED",
        error: "Debes indicar al menos un usuario válido",
      });
    }

    if (usuarioIds.length > 200) {
      return res.status(400).json({
        code: "PROJECT_MEMBER_LIMIT_EXCEEDED",
        error: "No puedes agregar más de 200 usuarios por operación",
      });
    }

    const instanciaId = Number(req.instanciaActual.id);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const proyecto = await obtenerProyectoAdministrativo(
        proyectoId,
        instanciaId,
        connection
      );

      if (!proyecto) {
        await connection.rollback();

        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const placeholders = usuarioIds.map(() => "?").join(",");

      const [userRows] = await connection.query(
        `SELECT
           id,
           nombre,
           apellido,
           correo,
           instancia_id,
           estado
         FROM usuario
         WHERE id IN (${placeholders})
           AND instancia_id = ?
           AND estado = 'aprobado'
         FOR UPDATE`,
        [...usuarioIds, instanciaId]
      );

      const validIds = userRows.map((row) => Number(row.id));
      const invalidIds = usuarioIds.filter(
        (id) => !validIds.includes(id)
      );

      if (invalidIds.length > 0) {
        await connection.rollback();

        return res.status(400).json({
          code: "PROJECT_MEMBER_INVALID_USERS",
          error:
            "Uno o más usuarios no existen, no están aprobados o pertenecen a otra instancia",
          usuario_ids_invalidos: invalidIds,
        });
      }

      let agregados = 0;
      let existentes = 0;

      for (const usuarioId of validIds) {
        const [existingRows] = await connection.query(
          `SELECT 1
           FROM usuario_proyecto
           WHERE usuario_id = ?
             AND proyecto_id = ?
           LIMIT 1`,
          [usuarioId, proyectoId]
        );

        if (existingRows.length) {
          existentes += 1;
          continue;
        }

        await connection.query(
          `INSERT INTO usuario_proyecto (
             usuario_id,
             proyecto_id
           )
           VALUES (?, ?)`,
          [usuarioId, proyectoId]
        );

        agregados += 1;
      }

      await connection.commit();

      return res.status(201).json({
        mensaje: "Miembros procesados correctamente",
        proyecto_id: proyectoId,
        agregados,
        ya_existentes: existentes,
        total_solicitados: usuarioIds.length,
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_) {}

      console.error("Error agregando miembros al proyecto:", error);

      return res.status(500).json({
        code: "PROJECT_MEMBERS_ADD_ERROR",
        error: "No se pudieron agregar los miembros al proyecto",
      });
    } finally {
      connection.release();
    }
  }
);


// ------------------------------------------------------------
// QUITAR UN MIEMBRO SECUNDARIO
// DELETE /api/proyecto/admin/:id/members/:usuarioId
//
// Si este proyecto es su proyecto principal, NO se permite quitar.
// ------------------------------------------------------------
router.delete(
  "/:id/members/:usuarioId",
  requirePermission("editar_proyectos"),
  async (req, res) => {
    const proyectoId = Number.parseInt(req.params.id, 10);
    const usuarioId = Number.parseInt(req.params.usuarioId, 10);

    if (
      !Number.isInteger(proyectoId) ||
      proyectoId <= 0 ||
      !Number.isInteger(usuarioId) ||
      usuarioId <= 0
    ) {
      return res.status(400).json({
        code: "INVALID_PROJECT_MEMBER_ID",
        error: "El proyecto o el usuario indicado no es válido",
      });
    }

    const instanciaId = Number(req.instanciaActual.id);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const proyecto = await obtenerProyectoAdministrativo(
        proyectoId,
        instanciaId,
        connection
      );

      if (!proyecto) {
        await connection.rollback();

        return res.status(404).json({
          code: "PROJECT_NOT_FOUND",
          error: "Proyecto no encontrado en esta instancia",
        });
      }

      const [userRows] = await connection.query(
        `SELECT
           id,
           nombre,
           apellido,
           correo,
           instancia_id,
           estado,
           proyecto_principal_id
         FROM usuario
         WHERE id = ?
           AND instancia_id = ?
         LIMIT 1
         FOR UPDATE`,
        [usuarioId, instanciaId]
      );

      if (!userRows.length) {
        await connection.rollback();

        return res.status(404).json({
          code: "PROJECT_MEMBER_USER_NOT_FOUND",
          error: "Usuario no encontrado en esta instancia",
        });
      }

      const usuario = userRows[0];

      if (
        usuario.proyecto_principal_id !== null &&
        Number(usuario.proyecto_principal_id) === proyectoId
      ) {
        await connection.rollback();

        return res.status(409).json({
          code: "PRIMARY_PROJECT_MEMBER_CANNOT_REMOVE",
          error:
            "No se puede quitar al usuario porque este proyecto es su proyecto principal. Cambia primero su proyecto principal desde Gestión de Usuarios.",
        });
      }

      const [relationRows] = await connection.query(
        `SELECT 1
         FROM usuario_proyecto
         WHERE usuario_id = ?
           AND proyecto_id = ?
         LIMIT 1`,
        [usuarioId, proyectoId]
      );

      if (!relationRows.length) {
        await connection.rollback();

        return res.status(404).json({
          code: "PROJECT_MEMBER_NOT_FOUND",
          error: "El usuario no pertenece a este proyecto",
        });
      }

      await connection.query(
        `DELETE FROM usuario_proyecto
         WHERE usuario_id = ?
           AND proyecto_id = ?`,
        [usuarioId, proyectoId]
      );

      await connection.commit();

      return res.json({
        mensaje: "Miembro quitado correctamente",
        proyecto_id: proyectoId,
        usuario_id: usuarioId,
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_) {}

      console.error("Error quitando miembro del proyecto:", error);

      return res.status(500).json({
        code: "PROJECT_MEMBER_REMOVE_ERROR",
        error: "No se pudo quitar el miembro del proyecto",
      });
    } finally {
      connection.release();
    }
  }
);


module.exports = router;
