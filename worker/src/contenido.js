// Formatos interactivos que el asistente puede mostrar en el chat (no escriben en Notion):
// opción múltiple, verdadero/falso, completar, tarjetas, tabla y pasos.
// El modelo los propone en JSON; aquí se validan y se recortan antes de llegar a la app.

export const FORMATOS = ['opcion_multiple', 'verdadero_falso', 'completar', 'tarjetas', 'tabla', 'pasos'];

const MAX_ITEMS = 10;
const txt = (v, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Devuelve el contenido limpio o lanza un Error con el motivo.
export function validarContenido(c) {
  const formato = c?.formato;
  if (!FORMATOS.includes(formato)) throw new Error('formato no reconocido');
  const titulo = txt(c.titulo, 120) || null;
  const lista = (v) => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
  let items;
  switch (formato) {
    case 'opcion_multiple':
      items = lista(c.preguntas).map((p) => {
        const opciones = (Array.isArray(p?.opciones) ? p.opciones : []).map((o) => txt(o, 200)).filter(Boolean).slice(0, 6);
        const correcta = Number(p?.correcta);
        if (!txt(p?.pregunta) || opciones.length < 2 || !Number.isInteger(correcta) || correcta < 0 || correcta >= opciones.length) return null;
        return { pregunta: txt(p.pregunta), opciones, correcta, explicacion: txt(p.explicacion) || null };
      });
      break;
    case 'verdadero_falso':
      items = lista(c.preguntas).map((p) => (txt(p?.afirmacion) && typeof p?.verdadero === 'boolean'
        ? { afirmacion: txt(p.afirmacion), verdadero: p.verdadero, explicacion: txt(p.explicacion) || null } : null));
      break;
    case 'completar':
      items = lista(c.preguntas).map((p) => {
        const texto = txt(p?.texto); const respuesta = txt(p?.respuesta, 120);
        return texto.includes('___') && respuesta ? { texto, respuesta } : null;
      });
      break;
    case 'tarjetas':
      items = lista(c.tarjetas).map((t) => (txt(t?.frente) && txt(t?.reverso) ? { frente: txt(t.frente), reverso: txt(t.reverso, 600) } : null));
      break;
    case 'tabla': {
      const columnas = (Array.isArray(c.columnas) ? c.columnas : []).map((x) => txt(x, 60)).filter(Boolean).slice(0, 6);
      if (columnas.length < 2) throw new Error('la tabla necesita al menos dos columnas');
      const filas = (Array.isArray(c.filas) ? c.filas : []).slice(0, 20)
        .map((f) => (Array.isArray(f) ? columnas.map((_, i) => txt(String(f[i] ?? ''), 200)) : null))
        .filter((f) => f && f.some(Boolean));
      if (!filas.length) throw new Error('la tabla está vacía');
      return { formato, titulo, columnas, filas };
    }
    case 'pasos':
      items = lista(c.pasos).map((p) => (typeof p === 'string' ? (txt(p) ? { titulo: txt(p), detalle: null } : null)
        : txt(p?.titulo) ? { titulo: txt(p.titulo, 160), detalle: txt(p.detalle) || null } : null));
      break;
  }
  items = items.filter(Boolean);
  if (!items.length) throw new Error('el contenido está vacío o mal formado');
  return { formato, titulo, items };
}

// Instrucciones para el modelo (se agregan a los dos prompts).
export const ESPEC_CONTENIDO = `{"accion": "mostrar_contenido", "formato": "opcion_multiple", "titulo": "corto", "preguntas": [{"pregunta": "...", "opciones": ["A", "B", "C", "D"], "correcta": 0, "explicacion": "una frase"}]}
{"accion": "mostrar_contenido", "formato": "verdadero_falso", "titulo": "...", "preguntas": [{"afirmacion": "...", "verdadero": true, "explicacion": "una frase"}]}
{"accion": "mostrar_contenido", "formato": "completar", "titulo": "...", "preguntas": [{"texto": "El ___ almacena datos sin procesar.", "respuesta": "data lake"}]}
{"accion": "mostrar_contenido", "formato": "tarjetas", "titulo": "...", "tarjetas": [{"frente": "concepto o pregunta", "reverso": "respuesta breve"}]}
{"accion": "mostrar_contenido", "formato": "tabla", "titulo": "...", "columnas": ["Concepto", "Definición"], "filas": [["...", "..."]]}
{"accion": "mostrar_contenido", "formato": "pasos", "titulo": "...", "pasos": [{"titulo": "paso corto", "detalle": "una frase" o null}]}`;

export const REGLA_CONTENIDO = `- mostrar_contenido muestra en el chat un ejercicio o un formato visual; no guarda nada en Notion. Úsalo cuando Kevin pida un quiz, preguntas de opción múltiple, verdadero o falso, completar, tarjetas, una tabla o comparación, o pasos; o cuando una tabla o lista de pasos sea claramente la mejor forma de responder. Máximo uno por mensaje y hasta 10 elementos (5 si no dice cuántos). Cuando haya ejercicio, "respuesta" solo lo presenta en una frase y no revela las respuestas. Si las preguntas deben salir de sus apuntes, primero lee la página de Clases con consultar_base y leer_pagina, y escríbelas solo con lo que dicen los apuntes. Si pide guardarlas en el Banco de preguntas, usa preguntas_estudio en su lugar.`;

// Resumen corto para el historial que ve el modelo (para preguntas como "¿cuál era la 3?").
export function resumenContenido(x) {
  const nombre = { opcion_multiple: 'un quiz de opción múltiple', verdadero_falso: 'un verdadero o falso', completar: 'un ejercicio de completar',
    tarjetas: 'tarjetas de repaso', tabla: 'una tabla', pasos: 'una lista de pasos' }[x.formato];
  let detalle = '';
  if (x.formato === 'opcion_multiple') detalle = x.items.map((p, i) => `${i + 1}) ${p.pregunta} → ${p.opciones[p.correcta]}`).join('; ');
  else if (x.formato === 'verdadero_falso') detalle = x.items.map((p, i) => `${i + 1}) ${p.afirmacion} → ${p.verdadero ? 'V' : 'F'}`).join('; ');
  else if (x.formato === 'completar') detalle = x.items.map((p, i) => `${i + 1}) ${p.texto} → ${p.respuesta}`).join('; ');
  else if (x.formato === 'tarjetas') detalle = x.items.map((t) => t.frente).join('; ');
  else if (x.formato === 'tabla') detalle = `columnas ${x.columnas.join(', ')}; ${x.filas.length} filas`;
  else detalle = x.items.map((p) => p.titulo).join('; ');
  return `le mostré ${nombre}${x.titulo ? ` "${x.titulo}"` : ''}: ${detalle}`.slice(0, 1500);
}
