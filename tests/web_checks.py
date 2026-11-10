"""Comprobaciones de la web con todo simulado.  Uso: python3 tests/web_checks.py [nombre ...]"""
import sys, json, time
from web import abrir, ndjson, ROUTES, now, d

CHECKS = {}
def check(f): CHECKS[f.__name__] = f; return f
def kell(pg): pg.click('.tab[data-view="assistant"]'); pg.wait_for_timeout(700)
def contraste(pg, selector, pseudo=None):
    """Contraste WCAG entre el color del texto (o del pseudo-elemento) y el fondo visible detrás."""
    return pg.evaluate("""([sel, pseudo]) => {
      const el = document.querySelector(sel); const cs = getComputedStyle(el, pseudo || undefined);
      const rgb = c => (c.match(/[\\d.]+/g) || []).map(Number);
      const lum = ([r,g,b]) => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      let bg = null, n = el; while (n && n.nodeType === 1) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.99)) { bg = c; break; } n = n.parentElement; }
      const a = lum(rgb(cs.color)), b = lum(bg || [0,0,0]); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); }""", [selector, pseudo])

@check
def markdown_en_respuestas(pg_):
    with abrir() as pg:
        kell(pg)
        html = pg.evaluate("[...document.querySelectorAll('.msg.ia > .txt')].map(e => e.innerHTML)")
        md = [x for x in html if '<strong>combiner</strong>' in x]
        assert md and '<li>' in md[0], html
        assert '**' not in md[0]
        assert not pg.errs, pg.errs

@check
def placeholder_legible(pg_):
    for prefs in ({}, {'scheme':'light'}, {'ls':{'bitacora.palette':'uva'}}, {'scheme':'light','ls':{'bitacora.palette':'uva'}}):
        with abrir(prefs=prefs) as pg:
            kell(pg)
            c = contraste(pg, '#chatIn', '::placeholder')
            assert c >= 4.5, (prefs, c)

@check
def detener_envio(pg_):
    rutas = {'/asistente/mensaje': lambda r: None}  # nunca responde: simula un modelo colgado
    with abrir(rutas=rutas) as pg:
        kell(pg)
        pg.fill('#chatIn', 'crea una tarea'); pg.click('.send'); pg.wait_for_timeout(300)
        assert pg.get_attribute('.send', 'aria-label') == 'Detener'
        pg.click('.send'); pg.wait_for_timeout(400)
        assert 'Envío detenido' in pg.inner_text('.msg.err'), pg.inner_text('.chat-log')
        assert pg.get_attribute('.send', 'aria-label') == 'Enviar'
        assert not pg.errs, pg.errs

@check
def convertir_pide_confirmacion(pg_):
    with abrir() as pg:
        pg.click('.tab[data-view="files"]'); pg.wait_for_timeout(300); pg.click('text=Fundamentos de Big Data'); pg.wait_for_timeout(300)
        pg.click('[aria-label="Opciones de Apuntes semana 7"]'); pg.wait_for_timeout(300)
        pg.click('text=Convertir a Markdown'); pg.wait_for_timeout(700)
        assert 'no se puede recuperar' in pg.inner_text('.sheet'), pg.inner_text('.sheet')
        assert not pg.errs, pg.errs

@check
def copia_sin_conexion(pg_):
    with abrir() as pg:  # sesión recordada por primera vez: aún sin copia, pero queda marcada para la próxima
        assert not pg.evaluate("window.__persist"), 'no debe activarse sin la marca'
        assert pg.evaluate("localStorage.getItem('bitacora.offline')") == '1'
    with abrir(prefs={'ls':{'bitacora.temp':'1'}}) as pg:  # sesión temporal (PC ajena): nada en disco
        assert not pg.evaluate("window.__persist")
        assert pg.evaluate("localStorage.getItem('bitacora.offline')") is None
    with abrir(prefs={'ls':{'bitacora.offline':'1'}}) as pg:
        assert pg.evaluate("window.__persist") is True
        pg.click('.tab[data-view="settings"]'); pg.wait_for_timeout(300)
        assert 'Copia sin conexión activa' in pg.inner_text('#screen')
        pg.evaluate("window.__fromCache = true; window.__emitir()"); pg.wait_for_timeout(200)
        assert 'ves la copia guardada' in pg.inner_text('#screen')
        pg.click('text=Bloquear ahora'); pg.wait_for_timeout(400)
        assert 'se perdería' in pg.inner_text('.sheet')
        pg.add_init_script("localStorage.removeItem('bitacora.offline')")  # el arnés la vuelve a poner en cada carga
        pg.click('text=Bloquear igual'); pg.wait_for_timeout(1200)
        assert pg.evaluate("sessionStorage.getItem('copiaBorrada')") == '1', 'debe borrar la copia local'
        assert not pg.errs, pg.errs

@check
def busqueda_y_codigo(pg_):
    with abrir() as pg:
        assert pg.evaluate("typeof window.hljs") == 'undefined', 'highlight.js no debe cargarse al inicio'
        pg.click('text=Buscar en tus notas'); pg.wait_for_timeout(300)
        pg.fill('#searchIn', 'hdfs'); pg.wait_for_timeout(400)
        assert 'Apuntes semana 7' in pg.inner_text('#screen'), pg.inner_text('#screen')
        pg.fill('#searchIn', 'mapper'); pg.wait_for_timeout(400)
        pg.click('text=wordcount.py'); pg.wait_for_timeout(900)
        assert pg.evaluate("typeof window.hljs") == 'object', 'highlight.js se carga al abrir código'
        assert 'hljs-keyword' in pg.inner_html('.code-wrap pre'), pg.inner_html('.code-wrap pre')[:300]
        assert not pg.errs, pg.errs

@check
def service_worker_guarda_librerias(pg_):
    from web import BASE
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_context().new_page()
        pg.goto(BASE); pg.evaluate("navigator.serviceWorker.ready.then(() => 1)"); pg.wait_for_timeout(1500)
        claves = pg.evaluate("caches.open('bitacora-v2').then(c => c.keys()).then(ks => ks.map(k => new URL(k.url).pathname + new URL(k.url).search))")
        b.close()
    for esperado in ['/', '/lib/firebase-firestore-compat.js?v=10.12.2', '/lib/marked.min.js?v=12.0.2', '/lib/highlight.min.js?v=11.9.0', '/manifest.webmanifest']:
        assert esperado in claves, (esperado, claves)

if __name__ == '__main__':
    fallos = 0
    for n in (sys.argv[1:] or CHECKS):
        try: CHECKS[n](None); print('ok  ', n)
        except Exception as e: fallos += 1; print('FALLA', n, '→', str(e)[:600])
    sys.exit(1 if fallos else 0)
