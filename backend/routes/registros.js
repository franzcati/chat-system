const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireAnyPermission, requirePermission } = require('../middleware/requireAuth');
const { resolveInstance } = require('../middleware/resolveInstance');
const { getActorPolicy, getActorProjectIds, canAccessProject } = require('../utils/roleAccess');
const { writeAudit } = require('../utils/auditService');

const VIEW_PERMISSIONS = [
  'ver_registros','ver_registros_admin','ver_registros_chat','ver_registros_grupo','ver_registros_seguridad','ver_blacklist','gestionar_blacklist','exportar_registros',
];

const CATEGORY_PERMISSION = {
  administrativo: 'ver_registros_admin',
  chat: 'ver_registros_chat',
  chat_grupal: 'ver_registros_grupo',
  seguridad: 'ver_registros_seguridad',
  blacklist: 'ver_blacklist',
};

const toPositiveInt = (value, fallback = null) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const safeJsonParse = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

const csvEscape = (value) => {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
};

function allowedCategories(req) {
  const set = new Set(req.auth?.permisos || []);
  if (set.has('ver_registros')) return Object.keys(CATEGORY_PERMISSION);
  return Object.entries(CATEGORY_PERMISSION)
    .filter(([, permission]) => set.has(permission))
    .map(([category]) => category);
}

async function buildScope(req, alias = 'ra') {
  const instanciaId = Number(req.instanciaActual.id);
  const policy = await getActorPolicy(req);
  const conditions = [`${alias}.instancia_id = ?`];
  const params = [instanciaId];
  if (policy?.scope !== 'organizacion') {
    const projectIds = await getActorProjectIds(req);
    if (projectIds.length) {
      conditions.push(`(${alias}.proyecto_id IN (?) OR (${alias}.proyecto_id IS NULL AND ${alias}.actor_usuario_id = ?))`);
      params.push(projectIds, Number(req.auth.userId));
    } else {
      conditions.push(`(${alias}.proyecto_id IS NULL AND ${alias}.actor_usuario_id = ?)`);
      params.push(Number(req.auth.userId));
    }
  }
  const cats = allowedCategories(req);
  if (!cats.length) conditions.push('1=0');
  else if (cats.length < Object.keys(CATEGORY_PERMISSION).length) {
    conditions.push(`${alias}.categoria IN (?)`);
    params.push(cats);
  }
  return { conditions, params, policy };
}

