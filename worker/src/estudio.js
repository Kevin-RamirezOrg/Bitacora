// Estudio a partir de los apuntes de Clases: preguntas para el Banco de preguntas, práctica con Dominio
// y resumen semanal en Resúmenes. El modelo solo trabaja con el texto de los apuntes; el Worker valida y guarda.

import { chat } from './ia.js';
import { hoy, normal, notion, rich, texto } from './notion.js';
import { extraerJSON } from './util.js';
import { semestreInfo } from './horario.js';
import { leerPaginaCompleta } from './universidad.js';

const DOMINIOS = ['No la sé', 'Más o menos', 'La sé'];
const MAX_APUNTES = 24000;       // caracteres de apuntes que se envían al modelo por pedido
const ANIDADOS_POR_PEDIDO = 16;  // lecturas extra de sub-viñetas y tablas, repartidas entre las clases

export class ErrorEstudio extends Error {
  constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
}

// Semana del semestre para una fecha (1 = la semana del inicio).
export function semanaDe(fecha, inicio) {
  if (!inicio) return null;
  const d = Math.round((Date.parse(fecha + 'T12:00:00Z') - Date.parse(inicio + 'T12:00:00Z')) / 86400000);
  return d >= 0 ? Math.floor(d / 7) + 1 : null;
}

// Apuntes (texto) de las clases de una materia en una semana. Si la semana no tiene clases, prueba la anterior.
async function apuntesDeSemana(env, materiaId, semanaPedida) {
  const sem = await semestreInfo(env).catch(() => null);
  let semana = semanaPedida || semanaDe(hoy(), sem?.inicio);
  if (!semana) throw new ErrorEstudio('no pude calcular la semana del semestre; dime cuál');
  for (let intento = 0; intento < (semanaPedida ? 1 : 2); intento++, semana--) {
    const r = await notion(env, `/data_sources/${env.NOTION_DS_CLASES}/query`, {
      method: 'POST',
      body: { page_size: 10, filter: { and: [{ property: 'Materia', relation: { contains: materiaId } }, { property: 'Semana', select: { equals: `Semana ${semana}` } }] },
        sorts: [{ property: 'Fecha', direction: 'ascending' }] },
    });
    const clases = r.results || [];
    if (!clases.length) continue;
    // Las páginas se leen en paralelo y el límite se reparte: una clase corta cede su espacio a las largas,
    // así ninguna queda fuera por ir al final.
    const porClase = Math.max(1, Math.floor(ANIDADOS_POR_PEDIDO / clases.length));
    const leidas = await Promise.all(clases.map((p) => leerPaginaCompleta(env, p.id, { max: MAX_APUNTES, anidados: porClase })
      .then((r) => ({ p, ...r })).catch(() => ({ p, texto: '', cortada: true, largo: 0 }))));
    const conTexto = leidas.filter((x) => x.texto.trim());
    if (!conTexto.length) continue;
    const cupos = repartir(conTexto.map((x) => x.texto.length), MAX_APUNTES);
    const fuentes = conTexto.map((x, i) => ({ id: x.p.id, titulo: texto(x.p.properties?.Clase) || 'Clase', url: x.p.url, completa: !x.cortada && cupos[i] >= x.texto.length }));
    const apuntes = conTexto.map((x, i) => `### ${fuentes[i].titulo}\n${x.texto.slice(0, cupos[i])}`).join('\n\n');
    return { semana, apuntes, clases: fuentes };
  }
  throw new ErrorEstudio(semanaPedida ? `no encontré apuntes de la semana ${semanaPedida} de esa materia` : 'no encontré apuntes de esta semana ni de la anterior en esa materia');
}

// Reparte `total` entre varios textos: cada uno recibe lo que necesita hasta una parte igual, y lo que sobra
// de los cortos pasa a los largos.
export function repartir(largos, total) {
  const cupos = largos.map(() => 0);
  let resto = total;
  let pendientes = largos.map((_, i) => i);
  while (pendientes.length && resto >= pendientes.length) {
    const parte = Math.floor(resto / pendientes.length);
    const siguen = [];
    for (const i of pendientes) {
      const doy = Math.min(largos[i] - cupos[i], parte);
      cupos[i] += doy; resto -= doy;
      if (cupos[i] < largos[i]) siguen.push(i);
    }
    if (siguen.length === pendientes.length) break; // todos tomaron su parte entera: ya no sobra nada
    pendientes = siguen;
  }
  return cupos;
}

