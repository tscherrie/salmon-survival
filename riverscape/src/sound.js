// What a river sounds like with your head under the water: not the splash and chatter you
// hear from the bank, but a deep, close, muffled rush -- the whole body of moving water
// pressing on the ears -- with the treble gone, a slow swell and fall in it, the gurgle of
// eddies round the stones, and the small liquid "blip" of bubbles ringing as they form and
// break loose (each one a tiny resonator, singing at a pitch set by its size; Minnaert
// 1933). A shower on the surface overhead adds a soft, fizzing patter. At night the river
// is the same river, heard a little quieter and darker.
//
// All of it is made here with the Web Audio API from noise and filters; nothing is
// recorded. Browsers only allow sound after the page has been clicked or a key pressed,
// so it starts on the first touch, and M turns it off and on (the choice is remembered).

const STORAGE_KEY = "habitat-sound";

export function createRiverSound() {
  let enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {}
  let context = null;
  let master = null;
  let nodes = null;
  let hushed = false;
  let clock = 0;
  let nextGurgle = 0;
  let nextBubble = 0;

  // A few seconds of noise, looped. Brown noise (integrated white) for the deep rush, pink
  // (a sum of octave-spaced filtered noises, Voss-McCartney style) for the gurgles.
  function noiseBuffer(kind, seconds = 9) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let brown = 0;
      const rows = new Float32Array(8);
      let running = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === "brown") {
          brown = (brown + 0.02 * white) / 1.02;
          data[i] = brown * 3.5;
        } else {
          // Pink: update one row per sample, chosen by the trailing zeros of the index.
          const k = i === 0 ? 0 : Math.min(7, Math.log2(i & -i) | 0);
          running -= rows[k];
          rows[k] = Math.random() * 2 - 1;
          running += rows[k];
          data[i] = (running + white) / 9;
        }
      }
      // Cross-fade the loop's ends so the join is silent.
      const fade = Math.floor(context.sampleRate * 0.25);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[length - fade + i] = data[length - fade + i] * (1 - t) + data[i] * t;
      }
    }
    return buffer;
  }
  function loop(buffer) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0.25;
    source.loopEnd = buffer.duration;
    source.start(0, Math.random() * buffer.duration * 0.8);
    return source;
  }
  function filter(type, frequency, q = 0.7, gain = 0) {
    const f = context.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }
  function amp(value) {
    const g = context.createGain();
    g.gain.value = value;
    return g;
  }

  function build() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    context = new Context({ latencyHint: "playback" });
    master = amp(0);
    // The water is the room: everything goes through one dark, gently compressed bus.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.ratio.value = 3;
    const muffle = filter("lowpass", 1400, 0.5);
    master.connect(muffle).connect(compressor).connect(context.destination);

    const brown = noiseBuffer("brown");
    const pink = noiseBuffer("pink");

    // The rush: deep brown noise, low-passed, with a slow swell.
    const rushSource = loop(brown);
    const rushFilter = filter("lowpass", 420, 0.6);
    const rushGain = amp(0.55);
    rushSource.connect(rushFilter).connect(rushGain).connect(master);
    // A still lower rumble under it, the weight of the current.
    const rumbleSource = loop(brown);
    const rumbleFilter = filter("lowpass", 90, 0.9);
    const rumbleGain = amp(0.5);
    rumbleSource.connect(rumbleFilter).connect(rumbleGain).connect(master);

    // Eddies: pink noise through a handful of narrow band-passes whose pitch and level
    // wander, so the rush is never a flat hiss but keeps turning over.
    const gurgles = [];
    for (let i = 0; i < 5; i++) {
      const source = loop(pink);
      const band = filter("bandpass", 220 + i * 140, 6 + i);
      const level = amp(0);
      const pan = context.createStereoPanner ? context.createStereoPanner() : null;
      if (pan) pan.pan.value = (i / 4) * 1.4 - 0.7;
      source.connect(band).connect(level);
      if (pan) level.connect(pan).connect(master);
      else level.connect(master);
      gurgles.push({ band, level, base: 220 + i * 140 });
    }

    // Rain on the surface overhead: a soft fizz, heard through the water.
    const rainSource = loop(pink);
    const rainHigh = filter("highpass", 700, 0.5);
    const rainBand = filter("lowpass", 3200, 0.5);
    const rainGain = amp(0);
    rainSource.connect(rainHigh).connect(rainBand).connect(rainGain).connect(master);

    // Bubbles ring through their own soft filter.
    const bubbleBus = amp(0.6);
    bubbleBus.connect(filter("lowpass", 2200, 0.5)).connect(master);

    nodes = { rushFilter, rushGain, rumbleGain, gurgles, rainGain, rainBand, bubbleBus, muffle };
    return true;
  }

  // One bubble: a sine whose pitch rises quickly as it leaves the bed and whose ring dies
  // away in a few hundredths of a second.
  function bubble(at, loudness) {
    const osc = context.createOscillator();
    const env = context.createGain();
    const pitch = 350 + Math.random() * 900;
    osc.frequency.setValueAtTime(pitch, at);
    osc.frequency.exponentialRampToValueAtTime(pitch * (1.3 + Math.random() * 0.6), at + 0.06);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(loudness, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0005, at + 0.05 + Math.random() * 0.06);
    let out = env;
    if (context.createStereoPanner) {
      const pan = context.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      env.connect(pan);
      out = pan;
    }
    osc.connect(env);
    out.connect(nodes.bubbleBus);
    osc.start(at);
    osc.stop(at + 0.16);
  }

  const level = () => (enabled && !hushed ? 0.32 : 0);
  function fadeTo(value, seconds) {
    if (!context) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  return {
    // Called on the first click or key press: only then may the page make a sound.
    start() {
      if (!enabled) return;
      if (!context && !build()) return;
      if (context.state === "suspended") context.resume();
      fadeTo(level(), 3);
    },
    toggle() {
      enabled = !enabled;
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
      } catch {}
      if (enabled) this.start();
      else fadeTo(0, 0.6);
      return enabled;
    },
    get enabled() {
      return enabled;
    },
    get state() {
      return context ? context.state : "not started";
    },
    // A small, wet gulp: something eaten.
    gulp(loudness = 0.25) {
      if (!context || !nodes || context.state !== "running" || !enabled) return;
      const at = context.currentTime + 0.01;
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.frequency.setValueAtTime(260 + Math.random() * 60, at);
      osc.frequency.exponentialRampToValueAtTime(110, at + 0.09);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(loudness, at + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.13);
      osc.connect(env).connect(nodes.bubbleBus);
      osc.start(at);
      osc.stop(at + 0.16);
    },
    // A heavy thump: something big has struck.
    thump() {
      if (!context || !nodes || context.state !== "running" || !enabled) return;
      const at = context.currentTime + 0.01;
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.frequency.setValueAtTime(90, at);
      osc.frequency.exponentialRampToValueAtTime(38, at + 0.35);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.9, at + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
      osc.connect(env).connect(master);
      osc.start(at);
      osc.stop(at + 0.55);
    },
    // While the river is paused or out of sight it falls silent.
    hush(value) {
      if (hushed === value) return;
      hushed = value;
      if (!context) return;
      if (!value && context.state === "suspended") context.resume();
      fadeTo(level(), value ? 0.5 : 1.5);
    },
    // Once a frame: rain (0-1), daylight (0-1) and how hard the water is being stirred.
    update(dt, { rain = 0, daylight = 1, stir = 0 } = {}) {
      if (!context || !nodes || context.state !== "running") return;
      clock += dt;
      const now = context.currentTime;
      const swell = 0.8 + 0.2 * Math.sin(clock * 0.21) + 0.08 * Math.sin(clock * 0.53 + 1.3);
      const night = 1 - daylight;
      const stirred = Math.min(1, stir);
      nodes.rushGain.gain.setTargetAtTime((0.5 + 0.25 * stirred) * swell * (1 - 0.25 * night), now, 0.4);
      nodes.rushFilter.frequency.setTargetAtTime(380 + 240 * stirred - 90 * night, now, 0.3);
      nodes.rumbleGain.gain.setTargetAtTime(0.45 * (0.9 + 0.1 * swell), now, 1);
      nodes.rainGain.gain.setTargetAtTime(0.22 * rain, now, 1.2);
      nodes.muffle.frequency.setTargetAtTime(1400 - 350 * night + 600 * rain, now, 1);
      // Eddies turn over every second or so.
      if (clock > nextGurgle) {
        nextGurgle = clock + 0.35 + Math.random() * 0.9;
        const g = nodes.gurgles[Math.floor(Math.random() * nodes.gurgles.length)];
        g.band.frequency.setTargetAtTime(g.base * (0.7 + Math.random() * 0.8), now, 0.25);
        g.level.gain.setTargetAtTime((0.25 + Math.random() * 0.55) * (1 + stirred) * (1 - 0.3 * night), now, 0.2);
        g.level.gain.setTargetAtTime(0.05, now + 0.5 + Math.random() * 0.6, 0.4);
      }
      // A few bubbles a second, more when the water is stirred or rain is falling.
      if (clock > nextBubble) {
        const rate = 1.2 + 5 * stirred + 4 * rain;
        nextBubble = clock + (-Math.log(1 - Math.random()) / rate);
        bubble(now + 0.02, 0.05 + Math.random() * 0.08);
      }
    },
  };
}
