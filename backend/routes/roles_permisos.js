const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT rol_id, permiso FROM roles_permisos ORDER BY rol_id, permiso");
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo permisos:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
