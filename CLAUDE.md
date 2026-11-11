# Bitácora — contexto del proyecto

Web personal de notas y organización de estudio de Kevin, estudiante universitario en Ecuador (EPN, FIS). La usa sobre todo desde el celular (Chrome en Android, ahora instalable como app) y a veces desde PC ajenas de la universidad, en incógnito.

> Este repositorio es público: no agregues aquí secretos, claves ni datos personales que no sean necesarios para el proyecto.

Este archivo es el contexto completo del proyecto; cualquier asistente (Claude, Gemini u otro) debe leerlo antes de continuar. Última actualización: **10 nov 2026** (auditoría y Fase 2, grupos A a H).

## Cómo trabajar con Kevin

- Responde en español, tratándolo de tú, con tono claro y profesional, sin relleno.
- Organiza en secciones con título y emoji; listas breves; ✅ ventajas, ⚠️ advertencias, 💡 recomendación cuando hay varias opciones.
- En conceptos nuevos, explica en 1-2 frases el porqué o la diferencia de fondo.
- Si hay varios caminos, muestra primero las opciones, recomienda una y **espera su elección** antes de dar pasos.
- Cuando él deba hacer pasos manuales (Cloudflare, Notion, Firebase), guíalo de **1 a 3 pasos por mensaje** y espera confirmación.
- Antes de tareas largas o de cambiar algo importante, pregunta. Si ya aprobó un plan, ejecútalo completo y publica.
- Nunca pidas ni guardes en el repo su PIN, claves de API ni la URL privada del calendario de Moodle. Los secrets los pega él en Cloudflare.

## Cómo retomar en una conversación nueva

1. Conectar el repo `Kevin-RamirezOrg/Bitacora` a la sesión con permiso de escritura (`add_repo`), clonarlo y leer este archivo.
2. Para ver su Notion directamente, usar el conector de Notion de Claude (Kevin ya lo conectó en claude.ai). La página raíz es **Universidad** (`405f97574a8a81c8af9ed12a540dc6ca`).
3. Lo que está en `main` queda publicado: la web en ellenkev.me (GitHub Pages) y el Worker en Cloudflare (Workers Builds) en 1-2 minutos.
4. Probar antes de publicar (ver "Cómo probar") y hacer commits en español.

## Estado actual

### Publicado y funcionando (probado por Kevin con datos reales)
- Notas (texto enriquecido, Markdown, código), carpetas, portapapeles, paletas Pizarra, Uva y Noche con modo claro/oscuro y acento personalizado.
- Asistente conectado a Notion: crear tareas, Deshacer, "¿qué tengo esta semana?", horario, varios chats, chat temporal, memoria.
- Panel con clases de hoy, carga de 14 días y repasos (Kevin marcó repasos con éxito).
- App instalable (PWA) y dictado por voz.

### Publicado pero aún sin probar por Kevin con datos reales
- Apuntes dictados a la página de Clases correcta, fichas de personas con apodo/cumpleaños/profesor por materia.
- Preguntas desde apuntes → Banco de preguntas, práctica con Dominio, resumen semanal → Resúmenes.
- Progreso en vivo (streaming), sugerencias según el momento, micrófono en el editor de notas.
- Acceso de lectura y escritura a todas las bases de Universidad.

### Auditoría del 10 nov (Fase 2, grupos A a H; publicado, falta que Kevin lo pruebe con datos reales)
- **A. Acceso**: correo de la cuenta cambiado al de Kevin y PIN más largo (lo cambió él en Cloud Shell); librerías en `lib/` en vez de CDN.
- **B. Arreglos**: Markdown en las respuestas de Kell, botón Detener, corte a los 2,5 min, confirmación al convertir notas, errores 400.
- **C. Kell entiende mejor**: las filas consultadas (`r…`) siguen disponibles en los turnos siguientes (`datos.filas`); `leerPagina` pagina y baja a sub-bloques; apuntes hasta 24.000 caracteres repartidos entre clases; si la validación falla por algo nuevo, se relee el esquema una vez.
- **D. Kell más rápido**: **modelo rápido** opcional (Modelos de IA) para clasificar y charlar; Notion se lee mientras se clasifica; temperatura ≤ 0,2 y modo JSON al planificar; un 429/503 se reintenta una vez; prompt con la parte fija primero (caché de prefijo); config de IA leída una vez por mensaje. 10 nov: Kevin probó un modelo rápido y lo de Notion tardaba más; **sin modelo rápido** (el principal decide en el paso previo) Kell responde casi al instante, así que lo dejó vacío. Se probó un interruptor para quitar el paso previo y se retiró por no hacer falta.
- **E. Sin conexión**: copia local de las notas (persistencia de Firestore) solo con "Recordar en este dispositivo", se borra al bloquear; el service worker guarda página, `lib/`, íconos y fuentes; highlight.js se carga al abrir código.
- **F. Chat y voz**: chat a pantalla completa, deslizar entre secciones, menos acciones bajo las respuestas, modo conversación nuevo, voz de Gemini en dos partes, paleta **Noche**.
- **G. Inicio y Panel**: Urgente compacto con casilla para marcar tareas (`POST /hoy/tarea`) y botón **Practicar** en Repasos.
- **H. Mantenimiento**: `asistente.js` dividido (`historial.js`, `prompt.js`, `util.js`), versión de esquema en D1, reintentos sin duplicar (`peticion`), aviso claro del límite de 50 subpeticiones.
- D7: `#screen` ya no es región viva; los avisos (`toast`, estados del chat y de la voz) llevan su propio `role="status"` o `aria-live`.
- No se hizo: D6 (respuesta que aparece palabra a palabra), O3 a O6 y C6 (dividir `index.html`; sigue como archivo único).

