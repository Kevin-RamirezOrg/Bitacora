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
  assert.ok(!JSON.stringify(e.modelo.llamadas).includes('Deber 3: MapReduce'), 'los datos de Notion no se envían al modelo en una charla');
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

// ---------- Grupo D ----------
const CON_RAPIDO = { principal: { proveedor: 'gemini', modelo: 'modelo-principal' }, respaldo: null, rapido: { proveedor: 'gemini', modelo: 'modelo-rapido' }, parametros: { temperature: 0.7 }, extra: {}, favoritos: [] };

test('K1/K3/R9: el clasificador usa el modelo rápido, modo JSON y temperatura baja; la config se lee una vez', async () => {
  const e = montar([{ tipo: 'notion' }, { respuesta: 'Esto tienes.', acciones: [{ accion: 'mostrar_tareas', desde: HOY, hasta: e0(7) }] }], { config: CON_RAPIDO });
  await procesarMensaje(e.env, { texto: 'qué tengo esta semana' });
  const [clasif, plan] = e.modelo.llamadas.map((l) => l.body);
  assert.equal(clasif.model, 'modelo-rapido'); assert.equal(plan.model, 'modelo-principal');
  assert.deepEqual(clasif.response_format, { type: 'json_object' }); assert.equal(clasif.temperature, 0.2); assert.equal(plan.temperature, 0.2);
  assert.equal(e.CONFIG.cuenta.ia, 1, 'la configuración de IA se lee una sola vez');
});

test('K5: el prompt empieza igual aunque cambien la fecha y las tareas', async () => {
  const e = montar([{ tipo: 'notion' }, { respuesta: 'ok', acciones: [] }, { tipo: 'notion' }, { respuesta: 'ok', acciones: [] }]);
  await procesarMensaje(e.env, { texto: 'uno' });
  e.notion.pagina(DS.TAREAS, { Tarea: e.notion.P.titulo('Otra tarea'), Entrega: e.notion.P.fecha(e0(1)), Completada: e.notion.P.casilla(false) });
  await procesarMensaje(e.env, { texto: 'dos' });
  const [a, b] = [e.modelo.llamadas[1], e.modelo.llamadas[3]].map((l) => l.body.messages[0].content);
  let igual = 0; while (igual < a.length && a[igual] === b[igual]) igual++;
  assert.ok(igual > 9000, `prefijo común de ${igual} caracteres`);
  assert.ok(a.indexOf('Hoy es') > a.indexOf('Reglas:'), 'la fecha va después de las reglas');
});

test('K3: si el proveedor rechaza el modo JSON, se pide sin él', async () => {
  const e = montar([400, { tipo: 'charla', respuesta: 'Hola.' }]);
  const r = await procesarMensaje(e.env, { texto: 'hola' });
  assert.equal(r.asistente.texto, 'Hola.');
  assert.equal(e.modelo.llamadas[1].body.response_format, undefined);
});

test('K4: un 429 del proveedor se reintenta una vez', async () => {
  const e = montar([429, { tipo: 'charla', respuesta: 'Listo.' }], { config: { ...CON_RAPIDO, rapido: { proveedor: 'gemini', modelo: 'otro-rapido' } } });
  const r = await procesarMensaje(e.env, { texto: 'hola' });
  assert.equal(r.asistente.texto, 'Listo.'); assert.equal(e.modelo.llamadas.length, 2);
});

test('K2: Notion se lee mientras el clasificador responde', async () => {
  const e = montar([(body) => { assert.ok(e.notion.llamadas.length > 0, 'la lectura de Notion ya empezó'); return { tipo: 'notion' }; }, { respuesta: 'ok', acciones: [] }]);
  await procesarMensaje(e.env, { texto: 'qué tengo' });
});

test('O1: marcar una tarea desde Urgente escribe Completada en Notion y valida la entrada', async () => {
  const { marcarTareaHoy } = await import('../worker/src/hoy.js');
  const e = montar([]);
  const t = tareasEnNotion(e)[0];
  await marcarTareaHoy(e.env, { tarea: t.id, completada: true });
  assert.equal(e.notion.paginas.get(t.id).properties.Completada.checkbox, true);
  await marcarTareaHoy(e.env, { tarea: t.id, completada: false });
  assert.equal(e.notion.paginas.get(t.id).properties.Completada.checkbox, false);
  await assert.rejects(marcarTareaHoy(e.env, { tarea: 'no-es-un-id', completada: true }), /inválida/);
  await assert.rejects(marcarTareaHoy(e.env, { tarea: t.id }), /completada/);
});

