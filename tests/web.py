"""Arnés de la web: abre index.html con Firebase y el Worker simulados y saca capturas.

Uso:  python3 tests/web.py [trabajo ...]     (sin argumentos corre todos)
Las capturas quedan en tests/capturas/ (no se suben al repo).
Requiere Playwright para Python con Chromium.
"""
import json, sys, time, os, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright
REPO=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(REPO,'tests','capturas'); os.makedirs(OUT, exist_ok=True)

class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve():
    socketserver.TCPServer.allow_reuse_address=True
    srv=socketserver.TCPServer(('127.0.0.1',0), functools.partial(_Quiet, directory=REPO))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/' % srv.server_address[1]
SRV, BASE = serve()
now=int(time.time()*1000)
items={
 'f1':{'type':'folder','name':'Fundamentos de Big Data','parent':None,'color':'c5','created':now,'updated':now},
 'f2':{'type':'folder','name':'Compiladores','parent':None,'color':'c3','created':now,'updated':now},
 'f3':{'type':'folder','name':'Ingeniería de Software','parent':None,'color':'c0','created':now,'updated':now},
 'n1':{'type':'file','name':'Apuntes semana 7','parent':'f1','format':'rich','content':'<h1>MapReduce</h1><p>El modelo divide el trabajo en <b>map</b> y <b>reduce</b>. Cada nodo procesa un bloque del archivo.</p><ul><li>Tolerancia a fallos por réplica</li><li>Combiner opcional</li></ul><h2>HDFS</h2><p>Bloques de 128 MB, factor de réplica 3.</p>','created':now,'updated':now-3600e3},
 'n2':{'type':'file','name':'Gramáticas LL(1)','parent':'f2','format':'md','content':'# LL(1)\n\n- FIRST y FOLLOW\n- Tabla predictiva\n','created':now,'updated':now-86400e3},
 'n3':{'type':'file','name':'wordcount.py','parent':'f1','format':'code','lang':'python','content':'def mapper(line):\n    for w in line.split():\n        yield w, 1\n','created':now,'updated':now-2*86400e3},
 'n4':{'type':'file','name':'Transcripción · clase 5 nov','parent':'f3','format':'rich','content':'<p><b>[00:00]</b> Hoy vemos casos de uso.</p>','created':now,'updated':now-3*86400e3},
 'clipboard':{'type':'clip','text':'ssh kevin@lab-fis.epn.edu.ec -p 2222','history':[{'text':'hola','at':now-5000}],'updated':now-600e3},
}
FB = """
window.__items = %s;
window.firebase = (function(){
  const user = { uid:'mOlFltUhUNQrTTxtIWuCFJzMCFI3', getIdToken: async()=> 'tok', reauthenticateWithCredential: async()=>{} };
  const oyentes = [];
  const authObj = { currentUser:user, onAuthStateChanged(cb){ oyentes.push(cb); setTimeout(()=>cb(authObj.currentUser),5); }, setPersistence: async()=>{}, signInWithEmailAndPassword: async()=>{ authObj.currentUser = user; oyentes.forEach(cb=>cb(user)); },
    signOut: async()=>{ authObj.currentUser = null; oyentes.forEach(cb=>cb(null)); } };
  const auth = () => authObj; auth.Auth = { Persistence:{ LOCAL:'l', SESSION:'s' } }; auth.EmailAuthProvider = { credential(){ return {}; } };
  const snap = () => ({ metadata:{ fromCache: !!window.__fromCache }, docChanges:()=>[1], docs:Object.entries(window.__items).map(([id,d])=>({ id, data:()=>d })) });
  const col = { onSnapshot(...a){ const cb = a.find(x=>typeof x==='function'); window.__emitir = () => cb(snap()); setTimeout(()=>cb(snap()),15); return ()=>{}; },
    doc(id){ return { set: async(d)=>{ window.__items[id]=d; }, update: async(p)=>{ Object.assign(window.__items[id]||{}, p); }, delete: async()=>{ delete window.__items[id]; } }; } };
  const fs = { settings(){}, enablePersistence: async()=>{ window.__persist = true; }, terminate: async()=>{ window.__terminado = true; }, clearPersistence: async()=>{ sessionStorage.setItem('copiaBorrada','1'); },
    collection(){ return col; }, doc(){ return { onSnapshot(cb){ setTimeout(()=>cb({ exists:true, data:()=>({mode:'private'}) }),5); return ()=>{}; }, set: async()=>{} }; }, batch(){ return { set(){}, commit: async()=>{} }; } };
  return { initializeApp(){}, firestore: () => fs, auth };
})();
""" % json.dumps(items)
hoy='2026-11-10'
def d(n):
    import datetime
    return (datetime.date(2026,11,10)+datetime.timedelta(days=n)).isoformat()
