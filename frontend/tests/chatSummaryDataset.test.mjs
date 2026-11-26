import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getChatSummaryDataset } from '../src/utils/chatSummaryDataset.js';

test('un resumen válido evita consultar el historial', async () => {
  const urls = [];
  const data = [{ id: 1 }];
  const result = await getChatSummaryDataset(async url => { urls.push(url); return { data }; }, '/summary', '/legacy');
  assert.deepEqual(urls, ['/summary']);
  assert.deepEqual(result, { available: true, fallback: false, data });
});

test('fallos transitorios, de red y de acceso no disparan consultas de historial', async () => {
  for (const status of [undefined, 400, 401, 403, 429, 500, 502, 503, 504]) {
    const urls = [];
    const result = await getChatSummaryDataset(async url => {
      urls.push(url);
      throw Object.assign(new Error('fallo simulado'), { response: status ? { status } : undefined });
    }, '/summary', '/legacy');
    assert.deepEqual(urls, ['/summary']);
    assert.deepEqual(result, { available: false, fallback: false, data: [] });
  }
});

test('la ruta antigua se conserva para servidores sin resumen y sus errores permanecen visibles al llamador', async () => {
  for (const status of [404, 405, 501]) {
    const urls = [];
    const result = await getChatSummaryDataset(async url => {
      urls.push(url);
      if (url === '/summary') throw { response: { status } };
      return { data: [{ id: 2 }] };
    }, '/summary', '/legacy');
    assert.deepEqual(urls, ['/summary', '/legacy']);
    assert.deepEqual(result, { available: true, fallback: true, data: [{ id: 2 }] });
  }
  const failed = await getChatSummaryDataset(async url => {
    throw { response: { status: url === '/summary' ? 404 : 503 } };
  }, '/summary', '/legacy');
  assert.deepEqual(failed, { available: false, fallback: true, data: [] });
});
