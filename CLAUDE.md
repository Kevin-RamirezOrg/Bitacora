# Bitácora — contexto del proyecto

Web personal de notas y organización de estudio de Kevin, estudiante universitario en Ecuador (EPN, FIS). La usa sobre todo desde el celular (Chrome en Android, ahora instalable como app) y a veces desde PC ajenas de la universidad, en incógnito.

> Este repositorio es público: no agregues aquí secretos, claves ni datos personales que no sean necesarios para el proyecto.

Este archivo es el contexto completo del proyecto; cualquier asistente (Claude, Gemini u otro) debe leerlo antes de continuar. Última actualización: **9 nov 2026**.

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
- Notas (texto enriquecido, Markdown, código), carpetas, portapapeles, paletas Pizarra/Uva con modo claro/oscuro y acento personalizado.
- Asistente conectado a Notion: crear tareas, Deshacer, "¿qué tengo esta semana?", horario, varios chats, chat temporal, memoria.
- Panel con clases de hoy, carga de 14 días y repasos (Kevin marcó repasos con éxito).
- App instalable (PWA) y dictado por voz.

### Publicado pero aún sin probar por Kevin con datos reales
- Apuntes dictados a la página de Clases correcta, fichas de personas con apodo/cumpleaños/profesor por materia.
- Preguntas desde apuntes → Banco de preguntas, práctica con Dominio, resumen semanal → Resúmenes.
- Progreso en vivo (streaming), sugerencias según el momento, micrófono en el editor de notas.
- Acceso de lectura y escritura a todas las bases de Universidad.

### Pendientes y decisiones abiertas
1. **Kevin**: cambiar el modelo principal en Ajustes → Modelos de IA (el actual falla y responde el respaldo `gemini-3.5-flash-lite`). Conviene un principal de NanoGPT por privacidad: con Gemini gratis, horario, apuntes y datos de personas pasan por Google.
2. **Pregunta abierta**: ¿generar el resumen semanal automáticamente cada domingo (Cron Trigger) o solo a pedido? Hoy es solo a pedido.
3. **Panel parte B** (acordado, no hecho): asistente de cálculo de horas libres de una sola vez (horario de Notion + sueño, comidas, traslados, compromisos fijos) que deja horas por día editables a mano en Ajustes; barra de capacidad (plan vs. horas libres, marca en 70 %); plan del día con IA (máx. 3 prioridades, margen ×1,5 en tareas conocidas y ×2 en nuevas); anillo de prioridades hechas; cierre del día con tiempo real (D1); gráfico estimado vs. real. El horario de clases ya está en Notion (base Horario).
4. **Fase 4 – Moodle**: el aula virtual tiene "Exportar calendario". El Worker leería la URL iCal (como *secret*) una vez al día con Cron Trigger y crearía/actualizaría filas en Tareas y evaluaciones sin duplicar (usar el UID del evento).
5. **Ideas aplazadas**: marcar tareas como hechas desde el Panel; próximos cumpleaños en el Panel; "Practicar" desde las sesiones de Repasos; bandeja para Claude (tarea programada que procesa el Inbox); recordatorios por Telegram; resumen matutino; foto de apuntes a texto; búsqueda global.

## Arquitectura

### Web (`index.html`, archivo único: HTML + CSS + JS sin build)
- GitHub Pages desde `main`, raíz. Dominio **ellenkev.me** (`CNAME`). `_config.yml` excluye `CLAUDE.md`, `worker/` y `README.md`.
- Librerías por CDN: Firebase compat 10.12.2 (gstatic), marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 (cdnjs). Fuentes: Lora (títulos), Figtree (texto), JetBrains Mono (código).
- **PWA**: `manifest.webmanifest` (standalone, colores Pizarra, accesos directos `?v=assistant` y `?v=panel`), íconos en `icons/` (192, 512, maskable, apple-touch, favicon; "B" con subrayado de tiza) y `sw.js` mínimo: red primero para la página y, sin conexión, la última copia; no cachea nada más. Verificado sin errores con `Page.getInstallabilityErrors`.
- Navegación: barra inferior **Inicio · Archivos · Asistente (botón central destacado) · Panel · Ajustes**; en ≥900 px es riel lateral. `history.pushState` para que funcione el botón atrás de Android.
  - **Inicio**: Urgente (atrasado + 7 días, máx. 5), Portapapeles, Carpetas, Recientes.
  - **Archivos**: carpetas y notas; botón **+** flotante abajo a la derecha (como Google Drive), crea dentro de la carpeta abierta.
  - **Asistente**: chat (ver más abajo).
  - **Panel** (vista `panel`): Clases de hoy (en curso/siguiente resaltada), Carga de 14 días (grid de barras; peso Examen/Proyecto 3, Prueba 2, resto 1; día pesado ≥ 4 en `--danger`; resumen de los 2 días más cargados) y Repasos (botones de 44 px por sesión). Caché de 5 min y botón Actualizar (`/hoy?refrescar=1`).
  - **Ajustes**: sesión y modo de acceso, apariencia, Modelos de IA, Memoria del asistente, respaldo.
