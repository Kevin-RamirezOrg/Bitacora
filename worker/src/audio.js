// Transcribe un audio (por ejemplo, una clase grabada con la grabadora del teléfono) con Gemini.
// El audio llega como cuerpo binario, se sube a la Files API de Gemini sin copiarlo en memoria,
// se transcribe y se borra el archivo de Google al terminar.

import { ErrorIA, leerConfig } from './ia.js';

const API = 'https://generativelanguage.googleapis.com';
export const AUDIO_MAXIMO = 95 * 1024 * 1024; // límite de cuerpo del Worker gratuito: 100 MB
const TIPOS = ['audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac',
  'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/opus', 'audio/webm', 'video/mp4', 'video/webm'];
const MODELO_POR_DEFECTO = 'gemini-3.5-flash-lite';

const PROMPT = `Transcribe fielmente este audio, normalmente una clase universitaria en español de Ecuador.
- Escribe exactamente lo que se dice, sin resumir, sin agregar explicaciones y sin corregir el contenido; solo pon puntuación.
- Separa en párrafos cuando cambie la idea o quien habla, y empieza cada párrafo con la marca de tiempo [mm:ss] (o [h:mm:ss]).
- Marca lo que no se entienda como [inaudible]. Omite muletillas repetidas y silencios largos.
- Responde solo con la transcripción, sin títulos ni comentarios.`;

// Gemini usado para transcribir: el primero de Gemini en la configuración (principal, respaldo o favoritos).
async function modeloGemini(env) {
  const c = await leerConfig(env);
  const m = [c.principal, c.respaldo, ...(c.favoritos || [])].find((x) => x?.proveedor === 'gemini' && x.modelo);
  return m?.modelo || MODELO_POR_DEFECTO;
}

function clave(env) {
  if (!env.GEMINI_API_KEY) throw new ErrorIA(503, 'Falta la clave de Gemini en Cloudflare');
  return env.GEMINI_API_KEY;
}

async function pedirJSON(url, opciones, mensaje) {
  const r = await fetch(url, opciones);
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* no JSON */ }
  if (!r.ok) throw new ErrorIA(502, mensaje, datos?.error?.message || texto.slice(0, 300));
  return { r, datos };
}

// Cuerpo de longitud fija para reenviar el audio a Google sin cargarlo entero en memoria.
function cuerpoFijo(request, largo) {
  if (typeof FixedLengthStream === 'function' && request.body) {
    const { readable, writable } = new FixedLengthStream(largo);
    request.body.pipeTo(writable).catch(() => {});
    return readable;
  }
  return request.arrayBuffer(); // entorno de pruebas
}

// Paso 1: recibe el audio y lo reenvía a la Files API de Gemini. Devuelve el archivo subido.
export async function subirAudio(env, request) {
  const tipo = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const largo = Number(request.headers.get('Content-Length') || 0);
  if (!TIPOS.includes(tipo)) throw new ErrorIA(415, 'Ese formato de audio no se puede transcribir. Usa m4a, mp3, wav, ogg, aac o webm.');
  if (!largo) throw new ErrorIA(411, 'Falta el tamaño del audio');
  if (largo > AUDIO_MAXIMO) throw new ErrorIA(413, 'El audio supera 95 MB. Grábalo en calidad estándar o divídelo en partes.');
  const mime = { 'audio/x-wav': 'audio/wav', 'audio/x-m4a': 'audio/m4a', 'audio/mp4': 'audio/m4a', 'video/mp4': 'audio/m4a', 'video/webm': 'audio/webm', 'audio/mpeg': 'audio/mp3' }[tipo] || tipo;
  const key = clave(env);
  const nombre = new URL(request.url).searchParams.get('nombre')?.slice(0, 100) || 'audio';

  // Subida reanudable (inicio + envío en una sola parte).
  const inicio = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(largo), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: nombre } }),
  });
  const urlSubida = inicio.headers.get('x-goog-upload-url');
  if (!inicio.ok || !urlSubida) throw new ErrorIA(502, 'Gemini no aceptó el audio', (await inicio.text()).slice(0, 300));
  const { datos: subido } = await pedirJSON(urlSubida, {
    method: 'POST',
    headers: { 'Content-Length': String(largo), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: await cuerpoFijo(request, largo),
  }, 'No se pudo subir el audio a Gemini');
  const archivo = subido?.file;
  if (!archivo?.name) throw new ErrorIA(502, 'Gemini no devolvió el archivo subido');
  return { ...archivo, mimeType: archivo.mimeType || mime };
}

// Paso 2: espera a que Gemini procese el audio, lo transcribe y borra el archivo.
export async function transcribirArchivo(env, subido, progreso = () => {}) {
  const key = clave(env);
  let archivo = subido;
  try {
    // 2. Esperar a que Google termine de procesar el audio.
    progreso('Gemini está procesando el audio…');
    for (let i = 0; archivo.state === 'PROCESSING' && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      ({ datos: archivo } = await pedirJSON(`${API}/v1beta/${archivo.name}`, { headers: { 'x-goog-api-key': key } }, 'No se pudo revisar el audio'));
    }
    if (archivo.state === 'FAILED') throw new ErrorIA(502, 'Gemini no pudo procesar ese audio');

    // 3. Transcripción.
    const modelo = await modeloGemini(env);
    progreso('Transcribiendo… en clases largas puede tardar unos minutos.');
    const { datos } = await pedirJSON(`${API}/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ file_data: { mime_type: archivo.mimeType || subido.mimeType, file_uri: archivo.uri } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 65536 },
      }),
    }, `No se pudo transcribir con ${modelo}`);
    const cand = datos?.candidates?.[0];
    const texto = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!texto) throw new ErrorIA(502, 'La transcripción salió vacía', cand?.finishReason || null);
    return { texto, modelo, incompleta: cand?.finishReason === 'MAX_TOKENS' };
  } finally {
    // 4. Borrar el audio de Google (de todos modos se borraría solo a las 48 h).
    await fetch(`${API}/v1beta/${archivo.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => {});
  }
}
