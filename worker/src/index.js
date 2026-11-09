import { createRemoteJWKSet, jwtVerify } from 'jose';

const ORIGEN = 'https://ellenkev.me';

// Claves públicas con las que Google firma los ID tokens de Firebase.
// Se crea una sola vez por instancia: jose las guarda en caché y las renueva solo.
const CLAVES_FIREBASE = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

const CORS = {
  'Access-Control-Allow-Origin': ORIGEN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

export default {
  async fetch(request, env) {
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

      if (pathname === '/yo') {
        return json({ ok: true, uid: sesion.sub });
      }

      return json({ error: 'Ruta no encontrada' }, 404);
    } catch (error) {
      if (error instanceof ErrorAcceso) {
        return json({ error: error.message }, error.status);
      }
      console.error(error);
      return json({ error: 'Error interno' }, 500);
    }
  },
};
