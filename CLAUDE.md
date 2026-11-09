# Bitácora — contexto del proyecto

Web personal de notas y organización de estudio de Kevin, estudiante universitario. Se usa sobre todo desde el celular (Chrome en Android) y a veces desde PC ajenas de la universidad, en incógnito.

> Este repositorio es público: no agregues aquí secretos, claves ni datos personales que no sean necesarios para el proyecto.

## Estado actual y siguientes pasos (8 nov 2026)

Este archivo es el contexto completo del proyecto; cualquier asistente (Claude, Gemini u otro) debe leerlo antes de continuar.

- **Publicado y probado**: Worker con verificación de sesión, proveedores de IA (NanoGPT y Gemini), panel Ajustes → Modelos de IA con favoritos, y el código completo del chat del Asistente (Worker y web).
- **Falta para activar el chat** (en este orden):
  1. Kevin crea la conexión interna **Bitácora** en `https://app.notion.com/developers/connections` (Build → Internal connections → Create a new connection), la conecta a la página **Universidad** (••• → Connections → + Add connection) y guarda su **API token** en Cloudflare como secret `NOTION_TOKEN` (bitacora-worker → Settings → Variables and Secrets, tipo *Secret*).
  2. Kevin crea la base D1 `bitacora-chat` (Cloudflare → Storage & databases → D1 SQL Database → Create) y comparte el **Database ID** (no es secreto).
  3. Agregar en `worker/wrangler.jsonc`: `"d1_databases": [{ "binding": "DB", "database_name": "bitacora-chat", "database_id": "<ID>" }]` y hacer push a `main`. La tabla `mensajes` se crea sola en la primera petición.
  4. Probar desde la pestaña Asistente: "prueba de big data el martes 2", revisar la fila en Notion, probar **Deshacer** y "¿qué tengo esta semana?".
- **Después**: fase 4 (sincronización con Moodle por iCal).
- Los scripts de prueba (Playwright y simulaciones del Worker) no están en el repo; la forma de probar está en "Cómo probar".

## Cómo trabajar con Kevin

- Responde en español, tratándolo de tú, con tono claro y profesional.
- Si hay varios caminos, muestra primero las opciones con ventajas (✅) y advertencias (⚠️), recomienda una (💡) y espera su elección.
- Cuando él deba hacer pasos manuales, guíalo de 1 a 3 pasos por mensaje y espera confirmación.
- Antes de tareas largas o de cambiar algo importante, pregunta.
- Nunca pidas ni guardes en el repo su PIN, claves de API ni la URL privada del calendario de Moodle.

## Arquitectura actual

- **Un solo archivo**: `index.html` (HTML + CSS + JS sin build). Publicado con **GitHub Pages** desde `main`, raíz. Dominio propio **ellenkev.me** (archivo `CNAME`). Repo: `Kevin-RamirezOrg/Bitacora`.
- **Firebase** (proyecto `bitacora-c20b4`, plan Spark gratuito, sin tarjeta):
  - Firestore, región `us-east1`. Colección `items` (carpetas, notas y portapapeles) y documento `config/access` (modo de acceso).
  - Authentication con correo/contraseña. Un solo usuario dueño: UID `mOlFltUhUNQrTTxtIWuCFJzMCFI3`, correo identificador `matias@gmail.com`. La contraseña es el **PIN**; la app solo pide el PIN.
  - La config web de Firebase está en `index.html` y es pública por diseño; la seguridad la dan las reglas.
- Librerías por CDN: Firebase compat 10.12.2 (gstatic), marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 (cdnjs). Fuentes: Lora (títulos), Figtree (texto), JetBrains Mono (código).

### Worker de Cloudflare (fase 2, en curso)

