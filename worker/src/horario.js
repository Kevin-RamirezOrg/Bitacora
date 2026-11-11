// Horario semanal de clases (base "Horario" de Notion), filtrado por el semestre marcado como Actual.
// Cada fila es una clase que se repite cada semana: Bloque (título), Día, Hora ("14:00 – 16:00"), Aula, Materia.

import { diaSemana, notion, sinGuiones, sumarDias, texto } from './notion.js';
import { normal } from './util.js';

export const CLAVE_HORARIO = 'notion:horario:v2';
const CLAVE = CLAVE_HORARIO;
const TTL = 6 * 60 * 60; // el horario cambia pocas veces por semestre
const ORDEN = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];


// "14:00 – 16:00", "14h00-16h00", "7:00 a 9:00" → { inicio: "14:00", fin: "16:00" }
export function leerHora(t) {
  const m = String(t || '').match(/(\d{1,2})[:h.](\d{2})\s*(?:[-–—]|a|hasta)\s*(\d{1,2})[:h.](\d{2})/i);
  if (!m) return null;
  const f = (h, mi) => `${String(Number(h)).padStart(2, '0')}:${mi}`;
  return { inicio: f(m[1], m[2]), fin: f(m[3], m[4]) };
}

// Semestre marcado como Actual: { id, inicio } (inicio = fecha AAAA-MM-DD o null).
export async function semestreInfo(env) {
  if (!env.NOTION_DS_SEMESTRES) return null;
  const r = await notion(env, `/data_sources/${env.NOTION_DS_SEMESTRES}/query`, {
    method: 'POST',
    body: { page_size: 5, filter: { property: 'Actual', checkbox: { equals: true } } },
  });
  const p = r.results?.[0];
  return p ? { id: p.id, inicio: p.properties?.Inicio?.date?.start?.slice(0, 10) || null } : null;
}
const semestreActual = async (env) => (await semestreInfo(env))?.id || null;

// Devuelve todas las clases del semestre actual, ordenadas por día y hora. null si no hay base Horario.
export async function horarioSemana(env, materias = [], refrescar = false) {
  if (!env.NOTION_DS_HORARIO) return null;
  if (!refrescar && env.CONFIG) {
    const g = await env.CONFIG.get(CLAVE, 'json');
    if (g) return g;
  }
  const sem = await semestreActual(env).catch(() => null);
  const body = { page_size: 100 };
  if (sem) body.filter = { property: 'Semestre', relation: { contains: sem } };
  const r = await notion(env, `/data_sources/${env.NOTION_DS_HORARIO}/query`, { method: 'POST', body });
  const nombreMateria = (id) => materias.find((m) => sinGuiones(m.id) === sinGuiones(id))?.nombre || null;
  const clases = [];
  for (const p of r.results || []) {
    const pr = p.properties || {};
    const dia = normal(pr['Día']?.select?.name);
    const hora = leerHora(texto(pr.Hora));
    if (!dia || !hora) continue;
    const rel = pr.Materia?.relation?.[0]?.id;
    clases.push({
      id: p.id, url: p.url,
      titulo: texto(pr.Bloque) || nombreMateria(rel) || 'Clase',
      dia: ORDEN.find((d) => normal(d) === dia) || dia,
      inicio: hora.inicio, fin: hora.fin,
      aula: texto(pr.Aula) || null,
      materia: rel ? nombreMateria(rel) : null,
      materiaId: rel || null,
    });
  }
  clases.sort((a, b) => ORDEN.indexOf(a.dia) - ORDEN.indexOf(b.dia) || a.inicio.localeCompare(b.inicio));
  if (env.CONFIG) await env.CONFIG.put(CLAVE, JSON.stringify(clases), { expirationTtl: TTL });
  return clases;
}

export const clasesDelDia = (clases, fecha) => (clases || []).filter((c) => c.dia === diaSemana(fecha));

// Próximo día (desde mañana, hasta 7 días) que tiene clases.
export function proximoDiaConClases(clases, fecha) {
  for (let i = 1; i <= 7; i++) {
    const f = sumarDias(fecha, i);
    const cl = clasesDelDia(clases, f);
    if (cl.length) return { fecha: f, clases: cl };
  }
  return null;
}
