const express = require("express");
const router = express.Router();
const db = require("../db");
const { queryWithRetry } = require("../utils/dbRetry");

let silenciosSchemaPromise = null;

const ensureSilenciosSchema = async () => {
  if (!silenciosSchemaPromise) {
    silenciosSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS chat_silenciados (
          id INT AUTO_INCREMENT PRIMARY KEY,
          usuario_id INT NOT NULL,
          tipo VARCHAR(20) NOT NULL,
          chat_id INT NOT NULL,
          silenciado TINYINT(1) DEFAULT 0,
          silenciado_hasta DATETIME NULL,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_chat_silenciado (usuario_id, tipo, chat_id)
        )
      `);

      try {
        await db.query("ALTER TABLE chat_silenciados ADD COLUMN silenciado_hasta DATETIME NULL");
      } catch (err) {
        if (err.code !== "ER_DUP_FIELDNAME") throw err;
      }

      try {
        await db.query("ALTER TABLE chat_silenciados ADD COLUMN actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
      } catch (err) {
        if (err.code !== "ER_DUP_FIELDNAME") throw err;
      }
    })().catch((err) => {
      silenciosSchemaPromise = null;
      throw err;
    });
  }

  return silenciosSchemaPromise;
};

const getMuteUntil = (duracion) => {
  if (!duracion || duracion === "always") return null;

  const until = new Date();
  if (duracion === "8h") until.setHours(until.getHours() + 8);
  else if (duracion === "1w") until.setDate(until.getDate() + 7);
  else return null;

  return until.toISOString().slice(0, 19).replace("T", " ");
};

// Obtener chats silenciados del usuario
router.get("/silenciados/:usuarioId", async (req, res) => {
  try {
    await ensureSilenciosSchema();

    const { usuarioId } = req.params;

    // Esta ruta es de lectura. No actualizamos silencios vencidos aquí porque
    // varios clientes pueden consultar al mismo tiempo y competir por el mismo row lock.
    // Los vencidos simplemente se excluyen de la respuesta.
    const [rows] = await queryWithRetry(
      db,
      `SELECT tipo, chat_id, silenciado, silenciado_hasta
       FROM chat_silenciados
       WHERE usuario_id = ?
         AND silenciado = 1
         AND (silenciado_hasta IS NULL OR silenciado_hasta > NOW())`,
      [usuarioId],
      { attempts: 4, label: "obtener silencios activos" }
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
    await ensureSilenciosSchema();

    const { usuarioId, tipo, chatId, silenciado, duracion } = req.body;

    if (!usuarioId || !tipo || !chatId || typeof silenciado === "undefined") {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const silenciadoHasta = silenciado ? getMuteUntil(duracion) : null;

    await queryWithRetry(
      db,
      `INSERT INTO chat_silenciados (usuario_id, tipo, chat_id, silenciado, silenciado_hasta)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         silenciado = VALUES(silenciado),
         silenciado_hasta = VALUES(silenciado_hasta),
         actualizado_en = CURRENT_TIMESTAMP`,
      [usuarioId, tipo, chatId, silenciado ? 1 : 0, silenciadoHasta],
      { attempts: 4, label: "actualizar silencio de chat" }
    );

    res.json({ success: true, silenciado: silenciado ? 1 : 0, silenciado_hasta: silenciadoHasta });
  } catch (err) {
    console.error("❌ Error silenciando chat:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = router;
