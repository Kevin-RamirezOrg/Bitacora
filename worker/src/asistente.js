// Asistente: convierte lo que escribe Kevin en acciones sobre Notion.
// El modelo responde un JSON con { respuesta, acciones }; el Worker lo valida, lo ejecuta y guarda el historial en D1.

import { ErrorIA, chat } from './ia.js';
import {
  ROLES, TIPOS_TAREA, consultarTareas, crearTarea, deshacer as deshacerPaso, diaSemana, guardarPersona,
  hoy, marcarTarea, materias as leerMaterias, notaInbox, sumarDias,
} from './notion.js';

const MAX_ACCIONES = 5;
const MAX_TEXTO = 4000;
const HISTORIAL_CONTEXTO = 8;

export class ErrorAsistente extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// ---------- Historial en D1 ----------

let tablaLista = false;
async function db(env) {
  if (!env.DB) throw new ErrorAsistente(503, 'Falta la base D1 del historial en Cloudflare');
  if (!tablaLista) {
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, rol TEXT NOT NULL, texto TEXT NOT NULL, datos TEXT, creado INTEGER NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS mensajes_creado ON mensajes (creado)'),
    ]);
    tablaLista = true;
  }
  return env.DB;
}

const fila = (r) => ({ id: r.id, rol: r.rol, texto: r.texto, datos: r.datos ? JSON.parse(r.datos) : null, creado: r.creado });

export async function historial(env, { antes, limite = 50 } = {}) {
  const base = await db(env);
  const n = Math.min(Math.max(Number(limite) || 50, 1), 100);
  const q = antes
    ? base.prepare('SELECT * FROM mensajes WHERE id < ? ORDER BY id DESC LIMIT ?').bind(Number(antes), n)
    : base.prepare('SELECT * FROM mensajes ORDER BY id DESC LIMIT ?').bind(n);
  const { results } = await q.all();
  return results.map(fila).reverse();
}

