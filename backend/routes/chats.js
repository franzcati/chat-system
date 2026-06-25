const express = require('express');
const router = express.Router();
const db = require('../db');


let chatEstadosSchemaReady = false;

const ensureChatEstadosSchema = async () => {
  if (chatEstadosSchemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS chats_estados (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      chat_id INT NOT NULL,
      archivado TINYINT(1) DEFAULT 0,
      marcado_no_leido TINYINT(1) DEFAULT 0,
      fijado TINYINT(1) DEFAULT 0,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_chat_estado (usuario_id, tipo, chat_id)
    )
  `);


  const [fijadoColumns] = await db.query("SHOW COLUMNS FROM chats_estados LIKE 'fijado'");
  if (!fijadoColumns.length) {
    await db.query("ALTER TABLE chats_estados ADD COLUMN fijado TINYINT(1) DEFAULT 0 AFTER marcado_no_leido");
  }

  chatEstadosSchemaReady = true;
};

let chatListasSchemaReady = false;

const ensureChatListasSchema = async () => {
  if (chatListasSchemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_listas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      nombre VARCHAR(80) NOT NULL,
      emoji VARCHAR(16) DEFAULT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_chat_listas_usuario (usuario_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_lista_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lista_id INT NOT NULL,
      usuario_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      chat_id INT NOT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_lista_chat (lista_id, tipo, chat_id),
      INDEX idx_chat_lista_items_usuario (usuario_id),
      CONSTRAINT fk_chat_lista_items_lista
        FOREIGN KEY (lista_id) REFERENCES chat_listas(id)
        ON DELETE CASCADE
    )
  `);

  chatListasSchemaReady = true;
};

const normalizeChatListName = (value = '') => String(value || '').trim().slice(0, 80);

const getChatListasPayload = async (usuarioId) => {
  await ensureChatListasSchema();

  const [listas] = await db.query(
    `SELECT id, usuario_id, nombre, emoji, creado_en, actualizado_en
     FROM chat_listas
     WHERE usuario_id = ?
     ORDER BY actualizado_en DESC, id DESC`,
    [usuarioId]
  );

  if (!listas.length) return [];

  const [items] = await db.query(
    `SELECT id, lista_id, usuario_id, tipo, chat_id, creado_en
     FROM chat_lista_items
     WHERE usuario_id = ? AND lista_id IN (?)
     ORDER BY id ASC`,
    [usuarioId, listas.map((lista) => lista.id)]
  );

  const itemsByList = new Map();
  items.forEach((item) => {
    const key = Number(item.lista_id);
    if (!itemsByList.has(key)) itemsByList.set(key, []);
    itemsByList.get(key).push({
      id: item.id,
      tipo: item.tipo,
      chat_id: Number(item.chat_id),
      creado_en: item.creado_en,
    });
  });

  return listas.map((lista) => ({
    ...lista,
    id: Number(lista.id),
    items: itemsByList.get(Number(lista.id)) || [],
  }));
};

// Listas personalizadas tipo WhatsApp
router.get('/listas/:usuarioId', async (req, res) => {
  try {
    const listas = await getChatListasPayload(req.params.usuarioId);
    res.json(listas);
  } catch (err) {
    console.error('❌ Error obteniendo listas de chats:', err);
    res.status(500).json({ error: 'Error obteniendo listas de chats' });
  }
});

router.post('/listas', async (req, res) => {
  const { usuarioId, nombre, emoji = null, items = [] } = req.body || {};
  const cleanName = normalizeChatListName(nombre);

  if (!usuarioId || !cleanName) {
    return res.status(400).json({ error: 'Faltan usuarioId o nombre de lista' });
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    await ensureChatListasSchema();

    const [result] = await conn.query(
      'INSERT INTO chat_listas (usuario_id, nombre, emoji) VALUES (?, ?, ?)',
      [usuarioId, cleanName, emoji ? String(emoji).slice(0, 16) : null]
    );

    const listaId = result.insertId;
    const cleanItems = Array.isArray(items)
      ? items
          .map((item) => ({
            tipo: item?.tipo === 'grupo' ? 'grupo' : 'privado',
            chatId: Number(item?.chatId ?? item?.chat_id),
          }))
          .filter((item) => item.chatId > 0)
      : [];

    for (const item of cleanItems) {
      await conn.query(
        `INSERT IGNORE INTO chat_lista_items (lista_id, usuario_id, tipo, chat_id)
         VALUES (?, ?, ?, ?)`,
        [listaId, usuarioId, item.tipo, item.chatId]
      );
    }

    await conn.commit();
    const listas = await getChatListasPayload(usuarioId);
    res.json({ success: true, lista: listas.find((lista) => Number(lista.id) === Number(listaId)), listas });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error creando lista de chats:', err);
    res.status(500).json({ error: 'Error creando lista de chats' });
  } finally {
    conn.release();
  }
});

