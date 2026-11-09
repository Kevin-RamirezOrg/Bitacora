// Acceso general a todas las bases de "Universidad": el Worker descubre las bases que la conexión
// puede ver, le pasa al modelo un esquema compacto y valida cada lectura o escritura contra ese esquema.

import { normal, notion, rich, sinGuiones, texto } from './notion.js';

const CLAVE = 'notion:bases:v2';
const TTL = 6 * 60 * 60;
const MAX_FILAS = 25;
const MAX_TEXTO_PAGINA = 6000;

// Tipos que se pueden escribir desde el asistente.
const ESCRIBIBLES = new Set(['title', 'rich_text', 'number', 'select', 'status', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone_number', 'relation']);

export class ErrorBase extends Error {}

// ---------- Esquemas ----------

function esquema(ds) {
  const props = Object.entries(ds.properties || {}).map(([nombre, p]) => {
    const e = { nombre, tipo: p.type };
    if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') e.opciones = (p[p.type]?.options || []).map((o) => o.name);
    if (p.type === 'relation') e.destino = p.relation?.data_source_id || null;
    return e;
  });
  return { id: ds.id, nombre: texto({ title: ds.title }) || ds.name || 'Sin nombre', props };
}

// Todas las bases visibles para la conexión (con caché en KV). Cada una con su esquema.
export async function bases(env, refrescar = false) {
  if (!refrescar && env.CONFIG) {
    const g = await env.CONFIG.get(CLAVE, 'json');
    if (g) return g;
  }
  const lista = [];
  let cursor;
  do {
    const r = await notion(env, '/search', {
      method: 'POST',
      body: { page_size: 100, start_cursor: cursor, filter: { property: 'object', value: 'data_source' } },
    });
    for (const ds of r.results || []) {
      if (ds.in_trash || ds.archived || lista.some((b) => sinGuiones(b.id) === sinGuiones(ds.id))) continue;
      let completo = ds;
      if (!ds.properties) completo = await notion(env, `/data_sources/${ds.id}`);
      lista.push(esquema(completo));
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor && lista.length < 60);
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (env.CONFIG) await env.CONFIG.put(CLAVE, JSON.stringify(lista), { expirationTtl: TTL });
  return lista;
}

const titulo = (b) => b.props.find((p) => p.tipo === 'title')?.nombre;

// Esquema compacto para el prompt: "b3 Horario: Bloque (título); Día (opción: Lunes|Martes); ..."
export function basesParaPrompt(lista) {
  const nombreDe = (id) => lista.find((b) => sinGuiones(b.id) === sinGuiones(id))?.nombre || 'otra base';
  const tipo = (p) => {
    if (p.tipo === 'title') return 'título';
    if (p.tipo === 'select' || p.tipo === 'status') return `opción: ${p.opciones.slice(0, 15).join('|')}`;
    if (p.tipo === 'multi_select') return `varias: ${p.opciones.slice(0, 15).join('|')}`;
    if (p.tipo === 'relation') return `relación → ${nombreDe(p.destino)}`;
    if (p.tipo === 'rich_text') return 'texto';
    if (p.tipo === 'date') return 'fecha';
    if (p.tipo === 'checkbox') return 'casilla';
    if (p.tipo === 'number') return 'número';
    return ESCRIBIBLES.has(p.tipo) ? p.tipo : `${p.tipo}, solo lectura`;
  };
  return lista.map((b) => `${b.clave}: ${b.nombre} — ${b.props.map((p) => `${p.nombre} (${tipo(p)})`).join('; ')}`).join('\n');
}

// ---------- Lectura de filas ----------

function valorLegible(p, materias) {
  switch (p?.type) {
    case 'title': case 'rich_text': return texto(p) || null;
    case 'number': return p.number;
    case 'select': return p.select?.name || null;
    case 'status': return p.status?.name || null;
    case 'multi_select': return (p.multi_select || []).map((o) => o.name);
    case 'date': return p.date ? (p.date.end ? `${p.date.start} → ${p.date.end}` : p.date.start) : null;
    case 'checkbox': return p.checkbox;
    case 'url': return p.url; case 'email': return p.email; case 'phone_number': return p.phone_number;
    case 'relation': {
      const ids = (p.relation || []).map((r) => r.id);
      if (!ids.length) return null;
      const nombres = ids.map((id) => materias.find((m) => sinGuiones(m.id) === sinGuiones(id))?.nombre).filter(Boolean);
      return nombres.length === ids.length ? nombres : `${ids.length} vínculo${ids.length > 1 ? 's' : ''}`;
    }
    case 'formula': { const f = p.formula || {}; return f[f.type] ?? null; }
    case 'rollup': { const r = p.rollup || {}; return r.type === 'number' ? r.number : r.type === 'date' ? r.date?.start : null; }
    case 'created_time': return p.created_time; case 'last_edited_time': return p.last_edited_time;
    default: return null;
  }
}

export function filaLegible(pagina, base, materias) {
  const propiedades = {};
  for (const [n, p] of Object.entries(pagina.properties || {})) {
    const v = valorLegible(p, materias);
    if (v !== null && v !== '' && !(Array.isArray(v) && !v.length)) propiedades[n] = v;
  }
  return { id: pagina.id, url: pagina.url, titulo: texto(pagina.properties?.[titulo(base)]) || 'Sin título', propiedades };
}

// Filtro de Notion a partir de filtros simples del modelo: [{propiedad, valor, op?}].
function filtroNotion(base, { buscar, filtros = [] }, resolverRelacion) {
  const partes = [];
  const t = titulo(base);
  if (buscar && t) partes.push({ property: t, title: { contains: String(buscar).slice(0, 100) } });
  for (const f of (Array.isArray(filtros) ? filtros : []).slice(0, 5)) {
    const p = base.props.find((x) => normal(x.nombre) === normal(f?.propiedad));
    if (!p) throw new ErrorBase(`la base ${base.nombre} no tiene la propiedad "${f?.propiedad}"`);
    const v = f.valor; const op = f.op || 'igual';
    switch (p.tipo) {
      case 'title': case 'rich_text': case 'url': case 'email': case 'phone_number':
        partes.push({ property: p.nombre, [p.tipo]: { [op === 'igual' ? 'equals' : 'contains']: String(v ?? '') } }); break;
      case 'select': case 'status': {
        const o = p.opciones.find((x) => normal(x) === normal(v));
        if (!o) throw new ErrorBase(`"${v}" no es una opción de ${p.nombre}`);
        partes.push({ property: p.nombre, [p.tipo]: { equals: o } }); break;
      }
      case 'multi_select': {
        const o = p.opciones.find((x) => normal(x) === normal(v));
        if (!o) throw new ErrorBase(`"${v}" no es una opción de ${p.nombre}`);
        partes.push({ property: p.nombre, multi_select: { contains: o } }); break;
      }
      case 'checkbox': partes.push({ property: p.nombre, checkbox: { equals: v === true || v === 'true' } }); break;
      case 'number': partes.push({ property: p.nombre, number: { [{ mayor: 'greater_than', menor: 'less_than' }[op] || 'equals']: Number(v) } }); break;
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw new ErrorBase(`fecha inválida para ${p.nombre}`);
        partes.push({ property: p.nombre, date: { [{ desde: 'on_or_after', hasta: 'on_or_before' }[op] || 'equals']: String(v).slice(0, 10) } }); break;
      }
      case 'relation': {
        const id = resolverRelacion(v);
        if (!id) throw new ErrorBase(`no sé a qué fila se refiere "${v}" en ${p.nombre}`);
        partes.push({ property: p.nombre, relation: { contains: id } }); break;
      }
      default: throw new ErrorBase(`no se puede filtrar por ${p.nombre}`);
    }
  }
  if (!partes.length) return undefined;
  return partes.length === 1 ? partes[0] : { and: partes };
}

export async function consultar(env, base, { buscar, filtros, limite }, { materias, resolverRelacion }) {
  const body = { page_size: Math.min(Math.max(Number(limite) || 15, 1), MAX_FILAS) };
  const filter = filtroNotion(base, { buscar, filtros }, resolverRelacion);
  if (filter) body.filter = filter;
  const r = await notion(env, `/data_sources/${base.id}/query`, { method: 'POST', body });
  return { filas: (r.results || []).map((p) => filaLegible(p, base, materias)), mas: !!r.has_more };
}

// Texto del cuerpo de una página (apuntes, resúmenes…), recortado.
export async function leerPagina(env, id) {
  const r = await notion(env, `/blocks/${id}/children?page_size=100`);
  const lineas = [];
  for (const b of r.results || []) {
    const c = b[b.type] || {};
    const t = (c.rich_text || []).map((x) => x.plain_text || '').join('');
    if (t) lineas.push(b.type.startsWith('heading') ? `## ${t}` : b.type.includes('list_item') ? `- ${t}` : b.type === 'to_do' ? `[${c.checked ? 'x' : ' '}] ${t}` : t);
    if (lineas.join('\n').length > MAX_TEXTO_PAGINA) break;
  }
  const textoPagina = lineas.join('\n');
  return textoPagina.length > MAX_TEXTO_PAGINA ? textoPagina.slice(0, MAX_TEXTO_PAGINA) + '…' : textoPagina;
}

// ---------- Escritura ----------

// Convierte los valores que propone el modelo al formato de escritura de Notion, validando con el esquema.
export function propiedadesEscritura(base, valores, resolverRelacion) {
  if (!valores || typeof valores !== 'object' || Array.isArray(valores)) throw new ErrorBase('faltan las propiedades');
  const salida = {};
  const legibles = {};
  for (const [nombre, v] of Object.entries(valores).slice(0, 20)) {
    const p = base.props.find((x) => normal(x.nombre) === normal(nombre));
    if (!p) throw new ErrorBase(`la base ${base.nombre} no tiene la propiedad "${nombre}"`);
    if (!ESCRIBIBLES.has(p.tipo)) throw new ErrorBase(`${p.nombre} es de solo lectura`);
    const vacio = v === null || v === '';
    let w;
    switch (p.tipo) {
      case 'title': if (vacio) throw new ErrorBase('el título no puede quedar vacío'); w = { title: rich(String(v).slice(0, 2000)) }; break;
      case 'rich_text': w = { rich_text: vacio ? [] : rich(String(v).slice(0, 2000)) }; break;
      case 'number': if (!vacio && !Number.isFinite(Number(v))) throw new ErrorBase(`${p.nombre} debe ser un número`); w = { number: vacio ? null : Number(v) }; break;
      case 'select': case 'status': {
        if (vacio) { w = { [p.tipo]: null }; break; }
        const o = p.opciones.find((x) => normal(x) === normal(v));
        if (!o) throw new ErrorBase(`"${v}" no es una opción de ${p.nombre} (${p.opciones.join(', ')})`);
        w = { [p.tipo]: { name: o } }; break;
      }
      case 'multi_select': {
        const arr = vacio ? [] : (Array.isArray(v) ? v : [v]);
        const ok = arr.map((x) => { const o = p.opciones.find((y) => normal(y) === normal(x)); if (!o) throw new ErrorBase(`"${x}" no es una opción de ${p.nombre}`); return { name: o }; });
        w = { multi_select: ok }; break;
      }
      case 'date': {
        if (vacio) { w = { date: null }; break; }
        const ini = typeof v === 'object' ? v.inicio : v; const fin = typeof v === 'object' ? v.fin : null;
        const ok = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(x);
        if (!ok(ini) || (fin && !ok(fin))) throw new ErrorBase(`fecha inválida para ${p.nombre}`);
        const conHora = (x) => (x.length > 10 ? `${x}:00` : x);
        w = { date: { start: conHora(ini), end: fin ? conHora(fin) : null, ...(ini.length > 10 ? { time_zone: 'America/Guayaquil' } : {}) } }; break;
      }
      case 'checkbox': w = { checkbox: v === true || v === 'true' }; break;
      case 'url': w = { url: vacio ? null : String(v) }; break;
      case 'email': if (!vacio && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ErrorBase(`correo inválido en ${p.nombre}`); w = { email: vacio ? null : String(v) }; break;
      case 'phone_number': w = { phone_number: vacio ? null : String(v).slice(0, 40) }; break;
      case 'relation': {
        const arr = vacio ? [] : (Array.isArray(v) ? v : [v]);
        const ids = arr.map((x) => { const id = resolverRelacion(x); if (!id) throw new ErrorBase(`no sé a qué fila se refiere "${x}" en ${p.nombre}`); return { id }; });
        w = { relation: ids }; break;
      }
      default: throw new ErrorBase(`${p.nombre} no se puede escribir`);
    }
    salida[p.nombre] = w;
    legibles[p.nombre] = v;
  }
  if (!Object.keys(salida).length) throw new ErrorBase('no hay propiedades que guardar');
  return { salida, legibles };
}

// Valor actual de una propiedad en formato de escritura (para poder deshacer una edición).
export function aEscritura(p) {
  switch (p?.type) {
    case 'title': return { title: p.title || [] };
    case 'rich_text': return { rich_text: p.rich_text || [] };
    case 'number': return { number: p.number ?? null };
    case 'select': return { select: p.select ? { name: p.select.name } : null };
    case 'status': return { status: p.status ? { name: p.status.name } : null };
    case 'multi_select': return { multi_select: (p.multi_select || []).map((o) => ({ name: o.name })) };
    case 'date': return { date: p.date ? { start: p.date.start, end: p.date.end || null, ...(p.date.time_zone ? { time_zone: p.date.time_zone } : {}) } : null };
    case 'checkbox': return { checkbox: !!p.checkbox };
    case 'url': return { url: p.url ?? null };
    case 'email': return { email: p.email ?? null };
    case 'phone_number': return { phone_number: p.phone_number ?? null };
    case 'relation': return { relation: (p.relation || []).map((r) => ({ id: r.id })) };
    default: return null;
  }
}

export async function crearFila(env, base, propiedades) {
  const p = await notion(env, '/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: base.id }, properties: propiedades } });
  return { id: p.id, url: p.url };
}

export async function editarFila(env, id, propiedades) {
  const actual = await notion(env, `/pages/${id}`);
  const anteriores = {};
  for (const n of Object.keys(propiedades)) {
    const w = aEscritura(actual.properties?.[n]);
    if (w) anteriores[n] = w;
  }
  const p = await notion(env, `/pages/${id}`, { method: 'PATCH', body: { properties: propiedades } });
  return { id: p.id, url: p.url, anteriores };
}

export async function archivarFila(env, id) {
  const p = await notion(env, `/pages/${id}`, { method: 'PATCH', body: { in_trash: true } });
  return { id: p.id, url: p.url };
}

// Busca una fila por título exacto (sin tildes ni mayúsculas) en una base. Para relaciones escritas por nombre.
export async function buscarPorTitulo(env, base, nombre) {
  const t = titulo(base);
  if (!t) return null;
  const r = await notion(env, `/data_sources/${base.id}/query`, { method: 'POST', body: { page_size: 10, filter: { property: t, title: { contains: String(nombre).slice(0, 100) } } } });
  const exacta = (r.results || []).find((p) => normal(texto(p.properties?.[t])) === normal(nombre));
  return exacta?.id || (r.results?.length === 1 ? r.results[0].id : null);
}
