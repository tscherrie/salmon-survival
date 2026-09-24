import { lang, t } from "./i18n.js";
import { word, formatNumber, ageText, distanceText, REGION_WORDS } from "./brood.js";
import { track } from "./track.js";

// The card at the end of a life: which of the brood it was, how it died (or that it made
// it home), where and when, how old it got and what it did -- and how many of its siblings
// are still out there. It can be shared as a picture (or saved, or posted on X); the button
// goes on with the next sibling, or, when none is left, a new brood.

const SITE = "https://salmon-survival.vercel.app";
const pick = (e) => (e ? (e[lang] ?? e.en ?? e.de) : "");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function createLifeCard({ habitat, onGo }) {
  const box = document.createElement("div");
  box.id = "lifecard";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = `
    <div class="card">
      <div class="head">
        <img class="icon" src="icons/icon-192.png" alt="" />
        <div>
          <p class="kicker"></p>
          <h2 class="name"></h2>
          <p class="cause"></p>
          <p class="where"></p>
        </div>
      </div>
      <dl class="stats"></dl>
      <p class="siblings"></p>
      <button class="go" type="button"></button>
      <div class="more">
        <button class="share" type="button"></button>
        <button class="save" type="button"></button>
        <button class="x" type="button" aria-label="X">𝕏</button>
      </div>
      <p class="status" aria-live="polite"></p>
    </div>`;
  habitat.append(box);
  const $ = (sel) => box.querySelector(sel);
  let current = null;
  let shown = false;

  // The card as a picture, 1200 × 675 (what X and most chats show whole).
  const icon = new Image();
  icon.src = "icons/icon-512.png";
  async function picture() {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 675;
    const g = c.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 0, 675);
    bg.addColorStop(0, "#113f4a");
    bg.addColorStop(1, "#06141a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1200, 675);
    // A few lines of current across the back.
    g.strokeStyle = "rgba(160, 235, 210, 0.07)";
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      for (let x = 0; x <= 1200; x += 20) g.lineTo(x, 90 + i * 70 + Math.sin(x / 140 + i) * 14);
      g.stroke();
    }
    try {
      if (!icon.complete) await new Promise((r) => ((icon.onload = r), (icon.onerror = r)));
      g.save();
      g.beginPath();
      g.roundRect(70, 70, 230, 230, 46);
      g.clip();
      g.drawImage(icon, 70, 70, 230, 230);
      g.restore();
    } catch {}
    const font = (w, s) => `${w} ${s}px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`;
    const d = current;
    g.textBaseline = "alphabetic";
    g.fillStyle = "#8fe3c0";
    g.font = font(800, 26);
    g.fillText(d.kicker.toUpperCase(), 340, 110);
    g.fillStyle = "#f3fbf7";
    g.font = font(900, 72);
    g.fillText(d.name, 336, 185);
    g.fillStyle = d.kind === "home" ? "#ffd98a" : "#ffb08a";
    g.font = font(800, 34);
    wrap(g, d.cause, 340, 238, 800, 40, 2);
    g.fillStyle = "rgba(243, 251, 247, 0.7)";
    g.font = font(700, 26);
    g.fillText(d.where, 340, 320);
    // The numbers, three by two.
    d.stats.forEach(([label, value], i) => {
      const x = 70 + (i % 3) * 370;
      const y = 400 + Math.floor(i / 3) * 105;
      g.fillStyle = "rgba(243, 251, 247, 0.6)";
      g.font = font(700, 22);
      g.fillText(label, x, y);
      g.fillStyle = "#f3fbf7";
      g.font = font(900, 40);
      g.fillText(value, x, y + 46);
    });
    g.fillStyle = "#ffd98a";
    g.font = font(800, 26);
    g.fillText(d.siblings, 70, 628);
    g.fillStyle = "rgba(243, 251, 247, 0.55)";
    g.font = font(700, 22);
    g.textAlign = "right";
    g.fillText("Salmon Survival · salmon-survival.vercel.app", 1130, 628);
    g.textAlign = "left";
    return await new Promise((r) => c.toBlob(r, "image/png"));
  }
  function wrap(g, text, x, y, width, lineHeight, maxLines) {
    const words = text.split(/(\s+)/);
    let line = "",
      n = 0;
    // Languages without spaces break anywhere.
    const parts = /\s/.test(text) ? words : [...text];
    for (const part of parts) {
      const test = line + part;
      if (g.measureText(test).width > width && line) {
        g.fillText(line.trim(), x, y + n * lineHeight);
        line = part.trimStart();
        if (++n >= maxLines) return;
      } else line = test;
    }
    if (line) g.fillText(line.trim(), x, y + n * lineHeight);
  }
  const status = (text) => {
    $(".status").textContent = text;
    clearTimeout(status._t);
    status._t = setTimeout(() => ($(".status").textContent = ""), 3500);
  };

  $(".go").addEventListener("click", (event) => {
    event.stopPropagation();
    go();
  });
  $(".share").addEventListener("click", async (event) => {
    event.stopPropagation();
    track("card", { action: "share", kind: current.kind });
    const text = `${current.share} ${SITE}`;
    try {
      const blob = await picture();
      const file = blob && new File([blob], `salmon-survival-${current.number}.png`, { type: "image/png" });
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text, title: "Salmon Survival" });
      else if (navigator.share) await navigator.share({ text: current.share, url: SITE, title: "Salmon Survival" });
      else {
        await navigator.clipboard.writeText(text);
        status(word("copied"));
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        status(word("copied"));
      } catch {}
    }
  });
  $(".save").addEventListener("click", async (event) => {
    event.stopPropagation();
    track("card", { action: "save", kind: current.kind });
    const blob = await picture();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `salmon-survival-${current.number}.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  $(".x").addEventListener("click", (event) => {
    event.stopPropagation();
    track("card", { action: "x", kind: current.kind });
    const url = `https://x.com/intent/post?text=${encodeURIComponent(current.share)}&url=${encodeURIComponent(SITE)}`;
    window.open(url, "_blank", "noopener");
  });

  function go() {
    if (!shown) return;
    shown = false;
    box.classList.add("leaving");
    setTimeout(() => {
      box.hidden = true;
      box.classList.remove("leaving");
    }, 350);
    const kind = current?.kind;
    current = null;
    onGo(kind);
  }

  return {
    get open() {
      return shown;
    },
    picture,
    go,
    // kind: "death" (a sibling goes on), "lost" (none left), "home" (spawned).
    // life: the account from the brood; fish: { stage name, stage id, progress }; where.
    // handed: what a life that spawned hands on to its brood (the traits' German names).
    show({ kind, life, stageName, stageId, progress, cause = "", region = "", month = "", next = 0, left = 0, size = 2000, handed = [] }) {
      const age = ageText(stageId, progress);
      const dist = distanceText(life.distance);
      const vars = { n: String(life.number), size: formatNumber(size), left: formatNumber(left), next: String(next), age, dist, eaten: formatNumber(life.eaten), cause: t(cause), name: word("salmon", { n: String(life.number) }) };
      const kicker = kind === "home" ? word("homeTitle") : kind === "lost" ? word("lostTitle") : word("kicker");
      const where = [cap(pick(REGION_WORDS[region])), t(month)].filter(Boolean).join(" · ");
      current = {
        kind,
        number: life.number,
        kicker,
        name: t(stageName),
        cause: kind === "home" ? word("homeLine", vars) : t(cause),
        where,
        stats: [
          [word("age"), age],
          [word("distance"), dist],
          [word("eaten"), vars.eaten],
          [word("fights"), formatNumber(life.fights)],
          [word("escapes"), formatNumber(life.escapes)],
          [word("leaps"), formatNumber(life.leaps)],
        ],
        siblings: kind === "lost" ? word("lostLine", vars) : kind === "home" && handed.length ? `${word("left", vars)} · ${t("Vererbt")}: ${handed.map((h) => t(h)).join(", ")}` : word("left", vars),
        share: kind === "home" ? word("homeShare", vars) : kind === "lost" ? word("lostShare", vars) : word("deathShare", vars),
      };
      $(".kicker").textContent = current.kicker;
      $(".name").textContent = current.name;
      $(".cause").textContent = current.cause;
      $(".cause").classList.toggle("home", kind === "home");
      $(".where").textContent = where;
      $(".stats").innerHTML = "";
      for (const [label, value] of current.stats) {
        const item = document.createElement("div");
        item.innerHTML = "<dt></dt><dd></dd>";
        item.querySelector("dt").textContent = label;
        item.querySelector("dd").textContent = value;
        $(".stats").append(item);
      }
      $(".siblings").textContent = current.siblings;
      $(".go").textContent = kind === "past" ? word("close") : kind === "death" ? word("next", vars) : kind === "lost" ? word("newBrood") : word("goOn");
      $(".share").textContent = word("share");
      $(".save").textContent = word("save");
      $(".status").textContent = "";
      box.hidden = false;
      box.classList.remove("leaving");
      shown = true;
      track("card", { action: "shown", kind, stage: stageId });
      setTimeout(() => $(".go").focus({ preventScroll: true }), 50);
    },
  };
}
