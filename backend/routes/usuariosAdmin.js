const express = require("express");
const router = express.Router();
const pool = require("../db");

const {
  requireAuth,
  requirePermission,
  requireAnyPermission,
} = require("../middleware/requireAuth");

const {
  resolveInstance,
} = require("../middleware/resolveInstance");

router.use(
  requireAuth,
  resolveInstance,
  requireAnyPermission([
    "crear_usuarios",
    "editar_usuarios",
  ])
);

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};



const DEFAULT_CHAT_PERMISSIONS = {
  crear_grupos: 0,
  editar_mensajes: 0,
  eliminar_mensajes: 0,
  enviar_audios: 0,
};

const USER_COLORS = [
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e67e22",
  "#e74c3c",
  "#2c3e50",
  "#16a085",
  "#8e44ad",
];

const normalizarPermisosChatAdmin = (value) => {
  let parsed = value;

  if (!parsed) parsed = {};

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    parsed = {};
  }

  const result = {
    ...DEFAULT_CHAT_PERMISSIONS,
  };

  for (const key of Object.keys(result)) {
    const raw = parsed[key];

    result[key] =
      raw === 1 ||
      raw === "1" ||
      raw === true ||
      raw === "true"
        ? 1
        : 0;
  }

  return result;
};

const normalizarUsuarioBase = (value) => {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return {
      ok: false,
      error: "El usuario base es obligatorio",
    };
  }

  if (text.includes("@")) {
    return {
      ok: false,
      error:
        "El usuario base no debe contener @ ni el dominio",
    };
  }

  if (
    text.length > 64 ||
    !/^[a-z0-9._-]+$/.test(text)
  ) {
    return {
      ok: false,
      error:
        "El usuario base solo puede contener letras, números, punto, guion y guion bajo",
    };
  }

  return {
    ok: true,
    value: text,
  };
};

const normalizarCorreoManual = (value) => {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (
    !text ||
    text.length > 190 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
  ) {
    return {
      ok: false,
      error: "El correo manual no es válido",
    };
  }

  return {
    ok: true,
    value: text,
  };
};

const normalizarProjectIds = (value) => {
  const raw = Array.isArray(value)
    ? value
    : [];

  return [
    ...new Set(
      raw
        .map((id) => Number.parseInt(id, 10))
        .filter(
          (id) =>
            Number.isInteger(id) &&
            id > 0
        )
    ),
  ];
};

const normalizarDominioCorreo = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

// ============================================================
// PROYECTOS DISPONIBLES PARA USUARIOS
// GET /api/usuarios/admin/projects
// ============================================================
router.get("/projects", async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);

    const [rows] = await pool.query(
      `SELECT
         id,
         nombre,
         dominio,
         descripcion,
         tipo,
         color,
         icono,
         estado
       FROM proyecto
       WHERE instancia_id = ?
       ORDER BY
         CASE WHEN estado = 'activo' THEN 0 ELSE 1 END,
         nombre ASC,
         id ASC`,
      [instanciaId]
    );

    return res.json({
      instancia: {
        id: instanciaId,
        codigo: req.instanciaActual.codigo,
        nombre: req.instanciaActual.nombre,
        dominio_base:
          req.instanciaActual.dominio_base,
      },
      proyectos: rows.map((row) => ({
        ...row,
        id: Number(row.id),
      })),
    });
  } catch (error) {
    console.error(
      "Error cargando proyectos para usuarios:",
      error
    );

    return res.status(500).json({
      code: "USER_ADMIN_PROJECTS_ERROR",
      error:
        "No se pudieron cargar los proyectos disponibles",
    });
  }
});


