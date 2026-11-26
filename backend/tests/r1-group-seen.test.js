const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const vm = require('node:vm');
const { queryWithRetry } = require('../utils/dbRetry');

function loadGroupMessageModule(db, put) {
  const path = require.resolve('../routes/mensajesGrupo.js');
  const mod = { exports: {} };
  const noOp = () => {};
  const multer = () => ({ fields: noOp });
  multer.diskStorage = noOp;
  const stubs = {
    express: { Router: () => ({ use: noOp, get: noOp, post: noOp, put: put || noOp, delete: noOp }) },
    multer, '../db': db, '../utils/logger': { logDev: noOp }, '../utils/dbRetry': { queryWithRetry },
    '../utils/audioOptimizer': {}, '../utils/auditService': {}, '../utils/blacklistService': {},
    '../middleware/chatRouteSecurity': { chatAuthMiddleware: [] },
    '../middleware/groupMessageSecurity': new Proxy({}, { get: () => noOp }),
  };
  vm.runInThisContext('(function(require,module){' + readFileSync(path,'utf8') +
    '\nmodule.exports = markGroupMessagesAsSeen;\n})')(name => stubs[name] || require(name), mod);
  return mod.exports;
}

test('marcado simultáneo conserva vistos únicos, respeta grupo y autor y no repite escrituras posteriores', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE mensajes_grupo(id INTEGER PRIMARY KEY,grupo_id,usuario_id);
    CREATE TABLE mensajes_grupo_vistos(mensaje_id,usuario_id,UNIQUE(mensaje_id,usuario_id));
    WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<260)
      INSERT INTO mensajes_grupo SELECT n,10,2 FROM ids;
    INSERT INTO mensajes_grupo VALUES(261,10,1),(262,11,2);
    INSERT INTO mensajes_grupo_vistos VALUES(1,1);
  `);
  let selections = 0, inserts = 0;
  const db = { async query(sql, args) {
    if (sql.startsWith('SELECT')) {
      selections++;
      return [sqlite.prepare(sql).all(...args)];
    }
    assert.match(sql, /INSERT IGNORE INTO mensajes_grupo_vistos/);
    inserts++;
    const [values] = args;
    const insert = sqlite.prepare('INSERT OR IGNORE INTO mensajes_grupo_vistos VALUES ' +
      values.map(() => '(?,?)').join(','));
    return [{ affectedRows: insert.run(...values.flat()).changes }];
  } };
  const marker = loadGroupMessageModule(db);
  const otherWorker = loadGroupMessageModule(db);
  const [first, shared, competing] = await Promise.all([marker(10,1), marker(10,1), otherWorker(10,1)]);
  assert.equal(first, shared);
  assert.equal(first.totalActualizados + competing.totalActualizados, 259);
  assert.equal(sqlite.prepare('SELECT COUNT(*) total FROM mensajes_grupo_vistos').get().total,260);
  assert.equal(sqlite.prepare('SELECT COUNT(*) total FROM mensajes_grupo_vistos WHERE mensaje_id>260').get().total,0);
  assert.equal(selections,4);
  const previousInserts = inserts;
  assert.equal((await marker(10,1)).totalActualizados,0);
  assert.equal(inserts,previousInserts);
});


test('una sola consulta de seguimiento conserva la fecha y los recibos del evento grupal', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE mensajes_grupo(id INTEGER PRIMARY KEY,grupo_id,usuario_id,fecha_envio);
    CREATE TABLE usuario_grupo(grupo_id,usuario_id);
    CREATE TABLE mensajes_grupo_vistos(mensaje_id,usuario_id,UNIQUE(mensaje_id,usuario_id));
    INSERT INTO usuario_grupo VALUES (10,1),(10,2);
    INSERT INTO mensajes_grupo VALUES
      (1,10,2,'2026-11-20'),(2,10,2,'2026-11-19'),(3,11,3,'2026-11-25');
    INSERT INTO mensajes_grupo_vistos VALUES (1,2);
  `);
  const statements = [];
  const db = { async query(sql, args) {
    statements.push(sql);
    if (sql.startsWith('SELECT')) return [sqlite.prepare(sql).all(...args)];
    const [values] = args;
    const insert = sqlite.prepare('INSERT OR IGNORE INTO mensajes_grupo_vistos VALUES ' +
      values.map(() => '(?,?)').join(','));
    return [{ affectedRows: insert.run(...values.flat()).changes }];
  } };
  let handler;
  loadGroupMessageModule(db, (path, _guard, fn) => {
    if (path === '/marcar-vistos-grupo') handler = fn;
  });
  const notifications = [];
  const services = {
    io: { to: room => ({ emit: (...args) => notifications.push([room, ...args]) }) },
    socketUtils: { enviarEventoAlUsuario: (...args) => notifications.push(args) },
  };
  const req = { auth: { userId: 1 }, body: { grupoId: 10 }, app: { get: key => services[key] } };
  let response;
  const res = { json: data => { response = data; } };

  await handler(req, res);
  assert.deepEqual(response, { success: true, actualizados: 2 });
  assert.equal(statements.length, 3);
  assert.match(statements[2], /ORDER BY fecha_envio DESC/);
  assert.deepEqual(notifications, [
    [1, 'actualizarNoVistosGrupo', { grupoId: 10, reset: true }],
    ['grupo_10', 'todosMensajesVistosGrupo', { grupoId: 10, mensajeId: 1 }],
  ]);

  await handler(req, res);
  assert.deepEqual(response, { success: true, actualizados: 0 });
  assert.equal(statements.length, 4);
  assert.equal(notifications.length, 3);
});
