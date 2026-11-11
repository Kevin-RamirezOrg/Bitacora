import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ErrorIA, chat, estadoProveedores, guardarConfig, leerConfig, listarModelos } from './ia.js';
import { ErrorNotion } from './notion.js';
import {
  ErrorAsistente, agregarMemoria, borrarChat, borrarHistorial, borrarMemoria, crearChat, deshacerMensaje, deshacerTemporal,
  editarMemoria, guardarMarcaTarjeta, historial, listarChats, listarMemoria, procesarMensaje, renombrarChat, responderPropuesta, valorar,
  recortarDesde, borrarTurno,
} from './asistente.js';
import { datosHoy, marcarRepaso, marcarTareaHoy } from './hoy.js';
import { ErrorEstudio, marcarDominio } from './estudio.js';
import { ErrorBase } from './universidad.js';
import { subirAudio, transcribirArchivo } from './audio.js';
import { hablar } from './voz.js';

const ORIGEN = 'https://ellenkev.me';
const TAMANO_MAXIMO_CUERPO = 200_000;

// Claves públicas con las que Google firma los ID tokens de Firebase.
// Se crea una sola vez por instancia: jose las guarda en caché y las renueva solo.
const CLAVES_FIREBASE = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const CORS = {
  'Access-Control-Allow-Origin': ORIGEN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(datos, status = 200) {
  return Response.json(datos, { status, headers: CORS });
}

class ErrorAcceso extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// Comprueba que la petición trae un ID token válido de Firebase y que es del dueño.
// Devuelve el contenido del token o lanza ErrorAcceso (401 sin sesión válida, 403 si no es el dueño).
export async function verificarDueno(request, env, claves = CLAVES_FIREBASE) {
  const cabecera = request.headers.get('Authorization') || '';
  const [tipo, token] = cabecera.split(' ');
  if (tipo !== 'Bearer' || !token) {
    throw new ErrorAcceso(401, 'Falta el token de sesión');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, claves, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    }));
  } catch {
    throw new ErrorAcceso(401, 'Token inválido o vencido');
  }

  const ahora = Math.floor(Date.now() / 1000);
  if (typeof payload.auth_time !== 'number' || payload.auth_time > ahora + 60) {
    throw new ErrorAcceso(401, 'Token inválido o vencido');
  }
  if (payload.sub !== env.OWNER_UID) {
    throw new ErrorAcceso(403, 'Acceso solo para el dueño');
  }
  return payload;
}

async function leerCuerpo(request) {
  const texto = await request.text();
  if (texto.length > TAMANO_MAXIMO_CUERPO) throw new ErrorIA(413, 'Petición demasiado grande');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorIA(400, 'El cuerpo debe ser JSON');
  }
}

