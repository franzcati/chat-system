const express = require("express");
const router = express.Router();
const pool = require("../db");

const {
  requireAuth,
} = require("../middleware/requireAuth");

const {
  resolveInstance,
} = require("../middleware/resolveInstance");


// ============================================================
// RUTA LEGACY DE PROYECTOS
//
// Se conserva únicamente GET /api/proyecto porque Messenger
// todavía lo utiliza para cargar proyectos.
//
// TODAS las operaciones administrativas deben usar:
//
// /api/proyecto/admin
// ============================================================

router.use(
  requireAuth,
  resolveInstance
);


// ============================================================
// LISTAR PROYECTOS ACTIVOS DE LA INSTANCIA ACTUAL
// GET /api/proyecto
//
// Mantiene el formato antiguo: devuelve directamente un array.
// ============================================================
router.get("/", async (req, res) => {
  try {
    const instanciaId =
      Number(req.instanciaActual.id);

    const [rows] = await pool.query(
      `SELECT
         id,
         nombre,
         descripcion
       FROM proyecto
       WHERE estado = 'activo'
         AND instancia_id = ?
       ORDER BY nombre ASC, id ASC`,
      [instanciaId]
    );

    return res.json(rows);
  } catch (error) {
    console.error(
      "Error cargando proyectos legacy:",
      error
    );

    return res.status(500).json({
      code: "LEGACY_PROJECT_LIST_ERROR",
      error:
        "No se pudieron cargar los proyectos",
    });
  }
});


// ============================================================
// ENDPOINT ANTIGUO DE PROYECTOS POR USUARIO
//
// Ya no se utiliza desde frontend.
// Se bloquea para evitar consultas no aisladas.
// ============================================================
router.get("/:usuarioId", (req, res) => {
  return res.status(410).json({
    code: "LEGACY_PROJECT_USER_ENDPOINT_DISABLED",
    error:
      "Este endpoint fue retirado. Utiliza las rutas administrativas actuales.",
  });
});


// ============================================================
// ESCRITURAS LEGACY DESHABILITADAS
//
// No deben poder saltarse:
// - instancia
// - validación de dominio
// - miembros
// - auditoría
// - permisos
// - cambio seguro de correos
// ============================================================

const legacyWriteDisabled = (req, res) => {
  return res.status(410).json({
    code: "LEGACY_PROJECT_WRITE_DISABLED",
    error:
      "La administración antigua de proyectos está deshabilitada. Utiliza /api/proyecto/admin.",
  });
};

router.post("/", legacyWriteDisabled);
router.put("/:id", legacyWriteDisabled);
router.patch("/:id", legacyWriteDisabled);
router.delete("/:id", legacyWriteDisabled);


module.exports = router;
