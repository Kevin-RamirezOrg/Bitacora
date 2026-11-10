// Dobles de prueba para el Worker: Notion y el modelo simulados con fetch, D1 sobre node:sqlite y KV en memoria.
// No toca ningún servicio real. Requiere Node 22 o superior.
import { DatabaseSync } from 'node:sqlite';

export const DS = {
  TAREAS: '9d29b687-0cb9-460d-a9d6-6bb20708f43d', MATERIAS: '3e437374-bea5-4ea9-9f90-6b94515982d8',
  PERSONAS: 'a2fc3865-10e3-4ec2-9164-e9993939579b', INBOX: '10c76b66-23ce-4659-bd33-fabedf8b64c3',
  HORARIO: '40da13d3-6727-4155-a8e7-589a135ea18b', SEMESTRES: '71ec6804-f0c9-4431-819f-869e67f15c7a',
  CLASES: 'c9d0514a-fd5d-4242-b227-422d045edd6d', PREGUNTAS: '352cec6e-c767-44d9-84ec-36c86121e6e5',
  RESUMENES: 'f9a7bb8a-1f7e-45c4-8fd3-e2a3b830e643',
};

// ---------- D1 ----------
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  let consultas = 0;
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { consultas++; return db.prepare(sql).get(...args) ?? null; },
    async all() { consultas++; return { results: db.prepare(sql).all(...args) }; },
    async run() { consultas++; const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    _run() { const s = db.prepare(sql); if (/^\s*(select|pragma)/i.test(sql)) return { results: s.all(...args) }; const r = s.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql), async batch(list) { consultas++; return list.map((s) => s._run()); }, get consultas() { return consultas; }, raw: db };
}

