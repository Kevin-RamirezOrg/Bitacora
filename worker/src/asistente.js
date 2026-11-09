// Asistente: convierte lo que escribe Kevin en acciones sobre Notion.
// El modelo responde un JSON con { respuesta, acciones }; el Worker lo valida, lo ejecuta y guarda el historial en D1.

import { ErrorIA, chat } from './ia.js';
import {
  ROLES, TIPOS_TAREA, consultarTareas, crearTarea, deshacer as deshacerPaso, diaSemana, guardarPersona,
  horaActual, hoy, marcarTarea, materias as leerMaterias, normal, notaInbox, sinGuiones, sumarDias,
} from './notion.js';
import { CLAVE_HORARIO, horarioParaPrompt, horarioSemana } from './horario.js';
import { claseReciente, guardarApunte } from './clases.js';
import { ErrorEstudio, elegirPractica, generarPreguntas, resumenSemanal } from './estudio.js';
import {
  ErrorBase, archivarFila, bases as leerBases, basesParaPrompt, buscarPorTitulo, consultar, crearFila, editarFila,
  leerPagina, propiedadesEscritura,
} from './universidad.js';

const MAX_ACCIONES = 5;
const LECTURAS = new Set(['consultar_base', 'leer_pagina']);
const MAX_TEXTO = 4000;
const HISTORIAL_CONTEXTO = 8;

export class ErrorAsistente extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// ---------- Historial, chats, memoria y valoraciones en D1 ----------

let tablaLista = false;
async function db(env) {
  if (!env.DB) throw new ErrorAsistente(503, 'Falta la base D1 del historial en Cloudflare');
  if (!tablaLista) {
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, rol TEXT NOT NULL, texto TEXT NOT NULL, datos TEXT, creado INTEGER NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS mensajes_creado ON mensajes (creado)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, creado INTEGER NOT NULL, actualizado INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS memoria (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, origen TEXT NOT NULL, creado INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS valoraciones (mensaje INTEGER PRIMARY KEY, valor INTEGER NOT NULL, motivo TEXT, creado INTEGER NOT NULL)'),
    ]);
    // Migración: los mensajes pasan a pertenecer a un chat; los antiguos van a "Conversación anterior".
    try { await env.DB.prepare('ALTER TABLE mensajes ADD COLUMN chat INTEGER').run(); } catch { /* ya existe */ }
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS mensajes_chat ON mensajes (chat, id)').run();
    const sueltos = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(creado) AS ini, MAX(creado) AS fin FROM mensajes WHERE chat IS NULL').first();
    if (sueltos?.n) {
      const c = await env.DB.prepare('INSERT INTO chats (titulo, creado, actualizado) VALUES (?, ?, ?)').bind('Conversación anterior', sueltos.ini, sueltos.fin).run();
      await env.DB.prepare('UPDATE mensajes SET chat = ? WHERE chat IS NULL').bind(c.meta.last_row_id).run();
    }
    tablaLista = true;
  }
  return env.DB;
}

const fila = (r) => ({ id: r.id, rol: r.rol, texto: r.texto, datos: r.datos ? JSON.parse(r.datos) : null, creado: r.creado, chat: r.chat ?? null,
  ...(r.valoracion != null ? { valoracion: r.valoracion } : {}) });

export async function historial(env, { chat, antes, limite = 50 } = {}) {
  const base = await db(env);
  const n = Math.min(Math.max(Number(limite) || 50, 1), 100);
  const id = Number(chat);
  if (!id) return [];
  const q = antes
    ? base.prepare('SELECT m.*, v.valor AS valoracion FROM mensajes m LEFT JOIN valoraciones v ON v.mensaje = m.id WHERE m.chat = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?').bind(id, Number(antes), n)
    : base.prepare('SELECT m.*, v.valor AS valoracion FROM mensajes m LEFT JOIN valoraciones v ON v.mensaje = m.id WHERE m.chat = ? ORDER BY m.id DESC LIMIT ?').bind(id, n);
  const { results } = await q.all();
  return results.map(fila).reverse();
}

export async function borrarHistorial(env, chat) {
  await (await db(env)).prepare('DELETE FROM mensajes WHERE chat = ?').bind(Number(chat)).run();
}

// Chats
const tituloDe = (texto) => {
  const t = String(texto).replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 47).trimEnd() + '…' : t || 'Nuevo chat';
};

export async function listarChats(env) {
  const { results } = await (await db(env)).prepare(
    'SELECT c.id, c.titulo, c.creado, c.actualizado, (SELECT COUNT(*) FROM mensajes m WHERE m.chat = c.id) AS mensajes FROM chats c ORDER BY c.actualizado DESC LIMIT 100'
  ).all();
  return results;
}

export async function crearChat(env, titulo) {
  const base = await db(env);
  const ahora = Date.now();
  const r = await base.prepare('INSERT INTO chats (titulo, creado, actualizado) VALUES (?, ?, ?)').bind(tituloDe(titulo || 'Nuevo chat'), ahora, ahora).run();
  return { id: r.meta.last_row_id, titulo: tituloDe(titulo || 'Nuevo chat'), creado: ahora, actualizado: ahora, mensajes: 0 };
}

export async function renombrarChat(env, { id, titulo }) {
  const t = typeof titulo === 'string' ? titulo.trim().slice(0, 80) : '';
  if (!t) throw new ErrorAsistente(400, 'Escribe un nombre');
  const r = await (await db(env)).prepare('UPDATE chats SET titulo = ? WHERE id = ?').bind(t, Number(id)).run();
  if (!r.meta.changes) throw new ErrorAsistente(404, 'No encontré ese chat');
  return { id: Number(id), titulo: t };
}

export async function borrarChat(env, id) {
  const base = await db(env);
  await base.batch([
    base.prepare('DELETE FROM valoraciones WHERE mensaje IN (SELECT id FROM mensajes WHERE chat = ?)').bind(Number(id)),
    base.prepare('DELETE FROM mensajes WHERE chat = ?').bind(Number(id)),
    base.prepare('DELETE FROM chats WHERE id = ?').bind(Number(id)),
  ]);
}

// Memoria: datos que Kevin pidió recordar o aceptó cuando el asistente los propuso.
export async function listarMemoria(env) {
  const { results } = await (await db(env)).prepare('SELECT id, texto, origen, creado FROM memoria ORDER BY id').all();
  return results;
}

export async function agregarMemoria(env, texto, origen = 'usuario') {
  const t = typeof texto === 'string' ? texto.trim().slice(0, 300) : '';
  if (!t) throw new ErrorAsistente(400, 'El recuerdo está vacío');
  const base = await db(env);
  const { results } = await base.prepare('SELECT id, texto FROM memoria').all();
  const igual = results.find((m) => normal(m.texto) === normal(t));
  if (igual) return { id: igual.id, texto: igual.texto, repetido: true };
  if (results.length >= 60) throw new ErrorAsistente(409, 'La memoria está llena (60 datos); borra alguno en Ajustes → Memoria');
  const r = await base.prepare('INSERT INTO memoria (texto, origen, creado) VALUES (?, ?, ?)').bind(t, origen, Date.now()).run();
  return { id: r.meta.last_row_id, texto: t, origen };
}

