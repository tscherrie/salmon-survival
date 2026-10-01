/**
 * Element-Picker für Vorschauseiten (Website, Deck-/Leinwand-Bühne). Eigenständiges JavaScript ohne
 * Abhängigkeiten; wird per CDP (`Page.addScriptToEvaluateOnNewDocument`, isolierte Welt), per
 * `<script>` (SiteServer `injectPicker`) oder `page.evaluate` eingefügt. Mehrfaches Einfügen ist
 * harmlos (idempotent).
 *
 * API im Fenster:
 * - `window.__studioPicker.enable()` / `.disable()` / `.isEnabled()` / `.describe(element)`
 * - Bei aktivem Picker: Hover hebt das Element hervor (Rahmen + Beschriftung in einem Shadow-Root),
 *   Klick verhindert Navigation/Aktionen und meldet (nur bei echten Nutzerklicks, `isTrusted`) ein `PickPayload`:
 *   `window.__studioPickerReport?.(payload)` UND `console.debug('__STUDIO_PICK__' + JSON.stringify(payload))`
 *   (Electron-Main hört auf Konsolenmeldungen). `Alt`+Klick wählt die übergeordnete Komponente
 *   (nächster Vorfahre mit `data-sid`/`data-src`/`data-loc`). `Esc` deaktiviert den Picker.
 * - `window.__studioPickerAutoEnable = true` vor dem Einfügen aktiviert sofort.
 */
export const PICKER_SCRIPT = String.raw`(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__studioPicker) return;
  var enabled = false;
  var host = null, box = null, label = null, current = null;
  var PREFIX = '__STUDIO_PICK__';

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (ch) { return '\\' + ch; });
  }
  function attrSelector(name, value) {
    return '[' + name + '="' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
  }
  function isUnique(selector) {
    try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; }
  }
  function nthOfType(el) {
    var i = 1, sib = el.previousElementSibling;
    while (sib) { if (sib.tagName === el.tagName) i++; sib = sib.previousElementSibling; }
    return i;
  }
  function hasSameTypeSiblings(el) {
    var parent = el.parentElement;
    if (!parent) return false;
    for (var c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (c !== el && c.tagName === el.tagName) return true;
    }
    return false;
  }
  function stableClasses(el) {
    var list = [];
    if (!el.classList) return list;
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      // Hash-artige/generierte Klassen auslassen
      if (/^[a-zA-Z][\w-]{1,40}$/.test(c) && !/\d{3,}/.test(c) && !/^(css|sc|jsx|svelte|astro)-/.test(c) && c.indexOf(':') < 0) list.push(c);
    }
    return list.slice(0, 2);
  }
  function anchorSelector(el) {
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id) && isUnique('#' + cssEscape(el.id))) return '#' + cssEscape(el.id);
    var sid = el.getAttribute && el.getAttribute('data-sid');
    if (sid) { var s = attrSelector('data-sid', sid); if (isUnique(s)) return s; }
    var testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test'));
    if (testid) { var t = attrSelector(el.hasAttribute('data-testid') ? 'data-testid' : 'data-test', testid); if (isUnique(t)) return t; }
    return null;
  }
  function segment(el) {
    var tag = el.tagName.toLowerCase();
    var seg = tag;
    var classes = stableClasses(el);
    if (classes.length) seg += '.' + classes.map(cssEscape).join('.');
    if (hasSameTypeSiblings(el)) seg += ':nth-of-type(' + nthOfType(el) + ')';
    return seg;
  }
  /** Robuster, eindeutiger CSS-Selektor (ID/data-sid-Anker, sonst Pfad mit :nth-of-type). */
  function uniqueSelector(el) {
    if (!(el instanceof Element)) return '';
    var direct = anchorSelector(el);
    if (direct) return direct;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var anchor = node !== el ? anchorSelector(node) : null;
      if (anchor) { parts.unshift(anchor); break; }
      parts.unshift(segment(node));
      var candidate = parts.join(' > ');
      if (isUnique(candidate)) return candidate;
      node = node.parentElement;
    }
    var full = parts.join(' > ');
    if (isUnique(full)) return full;
    if (!anchor) { full = 'html > ' + full; }
    return full;
  }
  function closestAttr(el, name) {
    var n = el && el.closest ? el.closest('[' + name + ']') : null;
    return n ? n.getAttribute(name) : null;
  }
  function sourceOf(el) {
    var src = closestAttr(el, 'data-src');
    if (src) return src;
    var loc = closestAttr(el, 'data-loc');
    if (loc) return loc;
    var insp = closestAttr(el, 'data-insp-path');
    if (insp) { var m = /^(.*?:\d+(?::\d+)?)/.exec(insp); return m ? m[1] : insp; }
    var astroNode = el && el.closest ? el.closest('[data-astro-source-file]') : null;
    if (astroNode) return astroNode.getAttribute('data-astro-source-file') + ':' + (astroNode.getAttribute('data-astro-source-loc') || '1:1');
    return null;
  }
  function textOf(el) {
    var t = (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent) || '';
    // Bedingte Trennstriche (Silbentrennung) gehören nicht zum Text.
    t = t.replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 120 ? t.slice(0, 119) + '…' : t;
  }
  function describe(el) {
    var r = el.getBoundingClientRect();
    var sx = window.scrollX || window.pageXOffset || 0;
    var sy = window.scrollY || window.pageYOffset || 0;
    var sidPath = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var sid = n.getAttribute('data-sid');
      if (sid) sidPath.push(sid);
    }
    return {
      selector: uniqueSelector(el),
      bbox: { x: Math.round((r.left + sx) * 100) / 100, y: Math.round((r.top + sy) * 100) / 100, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 },
      text: textOf(el),
      tag: el.tagName.toLowerCase(),
      dataSid: closestAttr(el, 'data-sid'),
      dataSrc: sourceOf(el),
      slideId: closestAttr(el, 'data-slide-id'),
      sidPath: sidPath,
      page: location.pathname,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  }
  function ensureOverlay() {
    if (host && host.isConnected) return;
    host = document.createElement('studio-picker-overlay');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #2a78d6;background:rgba(42,120,214,0.12);border-radius:2px;display:none;box-sizing:border-box;transition:all 40ms linear;';
    label = document.createElement('div');
    label.style.cssText = 'position:fixed;pointer-events:none;background:#2a78d6;color:#fff;font:600 11px/1.4 system-ui,sans-serif;padding:2px 6px;border-radius:3px;display:none;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;';
    root.appendChild(box);
    root.appendChild(label);
    (document.documentElement || document.body).appendChild(host);
  }
  function isOverlay(el) { return !!el && (el === host || (el.tagName && el.tagName.toLowerCase() === 'studio-picker-overlay')); }
  function resolveTarget(ev) {
    var el = ev.target;
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (!el || isOverlay(el) || el === document.documentElement) {
      el = document.elementFromPoint(ev.clientX, ev.clientY);
    }
    if (el && ev.altKey) {
      var p = el.parentElement ? el.parentElement.closest('[data-sid],[data-src],[data-loc]') : null;
      if (p) el = p;
    }
    return el && el.nodeType === 1 && !isOverlay(el) ? el : null;
  }
  function highlight(el) {
    ensureOverlay();
    current = el;
    if (!el) { box.style.display = 'none'; label.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    var sid = el.getAttribute('data-sid') || closestAttr(el, 'data-sid');
    label.textContent = el.tagName.toLowerCase() + (sid ? ' · ' + sid : '') + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    label.style.display = 'block';
    label.style.left = Math.max(0, r.left) + 'px';
    label.style.top = (r.top > 20 ? r.top - 20 : r.bottom + 2) + 'px';
  }
  function report(payload) {
    try { if (typeof window.__studioPickerReport === 'function') window.__studioPickerReport(payload); } catch (e) { /* ignorieren */ }
    try { console.debug(PREFIX + JSON.stringify(payload)); } catch (e) { /* ignorieren */ }
  }
  function block(ev) {
    if (!enabled) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
  }
  function onMove(ev) {
    if (!enabled) return;
    highlight(resolveTarget(ev));
  }
  function onClick(ev) {
    if (!enabled) return;
    block(ev);
    // Nur echte Nutzerklicks melden: synthetische Klicks (el.click(), dispatchEvent) von Seiten-Skripten
    // werden blockiert, lösen aber keinen Pick aus.
    if (ev.isTrusted === false) return;
    var el = resolveTarget(ev);
    if (!el) return;
    highlight(el);
    report(describe(el));
  }
  function onKey(ev) {
    if (enabled && ev.key === 'Escape') { block(ev); api.disable(); }
  }
  function onScroll() { if (enabled && current) highlight(current); }
  var blockedEvents = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend'];
  var api = {
    enable: function () {
      if (enabled) return;
      enabled = true;
      ensureOverlay();
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
      for (var i = 0; i < blockedEvents.length; i++) window.addEventListener(blockedEvents[i], block, true);
      document.documentElement.setAttribute('data-studio-picker', 'on');
    },
    disable: function () {
      if (!enabled) return;
      enabled = false;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      for (var i = 0; i < blockedEvents.length; i++) window.removeEventListener(blockedEvents[i], block, true);
      highlight(null);
      document.documentElement.removeAttribute('data-studio-picker');
    },
    isEnabled: function () { return enabled; },
    describe: describe,
    selector: uniqueSelector,
    version: 1
  };
  Object.defineProperty(window, '__studioPicker', { value: api, configurable: false, enumerable: false, writable: false });
  if (window.__studioPickerAutoEnable) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { api.enable(); });
    else api.enable();
  }
})();`;