// ---------- KV ----------
export function fakeKV(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  const cuenta = { get: 0, put: 0 };
  return { cuenta, m,
    async get(k, tipo) { cuenta.get++; const v = m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { cuenta.put++; m.set(k, v); },
    async delete(k) { m.delete(k); } };
}

// ---------- Notion ----------
const rt = (s) => [{ type: 'text', plain_text: String(s), text: { content: String(s) } }];
let serie = 0;
export const nuevoId = () => { serie++; const h = serie.toString(16).padStart(12, '0'); return `00000000-0000-4000-8000-${h}`; };
const limpio = (id) => String(id || '').replace(/-/g, '');

export function fakeNotion() {
  const bases = new Map();   // id → { id, title, properties (esquema) }
  const paginas = new Map(); // id → { id, url, parent, properties, in_trash }
  const bloques = new Map(); // id del padre → [bloques]
  const llamadas = [];

  function base(id, nombre, esquema) { bases.set(id, { object: 'data_source', id, title: rt(nombre), properties: esquema }); }
  function pagina(ds, properties, hijos = []) {
    const id = nuevoId();
    paginas.set(id, { object: 'page', id, url: `https://notion.so/${limpio(id)}`, parent: { data_source_id: ds }, properties, in_trash: false });
    bloques.set(id, hijos.map((b) => ({ id: nuevoId(), ...b })));
    return id;
  }
  // Atajos para construir propiedades y bloques.
  const P = {
    titulo: (s) => ({ type: 'title', title: rt(s) }), texto: (s) => ({ type: 'rich_text', rich_text: s ? rt(s) : [] }),
    opcion: (s) => ({ type: 'select', select: s ? { name: s } : null }), casilla: (b) => ({ type: 'checkbox', checkbox: !!b }),
    fecha: (s) => ({ type: 'date', date: s ? { start: s } : null }), rel: (...ids) => ({ type: 'relation', relation: ids.map((id) => ({ id })) }),
  };
  const B = {
    p: (s) => ({ type: 'paragraph', paragraph: { rich_text: rt(s) } }),
    h2: (s) => ({ type: 'heading_2', heading_2: { rich_text: rt(s) } }),
    li: (s, hijos) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(s) }, has_children: !!hijos, _hijos: hijos }),
    toggle: (s, hijos) => ({ type: 'toggle', toggle: { rich_text: rt(s) }, has_children: true, _hijos: hijos }),
    eq: (s) => ({ type: 'equation', equation: { expression: s } }),
    tabla: (filas) => ({ type: 'table', table: { table_width: filas[0].length }, has_children: true, _hijos: filas.map((f) => ({ type: 'table_row', table_row: { cells: f.map((c) => rt(c)) } })) }),
  };

  const textoDe = (p) => (p?.title || p?.rich_text || []).map((t) => t.plain_text).join('');
  function cumple(pg, f) {
    if (!f) return true;
    if (f.and) return f.and.every((x) => cumple(pg, x));
    if (f.or) return f.or.some((x) => cumple(pg, x));
    const p = pg.properties[f.property];
    if (f.checkbox) return !!p?.checkbox === f.checkbox.equals;
    if (f.title || f.rich_text) { const c = f.title || f.rich_text; const t = textoDe(p).toLowerCase();
      return c.contains != null ? t.includes(String(c.contains).toLowerCase()) : c.equals != null ? t === String(c.equals).toLowerCase() : true; }
    if (f.select) return (p?.select?.name || null) === f.select.equals;
    if (f.relation) return (p?.relation || []).some((r) => limpio(r.id) === limpio(f.relation.contains));
    if (f.date) { const d = p?.date?.start?.slice(0, 10) || null;
      if (f.date.is_empty) return !d; if (!d) return false;
      if (f.date.on_or_after) return d >= f.date.on_or_after; if (f.date.on_or_before) return d <= f.date.on_or_before;
      if (f.date.equals) return d === f.date.equals; }
    return true;
  }
  function paginar(lista, tam, cursor) {
    const ini = cursor ? Number(cursor) : 0; const fin = ini + (tam || 100);
    return { results: lista.slice(ini, fin), has_more: fin < lista.length, next_cursor: fin < lista.length ? String(fin) : null };
  }
  const registrar = (padre, lista) => lista.map((b) => { const id = nuevoId(); const { _hijos, ...resto } = b; if (_hijos) bloques.set(id, registrar(id, _hijos)); return { id, ...resto }; });

  async function atender(url, init = {}) {
    const u = new URL(url); const ruta = u.pathname.replace('/v1', ''); const metodo = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    llamadas.push(`${metodo} ${ruta}`);
    let m;
    if (ruta === '/search') return { results: [...bases.values()], has_more: false };
    if ((m = ruta.match(/^\/data_sources\/([^/]+)\/query$/))) {
      let lista = [...paginas.values()].filter((p) => limpio(p.parent.data_source_id) === limpio(m[1]) && !p.in_trash && cumple(p, body?.filter));
      const orden = body?.sorts?.[0];
      if (orden) lista.sort((a, b) => String(a.properties[orden.property]?.date?.start || '').localeCompare(String(b.properties[orden.property]?.date?.start || '')));
      return paginar(lista, body?.page_size, body?.start_cursor);
    }
    if ((m = ruta.match(/^\/data_sources\/([^/]+)$/))) return bases.get(m[1]) || { _status: 404 };
    if (ruta === '/pages' && metodo === 'POST') {
      const props = {}; for (const [k, v] of Object.entries(body.properties)) props[k] = { type: Object.keys(v)[0], ...v };
      for (const p of Object.values(props)) for (const t of p.title || p.rich_text || []) t.plain_text = t.text?.content ?? '';
      const id = pagina(body.parent.data_source_id, props);
      if (body.children) bloques.set(id, registrar(id, body.children));
      return paginas.get(id);
    }
    if ((m = ruta.match(/^\/pages\/([^/]+)$/))) {
      const pg = paginas.get(m[1]); if (!pg) return { _status: 404 };
      if (metodo === 'PATCH') {
        if (body.in_trash != null) pg.in_trash = body.in_trash;
        for (const [k, v] of Object.entries(body.properties || {})) { pg.properties[k] = { type: Object.keys(v)[0], ...v };
          for (const t of pg.properties[k].title || pg.properties[k].rich_text || []) t.plain_text = t.text?.content ?? t.plain_text ?? ''; }
      }
      return pg;
    }
    if ((m = ruta.match(/^\/blocks\/([^/]+)\/children$/))) {
      if (metodo === 'PATCH') { const nuevos = registrar(m[1], body.children); bloques.set(m[1], [...(bloques.get(m[1]) || []), ...nuevos]); return { results: nuevos }; }
      const lista = bloques.get(m[1]);
      if (lista && lista.some((b) => b._hijos)) bloques.set(m[1], registrar(m[1], lista)); // primera lectura: registra los hijos
      return paginar((bloques.get(m[1]) || []).map(({ _hijos, ...b }) => b), Number(u.searchParams.get('page_size')) || 100, u.searchParams.get('start_cursor'));
    }
    if ((m = ruta.match(/^\/blocks\/([^/]+)$/)) && metodo === 'DELETE') { for (const [k, l] of bloques) bloques.set(k, l.filter((b) => b.id !== m[1])); return {}; }
    return { _status: 404, message: 'ruta no simulada: ' + ruta };
  }
  return { base, pagina, P, B, bases, paginas, bloques, llamadas, atender, textoDe };
}