// ============================================================
// LISTAR USUARIOS DE LA INSTANCIA ACTUAL
// GET /api/usuarios/admin
// ============================================================
router.get("/", async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);

    const search =
      String(req.query?.search || "").trim();

    const requestedPage = Math.max(
      1,
      Number.parseInt(req.query?.page, 10) || 1
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(req.query?.limit, 10) || 20
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
          OR u.correo LIKE ?
          OR u.usuario_base LIKE ?
          OR CONCAT_WS(
               ' ',
               TRIM(u.nombre),
               TRIM(u.apellido)
             ) LIKE ?)`
      );

      params.push(
        like,
        like,
        like,
        like,
        like
      );
    }

    const whereSql = where.join(" AND ");

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM usuario u
       WHERE ${whereSql}`,
      params
    );

    const total =
      Number(countRows[0]?.total || 0);

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
         u.correo AS usuario,
         u.usuario_base,
         u.rol_id,
         u.estado,
         u.url_imagen,
         u.background,
         u.permisos_chat,
         u.instancia_id,
         u.proyecto_principal_id,
         u.correo_gestionado_proyecto,

         pp.nombre AS proyecto_principal_nombre,
         pp.dominio AS proyecto_principal_dominio,

         (
           SELECT COALESCE(
             JSON_ARRAYAGG(
               JSON_OBJECT(
                 'id', p.id,
                 'nombre', p.nombre,
                 'dominio', p.dominio,
                 'estado', p.estado,
                 'es_principal',
                   IF(
                     p.id = u.proyecto_principal_id,
                     true,
                     false
                   )
               )
             ),
             JSON_ARRAY()
           )
           FROM usuario_proyecto up
           INNER JOIN proyecto p
             ON p.id = up.proyecto_id
           WHERE up.usuario_id = u.id
             AND p.instancia_id = ?
         ) AS proyectos_detallados

       FROM usuario u

       LEFT JOIN proyecto pp
         ON pp.id = u.proyecto_principal_id
        AND pp.instancia_id = ?

       WHERE ${whereSql}

       ORDER BY
         u.nombre ASC,
         u.apellido ASC,
         u.id ASC

       LIMIT ${limit}
       OFFSET ${offset}`,
      [
        instanciaId,
        instanciaId,
        ...params,
      ]
    );

    const usuarios = rows.map((row) => ({
      ...row,

      id: Number(row.id),

      rol_id:
        row.rol_id === null
          ? null
          : Number(row.rol_id),

      instancia_id:
        row.instancia_id === null
          ? null
          : Number(row.instancia_id),

      proyecto_principal_id:
        row.proyecto_principal_id === null
          ? null
          : Number(row.proyecto_principal_id),

      correo_gestionado_proyecto:
        Number(
          row.correo_gestionado_proyecto || 0
        ),

      proyectos_detallados:
        parseJsonArray(
          row.proyectos_detallados
        ),
    }));

    return res.json({
      instancia: {
        id: instanciaId,
        codigo: req.instanciaActual.codigo,
        nombre: req.instanciaActual.nombre,
      },

      usuarios,

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
          offset + usuarios.length,
          total
        ),
      },

      filters: {
        search,
      },
    });
  } catch (error) {
    console.error(
      "Error cargando usuarios administrativos:",
      error
    );

    return res.status(500).json({
      code: "USER_ADMIN_LIST_ERROR",
      error:
        "No se pudo cargar la lista de usuarios",
    });
  }
});


// ============================================================
// DETALLE DE USUARIO
// GET /api/usuarios/admin/:id
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const usuarioId =
      parsePositiveInt(req.params.id);

    if (!usuarioId) {
      return res.status(400).json({
        code: "INVALID_USER_ID",
        error:
          "El identificador del usuario no es válido",
      });
    }

    const instanciaId =
      Number(req.instanciaActual.id);

    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.nombre,
         u.apellido,
         u.correo,
         u.correo AS usuario,
         u.usuario_base,
         u.rol_id,
         u.estado,
         u.url_imagen,
         u.background,
         u.permisos_chat,
         u.instancia_id,
         u.proyecto_principal_id,
         u.correo_gestionado_proyecto,

         pp.nombre AS proyecto_principal_nombre,
         pp.dominio AS proyecto_principal_dominio

       FROM usuario u

       LEFT JOIN proyecto pp
         ON pp.id = u.proyecto_principal_id
        AND pp.instancia_id = ?

       WHERE u.id = ?
         AND u.instancia_id = ?
       LIMIT 1`,
      [
        instanciaId,
        usuarioId,
        instanciaId,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({
        code: "USER_NOT_FOUND",
        error:
          "Usuario no encontrado en esta instancia",
      });
    }

    const usuario = rows[0];

    const [projectRows] = await pool.query(
      `SELECT
         p.id,
         p.nombre,
         p.dominio,
         p.estado,
         CASE
           WHEN p.id = ? THEN 1
           ELSE 0
         END AS es_principal
       FROM usuario_proyecto up
       INNER JOIN proyecto p
         ON p.id = up.proyecto_id
       WHERE up.usuario_id = ?
         AND p.instancia_id = ?
       ORDER BY
         es_principal DESC,
         p.nombre ASC,
         p.id ASC`,
      [
        usuario.proyecto_principal_id,
        usuarioId,
        instanciaId,
      ]
    );

    return res.json({
      usuario: {
        ...usuario,

        id: Number(usuario.id),

        rol_id:
          usuario.rol_id === null
            ? null
            : Number(usuario.rol_id),

        instancia_id:
          usuario.instancia_id === null
            ? null
            : Number(usuario.instancia_id),

        proyecto_principal_id:
          usuario.proyecto_principal_id === null
            ? null
            : Number(
                usuario.proyecto_principal_id
              ),

        correo_gestionado_proyecto:
          Number(
            usuario.correo_gestionado_proyecto ||
              0
          ),

        proyectos_detallados:
          projectRows.map((project) => ({
            ...project,
            id: Number(project.id),
            es_principal:
              Number(
                project.es_principal || 0
              ) === 1,
          })),
      },
    });
  } catch (error) {
    console.error(
      "Error cargando detalle administrativo de usuario:",
      error
    );

    return res.status(500).json({
      code: "USER_ADMIN_DETAIL_ERROR",
      error:
        "No se pudo cargar el usuario",
    });
  }
});



