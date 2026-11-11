"""Mide el contraste (WCAG) de los colores de cada paleta y modo.  Uso: python3 tests/contraste.py
Regla del proyecto: texto ≥ 4,5:1 y bordes o íconos de controles ≥ 3:1."""
import sys
from web import abrir

JS = """() => {
  const cs = getComputedStyle(document.documentElement); const v = n => cs.getPropertyValue(n).trim();
  const rgb = hx => { hx = hx.replace('#',''); return [0,2,4].map(i => parseInt(hx.slice(i,i+2),16)); };
  const lum = hx => { const f = c => { c/=255; return c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4; }; const [r,g,b] = rgb(hx); return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const c = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05); };
  const out = [];
  const par = (fg, bg, min) => { const r = c(v(fg), v(bg)); if (r < min) out.push(`${fg} sobre ${bg}: ${r.toFixed(2)} (mínimo ${min})`); };
  const fondos = ['--bg','--surface','--surface-2'];
  for (const f of fondos) for (const t of ['--ink','--ink-2','--muted','--accent-ink','--danger','--tc0','--tc1','--tc2','--tc3','--tc4','--tc5']) par(t, f, 4.5);
  for (const t of ['--sx-k','--sx-s','--sx-n','--sx-c','--sx-f','--sx-t','--sx-a']) par(t, '--surface', 4.5);
  for (const f of fondos) par('--line-strong', f, 3);
  for (const f of fondos) par('--accent', f, 3);
  par('--on-accent','--accent',4.5); par('--muted','--surface-3',4.5); par('--ok','--surface',3); par('--warn','--surface',3);
  return out;
}"""
fallos = 0
for pal in ('pizarra', 'uva', 'noche'):
    for modo in ('dark', 'light'):
        with abrir(prefs={'ls': {'bitacora.palette': pal, 'bitacora.theme': modo}}) as pg:
            malos = pg.evaluate(JS)
            print(('ok   ' if not malos else 'FALLA'), pal, modo)
            for m in malos: print('      ', m); fallos += 1
sys.exit(1 if fallos else 0)