### Pendientes y decisiones abiertas
- Resuelto el 9 nov: el modelo principal ya funciona; el resumen semanal queda **solo a pedido** (sin Cron Trigger).
- Tanda 2 publicada el 9 nov (falta que Kevin la pruebe con datos reales): formatos interactivos, editar/regenerar/copiar/borrar mensajes y audio a nota. Kevin quiere mantener las respuestas **cortas**.
- 10 nov: el asistente se llama **Kell** (ícono de ocho pétalos en la barra inferior); modo voz con quiz oral; voz de Gemini sin instrucción leída; el ruido final venía de leer el WAV completo de Google como PCM (corregido con `vozPcm`).
- Tanda de voz publicada el 9 nov (Kevin la probó; pidió los arreglos del 10 nov): Ajustes → Voz, altavoz en cada respuesta y modo conversación. Idea futura: Gemini Live (`gemini-3.8-live`) si quiere interrumpir hablando; exigiría conectar las acciones de Notion como herramientas y un token efímero desde el Worker.
1. **Panel parte B** (próximo) (acordado, no hecho): asistente de cálculo de horas libres de una sola vez (horario de Notion + sueño, comidas, traslados, compromisos fijos) que deja horas por día editables a mano en Ajustes; barra de capacidad (plan vs. horas libres, marca en 70 %); plan del día con IA (máx. 3 prioridades, margen ×1,5 en tareas conocidas y ×2 en nuevas); anillo de prioridades hechas; cierre del día con tiempo real (D1); gráfico estimado vs. real. El horario de clases ya está en Notion (base Horario).
2. **Fase 4 – Moodle** (próximo): el aula virtual tiene "Exportar calendario". El Worker leería la URL iCal (como *secret*) una vez al día con Cron Trigger y crearía/actualizaría filas en Tareas y evaluaciones sin duplicar (usar el UID del evento).
3. **Ideas aplazadas**: próximos cumpleaños en el Panel; compartir texto desde otras apps (share_target); papelera de notas; preguntarle a Kell sobre la nota abierta; bandeja para Claude (tarea programada que procesa el Inbox); recordatorios por Telegram; resumen matutino; foto de apuntes a texto; búsqueda global.

## Arquitectura

