# Bitácora — contexto del proyecto

Web personal de notas y organización de estudio de Kevin, estudiante universitario. Se usa sobre todo desde el celular (Chrome en Android) y a veces desde PC ajenas de la universidad, en incógnito.

> Este repositorio es público: no agregues aquí secretos, claves ni datos personales que no sean necesarios para el proyecto.

## Cómo trabajar con Kevin

- Responde en español, tratándolo de tú, con tono claro y profesional.
- Si hay varios caminos, muestra primero las opciones con ventajas (✅) y advertencias (⚠️), recomienda una (💡) y espera su elección.
- Cuando él deba hacer pasos manuales, guíalo de 1 a 3 pasos por mensaje y espera confirmación.
- Antes de tareas largas o de cambiar algo importante, pregunta.
- Nunca pidas ni guardes en el repo su PIN, claves de API ni la URL privada del calendario de Moodle.

## Arquitectura actual

- **Un solo archivo**: `index.html` (HTML + CSS + JS sin build). Publicado con **GitHub Pages** desde `main`, raíz. Dominio propio **ellenkev.me** (archivo `CNAME`).
- **Firebase** (proyecto `bitacora-c20b4`, plan Spark gratuito, sin tarjeta):
  - Firestore, región `us-east1`. Colección `items` (carpetas, notas y portapapeles) y documento `config/access` (modo de acceso).
  - Authentication con correo/contraseña. Un solo usuario dueño: UID `mOlFltUhUNQrTTxtIWuCFJzMCFI3`, correo identificador `matias@gmail.com`. La contraseña es el **PIN**; la app solo pide el PIN.
  - La config web de Firebase está en `index.html` y es pública por diseño; la seguridad la dan las reglas.
- Librerías por CDN: Firebase compat 10.12.2 (gstatic), marked 12.0.2, DOMPurify 3.1.6, highlight.js 11.9.0 (cdnjs). Fuentes: Lora (títulos), Figtree (texto), JetBrains Mono (código).

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

El entorno de Claude no llega a Firebase ni a los CDN. Se prueba con Playwright interceptando las peticiones: se sirve un *stub* de `firebase` con datos de ejemplo en lugar de `firebase-app-compat.js`, stubs mínimos de DOMPurify/marked/hljs, y capturas en 390×844 (celular) y 1280×820 (PC), en oscuro y claro. Revisar también el contraste de los tokens nuevos con un script antes de publicar.

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
   - Verifica el ID token de Firebase del dueño en cada petición.
   - **Proveedores de IA intercambiables**, todos por API compatible con OpenAI: **NanoGPT** por defecto (prepago, privado) y **Gemini de AI Studio** gratis como alternativa (su plan gratis puede usar los mensajes para mejorar productos; evitar datos sensibles ahí).
   - **Panel "Modelos de IA" en Ajustes**: proveedores, botón para cargar la lista de modelos disponibles, modelo principal y de respaldo, parámetros comunes (`temperature`, `top_p`, `max_tokens`) y un campo libre para parámetros propios (`top_k`, `min_p`…), con botón de prueba. Modelos y parámetros se editan desde la web (guardados en Firestore, solo dueño); las claves quedan en Cloudflare.
3. **Chat del Asistente** (pestaña ya reservada): convierte frases rápidas ("prueba de big data el martes 2") en registros de Notion usando las bases de arriba, confirma lo que entendió y permite deshacer. Las tareas complejas van al Inbox.
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
