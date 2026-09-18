const express = require("express");
const router = express.Router();

const {
  requireAuth,
} = require("../middleware/requireAuth");


// ============================================================
// RUTA LEGACY DE CREACION MASIVA
//
// La creación actual debe utilizar:
//
// POST /api/usuarios/admin/batch
//
// Se conserva la ruta antigua únicamente para responder
// claramente a clientes obsoletos. Ya no crea usuarios.
// ============================================================

router.use(requireAuth);

router.post("/batch", (req, res) => {
  return res.status(410).json({
    code: "LEGACY_BATCH_USERS_DISABLED",
    error:
      "La creación masiva antigua está deshabilitada. Utiliza /api/usuarios/admin/batch.",
  });
});


module.exports = router;