export async function editarMemoria(env, { id, texto }) {
  const t = typeof texto === 'string' ? texto.trim().slice(0, 300) : '';
  if (!t) throw new ErrorAsistente(400, 'El recuerdo está vacío');
  await (await db(env)).prepare('UPDATE memoria SET texto = ? WHERE id = ?').bind(t, Number(id)).run();
  return { id: Number(id), texto: t };
}

export async function borrarMemoria(env, id) {
  await (await db(env)).prepare('DELETE FROM memoria WHERE id = ?').bind(Number(id)).run();
}

// Respuesta a una propuesta de recuerdo hecha por el asistente: se guarda (si se acepta) y se marca en el mensaje.
export async function responderPropuesta(env, { mensaje, aceptar, texto }) {
  const base = await db(env);
  let guardado = null;
  let m = null;
  if (mensaje) {
    const row = await base.prepare('SELECT * FROM mensajes WHERE id = ?').bind(Number(mensaje)).first();
    if (row) m = fila(row);
  }
  const propuesta = m?.datos?.resultados?.find((x) => x.accion === 'proponer_recuerdo' && x.ok);
  const t = propuesta?.texto || texto;
  if (aceptar) guardado = await agregarMemoria(env, t, 'sugerida');
  if (m && propuesta) {
    propuesta.estado = aceptar ? 'aceptada' : 'rechazada';
    await base.prepare('UPDATE mensajes SET datos = ? WHERE id = ?').bind(JSON.stringify(m.datos), m.id).run();
  }
  return { mensaje: m, memoria: guardado };
}

// Guarda en el mensaje qué marcó Kevin en una tarjeta de práctica (para que se vea al volver al chat).
export async function guardarMarcaTarjeta(env, mensaje, indice, dominio) {
  const base = await db(env);
  const row = await base.prepare('SELECT * FROM mensajes WHERE id = ?').bind(Number(mensaje)).first();
  if (!row) return;
  const m = fila(row);
  const r = m.datos?.resultados?.find((x) => Array.isArray(x.tarjetas));
  if (!r || !r.tarjetas[Number(indice)]) return;
  r.tarjetas[Number(indice)].marcado = dominio;
  await base.prepare('UPDATE mensajes SET datos = ? WHERE id = ?').bind(JSON.stringify(m.datos), m.id).run();
}

// Valoraciones 👍/👎 (con motivo opcional) para que el asistente ajuste su forma de responder.
export async function valorar(env, { mensaje, valor, motivo }) {
  const v = Number(valor);
  if (![1, -1, 0].includes(v)) throw new ErrorAsistente(400, 'Valor inválido');
  const base = await db(env);
  if (v === 0) await base.prepare('DELETE FROM valoraciones WHERE mensaje = ?').bind(Number(mensaje)).run();
  else {
    await base.prepare('INSERT INTO valoraciones (mensaje, valor, motivo, creado) VALUES (?, ?, ?, ?) ON CONFLICT (mensaje) DO UPDATE SET valor = excluded.valor, motivo = excluded.motivo, creado = excluded.creado')
      .bind(Number(mensaje), v, typeof motivo === 'string' ? motivo.trim().slice(0, 200) || null : null, Date.now()).run();
  }
  return { mensaje: Number(mensaje), valor: v, motivo: motivo || null };
}

