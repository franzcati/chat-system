const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE roles (id,nombre,alcance_admin);
    CREATE TABLE proyecto (id INTEGER PRIMARY KEY,nombre,instancia_id);
    CREATE TABLE usuario (id INTEGER PRIMARY KEY,nombre,apellido,correo,url_imagen,instancia_id,rol_id,estado);
    CREATE TABLE usuario_proyecto (usuario_id,proyecto_id);
    CREATE TABLE security_credentials (id INTEGER PRIMARY KEY, instancia_id,proyecto_id,responsable_id,plataforma,cuenta,nombre,creado_por_id,estado,created_at);
    CREATE TABLE security_credential_access (credential_id,usuario_id);
    INSERT INTO security_credentials VALUES (1,1,10,3,'CRM','A','Uno',1,'activo','2026'), (2,1,20,4,'CRM','B','Dos',1,'activo','2026'),
      (3,2,30,5,'CRM','C','Tres',1,'activo','2026'), (4,1,NULL,4,'CRM','D','Sin proyecto',1,'activo','2026'),
      (5,1,NULL,3,'CRM','E','Responsable en dos proyectos',1,'activo','2026'),
      (6,1,NULL,6,'CRM','F','Propia antigua',6,'activo','2026');
    INSERT INTO security_credential_access VALUES (5,6);
    CREATE TABLE security_policy (instancia_id INTEGER PRIMARY KEY,timezone DEFAULT 'UTC', daily_offhours_limit DEFAULT 10,step_up_offhours DEFAULT 1);
    CREATE TABLE security_hours (instancia_id,weekday,enabled,start_time,end_time,PRIMARY KEY(instancia_id,weekday));
    CREATE TABLE security_project_hours (instancia_id,proyecto_id,weekday,enabled,start_time,end_time,PRIMARY KEY(instancia_id,proyecto_id,weekday));
    CREATE TABLE security_exceptions (id INTEGER PRIMARY KEY,instancia_id,proyecto_id,usuario_id,local_date,enabled,start_time,end_time,reason,approved_by_id);
    CREATE TABLE security_user_limits (instancia_id,usuario_id,max_credentials,daily_offhours_limit);
    INSERT INTO roles VALUES (1,'admin','organizacion'),(2,'moderador','proyectos'),(3,'User','proyectos');
    INSERT INTO proyecto VALUES (10,'Uno',1),(20,'Dos',1),(30,'Otra instancia',2);
    INSERT INTO usuario VALUES (1,'Admin','','','',1,1,'aprobado'),(2,'Mod','','','',1,2,'aprobado'),
      (3,'Compartido','','','',1,2,'aprobado'),(4,'Externo','','','',1,2,'aprobado'),(5,'Otra instancia','','','',2,2,'aprobado'),(6,'User','','','',1,3,'aprobado');
    INSERT INTO usuario_proyecto VALUES (2,10),(3,10),(3,20),(4,20),(5,30),(6,10);
  `);
  async function query(source, args = []) {
    const parameters = [...args];
    let cursor = 0;
    source = source.replace(/IN \(\?\)|VALUES \?|\?/g, token => {
      const value = parameters[cursor];
      if (!Array.isArray(value)) { cursor++; return token; }
      if (token === 'VALUES ?') {
        parameters.splice(cursor, 1, ...value.flat());
        cursor += value.flat().length;
        return 'VALUES ' + value.map(row => '(' + row.map(() => '?').join(',') + ')').join(',');
      }
      parameters.splice(cursor, 1, ...value);
      cursor += value.length;
      return 'IN (' + value.map(() => '?').join(',') + ')';
    }).replace('CURDATE()', "date('now')").replace('INSERT IGNORE','INSERT OR IGNORE');
    source = source.replace(/ON DUPLICATE KEY UPDATE (.*)/s, (_match, assignments) =>
      'ON CONFLICT DO UPDATE SET ' + assignments.replace(/VALUES\((\w+)\)/g, 'excluded.$1'));
    const stmt = sqlite.prepare(source);
    if (source.trim().startsWith('SELECT')) return [stmt.all(...parameters)];
    const result = stmt.run(...parameters);
    return [{ insertId: result.lastInsertRowid, affectedRows: result.changes }];
  }
  const db = { query, async getConnection() { return { query,
    beginTransaction: () => sqlite.exec('BEGIN'), commit: () => sqlite.exec('COMMIT'),
    rollback: () => { if (sqlite.isTransaction) sqlite.exec('ROLLBACK'); }, release() {} }; } };
  function load(relative, overrides) {
    const path = require.resolve(relative);
    const original = createRequire(path);
    const mod = { exports: {} };
    vm.runInThisContext('(function(require,module){' + readFileSync(path,'utf8') + '\n})')(
      name => Object.hasOwn(overrides,name) ? overrides[name] : original(name), mod);
    return mod.exports;
  }
  const roles = load('../utils/roleAccess', { '../db': db });
  const utils = load('../utils/securityCenter', {
    '../db': db, './mfaService': {}, './telegramAlertFormat': {}, './securityEventLabels': {}, './telegramApi': {}
  });
  const routes = new Map();
  const router = { use() {} };
  for (const method of ['get','post','put','patch','delete']) router[method] = (path, ...handlers) => routes.set(method + path, handlers.at(-1));
  load('../routes/securityCenter', {
    express: { Router: () => router }, '../db': db, '../middleware/requireAuth': {
      requireAuth() {}, requirePermission() {}, requireAnyPermission() {}, hasPermission: req => req.auth.userId !== 6
    }, '../middleware/resolveInstance': {}, '../utils/roleAccess': roles,
    '../utils/securityCenter': { ...utils, event: async () => {} }, '../utils/mfaService': {},
    '../utils/telegramAlertFormat': {}, '../utils/telegramApi': {}, '../utils/securityBrand': { securityBrand: () => 'Test' },
    '../utils/securityProjects': {}
  });
  async function call(method,path,actor,{query = {},body = {},params = {}} = {}) {
    const req = { auth: {userId:actor}, instanciaActual: {id:1},query,body,params };
    const res = { code:200, status(code) {this.code=code;return this;}, json(data) {this.data=data;return this;} };
    await routes.get(method+path)(req,res);
    return res;
  }
  return { call, sqlite, db, workStatus: utils.workStatus };
}

const hours = Array.from({length:7},(_,weekday) => ({weekday,enabled:true,start_time:'00:00',end_time:'23:59'}));
const exception = {local_date:'2099-01-01',enabled:false,reason:'Prueba'};

test('scope de proyectos y usuarios, incluyendo rechazo de proyecto de otra instancia', async t => {
  const {call} = fixture(t);
  assert.deepEqual((await call('get','/projects',1)).data.projects.map(p=>p.id),[20,10]);
  assert.deepEqual((await call('get','/projects',2)).data.projects.map(p=>p.id),[10]);
  assert.equal((await call('get','/users',2,{query:{proyecto_id:20}})).code,403);
  assert.equal((await call('get','/users',1,{query:{proyecto_id:30}})).code,403);
  assert.deepEqual((await call('get','/users',2,{query:{proyecto_id:10}})).data.users.map(u=>u.id).sort(),[2,3,6]);
});

test('horario global y horario específico quedan separados y se usan al evaluar una consulta', async t => {
  const {call,db,workStatus} = fixture(t);
  const body = {timezone:'UTC',daily_offhours_limit:10,step_up_offhours:true,hours};
  assert.equal((await call('put','/policy',2,{body})).code,403);
  assert.equal((await call('put','/policy',1,{body})).code,200);
  assert.equal((await call('get','/policy',2,{query:{proyecto_id:10}})).data.inherits_global,true);
  assert.equal((await call('put','/policy',2,{body:{...body,proyecto_id:10,hours:hours.map(h=>({...h,enabled:false}))}})).code,200);
  assert.equal((await call('get','/policy',2,{query:{proyecto_id:10}})).data.hours[0].enabled,0);
  assert.equal((await call('get','/policy',1,{query:{proyecto_id:20}})).data.hours[0].enabled,1);
  assert.equal((await workStatus(db,1,3,{timezone:'UTC'},10)).outside,true);
});

test('excepciones por instancia, proyecto y usuarios se guardan con alcance y sin escrituras parciales', async t => {
  const {call,sqlite} = fixture(t);
  const save = (actor, body)=>call('post','/exceptions',actor,{body:{...exception,...body}});
  assert.equal((await save(2,{scope:'instance'})).code,403);
  assert.equal((await save(1,{scope:'instance'})).code,201);
  assert.equal((await save(2,{scope:'project',proyecto_id:20})).code,403);
  assert.equal((await save(2,{scope:'project',proyecto_id:10})).code,201);
  assert.equal((await save(2,{scope:'users',proyecto_id:10,usuario_ids:[3,4]})).code,403);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM security_exceptions').get().n,2);
  assert.equal((await save(2,{scope:'users',usuario_ids:[2,3,3]})).code,201);
  const rows = sqlite.prepare('SELECT proyecto_id,usuario_id FROM security_exceptions ORDER BY id').all();
  assert.deepEqual(rows.map(r=>[r.proyecto_id,r.usuario_id]),[[null,null],[10,null],[10,2],[10,3]]);
  assert.equal((await call('delete','/exceptions/:id',2,{params:{id:1}})).code,403);
  assert.equal((await call('delete','/exceptions/:id',2,{params:{id:2}})).code,200);
});

test('el filtro de credenciales se aplica en la consulta y conserva el aislamiento entre instancias', async t => {
  const {call} = fixture(t);
  const codes = async (actor, proyecto_id) => call('get','/credentials',actor,{query:{proyecto_id}});
  const ids = async (actor, project) => (await codes(actor, project)).data.credentials.map(c=>c.id).sort();
  assert.deepEqual(await ids(1),[1,2,4,5,6]);
  assert.deepEqual(await ids(1,10),[1,5,6]);
  assert.deepEqual(await ids(1,20),[2,4,5]);
  assert.deepEqual(await ids(2),[1,5,6]);
  assert.deepEqual(await ids(2,10),[1,5,6]);
  assert.equal((await codes(2,20)).code,403);
  assert.equal((await codes(1,30)).code,403);
  const project = (await codes(1,10)).data;
  assert.equal(project.credentials.find(c=>c.id===1).can_reveal,0);
  assert.equal((await codes(3)).data.own_active,2);
  assert.equal((await codes(3,20)).data.own_active,2);
});

test('una excepción de usuario de un proyecto no afecta otra credencial', async t => {
  const {call,db,workStatus} = fixture(t);
  const local_date = new Date().toISOString().slice(0,10);
  const save = body => call('post','/exceptions',1,{body:{...exception, local_date, ...body}});
  assert.equal((await save({scope:'instance',enabled:true,start_time:'07:00',end_time:'14:00'})).code,201);
  assert.equal((await save({scope:'project',proyecto_id:10,enabled:true,start_time:'08:00',end_time:'16:00'})).code,201);
  assert.equal((await save({scope:'users',proyecto_id:10,usuario_ids:[3],enabled:true,start_time:'09:00',end_time:'17:00'})).code,201);
  assert.match((await workStatus(db,1,3,{timezone:'UTC'},10)).description,/^09:00/);
  assert.match((await workStatus(db,1,2,{timezone:'UTC'},10)).description,/^08:00/);
  assert.match((await workStatus(db,1,3,{timezone:'UTC'},20)).description,/^07:00/);
});

test('User conserva sus credenciales y la asignada, sin filtro ni autorización implícita de código', async t => {
  const {call} = fixture(t);
  const projects = (await call('get','/projects',6)).data;
  assert.equal(projects.canFilter,false);
  assert.equal(projects.canFilterHours,false);
  assert.deepEqual(projects.projects,[]);
  const data = (await call('get','/credentials',6)).data;
  assert.deepEqual(data.credentials.map(c=>[c.id,c.can_reveal]).sort(),[[5,1],[6,0]]);
  assert.equal(data.own_active,1);
  assert.equal(data.can_manage,false);
  assert.ok(data.credentials.every(c=>!Object.hasOwn(c,'secret_cipher') && !Object.hasOwn(c,'code')));
  assert.equal((await call('get','/credentials',6,{query:{proyecto_id:10}})).code,403);
  assert.equal((await call('get','/credentials',6,{query:{proyecto_id:20}})).code,403);
});