T=lambda t,tipo,m,f,comp=False:{'id':'a'*32,'url':'https://notion.so/x','titulo':t,'tipo':tipo,'fecha':f,'hora':None,'materia':m,'completada':comp,'grupal':False}
tareas=[T('Deber 3: MapReduce','Tarea','Fundamentos de Big Data',d(-1)),T('Prueba 2 de Big Data','Prueba','Fundamentos de Big Data',d(2)),T('Informe de casos de uso','Tarea','Ingeniería de Software',d(3)),
 T('Examen bimestral','Examen','Compiladores',d(6)),T('Proyecto: analizador léxico','Proyecto','Compiladores',d(6)),T('Lectura cap. 4','Lectura','Ingeniería de Software',d(9)),T('Prueba de gramáticas','Prueba','Compiladores',d(12))]
HOY={'hoy':hoy,'tareas':tareas,'historial':True,'horario':True,
 'clases':[{'id':'c','url':'https://notion.so/c','titulo':'Compiladores','dia':'martes','inicio':'07:00','fin':'09:00','aula':'E-021','materia':'Compiladores'},
           {'id':'c','url':'https://notion.so/c','titulo':'Fundamentos de Big Data','dia':'martes','inicio':'11:00','fin':'13:00','aula':'LAB-3','materia':'Fundamentos de Big Data'},
           {'id':'c','url':'https://notion.so/c','titulo':'Ingeniería de Software','dia':'martes','inicio':'14:00','fin':'16:00','aula':'A-204','materia':'Ingeniería de Software'}],
 'proximo':None,
 'repasos':[{'tarea':'a'*32,'titulo':'Prueba 2 de Big Data','tipo':'Prueba','materia':'Fundamentos de Big Data','fecha':d(2),'url':'https://notion.so/x','sesiones':[{'fecha':d(-1),'hecho':True},{'fecha':d(1),'hecho':False}]},
            {'tarea':'b'*32,'titulo':'Examen bimestral','tipo':'Examen','materia':'Compiladores','fecha':d(6),'url':'https://notion.so/x','sesiones':[{'fecha':d(0),'hecho':False},{'fecha':d(3),'hecho':False},{'fecha':d(5),'hecho':False}]}]}
