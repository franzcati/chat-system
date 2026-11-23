const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { open, unlink } = require('node:fs/promises');

const MEDIA_TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm',
};

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function groupId(value) {
  return /^\d{1,10}$/.test(String(value)) && Number(value) > 0 && Number(value) <= 2147483647
    && ['number', 'string'].includes(typeof value) ? Number(value) : null;
}

function statusId(value) {
  return /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n ? value : null;
}

function canPublish(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return false; }
  }
  return [1, true, '1', 'true'].includes(value?.publicar_estados);
}

function parsePublication(body, key) {
  const modern = Object.hasOwn(body, 'destinos');
  if (!modern) {
    const group = body.grupo_id == null || body.grupo_id === '' ? null : groupId(body.grupo_id);
    if (body.grupo_id != null && body.grupo_id !== '' && !group) fail(400, 'Grupo inválido');
    if (key !== undefined) fail(400, 'Idempotency-Key requiere destinos');
    return { modern, personal: !group, groups: group ? [group] : [] };
  }

  if (Object.hasOwn(body, 'grupo_id')) fail(400, 'Envía únicamente destinos');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) {
    fail(400, 'Idempotency-Key inválida o ausente');
  }

  let destinations = body.destinos;
  if (typeof destinations === 'string') {
    try { destinations = JSON.parse(destinations); } catch { fail(400, 'Destinos inválidos'); }
  }
  if (typeof destinations?.mi_estado !== 'boolean' || !Array.isArray(destinations.grupos)
    || destinations.grupos.length > 200) fail(400, 'Destinos inválidos');
  const groups = [...new Set(destinations.grupos.map(groupId))].sort((a, b) => a - b);
  if (groups.includes(null) || (!destinations.mi_estado && !groups.length)) {
    fail(400, 'Selecciona al menos un destino válido');
  }
  return { modern, personal: destinations.mi_estado, groups, key };
}

const palettes = new Set(['aurora', 'oceano', 'jade', 'coral', 'ambar', 'sol', 'violeta', 'rosa']);
const alignments = new Set(['left', 'center', 'right']);

function parsePresentation(body, hasFile) {
  const hasStyle = Object.hasOwn(body, 'apariencia');
  const caption = body.leyenda ?? '';
  if (typeof caption !== 'string' || caption.length > 700) fail(400, 'Leyenda inválida');
  if (hasFile && (hasStyle || caption.trim())) fail(400, 'La apariencia y la leyenda adicional son para estados de texto');
  if (!hasStyle) return { appearance: null, caption: caption.trim() || null };

  let style = body.apariencia;
  if (typeof style === 'string') {
    try { style = JSON.parse(style); } catch { fail(400, 'Formato de texto inválido'); }
  }
  if (!palettes.has(style?.paleta) || !alignments.has(style.alineacion)
    || !['light', 'dark'].includes(style.tema)
    || ![style.negrita, style.cursiva, style.subrayado].every(value => typeof value === 'boolean')) {
    fail(400, 'Formato de texto inválido');
  }
  const { paleta, alineacion, tema, negrita, cursiva, subrayado } = style;
  return {
    appearance: JSON.stringify({ paleta, alineacion, tema, negrita, cursiva, subrayado }),
    caption: caption.trim() || null,
  };
}

async function validateGif(file) {
  if (file?.mimetype !== 'image/gif') return;
  const handle = await open(file.path, 'r');
  try {
    const header = Buffer.alloc(13);
    const { bytesRead } = await handle.read(header);
    const signature = header.toString('ascii', 0, 6);
    if (bytesRead !== header.length || !['GIF87a', 'GIF89a'].includes(signature)
      || !header.readUInt16LE(6) || !header.readUInt16LE(8)) fail(415, 'El archivo no es un GIF válido');
  } finally {
    await handle.close();
  }
}

function readAppearance(value) {
  if (!value) return null;
  try { return JSON.parse(parsePresentation({ apariencia: value }, false).appearance); }
  catch { return null; }
}