// ============================================================
// CREAR USUARIO ADMINISTRATIVO
// POST /api/usuarios/admin
//
// Gestionado:
//   usuario_base + dominio proyecto principal = correo
//
// Manual/especial:
//   correo enviado explícitamente y
//   correo_gestionado_proyecto = 0
//
// El proyecto principal siempre queda incluido también
// en usuario_proyecto.
// ============================================================
router.post(
  "/",
  requirePermission("crear_usuarios"),
  async (req, res) => {
    const instanciaId =
      Number(req.instanciaActual.id);

    const nombre =
      String(req.body?.nombre || "").trim();

    const apellido =
      String(req.body?.apellido || "").trim();

    const contrasena =
      String(req.body?.contrasena || "");

    const rolId =
      parsePositiveInt(req.body?.rol_id) || 4;

    const proyectoPrincipalId =
      parsePositiveInt(
        req.body?.proyecto_principal_id
      );

    const correoGestionado =
      req.body?.correo_gestionado_proyecto === 0 ||
      req.body?.correo_gestionado_proyecto === "0" ||
      req.body?.correo_gestionado_proyecto === false
        ? 0
        : 1;

    const usuarioBaseResult =
      normalizarUsuarioBase(
        req.body?.usuario_base
      );

    if (!nombre || nombre.length > 100) {
      return res.status(400).json({
        code: "INVALID_USER_NAME",
        error:
          "El nombre es obligatorio y debe tener máximo 100 caracteres",
      });
    }

    if (!apellido || apellido.length > 100) {
      return res.status(400).json({
        code: "INVALID_USER_LASTNAME",
        error:
          "El apellido es obligatorio y debe tener máximo 100 caracteres",
      });
    }

    if (!contrasena) {
      return res.status(400).json({
        code: "USER_PASSWORD_REQUIRED",
        error:
          "La contraseña es obligatoria para un usuario nuevo",
      });
    }

    if (!proyectoPrincipalId) {
      return res.status(400).json({
        code: "PRIMARY_PROJECT_REQUIRED",
        error:
          "Debes seleccionar un proyecto principal",
      });
    }

    let usuarioBase = null;

    if (usuarioBaseResult.ok) {
      usuarioBase = usuarioBaseResult.value;
    } else if (correoGestionado === 1) {
      return res.status(400).json({
        code: "INVALID_USER_BASE",
        error: usuarioBaseResult.error,
      });
    }

    let projectIds =
      normalizarProjectIds(
        req.body?.proyectos
      );

    if (
      !projectIds.includes(
        proyectoPrincipalId
      )
    ) {
      projectIds.unshift(
        proyectoPrincipalId
      );
    }

    if (projectIds.length > 200) {
      return res.status(400).json({
        code: "USER_PROJECT_LIMIT_EXCEEDED",
        error:
          "No puedes asignar más de 200 proyectos a un usuario",
      });
    }

    const connection =
      await pool.getConnection();

    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      // ------------------------------------------
      // Validar rol.
      // ------------------------------------------
      const [roleRows] =
        await connection.query(
          `SELECT id
           FROM roles
           WHERE id = ?
           LIMIT 1`,
          [rolId]
        );

      if (!roleRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_ROLE",
          error:
            "El rol indicado no existe",
        });
      }

      // ------------------------------------------
      // Validar TODOS los proyectos y su instancia.
      // ------------------------------------------
      const placeholders =
        projectIds.map(() => "?").join(",");

      const [projectRows] =
        await connection.query(
          `SELECT
             id,
             nombre,
             dominio,
             estado,
             instancia_id
           FROM proyecto
           WHERE id IN (${placeholders})
             AND instancia_id = ?
           FOR UPDATE`,
          [
            ...projectIds,
            instanciaId,
          ]
        );

      const validProjectIds =
        projectRows.map(
          (project) => Number(project.id)
        );

      const invalidProjectIds =
        projectIds.filter(
          (id) =>
            !validProjectIds.includes(id)
        );

      if (invalidProjectIds.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code:
            "USER_PROJECTS_INVALID_INSTANCE",
          error:
            "Uno o más proyectos no existen o pertenecen a otra instancia",
          proyecto_ids_invalidos:
            invalidProjectIds,
        });
      }

      const proyectoPrincipal =
        projectRows.find(
          (project) =>
            Number(project.id) ===
            proyectoPrincipalId
        );

      if (!proyectoPrincipal) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "PRIMARY_PROJECT_INVALID",
          error:
            "El proyecto principal no es válido para esta instancia",
        });
      }

      // ------------------------------------------
      // Construir correo.
      // ------------------------------------------
      let correo = "";

      if (correoGestionado === 1) {
        const dominio =
          normalizarDominioCorreo(
            proyectoPrincipal.dominio
          );

        if (!dominio) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            code:
              "PRIMARY_PROJECT_DOMAIN_REQUIRED",
            error:
              "El proyecto principal no tiene dominio. Para este proyecto debes crear una cuenta con correo manual.",
          });
        }

        correo =
          `${usuarioBase}@${dominio}`;
      } else {
        const correoManualResult =
          normalizarCorreoManual(
            req.body?.correo
          );

        if (!correoManualResult.ok) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            code:
              "INVALID_MANUAL_EMAIL",
            error:
              correoManualResult.error,
          });
        }

        correo =
          correoManualResult.value;

        if (!usuarioBase) {
          usuarioBase =
            correo.split("@")[0]
              .trim()
              .toLowerCase();
        }
      }

      // ------------------------------------------
      // Comprobar correo duplicado.
      // ------------------------------------------
      const [existingEmailRows] =
        await connection.query(
          `SELECT
             id,
             correo
           FROM usuario
           WHERE correo = ?
           LIMIT 1
           FOR UPDATE`,
          [correo]
        );

      if (existingEmailRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          code:
            "USER_EMAIL_ALREADY_EXISTS",
          error:
            `El correo ${correo} ya está registrado`,
          correo,
          usuario_existente_id:
            Number(existingEmailRows[0].id),
        });
      }

      const permisosChat =
        normalizarPermisosChatAdmin(
          req.body?.permisos_chat
        );

      const randomColor =
        USER_COLORS[
          Math.floor(
            Math.random() *
              USER_COLORS.length
          )
        ];

      // ------------------------------------------
      // Crear usuario.
      // ------------------------------------------
      const [insertResult] =
        await connection.query(
          `INSERT INTO usuario (
             nombre,
             apellido,
             correo,
             contrasena,
             rol_id,
             permisos_chat,
             background,
             estado,
             usuario_base,
             proyecto_principal_id,
             instancia_id,
             correo_gestionado_proyecto
           )
           VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?
           )`,
          [
            nombre,
            apellido,
            correo,
            contrasena,
            rolId,
            JSON.stringify(permisosChat),
            randomColor,
            "aprobado",
            usuarioBase,
            proyectoPrincipalId,
            instanciaId,
            correoGestionado,
          ]
        );

      const usuarioId =
        Number(insertResult.insertId);

      // ------------------------------------------
      // Relaciones de proyectos.
      // ------------------------------------------
      for (const proyectoId of projectIds) {
        await connection.query(
          `INSERT INTO usuario_proyecto (
             usuario_id,
             proyecto_id
           )
           VALUES (?, ?)`,
          [
            usuarioId,
            proyectoId,
          ]
        );
      }

      await connection.commit();
      transactionStarted = false;

      return res.status(201).json({
        code: "USER_ADMIN_CREATED",
        mensaje:
          "Usuario creado correctamente",
        usuario: {
          id: usuarioId,
          nombre,
          apellido,
          usuario_base: usuarioBase,
          correo,
          rol_id: rolId,
          estado: "aprobado",
          instancia_id: instanciaId,
          proyecto_principal_id:
            proyectoPrincipalId,
          proyecto_principal_nombre:
            proyectoPrincipal.nombre,
          proyecto_principal_dominio:
            proyectoPrincipal.dominio,
          correo_gestionado_proyecto:
            correoGestionado,
          proyectos: projectIds,
        },
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (_) {}
      }

      if (
        error?.code === "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          code:
            "USER_EMAIL_ALREADY_EXISTS",
          error:
            "El correo generado ya está registrado",
        });
      }

      console.error(
        "Error creando usuario administrativo:",
        error
      );

      return res.status(500).json({
        code:
          "USER_ADMIN_CREATE_ERROR",
        error:
          "No se pudo crear el usuario",
      });
    } finally {
      connection.release();
    }
  }
);



