/**
 * Demo-Website für die Web-Vorschau im Browser-Modus (iframe mit `sandbox="allow-scripts"`).
 * Enthält ein kleines Picker-Skript: Im Picker-Modus meldet ein Klick das Element per `postMessage`
 * an die App (Selektor, Box, `data-src`-Quelle) – im Electron-Betrieb übernimmt das die WebContentsView.
 */

export const PICK_MODE_MESSAGE = 'studio-pick-mode';
export const PICK_MESSAGE = 'studio-pick';

export interface PickMessage {
  type: typeof PICK_MESSAGE;
  page: string;
  selector: string;
  source?: string | undefined;
  text?: string | undefined;
  bbox: { x: number; y: number; width: number; height: number };
}

export function demoSiteHtml(title: string): string {
  const pickScript = `
(function(){
  var pick = false, hoverEl = null;
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #3ba7a0;background:rgba(59,167,160,.12);z-index:99999;display:none;border-radius:2px';
  document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(box); route(); });
  function page(){ var h = location.hash.replace(/^#/, ''); return h || '/'; }
  function route(){
    var p = page();
    document.querySelectorAll('[data-page]').forEach(function(s){ s.hidden = s.getAttribute('data-page') !== p; });
  }
  window.addEventListener('hashchange', route);
  function selectorOf(el){
    if (el.id) return '#' + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      var tag = el.tagName.toLowerCase();
      var parent = el.parentElement, idx = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) idx++;
      parts.unshift(parent && parent.querySelectorAll(':scope > ' + tag).length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
      el = parent;
    }
    return 'body > ' + parts.join(' > ');
  }
  window.addEventListener('message', function(e){
    if (e.data && e.data.type === '${PICK_MODE_MESSAGE}') { pick = !!e.data.enabled; box.style.display = 'none'; document.body.style.cursor = pick ? 'crosshair' : ''; }
  });
  document.addEventListener('mousemove', function(e){
    if (!pick) return;
    var el = e.target.closest('[data-src]') || e.target;
    var r = el.getBoundingClientRect();
    box.style.display = 'block'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  });
  document.addEventListener('click', function(e){
    var link = e.target.closest('a[href^="#/"]');
    if (!pick) { return; }
    e.preventDefault(); e.stopPropagation();
    var el = e.target.closest('[data-src]') || e.target;
    var r = el.getBoundingClientRect();
    parent.postMessage({ type: '${PICK_MESSAGE}', page: page(), selector: selectorOf(el), source: el.getAttribute('data-src') || undefined,
      text: (el.textContent || '').trim().slice(0, 60), bbox: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } }, '*');
  }, true);
})();`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --ink:#2b2118; --paper:#fbf6ef; --accent:#c8553d; --muted:#7a6a5a; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: Georgia, 'Times New Roman', serif; color:var(--ink); background:var(--paper); }
  header { display:flex; justify-content:space-between; align-items:center; padding:20px 6vw; border-bottom:1px solid #e7dccd; }
  header nav a { margin-left:20px; color:var(--ink); text-decoration:none; font-family: system-ui, sans-serif; font-size:15px; }
  .logo { font-weight:700; letter-spacing:.04em; }
  .hero { padding:12vh 6vw 10vh; background:linear-gradient(180deg,#f3e3cf,#fbf6ef); }
  .hero h1 { font-size:clamp(36px,6vw,72px); margin:0 0 16px; line-height:1.05; }
  .hero p { font-size:20px; color:var(--muted); max-width:560px; font-family: system-ui, sans-serif; }
  .btn { display:inline-block; margin-top:24px; padding:14px 22px; background:var(--accent); color:#fff; border-radius:999px; text-decoration:none; font-family: system-ui, sans-serif; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; padding:48px 6vw; }
  .card { background:#fff; border:1px solid #eadfce; border-radius:12px; padding:20px; }
  .card h3 { margin:0 0 8px; }
  .card p { margin:0; color:var(--muted); font-family: system-ui, sans-serif; }
  footer { padding:32px 6vw; color:var(--muted); font-family: system-ui, sans-serif; font-size:14px; border-top:1px solid #e7dccd; }
  ul.menu { list-style:none; padding:0 6vw 48px; margin:0; font-family: system-ui, sans-serif; }
  ul.menu li { display:flex; justify-content:space-between; padding:14px 0; border-bottom:1px dashed #e0d3c0; }
</style></head>
<body>
<header data-src="src/App.tsx:8:5"><div class="logo" data-src="src/App.tsx:9:7">Café Morgenrot</div>
  <nav data-src="src/App.tsx:10:7"><a href="#/">Start</a><a href="#/karte">Karte</a><a href="#/kontakt">Kontakt</a></nav></header>
<main>
  <section data-page="/">
    <div class="hero" data-src="src/pages/Home.tsx:6:5">
      <h1 data-src="src/pages/Home.tsx:7:7">Guten Morgen,<br>Nachbarschaft.</h1>
      <p data-src="src/pages/Home.tsx:8:7">Frisch gerösteter Kaffee, Sauerteig aus dem Holzofen und ein Platz am Fenster – ab 7 Uhr.</p>
      <a class="btn" href="#/karte" data-src="src/pages/Home.tsx:9:7">Zur Speisekarte</a>
    </div>
    <div class="cards" data-src="src/pages/Home.tsx:12:5">
      <div class="card" data-src="src/pages/Home.tsx:13:7"><h3>Rösterei</h3><p>Bohnen aus kleinen Kooperativen, jede Woche frisch.</p></div>
      <div class="card" data-src="src/pages/Home.tsx:14:7"><h3>Backstube</h3><p>Croissants, Zimtschnecken und Brot vom Vortag zum halben Preis.</p></div>
      <div class="card" data-src="src/pages/Home.tsx:15:7"><h3>Frühstück</h3><p>Den ganzen Tag, auch am Wochenende ohne Reservierung.</p></div>
    </div>
  </section>
  <section data-page="/karte" hidden>
    <div class="hero" data-src="src/pages/Menu.tsx:5:5"><h1 data-src="src/pages/Menu.tsx:6:7">Speisekarte</h1></div>
    <ul class="menu" data-src="src/pages/Menu.tsx:8:5">
      <li data-src="src/pages/Menu.tsx:9:7"><span>Cappuccino</span><span>3,40 €</span></li>
      <li data-src="src/pages/Menu.tsx:10:7"><span>Flat White</span><span>3,80 €</span></li>
      <li data-src="src/pages/Menu.tsx:11:7"><span>Sauerteig mit Butter</span><span>4,20 €</span></li>
    </ul>
  </section>
  <section data-page="/kontakt" hidden>
    <div class="hero" data-src="src/pages/Contact.tsx:5:5"><h1 data-src="src/pages/Contact.tsx:6:7">Kontakt</h1>
      <p data-src="src/pages/Contact.tsx:7:7">Lindenstraße 4 · Mo–So 7–18 Uhr</p></div>
  </section>
</main>
<footer data-src="src/App.tsx:20:5">© Café Morgenrot</footer>
<script>${pickScript}</script>
</body></html>`;
}

export function demoSiteUrl(title: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(demoSiteHtml(title))}`;
}