### Web (`index.html`, archivo único: HTML + CSS + JS sin build)
- GitHub Pages desde `main`, raíz. Dominio **ellenkev.me** (`CNAME`). `_config.yml` excluye `CLAUDE.md`, `worker/`, `README.md`, `tests/` y `lib/LEEME.md`.
- Librerías **alojadas en `lib/`** con la versión en la URL (`?v=`): Firebase compat 10.12.2, marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 (esta se carga solo al abrir código). Para actualizar una: reemplazar el archivo, cambiar `?v=` en `index.html` y en `sw.js` (ver `lib/LEEME.md`). Fuentes: Lora (títulos), Figtree (texto), JetBrains Mono (código).
- **PWA**: `manifest.webmanifest` (standalone, colores Pizarra, accesos directos `?v=assistant` y `?v=panel`), íconos en `icons/` (192, 512, maskable, apple-touch, favicon; "B" con subrayado de tiza) y `sw.js` (caché `bitacora-v2`): la página va red primero y, sin red o tras 4 s, la última copia buena; `lib/`, íconos y fuentes se sirven de la copia guardada. Las notas sin conexión las maneja la persistencia de Firestore (solo con "Recordar en este dispositivo"; se borra al bloquear). Verificado sin errores con `Page.getInstallabilityErrors`.
- Dictado global (`DICT`): un solo dictado que sigue activo al navegar dentro de Bitácora hasta que Kevin toca el micrófono o **Detener**; escribe en el borrador del chat o en la nota donde empezó (si la nota está cerrada, agrega las frases al final cada ~4 s con `Store.patch`). Barra "Dictando en …" con Ir y Detener sobre la navegación (flotante en escritorio). En Android usa `continuous=false` y reinicia la sesión tras cada frase (en modo continuo Chrome repetía frases) y además descarta repeticiones. Se pausa si la página se oculta y sigue al volver; con la pantalla apagada no funciona (límite de Chrome).
- Navegación: barra inferior **Inicio · Archivos · Kell · Panel · Ajustes** (Kell es el botón central destacado, ícono `ICON.asistente`: ocho pétalos, `icono-petalos`); la barra lleva `position:relative; z-index:6` para que el círculo que sobresale quede por encima del contenido; en ≥900 px es riel lateral. `history.pushState` para que funcione el botón atrás de Android. **Deslizar a los lados** cambia de sección en ese orden (`TAB_ORDER`, `goTab`); no actúa en el editor, con una hoja abierta, sobre campos de texto ni sobre zonas con desplazamiento horizontal, y deja libres los 24 px de cada borde para el gesto atrás del sistema.
  - **Inicio**: Urgente (atrasado + 7 días, máx. 5; filas de dos líneas con el plazo a la derecha, toda la fila abre Notion y la casilla marca la tarea con `POST /hoy/tarea`; lo recién marcado sigue visible para desmarcarlo), Portapapeles, Carpetas, Recientes.
  - **Archivos**: carpetas y notas; botón **+** flotante abajo a la derecha (como Google Drive), crea dentro de la carpeta abierta.
  - **Kell** (vista `assistant`): chat a **pantalla completa** en el celular (clase `in-chat`: sin barra inferior, con flecha para volver; entra con `push` para que atrás regrese a la sección anterior). En ≥900 px el riel lateral sigue visible.
  - **Panel** (vista `panel`): Clases de hoy (en curso/siguiente resaltada), Carga de 14 días (grid de barras; peso Examen/Proyecto 3, Prueba 2, resto 1; día pesado ≥ 4 en `--danger`; resumen de los 2 días más cargados) y Repasos (botones de 44 px por sesión y **Practicar**, que abre Kell y envía "Practicar <materia>" con `kellSend`). Caché de 5 min y botón Actualizar (`/hoy?refrescar=1`).
  - **Ajustes**: sesión y modo de acceso, apariencia, Modelos de IA, Memoria del asistente, respaldo.
- Editor: pantalla completa, barra de formato abajo sobre el teclado. En texto enriquecido y Markdown, el primer botón es el **micrófono** (escribe donde está el cursor y muestra lo parcial en una franja).

### Firebase (proyecto `bitacora-c20b4`, plan Spark gratuito, sin tarjeta)
- Firestore `us-east1`: colección `items` (carpetas, notas, portapapeles) y documento `config/access` (modo de acceso).
- Authentication correo/contraseña. Un solo dueño: UID `mOlFltUhUNQrTTxtIWuCFJzMCFI3`, correo identificador `matiaschushig23@gmail.com` (cambiado como administrador vía `accounts:update`; el UID no cambió). La contraseña es el **PIN**; la app solo pide el PIN.
- La config web de Firebase está en `index.html` y es pública por diseño; la seguridad la dan las reglas.

