const { test } = require('node:test');
const assert = require('node:assert/strict');
const { queryWithRetry } = require('../utils/dbRetry');

test('un bloqueo recuperable conserva el SQL y los parámetros al reintentar', async () => {
  let calls = 0;
  const params = [1, 2];
  const db = { async query(sql, values) {
    assert.equal(sql, 'consulta');
    assert.equal(values, params);
    if (++calls === 1) throw Object.assign(new Error('bloqueo simulado'), { code: 'ER_LOCK_DEADLOCK' });
    return 'ok';
  } };
  assert.equal(await queryWithRetry(db, 'consulta', params, { baseDelayMs: 1 }), 'ok');
  assert.equal(calls, 2);
});

test('desconexión y saturación simuladas no repiten automáticamente una escritura', async () => {
  for (const code of ['PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ER_CON_COUNT_ERROR', undefined]) {
    let calls = 0;
    const error = Object.assign(new Error('fallo simulado'), { code });
    const db = { async query() { calls++; throw error; } };
    await assert.rejects(queryWithRetry(db, 'escritura'), value => value === error);
    assert.equal(calls, 1);
  }
});
