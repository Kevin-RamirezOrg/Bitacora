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

// Fecha corta para anteponer a las notas: "9 nov".
const fechaCorta = (f) => new Date(f + 'T12:00:00Z').toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// "AAAA-MM-DD" se guarda tal cual; "MM-DD" (sin año) se guarda como la próxima vez que se cumple.
export function fechaCumple(v, fechaHoy = hoy()) {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const anio = Number(fechaHoy.slice(0, 4));
  const este = `${anio}-${m[1]}-${m[2]}`;
  return este >= fechaHoy ? este : `${anio + 1}-${m[1]}-${m[2]}`;
}

async function buscarPersona(env, { nombre, apodo, profesorDe }) {
  const consulta = (filter) => notion(env, `/data_sources/${env.NOTION_DS_PERSONAS}/query`, { method: 'POST', body: { page_size: 20, filter } }).then((r) => r.results || []);
  const apodos = (p) => texto(p.properties?.Apodo).split(/[,;]/).map(normal).filter(Boolean);
  if (nombre) {
    const palabra = nombre.split(/\s+/).sort((x, y) => y.length - x.length)[0];
    const porNombre = (await consulta({ property: 'Nombre', title: { contains: palabra } })).find((p) => normal(texto(p.properties?.Nombre)) === normal(nombre));
    if (porNombre) return porNombre;
  }
  for (const a of [apodo, nombre].filter(Boolean)) {
    const porApodo = (await consulta({ property: 'Apodo', rich_text: { contains: a.split(/\s+/)[0] } })).find((p) => apodos(p).includes(normal(a)));
    if (porApodo) return porApodo;
  }
  if (profesorDe) {
    const profes = await consulta({ and: [{ property: 'Rol', select: { equals: 'Profesor' } }, { property: 'Materias', relation: { contains: profesorDe } }] });
    if (profes.length === 1) return profes[0];
  }
  return null;
}

// Crea la persona o completa su ficha si ya existe (por nombre, apodo o "el profesor de tal materia").
// Devuelve lo necesario para deshacer: la página creada o los valores anteriores de lo que cambió.
export async function guardarPersona(env, { nombre, apodo, profesorDe, rol, correo, telefono, notas, grupo, cumpleanos, materias: ids = [] }) {
  const existente = await buscarPersona(env, { nombre, apodo, profesorDe });
  const fecha = hoy();
  const notaConFecha = notas ? `${fechaCorta(fecha)}: ${notas}` : null;
  const cumple = fechaCumple(cumpleanos, fecha);
  const todasMaterias = profesorDe && !ids.some((id) => sinGuiones(id) === sinGuiones(profesorDe)) ? [...ids, profesorDe] : ids;

  if (!existente) {
    if (!nombre) {
      const quien = apodo || 'esa persona';
      throw new ErrorNotion(400, `No sé quién es ${quien}. Dime su nombre y lo guardo en Personas.`);
    }
    const properties = { Nombre: { title: rich(nombre) } };
    if (rol || profesorDe) properties.Rol = { select: { name: rol || 'Profesor' } };
    if (correo) properties.Correo = { email: correo };
    if (telefono) properties['Teléfono'] = { phone_number: telefono };
    if (notaConFecha) properties.Notas = { rich_text: rich(notaConFecha) };
    if (apodo) properties.Apodo = { rich_text: rich(apodo) };
    if (grupo) properties.Grupo = { rich_text: rich(grupo) };
    if (cumple) properties['Cumpleaños'] = { date: { start: cumple } };
    if (todasMaterias.length) properties.Materias = { relation: todasMaterias.map((id) => ({ id })) };
    const p = await notion(env, '/pages', {
      method: 'POST',
      body: { parent: { type: 'data_source_id', data_source_id: env.NOTION_DS_PERSONAS }, properties },
    });
    return { creada: true, nombre, id: p.id, url: p.url, deshacer: { tipo: 'papelera', id: p.id } };
  }

  const prev = existente.properties || {};
  const nuevos = {};
  const anteriores = {};
  const cambiar = (n, nuevo, anterior) => { nuevos[n] = nuevo; anteriores[n] = anterior; };
  if (rol && prev.Rol?.select?.name !== rol) cambiar('Rol', { select: { name: rol } }, { select: prev.Rol?.select ? { name: prev.Rol.select.name } : null });
  if (correo && prev.Correo?.email !== correo) cambiar('Correo', { email: correo }, { email: prev.Correo?.email || null });
  if (telefono && prev['Teléfono']?.phone_number !== telefono) cambiar('Teléfono', { phone_number: telefono }, { phone_number: prev['Teléfono']?.phone_number || null });
  const textoAntes = (n) => { const t = texto(prev[n]); return { rich_text: t ? rich(t) : [] }; };
  if (grupo && texto(prev.Grupo) !== grupo) cambiar('Grupo', { rich_text: rich(grupo) }, textoAntes('Grupo'));
  if (cumple && prev['Cumpleaños']?.date?.start !== cumple) cambiar('Cumpleaños', { date: { start: cumple } }, { date: prev['Cumpleaños']?.date ? { start: prev['Cumpleaños'].date.start } : null });
  if (apodo) {
    const antes = texto(prev.Apodo);
    if (!antes.split(/[,;]/).map(normal).includes(normal(apodo))) cambiar('Apodo', { rich_text: rich(antes ? `${antes}, ${apodo}` : apodo) }, textoAntes('Apodo'));
  }
  if (notas) {
    const antes = texto(prev.Notas);
    if (!normal(antes).includes(normal(notas))) cambiar('Notas', { rich_text: rich(antes ? `${antes}\n${notaConFecha}` : notaConFecha) }, textoAntes('Notas'));
  }
  const actuales = (prev.Materias?.relation || []).map((x) => x.id);
  const faltan = todasMaterias.filter((id) => !actuales.some((a) => sinGuiones(a) === sinGuiones(id)));
  if (faltan.length) cambiar('Materias', { relation: [...actuales, ...faltan].map((id) => ({ id })) }, { relation: actuales.map((id) => ({ id })) });
  const nombreReal = texto(prev.Nombre) || nombre;
  if (!Object.keys(nuevos).length) return { creada: false, nombre: nombreReal, sinCambios: true, id: existente.id, url: existente.url, deshacer: null };
  await notion(env, `/pages/${existente.id}`, { method: 'PATCH', body: { properties: nuevos } });
  return {
    creada: false,
    nombre: nombreReal,
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
  } else if (paso.tipo === 'bloques') {
    for (const id of paso.ids || []) await notion(env, `/blocks/${id}`, { method: 'DELETE' });
  } else if (paso.tipo === 'restaurar') {
    await notion(env, `/pages/${paso.id}`, { method: 'PATCH', body: { in_trash: false } });
  }
}