async function fingerprint(publication, text, color, file, appearance, caption) {
  let bytes = null;
  if (file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file.path)) hash.update(chunk);
    bytes = [file.mimetype, hash.digest('hex')];
  }
  const content = [publication.personal, publication.groups, text, color, bytes];
  if (appearance || caption) content.push(appearance, caption);
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

async function discardFile(file) {
  if (file) await unlink(file.path).catch(error => {
    if (error.code !== 'ENOENT') console.error('Limpieza de archivo de estado:', error.code);
  });
}

async function publish(db, { instance, actor, publication, text, color, file, appearance = null, caption = null }) {
  let connection;
  let mayBeReferenced = false;
  let transactionStarted = false;
  try {
    const hash = publication.modern ? await fingerprint(publication, text, color, file, appearance, caption) : null;
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // El bloqueo del autor también serializa reintentos de la misma cuenta.
    const [[author]] = await connection.query(`SELECT permisos_chat FROM usuario
      WHERE id=? AND instancia_id=? AND estado='aprobado' FOR UPDATE`, [actor, instance]);
    if (!canPublish(author?.permisos_chat)) fail(403, 'No tienes permiso para publicar estados');

    if (publication.modern) {
      const [[existing]] = await connection.query(`SELECT CAST(id AS CHAR) AS id, huella_envio,
        (eliminado_at IS NULL AND vence_at > UTC_TIMESTAMP(3)) AS activo
        FROM chat_estados WHERE instancia_id=? AND autor_id=? AND clave_envio=? FOR UPDATE`,
      [instance, actor, publication.key]);
      if (existing) {
        if (existing.huella_envio !== hash || !existing.activo) fail(409, 'La clave de envío ya se utilizó');
        await connection.rollback();
        transactionStarted = false;
        return { id: existing.id, replayed: true };
      }
    }

    if (publication.groups.length) {
      const [groups] = await connection.query(`SELECT g.id FROM usuario_grupo ug
        JOIN grupos g ON g.id=ug.grupo_id
        JOIN usuario owner ON owner.id=g.propietario_id
        WHERE ug.usuario_id=? AND owner.instancia_id=? AND ug.rol IN ('propietario','admin')
          AND g.id IN (?) ORDER BY g.id FOR UPDATE`, [actor, instance, publication.groups]);
      if (new Set(groups.map(group => Number(group.id))).size !== publication.groups.length) {
        fail(403, 'Solo propietario o administradores pueden publicar en los grupos seleccionados');
      }
    }

    const type = file ? (file.mimetype.startsWith('video/') ? 'video' : 'imagen') : 'texto';
    const [result] = await connection.query(`INSERT INTO chat_estados
      (instancia_id, autor_id, grupo_id, tipo, texto, fondo, archivo, mime,
       visible_instancia, clave_envio, huella_envio, apariencia, leyenda, creado_at, vence_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))`,
    [instance, actor, publication.modern ? null : (publication.groups[0] || null),
      type, text || null, color, file?.filename || null, file?.mimetype || null,
      publication.modern ? Number(publication.personal) : null, publication.key || null, hash, appearance, caption]);

    let id = result.insertId;
    if (publication.modern) {
      const [[row]] = await connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
      id = row.id;
      if (publication.groups.length) {
        await connection.query('INSERT INTO chat_estado_grupos (estado_id, grupo_id) VALUES ?',
          [publication.groups.map(group => [id, group])]);
      }
    }

    // Si se corta la conexión durante COMMIT, MariaDB puede haberlo confirmado.
    mayBeReferenced = true;
    try {
      await connection.commit();
    } catch (error) {
      connection.destroy();
      connection = null;
      console.error('Commit de estado sin confirmación:', error.code || error.message);
      fail(503, 'No se pudo confirmar el envío. Vuelve a comprobar el estado antes de publicar.');
    }
    return { id, replayed: false };
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        connection.destroy();
        connection = null;
      }
    }
    throw error;
  } finally {
    connection?.release();
    if (!mayBeReferenced) await discardFile(file);
  }
}

module.exports = { MEDIA_TYPES, fail, groupId, statusId, canPublish, parsePublication, discardFile, publish, parsePresentation, readAppearance, validateGif };