Reglas publicadas:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function esDueno() { return request.auth != null && request.auth.uid == 'mOlFltUhUNQrTTxtIWuCFJzMCFI3'; }
    function modo() { return get(/databases/$(database)/documents/config/access).data.mode; }
    match /config/access { allow read: if true; allow write: if esDueno(); }
    match /items/{id} {
      allow read:  if esDueno() || modo() in ['read', 'open'];
      allow write: if esDueno() || modo() == 'open';
    }
  }
}
```
Modos: `private` (solo dueño), `read` (todos leen, editar exige PIN), `open` (todos leen y editan). Cambiar de modo exige el PIN. Si se agregan colecciones, actualizar las reglas y avisarle a Kevin para que las publique.

Modelo de datos (`items`):
- Carpeta: `{type:'folder', name, parent|null, color, created, updated}`
- Nota: `{type:'file', name, parent|null, format:'rich'|'md'|'code', lang?, content, created, updated}`; `rich` guarda HTML saneado con DOMPurify.
- Portapapeles: documento fijo `clipboard` → `{type:'clip', text, history:[{text, at}] (máx. 10), updated}`.
- `color` es `c0`…`c8` (tokens CSS por tema). Colores del editor como `var(--tc0..5)` y `var(--hc0..4)`.

### Worker de Cloudflare (`worker/`)
- URL `https://bitacora-worker.matiaschushig23.workers.dev`. Despliegue automático con **Workers Builds** al hacer push a `main` (raíz `/worker`, `npx wrangler deploy`). CORS solo para `https://ellenkev.me`.
- Todo lo que no sea `GET /salud` exige `Authorization: Bearer <ID token de Firebase>`, verificado con `jose` (RS256, JWKS de securetoken, issuer/audience, `auth_time`) y que `sub` sea el dueño (401/403).
- `wrangler.jsonc` vars públicas: `FIREBASE_PROJECT_ID`, `OWNER_UID`, `NOTION_DS_TAREAS`, `NOTION_DS_MATERIAS`, `NOTION_DS_PERSONAS`, `NOTION_DS_INBOX`, `NOTION_DS_HORARIO`, `NOTION_DS_SEMESTRES`, `NOTION_DS_CLASES`, `NOTION_DS_PREGUNTAS`, `NOTION_DS_RESUMENES`. KV `CONFIG` (id `51140c87073e441987819a061506828b`). D1 binding `DB` (base `bitacora-chat`, id `21ff5fbb-0a06-41c5-9f3c-2e1ee4c436bf`).
- Secrets (los puso Kevin; tipo *Secret*): `NANOGPT_API_KEY`, `GEMINI_API_KEY`, `NOTION_TOKEN` (conexión interna "Bitácora" de Notion, compartida **solo** con la página Universidad por decisión de Kevin).
- KV solo para datos que cambian poco (~1.000 escrituras/día gratis, hasta ~60 s de propagación): config de IA (`ia`), cachés `notion:materias` (6 h), `notion:horario:v2` (6 h, incluye `materiaId`), `notion:bases:v2` (6 h). Lo que cambia seguido va en D1.
- D1, tablas creadas solas: `mensajes` (con columna `chat`), `chats`, `memoria`, `valoraciones`, `repasos`, `peticiones` (reintentos sin duplicar; se limpian al día) y `esquema` (una fila con la versión). `db()` en `historial.js` hace **una sola consulta de versión** por arranque; al agregar tablas o columnas, subir `ESQUEMA` y añadir el cambio idempotente ahí.

Archivos (`worker/src/`):
- `index.js`: rutas y verificación de sesión. Si una petición supera las 50 subpeticiones del plan gratuito responde un mensaje claro y deja `LIMITE_SUBPETICIONES` en los registros.
- `util.js`: `normal`, `sinGuiones`, `esFecha`, `DIAS` y `extraerJSON` (JSON de la respuesta de un modelo).
- `ia.js`: proveedores `nanogpt` (`https://api.nano-gpt.com/api/v1`) y `gemini` (`https://generativelanguage.googleapis.com/v1beta/openai`), ambos compatibles con OpenAI. Config `{principal, respaldo|null, parametros:{temperature,top_p,max_tokens}, extra, favoritos:[{proveedor,modelo}] (máx. 20)}`; el campo libre no puede pisar `model`, `messages`, `stream`, `stream_options` ni `n`. Prueba el principal y, si falla, el respaldo (un 429/503 se reintenta una vez). `rapido:{proveedor,modelo}|null` es el modelo rápido opcional para clasificar y charlar. Gemini lista modelos retirados que dan 404 (p. ej. `gemini-2.5-flash`).
- `notion.js`: cliente Notion-Version `2026-03-11` (páginas con `parent:{type:'data_source_id'}`, papelera con `in_trash`, consultas con `POST /data_sources/{id}/query`), tareas, Inbox, personas, deshacer (`papelera`, `papeleras`, `propiedades`, `bloques`, `restaurar`), fecha y hora de Ecuador.
- `asistente.js`: validación y ejecución de acciones, `procesarMensaje`, deshacer, editar/regenerar/borrar. Reexporta `historial.js`.
- `historial.js`: D1 (`db`, historial, chats, memoria, valoraciones) y `ErrorAsistente`.
- `prompt.js`: `PROMPT_FIJO`, `prompt`, `promptClasificar`, `REGLAS_VOZ`.
- `horario.js`: base Horario del semestre con `Actual` en Semestres; parsea "14:00 – 16:00".
- `universidad.js`: descubre todas las bases (`POST /search` filtro `data_source`), esquema compacto, consultas, lectura de páginas y escrituras validadas por esquema.
- `clases.js`: apuntes dictados en la fila de Clases correcta.
- `estudio.js`: preguntas, práctica y resumen semanal.
- `hoy.js`: datos del Panel e Inicio, repasos y marcar tareas.
- `contenido.js`: validación de los formatos interactivos.
- `audio.js`: transcripción de audio con la Files API de Gemini.
- `voz.js`: voz natural con Gemini TTS.