- Editor: pantalla completa, barra de formato abajo sobre el teclado. En texto enriquecido y Markdown, el primer botón es el **micrófono** (escribe donde está el cursor y muestra lo parcial en una franja).

### Firebase (proyecto `bitacora-c20b4`, plan Spark gratuito, sin tarjeta)
- Firestore `us-east1`: colección `items` (carpetas, notas, portapapeles) y documento `config/access` (modo de acceso).
- Authentication correo/contraseña. Un solo dueño: UID `mOlFltUhUNQrTTxtIWuCFJzMCFI3`, correo identificador `matias@gmail.com`. La contraseña es el **PIN**; la app solo pide el PIN.
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
- D1, tablas creadas solas: `mensajes` (con columna `chat`), `chats`, `memoria`, `valoraciones`, `repasos`.

Archivos (`worker/src/`):
- `index.js`: rutas y verificación de sesión.
- `ia.js`: proveedores `nanogpt` (`https://api.nano-gpt.com/api/v1`) y `gemini` (`https://generativelanguage.googleapis.com/v1beta/openai`), ambos compatibles con OpenAI. Config `{principal, respaldo|null, parametros:{temperature,top_p,max_tokens}, extra, favoritos:[{proveedor,modelo}] (máx. 20)}`; el campo libre no puede pisar `model`, `messages`, `stream`, `stream_options` ni `n`. Prueba el principal y, si falla, el respaldo. Gemini lista modelos retirados que dan 404 (p. ej. `gemini-2.5-flash`).
- `notion.js`: cliente Notion-Version `2026-03-11` (páginas con `parent:{type:'data_source_id'}`, papelera con `in_trash`, consultas con `POST /data_sources/{id}/query`), tareas, Inbox, personas, deshacer (`papelera`, `papeleras`, `propiedades`, `bloques`, `restaurar`), fecha y hora de Ecuador.
- `asistente.js`: prompt, validación y ejecución de acciones, historial, chats, memoria, valoraciones, deshacer.
- `horario.js`: base Horario del semestre con `Actual` en Semestres; parsea "14:00 – 16:00".
- `universidad.js`: descubre todas las bases (`POST /search` filtro `data_source`), esquema compacto, consultas, lectura de páginas y escrituras validadas por esquema.
- `clases.js`: apuntes dictados en la fila de Clases correcta.
- `estudio.js`: preguntas, práctica y resumen semanal.
- `hoy.js`: datos del Panel e Inicio y repasos.

Rutas privadas: `GET /yo`, `GET /ia/proveedores`, `GET /ia/modelos?proveedor=`, `GET`/`PUT /config/ia`, `POST /ia/chat`, `GET /asistente/estado`, `GET`/`DELETE /asistente/historial?chat=`, `GET`/`POST`/`PUT`/`DELETE /asistente/chats`, `POST /asistente/mensaje`, `POST /asistente/deshacer` (`{id}` o `{datos}` en chat temporal), `GET`/`POST`/`PUT`/`DELETE /asistente/memoria`, `POST /asistente/propuesta`, `POST /asistente/valorar`, `POST /estudio/dominio`, `GET /hoy`, `POST /hoy/repaso`.

## Asistente (chat → Notion)

Decisiones de Kevin: **guardar directo** con **Deshacer** por mensaje; historial en D1; el modelo devuelve **JSON** `{respuesta, acciones}` que el Worker valida y ejecuta (funciona con cualquier modelo; si el JSON viene mal, se pide una vez más). Máximo 5 acciones por mensaje.

El prompt incluye: fecha y hora de Ecuador, calendario de −3 a +35 días, memoria (`k1…`), resumen de valoraciones, horario semanal (`c1…`), todas las bases con su esquema (`b1…`), materias (`m1…`) y tareas pendientes (`t1…`, única fuente de verdad: lo deshecho se marca `[DESHECHO]` en el historial).