- URL: `https://bitacora-worker.matiaschushig23.workers.dev`. Despliegue automático con **Workers Builds** al hacer push a `main` (raíz `/worker`, deploy `npx wrangler deploy`, token de build `bitacora-worker-build`; las vistas previas por rama están activas).
- Archivos: `worker/wrangler.jsonc` (nombre `bitacora-worker`, vars públicas `FIREBASE_PROJECT_ID` y `OWNER_UID`), `worker/package.json` (dependencia `jose` ^6), `worker/src/index.js`.
- CORS solo para `https://ellenkev.me`.
- KV `CONFIG` (id `51140c87073e441987819a061506828b`, nombre `bitacora-config`): solo datos que cambian poco (config de IA en la clave `ia`, precálculos diarios). Límite gratis ~1.000 escrituras/día y hasta ~60 s de propagación. Si un dato va a cambiar muchas veces al día, avisar a Kevin y usar otro almacén (por ejemplo, D1).
- Secrets en Cloudflare (tipo *Secret*, los puso Kevin): `NANOGPT_API_KEY`, `GEMINI_API_KEY`. Ambos probados (NanoGPT lista ~640 modelos; Gemini ~60).
- `src/ia.js`: proveedores `nanogpt` (`https://api.nano-gpt.com/api/v1`) y `gemini` (`https://generativelanguage.googleapis.com/v1beta/openai`). Config `{principal:{proveedor,modelo}, respaldo|null, parametros:{temperature,top_p,max_tokens}, extra:{…}}`; el campo libre no puede pisar `model`, `messages`, `stream`, `stream_options` ni `n`. El chat prueba el principal y, si falla, el de respaldo, y devuelve `fallos`.
- Gemini lista modelos retirados que responden 404 al chatear (por ejemplo `gemini-2.5-flash`); `gemini-3-flash-preview` funcionó. El botón Probar del panel debe dejarlo claro.
- Rutas: `GET /salud` (pública); privadas: `GET /yo`, `GET /ia/proveedores`, `GET /ia/modelos?proveedor=…`, `GET`/`PUT /config/ia`, `POST /ia/chat` (`{mensajes, config?}`; con `config` usa esa en vez de la de KV, para el botón Probar). Todo lo que no sea `/salud` exige `Authorization: Bearer <ID token de Firebase>`; se verifica con `jose` (RS256, JWKS de securetoken, issuer/audience del proyecto, `auth_time`) y que `sub` sea el dueño: 401 sin token o token inválido, 403 si no es el dueño.
- Pruebas locales: stub de `jose` en el scratchpad (el entorno no instala paquetes); la verificación real se comprueba en producción.
- Edición del repo desde Claude: el repo `Kevin-RamirezOrg/Bitacora` se conecta a la sesión con permiso de escritura (`add_repo`), se clona y se hace push con git. Respaldo si no se puede: editor web de GitHub con Claude in Chrome.
- Config en `src/ia.js` incluye `favoritos: [{proveedor, modelo}]` (máx. 20, sin duplicados), para el acceso rápido del chat.

### Reglas de Firestore publicadas

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

Modos: `private` (solo dueño), `read` (todos leen, editar exige PIN), `open` (todos leen y editan). Cambiar de modo exige reautenticarse con el PIN. Si se agregan colecciones nuevas (por ejemplo `config/ai`), hay que actualizar estas reglas y avisarle a Kevin para que las publique en la consola.

### Modelo de datos (`items`)

- Carpeta: `{type:'folder', name, parent|null, color, created, updated}`
- Nota: `{type:'file', name, parent|null, format:'rich'|'md'|'code', lang?, content, created, updated}`. `rich` guarda HTML saneado con DOMPurify.
- Portapapeles: documento fijo `clipboard` → `{type:'clip', text, history:[{text, at}] (máx. 10), updated}`.
- `color` es una clave `c0`…`c8` que se resuelve con variables CSS según el tema. Colores hex antiguos se mapean a esas claves.
- Colores de texto y resaltado del editor se guardan como `var(--tc0..5)` y `var(--hc0..4)` para adaptarse al tema.

## Diseño (no romper)

