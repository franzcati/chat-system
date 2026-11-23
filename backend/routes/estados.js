const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const db = require('../db');
const { chatAuthMiddleware } = require('../middleware/chatRouteSecurity');
const { sendPrivateMessage } = require('./mensajes');
const { sendGroupMessage } = require('./mensajesGrupo');
const {
  MEDIA_TYPES, fail, groupId, statusId, canPublish, parsePublication, discardFile, publish, parsePresentation, readAppearance, validateGif,
} = require('../utils/estadoPublicacion');

const router = express.Router();
router.use(...chatAuthMiddleware);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const mediaDir = path.join(__dirname, '..', 'status-media');
fs.mkdirSync(mediaDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (_req, file, done) => done(null, `${randomUUID()}${MEDIA_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, done) => {
    if (Object.hasOwn(MEDIA_TYPES, file.mimetype)) return done(null, true);
    done(Object.assign(new Error('Formato de archivo no admitido'), { status: 415 }));
  },
}).single('archivo');

let nextCleanup = 0;
async function cleanExpired() {
  if (Date.now() < nextCleanup) return;
  nextCleanup = Date.now() + 30 * 60 * 1000;
  try {
    const [expired] = await db.query(`SELECT CAST(id AS CHAR) AS id, archivo FROM chat_estados
      WHERE vence_at<=UTC_TIMESTAMP(3) OR eliminado_at IS NOT NULL ORDER BY chat_estados.id LIMIT 100`);
    for (const entry of expired) {
      const [result] = await db.query(`DELETE FROM chat_estados WHERE id=CAST(? AS UNSIGNED)
        AND (vence_at<=UTC_TIMESTAMP(3) OR eliminado_at IS NOT NULL)`, [entry.id]);
      if (result.affectedRows && entry.archivo) {
        await discardFile({ path: path.join(mediaDir, path.basename(entry.archivo)) });
      }
    }
  } catch (error) {
    console.error('Limpieza de estados:', error.code || error.message);
  }
}

const personal = '(e.visible_instancia=1 OR (e.visible_instancia IS NULL AND e.grupo_id IS NULL))';
const eligibleGroup = `FROM usuario_grupo ug JOIN grupos g ON g.id=ug.grupo_id
  JOIN usuario owner ON owner.id=g.propietario_id
  WHERE ug.usuario_id=? AND owner.instancia_id=e.instancia_id`;
const audience = `(${personal} OR EXISTS (SELECT 1 ${eligibleGroup}
  AND ((e.visible_instancia IS NULL AND e.grupo_id=g.id)
    OR EXISTS (SELECT 1 FROM chat_estado_grupos dest
      WHERE dest.estado_id=e.id AND dest.grupo_id=g.id))))`;
const active = `e.instancia_id=? AND e.eliminado_at IS NULL AND e.vence_at>UTC_TIMESTAMP(3)
  AND autor.estado='aprobado'`;
const authorJoin = 'JOIN usuario autor ON autor.id=e.autor_id AND autor.instancia_id=e.instancia_id';

function reportError(res, error) {
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo supera 30 MB' });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Archivo inválido' });
  if (error.status) return res.status(error.status).json({ error: error.message });
  console.error('Estados:', error.code || error.message);
  return res.status(500).json({ error: 'No se pudo completar la operación' });
}

async function visible(req, database = db, lock = false) {
  const id = statusId(req.params.id);
  if (!id) return undefined;
  const [[row]] = await database.query(`SELECT CAST(e.id AS CHAR) AS id, e.autor_id,
      e.grupo_id, e.visible_instancia, e.texto, e.archivo, e.mime
    FROM chat_estados e ${authorJoin}
    WHERE e.id=CAST(? AS UNSIGNED) AND ${active} AND ${audience}
    LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, [id, req.instanciaActual.id, req.auth.userId]);
  return row;
}