Acciones:
- Tareas: `crear_tarea`, `completar_tarea`, `mostrar_tareas` (toda pregunta de fechas se responde con esta acción, nunca de memoria).
- `nota_inbox` para lo informativo o complejo.
- `guardar_persona`: `nombre`, `apodo`, `profesor_de` (busca Rol Profesor + materia), `rol`, `correo`, `telefono`, `grupo`, `cumpleanos` ("MM-DD" → próxima ocurrencia), `notas` (se anteponen con la fecha "9 nov: …"). Busca por nombre, luego apodo, luego profesor de la materia; si no la encuentra y no hay nombre, pide el nombre. Personas tiene columnas **Apodo** y **Cumpleaños** (agregadas el 9 nov).
- `apunte_clase` (opción A de Kevin: texto fiel, solo ordenado en viñetas, sin agregar explicaciones; *Estado* queda vacío para su flujo de mejora con Claude): materia explícita o, si dice "la clase", la clase en curso o la última que terminó hoy (hasta 3 h); si no se sabe, pregunta. Busca la fila de Clases por materia y fecha o la crea con título `S{semana}-C{número} · tema` (Semana desde `Inicio` del semestre, lunes a domingo; Número por el orden de las sesiones de la materia en el horario), Materia y Semestre. Agrega al final del cuerpo "Apuntes dictados · fecha, hora" y una viñeta por idea. Deshacer borra solo esos bloques.
- Bases generales (Kevin eligió leer **y escribir** en cualquier base): `consultar_base` (búsqueda en título + filtros simples; `mostrar` para listar), `leer_pagina` (cuerpo, máx. 6000 caracteres), `crear_fila`, `editar_fila`, `archivar_fila`. Validadas contra el esquema (opciones existentes, fechas, correos, relaciones por clave `m/r/c/t` o nombre exacto). Lecturas en hasta dos rondas: el Worker ejecuta, devuelve filas `r1…` al modelo y pide la respuesta final.
- Estudio (una por mensaje): `preguntas_estudio` (lee los apuntes de Clases de la semana actual o la anterior, genera N preguntas con respuesta solo desde esos apuntes, evita repetidas y las crea en Banco de preguntas con Dominio "No la sé"), `practicar` (elige primero No la sé/Más o menos y el repaso más antiguo; tarjetas con Ver respuesta y No la sé/Más o menos/La sé → actualiza Dominio y Último repaso) y `resumen_semanal` (fila "Materia · Semana N", Tipo Semanal, Semanas "N", secciones fieles a los apuntes; si existe, enlaza la existente).
- Memoria: `recordar` (solo si Kevin lo pide), `olvidar`, `proponer_recuerdo` (tarjeta Recordar/No; nunca sobre salud, dinero, familia u otros temas delicados). Máx. 60 recuerdos; se gestionan en Ajustes → Memoria del asistente.

Interfaz del chat:
- Cabecera: título del chat, botones **Chats** (lista, renombrar, borrar), **Nuevo chat** y menú ⋯ (Chat temporal, Memoria, Modelos de IA). Los chats se crean con el primer mensaje y toman su título; lo anterior quedó en "Conversación anterior".
- **Chat temporal**: no se guarda en D1; vive en la memoria de la página y se borra al salir del modo, recargar o bloquear. Lo guardado en Notion sí queda.
- Caja de escribir estilo Gemini/Claude: selector de modelo (principal o favoritos; elección en `localStorage` `bitacora.chatModelo`), micrófono (Web Speech API `es-EC`, oculto si no hay soporte) y enviar.
- **Progreso en vivo**: con `Accept: application/x-ndjson` el Worker envía `{etapa}` ("Leyendo tu Notion…", "Consultando Clases…", "Guardando en Notion…") y al final `{fin}` o `{error}`.
- **Sugerencias según el momento** (máx. 3, se ocultan al escribir): apuntes de la clase en curso o reciente, practicar si hay prueba/examen en ≤5 días, "¿Qué tengo mañana?" desde las 18 h o "¿Qué clase me toca?", "Resumir la semana" de viernes a domingo.
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
- Paletas *Pizarra* (verde, por defecto) y *Uva* (morado), cada una con oscuro y claro, más acento personalizado que se ajusta para mantener contraste. Todo color como token CSS en `:root`.
- **Contraste obligatorio** (pedido de Kevin): texto ≥ 4,5:1 y bordes/íconos de controles ≥ 3:1 (WCAG AA) en todos los temas. Botones siempre con relleno o borde visible.
- Sin "decoración de plantilla": nada de mayúsculas sostenidas, numeraciones falsas ni flechas en botones.

## Cómo probar

El entorno de Claude no llega a Firebase, a los CDN ni al Worker real.
- **Web**: Playwright con `file://…/index.html` interceptando peticiones (en Playwright la última ruta registrada tiene prioridad: registrar primero las genéricas). Stub de `firebase` con datos de ejemplo en lugar de `firebase-app-compat.js`, stubs mínimos de DOMPurify/marked/hljs, y respuestas simuladas para `*.workers.dev` (incluida la respuesta NDJSON de `/asistente/mensaje`). Capturas en 390×844 y 1280×820, Pizarra y Uva, oscuro y claro. Chrome headless tiene `SpeechRecognition` real: para probar el dictado hay que reemplazar `SpeechRecognition` y `webkitSpeechRecognition`.
- **Instalación PWA**: servir el repo con `python3 -m http.server` y revisar `Page.getInstallabilityErrors` por CDP.
- **Worker**: importar los módulos en Node con `fetch` simulado (Notion y modelo) y D1 simulado sobre `node:sqlite` (Node 22). Revisar el contraste de tokens nuevos con un script antes de publicar.
- Los scripts de prueba no están en el repo; se rehacen en el scratchpad de cada sesión.

## Convenciones

- Commits en español, descriptivos.
- Mantener `index.html` como archivo único mientras sea manejable; el Worker va aparte en `worker/`.
- Probar en celular y PC, oscuro y claro, antes de hacer push a `main`.