// Respuesta en líneas (NDJSON): {etapa} mientras trabaja y al final {fin} o {error}.
function enLineas(ctx, trabajo) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const enviar = (o) => w.write(enc.encode(JSON.stringify(o) + '\n')).catch(() => {});
  const tarea = (async () => {
    try {
      await enviar({ fin: await trabajo((t) => { enviar({ etapa: t }); }) });
    } catch (e) {
      const conocido = e instanceof ErrorIA || e instanceof ErrorNotion || e instanceof ErrorAsistente || e instanceof ErrorEstudio || e instanceof ErrorBase;
      if (!conocido) console.error(e);
      await enviar({ error: conocido ? e.message : 'Error interno', detalle: e.detalle ?? null, status: e.status || 500 });
    } finally {
      await w.close().catch(() => {});
    }
  })();
  ctx?.waitUntil?.(tarea);
  return new Response(readable, { headers: { ...CORS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Rutas privadas: "MÉTODO /ruta" → función.
const RUTAS = {
  'GET /yo': (req, env, sesion) => json({ ok: true, uid: sesion.sub }),

  'GET /ia/proveedores': (req, env) => json({ proveedores: estadoProveedores(env) }),

  'GET /ia/modelos': async (req, env) => {
    const proveedor = new URL(req.url).searchParams.get('proveedor');
    return json({ proveedor, modelos: await listarModelos(env, proveedor) });
  },

  'GET /config/ia': async (req, env) => json({ config: await leerConfig(env) }),

  'PUT /config/ia': async (req, env) => json({ ok: true, config: await guardarConfig(env, await leerCuerpo(req)) }),

  // Solo pasan los campos que la app puede enviar; las opciones internas de chat() no se aceptan desde fuera.
  'POST /ia/chat': async (req, env) => { const { mensajes, config, modelo } = await leerCuerpo(req); return json(await chat(env, { mensajes, config, modelo })); },

  // Asistente (Notion + historial en D1)
  'GET /asistente/estado': (req, env) => json({ notion: Boolean(env.NOTION_TOKEN), historial: Boolean(env.DB) }),

  'GET /asistente/historial': async (req, env) => {
    const p = new URL(req.url).searchParams;
    return json({ mensajes: await historial(env, { chat: p.get('chat'), antes: p.get('antes'), limite: p.get('limite') }) });
  },

  'DELETE /asistente/historial': async (req, env) => {
    await borrarHistorial(env, new URL(req.url).searchParams.get('chat'));
    return json({ ok: true });
  },

  // Chats: lista, crear, renombrar y borrar
  'GET /asistente/chats': async (req, env) => json({ chats: await listarChats(env) }),
  'POST /asistente/chats': async (req, env) => json({ chat: await crearChat(env, (await leerCuerpo(req)).titulo) }),
  'PUT /asistente/chats': async (req, env) => json({ chat: await renombrarChat(env, await leerCuerpo(req)) }),
  'DELETE /asistente/chats': async (req, env) => {
    await borrarChat(env, new URL(req.url).searchParams.get('id'));
    return json({ ok: true });
  },

  // Con "Accept: application/x-ndjson" responde en líneas: {etapa} mientras trabaja y al final {fin} o {error}.
  'POST /asistente/mensaje': async (req, env, sesion, ctx) => {
    const cuerpo = await leerCuerpo(req);
    if (!(req.headers.get('Accept') || '').includes('application/x-ndjson')) return json(await procesarMensaje(env, cuerpo));
    return enLineas(ctx, (progreso) => procesarMensaje(env, { ...cuerpo, progreso }));
  },

  // Audio → texto con Gemini. El cuerpo es el archivo de audio: primero se reenvía completo a Gemini
  // y luego se responde en líneas mientras se procesa y transcribe.
  'POST /audio/transcribir': async (req, env, sesion, ctx) => {
    const archivo = await subirAudio(env, req);
    return enLineas(ctx, (progreso) => transcribirArchivo(env, archivo, progreso));
  },

  // Voz natural (Gemini TTS): devuelve la respuesta de Google con el audio en base64.
  'POST /voz/tts': async (req, env) => hablar(env, await leerCuerpo(req), CORS),

  // Práctica: marcar cuánto domina una pregunta (y recordarlo en la tarjeta del mensaje)
  'POST /estudio/dominio': async (req, env) => {
    const b = await leerCuerpo(req);
    const r = await marcarDominio(env, b);
    if (b.mensaje && b.indice != null) await guardarMarcaTarjeta(env, b.mensaje, b.indice, b.dominio).catch(() => {});
    return json(r);
  },

  // Editar o regenerar: con {simular:true} informa qué se deshará; sin él, deshace y recorta la conversación.
  'POST /asistente/recortar': async (req, env) => json(await recortarDesde(env, await leerCuerpo(req))),
  'DELETE /asistente/mensaje': async (req, env) => json(await borrarTurno(env, new URL(req.url).searchParams.get('id'))),

  'POST /asistente/deshacer': async (req, env) => {
    const { id, datos } = await leerCuerpo(req);
    return json(datos ? await deshacerTemporal(env, datos) : { mensaje: await deshacerMensaje(env, id) });
  },

  // Memoria y valoraciones
  'GET /asistente/memoria': async (req, env) => json({ memoria: await listarMemoria(env) }),
  'POST /asistente/memoria': async (req, env) => json({ memoria: await agregarMemoria(env, (await leerCuerpo(req)).texto, 'usuario') }),
  'PUT /asistente/memoria': async (req, env) => json({ memoria: await editarMemoria(env, await leerCuerpo(req)) }),
  'DELETE /asistente/memoria': async (req, env) => {
    await borrarMemoria(env, new URL(req.url).searchParams.get('id'));
    return json({ ok: true });
  },
  'POST /asistente/propuesta': async (req, env) => json(await responderPropuesta(env, await leerCuerpo(req))),
  'POST /asistente/valorar': async (req, env) => json(await valorar(env, await leerCuerpo(req))),

  // Panel "Hoy" (reglas fijas, sin IA)
  'GET /hoy': async (req, env) => json(await datosHoy(env, { refrescar: new URL(req.url).searchParams.get('refrescar') === '1' })),

  'POST /hoy/repaso': async (req, env) => json(await marcarRepaso(env, await leerCuerpo(req))),
  'POST /hoy/tarea': async (req, env) => json(await marcarTareaHoy(env, await leerCuerpo(req))),
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const { pathname } = new URL(request.url);

    try {
      // Ruta pública: solo confirma que el Worker está vivo.
      if (pathname === '/salud') {
        return json({ ok: true, servicio: 'bitacora-worker' });
      }

      // Todas las demás rutas exigen la sesión del dueño.
      const sesion = await verificarDueno(request, env);

      const manejador = RUTAS[`${request.method} ${pathname}`];
      if (!manejador) return json({ error: 'Ruta no encontrada' }, 404);
      return await manejador(request, env, sesion, ctx);
    } catch (error) {
      if (error instanceof ErrorAcceso) {
        return json({ error: error.message }, error.status);
      }
      if (error instanceof ErrorIA) {
        return json({ error: error.message, detalle: error.detalle ?? null }, error.status);
      }
      if (error instanceof ErrorNotion || error instanceof ErrorAsistente || error instanceof ErrorEstudio || error instanceof ErrorBase) {
        return json({ error: error.message }, error.status || 400);
      }
      console.error(error);
      return json({ error: 'Error interno' }, 500);
    }
  },
};