router.get('/', async (req, res) => {
  try {
    void cleanExpired();
    const modern = req.get('X-Estados-Contrato') === '2';
    const destinations = modern ? `, COALESCE(${personal}, 0) AS personal,
      (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', g.id, 'nombre', g.nombre, 'imagen_url', g.imagen_url)) ${eligibleGroup}
        AND EXISTS (SELECT 1 FROM chat_estado_grupos dest WHERE dest.estado_id=e.id AND dest.grupo_id=g.id)
      ) AS grupos_visibles,
      EXISTS (SELECT 1 FROM chat_estado_reacciones r
        WHERE r.estado_id=e.id AND r.usuario_id=?) AS reaccion_propia` : '';
    const [rows] = await db.query(`SELECT ${modern ? 'CAST(e.id AS CHAR) AS id' : 'e.id'},
      e.autor_id, e.grupo_id, e.tipo, e.texto, e.fondo, e.apariencia, e.leyenda, e.creado_at, e.vence_at,
      autor.nombre, autor.apellido, autor.url_imagen, legacy.nombre AS grupo_nombre, legacy.imagen_url AS grupo_imagen_url,
      (v.usuario_id IS NOT NULL) AS visto,
      (SELECT COUNT(*) FROM chat_estado_vistas cv WHERE cv.estado_id=e.id) AS vistas ${destinations}
      FROM chat_estados e ${authorJoin}
      LEFT JOIN grupos legacy ON legacy.id=e.grupo_id
      LEFT JOIN chat_estado_vistas v ON v.estado_id=e.id AND v.usuario_id=?
      WHERE ${active} AND ${audience} ${modern ? '' : 'AND e.visible_instancia IS NULL'}
      ORDER BY e.creado_at DESC, e.id DESC LIMIT 300`,
    [...(modern ? [req.auth.userId, req.auth.userId] : []), req.auth.userId, req.instanciaActual.id, req.auth.userId]);
    const estados = rows.map(({ personal: own, grupos_visibles, apariencia, reaccion_propia, ...row }) => ({
      ...row,
      apariencia: readAppearance(apariencia),
      ...(modern && {
        reaccion_propia: Boolean(reaccion_propia),
        destinos: {
          mi_estado: Boolean(own),
          grupos: row.grupo_id
            ? [{ id: row.grupo_id, nombre: row.grupo_nombre, imagen_url: row.grupo_imagen_url }]
            : (typeof grupos_visibles === 'string' ? JSON.parse(grupos_visibles) : grupos_visibles) || [],
        },
      }),
    }));
    res.json({ estados, puede_publicar: canPublish(req.auth.usuario.permisos_chat) });
  } catch (error) { reportError(res, error); }
});

