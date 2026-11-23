const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { resolveInstance } = require('../middleware/resolveInstance');

const router = express.Router();
router.use(requireAuth, resolveInstance);
router.use((req,res,next) => {
  if (req.auth.usuario.instancia_id !== req.instanciaActual.id) return res.status(403).json({ error: 'Instancia no autorizada' });
  res.set('Cache-Control','no-store'); next();
});
const mediaDir = path.join(__dirname, '..', 'status-media'); // Fuera de /uploads, nunca público por nginx.
fs.mkdirSync(mediaDir, { recursive: true });
const types = { 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','video/mp4':'.mp4','video/webm':'.webm' };
const upload = multer({ storage: multer.diskStorage({
  destination: mediaDir,
  filename: (_req,file,cb) => cb(null, `${randomUUID()}${types[file.mimetype] || ''}`),
}), limits: { fileSize: 30 * 1024 * 1024, files: 1 }, fileFilter: (_req,file,cb) =>
  cb(null, Object.hasOwn(types,file.mimetype)) });
let nextCleanup=0;
async function cleanExpired() {
  if(Date.now()<nextCleanup)return;
  nextCleanup=Date.now()+30*60*1000;
  try {
    const [expired]=await db.query(`SELECT id,archivo FROM chat_estados
      WHERE vence_at<UTC_TIMESTAMP(3) OR eliminado_at IS NOT NULL ORDER BY id LIMIT 100`);
    for(const entry of expired){
      await db.query('DELETE FROM chat_estados WHERE id=? AND (vence_at<UTC_TIMESTAMP(3) OR eliminado_at IS NOT NULL)',[entry.id]);
      if(entry.archivo) await fs.promises.unlink(path.join(mediaDir,path.basename(entry.archivo))).catch(()=>{});
    }
  } catch(e) { console.error('Limpieza de estados:',e.message); }
}
const validId = v => Number.isSafeInteger(Number(v)) && Number(v)>0 ? Number(v) : null;
function permissions(req) {
  const p=req.auth.usuario.permisos_chat || {};
  return p.publicar_estados === 1 || p.publicar_estados === true || p.publicar_estados === '1';
}
async function groupRole(req, groupId) {
  const [rows] = await db.query(`SELECT ug.rol FROM usuario_grupo ug JOIN grupos g ON g.id=ug.grupo_id
    JOIN usuario owner ON owner.id=g.propietario_id
    WHERE ug.grupo_id=? AND ug.usuario_id=? AND owner.instancia_id=? LIMIT 1`,
    [groupId,req.auth.userId,req.instanciaActual.id]);
  return rows[0]?.rol || null;
}
async function visible(req, statusId) {
  const [rows] = await db.query(`SELECT e.* FROM chat_estados e
    JOIN usuario autor ON autor.id=e.autor_id AND autor.instancia_id=e.instancia_id
    WHERE e.id=? AND e.instancia_id=? AND e.eliminado_at IS NULL AND e.vence_at>UTC_TIMESTAMP(3)
      AND (e.grupo_id IS NULL OR EXISTS (SELECT 1 FROM usuario_grupo ug
        WHERE ug.grupo_id=e.grupo_id AND ug.usuario_id=?)) LIMIT 1`,
    [statusId,req.instanciaActual.id,req.auth.userId]);
  return rows[0];
}
function reportError(res,error) {
  console.error('Estados:', error.code || error.message);
  return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: error.code === 'LIMIT_FILE_SIZE'
    ? 'El archivo supera 30 MB' : 'No se pudo completar la operación' });
}
router.get('/', async (req,res) => {
  try {
    void cleanExpired();
    const [rows] = await db.query(`SELECT e.id,e.autor_id,e.grupo_id,e.tipo,e.texto,e.fondo,
      e.creado_at,e.vence_at,u.nombre,u.apellido,u.url_imagen,g.nombre AS grupo_nombre,
      (v.usuario_id IS NOT NULL) AS visto,
      (SELECT COUNT(*) FROM chat_estado_vistas cv WHERE cv.estado_id=e.id) AS vistas
      FROM chat_estados e JOIN usuario u ON u.id=e.autor_id AND u.instancia_id=e.instancia_id
      LEFT JOIN grupos g ON g.id=e.grupo_id
      LEFT JOIN chat_estado_vistas v ON v.estado_id=e.id AND v.usuario_id=?
      WHERE e.instancia_id=? AND e.eliminado_at IS NULL AND e.vence_at>UTC_TIMESTAMP(3)
        AND u.estado='aprobado' AND (e.grupo_id IS NULL OR EXISTS
        (SELECT 1 FROM usuario_grupo ug WHERE ug.grupo_id=e.grupo_id AND ug.usuario_id=?))
      ORDER BY e.creado_at DESC LIMIT 300`,
      [req.auth.userId,req.instanciaActual.id,req.auth.userId]);
    res.json({ estados:rows, puede_publicar:permissions(req) });
  } catch (e) { reportError(res,e); }
});
router.get('/grupos', async (req,res) => {
  try {
    const [rows] = await db.query(`SELECT g.id,g.nombre,ug.rol FROM usuario_grupo ug
      JOIN grupos g ON g.id=ug.grupo_id JOIN usuario owner ON owner.id=g.propietario_id
      WHERE ug.usuario_id=? AND owner.instancia_id=?
      AND ug.rol IN ('propietario','admin') ORDER BY g.nombre LIMIT 200`,
      [req.auth.userId,req.instanciaActual.id]);
    res.json({ grupos:rows });
  } catch(e) { reportError(res,e); }
});
router.post('/', (req,res,next) => upload.single('archivo')(req,res,error => error ? reportError(res,error) : next()), async (req,res) => {
  const discard=()=>{ if(req.file) fs.promises.unlink(req.file.path).catch(()=>{}); };
  try {
    if (!permissions(req)) { discard(); return res.status(403).json({error:'No tienes permiso para publicar estados'}); }
    const groupId=req.body.grupo_id ? validId(req.body.grupo_id) : null;
    if (req.body.grupo_id && !groupId) { discard(); return res.status(400).json({error:'Grupo inválido'}); }
    if(groupId && !['propietario','admin'].includes(await groupRole(req,groupId))) {
      discard(); return res.status(403).json({error:'Solo propietario o administradores pueden publicar en este grupo'});
    }
    const texto=String(req.body.texto || '').trim().slice(0,700);
    if (!texto && !req.file) { discard(); return res.status(400).json({error:'Escribe un estado o selecciona una foto o video'}); }
    const tipo=req.file ? (req.file.mimetype.startsWith('video/')?'video':'imagen') : 'texto';
    const fondo=/^#[0-9a-f]{6}$/i.test(req.body.fondo || '') ? req.body.fondo : '#1d3e70';
    const [result] = await db.query(`INSERT INTO chat_estados
      (instancia_id,autor_id,grupo_id,tipo,texto,fondo,archivo,mime,creado_at,vence_at)
      VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))`,
      [req.instanciaActual.id,req.auth.userId,groupId,tipo,texto||null,fondo,req.file?.filename||null,req.file?.mimetype||null]);
    res.status(201).json({id:result.insertId});
  } catch(e) { discard(); reportError(res,e); }
});
router.get('/:id/media', async (req,res) => {
  try {
    const status=await visible(req,validId(req.params.id));
    if(!status?.archivo) return res.status(404).end();
    res.set('Content-Type',status.mime);
    res.set('Cache-Control','private, no-store');
    res.sendFile(path.join(mediaDir,path.basename(status.archivo)));
  } catch(e) { reportError(res,e); }
});
router.post('/:id/vista', async (req,res) => {
  try {
    const status=await visible(req,validId(req.params.id));
    if(!status) return res.status(404).json({error:'Estado no disponible'});
    await db.query('INSERT IGNORE INTO chat_estado_vistas (estado_id,usuario_id) VALUES (?,?)',[status.id,req.auth.userId]);
    res.json({ok:true});
  } catch(e) { reportError(res,e); }
});
router.post('/:id/responder', async (req,res) => {
  try {
    const status=await visible(req,validId(req.params.id));
    if(!status) return res.status(404).json({error:'Estado no disponible'});
    if(!status.grupo_id) return res.status(400).json({error:'Responde al estado personal desde un chat privado'});
    const message=String(req.body.mensaje || '').trim().slice(0,2000);
    if(!message) return res.status(400).json({error:'Escribe una respuesta'});
    const content=`↪ Estado del grupo #${status.id}${status.texto ? ` · ${String(status.texto).slice(0,80)}` : ''}\n${message}`;
    const [result]=await db.query(`INSERT INTO mensajes_grupo (grupo_id,usuario_id,mensaje,fecha_envio,lote_id,reply_to_id,reenviado)
      VALUES (?,?,?,UTC_TIMESTAMP(3),NULL,NULL,0)`,[status.grupo_id,req.auth.userId,content]);
    const [author]=await db.query('SELECT nombre,apellido,correo,url_imagen,background FROM usuario WHERE id=?',[req.auth.userId]);
    const payload={id:result.insertId,grupo_id:Number(status.grupo_id),usuario_id:req.auth.userId,
      mensaje:content, fecha_envio:new Date().toISOString(),eliminado:0,editado:0,
      ...author[0]};
    res.status(201).json(payload);
    const emit=req.app.get('socketUtils')?.enviarEventoAlUsuario;
    if(emit) db.query('SELECT usuario_id FROM usuario_grupo WHERE grupo_id=?',[status.grupo_id])
      .then(([members])=>members.forEach(m=>emit(m.usuario_id,'nuevoMensajeGrupo',payload))).catch(()=>{});
  } catch(e) { reportError(res,e); }
});
router.delete('/:id', async(req,res)=>{
  try {
    const id=validId(req.params.id);
    const [result]=await db.query(`UPDATE chat_estados SET eliminado_at=UTC_TIMESTAMP(3)
      WHERE id=? AND instancia_id=? AND autor_id=? AND eliminado_at IS NULL`,[id,req.instanciaActual.id,req.auth.userId]);
    if(!result.affectedRows) return res.status(404).json({error:'Estado no encontrado'});
    res.json({ok:true});
  } catch(e) { reportError(res,e); }
});
module.exports=router;