- **Móvil primero**: barra inferior (Inicio, Archivos, botón + central, Asistente, Ajustes); en ≥900 px pasa a riel lateral. Opciones y formularios en **hojas inferiores** (bottom sheets). Editor a pantalla completa con la barra de formato abajo, sobre el teclado (`interactive-widget=resizes-content` + `height:100dvh`). Botones táctiles de al menos 44 px.
- El botón atrás de Android funciona: la navegación usa `history.pushState` (vistas y hojas).
- **Paletas**: *Pizarra* (verde pizarra, por defecto) y *Uva* (morado), cada una con modo oscuro y claro, más un **color de acento personalizado** que se oscurece/aclara solo para mantener contraste. Todo color va como token CSS en `:root`.
- **Contraste obligatorio** (Kevin lo pidió explícitamente): texto ≥ 4,5:1 y bordes/íconos de controles ≥ 3:1 (WCAG AA) en todos los temas. Los botones siempre tienen relleno o borde visible.
- Sin "decoración de plantilla": nada de etiquetas en mayúsculas sostenidas, numeraciones falsas ni flechas en botones.

## Cómo probar

El entorno de Claude no llega a Firebase, a los CDN ni al Worker. Se prueba con Playwright interceptando las peticiones (ojo: en Playwright la última ruta registrada tiene prioridad; registrar primero las genéricas). El Worker se simula con rutas a `*.workers.dev`: se sirve un *stub* de `firebase` con datos de ejemplo en lugar de `firebase-app-compat.js`, stubs mínimos de DOMPurify/marked/hljs, y capturas en 390×844 (celular) y 1280×820 (PC), en oscuro y claro. Revisar también el contraste de los tokens nuevos con un script antes de publicar.

## Notion de Kevin (destino del asistente)

Página "Universidad" → "Bases de datos". Ya existen y deben reutilizarse, no duplicarse:

| Base | Uso | Database ID | Data source |
|---|---|---|---|
| Tareas y evaluaciones | Pruebas, exámenes, deberes. Props: Tarea (título), Tipo (Tarea, Prueba, Examen, Proyecto, Lectura, Institucional), Entrega (fecha), Materia (relación), Completada, Grupal, Clase | `94c9f9c7d80b4532b4c766706f6336e6` | `9d29b687-0cb9-460d-a9d6-6bb20708f43d` |
| Materias | Materias del semestre (relaciona todo) | `25f9e54efec64707aaf64dd836365ae6` | `3e437374-bea5-4ea9-9f90-6b94515982d8` |
| Personas | Docentes y compañeros. Props: Nombre, Rol (Profesor…), Notas, Materias | `49df178a08b44f0b91c4e3ed3ab7f4bf` | `a2fc3865-10e3-4ec2-9164-e9993939579b` |
| Inbox | Bandeja. Props: Nota (título), Procesada, Materia | `3479306af682492f91bf8e3db2c9cacb` | `10c76b66-23ce-4659-bd33-fabedf8b64c3` |

## Hoja de ruta acordada

1. ✅ Rediseño Pizarra para celular, portapapeles, paletas y acento personalizado.
2. **Worker en Cloudflare** (gratis, sin tarjeta), en una carpeta `worker/` de este repo, con despliegue automático desde GitHub. Guarda las claves como *secrets* de Cloudflare (Kevin las pega él mismo; nunca en el repo ni en el chat).
   - ✅ Worker desplegado con Workers Builds y verificación del ID token de Firebase del dueño (`jose`), probado con sesión real.
   - ✅ Rutas de IA y configuración en KV (decisión: la config vive en KV, no en Firestore, para que Cron, Telegram y el resumen la lean sin la web abierta). Probado con chat real.
   - ✅ Panel "Modelos de IA" (Ajustes → Modelos de IA, vista `ai`, solo dueño): estado de claves por proveedor, principal y respaldo con buscador (hoja inferior, filtra y permite pegar un nombre exacto), estrella de favoritos, parámetros comunes y JSON libre validados como en el Worker, botón Probar (usa lo que está en pantalla sin guardar y explica fallos como "modelo retirado") y barra de Guardar con estado. Advertencia de Firestore corregida (`settings` con `merge: true`).
   - **Proveedores de IA intercambiables**, todos por API compatible con OpenAI: **NanoGPT** por defecto (prepago, privado) y **Gemini de AI Studio** gratis como alternativa (su plan gratis puede usar los mensajes para mejorar productos; evitar datos sensibles ahí).
   - **Panel "Modelos de IA" en Ajustes**: proveedores, botón para cargar la lista de modelos disponibles, modelo principal y de respaldo, parámetros comunes (`temperature`, `top_p`, `max_tokens`) y un campo libre para parámetros propios (`top_k`, `min_p`…), con botón de prueba. Modelos y parámetros se editan desde la web (guardados en KV mediante el Worker, solo dueño); las claves quedan en Cloudflare.
