import test from 'node:test';
import assert from 'node:assert/strict';
import { activeStatuses, buildTracks, ringPaint, statusReplyParts, statusStamp, textPresentation, STATUS_FONTS, emojiBounds, nextStatusExpiration, statusDate, unseenChatContexts } from '../src/utils/estadoPresentacion.js';

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

test('anillo por destino autorizado, pendiente y vigente, sin confundir contacto y grupo', () => {
  const now = Date.parse('2026-11-23T15:00:00Z');
  const items = [
    { autor_id: 2, visto: 0, destinos: { mi_estado: true, grupos: [{ id: 2 }, { id: 3 }] } },
    { autor_id: 4, grupo_id: 5, visto: 0 },
    { autor_id: 7, visto: 0 },
    { autor_id: 8, visto: '1' },
    { autor_id: 9, vence_at: '2026-11-23 15:00:00', visto: 0 },
    { autor_id: 1, visto: 0 },
  ];
  assert.deepEqual([...unseenChatContexts(items, 1, now)].sort(), ['g:2','g:3','g:5','u:2','u:7']);
  items[0].visto = 1;
  assert.deepEqual([...unseenChatContexts(items, 1, now)].sort(), ['g:5','u:7']);
});

test('selector junto al botón arriba o abajo, y dentro del viewport con teclado y zoom', () => {
  const desktop = { left: 0, top: 0, width: 1440, height: 900 };
  assert.equal(emojiBounds({ left: 800, top: 80, bottom: 110 }, desktop).top, 116);
  assert.equal(emojiBounds({ left: 800, top: 790, bottom: 820 }, desktop).top, 364);
  const mobile = { left: 16, top: 40, width: 320, height: 236 };
  assert.deepEqual(emojiBounds({ left: 300, top: 100, bottom: 130 }, mobile),
    { width: 304, height: 220, left: 24, top: 48 });
});

test('un grupo conserva una secuencia en Chats y una por autor en Estados', () => {
  const entries = Array.from({ length: 9 }, (_, i) => ({ id: 9-i, autor_id: i ? 2 : 3,
    visto: i % 2, grupo_id: 12 }));
  const combined = buildTracks(entries, 1).get('g:12');
  assert.deepEqual(combined.entries.map(e => e.id), [1,2,3,4,5,6,7,8,9]);
  assert.equal(ringPaint(combined.entries, 1).split('transparent').length - 1, 9);
  assert.equal(buildTracks(entries, 1, true).get('g:12:u:2').entries.length, 8);
  assert.equal(ringPaint([entries[0]], 1),
    'conic-gradient(var(--qc-state-start) 0deg,var(--qc-state-middle) 180deg,var(--qc-state-end) 360deg)');
  assert.equal(ringPaint([{ ...entries[0], visto: 1 }], 1), 'conic-gradient(#8393aa 0deg 360deg)');
  const mixedRing = ringPaint([entries[0], { ...entries[1], visto: 1 }], 1);
  assert.match(mixedRing, /var\(--qc-state-end\) 175deg,transparent 175deg 180deg,#8393aa 180deg 355deg/);
});

test('hora local de ayer y hoy y lectura de respuestas antiguas y multimedia', () => {
  const now = new Date(2026, 10, 23, 12);
  assert.equal(statusStamp(new Date(2026,10,22,23), now), 'Ayer a la(s) 11:00 p. m.');
  assert.equal(statusStamp(new Date(2026,10,23,9,44), now), 'Hoy a la(s) 9:44 a. m.');
  assert.equal(statusReplyParts('↪ Estado #12 · Hola\nSí').reply, 'Sí');
  assert.equal(statusReplyParts('↪ Estado del grupo #12 [Foto]\nHola').medium, 'Foto');
  assert.equal(statusReplyParts('Mensaje normal'), null);
});

test('citas con autor y tipo preservan la respuesta multilínea y no aceptan rutas arbitrarias', () => {
  for (const medium of ['Foto','Video','GIF','Texto']) {
    const snapshot = { id:'102', author:'María Pérez', medium, excerpt:'Una "foto"\nNueva', caption:'' };
    const parsed = statusReplyParts('↪ Estados ' + JSON.stringify(snapshot) + '\nprecio\npor favor');
    assert.deepEqual(parsed, { ...snapshot, snapshot:true, reply:'precio\npor favor' });
    assert.equal(statusReplyParts('↪ Estados ' + JSON.stringify({ ...snapshot, id:'../privado' }) + '\nx'), null);
  }
  assert.equal(statusReplyParts('↪ Estados {malformado}\ntest'), null);
  assert.equal(statusReplyParts('↪ Estado #2\nprecio').reply, 'precio');
});

test('cada fuente permitida cambia la familia y mantiene cursiva, negrita, alineación y subrayado', () => {
  const families = new Set();
  for (const { id } of STATUS_FONTS) {
    const style = textPresentation({ fuente:id, cursiva:true, negrita:true, subrayado:true, alineacion:'right' });
    families.add(style.fontFamily);
    assert.equal(style.fontStyle,'italic');
    assert.equal(style.fontWeight,700);
    assert.equal(style.textDecoration,'underline');
    assert.equal(style.textAlign,'right');
  }
  assert.equal(families.size,6);
  assert.equal(textPresentation({fuente:'url(fake)'}).fontFamily,'inherit');
});
