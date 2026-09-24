import { STAGES } from "./salmon.js";

// The game keeps itself: every few seconds, and whenever the page is hidden or closed, the
// fish's life so far goes into the browser's storage, and it picks up there next time.
// ?new starts a fresh life without forgetting the old one; ?reset forgets it.

const KEY = "salmon-survival-v1";
// Saves from before the life had ten stages had six; they are carried over by the fish's
// length (a parr halfway through its old, long parr stage is now a Jährling or a Parr).
const VERSION = 2;
const OLD_STAGES = [
  { length: [0.22, 0.3], id: "alevin" },
  { length: [0.3, 0.65] },
  { length: [0.65, 1.5] },
  { length: [1.5, 2.2], id: "smolt" },
  { length: [2.2, 8.5] },
  { length: [8.5, 9], id: "spawner" },
];
function carryOver(stage, progress = 0) {
  const old = OLD_STAGES[Math.max(0, Math.min(OLD_STAGES.length - 1, stage))];
  if (old.id) return { stage: STAGES.findIndex((st) => st.id === old.id), progress };
  const L = old.length[0] + (old.length[1] - old.length[0]) * Math.max(0, Math.min(1, progress));
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const st = STAGES[i];
    if (st.fasting || st.yolk || L < st.length[0]) continue;
    return { stage: i, progress: Math.min(0.95, (L - st.length[0]) / (st.length[1] - st.length[0])) };
  }
  return { stage: 1, progress: 0 };
}
function migrate(data) {
  if (!data || data.version === VERSION || !Number.isInteger(data.stage)) return data;
  const now = carryOver(data.stage, data.progress);
  data.stage = now.stage;
  data.progress = now.progress;
  if (data.checkpoint && Number.isInteger(data.checkpoint.stage)) data.checkpoint.stage = carryOver(data.checkpoint.stage, 0).stage;
  data.stomach = 0;
  data.version = VERSION;
  return data;
}

// There is only ever one life saved. A new game forgets it (the logbook and the badges are
// kept) -- and nothing may write it back while the page goes.
let cleared = false;
export function clearSave() {
  cleared = true;
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// Whether there is a life to go back to, and at which stage (for the title card).
export function savedStage() {
  const query = new URLSearchParams(location.search);
  if (query.has("new") || query.has("reset")) return null;
  try {
    const data = migrate(JSON.parse(localStorage.getItem(KEY) || "null"));
    return data && Number.isInteger(data.stage) ? { stage: data.stage, generation: data.generation ?? 0 } : null;
  } catch {
    return null;
  }
}

export function createSave() {
  const query = new URLSearchParams(location.search);
  // Development runs (a jump to a stage or place, or the capture harness) leave the saved
  // life alone unless asked to keep theirs.
  const readOnly = !query.has("save") && ["capture", "stage", "at", "pace"].some((k) => query.has(k));
  let generation = 0;
  const api = {
    get generation() {
      return generation;
    },
    set generation(value) {
      generation = value;
    },
    load() {
      try {
        if (query.has("reset")) localStorage.removeItem(KEY);
        const text = localStorage.getItem(KEY);
        if (!text) return null;
        const data = migrate(JSON.parse(text));
        generation = data.generation ?? 0;
        if (!Array.isArray(data.position) || data.position.length !== 3 || !data.position.every(Number.isFinite)) return null;
        return data;
      } catch {
        return null;
      }
    },
    store(data) {
      if (readOnly || cleared) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...data, version: VERSION, generation, saved: Date.now() }));
      } catch {}
    },
  };
  return api;
}
