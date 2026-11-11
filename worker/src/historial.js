// Historial, chats, memoria y valoraciones del asistente, guardados en D1.

import { normal } from './util.js';

export class ErrorAsistente extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// ---------- Historial, chats, memoria y valoraciones en D1 ----------

// Versión del esquema de D1. Al agregar tablas o columnas: súmale 1 y añade el cambio en migrar() (todo idempotente).
const ESQUEMA = 2;
const basesListas = new WeakSet(); // una vez por instancia del Worker
export async function db(env) {
  if (!env.DB) throw new ErrorAsistente(503, 'Falta la base D1 del historial en Cloudflare');
  if (!basesListas.has(env.DB)) {
    // Una sola consulta por arranque: las migraciones solo corren si la versión guardada es anterior.
    let version = 0;
    try { version = (await env.DB.prepare('SELECT version FROM esquema WHERE id = 1').first())?.version || 0; } catch { /* base nueva: aún no existe la tabla */ }
    if (version < ESQUEMA) {
      await env.DB.batch([
        env.DB.prepare('CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, rol TEXT NOT NULL, texto TEXT NOT NULL, datos TEXT, creado INTEGER NOT NULL)'),
        env.DB.prepare('CREATE INDEX IF NOT EXISTS mensajes_creado ON mensajes (creado)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, creado INTEGER NOT NULL, actualizado INTEGER NOT NULL)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS memoria (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, origen TEXT NOT NULL, creado INTEGER NOT NULL)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS valoraciones (mensaje INTEGER PRIMARY KEY, valor INTEGER NOT NULL, motivo TEXT, creado INTEGER NOT NULL)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS repasos (tarea TEXT NOT NULL, fecha TEXT NOT NULL, hecho INTEGER NOT NULL DEFAULT 1, actualizado INTEGER NOT NULL, PRIMARY KEY (tarea, fecha))'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS peticiones (id TEXT PRIMARY KEY, respuesta TEXT, creado INTEGER NOT NULL)'),
        env.DB.prepare('CREATE TABLE IF NOT EXISTS esquema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'),
      ]);
      // Migración: los mensajes pasan a pertenecer a un chat; los antiguos van a "Conversación anterior".
      try { await env.DB.prepare('ALTER TABLE mensajes ADD COLUMN chat INTEGER').run(); } catch { /* ya existe */ }
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS mensajes_chat ON mensajes (chat, id)').run();
      const sueltos = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(creado) AS ini, MAX(creado) AS fin FROM mensajes WHERE chat IS NULL').first();
      if (sueltos?.n) {
        const c = await env.DB.prepare('INSERT INTO chats (titulo, creado, actualizado) VALUES (?, ?, ?)').bind('Conversación anterior', sueltos.ini, sueltos.fin).run();
        await env.DB.prepare('UPDATE mensajes SET chat = ? WHERE chat IS NULL').bind(c.meta.last_row_id).run();
      }
      await env.DB.prepare('INSERT INTO esquema (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version').bind(ESQUEMA).run();
    }
    basesListas.add(env.DB);
  }
  return env.DB;
}

export const fila = (r) => ({ id: r.id, rol: r.rol, texto: r.texto, datos: r.datos ? JSON.parse(r.datos) : null, creado: r.creado, chat: r.chat ?? null,
  ...(r.valoracion != null ? { valoracion: r.valoracion } : {}) });

export async function historial(env, { chat, antes, limite = 50 } = {}) {
  const base = await db(env);
  const n = Math.min(Math.max(Number(limite) || 50, 1), 100);
  const id = Number(chat);
  if (!id) return [];
  const q = antes
    ? base.prepare('SELECT m.*, v.valor AS valoracion FROM mensajes m LEFT JOIN valoraciones v ON v.mensaje = m.id WHERE m.chat = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?').bind(id, Number(antes), n)
    : base.prepare('SELECT m.*, v.valor AS valoracion FROM mensajes m LEFT JOIN valoraciones v ON v.mensaje = m.id WHERE m.chat = ? ORDER BY m.id DESC LIMIT ?').bind(id, n);
  const { results } = await q.all();
  return results.map(fila).reverse();
}

// Chats
export const tituloDe = (texto) => {
  const t = String(texto).replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 47).trimEnd() + '…' : t || 'Nuevo chat';
};

export async function listarChats(env) {
  const { results } = await (await db(env)).prepare(
    'SELECT c.id, c.titulo, c.creado, c.actualizado, (SELECT COUNT(*) FROM mensajes m WHERE m.chat = c.id) AS mensajes FROM chats c ORDER BY c.actualizado DESC LIMIT 100'
  ).all();
  return results;
}

export async function crearChat(env, titulo) {
  const base = await db(env);
  const ahora = Date.now();
  const r = await base.prepare('INSERT INTO chats (titulo, creado, actualizado) VALUES (?, ?, ?)').bind(tituloDe(titulo || 'Nuevo chat'), ahora, ahora).run();
  return { id: r.meta.last_row_id, titulo: tituloDe(titulo || 'Nuevo chat'), creado: ahora, actualizado: ahora, mensajes: 0 };
}

export async function renombrarChat(env, { id, titulo }) {
  const t = typeof titulo === 'string' ? titulo.trim().slice(0, 80) : '';
  if (!t) throw new ErrorAsistente(400, 'Escribe un nombre');
  const r = await (await db(env)).prepare('UPDATE chats SET titulo = ? WHERE id = ?').bind(t, Number(id)).run();
  if (!r.meta.changes) throw new ErrorAsistente(404, 'No encontré ese chat');
  return { id: Number(id), titulo: t };
}