export async function borrarHistorial(env) {
  await (await db(env)).prepare('DELETE FROM mensajes').run();
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
  const mats = claves.materias.length
    ? claves.materias.map((m) => `${m.clave}: ${m.nombre}${m.codigo ? ` (${m.codigo})` : ''}${m.profesor ? `; profesor: ${m.profesor}` : ''}`).join('\n')
    : '(ninguna registrada)';
  const tareas = claves.tareas.length
    ? claves.tareas.map((t) => `${t.clave}: ${t.tipo || 'Sin tipo'} · ${t.titulo} · ${t.materia || 'sin materia'} · ${t.fecha || 'sin fecha'}${t.hora ? ' ' + t.hora : ''}`).join('\n')
    : '(no hay pendientes)';
  return `Eres el asistente de estudio de Kevin, estudiante universitario en Ecuador. Conviertes lo que escribe en acciones sobre su Notion y le respondes en español, tratándolo de tú, en una o dos frases.

Hoy es ${diaSemana(fechaHoy)} ${fechaHoy} (zona horaria America/Guayaquil).
Calendario de referencia:
${calendario(fechaHoy)}

Materias (usa la clave, por ejemplo "m1"):
${mats}

Tareas y evaluaciones pendientes según Notion en este momento (usa la clave, por ejemplo "t1"):
${tareas}
Esta lista es la única fuente de verdad. El historial de la conversación puede mencionar tareas que Kevin deshizo o borró: si no están en esta lista, ya no existen.

Responde SOLO con un objeto JSON válido, sin texto antes ni después y sin bloques de código, con esta forma:
{"respuesta": "texto breve para Kevin", "acciones": []}

Acciones posibles (máximo ${MAX_ACCIONES} por mensaje):
{"accion": "crear_tarea", "titulo": "Prueba 2 de Big Data", "tipo": "${TIPOS_TAREA.join('|')}", "fecha": "AAAA-MM-DD" o null, "hora": "HH:MM" o null, "materia": "m1" o null, "grupal": false}
{"accion": "completar_tarea", "tarea": "t1"}
{"accion": "guardar_persona", "nombre": "Nombre completo", "rol": "${ROLES.join('|')}" o null, "correo": null, "telefono": null, "notas": null, "materias": ["m1"]}
{"accion": "nota_inbox", "texto": "nota clara y autosuficiente", "materia": "m1" o null}
{"accion": "mostrar_tareas", "desde": "AAAA-MM-DD", "hasta": "AAAA-MM-DD"}

Reglas:
- Fechas: resuelve "mañana", "el martes", "el martes 2", "la próxima semana" con el calendario. Si el día de la semana y el número no coinciden, usa la fecha futura más cercana con ese número y dilo en la respuesta. Nunca inventes una fecha: si no hay ninguna, usa null.
- "hora" solo si Kevin la dice.
- Materia: elige la clave que corresponda aunque Kevin la escriba abreviada o con otras palabras. Si no estás seguro, usa null.
- Título corto y específico, sin repetir la fecha.
- Tipo: "prueba", "test" o "lección" es Prueba; "examen" es Examen; "deber", "taller" o "informe" es Tarea; "proyecto" es Proyecto; "leer" es Lectura; matrículas, trámites o eventos de la universidad son Institucional.
- No dupliques: si ya existe una tarea pendiente igual, no la crees y dilo.
- "ya entregué…", "ya di…" o "terminé…" sobre una tarea pendiente es completar_tarea.
- Datos de docentes o compañeros (nombre, correo, teléfono, materia, rol) son guardar_persona.
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

// Revisa cada acción y traduce las claves cortas (m1, t1) a IDs de Notion. Las inválidas se informan, no se ejecutan.
export function validarAcciones(acciones, claves) {
  const validas = [];
  const descartadas = [];
  const materia = (k) => (k ? claves.materias.find((m) => m.clave === k) : null);
  for (const a of acciones.slice(0, MAX_ACCIONES)) {
    const tipo = a?.accion;
    try {
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
        if (!nombre) throw new Error('la persona no tiene nombre');
        const mats = (Array.isArray(a.materias) ? a.materias : []).map(materia).filter(Boolean);
        validas.push({
          accion: tipo, nombre,
          rol: ROLES.includes(a.rol) ? a.rol : null,
          correo: esCorreo(a.correo) ? a.correo.trim() : null,
          telefono: cadena(a.telefono, 40),
          notas: cadena(a.notas, 1000),
          materias: mats.map((m) => m.id), materiasNombres: mats.map((m) => m.nombre),
        });
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

async function ejecutar(env, a, lista) {
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
    case 'guardar_persona': {
      const r = await guardarPersona(env, a);
      return { accion: a.accion, ok: true, nombre: a.nombre, rol: a.rol, materias: a.materiasNombres, creada: r.creada, sinCambios: !!r.sinCambios,
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
    default:
      throw new Error('acción desconocida');
  }
}

// Resumen breve de un mensaje del asistente para dárselo al modelo como contexto en los siguientes turnos.
function resumenParaModelo(m) {
  const r = m.datos?.resultados || [];
  const hechos = r.filter((x) => x.ok && x.accion !== 'mostrar_tareas').map((x) => {
    if (x.accion === 'crear_tarea') return `creé "${x.titulo}" (${x.tipo}, ${x.fecha || 'sin fecha'})`;
    if (x.accion === 'completar_tarea') return `marqué como hecha "${x.titulo}"`;
    if (x.accion === 'guardar_persona') return `guardé a ${x.nombre}`;
    if (x.accion === 'nota_inbox') return 'guardé una nota en el Inbox';
    return '';
  }).filter(Boolean);
  if (!hechos.length) return m.texto;
  if (m.datos?.deshecho) return `${m.texto}\n[DESHECHO: Kevin anuló esto y ya no existe en Notion: ${hechos.join('; ')}]`;
  return `${m.texto}\n[Hecho: ${hechos.join('; ')}]`;
}

// Procesa un mensaje completo. Solo guarda en el historial si hubo respuesta del modelo.
export async function procesarMensaje(env, { texto, modelo }) {
  const entrada = typeof texto === 'string' ? texto.trim() : '';
  if (!entrada) throw new ErrorAsistente(400, 'Escribe un mensaje');
  if (entrada.length > MAX_TEXTO) throw new ErrorAsistente(400, `El mensaje es demasiado largo (máximo ${MAX_TEXTO} caracteres)`);
  const base = await db(env);

  const fechaHoy = hoy();
  const lista = await leerMaterias(env);
  const pendientes = await consultarTareas(env, { desde: sumarDias(fechaHoy, -30), hasta: sumarDias(fechaHoy, 120), sinFecha: true, limite: 60 }, lista);
  const claves = {
    materias: lista.map((m, i) => ({ ...m, clave: `m${i + 1}` })),
    tareas: pendientes.map((t, i) => ({ ...t, clave: `t${i + 1}` })),
  };

  const previos = await historial(env, { limite: HISTORIAL_CONTEXTO });
  const mensajes = [
    { role: 'system', content: prompt(fechaHoy, claves) },
    ...previos.map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'assistant', content: m.rol === 'usuario' ? m.texto : resumenParaModelo(m) })),
    { role: 'user', content: entrada },
  ];

  let r = await chat(env, { mensajes, modelo });
  let plan = extraerPlan(r.texto);
  let reintentos = 0;
  if (!plan.ok) {
    reintentos = 1;
    const otra = await chat(env, {
      mensajes: [...mensajes, { role: 'assistant', content: r.texto.slice(0, 4000) },
        { role: 'user', content: `Tu respuesta anterior no sirve (${plan.error}). Responde de nuevo SOLO con el objeto JSON {"respuesta": ..., "acciones": [...]}.` }],
      modelo,
    });
    r = { ...otra, fallos: [...(r.fallos || []), ...(otra.fallos || [])] };
    plan = extraerPlan(r.texto);
  }
  let aviso = null;
  if (!plan.ok) {
    aviso = 'El modelo no devolvió acciones en el formato esperado, así que no se guardó nada en Notion.';
    plan = { respuesta: String(r.texto).replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 2000) || 'No entendí el mensaje.', acciones: [] };
  }

  const { validas, descartadas } = validarAcciones(plan.acciones, claves);
  const resultados = [];
  for (const a of validas) {
    try {
      resultados.push(await ejecutar(env, a, lista));
    } catch (e) {
      resultados.push({ accion: a.accion, ok: false, error: e.message, titulo: a.titulo || a.nombre || null });
    }
  }
  for (const d of descartadas) resultados.push({ accion: d.accion, ok: false, error: `No se ejecutó: ${d.error}` });

  const datos = {
    resultados,
    modelo: r.modelo, proveedor: r.proveedor,
    respaldo: (r.fallos || []).length ? true : undefined,
    reintento: reintentos ? true : undefined,
    aviso,
  };
  const ahora = Date.now();
  const [u, a] = await base.batch([
    base.prepare('INSERT INTO mensajes (rol, texto, datos, creado) VALUES (?, ?, NULL, ?)').bind('usuario', entrada, ahora),
    base.prepare('INSERT INTO mensajes (rol, texto, datos, creado) VALUES (?, ?, ?, ?)').bind('asistente', plan.respuesta || 'Listo.', JSON.stringify(datos), ahora + 1),
  ]);
  return {
    usuario: { id: u.meta.last_row_id, rol: 'usuario', texto: entrada, datos: null, creado: ahora },
    asistente: { id: a.meta.last_row_id, rol: 'asistente', texto: plan.respuesta || 'Listo.', datos, creado: ahora + 1 },
  };
}

// Revierte en Notion lo que hizo un mensaje del asistente (en orden inverso) y lo marca como deshecho.
export async function deshacerMensaje(env, id) {
  const base = await db(env);
  const row = await base.prepare('SELECT * FROM mensajes WHERE id = ? AND rol = ?').bind(Number(id), 'asistente').first();
  if (!row) throw new ErrorAsistente(404, 'No encontré ese mensaje');
  const m = fila(row);
  if (m.datos?.deshecho) throw new ErrorAsistente(409, 'Ese mensaje ya se deshizo');
  const pasos = (m.datos?.resultados || []).filter((x) => x.ok && x.deshacer).map((x) => x.deshacer).reverse();
  if (!pasos.length) throw new ErrorAsistente(400, 'Ese mensaje no hizo cambios en Notion');
  const errores = [];
  for (const p of pasos) {
    try { await deshacerPaso(env, p); } catch (e) { errores.push(e.message); }
  }
  if (errores.length === pasos.length) throw new ErrorAsistente(502, `No se pudo deshacer: ${errores[0]}`);
  const datos = { ...m.datos, deshecho: true, erroresDeshacer: errores.length ? errores : undefined };
  await base.prepare('UPDATE mensajes SET datos = ? WHERE id = ?').bind(JSON.stringify(datos), m.id).run();
  return { ...m, datos };
}

export { ErrorIA };