// Resumen breve de las últimas valoraciones para el prompt.
async function resumenValoraciones(base) {
  const { results } = await base.prepare('SELECT valor, motivo FROM valoraciones ORDER BY creado DESC LIMIT 30').all();
  if (!results.length) return null;
  const pos = results.filter((r) => r.valor > 0).length;
  const motivos = {};
  for (const r of results.filter((x) => x.valor < 0)) { const k = r.motivo || 'sin motivo'; motivos[k] = (motivos[k] || 0) + 1; }
  const neg = Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× "${k}"`).join(', ');
  return `De las últimas ${results.length} respuestas valoradas: ${pos} le gustaron${neg ? `; no le gustaron por: ${neg}` : ''}.`;
}

// ---------- Prompt ----------

function calendario(fechaHoy) {
  const lineas = [];
  for (let i = -3; i <= 35; i++) {
    const f = sumarDias(fechaHoy, i);
    lineas.push(`${f} ${diaSemana(f)}${i === 0 ? ' (hoy)' : i === 1 ? ' (mañana)' : ''}`);
  }
  return lineas.join('\n');
}

function prompt(fechaHoy, claves) {
  const clases = claves.clases.length
    ? claves.clases.map((c) => `${c.clave}: ${c.dia} ${c.inicio}-${c.fin} · ${c.titulo}${c.aula ? ` · aula ${c.aula}` : ''}`).join('\n')
    : '(sin horario registrado)';
  const mats = claves.materias.length
    ? claves.materias.map((m) => `${m.clave}: ${m.nombre}${m.codigo ? ` (${m.codigo})` : ''}${m.profesor ? `; profesor: ${m.profesor}` : ''}`).join('\n')
    : '(ninguna registrada)';
  const tareas = claves.tareas.length
    ? claves.tareas.map((t) => `${t.clave}: ${t.tipo || 'Sin tipo'} · ${t.titulo} · ${t.materia || 'sin materia'} · ${t.fecha || 'sin fecha'}${t.hora ? ' ' + t.hora : ''}`).join('\n')
    : '(no hay pendientes)';
  return `Eres el asistente de estudio de Kevin, estudiante universitario en Ecuador. Conviertes lo que escribe en acciones sobre su Notion y le respondes en español, tratándolo de tú, en una o dos frases.

Hoy es ${diaSemana(fechaHoy)} ${fechaHoy} y son las ${claves.hora} (zona horaria America/Guayaquil).
Calendario de referencia:
${calendario(fechaHoy)}

Materias (usa la clave, por ejemplo "m1"):
${mats}

Lo que Kevin te pidió recordar (usa la clave, por ejemplo "k1", para olvidar). Respétalo siempre:
${claves.memoria.length ? claves.memoria.map((m) => `${m.clave}: ${m.texto}`).join('\n') : '(nada todavía)'}
${claves.valoraciones ? `\nCómo valoró tus respuestas: ${claves.valoraciones}\n` : ''}
Horario semanal de clases del semestre actual (base Horario; usa la clave, por ejemplo "c1", para editar una clase):
${clases}

Todas las bases de Universidad (usa la clave, por ejemplo "b1"):
${claves.basesTexto}

Tareas y evaluaciones pendientes según Notion en este momento (usa la clave, por ejemplo "t1"):
${tareas}
Esta lista es la única fuente de verdad. El historial de la conversación puede mencionar tareas que Kevin deshizo o borró: si no están en esta lista, ya no existen.

Responde SOLO con un objeto JSON válido, sin texto antes ni después y sin bloques de código, con esta forma:
{"respuesta": "texto breve para Kevin", "acciones": []}

Acciones posibles (máximo ${MAX_ACCIONES} por mensaje):
{"accion": "crear_tarea", "titulo": "Prueba 2 de Big Data", "tipo": "${TIPOS_TAREA.join('|')}", "fecha": "AAAA-MM-DD" o null, "hora": "HH:MM" o null, "materia": "m1" o null, "grupal": false}
{"accion": "completar_tarea", "tarea": "t1"}
{"accion": "guardar_persona", "nombre": "Nombre completo" o null, "apodo": "Pulu" o null, "profesor_de": "m1" o null, "rol": "${ROLES.join('|')}" o null, "correo": null, "telefono": null, "grupo": null, "cumpleanos": "AAAA-MM-DD" o "MM-DD" o null, "notas": null, "materias": ["m1"]}
{"accion": "preguntas_estudio", "materia": "m1", "semana": 7 o null, "cantidad": 5}
{"accion": "practicar", "materia": "m1", "cantidad": 5}
{"accion": "resumen_semanal", "materia": "m1", "semana": 7 o null}
{"accion": "recordar", "texto": "dato en una frase, en tercera persona"}
{"accion": "olvidar", "memoria": "k1"}
{"accion": "proponer_recuerdo", "texto": "preferencia en una frase"}
{"accion": "apunte_clase", "materia": "m1" o null, "fecha": "AAAA-MM-DD" o null, "tema": "tema corto de la clase", "contenido": ["idea 1", "idea 2"]}
{"accion": "nota_inbox", "texto": "nota clara y autosuficiente", "materia": "m1" o null}
{"accion": "mostrar_tareas", "desde": "AAAA-MM-DD", "hasta": "AAAA-MM-DD"}
{"accion": "consultar_base", "base": "b1", "buscar": "texto en el título" o null, "filtros": [{"propiedad": "Nombre exacto", "valor": "...", "op": "igual|contiene|desde|hasta|mayor|menor"}], "limite": 15, "mostrar": false}
{"accion": "leer_pagina", "fila": "r1"}
{"accion": "crear_fila", "base": "b1", "propiedades": {"Nombre de la propiedad": valor}}
{"accion": "editar_fila", "fila": "r1", "propiedades": {"Nombre de la propiedad": valor}}
{"accion": "archivar_fila", "fila": "r1"}

Reglas:
- Usa las acciones especializadas (crear_tarea, completar_tarea, guardar_persona, nota_inbox, mostrar_tareas) para Tareas, Personas e Inbox. Para cualquier otra base usa consultar_base, leer_pagina, crear_fila, editar_fila o archivar_fila.
- Horario: "¿qué clase me toca ahora?", "¿dónde es Big Data?" o "¿qué clases tengo mañana?" se responden directo con el horario de arriba, sin acciones. "Ahora" es la clase cuya hora incluye la hora actual; si no hay, di cuál es la siguiente.
- Para leer otras bases (Clases, Resúmenes, Recursos, Banco de preguntas, Metas…) usa consultar_base o leer_pagina. Cuando pidas lecturas, el Worker te devolverá los resultados con claves "r1", "r2"… y te pedirá la respuesta final; en ese primer paso no incluyas escrituras. Pon "mostrar": true solo si Kevin pidió ver una lista.
- leer_pagina sirve para el contenido de una página (apuntes, resúmenes); necesita una fila "r…" de una consulta.
- crear_fila y editar_fila: usa los nombres exactos de las propiedades y, en opciones, solo valores de la lista. Fechas "AAAA-MM-DD" o "AAAA-MM-DDTHH:MM"; para un rango usa {"inicio": ..., "fin": ...}. Relaciones: lista de claves ("m1", "r2", "c3", "t1") o nombres exactos.
- editar_fila y archivar_fila necesitan una fila conocida: "r…" de una consulta, "c…" del horario o "t…" de las tareas. Si no la tienes, primero consulta.
- archivar_fila manda la página a la papelera; úsala solo si Kevin pide borrar algo.
- Fechas: resuelve "mañana", "el martes", "el martes 2", "la próxima semana" con el calendario. Si el día de la semana y el número no coinciden, usa la fecha futura más cercana con ese número y dilo en la respuesta. Nunca inventes una fecha: si no hay ninguna, usa null.
- "hora" solo si Kevin la dice.
- Materia: elige la clave que corresponda aunque Kevin la escriba abreviada o con otras palabras. Si no estás seguro, usa null.
- Título corto y específico, sin repetir la fecha.
- Tipo: "prueba", "test" o "lección" es Prueba; "examen" es Examen; "deber", "taller" o "informe" es Tarea; "proyecto" es Proyecto; "leer" es Lectura; matrículas, trámites o eventos de la universidad son Institucional.
- No dupliques: si ya existe una tarea pendiente igual, no la crees y dilo.
- "ya entregué…", "ya di…" o "terminé…" sobre una tarea pendiente es completar_tarea.
- Estudio: "hazme preguntas de Big Data", "quiero repasar la semana 6" → preguntas_estudio (genera preguntas nuevas desde sus apuntes de Clases y las guarda en el Banco de preguntas). "quiero practicar", "tómame las preguntas de Compiladores" → practicar (usa las que ya existen, empezando por las que menos domina). "resume la semana de Big Data" → resumen_semanal. "semana" null = la semana actual del semestre. Usa solo una de estas tres por mensaje y no escribas tú las preguntas ni el resumen: los hace el Worker. Si no sabe la materia, pregúntala.
- Memoria: si Kevin pide explícitamente que recuerdes algo ("recuerda que…", "de ahora en adelante…", "no olvides que…"), usa recordar con una frase clara ("Prefiere respuestas cortas", "Trabaja los sábados por la mañana"). Si pide olvidar algo de la lista, usa olvidar. Nunca guardes con recordar algo que no pidió.
- Si notas un patrón claro y repetido sobre cómo le gustan las respuestas o cómo organiza su estudio (por ejemplo, siempre pide viñetas, o la valoración muestra que tus respuestas le parecen largas), puedes sugerirlo con proponer_recuerdo; él decide si se guarda. Máximo una por mensaje, solo si no está ya en la lista, y nunca sobre salud, dinero, familia u otros temas delicados.
- Apuntes de clase ("en la clase de hoy de Big Data vimos…", "en la clase nos dieron…", "el licen explicó que…") son apunte_clase. "materia" va solo si Kevin la nombra o es obvia; si dice "la clase" sin materia, usa null y el Worker la deduce del horario. "fecha" null significa hoy. "contenido": una viñeta por idea, con las mismas palabras de Kevin, solo corrigiendo ortografía y puntuación; no agregues explicaciones, definiciones ni datos que él no dijo, y no quites ninguno. "tema": 3 a 8 palabras sobre lo principal.
- Datos de docentes o compañeros son guardar_persona: nombre, apodo, rol, correo, teléfono, grupo, cumpleaños, materias y notas (personalidad, gustos, cómo prefiere que le escriban…; una frase clara por dato). Si Kevin no dice el nombre pero sí "el licen/profe de Big Data", usa "profesor_de" con esa materia y "nombre" null. Si usa un apodo ("el licen Pulu"), ponlo en "apodo". Cumpleaños sin año: "MM-DD".
- Lo que un profesor dijo sobre la materia (temas, cómo será la prueba) va como apunte_clase; si además da una fecha de entrega o evaluación, agrega crear_tarea. Lo que describe a la persona va en guardar_persona. Un mismo mensaje puede tener varias acciones.
- Lo que no sea una tarea ni un dato de contacto (cómo son las pruebas, temas, consejos, ideas, pedidos largos) va con nota_inbox.
- Toda pregunta sobre sus pendientes o fechas ("¿qué tengo esta semana?", "¿tengo prueba el martes 17?", "¿el 17 tengo algo?") se responde SIEMPRE con mostrar_tareas y el rango de fechas que corresponda (un solo día si pregunta por un día). Nunca respondas de memoria ni por el historial; la lista la muestra la app, no la repitas. En "respuesta" di solo algo breve como "Esto tienes para el martes 17".
- Si solo conversa o pide algo ajeno a Notion, responde sin acciones.
- "respuesta" confirma en pocas palabras; no repite los detalles que ya muestran las acciones.`;
}

// ---------- Interpretación ----------

// Saca el objeto JSON de la respuesta del modelo, aunque venga con razonamiento o bloques de código alrededor.
export function extraerPlan(raw) {
  let t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloque) t = bloque[1].trim();
  const ini = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (ini < 0 || fin <= ini) return { ok: false, error: 'no hay un objeto JSON' };
  let plan;
  try {
    plan = JSON.parse(t.slice(ini, fin + 1));
  } catch (e) {
    return { ok: false, error: 'JSON mal formado' };
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok: false, error: 'no es un objeto' };
  const respuesta = typeof plan.respuesta === 'string' ? plan.respuesta.trim() : '';
  const acciones = Array.isArray(plan.acciones) ? plan.acciones : [];
  if (!respuesta && !acciones.length) return { ok: false, error: 'falta "respuesta"' };
  return { ok: true, respuesta, acciones };
}

const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'));
const esHora = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const cadena = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const esCorreo = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const esId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(v);

// Fila conocida por su clave corta: r (resultado de consulta), c (clase del horario) o t (tarea pendiente).
function filaDe(claves, k) {
  if (typeof k !== 'string') return null;
  const r = claves.filas?.find((f) => f.clave === k);
  if (r) return r;
  const c = claves.clases?.find((x) => x.clave === k);
  if (c) return { id: c.id, url: c.url, titulo: c.titulo, baseId: claves.dsHorario };
  const t = claves.tareas?.find((x) => x.clave === k);
  if (t) return { id: t.id, url: t.url, titulo: t.titulo, baseId: claves.dsTareas };
  return null;
}

// Traduce claves cortas o nombres ya buscados a IDs de páginas para las relaciones.
function resolvedor(claves) {
  return (v) => {
    if (typeof v !== 'string' || !v.trim()) return null;
    const m = claves.materias.find((x) => x.clave === v || normal(x.nombre) === normal(v));
    if (m) return m.id;
    const f = filaDe(claves, v);
    if (f) return f.id;
    if (esId(v)) return v;
    return claves.nombres?.get(normal(v)) || null;
  };
}

const baseDe = (claves, k) => claves.bases.find((b) => b.clave === k || sinGuiones(b.id) === sinGuiones(k));

// Antes de validar, busca en Notion las relaciones escritas por nombre (por ejemplo, un semestre o una clase).
async function prepararNombres(env, acciones, claves) {
  const resolver = resolvedor(claves);
  const pendientes = [];
  for (const a of acciones) {
    if (!['crear_fila', 'editar_fila', 'consultar_base'].includes(a?.accion)) continue;
    const base = a.accion === 'editar_fila' ? claves.bases.find((b) => sinGuiones(b.id) === sinGuiones(filaDe(claves, a.fila)?.baseId)) : baseDe(claves, a.base);
    if (!base) continue;
    const pares = a.accion === 'consultar_base'
      ? (Array.isArray(a.filtros) ? a.filtros : []).map((f) => [f?.propiedad, f?.valor])
      : Object.entries(a.propiedades || {});
    for (const [n, v] of pares) {
      const p = base.props.find((x) => normal(x.nombre) === normal(n));
      if (p?.tipo !== 'relation' || !p.destino) continue;
      for (const x of Array.isArray(v) ? v : [v]) {
        if (typeof x === 'string' && x.trim() && !resolver(x)) pendientes.push([p.destino, x]);
      }
    }
  }
  for (const [destino, nombre] of pendientes.slice(0, 8)) {
    const b = claves.bases.find((x) => sinGuiones(x.id) === sinGuiones(destino));
    if (!b) continue;
    const id = await buscarPorTitulo(env, b, nombre).catch(() => null);
    if (id) claves.nombres.set(normal(nombre), id);
  }
}

// Revisa cada acción y traduce las claves cortas (m1, t1, b1, r1, c1) a IDs de Notion. Las inválidas se informan, no se ejecutan.
export function validarAcciones(acciones, claves) {
  const validas = [];
  const descartadas = [];
  const materia = (k) => (k ? claves.materias.find((m) => m.clave === k) : null);
  const resolver = resolvedor(claves);
  for (const a of acciones.slice(0, MAX_ACCIONES)) {
    const tipo = a?.accion;
    try {
      if (tipo === 'preguntas_estudio' || tipo === 'practicar' || tipo === 'resumen_semanal') {
        if (validas.some((x) => ['preguntas_estudio', 'practicar', 'resumen_semanal'].includes(x.accion))) throw new Error('solo una acción de estudio por mensaje');
        const m = materia(a.materia);
        if (!m) throw new Error('¿de qué materia? no la reconocí');
        const semana = Number.isInteger(a.semana) && a.semana >= 1 && a.semana <= 20 ? a.semana : null;
        validas.push({ accion: tipo, materiaId: m.id, materiaNombre: m.nombre, semana, cantidad: a.cantidad });
        continue;
      }
      if (tipo === 'recordar' || tipo === 'proponer_recuerdo') {
        const t = cadena(a.texto, 300);
        if (!t) throw new Error('el recuerdo está vacío');
        if (claves.memoria.some((m) => normal(m.texto) === normal(t))) throw new Error('eso ya está en la memoria');
        validas.push({ accion: tipo, texto: t });
        continue;
      }
      if (tipo === 'olvidar') {
        const m = claves.memoria.find((x) => x.clave === a.memoria);
        if (!m) throw new Error('no encontré ese recuerdo');
        validas.push({ accion: tipo, id: m.id, texto: m.texto, origen: m.origen });
        continue;
      }
      if (tipo === 'consultar_base') {
        const base = baseDe(claves, a.base);
        if (!base) throw new Error(`no conozco la base ${a.base}`);
        validas.push({ accion: tipo, base, buscar: cadena(a.buscar, 100), filtros: Array.isArray(a.filtros) ? a.filtros : [], limite: a.limite, mostrar: a.mostrar === true });
        continue;
      }
      if (tipo === 'leer_pagina') {
        const f = filaDe(claves, a.fila);
        if (!f) throw new Error('no sé qué página leer; primero consulta la base');
        validas.push({ accion: tipo, fila: f });
        continue;
      }
      if (tipo === 'crear_fila') {
        const base = baseDe(claves, a.base);
        if (!base) throw new Error(`no conozco la base ${a.base}`);
        const { salida, legibles } = propiedadesEscritura(base, a.propiedades, resolver);
        validas.push({ accion: tipo, base, propiedades: salida, legibles });
        continue;
      }
      if (tipo === 'editar_fila' || tipo === 'archivar_fila') {
        const f = filaDe(claves, a.fila);
        if (!f) throw new Error('no sé qué fila cambiar; primero consulta la base');
        const base = claves.bases.find((b) => sinGuiones(b.id) === sinGuiones(f.baseId));
        if (tipo === 'archivar_fila') { validas.push({ accion: tipo, fila: f, baseNombre: base?.nombre || null }); continue; }
        if (!base) throw new Error('no conozco la base de esa fila');
        const { salida, legibles } = propiedadesEscritura(base, a.propiedades, resolver);
        validas.push({ accion: tipo, fila: f, base, propiedades: salida, legibles });
        continue;
      }
      if (tipo === 'crear_tarea') {
        const titulo = cadena(a.titulo, 200);
        if (!titulo) throw new Error('la tarea no tiene título');
        if (a.fecha != null && !esFecha(a.fecha)) throw new Error(`fecha inválida (${a.fecha})`);
        const m = materia(a.materia);
        validas.push({
          accion: tipo, titulo,
          tipo: TIPOS_TAREA.includes(a.tipo) ? a.tipo : 'Tarea',
          fecha: a.fecha || null,
          hora: a.fecha && esHora(a.hora) ? a.hora : null,
          materia: m?.id || null, materiaNombre: m?.nombre || null,
          grupal: a.grupal === true,
        });
      } else if (tipo === 'completar_tarea') {
        const t = claves.tareas.find((x) => x.clave === a.tarea);
        if (!t) throw new Error('no encontré esa tarea entre las pendientes');
        validas.push({ accion: tipo, id: t.id, titulo: t.titulo, url: t.url });
      } else if (tipo === 'guardar_persona') {
        const nombre = cadena(a.nombre, 120);
        const apodo = cadena(a.apodo, 80);
        const prof = materia(a.profesor_de);
        if (!nombre && !apodo && !prof) throw new Error('no sé de quién se trata; falta el nombre');
        const mats = (Array.isArray(a.materias) ? a.materias : []).map(materia).filter(Boolean);
        validas.push({
          accion: tipo, nombre, apodo, profesorDe: prof?.id || null,
          rol: ROLES.includes(a.rol) ? a.rol : null,
          correo: esCorreo(a.correo) ? a.correo.trim() : null,
          telefono: cadena(a.telefono, 40),
          notas: cadena(a.notas, 1000),
          grupo: cadena(a.grupo, 60),
          cumpleanos: typeof a.cumpleanos === 'string' && /^(\d{4}-)?\d{2}-\d{2}$/.test(a.cumpleanos) ? a.cumpleanos : null,
          materias: mats.map((m) => m.id), materiasNombres: [...mats.map((m) => m.nombre), ...(prof && !mats.includes(prof) ? [prof.nombre] : [])],
        });
      } else if (tipo === 'apunte_clase') {
        const lineas = (Array.isArray(a.contenido) ? a.contenido : [a.contenido]).map((x) => cadena(x, 1900)).filter(Boolean);
        if (!lineas.length) throw new Error('el apunte está vacío');
        if (a.fecha != null && !esFecha(a.fecha)) throw new Error(`fecha inválida (${a.fecha})`);
        const fecha = a.fecha || claves.fecha;
        let m = materia(a.materia);
        if (!m && fecha === claves.fecha) {
          const c = claseReciente(claves.clases, fecha, claves.hora);
          if (c?.materiaId) m = claves.materias.find((x) => sinGuiones(x.id) === sinGuiones(c.materiaId)) || { id: c.materiaId, nombre: c.materia || c.titulo };
        }
        if (!m) throw new Error('no sé de qué materia es la clase; dime la materia y lo guardo');
        if (!claves.dsClases) throw new Error('falta configurar la base Clases');
        validas.push({ accion: tipo, materiaId: m.id, materiaNombre: m.nombre, fecha, tema: cadena(a.tema, 120), lineas });
      } else if (tipo === 'nota_inbox') {
        const texto = cadena(a.texto, 1900);
        if (!texto) throw new Error('la nota está vacía');
        const m = materia(a.materia);
        validas.push({ accion: tipo, texto, materia: m?.id || null, materiaNombre: m?.nombre || null });
      } else if (tipo === 'mostrar_tareas') {
        if (!esFecha(a.desde) || !esFecha(a.hasta)) throw new Error('rango de fechas inválido');
        const [desde, hasta] = a.desde <= a.hasta ? [a.desde, a.hasta] : [a.hasta, a.desde];
        validas.push({ accion: tipo, desde, hasta });
      } else {
        throw new Error(`acción desconocida (${tipo})`);
      }
    } catch (e) {
      descartadas.push({ accion: tipo || '?', error: e.message });
    }
  }
  return { validas, descartadas };
}

// ---------- Ejecución ----------

// Resumen corto de una fila consultada para mostrarla en la app.
function resumenFila(props) {
  return Object.entries(props).filter(([, v]) => typeof v !== 'object' || Array.isArray(v)).slice(0, 4)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v === true ? 'sí' : v === false ? 'no' : v}`).join(' · ');
}

