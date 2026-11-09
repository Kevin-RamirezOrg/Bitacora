// Proveedores de IA (todos con API compatible con OpenAI) y configuración guardada en KV.

export const PROVEEDORES = {
  nanogpt: {
    nombre: 'NanoGPT',
    base: 'https://api.nano-gpt.com/api/v1',
    secreto: 'NANOGPT_API_KEY',
  },
  gemini: {
    nombre: 'Gemini (AI Studio)',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    secreto: 'GEMINI_API_KEY',
  },
};

const CLAVE_KV = 'ia';
const TIEMPO_MAXIMO_MS = 60_000;
// Claves que el campo libre no puede pisar: las controla el Worker.
const RESERVADAS = new Set(['model', 'messages', 'stream', 'stream_options', 'n']);

const MAX_FAVORITOS = 20;

export const CONFIG_INICIAL = {
  principal: { proveedor: 'nanogpt', modelo: '' },
  respaldo: null,
  parametros: { temperature: 0.7 },
  extra: {},
  favoritos: [],
};

export class ErrorIA extends Error {
  constructor(status, mensaje, detalle) {
    super(mensaje);
    this.status = status;
    this.detalle = detalle;
  }
}

// ---------- Validación ----------

function esObjetoPlano(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validarModelo(m, campo) {
  if (!esObjetoPlano(m)) throw new ErrorIA(400, `${campo}: formato inválido`);
  if (!PROVEEDORES[m.proveedor]) throw new ErrorIA(400, `${campo}: proveedor desconocido`);
  if (typeof m.modelo !== 'string' || m.modelo.length > 200) {
    throw new ErrorIA(400, `${campo}: modelo inválido`);
  }
  return { proveedor: m.proveedor, modelo: m.modelo.trim() };
}

const RANGOS = {
  temperature: [0, 2],
  top_p: [0, 1],
  max_tokens: [1, 200_000],
};

function validarParametros(p) {
  if (p === undefined) return {};
  if (!esObjetoPlano(p)) throw new ErrorIA(400, 'parametros: formato inválido');
  const limpio = {};
  for (const [clave, valor] of Object.entries(p)) {
    if (valor === null || valor === '') continue;
    const rango = RANGOS[clave];
    if (!rango) throw new ErrorIA(400, `parametros: "${clave}" no es un parámetro común; usa el campo libre`);
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < rango[0] || valor > rango[1]) {
      throw new ErrorIA(400, `parametros: "${clave}" debe estar entre ${rango[0]} y ${rango[1]}`);
    }
    limpio[clave] = clave === 'max_tokens' ? Math.round(valor) : valor;
  }
  return limpio;
}

function validarExtra(e) {
  if (e === undefined) return {};
  if (!esObjetoPlano(e)) throw new ErrorIA(400, 'extra: debe ser un objeto JSON');
  if (JSON.stringify(e).length > 2000) throw new ErrorIA(400, 'extra: demasiado grande');
  for (const clave of Object.keys(e)) {
    if (RESERVADAS.has(clave)) throw new ErrorIA(400, `extra: "${clave}" lo controla el Worker`);
  }
  return e;
}

// Modelos marcados con estrella: acceso rápido en el chat. Sin duplicados ni nombres vacíos.
function validarFavoritos(f) {
  if (f === undefined) return [];
  if (!Array.isArray(f)) throw new ErrorIA(400, 'favoritos: debe ser una lista');
  if (f.length > MAX_FAVORITOS) throw new ErrorIA(400, `favoritos: máximo ${MAX_FAVORITOS}`);
  const vistos = new Set();
  const lista = [];
  f.forEach((m, i) => {
    const limpio = validarModelo(m, `favoritos[${i}]`);
    const clave = `${limpio.proveedor}/${limpio.modelo}`;
    if (!limpio.modelo || vistos.has(clave)) return;
    vistos.add(clave);
    lista.push(limpio);
  });
  return lista;
}

export function validarConfig(c) {
  if (!esObjetoPlano(c)) throw new ErrorIA(400, 'Configuración inválida');
  return {
    principal: validarModelo(c.principal, 'principal'),
    respaldo: c.respaldo ? validarModelo(c.respaldo, 'respaldo') : null,
    parametros: validarParametros(c.parametros),
    extra: validarExtra(c.extra),
    favoritos: validarFavoritos(c.favoritos),
  };
}

