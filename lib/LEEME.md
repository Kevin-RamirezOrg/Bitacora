# Librerías de terceros

Copias sin modificar de los paquetes de npm, con versión fija. Se alojan aquí para que la web
no ejecute código servido por terceros y funcione sin conexión.

| Archivo | Paquete | Licencia |
|---|---|---|
| `firebase-app-compat.js`, `firebase-auth-compat.js`, `firebase-firestore-compat.js` | `firebase@10.12.2` | Apache-2.0 |
| `marked.min.js` | `marked@12.0.2` | MIT |
| `purify.min.js` | `dompurify@3.1.6` (`dist/purify.min.js`) | Apache-2.0 / MPL-2.0 |
| `highlight.min.js` | `@highlightjs/cdn-assets@11.9.0` | BSD-3-Clause |

Para actualizar: `npm pack <paquete>@<versión>`, copiar el archivo y quitar la línea `sourceMappingURL`.
