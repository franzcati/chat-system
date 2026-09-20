const express = require("express");

const router = express.Router();

router.post("/", (_req, res) => {
  return res.status(410).json({
    code: "LEGACY_SIGNUP_DISABLED",
    error:
      "El registro publico fue deshabilitado. Usa Gestion de Usuarios.",
  });
});

module.exports = router;