Rutas privadas: `POST /voz/tts` (`{texto, voz}`), `POST /asistente/recortar`, `DELETE /asistente/mensaje?id=`, `POST /audio/transcribir` (cuerpo = audio), `GET /ia/proveedores`, `GET /ia/modelos?proveedor=`, `GET`/`PUT /config/ia`, `POST /ia/chat`, `GET /asistente/estado`, `GET /asistente/historial?chat=`, `GET`/`POST`/`PUT`/`DELETE /asistente/chats`, `POST /asistente/mensaje` (acepta `peticion`, un identificador por envío que la app repite en Reintentar: si ya se procesó, devuelve la misma respuesta con `repetida:true` sin volver a escribir en Notion), `POST /asistente/deshacer` (`{id}` o `{datos}` en chat temporal), `GET`/`POST`/`PUT`/`DELETE /asistente/memoria`, `POST /asistente/propuesta`, `POST /asistente/valorar`, `POST /estudio/dominio`, `GET /hoy`, `POST /hoy/repaso`, `POST /hoy/tarea` (`{tarea, completada}`).

## Asistente (chat → Notion)

**Formatos interactivos** (`worker/src/contenido.js`): acción `mostrar_contenido` con `formato` `opcion_multiple`, `verdadero_falso`, `completar`, `tarjetas`, `tabla` o `pasos` (máx. 10 elementos, uno por mensaje; no escribe en Notion). También puede venir en la respuesta de charla (`contenido`). La app los dibuja con `contentBlock`: opciones que marcan correcta/incorrecta con explicación, completar con comprobación sin tildes ni mayúsculas, tarjetas que se voltean, tabla con desplazamiento horizontal y pasos numerados; resultado "N de M" al terminar. Las respuestas quedan solo en la página.

**Editar, regenerar, copiar y borrar**: las acciones completas (Leer, Copiar, Regenerar, 👍/👎, Borrar) se ven solo bajo la **última** respuesta; en las anteriores aparecen al tocar el mensaje. Deshacer siempre queda visible junto a lo guardado. El nombre del modelo solo se muestra si respondió el respaldo o cambió respecto del mensaje anterior. Las respuestas dibujan su Markdown (saneado con DOMPurify); al tocar un mensaje propio, Copiar, Editar y Borrar. Regenerar/editar llaman a `POST /asistente/recortar` (primero con `simular:true` para pedir confirmación si hay cambios en Notion o mensajes posteriores) que **deshace en Notion** lo creado desde ese turno, borra esos mensajes y luego se reenvía el texto. Borrar (`DELETE /asistente/mensaje?id=`) quita la pregunta y su respuesta del historial, pero no toca Notion. En chat temporal se hace lo mismo en la página con `/asistente/deshacer {datos}`.

**Audio a nota** (`worker/src/audio.js`, `POST /audio/transcribir`): desde el **+** de Archivos → "Transcribir un audio a nota". La app sube el archivo (máx. 95 MB por el límite de 100 MB del Worker gratuito) con XHR para mostrar el porcentaje y pide `navigator.wakeLock` para que no se apague la pantalla. El Worker lo reenvía sin copiarlo en memoria (`FixedLengthStream`) a la Files API de Gemini, espera a que quede `ACTIVE`, transcribe con el primer modelo Gemini de la configuración (o `gemini-3.5-flash-lite`) en párrafos con marcas `[mm:ss]` y borra el archivo de Google. Responde en NDJSON. La nota se crea como texto enriquecido "Transcripción · nombre" en la carpeta elegida; si el texto se corta (`MAX_TOKENS`) lo avisa al final.

