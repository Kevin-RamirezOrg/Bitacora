// Apuntes dictados de una clase: el Worker decide la fila de "Clases" (materia, fecha, semana y número)
// y agrega el texto al final del cuerpo de la página, sin tocar lo que ya había.

import { horaActual, notion, rich, sinGuiones, sumarDias, texto } from './notion.js';
import { semestreInfo } from './horario.js';

const MARGEN_MIN = 180; // minutos después de terminar una clase en que "la clase" todavía se refiere a ella
const ORDEN = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const minutos = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dia = (f) => DIAS[new Date(f + 'T12:00:00Z').getUTCDay()];

// Clase de hoy a la que se refiere "la clase": la que está en curso o la última que terminó hace poco.
export function claseReciente(clases, fecha, hora) {
  const hoy = (clases || []).filter((c) => c.dia === dia(fecha));
  const ahora = minutos(hora);
  const enCurso = hoy.find((c) => minutos(c.inicio) <= ahora && ahora < minutos(c.fin));
  if (enCurso) return enCurso;
  const pasadas = hoy.filter((c) => minutos(c.fin) <= ahora && ahora - minutos(c.fin) <= MARGEN_MIN);
  return pasadas.sort((a, b) => minutos(b.fin) - minutos(a.fin))[0] || null;
}

// Semana N del semestre (lunes a domingo, contando desde el inicio) y número de clase de la materia en esa semana.
export function semanaYNumero(clases, materiaId, fecha, inicio) {
  let semana = null;
  if (inicio) {
    const dias = Math.round((Date.parse(fecha + 'T12:00:00Z') - Date.parse(inicio + 'T12:00:00Z')) / 86400000);
    if (dias >= 0) semana = Math.floor(dias / 7) + 1;
  }
  const sesiones = (clases || []).filter((c) => materiaId && sinGuiones(c.materiaId) === sinGuiones(materiaId))
    .sort((a, b) => ORDEN.indexOf(a.dia) - ORDEN.indexOf(b.dia) || a.inicio.localeCompare(b.inicio));
  const i = sesiones.findIndex((c) => c.dia === dia(fecha));
  return { semana, numero: i >= 0 ? i + 1 : null };
}

// Bloques de Notion para los apuntes: un subtítulo con la fecha y una viñeta por idea.
function bloques(lineas, fecha, hora) {
  const d = new Date(fecha + 'T12:00:00Z').toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return [
    { object: 'block', type: 'heading_3', heading_3: { rich_text: rich(`Apuntes dictados · ${d}, ${hora}`) } },
    ...lineas.slice(0, 80).map((l) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(l) } })),
  ];
}

export async function guardarApunte(env, { materiaId, materiaNombre, fecha, tema, lineas }, { clases, base }) {
  const sem = await semestreInfo(env).catch(() => null);
  const { semana, numero } = semanaYNumero(clases, materiaId, fecha, sem?.inicio);
  const opciones = (n) => base?.props.find((p) => p.nombre === n)?.opciones || [];
  const semanaOp = semana && opciones('Semana').includes(`Semana ${semana}`) ? `Semana ${semana}` : null;
  const numeroOp = numero && opciones('Número').includes(`Clase ${numero}`) ? `Clase ${numero}` : null;

  // ¿Ya existe la fila de esa clase (misma materia y fecha)?
  const r = await notion(env, `/data_sources/${env.NOTION_DS_CLASES}/query`, {
    method: 'POST',
    body: { page_size: 5, filter: { and: [{ property: 'Materia', relation: { contains: materiaId } }, { property: 'Fecha', date: { equals: fecha } }] } },
  });
  let pagina = r.results?.[0] || null;
  let creada = false;
  let tituloNuevo = null;
  if (!pagina) {
    const prefijo = semana && numero ? `S${semana}-C${numero}` : null;
    const titulo = [prefijo, tema || materiaNombre].filter(Boolean).join(' · ');
    tituloNuevo = titulo;
    const properties = {
      Clase: { title: rich(titulo) },
      Fecha: { date: { start: fecha } },
      Materia: { relation: [{ id: materiaId }] },
    };
    if (sem?.id) properties.Semestre = { relation: [{ id: sem.id }] };
    if (semanaOp) properties.Semana = { select: { name: semanaOp } };
    if (numeroOp) properties['Número'] = { select: { name: numeroOp } };
    pagina = await notion(env, '/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_CLASES }, properties } });
    creada = true;
  }
  const hijos = await notion(env, `/blocks/${pagina.id}/children`, { method: 'PATCH', body: { children: bloques(lineas, fecha, horaActual()) } });
  const ids = (hijos.results || []).map((b) => b.id).slice(-Math.min(lineas.length, 80) - 1);
  return {
    id: pagina.id, url: pagina.url, creada,
    titulo: tituloNuevo || texto(pagina.properties?.Clase) || 'Clase',
    semana: semanaOp, numero: numeroOp,
    deshacer: creada ? { tipo: 'papelera', id: pagina.id } : { tipo: 'bloques', ids },
  };
}