// Nombres de las clases usadas, para mostrarlos junto al resultado ("recortada" si no cupo entera).
const fuentesLegibles = (clases) => clases.map((c) => ({ titulo: c.titulo, url: c.url, completa: c.completa }));

// Pide al modelo un JSON y lo extrae (con un reintento si viene mal).
async function pedirJSON(env, { modelo, leida }, sistema, usuario, validar) {
  const mensajes = [{ role: 'system', content: sistema }, { role: 'user', content: usuario }];
  for (let i = 0; i < 2; i++) {
    const r = await chat(env, { mensajes, modelo, leida, json: true });
    try {
      const v = validar(extraerJSON(r.texto));
      if (v) return v;
    } catch { /* se reintenta */ }
    mensajes.push({ role: 'assistant', content: String(r.texto).slice(0, 3000) }, { role: 'user', content: 'Responde de nuevo SOLO con el objeto JSON pedido, sin texto alrededor.' });
  }
  throw new ErrorEstudio('el modelo no devolvió el formato esperado; intenta de nuevo o con otro modelo');
}

// ---------- Preguntas para el Banco ----------

export async function generarPreguntas(env, { materiaId, materiaNombre, semana, cantidad = 5, modelo, leida }) {
  const n = Math.min(Math.max(Number(cantidad) || 5, 1), 10);
  const fuente = await apuntesDeSemana(env, materiaId, semana);
  // Preguntas que ya existen de esa materia, para no repetir.
  const ya = await notion(env, `/data_sources/${env.NOTION_DS_PREGUNTAS}/query`, {
    method: 'POST', body: { page_size: 100, filter: { property: 'Materia', relation: { contains: materiaId } } },
  });
  const existentes = (ya.results || []).map((p) => texto(p.properties?.Pregunta)).filter(Boolean);
  const sistema = `Eres un tutor que prepara preguntas de repaso para un estudiante universitario de Ecuador. Usa SOLO la información de los apuntes; no agregues datos, fórmulas ni ejemplos que no estén ahí. Escribe en español.
Responde SOLO con JSON: {"preguntas": [{"pregunta": "...", "respuesta": "..."}]}
- Exactamente ${n} preguntas, variadas (definición, diferencia entre conceptos, por qué, aplicación o ejercicio si los apuntes tienen uno).
- La respuesta en 1 o 2 frases, como aparece en los apuntes.
- No repitas estas preguntas que ya existen:\n${existentes.slice(0, 60).map((x) => `- ${x}`).join('\n') || '(ninguna)'}`;
  const datos = await pedirJSON(env, { modelo, leida }, sistema, `Materia: ${materiaNombre}. Semana ${fuente.semana}.\n\nApuntes:\n${fuente.apuntes}`,
    (j) => (Array.isArray(j?.preguntas) && j.preguntas.length ? j.preguntas : null));
  const vistas = new Set(existentes.map(normal));
  const nuevas = [];
  for (const q of datos) {
    const pregunta = String(q?.pregunta || '').trim().slice(0, 300);
    const respuesta = String(q?.respuesta || '').trim().slice(0, 1500);
    if (!pregunta || !respuesta || vistas.has(normal(pregunta))) continue;
    vistas.add(normal(pregunta));
    nuevas.push({ pregunta, respuesta });
    if (nuevas.length >= n) break;
  }
  if (!nuevas.length) throw new ErrorEstudio('no salieron preguntas nuevas (quizá ya están todas en el Banco)');
  const creadas = [];
  for (const q of nuevas) {
    const p = await notion(env, '/pages', {
      method: 'POST',
      body: { parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_PREGUNTAS }, properties: {
        Pregunta: { title: rich(q.pregunta) }, Respuesta: { rich_text: rich(q.respuesta) },
        Materia: { relation: [{ id: materiaId }] }, Dominio: { select: { name: 'No la sé' } },
      } },
    });
    creadas.push({ id: p.id, url: p.url, pregunta: q.pregunta, respuesta: q.respuesta, dominio: 'No la sé' });
  }
  return { semana: fuente.semana, tarjetas: creadas, fuentes: fuentesLegibles(fuente.clases), deshacer: { tipo: 'papeleras', ids: creadas.map((c) => c.id) } };
}

// ---------- Práctica ----------

