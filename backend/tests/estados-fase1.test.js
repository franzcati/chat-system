const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const routePath = path.resolve(__dirname, '../routes/estados.js');
const localRequire = createRequire(routePath);

// Adapta sintaxis de consultas para comprobar la lógica con SQLite en memoria.
// No ejecuta DDL de MariaDB ni reproduce el bloqueo de InnoDB.
function fixture(t, { enabled = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quickchat-estados-'));
  t.after(() => {
    sql.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  sql.exec(`
    CREATE TABLE usuario (id INTEGER PRIMARY KEY, instancia_id, estado, permisos_chat, nombre, apellido, url_imagen);
    CREATE TABLE grupos (id INTEGER PRIMARY KEY, propietario_id, nombre, imagen_url);
    CREATE TABLE usuario_grupo (grupo_id, usuario_id, rol, PRIMARY KEY (grupo_id, usuario_id));
    CREATE TABLE chat_estados (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instancia_id, autor_id, grupo_id, tipo, texto, fondo, archivo,
      mime, visible_instancia, clave_envio, huella_envio, apariencia, leyenda, creado_at, vence_at, eliminado_at,
      UNIQUE (instancia_id, autor_id, clave_envio)
    );
    CREATE TABLE chat_estado_grupos (estado_id INTEGER, grupo_id INTEGER, PRIMARY KEY (estado_id, grupo_id));
    CREATE TABLE chat_estado_reacciones (
      estado_id INTEGER, usuario_id INTEGER, creado_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (estado_id, usuario_id)
    );
    CREATE TABLE chat_estado_vistas (estado_id INTEGER, usuario_id INTEGER, visto_at, PRIMARY KEY (estado_id, usuario_id));
    CREATE TABLE respuestas (grupo, destinatario, mensaje);
    INSERT INTO usuario VALUES
      (1,1,'aprobado','{"publicar_estados":1}','Autor','',''),
      (2,1,'aprobado','{}','Lector','',''),
      (3,1,'aprobado','{"publicar_estados":1}','Ajeno','',''),
      (4,2,'aprobado','{"publicar_estados":1}','Otra instancia','',''),
      (5,1,'aprobado','{"publicar_estados":1}','Dueño','','');
    INSERT INTO grupos VALUES (10,5,'Uno','/uploads/grupo-1.png'),(20,1,'Dos',NULL),(30,4,'Externo',NULL),(40,1,'Otro',NULL);
    INSERT INTO usuario_grupo VALUES
      (10,1,'admin'),(10,2,'miembro'),(10,3,'miembro'),(20,1,'propietario'),
      (30,1,'admin'),(30,4,'propietario'),(40,1,'propietario'),(40,2,'miembro');
    INSERT INTO chat_estados (id, instancia_id, autor_id, grupo_id, texto, vence_at) VALUES
      (100,1,1,NULL,'Personal anterior','2099-01-01'),
      (101,1,1,10,'Grupal anterior','2099-01-01');
  `);
  const pool = {
    injectChildFailure: false,
    commitWithoutAck: false,
    async query(source, args = []) {
      if (source === 'SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id') {
        return [[sql.prepare('SELECT CAST(last_insert_rowid() AS TEXT) AS id').get()]];
      }
      if (source.startsWith('INSERT INTO chat_estado_grupos')) {
        if (pool.injectChildFailure) throw new Error('Fallo simulado al guardar destinos');
        source = source.replace('VALUES ?', 'VALUES ' + args[0].map(() => '(?,?)').join(','));
        args = args[0].flat();
      }
      if (source.includes('g.id IN (?)')) {
        source = source.replace('g.id IN (?)', 'g.id IN (' + args[2].map(() => '?').join(',') + ')');
        args = [args[0], args[1], ...args[2]];
      }
      source = source.replaceAll('UTC_TIMESTAMP(3)', 'CURRENT_TIMESTAMP')
        .replace('DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 24 HOUR)', "datetime('now','+24 hours')")
        .replace(/\bFOR UPDATE\b/g, '').replaceAll(' AS UNSIGNED)', ' AS INTEGER)')
        .replaceAll(' AS CHAR)', ' AS TEXT)').replaceAll('JSON_ARRAYAGG', 'json_group_array')
        .replace('ON DUPLICATE KEY UPDATE visto_at=chat_estado_vistas.visto_at', 'ON CONFLICT DO NOTHING')
        .replace('ON DUPLICATE KEY UPDATE creado_at=chat_estado_reacciones.creado_at', 'ON CONFLICT DO NOTHING');
      const statement = sql.prepare(source);
      if (/^SELECT/.test(source)) return [statement.all(...args)];
      const result = statement.run(...args);
      return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
    },
    async getConnection() {
      return {
        query: pool.query,
        beginTransaction() { sql.exec('BEGIN'); },
        rollback() { sql.exec('ROLLBACK'); },
        commit() {
          sql.exec('COMMIT');
          if (pool.commitWithoutAck) throw Object.assign(new Error('Sin confirmación'), { code: 'SIMULADO' });
        },
        release() {},
        destroy() {},
      };
    },
  };
  const middleware = [];
  const routes = new Map();
  const router = { use: (...handlers) => middleware.push(...handlers) };
  for (const method of ['get', 'post', 'put', 'delete']) {
    router[method] = (url, ...handlers) => routes.set(method + url, handlers);
  }
  function multer() {
    return { single: () => (_req, _res, next) => next() };
  }
  multer.diskStorage = config => config;
  multer.MulterError = class extends Error {};
  const authPath = localRequire.resolve('../middleware/chatRouteSecurity');
  const auth = { exports: {} };
  const noopAuth = (_req, _res, next) => next();
  const authStubs = {
    './requireAuth': { requireAuth: noopAuth }, './resolveInstance': { resolveInstance: noopAuth },
  };
  vm.runInThisContext('(function(require, module) {' +
    fs.readFileSync(authPath, 'utf8') + '\n})')(id => authStubs[id], auth);

  const dependencies = {
    express: { Router: () => router }, multer, '../db': pool,
    '../middleware/chatRouteSecurity': auth.exports,
    './mensajes': { async sendPrivateMessage(req, res, persist) {
      await persist('INSERT INTO respuestas VALUES (NULL,?,?)', [req.body.receiverId, req.body.message]);
      res.status(201).json(req.body);
    } },
    './mensajesGrupo': { async sendGroupMessage(req, res, persist) {
      await persist('INSERT INTO respuestas VALUES (?,NULL,?)', [req.body.grupoId, req.body.mensaje]);
      res.status(201).json(req.body);
    } },
  };
  const native = { exports: {} };
  const resolve = id => dependencies[id] || localRequire(id);
  vm.runInThisContext('(function(require, module, __dirname, process) {' +
    fs.readFileSync(routePath, 'utf8') + '\n})')(resolve, native, temp, { env: { ESTADOS_MULTIDESTINO: enabled ? '1' : '0' } });
  async function request(method, url, options = {}) {
    const actor = options.actor || 1;
    const user = sql.prepare('SELECT * FROM usuario WHERE id=?').get(actor);
    const req = {
      auth: { userId: actor, usuario: user },
      instanciaActual: { id: options.portal || user.instancia_id },
      params: { id: options.id },
      get: name => options.headers?.[name],
      body: options.body,
      file: options.file,
    };
    const res = {
      code: 200, set() {}, status(code) { this.code = code; return this; },
      json(value) { this.data = value; return this; }, sendFile(file) { this.file = file; }, end() {},
    };
    const handlers = [...middleware, ...routes.get(method + url)];
    let next = async () => {};
    for (const handler of handlers.reverse()) {
      const downstream = next;
      next = async () => {
        let pending;
        await handler(req, res, () => { pending = downstream(); });
        await pending;
      };
    }
    await next();
    return res;
  }
  const modern = (key, personal, groups, options = {}) => request('post', '/', {
    ...options, headers: { 'Idempotency-Key': key },
    body: { texto: 'Estado', destinos: { mi_estado: personal, grupos: groups } },
  });
  const feed = async actor => (await request('get', '/', { actor, headers: { 'X-Estados-Contrato': '2' } })).data.estados;
  return { sql, request, modern, feed, pool, temp };
}

test('publica personal, un grupo, varios grupos y audiencia combinada con una sola cabecera', async t => {
  const { modern, sql, feed } = fixture(t);
  for (const [key, personal, groups] of [
    ['personal', true, []], ['uno', false, [10]],
    ['varios', false, [10, 20]], ['mixto', true, [10, 20]],
  ]) {
    const res = await modern(key, personal, groups);
    assert.equal(res.code, 201);
    const row = sql.prepare('SELECT * FROM chat_estados WHERE id=?').get(res.data.id);
    assert.equal(row.visible_instancia, Number(personal));
    assert.equal(row.grupo_id, null);
    const targets = sql.prepare('SELECT grupo_id FROM chat_estado_grupos WHERE estado_id=? ORDER BY grupo_id').all(row.id);
    assert.deepEqual(targets.map(item => item.grupo_id), groups);
  }
  const reader = await feed(2);
  assert.equal(reader.length, 6);
  assert.equal(new Set(reader.map(item => item.id)).size, reader.length);
  assert.deepEqual(reader.find(item => item.id === '104').destinos.grupos.map(group => group.id), [10]);
  assert.deepEqual(await feed(4), []);
  assert.equal((await modern('portal-incorrecto', true, [], { actor: 4, portal: 1 })).code, 403);
});

test('conserva la proyección y escritura antiguas, y oculta estados a lectores sin acceso', async t => {
  const { modern, request, feed, sql } = fixture(t);
  const old = await request('get', '/', { actor: 2 });
  assert.deepEqual(old.data.estados.map(row => row.id).sort(), [100, 101]);
  assert.equal((await request('post', '/', { body: { texto: 'Personal' } })).code, 201);
  assert.equal((await request('post', '/', { body: { texto: 'Grupo', grupo_id: '10' } })).code, 201);
  const groupOnly = await modern('solo', false, [20]);
  assert.equal((await feed(2)).some(item => item.id === groupOnly.data.id), false);
  assert.equal((await request('get', '/:id/media', { actor: 2, id: groupOnly.data.id })).code, 404);
  assert.equal((await request('post', '/:id/vista', { actor: 2, id: groupOnly.data.id })).code, 404);
  assert.equal((await request('post', '/:id/vista', { actor: 4, id: '100' })).code, 404);
  sql.exec("UPDATE usuario SET estado='suspendido' WHERE id=1");
  assert.deepEqual(await feed(2), []);
  assert.equal((await request('post', '/:id/vista', { actor: 2, id: '100' })).code, 404);
});

test('rechaza destinos mixtos con un grupo externo o rol insuficiente y revierte un fallo de escritura', async t => {
  const { modern, sql, pool, temp } = fixture(t);
  const before = () => sql.prepare('SELECT COUNT(*) AS n FROM chat_estados').get().n;
  assert.equal((await modern('externo', true, [10, 30])).code, 403);
  assert.equal((await modern('miembro', true, [10], { actor: 3 })).code, 403);
  assert.equal((await modern('sin-permiso', true, [], { actor: 2 })).code, 403);
  assert.equal((await modern('vacio', false, [])).code, 400);
  assert.equal(before(), 2);
  pool.injectChildFailure = true;
  const file = { path: path.join(temp, 'fallo.png'), filename: 'fallo.png', mimetype: 'image/png' };
  fs.writeFileSync(file.path, 'bytes de prueba');
  assert.equal((await modern('fallo', true, [10, 20], { file })).code, 500);
  assert.equal(before(), 2);
  assert.equal(fs.existsSync(file.path), false);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_estado_grupos').get().n, 0);
});

test('reintentar tras un commit sin confirmación conserva el ID y un solo archivo', async t => {
  const { modern, sql, pool, temp } = fixture(t);
  function newFile(name, content) {
    const file = { path: path.join(temp, name), filename: name, mimetype: 'image/png' };
    fs.writeFileSync(file.path, content);
    return file;
  }
  pool.commitWithoutAck = true;
  const first = newFile('primero.png', 'mismos bytes');
  assert.equal((await modern('reintento', true, [10, 20], { file: first })).code, 503);
  pool.commitWithoutAck = false;
  const duplicate = newFile('reintento.png', 'mismos bytes');
  const replay = await modern('reintento', true, [20, 10, 10], { file: duplicate });
  assert.equal(replay.code, 200);
  const row = sql.prepare('SELECT id,archivo FROM chat_estados WHERE clave_envio=?').get('reintento');
  assert.equal(replay.data.id, String(row.id));
  assert.equal(row.archivo, first.filename);
  assert.equal(fs.existsSync(first.path), true);
  assert.equal(fs.existsSync(duplicate.path), false);
  const conflict = newFile('distinto.png', 'distinto');
  assert.equal((await modern('reintento', true, [10, 20], { file: conflict })).code, 409);
  assert.equal(fs.existsSync(conflict.path), false);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_estados WHERE clave_envio=?').get('reintento').n, 1);
});

test('responde sólo en el contexto permitido y registra una vista por persona', async t => {
  const { modern, request, sql } = fixture(t);
  const { data: { id } } = await modern('respuesta', true, [10, 20]);
  const response = destino => request('post', '/:id/responder', { actor: 2, id, body: { mensaje: 'Hola', destino } });
  assert.equal((await response({ tipo: 'grupo', grupo_id: 20 })).code, 404);
  assert.equal((await response({ tipo: 'grupo', grupo_id: 40 })).code, 404);
  assert.equal((await response({ tipo: 'grupo', grupo_id: 10 })).code, 201);
  assert.equal((await response({ tipo: 'personal' })).code, 201);
  const messages = sql.prepare('SELECT grupo, destinatario FROM respuestas ORDER BY rowid').all();
  assert.deepEqual(messages.map(row => [row.grupo, row.destinatario]), [[10, null], [null, 1]]);
  for (let i = 0; i < 2; i++) {
    assert.equal((await request('post', '/:id/vista', { actor: 2, id })).code, 200);
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_estado_vistas').get().n, 1);
});

test('perder el último destino grupal no vuelve personal el estado', async t => {
  const { modern, feed, sql } = fixture(t);
  const res = await modern('destino-eliminado', false, [10]);
  assert.equal((await feed(2)).some(item => item.id === res.data.id), true);
  sql.prepare('DELETE FROM chat_estado_grupos WHERE estado_id=?').run(Number(res.data.id));
  assert.equal((await feed(2)).some(item => item.id === res.data.id), false);
  assert.equal((await feed(1)).some(item => item.id === res.data.id), false);
});

test('sirve un archivo sólo a miembros y el borrado se aplica a todos los destinos', async t => {
  const { modern, request, feed, temp } = fixture(t);
  const file = { path: path.join(temp, 'privado.png'), filename: 'privado.png', mimetype: 'image/png' };
  fs.writeFileSync(file.path, 'bytes de prueba');
  const { data: { id } } = await modern('archivo', false, [10, 20], { file });
  assert.equal((await request('get', '/:id/media', { actor: 2, id })).file.endsWith('privado.png'), true);
  assert.equal((await request('get', '/:id/media', { actor: 4, id })).code, 404);
  assert.equal((await request('delete', '/:id', { actor: 2, id })).code, 404);
  assert.equal((await request('delete', '/:id', { actor: 1, id })).code, 200);
  assert.equal((await request('get', '/:id/media', { actor: 2, id })).code, 404);
  assert.equal((await feed(1)).some(item => item.id === id), false);
});

test('desactivar la escritura multidestino conserva la publicación antigua', async t => {
  const { modern, request, sql } = fixture(t, { enabled: false });
  assert.equal((await modern('apagado', true, [10])).code, 503);
  assert.equal((await request('post', '/', { body: { texto: 'Personal antiguo' } })).code, 201);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_estados WHERE visible_instancia IS NOT NULL').get().n, 0);
});

test('persiste formato y leyenda y los incluye al identificar reintentos', async t => {
  const { request, feed } = fixture(t);
  const appearance = { paleta: 'aurora', alineacion: 'left', tema: 'dark', negrita: true, cursiva: true, subrayado: true };
  const submit = style => request('post', '/', {
    headers: { 'Idempotency-Key': 'formato' },
    body: { texto: '<b>texto plano</b>', destinos: { mi_estado: true, grupos: [10] },
      apariencia: JSON.stringify(style), leyenda: 'Leyenda' },
  });
  const created = await submit(appearance);
  assert.equal(created.code, 201);
  const row = (await feed(2)).find(item => item.id === created.data.id);
  assert.deepEqual(row.apariencia, appearance);
  assert.equal(row.texto, '<b>texto plano</b>');
  assert.equal(row.leyenda, 'Leyenda');
  assert.equal((await submit(appearance)).code, 200);
  assert.equal((await submit({ ...appearance, negrita: false })).code, 409);
  assert.equal((await submit({ ...appearance, alineacion: '<b>' })).code, 400);
});

test('acepta GIF con cabecera válida y rechaza un archivo mal etiquetado', async t => {
  const { modern, request, sql, temp } = fixture(t);
  const makeGif = (name, bytes) => {
    const file = { path: path.join(temp, name), filename: name, mimetype: 'image/gif' };
    fs.writeFileSync(file.path, bytes);
    return file;
  };
  const gif = makeGif('activo.gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  const result = await modern('gif-valido', false, [10], { file: gif });
  assert.equal(result.code, 201);
  assert.equal(sql.prepare('SELECT mime FROM chat_estados WHERE id=?').get(result.data.id).mime, 'image/gif');
  assert.ok((await request('get', '/:id/media', { actor: 2, id: result.data.id })).file);
  const invalid = makeGif('invalido.gif', 'archivo sin cabecera gif');
  assert.equal((await modern('gif-invalido', true, [], { file: invalid })).code, 415);
  assert.equal(fs.existsSync(invalid.path), false);
});

test('devuelve el avatar y el total de miembros aprobados en grupos publicables', async t => {
  const { sql, request } = fixture(t);
  sql.exec("INSERT INTO usuario_grupo VALUES (10,4,'miembro'); UPDATE usuario SET estado='suspendido' WHERE id=3");
  const { data } = await request('get', '/grupos');
  const group = data.grupos.find(item => item.id === 10);
  assert.equal(group.imagen_url, '/uploads/grupo-1.png');
  assert.equal(group.miembros_cantidad, 2);
  assert.equal(data.grupos.some(item => item.id === 30), false);
});

test('el corazón se comparte por estado entre destinos, persiste y se quita sin duplicar filas', async t => {
  const { modern, request, feed, sql } = fixture(t);
  const { data: { id } } = await modern('reaccion-mixta', true, [10, 20]);
  const react = reaccion => request('put', '/:id/reaccion', { id, actor: 2, body: { reaccion } });
  assert.equal((await react(true)).data.reaccion_propia, true);
  assert.equal((await react(true)).code, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_estado_reacciones').get().n, 1);
  const state = (await feed(2)).find(item => item.id === id);
  assert.equal(state.reaccion_propia, true);
  assert.equal(state.destinos.mi_estado, true);
  assert.deepEqual(state.destinos.grupos.map(group => group.id), [10]);
  assert.equal((await feed(3)).find(item => item.id === id).reaccion_propia, false);
  assert.equal((await react(false)).data.reaccion_propia, false);
  assert.equal((await react(false)).code, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM chat_estado_reacciones').get().n, 0);
});

test('reacción requiere visibilidad, instancia compatible y un lector distinto del autor', async t => {
  const { modern, request, sql } = fixture(t);
  const { data: { id } } = await modern('reaccion-privada', false, [10]);
  const react = (actor, reaccion = true, targetId = id, portal) =>
    request('put', '/:id/reaccion', { id: targetId, actor, portal, body: { reaccion } });

  assert.equal((await react(1)).code, 403);
  assert.equal((await react(4)).code, 404);
  assert.equal((await react(4, true, id, 1)).code, 403);
  assert.equal((await react(2, 'true')).code, 400);
  assert.equal((await react(2, true, 'sin-id')).code, 404);
  assert.equal((await react(2, true, '100')).code, 200); // Estado personal histórico.
  assert.equal((await react(2)).code, 200);
  sql.exec('DELETE FROM usuario_grupo WHERE usuario_id=2 AND grupo_id=10');
  assert.equal((await react(2, false)).code, 404);
  assert.equal((await react(2, true, '101')).code, 404); // Estado grupal histórico.
  sql.prepare("UPDATE chat_estados SET vence_at='2000-01-01' WHERE id=?").run(id);
  assert.equal((await react(3)).code, 404);
  await request('delete', '/:id', { id: '100' });
  assert.equal((await react(2, false, '100')).code, 404);
});

test('vence en 24 horas y deja de admitir listado, medios, vista, respuesta y reacción', async t => {
  const { modern, request, feed, sql, temp } = fixture(t);
  const file = { path: path.join(temp, 'estado.webm'), filename: 'estado.webm', mimetype: 'video/webm' };
  fs.writeFileSync(file.path, 'medio de prueba');
  const { code, data: { id } } = await modern('vence-multimedia', false, [10], { file });
  assert.equal(code, 201);
  const row = sql.prepare('SELECT archivo, tipo, creado_at, vence_at FROM chat_estados WHERE id=?').get(id);
  assert.equal(row.tipo, 'video');
  assert.equal(row.archivo, file.filename);
  assert.equal(Date.parse(row.vence_at.replace(' ', 'T') + 'Z') - Date.parse(row.creado_at.replace(' ', 'T') + 'Z'), 86400000);
  assert.ok((await feed(2)).some(item => item.id === id));
  sql.prepare("UPDATE chat_estados SET vence_at='2000-01-01' WHERE id=?").run(id);
  assert.ok(!(await feed(2)).some(item => item.id === id));
  const reader = { actor: 2, id };
  for (const [method, route, body] of [
    ['get', '/:id/media'], ['post', '/:id/vista'],
    ['post', '/:id/responder', { mensaje: 'Prueba', destino: { tipo: 'grupo', grupo_id: 10 } }],
    ['put', '/:id/reaccion', { reaccion: true }],
  ]) assert.equal((await request(method, route, { ...reader, body })).code, 404);
});

test('detalle de vistas exclusivo para el autor, deduplicado y con reacción real', async t => {
  const { request, feed, sql } = fixture(t);
  const viewers = actor => request('get', '/:id/vistas', { actor, id: 101 });
  assert.equal((await viewers(1)).data.personas.length, 0);
  for (const actor of [1, 2, 2]) await request('post', '/:id/vista', { actor, id: 101 });
  await request('put', '/:id/reaccion', { actor: 2, id: 101, body: { reaccion: true } });
  const people = (await viewers(1)).data.personas;
  assert.deepEqual(people.map(p => [p.id, p.reaccion]), [[2, 1]]);
  assert.equal((await feed(1)).find(x => Number(x.id) === 101).vistas, 1);
  assert.equal((await viewers(2)).code, 404);
  assert.equal((await viewers(4)).code, 404);
  sql.prepare("UPDATE chat_estados SET vence_at='2000-01-01' WHERE id=101").run();
  assert.equal((await viewers(1)).code, 404);
});

test('cita autorizada para respuestas nuevas y antiguas, sin URL ni archivo', async t => {
  const { request, sql } = fixture(t);
  for (const [tipo, mime, medium] of [['imagen','image/png','Foto'],['imagen','image/gif','GIF'],['video','video/mp4','Video'],['texto',null,'Texto']]) {
    for (const caption of ['', 'Promoción con "comillas"']) {
      const text = tipo === 'texto' ? 'Texto original' : caption;
      sql.prepare('UPDATE chat_estados SET tipo=?, mime=?, texto=?, leyenda=? WHERE id=101')
        .run(tipo, mime, text, tipo === 'texto' ? caption : '');
      const options = { actor: 2, id: 101 };
      const ref = (await request('get', '/:id/referencia', options)).data;
      assert.deepEqual(ref, { id: '101', author: 'Autor', medium, excerpt: text, caption: tipo === 'texto' ? caption : '' });
      const result = await request('post','/:id/responder',{ ...options, body: { destino: { tipo:'grupo', grupo_id:10 }, mensaje:'precio' } });
      assert.equal(result.code, 201);
      assert.equal(result.data.mensaje, '↪ Estados ' + JSON.stringify(ref) + '\nprecio');
    }
  }
  assert.equal((await request('get','/:id/referencia',{ actor:4,id:101 })).code, 404);
  sql.prepare("UPDATE chat_estados SET eliminado_at=CURRENT_TIMESTAMP WHERE id=101").run();
  assert.equal((await request('get','/:id/referencia',{ actor:2,id:101 })).code, 404);
});

test('solo el autor recibe la señal agregada de corazones al abrir', async t => {
  const { request, feed } = fixture(t);
  const item = async actor => (await feed(actor)).find(row => row.id === '101');
  assert.equal((await item(1)).tiene_reacciones, false);
  await request('put','/:id/reaccion',{ actor:2,id:101,body:{ reaccion:true } });
  assert.equal((await item(1)).tiene_reacciones, true);
  assert.equal((await item(2)).reaccion_propia, true);
  assert.equal(Object.hasOwn(await item(3), 'tiene_reacciones'), false);
  await request('put','/:id/reaccion',{ actor:2,id:101,body:{ reaccion:false } });
  assert.equal((await item(1)).tiene_reacciones, false);
});

test('fuentes permitidas persisten en apariencia y cita sin ampliar la columna histórica', async t => {
  const { request, feed } = fixture(t);
  const base = { paleta: 'aurora', alineacion: 'center', tema: 'dark', negrita: false, cursiva: false, subrayado: false };
  for (const fuente of ['predeterminada','moderna','clasica','manuscrita','mono','redondeada']) {
    const appearance = { ...base, fuente };
    const created = await request('post','/', { headers: {'Idempotency-Key': 'font-'+fuente}, body: {
      texto:'Texto', destinos:{mi_estado:true, grupos:[10]}, apariencia:JSON.stringify(appearance)
    } });
    assert.equal(created.code,201);
    assert.ok(JSON.stringify(appearance).length <= 160);
    const row = (await feed(2)).find(item => item.id === created.data.id);
    assert.deepEqual(row.apariencia, appearance);
    assert.equal((await request('get','/:id/referencia',{actor:2,id:created.data.id})).data.fuente, fuente);
  }
  const invalid = await request('post','/', { headers: {'Idempotency-Key':'font-invalid'}, body: {
    texto:'Texto', destinos:{mi_estado:true, grupos:[]}, apariencia:JSON.stringify({...base,fuente:'url(fake)'})
  } });
  assert.equal(invalid.code,400);
});
