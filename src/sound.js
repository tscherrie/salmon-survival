// The sound of the water, made from noise and filters with the Web Audio API (nothing is
// recorded). Under water: a deep muffled rush, eddies gurgling, bubbles ringing; the roar
// of a fall or a rapid swelling as the fish comes near it; in the sea a slower, deeper
// wash. Above water, in a leap: the air, bright and open, and the splash going back in.
// Browsers allow sound only after a click or key, so it starts then; T turns it off and on.

const STORAGE_KEY = "habitat-sound";

export function createSound() {
  let enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {}
  let context = null,
    master = null,
    nodes = null,
    hushed = false,
    clock = 0,
    nextGurgle = 0,
    nextBubble = 0,
    lastSwallow = 0;

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
        } else if (kind === "white") data[i] = white * 0.5;
        else {
          const k = i === 0 ? 0 : Math.min(7, Math.log2(i & -i) | 0);
          running -= rows[k];
          rows[k] = Math.random() * 2 - 1;
          running += rows[k];
          data[i] = (running + white) / 9;
        }
      }
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
  const filter = (type, frequency, q = 0.7) => {
    const f = context.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const amp = (value) => {
    const g = context.createGain();
    g.gain.value = value;
    return g;
  };

  function build() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    context = new Context({ latencyHint: "playback" });
    master = amp(0);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.ratio.value = 3;
    const muffle = filter("lowpass", 1400, 0.5);
    master.connect(muffle).connect(compressor).connect(context.destination);
    const brown = noiseBuffer("brown");
    const pink = noiseBuffer("pink");
    const white = noiseBuffer("white", 4);

    const rushSource = loop(brown);
    const rushFilter = filter("lowpass", 420, 0.6);
    const rushGain = amp(0.55);
    rushSource.connect(rushFilter).connect(rushGain).connect(master);
    const rumbleSource = loop(brown);
    const rumbleGain = amp(0.45);
    rumbleSource.connect(filter("lowpass", 90, 0.9)).connect(rumbleGain).connect(master);
    // The roar of falling and breaking water: broad, mid-low, churning.
    const roarSource = loop(pink);
    const roarBand = filter("bandpass", 420, 0.6);
    const roarGain = amp(0);
    roarSource.connect(roarBand).connect(roarGain).connect(master);
    const roarLow = loop(brown);
    const roarLowGain = amp(0);
    roarLow.connect(filter("lowpass", 160, 0.8)).connect(roarLowGain).connect(master);
    // The sea's slow wash.
    const washSource = loop(pink);
    const washFilter = filter("lowpass", 300, 0.5);
    const washGain = amp(0);
    washSource.connect(washFilter).connect(washGain).connect(master);
    // Air, for leaps: open wind and hiss, not muffled.
    const airSource = loop(white);
    const airGain = amp(0);
    airSource.connect(filter("bandpass", 2400, 0.4)).connect(airGain).connect(compressor);
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
    const rainSource = loop(pink);
    const rainGain = amp(0);
    rainSource.connect(filter("highpass", 700, 0.5)).connect(filter("lowpass", 3200, 0.5)).connect(rainGain).connect(master);
    const bubbleBus = amp(0.6);
    bubbleBus.connect(filter("lowpass", 2200, 0.5)).connect(master);
    const splashBus = amp(0.8);
    splashBus.connect(compressor);
    nodes = { rushFilter, rushGain, rumbleGain, roarGain, roarBand, roarLowGain, washGain, washFilter, airGain, gurgles, rainGain, bubbleBus, splashBus, muffle, white, brown };
    return true;
  }

  function bubble(at, loudness, low = 1) {
    const osc = context.createOscillator();
    const env = context.createGain();
    const pitch = (350 + Math.random() * 900) * low;
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
  // A click: a few milliseconds of noise in a band, as of jaws or a bill closing.
  function click(at, loudness, frequency, length, bus) {
    const source = context.createBufferSource();
    source.buffer = nodes.white;
    const band = filter("bandpass", frequency, 1.4);
    const env = context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(loudness, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0005, at + length);
    source.connect(band).connect(env).connect(bus);
    source.start(at, Math.random() * 2);
    source.stop(at + length + 0.02);
  }
  // A burst of noise shaped like a splash: a crack, then a fizz dying away.
  function burst(loudness, length, frequency, bus) {
    const at = context.currentTime + 0.01;
    const source = context.createBufferSource();
    source.buffer = nodes.white;
    const band = filter("bandpass", frequency, 0.8);
    const env = context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(loudness, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0005, at + length);
    source.connect(band).connect(env).connect(bus);
    source.start(at, Math.random() * 2);
    source.stop(at + length + 0.05);
  }

  const ready = () => context && nodes && context.state === "running" && enabled;
  const level = () => (enabled && !hushed ? 0.32 : 0);
  function fadeTo(value, seconds) {
    if (!context) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  return {
    get enabled() {
      return enabled;
    },
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
    // Something swallowed: the faint tick of the jaws closing and a soft, hollow gulp
    // dropping in pitch -- quiet, because it comes every few seconds while the fish feeds,
    // a little different each time, and never twice at once. `size` 0..1: a midge larva
    // is barely a tick, a herring a proper gulp with a bubble out of the gills.
    swallow(size = 0.2) {
      if (!ready()) return;
      const at = context.currentTime + 0.01;
      if (at - lastSwallow < 0.15) return;
      lastSwallow = at;
      click(at, 0.05 + 0.1 * size, 1000 - 400 * size, 0.02, master);
      const osc = context.createOscillator();
      const env = context.createGain();
      const f0 = (480 - 260 * size) * (0.88 + Math.random() * 0.24);
      osc.frequency.setValueAtTime(f0, at + 0.01);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.4, at + 0.09 + 0.1 * size);
      env.gain.setValueAtTime(0, at + 0.01);
      env.gain.linearRampToValueAtTime(0.1 + 0.2 * size, at + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.14 + 0.12 * size);
      osc.connect(env).connect(master);
      osc.start(at + 0.005);
      osc.stop(at + 0.3 + 0.12 * size);
      if (size > 0.4) bubble(at + 0.18, 0.04, 0.9);
    },
    // Caught. In a fish's jaws: the water rushing in, a deep gulp, the jaws shutting on it.
    // In a bill or under a claw: a hard clack, and the splash out of the water.
    eaten(kind) {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      if (kind === "fish") {
        const source = context.createBufferSource();
        source.buffer = nodes.white;
        const low = filter("lowpass", 520, 0.7);
        const env = context.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(0.7, at + 0.12);
        env.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
        source.connect(low).connect(env).connect(master);
        source.start(at, Math.random() * 2);
        source.stop(at + 0.55);
        const osc = context.createOscillator();
        const gulp = context.createGain();
        osc.frequency.setValueAtTime(170, at + 0.2);
        osc.frequency.exponentialRampToValueAtTime(46, at + 0.7);
        gulp.gain.setValueAtTime(0, at + 0.2);
        gulp.gain.linearRampToValueAtTime(1.0, at + 0.24);
        gulp.gain.exponentialRampToValueAtTime(0.0005, at + 0.85);
        osc.connect(gulp).connect(master);
        osc.start(at + 0.19);
        osc.stop(at + 0.9);
        for (let k = 0; k < 3; k++) click(at + 0.62 + k * 0.09, 0.5 - k * 0.12, 800, 0.05, master);
        for (let i = 0; i < 8; i++) bubble(at + 0.3 + Math.random() * 0.6, 0.06 + Math.random() * 0.05, 0.6);
      } else {
        click(at, 0.55, 2600, 0.025, nodes.splashBus);
        burst(0.45, 0.6, 900, nodes.splashBus);
        for (let i = 0; i < 10; i++) bubble(at + 0.05 + Math.random() * 0.4, 0.07, 0.8);
      }
    },
    thump() {
      if (!ready()) return;
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
    splash(strength = 1) {
      if (!ready()) return;
      burst(0.5 * Math.min(1.5, strength), 0.5 + 0.3 * strength, 900, nodes.splashBus);
      for (let i = 0; i < 6 + strength * 8; i++) bubble(context.currentTime + 0.05 + Math.random() * 0.5, 0.06 + Math.random() * 0.06, 0.7);
    },
    // A call from above the water: the kingfisher's thin, piercing whistle.
    call(kind = "kingfisher") {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      for (let k = 0; k < 2; k++) {
        const osc = context.createOscillator();
        const env = context.createGain();
        const t0 = at + k * 0.16;
        osc.frequency.setValueAtTime(3600, t0);
        osc.frequency.exponentialRampToValueAtTime(4300, t0 + 0.09);
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(0.06, t0 + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
        osc.connect(env).connect(nodes.splashBus);
        osc.start(t0);
        osc.stop(t0 + 0.14);
      }
      void kind;
    },
    leap() {
      if (!ready()) return;
      burst(0.35, 0.35, 1400, nodes.splashBus);
    },
    // A new stage of life: a soft swell and a rising run of bell tones, bright and clear
    // (not muffled by the water), with a flurry of bubbles.
    fanfare() {
      if (!ready()) return;
      const at = context.currentTime + 0.05;
      const bus = amp(0.55);
      bus.connect(nodes.splashBus);
      // The swell under it.
      const swell = context.createBufferSource();
      swell.buffer = nodes.white;
      const band = filter("bandpass", 600, 0.7);
      const swellGain = amp(0);
      swellGain.gain.setValueAtTime(0, at);
      swellGain.gain.linearRampToValueAtTime(0.12, at + 0.5);
      swellGain.gain.exponentialRampToValueAtTime(0.0005, at + 2.6);
      band.frequency.setValueAtTime(300, at);
      band.frequency.exponentialRampToValueAtTime(1800, at + 1.6);
      swell.connect(band).connect(swellGain).connect(bus);
      swell.start(at, Math.random() * 2);
      swell.stop(at + 2.8);
      // The bells: a major arpeggio up an octave and a half, the last held.
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => {
        const t0 = at + 0.12 + i * 0.13;
        const hold = i === notes.length - 1 ? 2.2 : 0.9;
        for (const [ratio, level] of [
          [1, 0.16],
          [2.01, 0.05],
          [3.02, 0.018],
        ]) {
          const osc = context.createOscillator();
          const env = context.createGain();
          osc.frequency.value = f * ratio;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(level, t0 + 0.012);
          env.gain.exponentialRampToValueAtTime(0.0003, t0 + hold);
          let out = env;
          if (context.createStereoPanner) {
            const pan = context.createStereoPanner();
            pan.pan.value = (i / (notes.length - 1)) * 0.8 - 0.4;
            env.connect(pan);
            out = pan;
          }
          osc.connect(env);
          out.connect(bus);
          osc.start(t0);
          osc.stop(t0 + hold + 0.05);
        }
      });
      for (let i = 0; i < 14; i++) bubble(at + 0.2 + Math.random() * 1.4, 0.05 + Math.random() * 0.05, 1.2);
    },
    // A badge: two or three quick bell tones up (three and brighter for a gold one), and a
    // few bubbles.
    chime(tier = "bronze") {
      if (!ready()) return;
      const at = context.currentTime + 0.03;
      const bus = amp(0.4);
      bus.connect(nodes.splashBus);
      const notes = tier === "gold" ? [783.99, 1046.5, 1567.98] : tier === "silver" ? [659.25, 987.77] : [587.33, 880];
      notes.forEach((f, i) => {
        const t0 = at + i * 0.09;
        const hold = i === notes.length - 1 ? 1.1 : 0.45;
        for (const [ratio, level] of [
          [1, 0.12],
          [2.01, 0.035],
        ]) {
          const osc = context.createOscillator();
          const env = context.createGain();
          osc.frequency.value = f * ratio;
          env.gain.setValueAtTime(0, t0);
          env.gain.linearRampToValueAtTime(level, t0 + 0.01);
          env.gain.exponentialRampToValueAtTime(0.0003, t0 + hold);
          osc.connect(env).connect(bus);
          osc.start(t0);
          osc.stop(t0 + hold + 0.05);
        }
      });
      for (let i = 0; i < 5; i++) bubble(at + 0.1 + Math.random() * 0.5, 0.04 + Math.random() * 0.04, 1.1);
    },
    // Thunder, heard through the water: when it is close a crack first, then the rumble
    // rolling away in a few swells. `near` 0..1.
    thunder(near = 0.5) {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      if (near > 0.6) click(at, 0.6 * near, 2400, 0.06, nodes.splashBus);
      const source = context.createBufferSource();
      source.buffer = nodes.brown;
      const low = filter("lowpass", 140 + 320 * near, 0.6);
      const env = context.createGain();
      const length = 2.6 + 2.6 * (1 - near);
      const peak = 1.1 * (0.35 + 0.65 * near);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + 0.06 + 0.35 * (1 - near));
      for (let k = 1; k < 5; k++) env.gain.linearRampToValueAtTime(peak * (0.45 + 0.4 * Math.random()) * (1 - k / 6), at + (k * length) / 6);
      env.gain.exponentialRampToValueAtTime(0.0005, at + length);
      source.connect(low).connect(env).connect(master);
      source.start(at, Math.random() * 3);
      source.stop(at + length + 0.1);
    },
    // Otters at play: quick, high chirps and squeaks, a splash as one dives.
    otter() {
      if (!ready()) return;
      const at = context.currentTime + 0.02;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const osc = context.createOscillator();
        const env = context.createGain();
        const t0 = at + k * (0.09 + Math.random() * 0.08);
        const f = 1800 + Math.random() * 1400;
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * (0.55 + Math.random() * 0.3), t0 + 0.07);
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(0.05, t0 + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.09);
        osc.connect(env).connect(nodes.splashBus);
        osc.start(t0);
        osc.stop(t0 + 0.11);
      }
    },
    // A fishing line: the reel's ratchet ticking as it is pulled in, or the line snapping.
    reel() {
      if (!ready()) return;
      const at = context.currentTime + 0.01;
      for (let k = 0; k < 4; k++) click(at + k * 0.035, 0.07, 4200, 0.012, nodes.splashBus);
    },
    snap() {
      if (!ready()) return;
      const at = context.currentTime + 0.01;
      click(at, 0.35, 3200, 0.03, nodes.splashBus);
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.frequency.setValueAtTime(900, at);
      osc.frequency.exponentialRampToValueAtTime(260, at + 0.25);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.08, at + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.3);
      osc.connect(env).connect(nodes.splashBus);
      osc.start(at);
      osc.stop(at + 0.32);
    },
    // A nip from another young fish: a small sharp tick and a bubble.
    nip() {
      if (!ready()) return;
      const at = context.currentTime + 0.01;
      click(at, 0.18, 1900, 0.018, master);
      bubble(at + 0.03, 0.05, 1.2);
    },
    // Another fish taking a fly off the surface somewhere near: a soft sip and a bubble,
    // fainter the further off.
    rise(distance = 5) {
      if (!ready()) return;
      const loud = Math.max(0, 1 - distance / 30);
      if (loud <= 0.02) return;
      const at = context.currentTime + 0.01;
      burst(0.06 * loud, 0.18, 700, nodes.splashBus);
      bubble(at + 0.04, 0.05 * loud, 0.55);
    },
    hush(value) {
      if (hushed === value) return;
      hushed = value;
      if (!context) return;
      if (!value && context.state === "suspended") context.resume();
      fadeTo(level(), value ? 0.5 : 1.5);
    },
    update(dt, { rain = 0, daylight = 1, stir = 0, roar = 0, sea = 0, above = false, depth = 1 } = {}) {
      if (!context || !nodes || context.state !== "running") return;
      clock += dt;
      const now = context.currentTime;
      const swell = 0.8 + 0.2 * Math.sin(clock * 0.21) + 0.08 * Math.sin(clock * 0.53 + 1.3);
      const night = 1 - daylight;
      const stirred = Math.min(1, stir);
      const river = 1 - sea;
      const under = above ? 0.25 : 1;
      nodes.rushGain.gain.setTargetAtTime((0.5 + 0.25 * stirred) * swell * (1 - 0.25 * night) * (0.45 + 0.55 * river) * under, now, 0.4);
      nodes.rushFilter.frequency.setTargetAtTime(380 + 240 * stirred - 90 * night - 120 * sea, now, 0.3);
      nodes.rumbleGain.gain.setTargetAtTime(0.45 * (0.9 + 0.1 * swell) * under, now, 1);
      nodes.roarGain.gain.setTargetAtTime(0.9 * roar * (above ? 1.6 : 1), now, 0.5);
      nodes.roarBand.frequency.setTargetAtTime(above ? 900 : 420, now, 0.3);
      nodes.roarLowGain.gain.setTargetAtTime(0.7 * roar * under, now, 0.5);
      const wash = 0.55 + 0.45 * Math.sin(clock * 0.13) * Math.sin(clock * 0.047 + 1);
      nodes.washGain.gain.setTargetAtTime(sea * 0.6 * wash * under, now, 1.2);
      nodes.washFilter.frequency.setTargetAtTime(200 + 260 * wash, now, 1);
      nodes.airGain.gain.setTargetAtTime(above ? 0.35 : 0, now, above ? 0.05 : 0.2);
      nodes.rainGain.gain.setTargetAtTime(0.22 * rain * (above ? 2.5 : 1), now, 1.2);
      nodes.muffle.frequency.setTargetAtTime(above ? 9000 : 1400 - 350 * night + 600 * rain - Math.min(600, depth * 3), now, above ? 0.05 : 0.4);
      if (clock > nextGurgle) {
        nextGurgle = clock + 0.35 + Math.random() * 0.9;
        const g = nodes.gurgles[Math.floor(Math.random() * nodes.gurgles.length)];
        g.band.frequency.setTargetAtTime(g.base * (0.7 + Math.random() * 0.8), now, 0.25);
        g.level.gain.setTargetAtTime((0.25 + Math.random() * 0.55) * (1 + stirred + roar) * (1 - 0.3 * night) * river * under, now, 0.2);
        g.level.gain.setTargetAtTime(0.05 * river, now + 0.5 + Math.random() * 0.6, 0.4);
      }
      if (clock > nextBubble) {
        const rate = 1.2 + 5 * stirred + 4 * rain + 14 * roar;
        nextBubble = clock + -Math.log(1 - Math.random()) / rate;
        if (!above) bubble(now + 0.02, 0.05 + Math.random() * 0.08);
      }
    },
  };
}
