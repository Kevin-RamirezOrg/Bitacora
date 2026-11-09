// Cliente mínimo de la API de Notion para las bases de "Universidad".
// Versión 2026-03-11: las páginas se crean con parent data_source_id y se mandan a la papelera con in_trash.

const API = 'https://api.notion.com/v1';
const VERSION = '2026-03-11';
export const ZONA = 'America/Guayaquil';
const CLAVE_MATERIAS = 'notion:materias';
const TTL_MATERIAS = 6 * 60 * 60; // segundos; las materias cambian poco (pocas escrituras en KV al día)

export const TIPOS_TAREA = ['Tarea', 'Prueba', 'Examen', 'Proyecto', 'Lectura', 'Institucional'];
export const ROLES = ['Compañero', 'Profesor', 'Tutor', 'Ayudante'];

export class ErrorNotion extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

export async function notion(env, ruta, { method = 'GET', body } = {}, intento = 0) {
  if (!env.NOTION_TOKEN) throw new ErrorNotion(503, 'Falta el secret NOTION_TOKEN en Cloudflare');
  let r;
  try {
    r = await fetch(API + ruta, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ErrorNotion(504, 'Notion no respondió a tiempo');
  }
  if (r.status === 429 && intento === 0) {
    const espera = Math.min(Number(r.headers.get('Retry-After')) || 1, 3);
    await new Promise((ok) => setTimeout(ok, espera * 1000));
    return notion(env, ruta, { method, body }, 1);
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const mensaje = {
      401: 'El token de Notion no es válido; revisa NOTION_TOKEN en Cloudflare',
      403: 'La conexión de Notion no tiene permiso para esta acción',
      404: 'Notion no encontró la base; comparte la página Universidad con la conexión Bitácora',
      429: 'Notion está limitando las peticiones; espera unos segundos',
    }[r.status] || `Notion respondió ${r.status}: ${datos.message || 'error'}`;
    throw new ErrorNotion(r.status === 401 || r.status === 404 ? 503 : 502, mensaje);
  }
  return datos;
}

// ---------- Lectura de propiedades ----------

export const texto = (p) => (p?.title || p?.rich_text || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
export const rich = (s) => [{ type: 'text', text: { content: String(s).slice(0, 2000) } }];
export const sinGuiones = (id) => String(id || '').replace(/-/g, '');

// ---------- Fechas ----------

// Fecha de hoy (AAAA-MM-DD) en Ecuador, sin depender de la zona del servidor.
export function hoy(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export function sumarDias(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const diaSemana = (fecha) => DIAS[new Date(fecha + 'T12:00:00Z').getUTCDay()];

// Hora actual (HH:MM) en Ecuador.
export function horaActual(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahora);
}

// ---------- Materias (con caché en KV) ----------

export async function materias(env, refrescar = false) {
  if (!refrescar && env.CONFIG) {
    const guardadas = await env.CONFIG.get(CLAVE_MATERIAS, 'json');
    if (guardadas) return guardadas;
  }
  const lista = [];
  let cursor;
  do {
    const r = await notion(env, `/data_sources/${env.NOTION_DS_MATERIAS}/query`, {
      method: 'POST',
      body: { page_size: 100, start_cursor: cursor },
    });
    for (const p of r.results || []) {
      lista.push({
        id: p.id,
        nombre: texto(p.properties?.Materia) || 'Sin nombre',
        codigo: texto(p.properties?.['Código']),
        profesor: texto(p.properties?.Profesor),
      });
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor && lista.length < 300);
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (env.CONFIG) await env.CONFIG.put(CLAVE_MATERIAS, JSON.stringify(lista), { expirationTtl: TTL_MATERIAS });
  return lista;
}

// ---------- Tareas ----------

function leerTarea(p, nombreMateria) {
  const fecha = p.properties?.Entrega?.date?.start || null;
  const relacion = p.properties?.Materia?.relation || [];
  return {
    id: p.id,
    url: p.url,
    titulo: texto(p.properties?.Tarea) || 'Sin título',
    tipo: p.properties?.Tipo?.select?.name || null,
    fecha: fecha ? fecha.slice(0, 10) : null,
    hora: fecha && fecha.length > 10 ? fecha.slice(11, 16) : null,
    materia: relacion[0] ? nombreMateria(relacion[0].id) : null,
    completada: !!p.properties?.Completada?.checkbox,
    grupal: !!p.properties?.Grupal?.checkbox,
  };
}

const buscadorMaterias = (lista) => (id) => lista.find((m) => sinGuiones(m.id) === sinGuiones(id))?.nombre || null;

export async function consultarTareas(env, { desde, hasta, completadas = false, sinFecha = false, limite = 100 }, lista) {
  const filtros = [];
  if (!completadas) filtros.push({ property: 'Completada', checkbox: { equals: false } });
  if (desde) filtros.push({ property: 'Entrega', date: { on_or_after: desde } });
  if (hasta) filtros.push({ property: 'Entrega', date: { on_or_before: hasta } });
  const body = {
    page_size: Math.min(limite, 100),
    sorts: [{ property: 'Entrega', direction: 'ascending' }],
    filter: filtros.length ? { and: filtros } : undefined,
  };
  const r = await notion(env, `/data_sources/${env.NOTION_DS_TAREAS}/query`, { method: 'POST', body });
  const nombre = buscadorMaterias(lista);
  const tareas = (r.results || []).map((p) => leerTarea(p, nombre));
  if (sinFecha) {
    const s = await notion(env, `/data_sources/${env.NOTION_DS_TAREAS}/query`, {
      method: 'POST',
      body: { page_size: 30, filter: { and: [{ property: 'Completada', checkbox: { equals: false } }, { property: 'Entrega', date: { is_empty: true } }] } },
    });
    tareas.push(...(s.results || []).map((p) => leerTarea(p, nombre)));
  }
  return tareas;
}

function propiedadFecha(fecha, hora) {
  if (!fecha) return { date: null };
  return hora ? { date: { start: `${fecha}T${hora}:00`, time_zone: ZONA } } : { date: { start: fecha } };
}

export async function crearTarea(env, { titulo, tipo, fecha, hora, materia, grupal }) {
  const properties = {
    Tarea: { title: rich(titulo) },
    Entrega: propiedadFecha(fecha, hora),
    Completada: { checkbox: false },
    Grupal: { checkbox: !!grupal },
  };
  if (tipo) properties.Tipo = { select: { name: tipo } };
  if (materia) properties.Materia = { relation: [{ id: materia }] };
  const p = await notion(env, '/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_TAREAS }, properties },
  });
  return { id: p.id, url: p.url };
}

export async function marcarTarea(env, id, completada) {
  const p = await notion(env, `/pages/${id}`, { method: 'PATCH', body: { properties: { Completada: { checkbox: completada } } } });
  return { id: p.id, url: p.url };
}

// ---------- Inbox ----------

export async function notaInbox(env, { texto: contenido, materia }) {
  const properties = { Nota: { title: rich(contenido) }, Procesada: { checkbox: false } };
  if (materia) properties.Materia = { relation: [{ id: materia }] };
  const p = await notion(env, '/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_INBOX }, properties },
  });
  return { id: p.id, url: p.url };
}

// ---------- Personas ----------

export const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Crea la persona o completa su ficha si ya existe (mismo nombre, sin importar tildes ni mayúsculas).
// Devuelve lo necesario para deshacer: la página creada o los valores anteriores de lo que cambió.
export async function guardarPersona(env, { nombre, rol, correo, telefono, notas, materias: ids = [] }) {
  const palabra = nombre.split(/\s+/).sort((a, b) => b.length - a.length)[0];
  const r = await notion(env, `/data_sources/${env.NOTION_DS_PERSONAS}/query`, {
    method: 'POST',
    body: { page_size: 20, filter: { property: 'Nombre', title: { contains: palabra } } },
  });
  const existente = (r.results || []).find((p) => normal(texto(p.properties?.Nombre)) === normal(nombre));

  if (!existente) {
    const properties = { Nombre: { title: rich(nombre) } };
    if (rol) properties.Rol = { select: { name: rol } };
    if (correo) properties.Correo = { email: correo };
    if (telefono) properties['Teléfono'] = { phone_number: telefono };
    if (notas) properties.Notas = { rich_text: rich(notas) };
    if (ids.length) properties.Materias = { relation: ids.map((id) => ({ id })) };
    const p = await notion(env, '/pages', {
      method: 'POST',
      body: { parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_PERSONAS }, properties },
    });
    return { creada: true, id: p.id, url: p.url, deshacer: { tipo: 'papelera', id: p.id } };
  }

  const prev = existente.properties || {};
  const nuevos = {};
  const anteriores = {};
  if (rol && prev.Rol?.select?.name !== rol) {
    nuevos.Rol = { select: { name: rol } };
    anteriores.Rol = { select: prev.Rol?.select ? { name: prev.Rol.select.name } : null };
  }
  if (correo && prev.Correo?.email !== correo) {
    nuevos.Correo = { email: correo };
    anteriores.Correo = { email: prev.Correo?.email || null };
  }
  if (telefono && prev['Teléfono']?.phone_number !== telefono) {
    nuevos['Teléfono'] = { phone_number: telefono };
    anteriores['Teléfono'] = { phone_number: prev['Teléfono']?.phone_number || null };
  }
  if (notas) {
    const antes = texto(prev.Notas);
    if (!normal(antes).includes(normal(notas))) {
      nuevos.Notas = { rich_text: rich(antes ? `${antes}\n${notas}` : notas) };
      anteriores.Notas = { rich_text: antes ? rich(antes) : [] };
    }
  }
  const actuales = (prev.Materias?.relation || []).map((x) => x.id);
  const faltan = ids.filter((id) => !actuales.some((a) => sinGuiones(a) === sinGuiones(id)));
  if (faltan.length) {
    nuevos.Materias = { relation: [...actuales, ...faltan].map((id) => ({ id })) };
    anteriores.Materias = { relation: actuales.map((id) => ({ id })) };
  }
  if (!Object.keys(nuevos).length) return { creada: false, sinCambios: true, id: existente.id, url: existente.url, deshacer: null };
  await notion(env, `/pages/${existente.id}`, { method: 'PATCH', body: { properties: nuevos } });
  return {
    creada: false,
    id: existente.id,
    url: existente.url,
    cambios: Object.keys(nuevos),
    deshacer: { tipo: 'propiedades', id: existente.id, propiedades: anteriores },
  };
}

// ---------- Deshacer ----------

export async function deshacer(env, paso) {
  if (paso.tipo === 'papelera') {
    await notion(env, `/pages/${paso.id}`, { method: 'PATCH', body: { in_trash: true } });
  } else if (paso.tipo === 'propiedades') {
    await notion(env, `/pages/${paso.id}`, { method: 'PATCH', body: { properties: paso.propiedades } });
  } else if (paso.tipo === 'restaurar') {
    await notion(env, `/pages/${paso.id}`, { method: 'PATCH', body: { in_trash: false } });
  }
}
