import { t } from "./i18n.js";
// What is on screen besides the river: a small card with the fish's life -- the stage it is
// in among the ten, its strength, its growth toward the next stage and what is in its
// stomach (for the alevin, its yolk). (The way home from the sea is on the map.) Words
// appear only when something changes: a new stage of life, a fall climbed, a death; and
// what was just eaten floats up from the stomach bar.

const FOOD_NAMES = {
  blackfly: "Kriebelmückenlarve",
  egg: "Forellenei",
  leech: "Egel",
  snail: "Schnecke",
  ant: "Ameise",
  fly: "Fliege",
  earthworm: "Regenwurm!",
  midge: "Zuckmückenlarve",
  mayfly: "Eintagsfliegenlarve",
  caddis: "Köcherfliegenlarve",
  stonefly: "Steinfliegenlarve",
  gammarus: "Bachflohkrebs",
  insect: "Käfer",
  krill: "Krill",
  minnow: "Elritze",
  stickleback: "Stichling",
  sandeel: "Sandaal",
  herring: "Hering",
  mackerel: "Makrele",
  bread: "Brotkrume",
  pellet: "Futterpellet",
};

// On a phone the keys the tips name are the touch controls: each key drawn as the button
// or the stick that does the same (whatever the language the key was written in).
const TOUCH_KEYS = [
  [/^(Leertaste|Space|空格|スペース|Интервал)$/i, "bite"],
  [/^W$/i, "go"],
  [/^(A|D|A\/D)$/i, "look"],
  [/^M$/i, "map"],
  [/^P$/i, "pause"],
];
function touchKeys(root) {
  if (!document.querySelector("#habitat")?.classList.contains("touch")) return;
  for (const kbd of root.querySelectorAll("kbd")) {
    const hit = TOUCH_KEYS.find(([re]) => re.test(kbd.textContent.trim()));
    if (!hit) continue;
    kbd.textContent = "";
    kbd.className = `touch-key ${hit[1]}`;
  }
}

