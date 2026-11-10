// Voz natural con Gemini TTS. El Worker solo reenvía la respuesta de Google tal cual (JSON con el audio
// PCM en base64) para no gastar tiempo de CPU decodificándola; la app arma el WAV y lo reproduce.

import { ErrorIA } from './ia.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Del más barato al más conocido; si uno no existe (404) se prueba el siguiente.
const MODELOS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];
export const VOCES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux',
  'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];
const MAX_TEXTO = 2500;

export async function hablar(env, { texto, voz }, cors) {
  if (!env.GEMINI_API_KEY) throw new ErrorIA(503, 'Falta la clave de Gemini en Cloudflare');
  const t = typeof texto === 'string' ? texto.trim().slice(0, MAX_TEXTO) : '';
  if (!t) throw new ErrorIA(400, 'No hay texto para leer');
  const nombre = VOCES.includes(voz) ? voz : 'Kore';
  const cuerpo = JSON.stringify({
    // Solo el texto: una instrucción de estilo delante a veces se leía en voz alta. El idioma se detecta solo.
    contents: [{ parts: [{ text: t }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: nombre } } } },
  });
  let ultimo = null;
  for (const modelo of MODELOS) {
    const r = await fetch(`${API}/${modelo}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: cuerpo,
    });
    if (r.ok) return new Response(r.body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Modelo-Voz': modelo } });
    const texto = await r.text();
    let msg = texto.slice(0, 300);
    try { msg = JSON.parse(texto)?.error?.message || msg; } catch { /* no JSON */ }
    ultimo = { status: r.status, msg };
    if (r.status !== 404) break; // 429 (sin cuota) u otro error: no tiene sentido probar otro modelo
  }
  const sinCuota = ultimo?.status === 429;
  throw new ErrorIA(sinCuota ? 429 : 502, sinCuota ? 'Se acabó la cuota gratuita de voz de Gemini por hoy' : 'La voz de Gemini no respondió', ultimo?.msg || null);
}