router.get('/grupos', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT g.id, g.nombre, g.imagen_url, ug.rol,
      (SELECT COUNT(DISTINCT miembro.usuario_id) FROM usuario_grupo miembro
        JOIN usuario u ON u.id=miembro.usuario_id
        WHERE miembro.grupo_id=g.id AND u.instancia_id=owner.instancia_id AND u.estado='aprobado'
      ) AS miembros_cantidad
      FROM usuario_grupo ug
      JOIN grupos g ON g.id=ug.grupo_id JOIN usuario owner ON owner.id=g.propietario_id
      WHERE ug.usuario_id=? AND owner.instancia_id=?
        AND ug.rol IN ('propietario','admin') ORDER BY g.nombre LIMIT 200`,
    [req.auth.userId, req.instanciaActual.id]);
    res.json({ grupos: rows });
  } catch (error) { reportError(res, error); }
});

router.post('/', (req, res, next) => {
  if (!canPublish(req.auth.usuario.permisos_chat)) {
    return res.status(403).json({ error: 'No tienes permiso para publicar estados' });
  }
  upload(req, res, error => error ? reportError(res, error) : next());
}, async (req, res) => {
  let file = req.file;
  try {
    const body = req.body || {};
    const publication = parsePublication(body, req.get('Idempotency-Key'));
    if (publication.modern && process.env.ESTADOS_MULTIDESTINO !== '1') {
      fail(503, 'La publicación multidestino aún no está habilitada');
    }
    const text = String(body.texto || '').trim().slice(0, 700);
    if (!text && !file) fail(400, 'Escribe un estado o selecciona una foto o video');
    const color = typeof body.fondo === 'string' && /^#[0-9a-f]{6}$/i.test(body.fondo) ? body.fondo : '#1d3e70';
    const { appearance, caption } = parsePresentation(body, Boolean(file));
    await validateGif(file);
    const uploadFile = file;
    file = null; // Desde aquí publish se encarga del archivo, incluido un commit incierto.
    const { id, replayed } = await publish(db, {
      instance: req.instanciaActual.id, actor: req.auth.userId, publication, text, color, file: uploadFile, appearance, caption,
    });
    res.status(replayed ? 200 : 201).json({ id });
  } catch (error) {
    await discardFile(file);
    reportError(res, error);
  }
});

router.get('/:id/media', async (req, res) => {
  try {
    const status = await visible(req);
    if (!status?.archivo) return res.status(404).end();
    res.set('Content-Type', status.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(path.join(mediaDir, path.basename(status.archivo)));
  } catch (error) { reportError(res, error); }
});

router.post('/:id/vista', async (req, res) => {
  try {
    const id = statusId(req.params.id);
    if (!id) fail(404, 'Estado no disponible');
    const [result] = await db.query(`INSERT INTO chat_estado_vistas (estado_id, usuario_id)
      SELECT e.id, ? FROM chat_estados e ${authorJoin}
      WHERE e.id=CAST(? AS UNSIGNED) AND ${active} AND ${audience}
      ON DUPLICATE KEY UPDATE visto_at=chat_estado_vistas.visto_at`,
    [req.auth.userId, id, req.instanciaActual.id, req.auth.userId]);
    if (!result.affectedRows && !(await visible(req))) fail(404, 'Estado no disponible');
    res.json({ ok: true });
  } catch (error) { reportError(res, error); }
});

async function inStatusTransaction(callback) {
  const connection = await db.getConnection();
  let destroyed = false;
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {
      connection.destroy();
      destroyed = true;
    }
    throw error;
  } finally {
    if (!destroyed) connection.release();
  }
}

router.put('/:id/reaccion', async (req, res) => {
  try {
    const reacted = req.body?.reaccion;
    if (typeof reacted !== 'boolean') fail(400, 'Indica si quieres añadir o quitar el corazón');

    await inStatusTransaction(async connection => {
      const status = await visible(req, connection, true);
      if (!status) fail(404, 'Estado no disponible');
      if (Number(status.autor_id) === req.auth.userId) fail(403, 'No puedes reaccionar a tu propio estado');
      const params = [status.id, req.auth.userId];
      if (reacted) {
        await connection.query(`INSERT INTO chat_estado_reacciones (estado_id, usuario_id)
          VALUES (CAST(? AS UNSIGNED), ?)
          ON DUPLICATE KEY UPDATE creado_at=chat_estado_reacciones.creado_at`, params);
      } else {
        await connection.query(`DELETE FROM chat_estado_reacciones
          WHERE estado_id=CAST(? AS UNSIGNED) AND usuario_id=?`, params);
      }
    });

    res.json({ reaccion_propia: reacted });
  } catch (error) { reportError(res, error); }
});

async function assertDestination(req, status, destination, database = db, lock = false) {
  if (!status) fail(404, 'Estado no disponible');
  if (destination?.tipo === 'personal' && !Object.hasOwn(destination, 'grupo_id')) {
    if (status.visible_instancia === 1 || (status.visible_instancia === null && status.grupo_id === null)) {
      return null;
    }
    fail(404, 'Estado no disponible en ese destino');
  }
  const group = destination?.tipo === 'grupo' ? groupId(destination.grupo_id) : null;
  if (!group) fail(400, 'Selecciona el destino de la respuesta');
  const [[membership]] = await database.query(`SELECT g.id FROM chat_estados e
    JOIN usuario_grupo ug ON ug.usuario_id=?
    JOIN grupos g ON g.id=ug.grupo_id
    JOIN usuario owner ON owner.id=g.propietario_id AND owner.instancia_id=e.instancia_id
    WHERE e.id=CAST(? AS UNSIGNED) AND g.id=?
      AND ((e.visible_instancia IS NULL AND e.grupo_id=g.id)
        OR EXISTS (SELECT 1 FROM chat_estado_grupos dest
          WHERE dest.estado_id=e.id AND dest.grupo_id=g.id))
    LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, [req.auth.userId, status.id, group]);
  if (!membership) fail(404, 'Estado no disponible en ese destino');
  return group;
}

router.post('/:id/responder', async (req, res) => {
  try {
    const status = await visible(req);
    if (!status) fail(404, 'Estado no disponible');
    const { mensaje, destino = status.visible_instancia === null && status.grupo_id
      ? { tipo: 'grupo', grupo_id: status.grupo_id } : null } = req.body || {};
    if (typeof mensaje !== 'string' || !mensaje.trim()) fail(400, 'Escribe una respuesta');
    const group = await assertDestination(req, status, destino);
    const label = group ? 'Estado del grupo' : 'Estado';
    const content = `↪ ${label} #${status.id}${status.texto ? ` · ${status.texto.slice(0, 80)}` : ''}\n${mensaje.trim().slice(0, 2000)}`;
    req.body = group ? { grupoId: group, mensaje: content }
      : { receiverId: Number(status.autor_id), message: content };

    const persist = (sql, params) => inStatusTransaction(async connection => {
      await assertDestination(req, await visible(req, connection, true), destino, connection, true);
      return connection.query(sql, params);
    });
    await (group ? sendGroupMessage : sendPrivateMessage)(req, res, persist);
  } catch (error) { reportError(res, error); }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = statusId(req.params.id);
    if (!id) fail(404, 'Estado no encontrado');
    const [result] = await db.query(`UPDATE chat_estados SET eliminado_at=UTC_TIMESTAMP(3)
      WHERE id=CAST(? AS UNSIGNED) AND instancia_id=? AND autor_id=? AND eliminado_at IS NULL`,
    [id, req.instanciaActual.id, req.auth.userId]);
    if (!result.affectedRows) fail(404, 'Estado no encontrado');
    res.json({ ok: true });
  } catch (error) { reportError(res, error); }
});

module.exports = router;