// ============================================================
// ACTUALIZAR USUARIO ADMINISTRATIVO
// PUT /api/usuarios/admin/:id
//
// Si la cuenta es gestionada:
// usuario_base + dominio proyecto principal = correo.
//
// Todo se realiza en una única transacción.
// ============================================================
router.put(
  "/:id",
  requirePermission("editar_usuarios"),
  async (req, res) => {
    const usuarioId =
      parsePositiveInt(req.params.id);

    if (!usuarioId) {
      return res.status(400).json({
        code: "INVALID_USER_ID",
        error:
          "El identificador del usuario no es válido",
      });
    }

    const instanciaId =
      Number(req.instanciaActual.id);

    const connection =
      await pool.getConnection();

    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      // ------------------------------------------------------
      // 1. Bloquear y obtener usuario actual
      // ------------------------------------------------------
      const [userRows] =
        await connection.query(
          `SELECT
             id,
             nombre,
             apellido,
             correo,
             contrasena,
             rol_id,
             permisos_chat,
             estado,
             usuario_base,
             proyecto_principal_id,
             instancia_id,
             correo_gestionado_proyecto
           FROM usuario
           WHERE id = ?
             AND instancia_id = ?
           LIMIT 1
           FOR UPDATE`,
          [
            usuarioId,
            instanciaId,
          ]
        );

      if (!userRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(404).json({
          code: "USER_NOT_FOUND",
          error:
            "Usuario no encontrado en esta instancia",
        });
      }

      const actual = userRows[0];

      // ------------------------------------------------------
      // 2. Datos generales
      // ------------------------------------------------------
      const nombre =
        req.body?.nombre !== undefined
          ? String(req.body.nombre).trim()
          : String(actual.nombre || "").trim();

      const apellido =
        req.body?.apellido !== undefined
          ? String(req.body.apellido).trim()
          : String(actual.apellido || "").trim();

      if (!nombre || nombre.length > 100) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_NAME",
          error:
            "El nombre es obligatorio y debe tener máximo 100 caracteres",
        });
      }

      if (!apellido || apellido.length > 100) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_LASTNAME",
          error:
            "El apellido es obligatorio y debe tener máximo 100 caracteres",
        });
      }

      const rolId =
        req.body?.rol_id !== undefined
          ? parsePositiveInt(req.body.rol_id)
          : Number(actual.rol_id);

      if (!rolId) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_ROLE",
          error: "El rol no es válido",
        });
      }

      const [roleRows] =
        await connection.query(
          `SELECT id
           FROM roles
           WHERE id = ?
           LIMIT 1`,
          [rolId]
        );

      if (!roleRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_ROLE",
          error:
            "El rol indicado no existe",
        });
      }

      // ------------------------------------------------------
      // 3. Estado correo gestionado/manual
      // ------------------------------------------------------
      let correoGestionado =
        Number(
          actual.correo_gestionado_proyecto || 0
        );

      if (
        req.body?.correo_gestionado_proyecto !==
        undefined
      ) {
        correoGestionado =
          req.body.correo_gestionado_proyecto === 0 ||
          req.body.correo_gestionado_proyecto === "0" ||
          req.body.correo_gestionado_proyecto === false
            ? 0
            : 1;
      }

      // ------------------------------------------------------
      // 4. Usuario base
      // ------------------------------------------------------
      let usuarioBase =
        String(actual.usuario_base || "")
          .trim()
          .toLowerCase();

      if (req.body?.usuario_base !== undefined) {
        const usuarioBaseResult =
          normalizarUsuarioBase(
            req.body.usuario_base
          );

        if (!usuarioBaseResult.ok) {
          if (correoGestionado === 1) {
            await connection.rollback();
            transactionStarted = false;

            return res.status(400).json({
              code: "INVALID_USER_BASE",
              error:
                usuarioBaseResult.error,
            });
          }
        } else {
          usuarioBase =
            usuarioBaseResult.value;
        }
      }

      if (
        correoGestionado === 1 &&
        !usuarioBase
      ) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_BASE",
          error:
            "El usuario base es obligatorio para una cuenta gestionada",
        });
      }

      // ------------------------------------------------------
      // 5. Proyecto principal
      // ------------------------------------------------------
      let proyectoPrincipalId =
        actual.proyecto_principal_id === null
          ? null
          : Number(
              actual.proyecto_principal_id
            );

      if (
        req.body?.proyecto_principal_id !==
        undefined
      ) {
        proyectoPrincipalId =
          parsePositiveInt(
            req.body.proyecto_principal_id
          );
      }

      if (
        correoGestionado === 1 &&
        !proyectoPrincipalId
      ) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "PRIMARY_PROJECT_REQUIRED",
          error:
            "Una cuenta gestionada debe tener proyecto principal",
        });
      }

      // ------------------------------------------------------
      // 6. Membresías solicitadas
      //
      // Si no se envían proyectos, conservamos los actuales.
      // ------------------------------------------------------
      const [currentProjectRows] =
        await connection.query(
          `SELECT proyecto_id
           FROM usuario_proyecto
           WHERE usuario_id = ?`,
          [usuarioId]
        );

      let projectIds =
        currentProjectRows.map(
          (row) => Number(row.proyecto_id)
        );

      if (Array.isArray(req.body?.proyectos)) {
        projectIds =
          normalizarProjectIds(
            req.body.proyectos
          );
      }

      if (
        proyectoPrincipalId &&
        !projectIds.includes(
          proyectoPrincipalId
        )
      ) {
        projectIds.unshift(
          proyectoPrincipalId
        );
      }

      if (projectIds.length > 200) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code:
            "USER_PROJECT_LIMIT_EXCEEDED",
          error:
            "No puedes asignar más de 200 proyectos a un usuario",
        });
      }

      // ------------------------------------------------------
      // 7. Validar proyectos contra la instancia
      // ------------------------------------------------------
      let projectRows = [];

      if (projectIds.length) {
        const placeholders =
          projectIds.map(() => "?").join(",");

        const [rows] =
          await connection.query(
            `SELECT
               id,
               nombre,
               dominio,
               estado,
               instancia_id
             FROM proyecto
             WHERE id IN (${placeholders})
               AND instancia_id = ?
             FOR UPDATE`,
            [
              ...projectIds,
              instanciaId,
            ]
          );

        projectRows = rows;

        const validIds =
          rows.map(
            (project) =>
              Number(project.id)
          );

        const invalidIds =
          projectIds.filter(
            (id) =>
              !validIds.includes(id)
          );

        if (invalidIds.length) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            code:
              "USER_PROJECTS_INVALID_INSTANCE",
            error:
              "Uno o más proyectos no existen o pertenecen a otra instancia",
            proyecto_ids_invalidos:
              invalidIds,
          });
        }
      }

      let proyectoPrincipal = null;

      if (proyectoPrincipalId) {
        proyectoPrincipal =
          projectRows.find(
            (project) =>
              Number(project.id) ===
              proyectoPrincipalId
          );

        if (!proyectoPrincipal) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            code:
              "PRIMARY_PROJECT_INVALID",
            error:
              "El proyecto principal no pertenece a esta instancia",
          });
        }
      }

      // ------------------------------------------------------
      // 8. Calcular correo nuevo
      // ------------------------------------------------------
      let correo =
        String(actual.correo || "")
          .trim()
          .toLowerCase();

      if (correoGestionado === 1) {
        const dominio =
          normalizarDominioCorreo(
            proyectoPrincipal?.dominio
          );

        if (!dominio) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            code:
              "PRIMARY_PROJECT_DOMAIN_REQUIRED",
            error:
              "El proyecto principal no tiene dominio. La cuenta no puede ser gestionada automáticamente.",
          });
        }

        correo =
          `${usuarioBase}@${dominio}`;
      } else if (req.body?.correo !== undefined) {
        const correoManualResult =
          normalizarCorreoManual(
            req.body.correo
          );

        if (!correoManualResult.ok) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(400).json({
            code:
              "INVALID_MANUAL_EMAIL",
            error:
              correoManualResult.error,
          });
        }

        correo =
          correoManualResult.value;
      }

      // ------------------------------------------------------
      // 9. Conflicto de correo
      // ------------------------------------------------------
      const [conflictRows] =
        await connection.query(
          `SELECT
             id,
             correo
           FROM usuario
           WHERE correo = ?
             AND id <> ?
           LIMIT 1
           FOR UPDATE`,
          [
            correo,
            usuarioId,
          ]
        );

      if (conflictRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          code:
            "USER_EMAIL_ALREADY_EXISTS",
          error:
            `El correo ${correo} ya está registrado`,
          correo,
          usuario_existente_id:
            Number(
              conflictRows[0].id
            ),
        });
      }

      // ------------------------------------------------------
      // 10. Permisos
      // ------------------------------------------------------
      const permisosChat =
        req.body?.permisos_chat !==
        undefined
          ? normalizarPermisosChatAdmin(
              req.body.permisos_chat
            )
          : normalizarPermisosChatAdmin(
              actual.permisos_chat
            );

      // ------------------------------------------------------
      // 11. Actualizar usuario
      // ------------------------------------------------------
      let updateSql = `
        UPDATE usuario SET
          nombre = ?,
          apellido = ?,
          correo = ?,
          rol_id = ?,
          permisos_chat = ?,
          usuario_base = ?,
          proyecto_principal_id = ?,
          instancia_id = ?,
          correo_gestionado_proyecto = ?
      `;

      const updateParams = [
        nombre,
        apellido,
        correo,
        rolId,
        JSON.stringify(permisosChat),
        usuarioBase || null,
        proyectoPrincipalId,
        instanciaId,
        correoGestionado,
      ];

      const newPassword =
        String(
          req.body?.contrasena || ""
        );

      if (newPassword) {
        updateSql += `,
          contrasena = ?
        `;

        updateParams.push(
          newPassword
        );
      }

      updateSql += `
        WHERE id = ?
          AND instancia_id = ?
      `;

      updateParams.push(
        usuarioId,
        instanciaId
      );

      await connection.query(
        updateSql,
        updateParams
      );

      // ------------------------------------------------------
      // 12. Sincronizar relaciones usuario_proyecto
      // ------------------------------------------------------
      const actualesIds =
        currentProjectRows.map(
          (row) =>
            Number(row.proyecto_id)
        );

      const paraAgregar =
        projectIds.filter(
          (id) =>
            !actualesIds.includes(id)
        );

      const paraEliminar =
        actualesIds.filter(
          (id) =>
            !projectIds.includes(id)
        );

      for (const projectId of paraAgregar) {
        await connection.query(
          `INSERT INTO usuario_proyecto (
             usuario_id,
             proyecto_id
           )
           VALUES (?, ?)`,
          [
            usuarioId,
            projectId,
          ]
        );
      }

      if (paraEliminar.length) {
        await connection.query(
          `DELETE FROM usuario_proyecto
           WHERE usuario_id = ?
             AND proyecto_id IN (?)`,
          [
            usuarioId,
            paraEliminar,
          ]
        );
      }

      // Garantía adicional:
      // el proyecto principal nunca puede quedar fuera.
      if (proyectoPrincipalId) {
        const [relationRows] =
          await connection.query(
            `SELECT 1
             FROM usuario_proyecto
             WHERE usuario_id = ?
               AND proyecto_id = ?
             LIMIT 1`,
            [
              usuarioId,
              proyectoPrincipalId,
            ]
          );

        if (!relationRows.length) {
          await connection.query(
            `INSERT INTO usuario_proyecto (
               usuario_id,
               proyecto_id
             )
             VALUES (?, ?)`,
            [
              usuarioId,
              proyectoPrincipalId,
            ]
          );
        }
      }

      await connection.commit();
      transactionStarted = false;

      return res.json({
        code: "USER_ADMIN_UPDATED",
        mensaje:
          "Usuario actualizado correctamente",

        usuario: {
          id: usuarioId,
          nombre,
          apellido,
          usuario_base:
            usuarioBase || null,
          correo,
          rol_id: rolId,
          instancia_id: instanciaId,
          proyecto_principal_id:
            proyectoPrincipalId,
          proyecto_principal_nombre:
            proyectoPrincipal?.nombre ||
            null,
          proyecto_principal_dominio:
            proyectoPrincipal?.dominio ||
            null,
          correo_gestionado_proyecto:
            correoGestionado,
          proyectos: projectIds,
        },

        cambios: {
          correo_anterior:
            actual.correo,
          correo_nuevo:
            correo,

          proyecto_principal_anterior:
            actual.proyecto_principal_id ===
            null
              ? null
              : Number(
                  actual.proyecto_principal_id
                ),

          proyecto_principal_nuevo:
            proyectoPrincipalId,

          proyectos_agregados:
            paraAgregar,

          proyectos_eliminados:
            paraEliminar,
        },
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (_) {}
      }

      if (
        error?.code === "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          code:
            "USER_EMAIL_ALREADY_EXISTS",
          error:
            "El correo resultante ya está registrado",
        });
      }

      console.error(
        "Error actualizando usuario administrativo:",
        error
      );

      return res.status(500).json({
        code:
          "USER_ADMIN_UPDATE_ERROR",
        error:
          "No se pudo actualizar el usuario",
      });
    } finally {
      connection.release();
    }
  }
);