export async function borrarChat(env, id) {
  const base = await db(env);
  await base.batch([
    base.prepare('DELETE FROM valoraciones WHERE mensaje IN (SELECT id FROM mensajes WHERE chat = ?)').bind(Number(id)),
    base.prepare('DELETE FROM mensajes WHERE chat = ?').bind(Number(id)),
    base.prepare('DELETE FROM chats WHERE id = ?').bind(Number(id)),
  ]);
}

// Memoria: datos que Kevin pidió recordar o aceptó cuando el asistente los propuso.
export async function listarMemoria(env) {
  const { results } = await (await db(env)).prepare('SELECT id, texto, origen, creado FROM memoria ORDER BY id').all();
  return results;
}

export async function agregarMemoria(env, texto, origen = 'usuario') {
  const t = typeof texto === 'string' ? texto.trim().slice(0, 300) : '';
  if (!t) throw new ErrorAsistente(400, 'El recuerdo está vacío');
  const base = await db(env);
  const { results } = await base.prepare('SELECT id, texto FROM memoria').all();
  const igual = results.find((m) => normal(m.texto) === normal(t));
  if (igual) return { id: igual.id, texto: igual.texto, repetido: true };
  if (results.length >= 60) throw new ErrorAsistente(409, 'La memoria está llena (60 datos); borra alguno en Ajustes → Memoria');
  const r = await base.prepare('INSERT INTO memoria (texto, origen, creado) VALUES (?, ?, ?)').bind(t, origen, Date.now()).run();
  return { id: r.meta.last_row_id, texto: t, origen };
}

export async function editarMemoria(env, { id, texto }) {
  const t = typeof texto === 'string' ? texto.trim().slice(0, 300) : '';
  if (!t) throw new ErrorAsistente(400, 'El recuerdo está vacío');
  await (await db(env)).prepare('UPDATE memoria SET texto = ? WHERE id = ?').bind(t, Number(id)).run();
  return { id: Number(id), texto: t };
}

export async function borrarMemoria(env, id) {
  await (await db(env)).prepare('DELETE FROM memoria WHERE id = ?').bind(Number(id)).run();
}

// Respuesta a una propuesta de recuerdo hecha por el asistente: se guarda (si se acepta) y se marca en el mensaje.
export async function responderPropuesta(env, { mensaje, aceptar, texto }) {
  const base = await db(env);
  let guardado = null;
  let m = null;
  if (mensaje) {
    const row = await base.prepare('SELECT * FROM mensajes WHERE id = ?').bind(Number(mensaje)).first();
    if (row) m = fila(row);
  }
  const propuesta = m?.datos?.resultados?.find((x) => x.accion === 'proponer_recuerdo' && x.ok);
  const t = propuesta?.texto || texto;
  if (aceptar) guardado = await agregarMemoria(env, t, 'sugerida');
  if (m && propuesta) {
    propuesta.estado = aceptar ? 'aceptada' : 'rechazada';
    await base.prepare('UPDATE mensajes SET datos = ? WHERE id = ?').bind(JSON.stringify(m.datos), m.id).run();
  }
  return { mensaje: m, memoria: guardado };
}

// Guarda en el mensaje qué marcó Kevin en una tarjeta de práctica (para que se vea al volver al chat).
export async function guardarMarcaTarjeta(env, mensaje, indice, dominio) {
  const base = await db(env);
  const row = await base.prepare('SELECT * FROM mensajes WHERE id = ?').bind(Number(mensaje)).first();
  if (!row) return;
  const m = fila(row);
  const r = m.datos?.resultados?.find((x) => Array.isArray(x.tarjetas));
  if (!r || !r.tarjetas[Number(indice)]) return;
  r.tarjetas[Number(indice)].marcado = dominio;
  await base.prepare('UPDATE mensajes SET datos = ? WHERE id = ?').bind(JSON.stringify(m.datos), m.id).run();
}

// Valoraciones 👍/👎 (con motivo opcional) para que el asistente ajuste su forma de responder.
export async function valorar(env, { mensaje, valor, motivo }) {
  const v = Number(valor);
  if (![1, -1, 0].includes(v)) throw new ErrorAsistente(400, 'Valor inválido');
  const base = await db(env);
  if (v === 0) await base.prepare('DELETE FROM valoraciones WHERE mensaje = ?').bind(Number(mensaje)).run();
  else {
    await base.prepare('INSERT INTO valoraciones (mensaje, valor, motivo, creado) VALUES (?, ?, ?, ?) ON CONFLICT (mensaje) DO UPDATE SET valor = excluded.valor, motivo = excluded.motivo, creado = excluded.creado')
      .bind(Number(mensaje), v, typeof motivo === 'string' ? motivo.trim().slice(0, 200) || null : null, Date.now()).run();
  }
  return { mensaje: Number(mensaje), valor: v, motivo: motivo || null };
}

// Resumen breve de las últimas valoraciones para el prompt.
export async function resumenValoraciones(base) {
  const { results } = await base.prepare('SELECT valor, motivo FROM valoraciones ORDER BY creado DESC LIMIT 30').all();
  if (!results.length) return null;
  const pos = results.filter((r) => r.valor > 0).length;
  const motivos = {};
  for (const r of results.filter((x) => x.valor < 0)) { const k = r.motivo || 'sin motivo'; motivos[k] = (motivos[k] || 0) + 1; }
  const neg = Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× "${k}"`).join(', ');
  return `De las últimas ${results.length} respuestas valoradas: ${pos} le gustaron${neg ? `; no le gustaron por: ${neg}` : ''}.`;
}
