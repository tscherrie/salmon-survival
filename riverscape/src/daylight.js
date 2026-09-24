// The day over the river, and its weather.
//
// On the desktop the river keeps the viewer's own time: bright at midday, amber in the
// last hour of the sun, and at night lit only by the moon, a dim blue world where the net of
// light on the sand is faint and slow. In the browser the day runs quickly -- a full turn
// in about twenty-four minutes, the night hurried through -- so it can be watched. Now and
// then a shower comes over: the light goes grey, the surface is pocked all over with rings,
// and the net on the sand breaks up until it passes.
//
// Query options: ?hour=18.5 starts at that hour, ?day=real|fast|still chooses the clock,
// ?daylength=24 sets the fast day in minutes, ?rain=1 keeps it raining and ?rain=0 dry.

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createDaylight({ wallpaper = false, query = new URLSearchParams() } = {}) {
  const localHour = () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  };
  const mode = ["real", "fast", "still"].includes(query.get("day")) ? query.get("day") : wallpaper ? "real" : "fast";
  const dayMinutes = Math.max(2, Number(query.get("daylength")) || 24);
  const start = Number(query.get("hour"));
  let hour = query.has("hour") && Number.isFinite(start) ? ((start % 24) + 24) % 24 : mode === "real" ? localHour() : 9.5;
  const rainSetting = query.get("rain");
  // Showers: in the browser one comes a few minutes in and then every quarter of an hour
  // or so; on the desktop, a shower of several minutes about once an hour.
  const SHOWERS = wallpaper ? { period: 3700, start: 1500, length: 420, ramp: 70 } : { period: 1020, start: 300, length: 200, ramp: 40 };
  let clock = 0;
  let rainOverride = null;
  const state = { hour, daylight: 1, golden: 0, moon: 0, rain: 0, elevation: 1 };

  function update(dt) {
    clock += dt;
    if (mode === "real") hour = localHour();
    else if (mode === "fast") {
      // An hour a minute by day; the night goes by three times as fast.
      const night = hour >= 20.5 || hour < 4.5;
      hour = (hour + dt * (24 / (dayMinutes * 60)) * (night ? 3 : 1)) % 24;
    }
    // How high the sun is: 1 at noon, 0 at six, -1 at midnight.
    const elevation = Math.sin((Math.PI * (hour - 6)) / 12);
    state.hour = hour;
    state.elevation = elevation;
    state.daylight = smooth(-0.1, 0.3, elevation);
    state.golden = smooth(-0.14, 0.0, elevation) * (1 - smooth(0.02, 0.38, elevation));
    state.moon = 1 - smooth(-0.22, -0.02, elevation);
    if (rainOverride !== null) state.rain = rainOverride;
    else if (rainSetting === "1") state.rain = 1;
    else if (rainSetting === "0") state.rain = 0;
    else {
      const t = (clock - SHOWERS.start) % SHOWERS.period;
      const inShower = clock >= SHOWERS.start ? t : -1;
      state.rain = inShower < 0 ? 0 : smooth(0, SHOWERS.ramp, inShower) * (1 - smooth(SHOWERS.length - SHOWERS.ramp, SHOWERS.length, inShower));
    }
    return state;
  }
  update(0);
  return {
    update,
    state,
    mode,
    // Development: jump to an hour, or force the rain (null for the schedule).
    setHour(h) {
      hour = ((h % 24) + 24) % 24;
    },
    setRain(value) {
      rainOverride = value;
    },
  };
}