// ============================================================
// DESACTIVAR USUARIO ADMINISTRATIVO
// DELETE /api/usuarios/admin/:id
//
// No borra físicamente al usuario.
// Conserva chats/historial, elimina sus proyectos y cambia
// el estado a "desaprobado".
// ============================================================
router.delete(
  "/:id",
  requirePermission("editar_usuarios"),
  async (req, res) => {
    const usuarioId =
      parsePositiveInt(req.params.id);

    if (!usuarioId) {
      return res.status(400).json({
        code: "INVALID_USER_ID",
        error:
          "El identificador del usuario no es válido",
      });
    }

    const instanciaId =
      Number(req.instanciaActual.id);

    const connection =
      await pool.getConnection();

    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      const [userRows] =
        await connection.query(
          `SELECT
             id,
             nombre,
             apellido,
             correo,
             estado,
             proyecto_principal_id,
             instancia_id
           FROM usuario
           WHERE id = ?
             AND instancia_id = ?
           LIMIT 1
           FOR UPDATE`,
          [
            usuarioId,
            instanciaId,
          ]
        );

      if (!userRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(404).json({
          code: "USER_NOT_FOUND",
          error:
            "Usuario no encontrado en esta instancia",
        });
      }

      const usuario = userRows[0];

      const [deleteResult] =
        await connection.query(
          `DELETE FROM usuario_proyecto
           WHERE usuario_id = ?`,
          [usuarioId]
        );

      await connection.query(
        `UPDATE usuario
         SET
           estado = 'desaprobado',
           proyecto_principal_id = NULL
         WHERE id = ?
           AND instancia_id = ?`,
        [
          usuarioId,
          instanciaId,
        ]
      );

      await connection.commit();
      transactionStarted = false;

      // Si está conectado, avisarle para que salga
      // inmediatamente de la aplicación.
      const socketUtils =
        req.app.get("socketUtils");

      if (
        socketUtils?.enviarEventoAlUsuario
      ) {
        socketUtils.enviarEventoAlUsuario(
          usuarioId,
          "cuentaDesactivada",
          {
            usuarioId,
            motivo:
              "Tu cuenta ha sido desactivada. Comunícate con un administrador.",
          }
        );
      }

      return res.json({
        code: "USER_ADMIN_DEACTIVATED",
        mensaje:
          "Usuario desactivado correctamente",

        usuario: {
          id: usuarioId,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          correo: usuario.correo,
          estado: "desaprobado",
          proyecto_principal_id: null,
        },

        proyectos_eliminados:
          Number(
            deleteResult?.affectedRows || 0
          ),
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (_) {}
      }

      console.error(
        "Error desactivando usuario administrativo:",
        error
      );

      return res.status(500).json({
        code:
          "USER_ADMIN_DEACTIVATE_ERROR",
        error:
          "No se pudo desactivar el usuario",
      });
    } finally {
      connection.release();
    }
  }
);



