// Utilidades compartidas por los módulos del Worker.

// Texto sin tildes ni mayúsculas, para comparar nombres.
export const normal = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// Los ids de Notion llegan con o sin guiones según la ruta.
export const sinGuiones = (id) => String(id || '').replace(/-/g, '');
export const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'));
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Saca el objeto JSON de la respuesta de un modelo, aunque venga con razonamiento (<think>) o un bloque de código
// alrededor. Devuelve el valor ya interpretado o lanza un error si no hay JSON válido.
export function extraerJSON(raw) {
  let t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloque) t = bloque[1].trim();
  const ini = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (ini < 0 || fin <= ini) throw new Error('no hay un objeto JSON');
  try { return JSON.parse(t.slice(ini, fin + 1)); } catch { throw new Error('JSON mal formado'); }
}