// ---------- Modelo (API compatible con OpenAI) ----------
// `guion` es una lista de respuestas: texto, objeto (se serializa) o función (cuerpo de la petición) → texto u objeto.
// Un número en el guion responde con ese código de error HTTP.
export function fakeModelo(guion = []) {
  const llamadas = [];
  const cola = [...guion];
  async function atender(url, init = {}) {
    const body = JSON.parse(init.body || '{}');
    llamadas.push({ url: String(url), body });
    if (!cola.length) throw new Error('El guion del modelo se quedó sin respuestas');
    let r = cola.shift();
    if (typeof r === 'function') r = r(body);
    if (typeof r === 'number') return { _status: r, error: { message: 'error simulado ' + r } };
    return { choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }], usage: { prompt_tokens: 1 } };
  }
  return { llamadas, atender, encolar: (...x) => cola.push(...x), pendientes: () => cola.length };
}

// Instala fetch simulado y devuelve un entorno listo para los módulos del Worker.
export function entorno({ guion = [], config } = {}) {
  const notion = fakeNotion(); const modelo = fakeModelo(guion); const DB = fakeD1();
  const CONFIG = fakeKV({ ia: config || { principal: { proveedor: 'gemini', modelo: 'modelo-principal' }, respaldo: null, parametros: { temperature: 0.7 }, extra: {}, favoritos: [] } });
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const datos = u.includes('api.notion.com') ? await notion.atender(u, init) : u.includes('/chat/completions') ? await modelo.atender(u, init) : { _status: 404 };
    const status = datos?._status || 200;
    return new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const env = { DB, CONFIG, NOTION_TOKEN: 'x', GEMINI_API_KEY: 'x', NANOGPT_API_KEY: 'x', FIREBASE_PROJECT_ID: 'bitacora-c20b4', OWNER_UID: 'dueno',
    NOTION_DS_TAREAS: DS.TAREAS, NOTION_DS_MATERIAS: DS.MATERIAS, NOTION_DS_PERSONAS: DS.PERSONAS, NOTION_DS_INBOX: DS.INBOX, NOTION_DS_HORARIO: DS.HORARIO,
    NOTION_DS_SEMESTRES: DS.SEMESTRES, NOTION_DS_CLASES: DS.CLASES, NOTION_DS_PREGUNTAS: DS.PREGUNTAS, NOTION_DS_RESUMENES: DS.RESUMENES };
  return { env, notion, modelo, DB, CONFIG };
}