// ============================================================
// CREACION MASIVA SEGURA DE USUARIOS
// POST /api/usuarios/admin/batch
//
// Todos los usuarios del lote comparten:
// - proyecto principal
// - proyectos secundarios
// - rol
// - permisos
//
// Cada correo se deriva en backend:
// usuario_base@dominio_proyecto_principal
//
// Si uno falla, se revierte TODO el lote.
// ============================================================
router.post(
  "/batch",
  requirePermission("crear_usuarios"),
  async (req, res) => {
    const instanciaId =
      Number(req.instanciaActual.id);

    const usuarios =
      Array.isArray(req.body?.usuarios)
        ? req.body.usuarios
        : [];

    if (!usuarios.length) {
      return res.status(400).json({
        code: "BATCH_USERS_REQUIRED",
        error:
          "Debes agregar al menos un usuario",
      });
    }

    if (usuarios.length > 100) {
      return res.status(400).json({
        code: "BATCH_USER_LIMIT_EXCEEDED",
        error:
          "Puedes crear como máximo 100 usuarios por lote",
      });
    }

    const proyectoPrincipalId =
      parsePositiveInt(
        req.body?.proyecto_principal_id
      );

    if (!proyectoPrincipalId) {
      return res.status(400).json({
        code: "PRIMARY_PROJECT_REQUIRED",
        error:
          "Debes seleccionar un proyecto principal",
      });
    }

    const rolId =
      parsePositiveInt(req.body?.rol_id) || 4;

    let projectIds =
      normalizarProjectIds(
        req.body?.proyectos
      );

    if (
      !projectIds.includes(
        proyectoPrincipalId
      )
    ) {
      projectIds.unshift(
        proyectoPrincipalId
      );
    }

    if (projectIds.length > 200) {
      return res.status(400).json({
        code: "USER_PROJECT_LIMIT_EXCEEDED",
        error:
          "No puedes asignar más de 200 proyectos",
      });
    }

    const normalizedUsers = [];

    for (let index = 0; index < usuarios.length; index++) {
      const raw = usuarios[index] || {};

      const nombre =
        String(raw.nombre || "").trim();

      const apellido =
        String(raw.apellido || "").trim();

      const contrasena =
        String(
          raw.contrasena ??
          raw.password ??
          ""
        );

      const baseResult =
        normalizarUsuarioBase(
          raw.usuario_base ??
          raw.usuario
        );

      if (!nombre || nombre.length > 100) {
        return res.status(400).json({
          code: "INVALID_BATCH_USER_NAME",
          error:
            `Fila ${index + 1}: el nombre es obligatorio`,
          fila: index + 1,
        });
      }

      if (!apellido || apellido.length > 100) {
        return res.status(400).json({
          code: "INVALID_BATCH_USER_LASTNAME",
          error:
            `Fila ${index + 1}: el apellido es obligatorio`,
          fila: index + 1,
        });
      }

      if (!baseResult.ok) {
        return res.status(400).json({
          code: "INVALID_BATCH_USER_BASE",
          error:
            `Fila ${index + 1}: ${baseResult.error}`,
          fila: index + 1,
        });
      }

      if (!contrasena) {
        return res.status(400).json({
          code: "BATCH_USER_PASSWORD_REQUIRED",
          error:
            `Fila ${index + 1}: la contraseña es obligatoria`,
          fila: index + 1,
        });
      }

      normalizedUsers.push({
        nombre,
        apellido,
        usuario_base:
          baseResult.value,
        contrasena,
      });
    }

    const duplicateBases = [];

    const seenBases = new Set();

    for (const user of normalizedUsers) {
      if (
        seenBases.has(user.usuario_base)
      ) {
        duplicateBases.push(
          user.usuario_base
        );
      }

      seenBases.add(
        user.usuario_base
      );
    }

    if (duplicateBases.length) {
      return res.status(409).json({
        code:
          "BATCH_DUPLICATE_USER_BASE",
        error:
          `El lote contiene usuarios base duplicados: ${[
            ...new Set(duplicateBases)
          ].join(", ")}`,
      });
    }

    const permisosChat =
      normalizarPermisosChatAdmin(
        req.body?.permisos_chat
      );

    const connection =
      await pool.getConnection();

    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;

      // ------------------------------------------
      // Validar rol
      // ------------------------------------------
      const [roleRows] =
        await connection.query(
          `SELECT id
           FROM roles
           WHERE id = ?
           LIMIT 1`,
          [rolId]
        );

      if (!roleRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code: "INVALID_USER_ROLE",
          error:
            "El rol indicado no existe",
        });
      }

      // ------------------------------------------
      // Validar proyectos e instancia
      // ------------------------------------------
      const placeholders =
        projectIds.map(() => "?").join(",");

      const [projectRows] =
        await connection.query(
          `SELECT
             id,
             nombre,
             dominio,
             estado,
             instancia_id
           FROM proyecto
           WHERE id IN (${placeholders})
             AND instancia_id = ?
           FOR UPDATE`,
          [
            ...projectIds,
            instanciaId,
          ]
        );

      const validProjectIds =
        projectRows.map(
          (project) =>
            Number(project.id)
        );

      const invalidProjectIds =
        projectIds.filter(
          (id) =>
            !validProjectIds.includes(id)
        );

      if (invalidProjectIds.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code:
            "USER_PROJECTS_INVALID_INSTANCE",
          error:
            "Uno o más proyectos no pertenecen a esta instancia",
          proyecto_ids_invalidos:
            invalidProjectIds,
        });
      }

      const proyectoPrincipal =
        projectRows.find(
          (project) =>
            Number(project.id) ===
            proyectoPrincipalId
        );

      if (!proyectoPrincipal) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code:
            "PRIMARY_PROJECT_INVALID",
          error:
            "El proyecto principal no es válido",
        });
      }

      const dominio =
        normalizarDominioCorreo(
          proyectoPrincipal.dominio
        );

      if (!dominio) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(400).json({
          code:
            "PRIMARY_PROJECT_DOMAIN_REQUIRED",
          error:
            "El proyecto principal no tiene dominio y no puede utilizarse para creación masiva gestionada",
        });
      }

      // ------------------------------------------
      // Correos finales del lote
      // ------------------------------------------
      const usersWithEmail =
        normalizedUsers.map(
          (user) => ({
            ...user,
            correo:
              `${user.usuario_base}@${dominio}`,
          })
        );

      const emails =
        usersWithEmail.map(
          (user) => user.correo
        );

      if (
        new Set(emails).size !==
        emails.length
      ) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          code:
            "BATCH_DUPLICATE_EMAIL",
          error:
            "El lote genera correos duplicados",
        });
      }

      // ------------------------------------------
      // Conflictos con usuarios existentes
      // ------------------------------------------
      const emailPlaceholders =
        emails.map(() => "?").join(",");

      const [existingRows] =
        await connection.query(
          `SELECT
             id,
             correo
           FROM usuario
           WHERE correo IN (
             ${emailPlaceholders}
           )
           FOR UPDATE`,
          emails
        );

      if (existingRows.length) {
        await connection.rollback();
        transactionStarted = false;

        return res.status(409).json({
          code:
            "BATCH_EMAIL_ALREADY_EXISTS",
          error:
            `El correo ${existingRows[0].correo} ya está registrado`,
          conflictos:
            existingRows.map(
              (row) => ({
                usuario_id:
                  Number(row.id),
                correo:
                  row.correo,
              })
            ),
        });
      }

      const createdUsers = [];

      // ------------------------------------------
      // Crear todos dentro de la misma transacción
      // ------------------------------------------
      for (const user of usersWithEmail) {
        const randomColor =
          USER_COLORS[
            Math.floor(
              Math.random() *
                USER_COLORS.length
            )
          ];

        const [insertResult] =
          await connection.query(
            `INSERT INTO usuario (
               nombre,
               apellido,
               correo,
               contrasena,
               rol_id,
               permisos_chat,
               background,
               estado,
               usuario_base,
               proyecto_principal_id,
               instancia_id,
               correo_gestionado_proyecto
             )
             VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?
             )`,
            [
              user.nombre,
              user.apellido,
              user.correo,
              user.contrasena,
              rolId,
              JSON.stringify(
                permisosChat
              ),
              randomColor,
              "aprobado",
              user.usuario_base,
              proyectoPrincipalId,
              instanciaId,
              1,
            ]
          );

        const usuarioId =
          Number(
            insertResult.insertId
          );

        for (
          const proyectoId
          of projectIds
        ) {
          await connection.query(
            `INSERT INTO usuario_proyecto (
               usuario_id,
               proyecto_id
             )
             VALUES (?, ?)`,
            [
              usuarioId,
              proyectoId,
            ]
          );
        }

        createdUsers.push({
          id: usuarioId,
          nombre: user.nombre,
          apellido: user.apellido,
          usuario_base:
            user.usuario_base,
          correo: user.correo,
        });
      }

      await connection.commit();
      transactionStarted = false;

      return res.status(201).json({
        code:
          "USER_ADMIN_BATCH_CREATED",

        mensaje:
          `${createdUsers.length} usuarios creados correctamente`,

        total:
          createdUsers.length,

        proyecto_principal: {
          id:
            proyectoPrincipalId,
          nombre:
            proyectoPrincipal.nombre,
          dominio:
            proyectoPrincipal.dominio,
        },

        proyectos:
          projectIds,

        usuarios:
          createdUsers,
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (_) {}
      }

      if (
        error?.code === "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          code:
            "BATCH_EMAIL_ALREADY_EXISTS",
          error:
            "Uno de los correos del lote ya está registrado",
        });
      }

      console.error(
        "Error creando lote administrativo:",
        error
      );

      return res.status(500).json({
        code:
          "USER_ADMIN_BATCH_CREATE_ERROR",
        error:
          "No se pudo crear el lote de usuarios",
      });
    } finally {
      connection.release();
    }
  }
);


module.exports = router;