async function ejecutar(env, a, lista, ctx = {}) {
  switch (a.accion) {
    case 'crear_tarea': {
      const p = await crearTarea(env, a);
      return { accion: a.accion, ok: true, titulo: a.titulo, tipo: a.tipo, fecha: a.fecha, hora: a.hora, materia: a.materiaNombre, grupal: a.grupal, url: p.url,
        deshacer: { tipo: 'papelera', id: p.id } };
    }
    case 'completar_tarea': {
      await marcarTarea(env, a.id, true);
      return { accion: a.accion, ok: true, titulo: a.titulo, url: a.url,
        deshacer: { tipo: 'propiedades', id: a.id, propiedades: { Completada: { checkbox: false } } } };
    }
    case 'preguntas_estudio': {
      ctx.progreso?.(`Leyendo tus apuntes de ${a.materiaNombre}…`);
      const r = await generarPreguntas(env, { ...a, modelo: ctx.modelo });
      return { accion: a.accion, ok: true, materia: a.materiaNombre, semana: r.semana, tarjetas: r.tarjetas, deshacer: r.deshacer };
    }
    case 'practicar': {
      const r = await elegirPractica(env, a);
      return { accion: a.accion, ok: true, materia: a.materiaNombre, total: r.total, tarjetas: r.tarjetas };
    }
    case 'resumen_semanal': {
      ctx.progreso?.(`Resumiendo la semana de ${a.materiaNombre}…`);
      const r = await resumenSemanal(env, { ...a, modelo: ctx.modelo });
      return { accion: a.accion, ok: true, materia: a.materiaNombre, semana: r.semana, titulo: r.titulo, url: r.url, yaExistia: !!r.yaExistia, puntos: r.puntos, deshacer: r.deshacer || null };
    }
    case 'recordar': {
      const m = await agregarMemoria(env, a.texto, 'usuario');
      return { accion: a.accion, ok: true, texto: m.texto, deshacer: m.repetido ? null : { tipo: 'memoria', id: m.id } };
    }
    case 'olvidar': {
      await borrarMemoria(env, a.id);
      return { accion: a.accion, ok: true, texto: a.texto, deshacer: { tipo: 'memoria_volver', texto: a.texto, origen: a.origen } };
    }
    case 'proponer_recuerdo':
      return { accion: a.accion, ok: true, texto: a.texto, estado: 'pendiente' };
    case 'apunte_clase': {
      const r = await guardarApunte(env, a, { clases: ctx.clases, base: ctx.bases.find((b) => sinGuiones(b.id) === sinGuiones(env.NOTION_DS_CLASES)) });
      return { accion: a.accion, ok: true, titulo: r.titulo, materia: a.materiaNombre, fecha: a.fecha, creada: r.creada, semana: r.semana, numero: r.numero,
        lineas: a.lineas.length, url: r.url, deshacer: r.deshacer };
    }
    case 'guardar_persona': {
      const r = await guardarPersona(env, a);
      return { accion: a.accion, ok: true, nombre: r.nombre || a.nombre, rol: a.rol, materias: a.materiasNombres, creada: r.creada, sinCambios: !!r.sinCambios,
        cambios: r.cambios || null, url: r.url, deshacer: r.deshacer };
    }
    case 'nota_inbox': {
      const p = await notaInbox(env, a);
      return { accion: a.accion, ok: true, texto: a.texto, materia: a.materiaNombre, url: p.url, deshacer: { tipo: 'papelera', id: p.id } };
    }
    case 'mostrar_tareas': {
      const tareas = await consultarTareas(env, { desde: a.desde, hasta: a.hasta, completadas: true }, lista);
      return { accion: a.accion, ok: true, desde: a.desde, hasta: a.hasta, tareas };
    }
    case 'crear_fila': {
      const p = await crearFila(env, a.base, a.propiedades);
      const t = a.base.props.find((x) => x.tipo === 'title')?.nombre;
      return { accion: a.accion, ok: true, base: a.base.nombre, titulo: (t && a.legibles[t]) || 'Nueva fila', valores: a.legibles, url: p.url,
        deshacer: { tipo: 'papelera', id: p.id } };
    }
    case 'editar_fila': {
      const r = await editarFila(env, a.fila.id, a.propiedades);
      return { accion: a.accion, ok: true, base: a.base.nombre, titulo: a.fila.titulo, valores: a.legibles, url: r.url || a.fila.url,
        deshacer: { tipo: 'propiedades', id: a.fila.id, propiedades: r.anteriores } };
    }
    case 'archivar_fila': {
      const r = await archivarFila(env, a.fila.id);
      return { accion: a.accion, ok: true, base: a.baseNombre, titulo: a.fila.titulo, url: r.url || a.fila.url, deshacer: { tipo: 'restaurar', id: a.fila.id } };
    }
    default:
      throw new Error('acción desconocida');
  }
}