router.put('/listas/:listaId', async (req, res) => {
  const { listaId } = req.params;
  const { usuarioId, nombre, emoji, items } = req.body || {};
  const cleanName = typeof nombre === 'undefined' ? null : normalizeChatListName(nombre);

  if (!usuarioId || !listaId) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    await ensureChatListasSchema();

    if (cleanName !== null && cleanName) {
      await conn.query(
        'UPDATE chat_listas SET nombre = ?, emoji = COALESCE(?, emoji) WHERE id = ? AND usuario_id = ?',
        [cleanName, typeof emoji === 'undefined' ? null : String(emoji || '').slice(0, 16), listaId, usuarioId]
      );
    }

    if (Array.isArray(items)) {
      await conn.query('DELETE FROM chat_lista_items WHERE lista_id = ? AND usuario_id = ?', [listaId, usuarioId]);

      for (const item of items) {
        const tipo = item?.tipo === 'grupo' ? 'grupo' : 'privado';
        const chatId = Number(item?.chatId ?? item?.chat_id);
        if (!chatId) continue;
        await conn.query(
          `INSERT IGNORE INTO chat_lista_items (lista_id, usuario_id, tipo, chat_id)
           VALUES (?, ?, ?, ?)`,
          [listaId, usuarioId, tipo, chatId]
        );
      }
    }

    await conn.commit();
    const listas = await getChatListasPayload(usuarioId);
    res.json({ success: true, listas });
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error actualizando lista de chats:', err);
    res.status(500).json({ error: 'Error actualizando lista de chats' });
  } finally {
    conn.release();
  }
});

router.delete('/listas/:listaId', async (req, res) => {
  const { listaId } = req.params;
  const { usuarioId } = req.body || {};

  if (!usuarioId || !listaId) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  try {
    await ensureChatListasSchema();
    await db.query('DELETE FROM chat_listas WHERE id = ? AND usuario_id = ?', [listaId, usuarioId]);
    const listas = await getChatListasPayload(usuarioId);
    res.json({ success: true, listas });
  } catch (err) {
    console.error('❌ Error eliminando lista de chats:', err);
    res.status(500).json({ error: 'Error eliminando lista de chats' });
  }
});

// Información de contacto para panel lateral tipo WhatsApp
router.get('/contacto-info/:miUsuarioId/:contactoId', async (req, res) => {
  const { miUsuarioId, contactoId } = req.params;

  try {
    const [usuarios] = await db.query(
      `SELECT id, nombre, apellido, correo, url_imagen, background
       FROM usuario
       WHERE id = ?
       LIMIT 1`,
      [contactoId]
    );

    if (!usuarios.length) {
      return res.status(404).json({ error: 'Contacto no encontrado' });
    }

    const [archivos] = await db.query(
      `SELECT id, sender_id AS usuario_id, receiver_id, nombre_archivo, archivo_url, tipo_archivo, tamano, fecha_envio,
              CASE WHEN tipo_archivo LIKE 'image/%' THEN 'imagen' ELSE 'documento' END AS tipo
       FROM mensajes_archivos
       WHERE (sender_id = ? AND receiver_id = ?)
          OR (sender_id = ? AND receiver_id = ?)
       ORDER BY fecha_envio DESC, id DESC`,
      [miUsuarioId, contactoId, contactoId, miUsuarioId]
    );

    const [gruposComunes] = await db.query(
      `SELECT g.id AS grupo_id, g.nombre, g.imagen_url, g.descripcion,
              (SELECT COUNT(*) FROM usuario_grupo ugc WHERE ugc.grupo_id = g.id) AS total_miembros
       FROM grupos g
       JOIN usuario_grupo ug1 ON ug1.grupo_id = g.id AND ug1.usuario_id = ?
       JOIN usuario_grupo ug2 ON ug2.grupo_id = g.id AND ug2.usuario_id = ?
       ORDER BY g.nombre ASC`,
      [miUsuarioId, contactoId]
    );

    res.json({
      usuario: usuarios[0],
      archivos,
      grupos_comunes: gruposComunes,
    });
  } catch (err) {
    console.error('❌ Error obteniendo info del contacto:', err);
    res.status(500).json({ error: 'Error obteniendo info del contacto' });
  }
});