CFG={'config':{'principal':{'proveedor':'gemini','modelo':'gemini-3.5-flash'},'respaldo':None,'parametros':{'temperature':0.7},'extra':{},'favoritos':[{'proveedor':'nanogpt','modelo':'deepseek/deepseek-chat'}]}}
msgs=[
 {'id':1,'rol':'usuario','texto':'prueba de big data el jueves y entregar el informe de casos de uso el viernes','datos':None,'creado':now-7200e3,'chat':1},
 {'id':2,'rol':'asistente','texto':'Listo, guardé las dos.','creado':now-7190e3,'chat':1,'datos':{'modelo':'gemini-3.5-flash','resultados':[
   {'accion':'crear_tarea','ok':True,'titulo':'Prueba 2 de Big Data','tipo':'Prueba','fecha':d(2),'hora':None,'materia':'Fundamentos de Big Data','grupal':False,'url':'https://notion.so/x','deshacer':{'tipo':'papelera','id':'x'}},
   {'accion':'crear_tarea','ok':True,'titulo':'Informe de casos de uso','tipo':'Tarea','fecha':d(3),'hora':None,'materia':'Ingeniería de Software','grupal':True,'url':'https://notion.so/x','deshacer':{'tipo':'papelera','id':'y'}}]}},
 {'id':3,'rol':'usuario','texto':'explícame en corto qué es un combiner','datos':None,'creado':now-600e3,'chat':1},
 {'id':4,'rol':'asistente','texto':'Un **combiner** es un mini-reduce que corre en cada nodo antes de enviar los datos:\n\n- Reduce el tráfico de red\n- Solo sirve si la operación es *asociativa y conmutativa*\n- Es opcional: Hadoop puede no ejecutarlo','creado':now-590e3,'chat':1,'datos':{'modelo':'gemini-3.5-flash','charla':True,'resultados':[]}},
 {'id':5,'rol':'usuario','texto':'hazme un quiz corto de eso','datos':None,'creado':now-300e3,'chat':1},
 {'id':6,'rol':'asistente','texto':'Aquí tienes dos preguntas.','creado':now-290e3,'chat':1,'datos':{'modelo':'gemini-3.5-flash','charla':True,'resultados':[
   {'accion':'mostrar_contenido','ok':True,'formato':'opcion_multiple','titulo':'Combiner','items':[
     {'pregunta':'¿Dónde se ejecuta el combiner?','opciones':['En el NameNode','En cada nodo mapper','En el cliente','En el reducer final'],'correcta':1,'explicacion':'Corre localmente tras el map.'},
     {'pregunta':'¿Qué propiedad debe cumplir la operación?','opciones':['Ser idempotente','Ser asociativa y conmutativa','Ser lineal'],'correcta':1,'explicacion':None}]}]}},
]
ROUTES={'/hoy':HOY,'/asistente/estado':{'notion':True,'historial':True},'/config/ia':CFG,'/asistente/chats':{'chats':[{'id':1,'titulo':'prueba de big data el jueves y entregar el inf…','creado':now,'actualizado':now,'mensajes':6}]},
 '/asistente/historial':{'mensajes':msgs},'/asistente/memoria':{'memoria':[{'id':1,'texto':'Prefiere respuestas cortas','origen':'usuario','creado':now}]},'/ia/proveedores':{'proveedores':[{'id':'nanogpt','nombre':'NanoGPT','conClave':True},{'id':'gemini','nombre':'Gemini','conClave':True}]}}
INIT_SR = """
class FakeSR { start(){ this._on=true; setTimeout(()=>this.onstart&&this.onstart(),10); } stop(){ this.onend&&this.onend(); } abort(){ } }
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
"""
from contextlib import contextmanager
@contextmanager
def abrir(w=390, h=844, prefs=None, rutas=None, empty_chat=False, lento=None):
    """Abre la web con todo simulado. `rutas` = {'/ruta': dict o función(route)} para cambiar respuestas del Worker."""
    prefs = prefs or {}; rutas = rutas or {}
    with sync_playwright() as p:
        b=p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=2, color_scheme=prefs.get('scheme','dark'), is_mobile=(w<600), has_touch=(w<600))
        pg=ctx.new_page()
        pg.errs=[]
        pg.on('pageerror', lambda e: pg.errs.append(str(e)))
        pg.add_init_script(INIT_SR + "try{ %s }catch(e){}" % ''.join("localStorage.setItem(%s,%s);" % (json.dumps(k),json.dumps(v)) for k,v in prefs.get('ls',{}).items()))
        pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith(BASE) else r.abort())
        pg.route('**/lib/firebase-app-compat.js*', lambda r: r.fulfill(body=FB, content_type='text/javascript'))
        pg.route('**/lib/firebase-auth-compat.js*', lambda r: r.fulfill(body='', content_type='text/javascript'))
        pg.route('**/lib/firebase-firestore-compat.js*', lambda r: r.fulfill(body='', content_type='text/javascript'))
        pg.route('**/sw.js', lambda r: r.abort())
        pg.pedidos=[]
        def worker(r):
            from urllib.parse import urlparse
            path=urlparse(r.request.url).path
            pg.pedidos.append((r.request.method, path, r.request.post_data))
            if path in rutas:
                x=rutas[path]
                if callable(x): return x(r)
                data=x
            else:
                data=ROUTES.get(path,{})
                if empty_chat and path=='/asistente/chats': data={'chats':[]}
            r.fulfill(body=json.dumps(data), content_type='application/json', headers={'Access-Control-Allow-Origin':'*'})
        pg.route('**/*.workers.dev/**', worker)
        pg.goto(BASE+prefs.get('query',''))
        pg.wait_for_timeout(500)
        try: yield pg
        finally: b.close()