// Resumen breve de un mensaje del asistente para dárselo al modelo como contexto en los siguientes turnos.
function resumenParaModelo(m) {
  const r = m.datos?.resultados || [];
  const hechos = r.filter((x) => x.ok && !['mostrar_tareas', 'consultar_base', 'leer_pagina'].includes(x.accion)).map((x) => {
    if (x.accion === 'crear_tarea') return `creé "${x.titulo}" (${x.tipo}, ${x.fecha || 'sin fecha'})`;
    if (x.accion === 'completar_tarea') return `marqué como hecha "${x.titulo}"`;
    if (x.accion === 'guardar_persona') return `guardé a ${x.nombre}`;
    if (x.accion === 'nota_inbox') return 'guardé una nota en el Inbox';
    if (x.accion === 'preguntas_estudio') return `guardé ${x.tarjetas.length} preguntas nuevas de ${x.materia} (semana ${x.semana}) en el Banco de preguntas`;
    if (x.accion === 'practicar') return `le mostré ${x.tarjetas.length} preguntas de ${x.materia} para practicar`;
    if (x.accion === 'resumen_semanal') return x.yaExistia ? `el resumen de ${x.materia} semana ${x.semana} ya existía` : `creé el resumen "${x.titulo}"`;
    if (x.accion === 'recordar') return `guardé en la memoria: "${x.texto}"`;
    if (x.accion === 'olvidar') return `borré de la memoria: "${x.texto}"`;
    if (x.accion === 'proponer_recuerdo') return `propuse recordar: "${x.texto}" (${x.estado || 'pendiente'})`;
    if (x.accion === 'apunte_clase') return `agregué ${x.lineas} apunte(s) a la clase "${x.titulo}" (${x.materia}, ${x.fecha})`;
    if (x.accion === 'crear_fila') return `creé "${x.titulo}" en ${x.base}`;
    if (x.accion === 'editar_fila') return `cambié ${Object.keys(x.valores || {}).join(', ')} de "${x.titulo}" en ${x.base}`;
    if (x.accion === 'archivar_fila') return `mandé "${x.titulo}" a la papelera`;
    if (x.accion === 'consultar_base') return '';
    return '';
  }).filter(Boolean);
  if (!hechos.length) return m.texto;
  if (m.datos?.deshecho) return `${m.texto}\n[DESHECHO: Kevin anuló esto y ya no existe en Notion: ${hechos.join('; ')}]`;
  return `${m.texto}\n[Hecho: ${hechos.join('; ')}]`;
}

