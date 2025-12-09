const express = require('express');
const router = express.Router();
const db = require('../db');

// Obtener la lista de chats de un usuario
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT 
          m.id,
          m.mensaje,
          m.fecha_envio, 
          m.usuario_envia_id,
          m.usuario_recibe_id,
          m.eliminado,
          m.editado,

          -- Datos del emisor
          u_env.id AS emisor_id,
          CONCAT(u_env.nombre, ' ', u_env.apellido) AS emisor_nombre,
          u_env.correo AS emisor_correo,
          u_env.url_imagen AS emisor_avatar,
          u_env.background AS emisor_background,
          

          -- Datos del receptor
          u_rec.id AS receptor_id,
          CONCAT(u_rec.nombre, ' ', u_rec.apellido) AS receptor_nombre,
          u_rec.correo AS receptor_correo,
          u_rec.url_imagen AS receptor_avatar,
          u_rec.background AS receptor_background,
          

          m.visto,
          CASE 
            WHEN m.usuario_envia_id = ? THEN 'enviado'
            ELSE 'recibido'
          END AS tipo_mensaje
      FROM mensajes m
      JOIN usuario u_env ON m.usuario_envia_id = u_env.id
      JOIN usuario u_rec ON m.usuario_recibe_id = u_rec.id
      WHERE m.usuario_envia_id = ? OR m.usuario_recibe_id = ?
      ORDER BY m.fecha_envio DESC`,
      [userId, userId, userId]
    );

    res.json(rows);
  } catch (error) {
    console.error('❌ Error obteniendo chats:', error);
    res.status(500).json({ error: 'Error obteniendo chats' });
  }
});

// GET /api/favoritos/:usuarioId
router.get("/favoritos/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT * FROM chats_favoritos WHERE usuario_id = ?",
      [usuarioId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/favoritos
router.post("/favoritos", async (req, res) => {
  const { usuarioId, chatId, tipo } = req.body;
  try {
    await db.query(
      "INSERT INTO chats_favoritos (usuario_id, chat_id, tipo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE creado_en = CURRENT_TIMESTAMP",
      [usuarioId, chatId, tipo]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/favoritos
router.delete("/favoritos", async (req, res) => {
  const { usuarioId, chatId, tipo } = req.body;
  try {
    await db.query(
      "DELETE FROM chats_favoritos WHERE usuario_id = ? AND chat_id = ? AND tipo = ?",
      [usuarioId, chatId, tipo]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/usuarios/comunes/:miUsuarioId", async (req, res) => {
  const { miUsuarioId } = req.params;
  const { search } = req.query;

  try {
    const [rows] = await db.query(
      `
      SELECT DISTINCT u.id, u.nombre, u.apellido, u.url_imagen, u.background
      FROM usuario u
      INNER JOIN usuario_proyecto up ON u.id = up.usuario_id
      INNER JOIN usuario_proyecto up2 ON up.proyecto_id = up2.proyecto_id
      WHERE up2.usuario_id = ? 
        AND u.id != ?
        AND CONCAT(u.nombre, ' ', u.apellido) LIKE ?
        AND u.id NOT IN (
          SELECT 
            CASE
              WHEN m.usuario_envia_id = ? THEN m.usuario_recibe_id
              ELSE m.usuario_envia_id
            END
          FROM mensajes m
          WHERE (m.usuario_envia_id = ? OR m.usuario_recibe_id = ?)
        )
      `,
      [
        miUsuarioId,
        miUsuarioId,
        `%${search}%`,
        miUsuarioId,
        miUsuarioId,
        miUsuarioId,
      ]
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener usuarios comunes" });
  }
});

module.exports = router;