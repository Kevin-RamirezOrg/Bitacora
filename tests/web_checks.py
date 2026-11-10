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

if __name__ == '__main__':
    fallos = 0
    for n in (sys.argv[1:] or CHECKS):
        try: CHECKS[n](None); print('ok  ', n)
        except Exception as e: fallos += 1; print('FALLA', n, '→', str(e)[:600])
    sys.exit(1 if fallos else 0)
