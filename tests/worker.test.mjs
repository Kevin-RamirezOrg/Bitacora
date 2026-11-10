// Pruebas del Worker con Notion, el modelo, D1 y KV simulados.  Uso: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { entorno, sembrar, DS } from './worker-fakes.mjs';

const { procesarMensaje, listarChats, historial } = await import('../worker/src/asistente.js');
const { hoy } = await import('../worker/src/notion.js');
const HOY = hoy();

function montar(guion, opciones) {
  const e = entorno({ guion, ...opciones });
  e.ids = sembrar(e.notion, HOY);
  return e;
}
const tareasEnNotion = (e) => [...e.notion.paginas.values()].filter((p) => p.parent.data_source_id === DS.TAREAS && !p.in_trash);

test('charla: responde sin leer Notion y crea el chat al guardar', async () => {
  const e = montar([{ tipo: 'charla', respuesta: 'Un **combiner** es un mini-reduce.' }]);
  const r = await procesarMensaje(e.env, { texto: 'qué es un combiner' });
  assert.equal(r.asistente.texto, 'Un **combiner** es un mini-reduce.');
  assert.equal(r.asistente.datos.charla, true);
  assert.equal(e.notion.llamadas.length, 0, 'no debe consultar Notion');
  assert.equal((await listarChats(e.env)).length, 1);
});

test('E7: si el modelo falla en un chat nuevo no queda un chat vacío', async () => {
  const e = montar([500, 500, 500, 500]);
  await assert.rejects(procesarMensaje(e.env, { texto: 'hola' }));
  assert.equal((await listarChats(e.env)).length, 0);
});

test('crear_tarea: valida, guarda en Notion y deja cómo deshacer', async () => {
  const e = montar([{ tipo: 'notion' },
    { respuesta: 'Listo.', acciones: [{ accion: 'crear_tarea', titulo: 'Prueba 2 de Big Data', tipo: 'Prueba', fecha: e0(3), hora: null, materia: 'm2', grupal: false }] }]);
  const antes = tareasEnNotion(e).length;
  const r = await procesarMensaje(e.env, { texto: 'prueba de big data en 3 días' });
  const res = r.asistente.datos.resultados[0];
  assert.equal(res.ok, true); assert.equal(res.materia, 'Fundamentos de Big Data'); assert.equal(res.deshacer.tipo, 'papelera');
  assert.equal(tareasEnNotion(e).length, antes + 1);
  assert.equal((await historial(e.env, { chat: r.chat.id })).length, 2);
});
function e0(n) { const d = new Date(HOY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

test('E12: los errores de estudio y de bases llevan código 400', async () => {
  const { ErrorEstudio } = await import('../worker/src/estudio.js');
  const { ErrorBase } = await import('../worker/src/universidad.js');
  assert.equal(new ErrorEstudio('x').status, 400);
  assert.equal(new ErrorBase('x').status, 400);
});
