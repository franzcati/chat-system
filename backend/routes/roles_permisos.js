const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM roles_permisos");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error obteniendo permisos:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