// Procesa un mensaje completo. Solo guarda en el historial si hubo respuesta del modelo.
// Historial que manda la app en un chat temporal (no se guarda en D1): se limpia y se recorta.
function previosTemporales(lista) {
  return (Array.isArray(lista) ? lista : []).slice(-HISTORIAL_CONTEXTO).map((m) => ({
    rol: m?.rol === 'usuario' ? 'usuario' : 'asistente',
    texto: String(m?.texto || '').slice(0, MAX_TEXTO),
    datos: m?.rol === 'usuario' ? null : { resultados: Array.isArray(m?.datos?.resultados) ? m.datos.resultados.slice(0, 10) : [], deshecho: !!m?.datos?.deshecho },
  })).filter((m) => m.texto);
}

export async function procesarMensaje(env, { texto, modelo, chat: chatPedido, temporal = false, historial: historialCliente, progreso: progresoFn }) {
  const progreso = typeof progresoFn === 'function' ? progresoFn : () => {};
  const entrada = typeof texto === 'string' ? texto.trim() : '';
  if (!entrada) throw new ErrorAsistente(400, 'Escribe un mensaje');
  if (entrada.length > MAX_TEXTO) throw new ErrorAsistente(400, `El mensaje es demasiado largo (máximo ${MAX_TEXTO} caracteres)`);
  const base = await db(env);

  progreso('Leyendo tu Notion…');
  const fechaHoy = hoy();
  const lista = await leerMaterias(env);
  const [pendientes, semana, todas] = await Promise.all([
    consultarTareas(env, { desde: sumarDias(fechaHoy, -30), hasta: sumarDias(fechaHoy, 120), sinFecha: true, limite: 60 }, lista),
    horarioSemana(env, lista).catch(() => null),
    leerBases(env).catch(() => []),
  ]);
  const basesConClave = todas.map((b, i) => ({ ...b, clave: `b${i + 1}` }));
  const claves = {
    materias: lista.map((m, i) => ({ ...m, clave: `m${i + 1}` })),
    tareas: pendientes.map((t, i) => ({ ...t, clave: `t${i + 1}` })),
    clases: (semana || []).map((c, i) => ({ ...c, clave: `c${i + 1}` })),
    bases: basesConClave,
    basesTexto: basesConClave.length ? basesParaPrompt(basesConClave) : '(no se pudieron leer)',
    filas: [], nombres: new Map(),
    memoria: (await listarMemoria(env)).map((m, i) => ({ ...m, clave: `k${i + 1}` })),
    valoraciones: await resumenValoraciones(base).catch(() => null),
    dsHorario: env.NOTION_DS_HORARIO, dsTareas: env.NOTION_DS_TAREAS, dsClases: env.NOTION_DS_CLASES,
    fecha: fechaHoy,
    hora: horaActual(),
    modelo, progreso,
  };

  // Chat: el temporal no se guarda; uno normal se crea con el primer mensaje si no existe.
  let chatInfo = null;
  if (!temporal) {
    if (chatPedido) {
      const c = await base.prepare('SELECT id, titulo FROM chats WHERE id = ?').bind(Number(chatPedido)).first();
      if (!c) throw new ErrorAsistente(404, 'Ese chat ya no existe');
      chatInfo = c;
    } else {
      chatInfo = await crearChat(env, entrada);
    }
  }
  const previos = temporal ? previosTemporales(historialCliente) : await historial(env, { chat: chatInfo.id, limite: HISTORIAL_CONTEXTO });
  const mensajes = [
    { role: 'system', content: prompt(fechaHoy, claves) },
    ...previos.map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'assistant', content: m.rol === 'usuario' ? m.texto : resumenParaModelo(m) })),
    { role: 'user', content: entrada },
  ];

  let fallos = [];
  let reintentos = 0;
  let ultimo = null;
  // Una llamada al modelo; si el JSON viene mal, se pide una vez más.
  async function pedir(msgs) {
    let r = await chat(env, { mensajes: msgs, modelo });
    fallos.push(...(r.fallos || []));
    let plan = extraerPlan(r.texto);
    if (!plan.ok) {
      reintentos++;
      const otra = await chat(env, {
        mensajes: [...msgs, { role: 'assistant', content: r.texto.slice(0, 4000) },
          { role: 'user', content: `Tu respuesta anterior no sirve (${plan.error}). Responde de nuevo SOLO con el objeto JSON {"respuesta": ..., "acciones": [...]}.` }],
        modelo,
      });
      fallos.push(...(otra.fallos || []));
      r = otra;
      plan = extraerPlan(r.texto);
    }
    ultimo = r;
    return { r, plan };
  }

  progreso('Pensando…');
  let { r, plan } = await pedir(mensajes);
  let aviso = null;
  const resultados = [];
  const ejecutarTodas = async (acciones) => {
    await prepararNombres(env, acciones, claves);
    const { validas, descartadas } = validarAcciones(acciones, claves);
    for (const a of validas) {
      try {
        resultados.push(await ejecutar(env, a, lista, claves));
      } catch (e) {
        resultados.push({ accion: a.accion, ok: false, error: e.message, titulo: a.titulo || a.nombre || a.fila?.titulo || null });
      }
    }
    for (const d of descartadas) resultados.push({ accion: d.accion, ok: false, error: `No se ejecutó: ${d.error}` });
  };

  // Paso de lectura: si el modelo pidió consultar bases o leer páginas, se ejecuta y se le devuelven los resultados.
  // Hasta dos rondas (por ejemplo: consultar Clases y luego leer la página encontrada).
  let lecturasPrevias = [];
  for (let ronda = 0; ronda < 2 && plan.ok && plan.acciones.some((x) => LECTURAS.has(x?.accion)); ronda++) {
    const lecturas = plan.acciones.filter((x) => LECTURAS.has(x?.accion)).slice(0, 3);
    const informe = [];
    await prepararNombres(env, lecturas, claves);
    const { validas, descartadas } = validarAcciones(lecturas, claves);
    for (const a of validas) {
      try {
        progreso(a.accion === 'consultar_base' ? `Consultando ${a.base.nombre}…` : `Leyendo "${a.fila.titulo}"…`);
        if (a.accion === 'consultar_base') {
          const q = await consultar(env, a.base, a, { materias: lista, resolverRelacion: resolvedor(claves) });
          const filas = q.filas.map((f) => {
            const clave = `r${claves.filas.length + 1}`;
            claves.filas.push({ clave, id: f.id, url: f.url, titulo: f.titulo, baseId: a.base.id });
            return { clave, ...f };
          });
          informe.push(`Consulta a ${a.base.nombre}${q.mas ? ' (hay más filas)' : ''}:\n${filas.length ? filas.map((f) => `${f.clave}: ${f.titulo} · ${JSON.stringify(f.propiedades)}`).join('\n') : '(sin resultados)'}`);
          resultados.push({ accion: 'consultar_base', ok: true, base: a.base.nombre, mostrar: a.mostrar, total: filas.length, mas: q.mas,
            filas: filas.slice(0, 15).map((f) => ({ titulo: f.titulo, url: f.url, resumen: resumenFila(f.propiedades) })) });
        } else {
          const contenido = await leerPagina(env, a.fila.id);
          informe.push(`Contenido de "${a.fila.titulo}":\n${contenido || '(página vacía)'}`);
          resultados.push({ accion: 'leer_pagina', ok: true, titulo: a.fila.titulo, url: a.fila.url });
        }
      } catch (e) {
        const msg = e instanceof ErrorBase ? e.message : e.message || 'error';
        informe.push(`No se pudo ${a.accion === 'leer_pagina' ? 'leer la página' : 'consultar ' + a.base.nombre}: ${msg}`);
        resultados.push({ accion: a.accion, ok: false, error: msg, titulo: a.base?.nombre || a.fila?.titulo || null });
      }
    }
    for (const d of descartadas) informe.push(`No se ejecutó ${d.accion}: ${d.error}`);
    lecturasPrevias = [...lecturasPrevias,
      { role: 'assistant', content: JSON.stringify({ respuesta: plan.respuesta, acciones: lecturas }) },
      { role: 'user', content: `Resultados de Notion:\n${informe.join('\n\n').slice(0, 14000)}\n\n${ronda === 0
        ? 'Responde SOLO el JSON final para Kevin. Puedes incluir escrituras con las claves "r…". Si de verdad necesitas leer una página encontrada, puedes pedir una última lectura (leer_pagina).'
        : 'Responde SOLO el JSON final para Kevin. Puedes incluir escrituras con las claves "r…"; ya no hay más lecturas.'}` }];
    progreso('Pensando…');
    ({ r, plan } = await pedir([...mensajes, ...lecturasPrevias]));
    if (plan.ok && ronda === 1) plan.acciones = plan.acciones.filter((x) => !LECTURAS.has(x?.accion));
  }

  if (!plan.ok) {
    aviso = 'El modelo no devolvió acciones en el formato esperado, así que no se guardó nada en Notion.';
    plan = { respuesta: String(r.texto).replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 2000) || 'No entendí el mensaje.', acciones: [] };
  }
  const escrituras = plan.acciones.filter((x) => !LECTURAS.has(x?.accion));
  if (escrituras.some((x) => !['mostrar_tareas', 'practicar', 'proponer_recuerdo'].includes(x?.accion))) progreso('Guardando en Notion…');
  await ejecutarTodas(escrituras);
  r = ultimo || r;
  if (!aviso && resultados.some((x) => !x.ok)) aviso = 'Algo no se pudo hacer; revisa el detalle arriba.';
  // Si cambió el horario o las materias, se borra su caché para que el panel y el siguiente mensaje lo vean.
  const tocadas = resultados.filter((x) => x.ok && ['crear_fila', 'editar_fila', 'archivar_fila'].includes(x.accion)).map((x) => x.base);
  if (env.CONFIG && tocadas.length) {
    const nombreDe = (id) => claves.bases.find((b) => sinGuiones(b.id) === sinGuiones(id))?.nombre;
    if (tocadas.includes(nombreDe(env.NOTION_DS_HORARIO))) await env.CONFIG.delete(CLAVE_HORARIO).catch(() => {});
    if (tocadas.includes(nombreDe(env.NOTION_DS_MATERIAS))) await env.CONFIG.delete('notion:materias').catch(() => {});
  }
  const datos = {
    resultados,
    modelo: r.modelo, proveedor: r.proveedor,
    respaldo: fallos.length ? true : undefined,
    reintento: reintentos ? true : undefined,
    aviso,
  };
  const ahora = Date.now();
  const respuesta = plan.respuesta || 'Listo.';
  if (temporal) {
    return {
      temporal: true,
      usuario: { id: `t${ahora}u`, rol: 'usuario', texto: entrada, datos: null, creado: ahora },
      asistente: { id: `t${ahora}a`, rol: 'asistente', texto: respuesta, datos, creado: ahora + 1 },
    };
  }
  const [u, a] = await base.batch([
    base.prepare('INSERT INTO mensajes (rol, texto, datos, creado, chat) VALUES (?, ?, NULL, ?, ?)').bind('usuario', entrada, ahora, chatInfo.id),
    base.prepare('INSERT INTO mensajes (rol, texto, datos, creado, chat) VALUES (?, ?, ?, ?, ?)').bind('asistente', respuesta, JSON.stringify(datos), ahora + 1, chatInfo.id),
    base.prepare('UPDATE chats SET actualizado = ? WHERE id = ?').bind(ahora + 1, chatInfo.id),
  ]);
  return {
    chat: { id: chatInfo.id, titulo: chatInfo.titulo },
    usuario: { id: u.meta.last_row_id, rol: 'usuario', texto: entrada, datos: null, creado: ahora, chat: chatInfo.id },
    asistente: { id: a.meta.last_row_id, rol: 'asistente', texto: respuesta, datos, creado: ahora + 1, chat: chatInfo.id },
  };
}