/** Präfix der Konsolenmeldung, über die Electron-Main Picks empfängt. */
export const PICK_CONSOLE_PREFIX = '__STUDIO_PICK__';

/** Ergebnis eines Picks (siehe `PICKER_SCRIPT`). */
export interface PickPayload {
  selector: string;
  /** Box in Seitenkoordinaten (CSS-Pixel, inkl. Scroll). */
  bbox: { x: number; y: number; width: number; height: number };
  /** Getrimmter Text (≤ 120 Zeichen). */
  text: string;
  tag: string;
  /** Nächstes `[data-sid]` (Element selbst oder Vorfahre). */
  dataSid: string | null;
  /** Nächstes `[data-src]` bzw. `[data-loc]` als `datei:zeile:spalte`. */
  dataSrc: string | null;
  /** Folie (nächstes `[data-slide-id]`), nur in Deck-Bühnen. */
  slideId?: string | null;
  /** Alle `data-sid` von innen nach außen. */
  sidPath?: string[];
  page: string;
  viewport?: { width: number; height: number };
}

/** Liest eine Picker-Konsolenmeldung; `undefined`, wenn es keine ist. */
export function parsePickConsoleMessage(text: string): PickPayload | undefined {
  if (!text.startsWith(PICK_CONSOLE_PREFIX)) return undefined;
  try {
    return JSON.parse(text.slice(PICK_CONSOLE_PREFIX.length)) as PickPayload;
  } catch {
    return undefined;
  }
}
