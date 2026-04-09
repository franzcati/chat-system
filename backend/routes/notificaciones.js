const express = require("express");
const router = express.Router();
const db = require("../db");

// Obtener chats silenciados del usuario
router.get("/silenciados/:usuarioId", async (req, res) => {
  try {
    const { usuarioId } = req.params;

    const [rows] = await db.query(
      `SELECT tipo, chat_id, silenciado
       FROM chat_silenciados
       WHERE usuario_id = ? AND silenciado = 1`,
      [usuarioId]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ Error obteniendo silencios:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Silenciar o desilenciar un chat
router.post("/silenciar", async (req, res) => {
  try {
    const { usuarioId, tipo, chatId, silenciado } = req.body;

    if (!usuarioId || !tipo || !chatId || typeof silenciado === "undefined") {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    await db.query(
      `INSERT INTO chat_silenciados (usuario_id, tipo, chat_id, silenciado)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE silenciado = VALUES(silenciado)`,
      [usuarioId, tipo, chatId, silenciado ? 1 : 0]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error silenciando chat:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = router;