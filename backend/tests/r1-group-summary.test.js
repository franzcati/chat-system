const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const vm = require('node:vm');

function load(relative, stubs) {
  const path = require.resolve(relative);
  const native = createRequire(path);
  const mod = { exports: {} };
  vm.runInThisContext('(function(require,module){' + readFileSync(path,'utf8') + '\n})')(
    name => Object.hasOwn(stubs,name) ? stubs[name] : native(name), mod);
  return mod.exports;
}

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE usuario_grupo (usuario_id,grupo_id,rol);
    CREATE TABLE mensajes_grupo (id INTEGER PRIMARY KEY,grupo_id,usuario_id,mensaje,eliminado,editado,fecha_envio,lote_id);
    CREATE TABLE mensajes_grupo_vistos (mensaje_id,usuario_id,UNIQUE(mensaje_id,usuario_id));
    CREATE TABLE usuario (id INTEGER PRIMARY KEY,nombre,apellido,url_imagen,background,correo);
    CREATE TABLE grupos (id INTEGER PRIMARY KEY,nombre,descripcion,imagen_url,propietario_id,privacidad,fecha_creacion);
    CREATE TABLE chats_favoritos (id INTEGER PRIMARY KEY,chat_id,usuario_id,tipo);
    CREATE TABLE mensajes_grupo_archivos (id INTEGER PRIMARY KEY,grupo_id,usuario_id,archivo_url,tipo_archivo,nombre_archivo,tamano,lote_id);
    INSERT INTO usuario VALUES (1,'Uno','A',NULL,NULL,'uno@test'),(2,'Dos','B',NULL,NULL,'dos@test'),(3,'Tres','C',NULL,NULL,'tres@test');
    INSERT INTO grupos VALUES (10,'Mayor','',NULL,2,0,'2026-01-01'),(20,'Vacío','',NULL,1,0,'2026-01-02'),(30,'Ajeno','',NULL,3,0,'2026-01-03');
    INSERT INTO usuario_grupo VALUES (1,10,'admin'),(2,10,'miembro'),(1,20,'propietario'),(3,30,'propietario');
    INSERT INTO mensajes_grupo VALUES (1,10,2,'visto',0,0,'2026-01-01',NULL),
      (2,10,1,'mío',0,0,'2026-01-02',NULL),(3,10,2,'/archivo.jpg',0,0,'2026-01-03','lote'),
      (4,30,3,'privado',0,0,'2026-01-04',NULL);
    INSERT INTO mensajes_grupo_vistos VALUES (1,1);
    INSERT INTO chats_favoritos VALUES (1,10,1,'grupo');
    INSERT INTO mensajes_grupo_archivos VALUES (1,10,2,'/archivo.jpg','image/jpeg','archivo.jpg',12,'lote');
  `);
  const routes = new Map();
  const queries = [];
  const router = { use() {} };
  for (const method of ['get','post','put','patch','delete']) router[method] = (path,...fns) => routes.set(path,fns);
  const pool = { async query(sql, args) {
    queries.push({ sql, args });
    return [db.prepare(sql.replaceAll('JSON_ARRAYAGG','json_group_array')).all(...args)];
  } };
  const multer = () => ({ single: () => () => {} });
  multer.diskStorage = config => config;
  load('../routes/grupos.js', { express: { Router: () => router }, multer, '../db': pool,
    '../utils/logger': {}, '../utils/urlUtils': { toAbsoluteUploadUrl: url => url },
    '../middleware/chatRouteSecurity': { chatAuthMiddleware: [], enforceAuthenticatedActor() {} },
    '../middleware/groupAdminSecurity': load('../middleware/groupAdminSecurity.js', { '../db': pool }) });
  async function request({ actor = 1, user = 1, group } = {}) {
    const query = group === undefined ? {} : { grupo_id: group };
    const req = { query, params: { userId: String(user) }, auth: { userId: actor } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    const [guard, route] = routes.get('/usuario-resumen/:userId');
    await guard(req, res, () => route(req, res));
    return res;
  }
  return { request, queries, db };
}

test('el resumen de un grupo equivale a su fila del resumen completo con historial, archivo y no leídos', async t => {
  const { request, queries } = fixture(t);
  const full = (await request()).data;
  assert.equal(full.length, 2);
  for (const group of [10, 20]) {
    const narrow = (await request({ group: String(group) })).data;
    assert.deepEqual(narrow, full.filter(row => row.grupo_id === group));
  }
  assert.equal(full[0].ultimo_archivo_url, '/archivo.jpg');
  assert.equal(full[0].mensajes_no_leidos, 1);
  assert.equal(full[1].ultimo_mensaje_id, null);
  assert.match(queries[1].sql, /ug.usuario_id = \? AND ug.grupo_id = \?/);
  assert.deepEqual(queries[1].args, [1,10,1,1,1,1]);
});

test('el filtro no amplía la membresía ni permite cambiar el usuario de la sesión', async t => {
  const { request, queries } = fixture(t);
  assert.deepEqual((await request({ group: '30' })).data, []);
  assert.equal((await request({ user: 3, group: '30' })).code, 403);
  for (const group of ['0', '-1', '1e1', '9007199254740992', '', ['10']]) {
    assert.equal((await request({ group })).code, 400);
  }
  assert.equal(queries.length, 1);
});


test('el resumen toma el mayor ID y considera solo miembros actuales para el recibo final', async t => {
  const { request, db } = fixture(t);
  const current = async () => (await request({ group: '10' })).data[0];
  db.exec(`
    UPDATE mensajes_grupo SET fecha_envio='2026-01-01', eliminado=1 WHERE id=3;
    INSERT INTO mensajes_grupo_vistos VALUES (3,3),(3,2);
    INSERT INTO usuario_grupo VALUES (3,10,'miembro');
  `);
  let summary = await current();
  assert.equal(summary.ultimo_mensaje_id, 3);
  assert.equal(summary.eliminado, 1);
  assert.equal(summary.visto, 0);
  assert.equal(summary.mensajes_no_leidos, 1);

  db.exec('INSERT INTO mensajes_grupo_vistos VALUES (3,1)');
  summary = await current();
  assert.equal(summary.visto, 1);
  assert.equal(summary.mensajes_no_leidos, 0);

  db.exec('DELETE FROM mensajes_grupo_vistos WHERE mensaje_id=3 AND usuario_id=3');
  assert.equal((await current()).visto, 0);
  db.exec('DELETE FROM usuario_grupo WHERE grupo_id=10 AND usuario_id=3');
  assert.equal((await current()).visto, 1);
});

test('en el resumen un grupo vacío o sin destinatarios del último mensaje se considera visto', async t => {
  const { request, db } = fixture(t);
  const empty = (await request({ group: '20' })).data[0];
  assert.equal(empty.visto, 1);
  assert.equal(empty.mensajes_no_leidos, 0);

  db.exec("INSERT INTO mensajes_grupo VALUES (9,20,1,'solo',0,0,'2026-01-01',NULL)");
  const solo = (await request({ group: '20' })).data[0];
  assert.equal(solo.ultimo_mensaje_id, 9);
  assert.equal(solo.visto, 1);
  assert.equal(solo.mensajes_no_leidos, 0);
});
