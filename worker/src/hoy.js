// Panel "Hoy": datos con reglas fijas (sin IA) para que se vea aunque falle el modelo.
// Lo urgente y la carga salen de Notion; las sesiones de repaso hechas se guardan en D1.

import { consultarTareas, hoy, marcarTarea, materias as leerMaterias, sumarDias } from './notion.js';
import { ErrorAsistente, db } from './historial.js';
import { esFecha, sinGuiones } from './util.js';
import { clasesDelDia, horarioSemana, proximoDiaConClases } from './horario.js';

const DIAS_ATRAS = 14;
const DIAS_ADELANTE = 21;
const HORIZONTE_REPASOS = 14;

// Días antes de la evaluación en que conviene repasar (sesiones cortas y espaciadas).
export const PLAN_REPASO = { Examen: [10, 6, 3, 1], Prueba: [6, 3, 1] };


// Fechas de repaso de una evaluación. Si se registró tarde, las sesiones que ya pasaron se omiten
// salvo que estén marcadas como hechas.
export function sesionesRepaso(tarea, fechaHoy, hechas = new Set()) {
  const offs = PLAN_REPASO[tarea.tipo];
  if (!offs || !tarea.fecha) return [];
  return offs
    .map((d) => sumarDias(tarea.fecha, -d))
    .filter((f) => f >= fechaHoy || hechas.has(f))
    .map((f) => ({ fecha: f, hecho: hechas.has(f) }));
}

export async function datosHoy(env, { refrescar = false } = {}) {
  const fechaHoy = hoy();
  const lista = await leerMaterias(env, refrescar);
  const [tareas, semana] = await Promise.all([
    consultarTareas(env, { desde: sumarDias(fechaHoy, -DIAS_ATRAS), hasta: sumarDias(fechaHoy, DIAS_ADELANTE), limite: 100 }, lista),
    horarioSemana(env, lista, refrescar).catch(() => null),
  ]);
  const proximo = semana ? proximoDiaConClases(semana, fechaHoy) : null;

  const evaluaciones = tareas.filter((t) => PLAN_REPASO[t.tipo] && t.fecha && t.fecha >= fechaHoy && t.fecha <= sumarDias(fechaHoy, HORIZONTE_REPASOS));
  let marcadas = [];
  if (env.DB && evaluaciones.length) {
    const base = await db(env);
    const ids = evaluaciones.map((t) => sinGuiones(t.id));
    const { results } = await base.prepare(`SELECT tarea, fecha FROM repasos WHERE hecho = 1 AND tarea IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    marcadas = results;
  }
  const repasos = evaluaciones.map((t) => {
    const hechas = new Set(marcadas.filter((r) => r.tarea === sinGuiones(t.id)).map((r) => r.fecha));
    return { tarea: t.id, titulo: t.titulo, tipo: t.tipo, materia: t.materia, fecha: t.fecha, url: t.url, sesiones: sesionesRepaso(t, fechaHoy, hechas) };
  });

  return {
    hoy: fechaHoy, tareas, repasos, historial: Boolean(env.DB),
    horario: Boolean(semana), clases: semana ? clasesDelDia(semana, fechaHoy) : [],
    proximo: proximo ? { fecha: proximo.fecha, clases: proximo.clases } : null,
  };
}

// Marca o desmarca una tarea desde Urgente (misma escritura que la acción completar_tarea de Kell).
export async function marcarTareaHoy(env, { tarea, completada }) {
  if (typeof tarea !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(tarea)) throw new ErrorAsistente(400, 'Tarea inválida');
  if (typeof completada !== 'boolean') throw new ErrorAsistente(400, 'Falta indicar si está completada');
  await marcarTarea(env, tarea, completada);
  return { ok: true, tarea, completada };
}

export async function marcarRepaso(env, { tarea, fecha, hecho }) {
  if (typeof tarea !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(tarea)) throw new ErrorAsistente(400, 'Tarea inválida');
  if (!esFecha(fecha)) throw new ErrorAsistente(400, 'Fecha inválida');
  const base = await db(env);
  if (hecho) {
    await base.prepare('INSERT INTO repasos (tarea, fecha, hecho, actualizado) VALUES (?, ?, 1, ?) ON CONFLICT (tarea, fecha) DO UPDATE SET hecho = 1, actualizado = excluded.actualizado')
      .bind(sinGuiones(tarea), fecha, Date.now()).run();
  } else {
    await base.prepare('DELETE FROM repasos WHERE tarea = ? AND fecha = ?').bind(sinGuiones(tarea), fecha).run();
  }
  return { ok: true, tarea, fecha, hecho: !!hecho };
}