// Elige preguntas de la materia: primero las que menos domina y las que hace más tiempo no repasa.
export async function elegirPractica(env, { materiaId, cantidad = 5 }) {
  const n = Math.min(Math.max(Number(cantidad) || 5, 1), 15);
  const r = await notion(env, `/data_sources/${env.NOTION_DS_PREGUNTAS}/query`, {
    method: 'POST', body: { page_size: 100, filter: { property: 'Materia', relation: { contains: materiaId } } },
  });
  const rango = (d) => (d === 'La sé' ? 2 : d === 'Más o menos' ? 1 : 0);
  const filas = (r.results || []).map((p) => ({
    id: p.id, url: p.url, pregunta: texto(p.properties?.Pregunta), respuesta: texto(p.properties?.Respuesta),
    dominio: p.properties?.Dominio?.select?.name || null, repaso: p.properties?.['Último repaso']?.date?.start || '',
  })).filter((x) => x.pregunta);
  if (!filas.length) throw new ErrorEstudio('esa materia aún no tiene preguntas en el Banco; pídeme que las genere desde tus apuntes');
  filas.sort((a, b) => rango(a.dominio) - rango(b.dominio) || a.repaso.localeCompare(b.repaso));
  return { tarjetas: filas.slice(0, n).map(({ repaso, ...x }) => x), total: filas.length };
}

export async function marcarDominio(env, { id, dominio }) {
  if (!DOMINIOS.includes(dominio)) throw new ErrorEstudio('dominio inválido');
  if (typeof id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(id)) throw new ErrorEstudio('pregunta inválida');
  await notion(env, `/pages/${id}`, { method: 'PATCH', body: { properties: { Dominio: { select: { name: dominio } }, 'Último repaso': { date: { start: hoy() } } } } });
  return { id, dominio };
}

// ---------- Resumen semanal ----------

export async function resumenSemanal(env, { materiaId, materiaNombre, semana, modelo, leida }) {
  const fuente = await apuntesDeSemana(env, materiaId, semana);
  const existe = await notion(env, `/data_sources/${env.NOTION_DS_RESUMENES}/query`, {
    method: 'POST',
    body: { page_size: 5, filter: { and: [{ property: 'Materia', relation: { contains: materiaId } }, { property: 'Semanas', rich_text: { equals: String(fuente.semana) } }, { property: 'Tipo', select: { equals: 'Semanal' } }] } },
  });
  if (existe.results?.length) {
    const p = existe.results[0];
    return { yaExistia: true, id: p.id, url: p.url, titulo: texto(p.properties?.Resumen), semana: fuente.semana };
  }
  const sistema = `Resumes apuntes de clase de un estudiante universitario. Usa SOLO lo que dicen los apuntes: no agregues definiciones, ejemplos ni datos nuevos, y conserva sus términos. Escribe en español, claro y breve.
Responde SOLO con JSON: {"secciones": [{"titulo": "Temas vistos", "puntos": ["..."]}, {"titulo": "Conceptos clave", "puntos": ["concepto: explicación como en los apuntes"]}, {"titulo": "Para repasar", "puntos": ["..."]}]}
- Entre 2 y 4 secciones; omite una sección si no hay contenido para ella.
- Cada punto en una frase; máximo 8 puntos por sección.`;
  const secciones = await pedirJSON(env, { modelo, leida }, sistema, `Materia: ${materiaNombre}. Semana ${fuente.semana}.\n\nApuntes:\n${fuente.apuntes}`,
    (j) => (Array.isArray(j?.secciones) && j.secciones.some((s) => Array.isArray(s?.puntos) && s.puntos.length) ? j.secciones : null));
  const bloques = [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: rich(`Hecho a partir de: ${fuente.clases.map((c) => c.titulo).filter(Boolean).join(', ') || 'apuntes de la semana'}.`) } },
  ];
  for (const s of secciones.slice(0, 4)) {
    const puntos = (Array.isArray(s.puntos) ? s.puntos : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
    if (!puntos.length) continue;
    bloques.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rich(String(s.titulo || 'Notas').slice(0, 100)) } });
    for (const x of puntos) bloques.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(x.slice(0, 1800)) } });
  }
  const titulo = `${materiaNombre} · Semana ${fuente.semana}`;
  const p = await notion(env, '/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_RESUMENES },
      properties: {
        Resumen: { title: rich(titulo) }, Tipo: { select: { name: 'Semanal' } }, Semanas: { rich_text: rich(String(fuente.semana)) },
        Fecha: { date: { start: hoy() } }, Materia: { relation: [{ id: materiaId }] },
      },
      children: bloques,
    },
  });
  return { id: p.id, url: p.url, titulo, semana: fuente.semana, puntos: bloques.filter((b) => b.type === 'bulleted_list_item').length, fuentes: fuentesLegibles(fuente.clases), deshacer: { tipo: 'papelera', id: p.id } };
}