function validarMensajes(mensajes) {
  if (!Array.isArray(mensajes) || mensajes.length === 0 || mensajes.length > 50) {
    throw new ErrorIA(400, 'mensajes: entre 1 y 50');
  }
  return mensajes.map((m, i) => {
    if (!esObjetoPlano(m) || !['system', 'user', 'assistant'].includes(m.role)) {
      throw new ErrorIA(400, `mensajes[${i}]: rol inválido`);
    }
    if (typeof m.content !== 'string' || m.content.length > 50_000) {
      throw new ErrorIA(400, `mensajes[${i}]: contenido inválido`);
    }
    return { role: m.role, content: m.content };
  });
}

// ---------- Configuración en KV ----------

export async function leerConfig(env) {
  const guardada = await env.CONFIG.get(CLAVE_KV, 'json');
  // Completa campos agregados después (por ejemplo, favoritos) en configuraciones antiguas.
  return { ...CONFIG_INICIAL, ...(guardada || {}) };
}

export async function guardarConfig(env, config) {
  const limpia = validarConfig(config);
  await env.CONFIG.put(CLAVE_KV, JSON.stringify({ ...limpia, actualizado: new Date().toISOString() }));
  return limpia;
}

// ---------- Llamadas a proveedores ----------

function claveDe(env, proveedor) {
  const clave = env[PROVEEDORES[proveedor].secreto];
  if (!clave) throw new ErrorIA(503, `Falta la clave de ${PROVEEDORES[proveedor].nombre} en Cloudflare`);
  return clave;
}

async function pedir(env, proveedor, ruta, opciones = {}) {
  const { base } = PROVEEDORES[proveedor];
  let respuesta;
  try {
    respuesta = await fetch(base + ruta, {
      ...opciones,
      headers: {
        Authorization: `Bearer ${claveDe(env, proveedor)}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch (error) {
    if (error instanceof ErrorIA) throw error;
    throw new ErrorIA(504, `${PROVEEDORES[proveedor].nombre} no respondió a tiempo`);
  }
  const texto = await respuesta.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* respuesta no JSON */ }
  if (!respuesta.ok) {
    const mensaje = datos?.error?.message || datos?.message || texto.slice(0, 300);
    throw new ErrorIA(502, `${PROVEEDORES[proveedor].nombre} respondió ${respuesta.status}`, mensaje);
  }
  return datos;
}

// Estado de cada proveedor: si tiene clave guardada (sin revelar la clave).
export function estadoProveedores(env) {
  return Object.entries(PROVEEDORES).map(([id, p]) => ({
    id,
    nombre: p.nombre,
    conClave: Boolean(env[p.secreto]),
  }));
}

export async function listarModelos(env, proveedor) {
  if (!PROVEEDORES[proveedor]) throw new ErrorIA(400, 'Proveedor desconocido');
  const datos = await pedir(env, proveedor, '/models');
  const lista = Array.isArray(datos?.data) ? datos.data : Array.isArray(datos) ? datos : [];
  return lista
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((id) => typeof id === 'string' && id)
    // Gemini devuelve "models/gemini-…"; el endpoint de chat espera solo el nombre.
    .map((id) => id.replace(/^models\//, ''))
    .sort((a, b) => a.localeCompare(b));
}

async function completar(env, destino, mensajes, parametros, extra) {
  if (!destino.modelo) throw new ErrorIA(400, 'No hay modelo elegido');
  const datos = await pedir(env, destino.proveedor, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ ...extra, ...parametros, model: destino.modelo, messages: mensajes, stream: false }),
  });
  const texto = datos?.choices?.[0]?.message?.content;
  if (typeof texto !== 'string') throw new ErrorIA(502, 'Respuesta del proveedor sin texto');
  return { texto, uso: datos.usage || null };
}

// Envía la conversación al modelo principal y, si falla, al de respaldo.
// Si se pasa `configPrueba` (botón Probar del panel), se usa en lugar de la guardada.
export async function chat(env, { mensajes, config: configPrueba }) {
  const lista = validarMensajes(mensajes);
  const config = configPrueba ? validarConfig(configPrueba) : await leerConfig(env);

  const intentos = [config.principal, config.respaldo].filter(Boolean);
  const fallos = [];
  for (const destino of intentos) {
    try {
      const { texto, uso } = await completar(env, destino, lista, config.parametros, config.extra);
      return { texto, uso, proveedor: destino.proveedor, modelo: destino.modelo, fallos };
    } catch (error) {
      if (!(error instanceof ErrorIA)) throw error;
      fallos.push({ proveedor: destino.proveedor, modelo: destino.modelo, error: error.message, detalle: error.detalle });
    }
  }
  const ultimo = fallos[fallos.length - 1];
  throw new ErrorIA(502, ultimo ? `No se pudo obtener respuesta: ${ultimo.error}` : 'No hay modelo configurado', fallos);
}
