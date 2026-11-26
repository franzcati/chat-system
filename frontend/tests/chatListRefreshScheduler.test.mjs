import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatListRefreshScheduler } from '../src/utils/chatListRefreshScheduler.js';

async function settle() {
  await Promise.resolve();
}

test('agrupa señales pasivas próximas y ejecuta una sincronización por ventana', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const scheduler = createChatListRefreshScheduler({
    getInFlight: () => null,
    refresh: () => calls.push('sync'),
  });

  scheduler.schedule();
  t.mock.timers.tick(75);
  scheduler.schedule();
  t.mock.timers.tick(124);
  await settle();
  assert.equal(calls.length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls.length, 1);

  scheduler.schedule();
  t.mock.timers.tick(200);
  await settle();
  assert.equal(calls.length, 2);
});

test('una reconexión durante una consulta queda pendiente y no se descarta', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const active = Promise.withResolvers();
  let calls = 0;
  const scheduler = createChatListRefreshScheduler({
    getInFlight: () => active.promise,
    refresh: () => { calls++; },
  });

  scheduler.schedule();
  t.mock.timers.tick(200);
  scheduler.schedule();
  t.mock.timers.tick(200);
  await settle();
  assert.equal(calls, 0);
  active.resolve();
  await settle();
  assert.equal(calls, 1);
});

test('al cerrar la lista se cancela el temporizador y la sincronización pendiente', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const active = Promise.withResolvers();
  const create = () => createChatListRefreshScheduler({
    getInFlight: () => active.promise,
    refresh: () => assert.fail('La sesión anterior no puede reactivar la lista'),
  });

  const queued = create();
  queued.schedule();
  queued.dispose();

  const waiting = create();
  waiting.schedule();
  t.mock.timers.tick(200);
  waiting.dispose();
  active.resolve();
  await settle();
});