// Obtener estados personalizados de chats: archivado / marcado como no leído
router.get('/estados/:usuarioId', async (req, res) => {
  try {
    await ensureChatEstadosSchema();

    const { usuarioId } = req.params;
    const [rows] = await db.query(
      `SELECT tipo, chat_id, archivado, marcado_no_leido, fijado
       FROM chats_estados
       WHERE usuario_id = ?`,
      [usuarioId]
    );

    res.json(rows);
  } catch (err) {
    console.error('❌ Error obteniendo estados de chats:', err);
    res.status(500).json({ error: 'Error obteniendo estados de chats' });
  }
});

// Actualizar estado personalizado de un chat
router.post('/estado', async (req, res) => {
  try {
    await ensureChatEstadosSchema();

    const { usuarioId, tipo, chatId, archivado, marcadoNoLeido, fijado } = req.body;

    if (!usuarioId || !tipo || !chatId) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }

    const [existingRows] = await db.query(
      `SELECT archivado, marcado_no_leido, fijado
       FROM chats_estados
       WHERE usuario_id = ? AND tipo = ? AND chat_id = ?
       LIMIT 1`,
      [usuarioId, tipo, chatId]
    );

    const current = existingRows[0] || { archivado: 0, marcado_no_leido: 0, fijado: 0 };
    const nextArchivado = typeof archivado === 'undefined' ? current.archivado : (archivado ? 1 : 0);
    const nextMarcadoNoLeido = typeof marcadoNoLeido === 'undefined'
      ? current.marcado_no_leido
      : (marcadoNoLeido ? 1 : 0);
    const nextFijado = typeof fijado === 'undefined'
      ? current.fijado
      : (fijado ? 1 : 0);

    await db.query(
      `INSERT INTO chats_estados (usuario_id, tipo, chat_id, archivado, marcado_no_leido, fijado)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         archivado = VALUES(archivado),
         marcado_no_leido = VALUES(marcado_no_leido),
         fijado = VALUES(fijado),
         actualizado_en = CURRENT_TIMESTAMP`,
      [usuarioId, tipo, chatId, nextArchivado, nextMarcadoNoLeido, nextFijado]
    );

    res.json({
      success: true,
      tipo,
      chat_id: Number(chatId),
      archivado: nextArchivado,
      marcado_no_leido: nextMarcadoNoLeido,
      fijado: nextFijado,
    });
  } catch (err) {
    console.error('❌ Error actualizando estado de chat:', err);
    res.status(500).json({ error: 'Error actualizando estado de chat' });
  }
});

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
          COALESCE(ma_direct.archivo_url, ma_lote.archivo_url) AS archivo_url,
          COALESCE(ma_direct.tipo_archivo, ma_lote.tipo_archivo) AS tipo_archivo,
          COALESCE(ma_direct.nombre_archivo, ma_lote.nombre_archivo) AS nombre_archivo,
          COALESCE(ma_direct.tamano, ma_lote.tamano) AS tamano,

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
      LEFT JOIN mensajes_archivos ma_direct
        ON ma_direct.sender_id = m.usuario_envia_id
       AND ma_direct.receiver_id = m.usuario_recibe_id
       AND ma_direct.archivo_url = m.mensaje
      LEFT JOIN (
        SELECT lote_id, sender_id, receiver_id, MIN(id) AS first_file_id
        FROM mensajes_archivos
        WHERE lote_id IS NOT NULL
        GROUP BY lote_id, sender_id, receiver_id
      ) ma_idx
        ON ma_idx.lote_id = m.lote_id
       AND ma_idx.sender_id = m.usuario_envia_id
       AND ma_idx.receiver_id = m.usuario_recibe_id
      LEFT JOIN mensajes_archivos ma_lote
        ON ma_lote.id = ma_idx.first_file_id
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
  const { search = "" } = req.query;
  const searchLike = `%${search}%`;

  try {
    const [rows] = await db.query(
      `
      SELECT *
      FROM (
        -- Permite que el usuario se encuentre a si mismo para iniciar su chat personal.
        SELECT
          u.id,
          u.nombre,
          u.apellido,
          u.correo,
          u.url_imagen,
          u.background,
          1 AS es_tu
        FROM usuario u
        WHERE u.id = ?
          AND CONCAT(u.nombre, ' ', u.apellido) LIKE ?

        UNION

        -- Usuarios de proyectos comunes que aun no tienen chat privado abierto.
        SELECT DISTINCT
          u.id,
          u.nombre,
          u.apellido,
          u.correo,
          u.url_imagen,
          u.background,
          0 AS es_tu
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
      ) AS resultados
      ORDER BY es_tu DESC, nombre ASC, apellido ASC
      LIMIT 30
      `,
      [
        miUsuarioId,
        searchLike,
        miUsuarioId,
        miUsuarioId,
        searchLike,
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