**Voz** (9 nov):
- Ajustes → **Voz** (`vozSheet`, `localStorage` `bitacora.voz` = `{motor:'sistema'|'gemini', sysVoice, rate, pitch, gem}`): voz del sistema (`speechSynthesis`, voces `es-*` que exponga Chrome; más voces se instalan en Android → Accesibilidad → Texto a voz) o Gemini (30 voces predefinidas, por defecto Kore), velocidad, tono (solo sistema) y Probar. Si Gemini falla o se queda sin cuota (429), usa la del sistema y avisa una vez.
- `POST /voz/tts` (`worker/src/voz.js`) envía **solo el texto** (una instrucción de estilo delante a veces se leía en voz alta); prueba `gemini-3.8-flash-lite-tts`, luego `gemini-3.8-flash-tts` y `gemini-2.5-flash-preview-tts` si da 404, y devuelve la respuesta de Google **sin procesar** (PCM 16 bits 24 kHz en base64) para no gastar CPU del Worker; la app primero extrae el audio con `vozPcm` (a veces Google manda un **WAV completo** con cabecera y un bloque de metadatos al final; leerlo como PCM puro producía el "psss" saturado al final, confirmado el 10 nov con una grabación de Kevin), luego limpia el final (`pcmClean`: en los últimos 1,5 s recorta lo que sigue al último tramo con voz —fuerte y con pocos cruces por cero— más 150 ms, y desvanece 40 ms para quitar el chasquido), arma el WAV (`pcmToWav`) y guarda hasta 20 audios en caché. Un texto de 240 caracteres o más se pide en **dos partes** (`vozPartes`: la primera oración y el resto) para que empiece a sonar antes; solo dos peticiones por la cuota gratuita, y si la segunda falla sigue la voz del sistema.
- Iluminado palabra a palabra (`vozSpeak`, `vozWordsEl`, `vozMark`): con la voz del sistema usa los eventos de palabra (`onboundary`) y, si no llegan, estima por tiempo; con Gemini sigue el avance del audio. El sistema lee por oraciones (Chrome corta textos largos).
- Botón de altavoz bajo cada respuesta del chat (Leer / Detener).
- **Modo conversación** (`convOpen`, botón con ondas junto al micrófono del chat): pantalla completa **siempre oscura** (casi negra, con cualquier tema): símbolo de Kell y "Hablemos, Kevin" al centro, un brillo del color de acento en el borde inferior que respira al escuchar y late al hablar, y tres botones circulares sin texto (micrófono, enviar/interrumpir, terminar). Lo que dices y la respuesta iluminándose se ven solo con el botón **Subtítulos** (`bitacora.convSubs`); lo guardado en Notion y los errores se muestran siempre. Envía solo tras **1,5 s de silencio** (decisión A de Kevin); el micrófono se **pausa mientras habla**; se interrumpe tocando la pantalla o el botón central; botón **Silenciar** (como Gemini Live) y **Terminar**; el botón atrás de Android también la cierra. Usa el mismo `chatSend` con `voz:true`, así que todo queda en el chat y en Notion; si hubo cambios muestra "N cambios guardados en Notion". Mantiene la pantalla encendida con `wakeLock`.

**Modo voz en el Worker** (10 nov, `voz:true` en `/asistente/mensaje`): `REGLAS_VOZ` va en los dos prompts. Kell no usa `mostrar_contenido`, escribe la respuesta para decirse en voz alta y resume en ella las tareas u horario. **Quiz oral** (decisión A de Kevin: acepta respuestas aproximadas o con sus palabras): una pregunta por turno, dice si acertó y por qué, sigue con la siguiente y al final da el resultado. **Práctica del Banco por voz**: `practicar` → el Worker dice la primera pregunta; las tarjetas se arrastran en `datos.practica` `{materia, tarjetas:[{id,pregunta,respuesta}], hechas}` hasta terminar (mientras haya práctica en curso no se usa el clasificador). El prompt las lista como `p1…` y el modelo usa `marcar_dominio` (`{tarjeta:'p1', dominio}`) para actualizar Dominio y Último repaso en Notion.

**Clasificación primero** (9 nov): una llamada corta decide si el mensaje es `charla` (lo responde ahí mismo, breve, sin leer Notion ni enviar sus datos; `datos.charla`) o `notion` (flujo completo). Ante la duda o JSON inválido, va por Notion. "Resume / dame un resumen" de algo ya mostrado usa `leer_pagina` con la clave `r…`, no `resumen_semanal`.

Decisiones de Kevin: **guardar directo** con **Deshacer** por mensaje; historial en D1; el modelo devuelve **JSON** `{respuesta, acciones}` que el Worker valida y ejecuta (funciona con cualquier modelo; si el JSON viene mal, se pide una vez más). Máximo 5 acciones por mensaje.

El prompt incluye: fecha y hora de Ecuador, calendario de −3 a +35 días, memoria (`k1…`), resumen de valoraciones, horario semanal (`c1…`), todas las bases con su esquema (`b1…`), materias (`m1…`) y tareas pendientes (`t1…`, única fuente de verdad: lo deshecho se marca `[DESHECHO]` en el historial).