function appendAuditFilters(req, conditions, params, alias = 'ra') {
  const q = String(req.query.q || req.query.search || '').trim();
  const category = String(req.query.categoria || '').trim();
  const projectId = toPositiveInt(req.query.proyecto_id);
  const userId = toPositiveInt(req.query.usuario_id);
  const action = String(req.query.accion || '').trim();
  const result = String(req.query.resultado || '').trim();
  const from = String(req.query.desde || '').trim();
  const to = String(req.query.hasta || '').trim();

  if (category && Object.prototype.hasOwnProperty.call(CATEGORY_PERMISSION, category)) {
    conditions.push(`${alias}.categoria = ?`); params.push(category);
  }
  if (projectId) { conditions.push(`${alias}.proyecto_id = ?`); params.push(projectId); }
  if (userId) { conditions.push(`(${alias}.actor_usuario_id = ? OR ${alias}.objetivo_usuario_id = ?)`); params.push(userId, userId); }
  if (action) { conditions.push(`${alias}.evento = ?`); params.push(action); }
  if (['exitoso','alerta','fallido'].includes(result)) { conditions.push(`${alias}.resultado = ?`); params.push(result); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { conditions.push(`${alias}.creado_en >= ?`); params.push(`${from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { conditions.push(`${alias}.creado_en < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(`${to} 00:00:00`); }
  if (q) {
    const like = `%${q}%`;
    conditions.push(`(
      ${alias}.accion LIKE ? OR ${alias}.evento LIKE ? OR au.nombre LIKE ? OR au.apellido LIKE ? OR au.correo LIKE ?
      OR ou.nombre LIKE ? OR ou.apellido LIKE ? OR p.nombre LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }
}

async function fetchLogs(req, { exportMode = false } = {}) {
  const page = Math.max(1, toPositiveInt(req.query.page, 1));
  const limit = exportMode ? Math.min(toPositiveInt(req.query.limit, 5000), 5000) : Math.min(toPositiveInt(req.query.limit, 25), 100);
  const offset = (page - 1) * limit;
  const scope = await buildScope(req, 'ra');
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  appendAuditFilters(req, conditions, params, 'ra');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseJoins = `
    LEFT JOIN usuario au ON au.id=ra.actor_usuario_id
    LEFT JOIN usuario ou ON ou.id=ra.objetivo_usuario_id
    LEFT JOIN proyecto p ON p.id=ra.proyecto_id`;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) total FROM registros_auditoria ra ${baseJoins} ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT ra.*,
            au.nombre actor_nombre, au.apellido actor_apellido, au.correo actor_correo, au.background actor_background, au.url_imagen actor_imagen,
            ou.nombre objetivo_nombre, ou.apellido objetivo_apellido, ou.correo objetivo_correo,
            p.nombre proyecto_nombre
       FROM registros_auditoria ra
       ${baseJoins}
       ${where}
      ORDER BY ra.creado_en DESC, ra.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, exportMode ? 0 : offset]
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      id: Number(row.id),
      actor_usuario_id: row.actor_usuario_id ? Number(row.actor_usuario_id) : null,
      objetivo_usuario_id: row.objetivo_usuario_id ? Number(row.objetivo_usuario_id) : null,
      proyecto_id: row.proyecto_id ? Number(row.proyecto_id) : null,
      metadata: safeJsonParse(row.metadata),
      valores_anteriores: safeJsonParse(row.valores_anteriores),
      valores_nuevos: safeJsonParse(row.valores_nuevos),
    })),
    total: Number(countRows[0]?.total || 0), page, limit,
  };
}

router.use(requireAuth, resolveInstance);
router.use(requireAnyPermission(VIEW_PERMISSIONS));

router.get('/stats', async (req, res) => {
  try {
    const scope = await buildScope(req, 'ra');
    const where = `WHERE ${scope.conditions.join(' AND ')}`;
    const [rows] = await pool.query(
      `SELECT COUNT(*) total,
              SUM(ra.categoria='administrativo') administrativos,
              SUM(ra.categoria='chat') chats,
              SUM(ra.categoria='chat_grupal') chats_grupales,
              SUM(ra.categoria='seguridad') seguridad,
              SUM(ra.categoria='blacklist' OR ra.resultado='alerta') alertas
         FROM registros_auditoria ra ${where}`,
      scope.params
    );
    const r = rows[0] || {};
    res.json({
      total: Number(r.total || 0), administrativos: Number(r.administrativos || 0), chats: Number(r.chats || 0),
      chats_grupales: Number(r.chats_grupales || 0), seguridad: Number(r.seguridad || 0), alertas: Number(r.alertas || 0),
    });
  } catch (error) {
    console.error('Error estadísticas registros:', error);
    res.status(500).json({ error: 'No se pudieron cargar las estadísticas' });
  }
});

router.get('/filters', async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);
    const policy = await getActorPolicy(req);
    const projectIds = policy?.scope === 'organizacion' ? null : await getActorProjectIds(req);
    const projectWhere = projectIds === null ? `p.instancia_id=?` : projectIds.length ? `p.instancia_id=? AND p.id IN (?)` : '1=0';
    const projectParams = projectIds === null ? [instanciaId] : projectIds.length ? [instanciaId, projectIds] : [];
    const [projects] = await pool.query(`SELECT p.id,p.nombre FROM proyecto p WHERE ${projectWhere} ORDER BY p.nombre`, projectParams);

    let usersSql = `SELECT DISTINCT u.id,u.nombre,u.apellido,u.correo FROM usuario u`;
    const userParams = [instanciaId];
    if (projectIds && projectIds.length) {
      usersSql += ` JOIN usuario_proyecto up ON up.usuario_id=u.id WHERE u.instancia_id=? AND up.proyecto_id IN (?)`;
      userParams.push(projectIds);
    } else if (projectIds && !projectIds.length) {
      usersSql += ` WHERE 1=0`;
      userParams.length = 0;
    } else usersSql += ` WHERE u.instancia_id=?`;
    usersSql += ` ORDER BY u.nombre,u.apellido,u.id LIMIT 1000`;
    const [users] = await pool.query(usersSql, userParams);

    const scope = await buildScope(req, 'ra');
    const [actions] = await pool.query(
      `SELECT DISTINCT evento, accion FROM registros_auditoria ra WHERE ${scope.conditions.join(' AND ')} ORDER BY accion LIMIT 250`,
      scope.params
    );
    res.json({ projects, users, actions });
  } catch (error) {
    console.error('Error filtros registros:', error);
    res.status(500).json({ error: 'No se pudieron cargar los filtros' });
  }
});

router.get('/export.csv', requirePermission('exportar_registros'), async (req, res) => {
  try {
    const data = await fetchLogs(req, { exportMode: true });
    const header = ['Fecha y hora','Usuario','Correo','Categoría','Acción','Objetivo','Proyecto','Estado','IP','Dispositivo'];
    const lines = [header.map(csvEscape).join(',')];
    for (const row of data.rows) {
      lines.push([
        row.creado_en,
        `${row.actor_nombre || ''} ${row.actor_apellido || ''}`.trim(), row.actor_correo || '', row.categoria,
        row.accion,
        `${row.objetivo_nombre || ''} ${row.objetivo_apellido || ''}`.trim() || row.objetivo_correo || '',
        row.proyecto_nombre || '', row.resultado, row.ip || '', row.dispositivo || '',
      ].map(csvEscape).join(','));
    }
    await writeAudit(req, { category: 'administrativo', event: 'REGISTROS_EXPORTADOS', action: 'Exportó registros', metadata: { cantidad: data.rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="registros-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(`\ufeff${lines.join('\n')}`);
  } catch (error) {
    console.error('Error exportando registros:', error);
    res.status(500).json({ error: 'No se pudo exportar' });
  }
});

router.get('/blacklist/stats', requireAnyPermission(['ver_blacklist','gestionar_blacklist']), async (req, res) => {
  try {
    const instanciaId = Number(req.instanciaActual.id);
    const policy = await getActorPolicy(req);
    const projectIds = policy?.scope === 'organizacion' ? null : await getActorProjectIds(req);
    const cond = ['bd.instancia_id=?']; const params = [instanciaId];
    if (projectIds) {
      if (projectIds.length) { cond.push('(bd.proyecto_id IN (?) OR bd.proyecto_id IS NULL)'); params.push(projectIds); }
      else cond.push('bd.proyecto_id IS NULL');
    }
    const [detections] = await pool.query(
      `SELECT COUNT(*) total, COUNT(DISTINCT bd.actor_usuario_id) usuarios,
              SUM(bd.severidad='critica') criticas
         FROM blacklist_detecciones bd WHERE ${cond.join(' AND ')}`,
      params
    );
    const ruleCond = ['br.instancia_id=?']; const ruleParams = [instanciaId];
    if (projectIds) {
      if (projectIds.length) { ruleCond.push('(br.proyecto_id IN (?) OR br.proyecto_id IS NULL)'); ruleParams.push(projectIds); }
      else ruleCond.push('br.proyecto_id IS NULL');
    }
    const [rules] = await pool.query(`SELECT COUNT(*) total FROM blacklist_reglas br WHERE ${ruleCond.join(' AND ')}`, ruleParams);
    res.json({ reglas: Number(rules[0]?.total || 0), coincidencias: Number(detections[0]?.total || 0), usuarios: Number(detections[0]?.usuarios || 0), criticas: Number(detections[0]?.criticas || 0) });
  } catch (error) {
    console.error('Error stats blacklist:', error);
    res.status(500).json({ error: 'No se pudieron cargar las estadísticas de blacklist' });
  }
});

function appendBlacklistFilters(req, conditions, params) {
  const q = String(req.query.q || '').trim();
  const projectId = toPositiveInt(req.query.proyecto_id);
  const userId = toPositiveInt(req.query.usuario_id);
  const word = String(req.query.palabra || '').trim();
  const type = String(req.query.tipo || '').trim();
  const severity = String(req.query.severidad || '').trim();
  const state = String(req.query.estado || '').trim();
  const from = String(req.query.desde || '').trim();
  const to = String(req.query.hasta || '').trim();
  if (projectId) { conditions.push('bd.proyecto_id=?'); params.push(projectId); }
  if (userId) { conditions.push('(bd.actor_usuario_id=? OR bd.objetivo_usuario_id=?)'); params.push(userId,userId); }
  if (word) { conditions.push('bd.palabra_detectada=?'); params.push(word); }
  if (['chat','grupo','administrativo'].includes(type)) { conditions.push('bd.tipo=?'); params.push(type); }
  if (['baja','media','alta','critica'].includes(severity)) { conditions.push('bd.severidad=?'); params.push(severity); }
  if (['registrado','alerta','revisado','resuelto'].includes(state)) { conditions.push('bd.estado=?'); params.push(state); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { conditions.push('bd.creado_en>=?'); params.push(`${from} 00:00:00`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { conditions.push('bd.creado_en<DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }
  if (q) {
    const like=`%${q}%`;
    conditions.push('(bd.palabra_detectada LIKE ? OR bd.contexto LIKE ? OR au.nombre LIKE ? OR au.apellido LIKE ? OR au.correo LIKE ?)');
    params.push(like,like,like,like,like);
  }
}

async function blacklistScope(req) {
  const policy = await getActorPolicy(req);
  const projectIds = policy?.scope === 'organizacion' ? null : await getActorProjectIds(req);
  const conditions = ['bd.instancia_id=?']; const params=[Number(req.instanciaActual.id)];
  if (projectIds) {
    if (projectIds.length) { conditions.push('(bd.proyecto_id IN (?) OR (bd.proyecto_id IS NULL AND bd.actor_usuario_id=?))'); params.push(projectIds,Number(req.auth.userId)); }
    else { conditions.push('(bd.proyecto_id IS NULL AND bd.actor_usuario_id=?)'); params.push(Number(req.auth.userId)); }
  }
  return { conditions, params, projectIds };
}

router.get('/blacklist', requireAnyPermission(['ver_blacklist','gestionar_blacklist']), async (req, res) => {
  try {
    const page=Math.max(1,toPositiveInt(req.query.page,1)); const limit=Math.min(toPositiveInt(req.query.limit,25),100); const offset=(page-1)*limit;
    const scope=await blacklistScope(req); const conditions=[...scope.conditions]; const params=[...scope.params]; appendBlacklistFilters(req,conditions,params);
    const where=`WHERE ${conditions.join(' AND ')}`;
    const joins=`LEFT JOIN usuario au ON au.id=bd.actor_usuario_id LEFT JOIN usuario ou ON ou.id=bd.objetivo_usuario_id LEFT JOIN proyecto p ON p.id=bd.proyecto_id`;
    const [count]=await pool.query(`SELECT COUNT(*) total FROM blacklist_detecciones bd ${joins} ${where}`,params);
    const [rows]=await pool.query(
      `SELECT bd.*, au.nombre actor_nombre,au.apellido actor_apellido,au.correo actor_correo,au.background actor_background,au.url_imagen actor_imagen,
              ou.nombre objetivo_nombre,ou.apellido objetivo_apellido,ou.correo objetivo_correo,p.nombre proyecto_nombre
         FROM blacklist_detecciones bd ${joins} ${where}
        ORDER BY bd.creado_en DESC,bd.id DESC LIMIT ? OFFSET ?`, [...params,limit,offset]
    );
    res.json({ rows, total:Number(count[0]?.total||0), page, limit });
  } catch(error){ console.error('Error blacklist:',error); res.status(500).json({error:'No se pudieron cargar las detecciones'}); }
});

router.get('/blacklist/rules', requireAnyPermission(['ver_blacklist','gestionar_blacklist']), async (req,res)=>{
  try{
    const policy=await getActorPolicy(req); const projectIds=policy?.scope==='organizacion'?null:await getActorProjectIds(req);
    const conditions=['br.instancia_id=?']; const params=[Number(req.instanciaActual.id)];
    if(projectIds){ if(projectIds.length){conditions.push('(br.proyecto_id IN (?) OR br.proyecto_id IS NULL)');params.push(projectIds);} else conditions.push('br.proyecto_id IS NULL'); }
    const [rows]=await pool.query(`SELECT br.*,p.nombre proyecto_nombre,
              cu.nombre creado_por_nombre,cu.apellido creado_por_apellido,cu.correo creado_por_correo,cu.url_imagen creado_por_imagen
         FROM blacklist_reglas br
         LEFT JOIN proyecto p ON p.id=br.proyecto_id
         LEFT JOIN usuario cu ON cu.id=br.creado_por_usuario_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY br.activa DESC,br.id DESC`,params);
    res.json(rows);
  }catch(error){ console.error('Error reglas blacklist:',error);res.status(500).json({error:'No se pudieron cargar las reglas'}); }
});

function validateRuleBody(body={}){
  const palabra=String(body.palabra||'').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,255);
  if(!palabra || palabra.length<2) return {error:'Ingresa una palabra o frase de al menos 2 caracteres'};
  const categorias=['seguridad','spam','fraude','acoso','contenido_sensible','personalizada'];
  const severidades=['baja','media','alta','critica']; const coincidencias=['exacta','contiene','variaciones']; const acciones=['registrar','alerta','notificar'];
  return { value:{ palabra, categoria:categorias.includes(body.categoria)?body.categoria:'personalizada', severidad:severidades.includes(body.severidad)?body.severidad:'media',
    aplicar_chats:body.aplicar_chats===false?0:1, aplicar_grupos:body.aplicar_grupos===false?0:1, aplicar_administrativos:body.aplicar_administrativos?1:0,
    proyecto_id:toPositiveInt(body.proyecto_id), coincidencia:coincidencias.includes(body.coincidencia)?body.coincidencia:'exacta', accion:acciones.includes(body.accion)?body.accion:'registrar',
    activa:body.activa===false?0:1, observacion:String(body.observacion||'').trim().slice(0,300)||null } };
}

router.post('/blacklist/rules', requirePermission('gestionar_blacklist'), async(req,res)=>{
  try{
    const parsed=validateRuleBody(req.body); if(parsed.error)return res.status(400).json({error:parsed.error}); const v=parsed.value;
    if(v.proyecto_id && !(await canAccessProject(req,v.proyecto_id))) return res.status(403).json({error:'No tienes acceso a ese proyecto'});
    const [result]=await pool.query(`INSERT INTO blacklist_reglas (instancia_id,palabra,categoria,severidad,aplicar_chats,aplicar_grupos,aplicar_administrativos,proyecto_id,coincidencia,accion,activa,observacion,creado_por_usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [Number(req.instanciaActual.id),v.palabra,v.categoria,v.severidad,v.aplicar_chats,v.aplicar_grupos,v.aplicar_administrativos,v.proyecto_id,v.coincidencia,v.accion,v.activa,v.observacion,Number(req.auth.userId)]);
    await writeAudit(req,{category:'blacklist',event:'BLACKLIST_REGLA_CREADA',action:`Añadió palabra a blacklist: ${v.palabra}`,projectId:v.proyecto_id,after:v,metadata:{ruleId:Number(result.insertId)}});
    req.auditHandled=true; res.status(201).json({success:true,id:Number(result.insertId)});
  }catch(error){console.error('Error crear regla blacklist:',error);res.status(500).json({error:'No se pudo guardar la palabra'});}
});

router.put('/blacklist/rules/:id', requirePermission('gestionar_blacklist'), async(req,res)=>{
  try{
    const id=toPositiveInt(req.params.id); if(!id)return res.status(400).json({error:'Regla inválida'});
    const [oldRows]=await pool.query(`SELECT * FROM blacklist_reglas WHERE id=? AND instancia_id=? LIMIT 1`,[id,Number(req.instanciaActual.id)]); if(!oldRows.length)return res.status(404).json({error:'Regla no encontrada'});
    const parsed=validateRuleBody(req.body); if(parsed.error)return res.status(400).json({error:parsed.error}); const v=parsed.value;
    if(v.proyecto_id && !(await canAccessProject(req,v.proyecto_id))) return res.status(403).json({error:'No tienes acceso a ese proyecto'});
    await pool.query(`UPDATE blacklist_reglas SET palabra=?,categoria=?,severidad=?,aplicar_chats=?,aplicar_grupos=?,aplicar_administrativos=?,proyecto_id=?,coincidencia=?,accion=?,activa=?,observacion=? WHERE id=?`,
      [v.palabra,v.categoria,v.severidad,v.aplicar_chats,v.aplicar_grupos,v.aplicar_administrativos,v.proyecto_id,v.coincidencia,v.accion,v.activa,v.observacion,id]);
    await writeAudit(req,{category:'blacklist',event:'BLACKLIST_REGLA_EDITADA',action:`Editó regla blacklist: ${v.palabra}`,projectId:v.proyecto_id,before:oldRows[0],after:v,metadata:{ruleId:id}});
    req.auditHandled=true;res.json({success:true});
  }catch(error){console.error('Error editar regla blacklist:',error);res.status(500).json({error:'No se pudo actualizar la palabra'});}
});

router.delete('/blacklist/rules/:id', requirePermission('gestionar_blacklist'), async(req,res)=>{
  try{
    const id=toPositiveInt(req.params.id); const [rows]=await pool.query(`SELECT * FROM blacklist_reglas WHERE id=? AND instancia_id=? LIMIT 1`,[id,Number(req.instanciaActual.id)]); if(!rows.length)return res.status(404).json({error:'Regla no encontrada'});
    if(rows[0].proyecto_id && !(await canAccessProject(req,rows[0].proyecto_id)))return res.status(403).json({error:'No tienes acceso a esa regla'});
    await pool.query(`DELETE FROM blacklist_reglas WHERE id=?`,[id]);
    await writeAudit(req,{category:'blacklist',event:'BLACKLIST_REGLA_ELIMINADA',action:`Eliminó regla blacklist: ${rows[0].palabra}`,projectId:rows[0].proyecto_id,before:rows[0],metadata:{ruleId:id}});
    req.auditHandled=true;res.json({success:true});
  }catch(error){console.error('Error eliminar regla blacklist:',error);res.status(500).json({error:'No se pudo eliminar la palabra'});}
});

router.patch('/blacklist/:id/status', requirePermission('gestionar_blacklist'), async(req,res)=>{
  try{
    const id=toPositiveInt(req.params.id); const estado=['revisado','resuelto','alerta','registrado'].includes(req.body?.estado)?req.body.estado:null; if(!id||!estado)return res.status(400).json({error:'Estado inválido'});
    const scope=await blacklistScope(req); const cond=[...scope.conditions,'bd.id=?']; const params=[...scope.params,id];
    const [rows]=await pool.query(`SELECT bd.* FROM blacklist_detecciones bd WHERE ${cond.join(' AND ')} LIMIT 1`,params); if(!rows.length)return res.status(404).json({error:'Detección no encontrada'});
    await pool.query(`UPDATE blacklist_detecciones SET estado=? WHERE id=?`,[estado,id]);
    await writeAudit(req,{category:'blacklist',event:'BLACKLIST_DETECCION_ESTADO',action:`Marcó detección como ${estado}`,projectId:rows[0].proyecto_id,metadata:{detectionId:id,estado}});
    req.auditHandled=true;res.json({success:true});
  }catch(error){console.error('Error estado blacklist:',error);res.status(500).json({error:'No se pudo actualizar el estado'});}
});

router.get('/blacklist/export.csv', requirePermission('exportar_registros'), async(req,res)=>{
  try{
    req.query.limit='5000'; const scope=await blacklistScope(req); const conditions=[...scope.conditions]; const params=[...scope.params];appendBlacklistFilters(req,conditions,params);
    const [rows]=await pool.query(`SELECT bd.*,au.nombre actor_nombre,au.apellido actor_apellido,au.correo actor_correo,p.nombre proyecto_nombre FROM blacklist_detecciones bd LEFT JOIN usuario au ON au.id=bd.actor_usuario_id LEFT JOIN proyecto p ON p.id=bd.proyecto_id WHERE ${conditions.join(' AND ')} ORDER BY bd.creado_en DESC LIMIT 5000`,params);
    const lines=[['Fecha','Usuario','Categoría','Palabra','Coincidencia','Proyecto','Severidad','Estado','Acción'].map(csvEscape).join(',')];
    rows.forEach(row=>lines.push([row.creado_en,`${row.actor_nombre||''} ${row.actor_apellido||''}`.trim()||row.actor_correo||'',row.tipo,row.palabra_detectada,row.coincidencia_texto||'',row.proyecto_nombre||'',row.severidad,row.estado,row.accion_tomada].map(csvEscape).join(',')));
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="blacklist-${new Date().toISOString().slice(0,10)}.csv"`);res.send(`\ufeff${lines.join('\n')}`);
  }catch(error){console.error('Error export blacklist:',error);res.status(500).json({error:'No se pudo exportar blacklist'});}
});

// Debe ir después de /blacklist y /export.
router.get('/:id', async (req,res)=>{
  try{
    const id=toPositiveInt(req.params.id); if(!id)return res.status(400).json({error:'Registro inválido'});
    const scope=await buildScope(req,'ra'); const conditions=[...scope.conditions,'ra.id=?']; const params=[...scope.params,id];
    const [rows]=await pool.query(
      `SELECT ra.*, au.nombre actor_nombre,au.apellido actor_apellido,au.correo actor_correo,au.background actor_background,au.url_imagen actor_imagen,
              ou.nombre objetivo_nombre,ou.apellido objetivo_apellido,ou.correo objetivo_correo,p.nombre proyecto_nombre
         FROM registros_auditoria ra
         LEFT JOIN usuario au ON au.id=ra.actor_usuario_id LEFT JOIN usuario ou ON ou.id=ra.objetivo_usuario_id LEFT JOIN proyecto p ON p.id=ra.proyecto_id
        WHERE ${conditions.join(' AND ')} LIMIT 1`,params);
    if(!rows.length)return res.status(404).json({error:'Registro no encontrado'});
    const row=rows[0];
    row.metadata=safeJsonParse(row.metadata);row.valores_anteriores=safeJsonParse(row.valores_anteriores);row.valores_nuevos=safeJsonParse(row.valores_nuevos);
    let context=[];
    if(row.mensaje_id){
      const isGroup = Boolean(row.grupo_id) || row.categoria==='chat_grupal';
      if(isGroup){
        const [msg]=await pool.query(`SELECT * FROM mensajes_grupo WHERE id=? LIMIT 1`,[row.mensaje_id]);
        if(msg.length){
          const m=msg[0];
          const [ctx]=await pool.query(`SELECT mg.id,mg.usuario_id,mg.mensaje,mg.fecha_envio,mg.editado,mg.eliminado,u.nombre,u.apellido,u.url_imagen FROM mensajes_grupo mg JOIN usuario u ON u.id=mg.usuario_id WHERE mg.grupo_id=? AND mg.id BETWEEN ? AND ? ORDER BY mg.id`,[m.grupo_id,Math.max(1,Number(m.id)-3),Number(m.id)+3]);
          context=ctx;
        }
      } else {
        const [msg]=await pool.query(`SELECT * FROM mensajes WHERE id=? LIMIT 1`,[row.mensaje_id]);
        if(msg.length){
          const m=msg[0];
          const [ctx]=await pool.query(`SELECT m.id,m.usuario_envia_id,m.usuario_recibe_id,m.mensaje,m.fecha_envio,m.editado,m.eliminado,u.nombre,u.apellido,u.url_imagen FROM mensajes m JOIN usuario u ON u.id=m.usuario_envia_id WHERE ((m.usuario_envia_id=? AND m.usuario_recibe_id=?) OR (m.usuario_envia_id=? AND m.usuario_recibe_id=?)) AND m.id BETWEEN ? AND ? ORDER BY m.id`,[m.usuario_envia_id,m.usuario_recibe_id,m.usuario_recibe_id,m.usuario_envia_id,Math.max(1,Number(m.id)-3),Number(m.id)+3]);
          context=ctx;
        }
      }
    }
    const [trail]=row.mensaje_id?await pool.query(`SELECT id,evento,accion,resultado,creado_en FROM registros_auditoria WHERE instancia_id=? AND mensaje_id=? ORDER BY creado_en,id`,[Number(req.instanciaActual.id),row.mensaje_id]):[[]];
    res.json({record:row,context,trail});
  }catch(error){console.error('Error detalle registro:',error);res.status(500).json({error:'No se pudo cargar el detalle'});}
});

router.get('/', async (req,res)=>{
  try{res.json(await fetchLogs(req));}catch(error){console.error('Error registros:',error);res.status(500).json({error:'No se pudieron cargar los registros'});}
});

module.exports=router;