// Un paso de deshacer: en Notion o en la memoria (D1).
async function deshacerUno(env, p) {
  if (p.tipo === 'memoria') return borrarMemoria(env, p.id);
  if (p.tipo === 'memoria_volver') return agregarMemoria(env, p.texto, p.origen || 'usuario');
  return deshacerPaso(env, p);
}

const PASOS_VALIDOS = new Set(['papeleras', 'papelera', 'propiedades', 'bloques', 'restaurar', 'memoria', 'memoria_volver']);

async function revertir(env, datos) {
  if (datos?.deshecho) throw new ErrorAsistente(409, 'Ese mensaje ya se deshizo');
  const pasos = (datos?.resultados || []).filter((x) => x?.ok && x.deshacer && PASOS_VALIDOS.has(x.deshacer.tipo)).map((x) => x.deshacer).reverse();
  if (!pasos.length) throw new ErrorAsistente(400, 'Ese mensaje no hizo cambios que deshacer');
  const errores = [];
  for (const p of pasos) {
    try { await deshacerUno(env, p); } catch (e) { errores.push(e.message); }
  }
  if (errores.length === pasos.length) throw new ErrorAsistente(502, `No se pudo deshacer: ${errores[0]}`);
  return { ...datos, deshecho: true, erroresDeshacer: errores.length ? errores : undefined };
}

// Revierte lo que hizo un mensaje guardado (en orden inverso) y lo marca como deshecho.
export async function deshacerMensaje(env, id) {
  const base = await db(env);
  const row = await base.prepare('SELECT * FROM mensajes WHERE id = ? AND rol = ?').bind(Number(id), 'asistente').first();
  if (!row) throw new ErrorAsistente(404, 'No encontré ese mensaje');
  const m = fila(row);
  const datos = await revertir(env, m.datos);
  await base.prepare('UPDATE mensajes SET datos = ? WHERE id = ?').bind(JSON.stringify(datos), m.id).run();
  return { ...m, datos };
}

// En un chat temporal el mensaje no está en D1: la app manda sus datos y solo se revierten pasos conocidos.
export async function deshacerTemporal(env, datos) {
  return { datos: await revertir(env, datos) };
}

export { ErrorIA };