Acciones:
- Tareas: `crear_tarea`, `completar_tarea`, `mostrar_tareas` (toda pregunta de fechas se responde con esta acción, nunca de memoria).
- `nota_inbox` para lo informativo o complejo.
- `guardar_persona`: `nombre`, `apodo`, `profesor_de` (busca Rol Profesor + materia), `rol`, `correo`, `telefono`, `grupo`, `cumpleanos` ("MM-DD" → próxima ocurrencia), `notas` (se anteponen con la fecha "9 nov: …"). Busca por nombre, luego apodo, luego profesor de la materia; si no la encuentra y no hay nombre, pide el nombre. Personas tiene columnas **Apodo** y **Cumpleaños** (agregadas el 9 nov).
- `apunte_clase` (opción A de Kevin: texto fiel, solo ordenado en viñetas, sin agregar explicaciones; *Estado* queda vacío para su flujo de mejora con Claude): materia explícita o, si dice "la clase", la clase en curso o la última que terminó hoy (hasta 3 h); si no se sabe, pregunta. Busca la fila de Clases por materia y fecha o la crea con título `S{semana}-C{número} · tema` (Semana desde `Inicio` del semestre, lunes a domingo; Número por el orden de las sesiones de la materia en el horario), Materia y Semestre. Agrega al final del cuerpo "Apuntes dictados · fecha, hora" y una viñeta por idea. Deshacer borra solo esos bloques.
- Bases generales (Kevin eligió leer **y escribir** en cualquier base): `consultar_base` (búsqueda en título + filtros simples; `mostrar` para listar), `leer_pagina` (cuerpo, máx. 6000 caracteres), `crear_fila`, `editar_fila`, `archivar_fila`. Validadas contra el esquema (opciones existentes, fechas, correos, relaciones por clave `m/r/c/t` o nombre exacto). Lecturas en hasta dos rondas: el Worker ejecuta, devuelve filas `r1…` al modelo y pide la respuesta final.
- Estudio (una por mensaje): `preguntas_estudio` (lee los apuntes de Clases de la semana actual o la anterior, genera N preguntas con respuesta solo desde esos apuntes, evita repetidas y las crea en Banco de preguntas con Dominio "No la sé"), `practicar` (elige primero No la sé/Más o menos y el repaso más antiguo; tarjetas con Ver respuesta y No la sé/Más o menos/La sé → actualiza Dominio y Último repaso) y `resumen_semanal` (fila "Materia · Semana N", Tipo Semanal, Semanas "N", secciones fieles a los apuntes; si existe, enlaza la existente).
- `marcar_dominio` (solo con práctica del Banco en curso, sobre todo en voz).
- Memoria: `recordar` (solo si Kevin lo pide), `olvidar`, `proponer_recuerdo` (tarjeta Recordar/No; nunca sobre salud, dinero, familia u otros temas delicados). Máx. 60 recuerdos; se gestionan en Ajustes → Memoria del asistente.

Interfaz del chat:
- Cabecera: título del chat, botones **Chats** (lista, renombrar, borrar), **Nuevo chat** y menú ⋯ (Chat temporal, Memoria, Modelos de IA). Los chats se crean con el primer mensaje y toman su título; lo anterior quedó en "Conversación anterior".
- **Chat temporal**: no se guarda en D1; vive en la memoria de la página y se borra al salir del modo, recargar o bloquear. Lo guardado en Notion sí queda.
- Caja de escribir estilo Gemini/Claude: selector de modelo (principal o favoritos; elección en `localStorage` `bitacora.chatModelo`), micrófono (Web Speech API `es-EC`, oculto si no hay soporte) y enviar.
- **Progreso en vivo**: con `Accept: application/x-ndjson` el Worker envía `{etapa}` ("Leyendo tu Notion…", "Consultando Clases…", "Guardando en Notion…") y al final `{fin}` o `{error}`.
- Sin sugerencias ni texto de introducción (Kevin los quitó el 9 nov); el chat vacío solo muestra "Prueba con" y ejemplos.
- 👍/👎 por respuesta (👎 pide motivo); resultados con "Abrir" en Notion, semáforo de días, Deshacer y aviso si algo falló.

## Notion de Kevin (página Universidad)

Reutilizar estas bases, no duplicarlas (IDs de *data source*):