// Datos de ejemplo parecidos al Notion de Kevin: materias, semestre, horario, tareas y una clase con apuntes.
export function sembrar(notion, fechaHoy) {
  const { base, pagina, P, B } = notion;
  const sel = (...o) => ({ type: 'select', select: { options: o.map((name) => ({ name })) } });
  const rel = (id) => ({ type: 'relation', relation: { data_source_id: id } });
  base(DS.MATERIAS, 'Materias', { Materia: { type: 'title' }, 'Código': { type: 'rich_text' }, Profesor: { type: 'rich_text' } });
  base(DS.TAREAS, 'Tareas y evaluaciones', { Tarea: { type: 'title' }, Tipo: sel('Tarea', 'Prueba', 'Examen', 'Proyecto', 'Lectura', 'Institucional'), Entrega: { type: 'date' },
    Materia: rel(DS.MATERIAS), Completada: { type: 'checkbox' }, Grupal: { type: 'checkbox' } });
  base(DS.CLASES, 'Clases', { Clase: { type: 'title' }, Fecha: { type: 'date' }, Materia: rel(DS.MATERIAS), Semana: sel(...Array.from({ length: 16 }, (_, i) => `Semana ${i + 1}`)),
    'Número': sel('Clase 1', 'Clase 2'), Semestre: rel(DS.SEMESTRES), Estado: sel('Foto subida', 'Mejorada') });
  base(DS.SEMESTRES, 'Semestres', { Periodo: { type: 'title' }, Actual: { type: 'checkbox' }, Inicio: { type: 'date' } });
  base(DS.HORARIO, 'Horario', { Bloque: { type: 'title' }, 'Día': sel('Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'), Hora: { type: 'rich_text' }, Aula: { type: 'rich_text' }, Materia: rel(DS.MATERIAS), Semestre: rel(DS.SEMESTRES) });
  base(DS.PREGUNTAS, 'Banco de preguntas', { Pregunta: { type: 'title' }, Respuesta: { type: 'rich_text' }, Materia: rel(DS.MATERIAS), Dominio: sel('No la sé', 'Más o menos', 'La sé'), 'Último repaso': { type: 'date' } });
  base(DS.RESUMENES, 'Resúmenes', { Resumen: { type: 'title' }, Materia: rel(DS.MATERIAS), Semanas: { type: 'rich_text' }, Tipo: sel('Semanal', 'Síntesis 3 semanas'), Fecha: { type: 'date' } });
  base(DS.INBOX, 'Inbox', { Nota: { type: 'title' }, Procesada: { type: 'checkbox' }, Materia: rel(DS.MATERIAS) });
  base(DS.PERSONAS, 'Personas', { Nombre: { type: 'title' }, Rol: sel('Compañero', 'Profesor', 'Tutor', 'Ayudante'), Apodo: { type: 'rich_text' }, Materias: rel(DS.MATERIAS) });
  const mas = (n) => { const d = new Date(fechaHoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const big = pagina(DS.MATERIAS, { Materia: P.titulo('Fundamentos de Big Data'), 'Código': P.texto('ICCD753'), Profesor: P.texto('') });
  const comp = pagina(DS.MATERIAS, { Materia: P.titulo('Compiladores'), 'Código': P.texto('ICCD653'), Profesor: P.texto('') });
  const sem = pagina(DS.SEMESTRES, { Periodo: P.titulo('2026-B'), Actual: P.casilla(true), Inicio: P.fecha(mas(-42)) });
  pagina(DS.HORARIO, { Bloque: P.titulo('Big Data'), 'Día': P.opcion('Martes'), Hora: P.texto('11:00 – 13:00'), Aula: P.texto('LAB-3'), Materia: P.rel(big), Semestre: P.rel(sem) });
  const t1 = pagina(DS.TAREAS, { Tarea: P.titulo('Deber 3: MapReduce'), Tipo: P.opcion('Tarea'), Entrega: P.fecha(mas(2)), Materia: P.rel(big), Completada: P.casilla(false), Grupal: P.casilla(false) });
  const clase = pagina(DS.CLASES, { Clase: P.titulo('S7-C1 · MapReduce'), Fecha: P.fecha(mas(-1)), Materia: P.rel(big), Semana: P.opcion('Semana 7'), Semestre: P.rel(sem) }, [
    B.h2('MapReduce'), B.p('El modelo divide el trabajo en map y reduce.'),
    B.li('Tolerancia a fallos', [B.li('Se logra con réplicas de cada bloque'), B.li('El NameNode reasigna tareas')]),
    B.toggle('Detalle del combiner', [B.p('El combiner es un mini-reduce local.')]),
    B.eq('T = n \\cdot \\log n'),
    B.tabla([['Fase', 'Entrada'], ['map', 'líneas'], ['reduce', 'pares clave-valor']]),
  ]);
  return { big, comp, sem, t1, clase, mas };
}