export function createHud({ stages }) {
  const nameBox = document.querySelector("#status .stage-name");
  // One dot a stage; a little gap where a new phase of life begins.
  const lifeBox = document.querySelector("#status .life");
  lifeBox.innerHTML = stages.map((st, i) => `<li${i > 0 && st.phase !== stages[i - 1].phase ? ' class="phase"' : ""}></li>`).join("");
  const lifeDots = [...lifeBox.querySelectorAll("li")];
  const energy = document.querySelector("#energy");
  const energyFill = energy.querySelector(".fill");
  const energyReach = energy.querySelector(".pending");
  const energyName = energy.querySelector(".name");
  const windedVeil = document.querySelector("#winded");
  const growth = document.querySelector("#growth");
  const growthFill = growth.querySelector(".fill");
  const growthPending = growth.querySelector(".pending");
  const growthNext = growth.querySelector(".next");
  const growthWait = growth.querySelector(".wait");
  const stomach = document.querySelector("#stomach");
  const stomachFill = stomach.querySelector(".fill");
  const stomachLabel = stomach.querySelector(".label");
  const pops = document.querySelector("#pops");
  const toastBox = document.querySelector("#toast");
  const toastTitle = toastBox.querySelector(".title");
  const toastLine = toastBox.querySelector(".line");
  const hintBox = document.querySelector("#hint");
  const seasonBox = document.querySelector("#season");
  const seasonGlyph = seasonBox.querySelector(".glyph");
  const seasonText = seasonBox.querySelector(".text");
  const seasonDegrees = seasonBox.querySelector(".degrees");
  let shownWhen = "";
  let shownDegrees = "";
  const veilBox = document.querySelector("#veil");
  let toastTimer = 0;
  let hintShown = false;
  let hintTimer = 0;
  let leapHintShown = 0;
  let shownStage = -1;
  let shownReserve = null;
  let shownYolk = null;
  let lastPop = 0;
  let tipsSeen = {};
  try {
    tipsSeen = JSON.parse(localStorage.getItem("salmon-survival-tips") || "{}");
  } catch {}

  function toast(title, line = "", seconds = 5) {
    toastTitle.textContent = t(title);
    toastLine.textContent = t(line);
    toastBox.classList.add("shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.remove("shown"), seconds * 1000);
  }
  function showHint(html, seconds, lore = false) {
    hintBox.innerHTML = lore ? html : t(html);
    touchKeys(hintBox);
    hintBox.classList.toggle("lore", lore);
    hintBox.hidden = false;
    hintBox.classList.remove("fading");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintBox.classList.add("fading");
      setTimeout(() => (hintBox.hidden = true), 1000);
    }, seconds * 1000);
  }
  function bump(element, name) {
    element.classList.remove(name);
    void element.offsetWidth;
    element.classList.add(name);
  }
  const bar = (fill, value) => (fill.style.transform = `scaleX(${Math.min(1, Math.max(0, value)).toFixed(3)})`);
  // The same three as rings (shown on phones instead of the bars).
  const rings = document.querySelector("#status .rings");
  const ring = (name) => rings?.querySelector(`.${name}`);
  const ringOf = { energyNow: ring("energy-now"), energyReach: ring("energy-reach"), growthNow: ring("growth-now"), growthPending: ring("growth-pending"), stomachNow: ring("stomach-now"), stomachTrack: ring("stomach-track") };
  const stageNumber = rings?.querySelector(".stage-number");
  // On a phone only the rings show; a tap on them opens the full card (as on a computer),
  // another tap closes it again.
  // (On the lifting of the finger, and on click as well -- whichever comes first.)
  const statusBox = document.querySelector("#status");
  let toggledAt = 0;
  const toggleCard = (event) => {
    const habitat = document.querySelector("#habitat");
    if (!habitat?.classList.contains("touch")) return;
    event.stopPropagation();
    const now = performance.now();
    if (now - toggledAt < 450) return;
    toggledAt = now;
    const open = statusBox.classList.toggle("expanded");
    habitat.classList.toggle("stats-open", open);
  };
  statusBox.addEventListener("pointerup", toggleCard);
  statusBox.addEventListener("click", toggleCard);
  // On a phone a tip or a story is a banner at the top: swiped up, it goes.
  let swipe = null;
  hintBox.addEventListener("pointerdown", (event) => {
    if (!document.querySelector("#habitat")?.classList.contains("touch")) return;
    event.stopPropagation();
    swipe = { id: event.pointerId, y: event.clientY, dy: 0 };
    hintBox.setPointerCapture(event.pointerId);
    hintBox.style.transition = "none";
  });
  hintBox.addEventListener("pointermove", (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    swipe.dy = Math.min(0, event.clientY - swipe.y);
    hintBox.style.translate = `0 ${swipe.dy}px`;
  });
  const letGo = (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const away = swipe.dy < -24;
    swipe = null;
    hintBox.style.transition = "";
    if (away) {
      clearTimeout(hintTimer);
      hintBox.style.translate = "0 -140%";
      setTimeout(() => {
        hintBox.hidden = true;
        hintBox.style.translate = "";
      }, 260);
    } else hintBox.style.translate = "";
  };
  hintBox.addEventListener("pointerup", letGo);
  hintBox.addEventListener("pointercancel", letGo);
  const arc = (element, value) => {
    if (!element) return;
    const v = Math.min(1, Math.max(0, value));
    element.style.strokeDasharray = `${(v * 100).toFixed(1)} 100`;
    element.classList.toggle("none", v < 0.005);
  };

  return {
    update({ energy: e, breath: puff = 1, winded = false, progress, pending = 0, stomach: full = null, yolk = false, stage, reserve, leapHint, waitSea = false }) {
      // A smolt grown as far as it can in fresh water: the next stage only in the sea.
      if (growthWait.hidden === waitSea) {
        growthWait.hidden = !waitSea;
        growth.classList.toggle("waiting", waitSea);
      }
      energy.classList.toggle("winded", winded);
      windedVeil.classList.toggle("on", winded);
      if (stage !== shownStage) {
        shownStage = stage;
        nameBox.textContent = stages[stage].name;
        lifeDots.forEach((dot, i) => {
          dot.classList.toggle("done", i < stage);
          dot.classList.toggle("now", i === stage);
        });
        growthNext.textContent = stage < stages.length - 1 ? `→ ${stages[stage + 1].name}` : "→ Laichen";
        growth.setAttribute("aria-label", `Wachstum zum ${stage < stages.length - 1 ? stages[stage + 1].name : "Laichen"}`);
      }
      if (reserve !== shownReserve) {
        shownReserve = reserve;
        energyName.textContent = reserve ? "Reserven" : "Kraft";
        energy.setAttribute("aria-label", reserve ? "Reserven" : "Kraft");
      }
      if (yolk !== shownYolk) {
        shownYolk = yolk;
        stomachLabel.textContent = yolk ? "Dottersack" : "Magen";
        stomach.classList.toggle("yolk", yolk);
        stomach.setAttribute("aria-label", yolk ? "Dottersack" : "Magen");
      }
      // Bright: what it can call on now; striped behind it: how far that can come back.
      bar(energyFill, Math.min(puff, e));
      bar(energyReach, e);
      energy.classList.toggle("low", e < 0.3 && !reserve);
      energy.classList.toggle("empty", e < 0.08);
      energy.classList.toggle("reserve", reserve);
      energy.setAttribute("aria-valuenow", String(Math.round(e * 100)));
      bar(growthFill, progress);
      bar(growthPending, progress + pending);
      growth.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
      stomach.hidden = full == null;
      if (full != null) {
        bar(stomachFill, full);
        stomach.setAttribute("aria-valuenow", String(Math.round(full * 100)));
      }
      if (rings) {
        arc(ringOf.energyNow, Math.min(puff, e));
        arc(ringOf.energyReach, e);
        arc(ringOf.growthNow, progress);
        arc(ringOf.growthPending, progress + pending);
        arc(ringOf.stomachNow, full ?? 0);
        ringOf.stomachTrack.style.display = ringOf.stomachNow.style.display = full == null ? "none" : "";
        rings.classList.toggle("winded", winded);
        rings.classList.toggle("low", e < 0.3 && !reserve);
        rings.classList.toggle("reserve", !!reserve);
        rings.classList.toggle("yolk", !!yolk);
        rings.classList.toggle("waiting", waitSea);
        const number = String(stage + 1);
        if (stageNumber.textContent !== number) stageNumber.textContent = number;
      }
      if (leapHint && leapHintShown < 3 && hintBox.hidden) {
        leapHintShown++;
        showHint(leapHint, 4.5);
      }
    },
    // The calendar line: month and time of day, and the water's temperature here.
    calendar({ month, season, hour, night, hatch, temperature, sea }) {
      const time = night > 0.6 ? "Nacht" : hatch > 0.3 || (hour > 16.5 && hour < 20) ? "Abend" : hour < 9 ? "Morgen" : "Tag";
      const glyph = night > 0.6 ? "☾" : { spring: "✿", summer: "☀", autumn: "❦", winter: "❄" }[season];
      const when = `${glyph}|${month} · ${time}`;
      if (when !== shownWhen) {
        shownWhen = when;
        seasonGlyph.textContent = glyph;
        seasonText.textContent = `${month} · ${time}`;
      }
      const degrees = `${Math.round(temperature)} °C`;
      if (degrees !== shownDegrees) {
        shownDegrees = degrees;
        seasonDegrees.textContent = degrees;
      }
      seasonBox.classList.toggle("cold", temperature < 4);
      seasonBox.classList.toggle("warm", temperature >= 17 && temperature < 20);
      seasonBox.classList.toggle("hot", temperature >= 20 && !sea);
    },
    // A tip, once per kind (remembered across visits), shown when the moment comes.
    tip(kind, html, seconds = 8) {
      // (A story or a fact gives way to a tip.)
      if (tipsSeen[kind] || (!hintBox.hidden && !hintBox.classList.contains("lore"))) return false;
      tipsSeen[kind] = true;
      try {
        localStorage.setItem("salmon-survival-tips", JSON.stringify(tipsSeen));
      } catch {}
      showHint(html, seconds);
      return true;
    },
    seen: (kind) => !!tipsSeen[kind],
    // A story or a fact (lore.js), already in the player's language, under a small kicker;
    // only when nothing else is shown there. `null` takes a shown one away.
    lore(text, kicker = "", seconds = 10) {
      if (text === null) {
        if (!hintBox.hidden && hintBox.classList.contains("lore")) {
          clearTimeout(hintTimer);
          hintBox.classList.add("fading");
          hintTimer = setTimeout(() => (hintBox.hidden = true), 1000);
        }
        return true;
      }
      if (!hintBox.hidden) return false;
      const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
      showHint(`${kicker ? `<span class="kicker">${escape(kicker)}</span>` : ""}${text}`, seconds, true);
      return true;
    },
    // Whether the tip line at the foot of the screen is free.
    get hintFree() {
      return hintBox.hidden;
    },
    paused(on, touch = false) {
      veilBox.classList.toggle("dim", on);
      if (on) toast("Pause", touch ? "Tipp ins Bild zum Weiterschwimmen" : "Klick ins Bild oder P zum Weiterschwimmen", 3600);
      else toastBox.classList.remove("shown");
    },
    // Something eaten: the bars bounce and its name floats up.
    fed(kind) {
      bump(energy, "fed");
      bump(stomach, "fed");
      const now = performance.now();
      if (!kind || now - lastPop < 260) return;
      lastPop = now;
      const pop = document.createElement("span");
      pop.textContent = `+ ${FOOD_NAMES[kind] ?? "Happen"}`;
      pops.append(pop);
      setTimeout(() => pop.remove(), 1700);
    },
    // A word floating up from the card, as for food: something that just happened.
    note(text) {
      const pop = document.createElement("span");
      pop.textContent = t(text);
      pop.className = "note";
      pops.append(pop);
      setTimeout(() => pop.remove(), 1700);
    },
    grew() {
      bump(growth, "grew");
    },
    // The fish being fought: its bar over it on the screen, or nothing.
    foe(info) {
      const box = document.querySelector("#foe");
      if (!info) {
        if (!box.hidden && !box.classList.contains("fading")) {
          box.classList.add("fading");
          clearTimeout(box._gone);
          box._gone = setTimeout(() => (box.hidden = true), 400);
        }
        return;
      }
      clearTimeout(box._gone);
      box.classList.remove("fading");
      box.hidden = false;
      if (box._name !== info.title) {
        box._name = info.title;
        box.querySelector(".name").textContent = info.title;
      }
      const state = info.beaten ? "besiegt" : info.winded ? "außer Atem!" : info.weak ? "geschwächt" : "";
      if (box._state !== state) {
        box._state = state;
        box.querySelector(".state").textContent = state;
      }
      box.classList.toggle("winded", !!info.winded && !info.beaten);
      box.classList.toggle("beaten", !!info.beaten);
      box.querySelector(".pending").style.transform = `scaleX(${Math.max(0, info.kraft).toFixed(3)})`;
      box.querySelector(".fill").style.transform = `scaleX(${Math.max(0, Math.min(info.puste, info.kraft)).toFixed(3)})`;
      box.style.left = `${info.x.toFixed(1)}px`;
      box.style.top = `${info.y.toFixed(1)}px`;
      if (info.hit) bump(box, "hit");
    },
    // Whether a hunter has the fish in sight: "seen", "hidden" (one is about, but cannot
    // see it), or null. A change to nothing waits a moment, so it does not flicker.
    watch(state) {
      const box = document.querySelector("#watch");
      const now = performance.now();
      if (!state) {
        if (!box.hidden && now - (box._since ?? 0) > 1200 && !box.classList.contains("fading")) {
          box.classList.add("fading");
          clearTimeout(box._gone);
          box._gone = setTimeout(() => {
            box.hidden = true;
            box._state = null;
          }, 400);
        }
        return;
      }
      box._since = now;
      clearTimeout(box._gone);
      box.classList.remove("fading");
      box.hidden = false;
      if (box._state === state) return;
      box._state = state;
      box.classList.toggle("seen", state === "seen");
      box.classList.toggle("unseen", state === "hidden");
      box.querySelector(".text").textContent = state === "seen" ? "Du wirst gesehen" : "Versteckt";
    },
    // A new stage of life: the banner, for a few seconds.
    // The brood: which sibling this is, and how many of them are still alive.
    brood(who, left) {
      const box = document.querySelector("#status .brood");
      if (!box) return;
      box.hidden = false;
      const whoBox = box.querySelector(".who");
      const leftBox = box.querySelector(".left");
      if (whoBox.textContent !== who) whoBox.textContent = who;
      if (leftBox.textContent !== left) {
        const fewer = leftBox.textContent !== "";
        leftBox.textContent = left;
        if (fewer) bump(box, "fell");
      }
    },
    milestone(stage, line, lengthCm, siblings = "") {
      const box = document.querySelector("#milestone");
      const glow = document.querySelector("#glow");
      box.querySelector(".siblings").textContent = siblings;
      box.querySelector(".title").textContent = stages[stage].name;
      box.querySelector(".size").textContent = `${lengthCm} cm lang`;
      box.querySelector(".line").textContent = line;
      box.querySelector(".dots").innerHTML = stages
        .map((st, i) => {
          const cls = [i > 0 && st.phase !== stages[i - 1].phase ? "phase" : "", i < stage ? "done" : i === stage ? "now" : ""].filter(Boolean).join(" ");
          return `<li${cls ? ` class="${cls}"` : ""}></li>`;
        })
        .join("");
      clearTimeout(box._timer);
      clearTimeout(box._gone);
      box.classList.remove("leaving");
      box.hidden = true;
      void box.offsetWidth;
      box.hidden = false;
      glow.classList.add("on");
      setTimeout(() => glow.classList.remove("on"), 1600);
      box._timer = setTimeout(() => {
        box.classList.add("leaving");
        box._gone = setTimeout(() => (box.hidden = true), 1300);
      }, 5600);
      toastBox.classList.remove("shown");
    },
    // A burst asked for with no breath left: the breath bar shakes its head.
    short() {
      bump(energy, "short");
    },
    toast,
    // The controls, once, until the first key or click.
    hint(touch = false) {
      if (hintShown) return;
      hintShown = true;
      hintBox.classList.remove("lore");
      hintBox.innerHTML = t(
        touch
          ? "Wischen: umschauen und lenken · <kbd>W</kbd> halten: schwimmen · <kbd>Leertaste</kbd> Spurt, Biss, Sprung – oder den Daumen hinüberrutschen · Karte ein/aus im Pausemenü"
          : "Klick ins Bild: Maus lenkt · <kbd>W</kbd> schwimmen · <kbd>S</kbd> bremsen · <kbd>A</kbd>/<kbd>D</kbd> ausweichen · <kbd>Leertaste</kbd> Spurt, Biss, Sprung · <kbd>M</kbd> Karte · <kbd>L</kbd> Logbuch · <kbd>P</kbd> Pause",
      );
      touchKeys(hintBox);
      hintBox.hidden = false;
      hintTimer = setTimeout(() => this.touched(), 14000);
    },
    touched() {
      if (hintBox.hidden || hintBox.classList.contains("fading")) return;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hintBox.classList.add("fading");
        setTimeout(() => (hintBox.hidden = true), 1000);
      }, 6000);
    },
    veil(kind) {
      veilBox.classList.remove("white");
      if (kind === "white") veilBox.classList.add("white");
      veilBox.classList.toggle("dark", !!kind);
    },
  };
}