| Base | Propiedades principales | Data source |
|---|---|---|
| Tareas y evaluaciones | Tarea (título), Tipo (Tarea, Prueba, Examen, Proyecto, Lectura, Institucional), Entrega, Materia, Completada, Grupal, Clase | `9d29b687-0cb9-460d-a9d6-6bb20708f43d` |
| Materias | Materia (título), Código, Profesor… | `3e437374-bea5-4ea9-9f90-6b94515982d8` |
| Personas | Nombre, Rol (Compañero, Profesor, Tutor, Ayudante), Apodo, Cumpleaños, Grupo, Correo, Teléfono, Notas, Materias | `a2fc3865-10e3-4ec2-9164-e9993939579b` |
| Inbox | Nota (título), Procesada, Materia | `10c76b66-23ce-4659-bd33-fabedf8b64c3` |
| Horario | Bloque (título), Día (Lunes–Viernes), Hora ("14:00 – 16:00"), Aula, Materia, Semestre | `40da13d3-6727-4155-a8e7-589a135ea18b` |
| Semestres | Periodo, Actual, Inicio, Fin, Nivel, Promedio objetivo | `71ec6804-f0c9-4431-819f-869e67f15c7a` |
| Clases | Clase (título "S3-C1 · Tema"), Fecha, Materia, Semana (Semana 1…16), Número (Clase 1, Clase 2), Semestre, Estado (Foto subida, Mejorada), Tareas | `c9d0514a-fd5d-4242-b227-422d045edd6d` |
| Banco de preguntas | Pregunta, Respuesta, Materia, Dominio (No la sé, Más o menos, La sé), Último repaso, Resumen | `352cec6e-c767-44d9-84ec-36c86121e6e5` |
| Resúmenes | Resumen (título), Materia, Semanas (texto), Tipo (Semanal, Síntesis 3 semanas), Fecha, Repasado, Preguntas | `f9a7bb8a-1f7e-45c4-8fd3-e2a3b830e643` |
| Recursos, Metas | (no usadas aún por código específico; accesibles por las acciones generales) | — |

Semestre actual: 2026-B, del 28 sep 2026 al 28 ene 2027 (el 9 nov es la Semana 7).

## Diseño (no romper)

- **Móvil primero**; opciones y formularios en **hojas inferiores**; botones táctiles de al menos 44 px.
- Paletas *Pizarra* (verde, por defecto), *Uva* (morado) y *Noche* (casi negra y neutra, acento azul), cada una con oscuro y claro, más acento personalizado que se ajusta para mantener contraste. Todo color como token CSS en `:root`. El modo siempre llega resuelto en `data-theme` (un script en el `<head>` lo fija antes del primer pintado), así cada paleta tiene un solo bloque oscuro y uno claro.
- **Contraste obligatorio** (pedido de Kevin): texto ≥ 4,5:1 y bordes/íconos de controles ≥ 3:1 (WCAG AA) en todos los temas. Botones siempre con relleno o borde visible.
- Sin "decoración de plantilla": nada de mayúsculas sostenidas, numeraciones falsas ni flechas en botones.

## Cómo probar

El entorno de Claude no llega a Firebase, a los CDN ni al Worker real.
- **Web**: Playwright con `file://…/index.html` interceptando peticiones (en Playwright la última ruta registrada tiene prioridad: registrar primero las genéricas). Stub de `firebase` con datos de ejemplo en lugar de `firebase-app-compat.js`, stubs mínimos de DOMPurify/marked/hljs, y respuestas simuladas para `*.workers.dev` (incluida la respuesta NDJSON de `/asistente/mensaje`). Capturas en 390×844 y 1280×820, Pizarra y Uva, oscuro y claro. Chrome headless tiene `SpeechRecognition` real: para probar el dictado hay que reemplazar `SpeechRecognition` y `webkitSpeechRecognition`. Para la voz, reemplazar `speechSynthesis` y `SpeechSynthesisUtterance` con uno falso que emita `onboundary` por palabra, y lanzar Chromium con `--autoplay-policy=no-user-gesture-required`.
- **Instalación PWA**: servir el repo con `python3 -m http.server` y revisar `Page.getInstallabilityErrors` por CDP.
- **Worker**: importar los módulos en Node con `fetch` simulado (Notion y modelo) y D1 simulado sobre `node:sqlite` (Node 22). Revisar el contraste de tokens nuevos con un script antes de publicar.
- **Las pruebas están en `tests/`** (no se publican en Pages):
  - `python3 tests/web_checks.py [nombre…]`: comprobaciones de la web con Firebase, librerías y Worker simulados (`tests/web.py` es el arnés; `python3 tests/web.py home chat …` genera capturas en `tests/capturas/`).
  - `python3 tests/contraste.py`: contraste WCAG de cada paleta y modo. Correrlo al tocar tokens.
  - `node --test tests/worker.test.mjs`: Worker con Notion, modelo, D1 (`node:sqlite`) y KV simulados (`tests/worker-fakes.mjs`).
  - `cd worker && npx wrangler deploy --dry-run`: confirma que el Worker empaqueta.
  - Correr todo antes de cada push y agregar una prueba por cada arreglo.

## Convenciones

- Commits en español, descriptivos.
- Mantener `index.html` como archivo único mientras sea manejable; el Worker va aparte en `worker/`.
- Probar en celular y PC, oscuro y claro, antes de hacer push a `main`.