def ndjson(route, lineas, espera=0):
    """Responde como el chat del Worker: líneas {etapa} y al final {fin} o {error}."""
    if espera: time.sleep(espera)
    route.fulfill(body=''.join(json.dumps(l)+'\n' for l in lineas), content_type='application/x-ndjson', headers={'Access-Control-Allow-Origin':'*'})

def run(name, w, h, prefs, steps, empty_chat=False):
    with abrir(w, h, prefs, empty_chat=empty_chat) as pg:
        steps(pg)
        pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(OUT,name+'.png'))
        if pg.errs: print(name,'ERRORS',pg.errs[:3])
tab=lambda v: (lambda pg: (pg.click(f'.tab[data-view="{v}"]'), pg.wait_for_timeout(600)))
def editor(pg):
    pg.click('.tab[data-view="files"]'); pg.wait_for_timeout(300); pg.click('text=Fundamentos de Big Data'); pg.wait_for_timeout(300); pg.click('text=Apuntes semana 7'); pg.wait_for_timeout(400)
def conv(pg):
    pg.click('.tab[data-view="assistant"]'); pg.wait_for_timeout(700); pg.click('[aria-label="Conversación por voz con Kell"]'); pg.wait_for_timeout(600)
def quiz(pg):
    pg.click('.tab[data-view="assistant"]'); pg.wait_for_timeout(700); pg.click('text=En cada nodo mapper'); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#screen .scroll').scrollTop = 99999")
def chat_top(pg):
    pg.click('.tab[data-view="assistant"]'); pg.wait_for_timeout(700); pg.evaluate("document.querySelector('#screen .scroll').scrollTop = 0")
jobs={
 'home':('home',390,844,{},lambda pg: None),
 'files':('files',390,844,{},tab('files')),
 'chat':('chat',390,844,{},quiz),
 'chat_top':('chat_top',390,844,{},chat_top),
 'chat_empty':('chat_empty',390,844,{},tab('assistant'),True),
 'panel':('panel',390,844,{},tab('panel')),
 'settings':('settings',390,844,{},tab('settings')),
 'editor':('editor',390,844,{},editor),
 'ai':('ai',390,844,{},lambda pg: (pg.click('.tab[data-view="settings"]'), pg.wait_for_timeout(300), pg.click('text=Modelos de IA'), pg.wait_for_timeout(700))),
 'conv':('conv',390,844,{},conv),
 'home_light':('home_light',390,844,{'scheme':'light'},lambda pg: None),
 'chat_uva':('chat_uva',390,844,{'ls':{'bitacora.palette':'uva'}},quiz),
 'desk_chat':('desk_chat',1280,820,{},quiz),
 'desk_home':('desk_home',1280,820,{},lambda pg: None),
}
if __name__ == '__main__':
    which=sys.argv[1:]
    for k in (which or jobs):
        j=jobs[k]; run(j[0],j[1],j[2],j[3],j[4],*(j[5:]))
    print('done')
