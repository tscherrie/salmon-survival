// The game's languages. It is written in German; English (the default) is laid over it
// where the words reach the player: whatever goes on the HUD, the tips, the logbook, the
// badges, the maps drawn on canvases -- through `t()`, and a watch on the page that turns
// any German text that turns up into English. The choice is kept in the browser; the start
// card switches it (and reloads).

import { EN, EN_PATTERNS } from "./i18n-en.js";
import { ZH, ZH_PATTERNS } from "./i18n-zh.js";

const KEY = "salmon-survival-lang";
export const LANGS = { en: "English", de: "Deutsch", zh: "中文" };

export const lang = (() => {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked && LANGS[asked]) return asked;
  try {
    const kept = localStorage.getItem(KEY);
    if (kept && LANGS[kept]) return kept;
  } catch {}
  return "en";
})();

export function setLang(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {}
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.replace(url.toString());
}

const cache = new Map();
// German that got through untranslated (for finding what is missing: window.salmonMissing).
const missing = new Set();
const GERMAN = /[äöüÄÖÜß]|\b(der|die|das|und|nicht|dich|du|ein|eine|mit|von|zum|zur|im|am|auf|ist|wird|Kraft|Fluss|Lachs)\b/;

// Chinese is keyed by the English; whatever it lacks stays English rather than German.
function lookup(text) {
  const english = EN[text];
  if (lang === "zh") {
    if (english !== undefined) return ZH[english] ?? english;
    const done = patterned(text, ZH_PATTERNS);
    if (done !== undefined) return done;
  } else if (english !== undefined) return english;
  return patterned(text, EN_PATTERNS);
}
function patterned(text, patterns) {
  for (const [re, rep] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    return typeof rep === "function" ? rep(...m.slice(1).map((x) => (x === undefined ? x : x))) : rep.replace(/\$(\d)/g, (_, i) => t(m[+i] ?? ""));
  }
  return undefined;
}

// The English for a German text (any whitespace round it kept), or the text as it is.
export function t(text) {
  if (lang === "de" || typeof text !== "string" || text.length < 2) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const lead = text.match(/^\s*/)[0],
    tail = text.match(/\s*$/)[0];
  const core = text.slice(lead.length, text.length - tail.length);
  let out = core ? lookup(core) : undefined;
  if (out === undefined) {
    out = core;
    if (GERMAN.test(core)) missing.add(core);
  }
  out = lead + out + tail;
  if (cache.size > 6000) cache.clear();
  cache.set(text, out);
  return out;
}

const ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"];
function translateNode(node) {
  if (node.nodeType === 3) {
    const v = node.nodeValue;
    if (v && /[A-Za-zÄÖÜäöü]/.test(v)) {
      const e = t(v);
      if (e !== v) node.nodeValue = e;
    }
    return;
  }
  if (node.nodeType !== 1) return;
  for (const a of ATTRIBUTES) {
    const v = node.getAttribute?.(a);
    if (v) {
      const e = t(v);
      if (e !== v) node.setAttribute(a, e);
    }
  }
  if (node.tagName === "SCRIPT" || node.tagName === "STYLE") return;
  for (const child of node.childNodes) translateNode(child);
}

// Turn the page into English and keep it so as the game writes into it; and the words the
// game draws on canvases.
export function startTranslation(root = document.body) {
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang;
  if (lang === "de") return;
  translateNode(root);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") translateNode(r.target);
      else if (r.type === "attributes") translateNode(r.target);
      else for (const n of r.addedNodes) translateNode(n);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ["fillText", "strokeText", "measureText"]) {
    const original = proto[name];
    proto[name] = function (text, ...rest) {
      return original.call(this, typeof text === "string" ? t(text) : text, ...rest);
    };
  }
  window.salmonMissing = missing;
}
