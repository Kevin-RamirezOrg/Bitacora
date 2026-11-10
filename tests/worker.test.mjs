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

// ---------- Grupo C ----------
const { leerPaginaCompleta, leerPagina } = await import('../worker/src/universidad.js');
const { repartir, generarPreguntas } = await import('../worker/src/estudio.js');

test('E4: leerPagina baja a sub-viñetas, desplegables, tablas y ecuaciones', async () => {
  const e = montar([]);
  const r = await leerPaginaCompleta(e.env, e.ids.clase);
  for (const esperado of ['## MapReduce', '- Tolerancia a fallos', '  - Se logra con réplicas de cada bloque', 'El combiner es un mini-reduce local.', 'Ecuación: T = n', '| map | líneas |'])
    assert.ok(r.texto.includes(esperado), `falta: ${esperado}\n${r.texto}`);
  assert.equal(r.cortada, false);
});

test('E4: leerPagina pagina más de 100 bloques y avisa cuando corta', async () => {
  const e = montar([]);
  const { B, P, pagina } = e.notion;
  const larga = pagina(DS.CLASES, { Clase: P.titulo('Larga') }, Array.from({ length: 230 }, (_, i) => B.p(`linea ${i + 1}`)));
  const todo = await leerPaginaCompleta(e.env, larga, { max: 100000 });
  assert.ok(todo.texto.includes('linea 230')); assert.equal(todo.cortada, false);
  const corta = await leerPagina(e.env, larga, { max: 500 });
  assert.ok(corta.endsWith('[La página sigue: aquí solo cabe una parte.]'));
});

test('K6: el límite de apuntes se reparte entre las clases', () => {
  assert.deepEqual(repartir([100, 100], 1000), [100, 100]);
  assert.deepEqual(repartir([100, 5000], 1000), [100, 900]);
  assert.deepEqual(repartir([5000, 5000, 5000], 900), [300, 300, 300]);
  assert.equal(repartir([10, 5000, 5000], 1010).reduce((a, b) => a + b), 1010);
});

test('K6: las preguntas dicen de qué clases salieron', async () => {
  const e = montar([{ preguntas: [{ pregunta: '¿Qué hace map?', respuesta: 'Divide el trabajo.' }] }]);
  const r = await generarPreguntas(e.env, { materiaId: e.ids.big, materiaNombre: 'Fundamentos de Big Data', semana: 7, cantidad: 1 });
  assert.equal(r.fuentes[0].titulo, 'S7-C1 · MapReduce'); assert.equal(r.fuentes[0].completa, true);
  assert.ok(e.modelo.llamadas[0].body.messages[1].content.includes('Se logra con réplicas'), 'los apuntes incluyen las sub-viñetas');
});

test('E3: una fila consultada sigue disponible en el turno siguiente', async () => {
  const e = montar([{ tipo: 'notion' },
    { respuesta: '', acciones: [{ accion: 'consultar_base', base: 'b2', buscar: 'MapReduce', mostrar: true }] },
    { respuesta: 'Encontré esta clase.', acciones: [] }]);
  const r1 = await procesarMensaje(e.env, { texto: 'busca la clase de mapreduce' });
  assert.equal(r1.asistente.datos.filas.length, 1);
  assert.equal(r1.asistente.datos.filas[0].titulo, 'S7-C1 · MapReduce');
  // Turno 2: el modelo pide leer r1 sin volver a consultar.
  e.modelo.encolar({ tipo: 'notion' },
    (body) => { const hist = body.messages.map((m) => m.content).join('\n');
      assert.ok(hist.includes('r1: "S7-C1 · MapReduce" (Clases)'), 'el historial debe mostrar la fila con su clave');
      return { respuesta: '', acciones: [{ accion: 'leer_pagina', fila: 'r1' }] }; },
    (body) => { assert.ok(body.messages.at(-1).content.includes('El modelo divide el trabajo en map y reduce.')); return { respuesta: '- Divide en map y reduce', acciones: [] }; });
  const r2 = await procesarMensaje(e.env, { texto: 'resume eso', chat: r1.chat.id });
  assert.equal(r2.asistente.texto, '- Divide en map y reduce');
  assert.ok(r2.asistente.datos.resultados.some((x) => x.accion === 'leer_pagina' && x.ok));
  assert.equal(r2.asistente.datos.filas[0].titulo, 'S7-C1 · MapReduce', 'sigue disponible para un tercer turno');
});

test('E18: una opción nueva en Notion se acepta tras refrescar el esquema', async () => {
  const e = montar([{ tipo: 'notion' }, { respuesta: 'Hecho.', acciones: [{ accion: 'crear_fila', base: 'b2', propiedades: { Clase: 'Repaso', Estado: 'Revisada' } }] }]);
  const { bases } = await import('../worker/src/universidad.js');
  await bases(e.env); // deja el esquema en caché
  e.notion.bases.get(DS.CLASES).properties.Estado.select.options.push({ name: 'Revisada' }); // Kevin agrega la opción en Notion
  const r = await procesarMensaje(e.env, { texto: 'crea la clase Repaso con estado Revisada' });
  assert.equal(r.asistente.datos.resultados[0].ok, true, JSON.stringify(r.asistente.datos.resultados));
});