3. **Chat del Asistente** (en curso): convierte frases rápidas ("prueba de big data el martes 2") en registros de Notion usando las bases de arriba. Decisiones de Kevin: **guardar directo** con botón **Deshacer** por mensaje, **historial sincronizado en D1** y acciones en **JSON validado por el Worker** (una llamada por mensaje, funciona con cualquier modelo; si el JSON viene mal, se pide una vez más).
   - Worker: `src/notion.js` (Notion-Version `2026-03-11`, páginas con `parent: {type:'data_source_id'}`, papelera con `in_trash`, consulta con `POST /data_sources/{id}/query`; materias en caché de KV `notion:materias` por 6 h) y `src/asistente.js` (prompt con fecha de Ecuador y calendario de -3 a +35 días, materias y pendientes con claves cortas `m1`/`t1`, validación de acciones, ejecución, deshacer en orden inverso, historial en D1 con la tabla `mensajes` creada sola).
   - Acciones: `crear_tarea`, `completar_tarea`, `guardar_persona` (crea o completa la ficha; une notas y materias), `nota_inbox` (lo complejo o informativo) y `mostrar_tareas` (la lista la arma el Worker desde Notion). Máximo 5 por mensaje.
   - Rutas: `GET /asistente/estado`, `GET`/`DELETE /asistente/historial`, `POST /asistente/mensaje` (`{texto, modelo?}`; `modelo` es un favorito y reemplaza solo al principal), `POST /asistente/deshacer` (`{id}`).
   - Vars públicas en `wrangler.jsonc`: `NOTION_DS_TAREAS`, `NOTION_DS_MATERIAS`, `NOTION_DS_PERSONAS`, `NOTION_DS_INBOX` (IDs de data source). Secret: `NOTION_TOKEN` (conexión interna "Bitácora" con acceso a la página Universidad). D1: binding `DB` (base `bitacora-chat`, pendiente de crear).
   - Web: pestaña Asistente con burbujas, resultados con "Abrir" (Notion) y semáforo por días restantes, Deshacer, día separador, mensajes anteriores, menú (Modelos de IA, Borrar conversación), favoritos como chips sobre el campo de texto (elección guardada en `localStorage` `bitacora.chatModelo`), error con Reintentar/Editar y aviso si falta Notion o D1.
   - Privacidad: para el chat conviene un principal de NanoGPT; Gemini gratis puede usar los mensajes para mejorar productos.
4. **Sincronización del aula virtual (Moodle de la universidad)**: Kevin confirmó que existe "Exportar calendario". El Worker lee la URL iCal (como *secret*) una vez al día con un Cron Trigger y crea/actualiza filas en *Tareas y evaluaciones* sin duplicar (usar el UID del evento).
5. **Panel "Hoy"** (espacio ya reservado en Inicio), combinación de reglas + IA:
   - Lo urgente con semáforo por días restantes (siempre visible, aunque falle la IA).
   - Plan del día con máximo 3 prioridades y tiempo estimado; margen ×1,5 en tareas conocidas y ×2 en nuevas (falacia de planificación).
   - Aviso de sobrecarga si el plan supera ~70 % de las horas libres.
   - Repasos espaciados antes de cada prueba (varias sesiones cortas en días distintos).
   - Cierre del día: marcar hecho y tiempo real para afinar estimaciones.
6. **Bandeja para Claude**: una tarea programada de Claude procesa el Inbox de Notion con la suscripción de Kevin (informes, planes de estudio) y deja el resultado en Notion.
7. Extras posibles: recordatorios por Telegram, resumen matutino, foto de apuntes a texto, dictado por voz, búsqueda global.

## Convenciones

- Commits en español, descriptivos.
- Mantener `index.html` como archivo único mientras sea manejable; el Worker va aparte en `worker/`.
- Probar en celular y PC, oscuro y claro, antes de hacer push a `main` (lo que está en `main` queda publicado en ellenkev.me).
