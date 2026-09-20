const express = require("express");

const router = express.Router();

function legacyMessagesDisabled(_req, res) {
  return res.status(410).json({
    code: "LEGACY_MESSAGES_DISABLED",
    error:
      "Esta ruta de prueba fue deshabilitada.",
  });
}

router.get("/", legacyMessagesDisabled);
router.post("/", legacyMessagesDisabled);

module.exports = router;
