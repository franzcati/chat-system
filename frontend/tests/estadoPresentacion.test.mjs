import test from 'node:test';
import assert from 'node:assert/strict';
import { activeStatuses, nextStatusExpiration, statusDate } from '../src/utils/estadoPresentacion.js';

test('el vencimiento con fecha de MariaDB se interpreta en UTC y ocurre en el instante exacto', () => {
  const items = [
    { id: '1', vence_at: '2026-11-23 14:21:31.123' },
    { id: '2', vence_at: '2026-11-23T14:22:30.000Z' },
  ];
  const deadline = Date.parse('2026-11-23T14:21:31.123Z');
  assert.equal(statusDate(items[0].vence_at).getTime(), deadline);
  assert.deepEqual(activeStatuses(items, deadline - 1), items);
  assert.deepEqual(activeStatuses(items, deadline), [items[1]]);
  assert.equal(nextStatusExpiration(items, deadline - 1), deadline);
  assert.equal(nextStatusExpiration(items, deadline), Date.parse(items[1].vence_at));
});

test('un estado histórico sin fecha válida sigue sujeto al listado del servidor', () => {
  const legacy = [{ id: '1' }, { id: '2', vence_at: 'fecha inválida' }];
  assert.deepEqual(activeStatuses(legacy), legacy);
  assert.equal(nextStatusExpiration(legacy), Infinity);
  assert.equal(nextStatusExpiration([]), Infinity);
});