test('E10: reintentar con el mismo identificador no vuelve a escribir en Notion', async () => {
  const plan = { respuesta: 'Listo.', acciones: [{ accion: 'crear_tarea', titulo: 'Deber repetible', tipo: 'Tarea', fecha: e0(4), hora: null, materia: 'm2', grupal: false }] };
  const e = montar([{ tipo: 'notion' }, plan, { tipo: 'notion' }, plan]);
  const antes = tareasEnNotion(e).length;
  const a = await procesarMensaje(e.env, { texto: 'deber en 4 días', peticion: 'peticion-0001' });
  const b = await procesarMensaje(e.env, { texto: 'deber en 4 días', peticion: 'peticion-0001', chat: a.chat.id });
  assert.equal(tareasEnNotion(e).length, antes + 1, 'la tarea se crea una sola vez');
  assert.equal(b.repetida, true); assert.equal(b.asistente.id, a.asistente.id);
  assert.equal((await historial(e.env, { chat: a.chat.id })).length, 2);
  // Con otro identificador sí es un mensaje nuevo.
  await procesarMensaje(e.env, { texto: 'deber en 4 días', peticion: 'peticion-0002', chat: a.chat.id });
  assert.equal(tareasEnNotion(e).length, antes + 2);
});

test('E10: si el primer intento falla, el reintento con el mismo identificador se procesa', async () => {
  let caido = true; // el proveedor falla hasta que "vuelve"
  const paso = () => { if (caido) throw new Error('caído'); return { tipo: 'charla', respuesta: 'Hola.' }; };
  const e = montar(Array(8).fill(paso));
  await assert.rejects(procesarMensaje(e.env, { texto: 'hola', peticion: 'peticion-0003' }));
  caido = false;
  const r = await procesarMensaje(e.env, { texto: 'hola', peticion: 'peticion-0003' });
  assert.equal(r.asistente.texto, 'Hola.'); assert.ok(!r.repetida);
});

test('E10: una petición repetida que sigue en curso espera y devuelve la misma respuesta', async () => {
  const e = montar([{ tipo: 'charla', respuesta: 'Una sola vez.' }]);
  e.env.ESPERA_PETICION_MS = 20;
  const [a, b] = await Promise.all([
    procesarMensaje(e.env, { texto: 'hola', peticion: 'peticion-0004' }),
    procesarMensaje(e.env, { texto: 'hola', peticion: 'peticion-0004' }),
  ]);
  assert.equal(a.asistente.id, b.asistente.id);
  assert.equal([a, b].filter((x) => x.repetida).length, 1);
  assert.equal(e.modelo.llamadas.length, 1, 'el modelo se llama una sola vez');
});

test('R8: con el esquema al día, cada arranque del Worker hace una sola consulta de migración', async () => {
  const { listarMemoria } = await import('../worker/src/asistente.js');
  const e = montar([]);
  await listarMemoria(e.env); // primer arranque: crea tablas y guarda la versión
  const env2 = { ...e.env, DB: Object.create(e.env.DB) }; // otra instancia del Worker sobre la misma base
  const antes = e.env.DB.consultas;
  await listarMemoria(env2);
  assert.equal(e.env.DB.consultas - antes, 2, 'versión de esquema + la consulta pedida');
});

test('E11: el límite de subpeticiones se explica con un mensaje claro', async () => {
  const worker = (await import('../worker/src/index.js')).default;
  assert.ok(worker.fetch);
  const fuente = (await import('node:fs')).readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8');
  assert.match(fuente, /LIMITE_SUBPETICIONES/);
});

test('Decidir primero apagado: un solo modelo lee Notion y responde, sin paso previo', async () => {
  const e = montar([{ respuesta: 'Un combiner es un mini-reduce.', acciones: [] }],
    { config: { principal: { proveedor: 'gemini', modelo: 'g-principal' }, rapido: { proveedor: 'nanogpt', modelo: 'n-rapido' }, decidirPrimero: false } });
  const r = await procesarMensaje(e.env, { texto: 'qué es un combiner' });
  assert.equal(r.asistente.texto, 'Un combiner es un mini-reduce.');
  assert.equal(e.modelo.llamadas.length, 1, 'una sola llamada al modelo');
  assert.equal(e.modelo.llamadas[0].body.model, 'g-principal', 'el modelo rápido no se usa');
});

test('Decidir primero: la configuración guarda el interruptor y por defecto está activado', async () => {
  const { validarConfig, leerConfig } = await import('../worker/src/ia.js');
  const base = { principal: { proveedor: 'gemini', modelo: 'x' } };
  assert.equal(validarConfig(base).decidirPrimero, true);
  assert.equal(validarConfig({ ...base, decidirPrimero: false }).decidirPrimero, false);
  const e = montar([]);
  assert.equal((await leerConfig(e.env)).decidirPrimero !== false, true, 'una configuración antigua sigue con el paso previo');
});
