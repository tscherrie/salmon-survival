// The first thing on screen: the title, a line about what the game is, the controls, and
// the button that starts the swim (which is also the click the browser needs before it
// plays sound or captures the mouse). With a keyboard and a mouse the card lists the keys;
// on a phone or a tablet, the touch controls (src/touch.js).

export function isDesktop() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua);
  // iPadOS presents itself as a Mac, but a Mac has no touch screen.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const pointer = matchMedia("(pointer: fine)").matches || matchMedia("(any-pointer: fine)").matches;
  const hover = matchMedia("(hover: hover)").matches || matchMedia("(any-hover: hover)").matches;
  return !mobile && !iPad && pointer && hover;
}

import { VERSION } from "./version.js";
import { clearSave } from "./save.js";
import { LANGS, lang, setLang } from "./i18n.js";
import { track } from "./track.js";
import { mode, setVegan } from "./vegan.js";

const box = () => document.querySelector("#intro");
// The language picker on the card: the one in use marked; another reloads in it.
function languages(intro) {
  intro.querySelector(".links a")?.addEventListener("click", () => track("github"));
  const picker = intro.querySelector(".langs");
  if (!picker || picker.childElementCount) return;
  for (const [code, name] of Object.entries(LANGS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.lang = code;
    button.setAttribute("aria-pressed", code === lang ? "true" : "false");
    button.addEventListener("click", () => {
      if (code === lang) return;
      track("language", { to: code });
      setTimeout(() => setLang(code), 150);
    });
    picker.append(button);
  }
}
// On an iPhone or iPad the page cannot ask for the whole screen; added to the home screen
// it gets it. The card says how, until the game is opened from there.
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
export const asApp = () => navigator.standalone === true || matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
function homeScreen(intro) {
  const hint = intro.querySelector(".homescreen");
  if (hint) hint.hidden = !(apple() && !asApp());
}
const showVersion = (intro) => {
  const tag = intro.querySelector(".version");
  if (tag) tag.textContent = VERSION === "dev" ? "Entwicklungsversion" : `Version ${VERSION}`;
};

export function showPhoneNotice() {
  const intro = box();
  intro.classList.add("phone");
  intro.hidden = false;
  showVersion(intro);
  languages(intro);
  document.querySelector("#loading").hidden = true;
  document.querySelector("#hud").hidden = true;
  const copy = intro.querySelector("#intro-copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href.split("?")[0]);
      copy.textContent = "Link kopiert";
    } catch {
      copy.textContent = location.href.split("?")[0];
    }
  });
}

// Shows the card at once, while the river is still being built; `ready()` enables the
// button, and the promise resolves when it is pressed.
export function showIntro({ resume = null } = {}) {
  const intro = box();
  const button = intro.querySelector("#intro-start");
  const status = intro.querySelector("#intro-status");
  intro.hidden = false;
  showVersion(intro);
  languages(intro);
  homeScreen(intro);
  if (asApp()) track("app");
  button.disabled = true;
  button.textContent = "Der Fluss entsteht …";
  if (resume) status.textContent = `Gespeichert: ${resume}`;
  // Vegan mode (vegan.js): nobody is eaten; kept for next time.
  const vegan = intro.querySelector("#intro-vegan");
  if (vegan) {
    vegan.checked = mode.vegan;
    vegan.addEventListener("change", () => {
      setVegan(vegan.checked);
      track("vegan", { on: vegan.checked });
    });
  }
  let release;
  const started = new Promise((resolve) => (release = resolve));
  button.addEventListener("click", () => {
    intro.classList.add("leaving");
    setTimeout(() => (intro.hidden = true), 500);
    release();
  });
  // With a fish saved: a small way to start over instead (asked twice, it cannot be undone).
  const fresh = intro.querySelector("#intro-new");
  if (fresh) {
    fresh.hidden = !resume;
    let sure = false;
    fresh.addEventListener("click", () => {
      if (!sure) {
        sure = true;
        fresh.textContent = "Wirklich? Dein Lachs geht verloren – nochmal klicken";
        return;
      }
      clearSave();
      location.replace(location.pathname);
    });
  }
  return {
    started,
    ready() {
      button.disabled = false;
      button.textContent = resume ? "Weiterschwimmen" : "Losschwimmen";
      button.focus({ preventScroll: true });
    },
  };
}
