const ORIGEN = 'https://ellenkev.me';

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ORIGEN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    const url = new URL(request.url);
    if (url.pathname === '/salud') {
      return Response.json({ ok: true, servicio: 'bitacora-worker' }, { headers: cors });
    }
    return Response.json({ error: 'Ruta no encontrada' }, { status: 404, headers: cors });
  },
};
