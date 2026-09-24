// The river's time: the hour of the day, and the time of year.
//
// The hour comes from the daylight clock. The time of year follows the fish's own life, as
// a salmon's life follows the year: it hatches as the snow melts, feeds as a fry through
// the summer, spends a winter under the ice as a parr, goes down to the sea as a smolt in
// the spring flood, and comes home to spawn in the autumn. So whatever the player does,
// the smolt runs in spring and the spawner spawns under turning leaves.
//
//   spring   snowmelt: high, fast, cloudy water, full of drift -- and the smolts running
//   summer   low, clear, warm water; in the shallows it can grow too warm for a salmon,
//            and the cool deep pools are where it goes to wait out the afternoon
//   autumn   leaves on the water and on the bed, the canopy opening, the spawning time
//   winter   ice over the river, cold, dim, little food; the fish live slowly
//
// The day has its own rhythm: at dusk the insects hatch and the fish rise to them (the
// evening rise), and at night the otter and the bullhead are out while the fish that
// hunt by eye see little and the birds are gone.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// A soft bump over [a, b] of the year, eased over `feather`, wrapping round New Year.
function span(y, a, b, feather = 0.04) {
  const inside = (t) => smooth(a - feather, a + feather, t) * (1 - smooth(b - feather, b + feather, t));
  return Math.max(inside(y), inside(y + 1), inside(y - 1));
}

// Where in the year each stage of life runs, from its start to its end (as fractions of
// the year from the first of January; past 1 is the next year).
const CALENDAR = [
  [0.27, 0.36], // Dottersackbrut: April into May, in the gravel as the snowmelt runs
  [0.36, 0.5], // Brütling: late spring
  [0.5, 0.7], // Sömmerling: the summer
  [0.7, 1.1], // Jährling: autumn, and into a winter under the ice
  [0.1, 0.36], // Parr: the end of the winter, and spring again
  [0.36, 0.45], // Smolt: down to the sea in the May flood
  [0.45, 0.75], // Postsmolt: the first summer at sea
  [0.75, 1.2], // Grilse: autumn and winter at sea
  [0.2, 0.55], // Meerlachs: a second spring at sea
  [0.55, 0.87], // Laichlachs: home in summer, spawning in the autumn
];

export const SEASON_NAMES = { spring: "Frühling", summer: "Sommer", autumn: "Herbst", winter: "Winter" };
export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export const conditions = {
  hour: 9.5,
  daylight: 1,
  light: 1,
  night: 0,
  // The evening rise: how strongly insects are hatching now.
  hatch: 0,
  year: 0.4,
  month: 4,
  season: "spring",
  spring: 1,
  summer: 0,
  autumn: 0,
  winter: 0,
  // The river's state from the season.
  flood: 0,
  low: 0,
  ice: 0,
  breakup: 0,
  leafFall: 0,
  // How much food there is overall (1 in a good summer), and how fast a cold-blooded body
  // lives (1 at the salmon's best temperature, down to ~0.4 near freezing).
  plenty: 1,
  pace: 1,
  // Water temperature where the fish is (°C), and how hot that is for it: 0 fine, 1 at
  // the edge of what a salmon survives.
  temperature: 10,
  heat: 0,
};

let forcedYear = null;
export function forceYear(value) {
  forcedYear = value == null ? null : ((Number(value) % 1) + 1) % 1;
}

// The year's base water temperature in the open river (°C): about one in January, about
// seventeen in late July.
function baseTemperature(y) {
  return 9 - 8 * Math.cos(2 * Math.PI * (y - 0.04));
}

export function updateConditions(day, stage, progress) {
  const c = conditions;
  c.hour = day.hour;
  c.daylight = day.daylight;
  // Light to see by, twilight included; and night proper, once the dusk has gone.
  const elevation = day.elevation ?? 0.5;
  c.light = smooth(-0.22, 0.25, elevation);
  c.night = 1 - smooth(-0.26, -0.03, elevation);
  const [a, b] = CALENDAR[clamp(stage, 0, CALENDAR.length - 1)];
  const y = forcedYear ?? (((a + (b - a) * clamp(progress, 0, 1)) % 1) + 1) % 1;
  c.year = y;
  c.month = Math.floor(y * 12) % 12;
  c.spring = span(y, 0.22, 0.45);
  c.summer = span(y, 0.45, 0.7);
  c.autumn = span(y, 0.7, 0.88);
  c.winter = span(y, 0.88, 1.22);
  const total = c.spring + c.summer + c.autumn + c.winter || 1;
  c.spring /= total;
  c.summer /= total;
  c.autumn /= total;
  c.winter /= total;
  c.season = ["spring", "summer", "autumn", "winter"].reduce((best, k) => (c[k] > c[best] ? k : best), "spring");
  // Snowmelt peaks in May; the lowest water in late July and August.
  c.flood = span(y, 0.3, 0.42, 0.05);
  c.low = span(y, 0.52, 0.68, 0.05);
  // The river freezes over from late December to the end of March.
  c.ice = span(y, 0.96, 1.23, 0.03);
  // And breaks up in early April: floes drifting down on the first of the melt.
  c.breakup = span(y, 0.215, 0.29, 0.02);
  c.leafFall = span(y, 0.72, 0.87, 0.03);
  // Insects hatch in the evening, from spring to early autumn, most in early summer.
  // (The river's sun sets at six and it is dark by eight: the rise is round sunset.)
  const evening = smooth(16.2, 17.2, c.hour) * (1 - smooth(19.1, 20.1, c.hour));
  c.hatch = evening * (0.55 * c.spring + 1 * c.summer + 0.35 * c.autumn);
  const base = baseTemperature(y);
  c.plenty = clamp(0.35 + 0.65 * smooth(3, 12, base), 0.35, 1);
  return c;
}

// Water temperature at a place (°C): the season's, cooler in the spring-fed brook in
// summer and a little milder there in winter, warmer in shallow water on a summer
// afternoon, cooler in deep water and in the pools, and the sea steadier.
export function waterTemperature(regions, depth, pool = 0) {
  const c = conditions;
  const base = baseTemperature(c.year);
  let t = base;
  t += regions.brook * (base > 8 ? -(base - 8) * 0.5 : (8 - base) * 0.15);
  t += regions.lower * 2.5 + regions.middle * 1.2 + regions.upper * 0.3;
  const afternoon = smooth(11, 15, c.hour) * (1 - smooth(18, 22, c.hour));
  const shallow = 1 - smooth(2, 14, depth);
  t += c.summer * (shallow * (2.5 + 2 * afternoon) + afternoon + 1.5 * c.low);
  t -= c.summer * (Math.min(3, depth * 0.08) + 3 * pool);
  // Snowmelt keeps the spring flood cold.
  t -= 4.5 * c.flood;
  const sea = regions.sea + regions.estuary * 0.5;
  t = t * (1 - sea) + (8 - 4 * Math.cos(2 * Math.PI * (c.year - 0.12))) * sea;
  return Math.max(0.2, t);
}

// What the temperature does to a salmon: how fast it lives (cold slows everything) and
// how hot it is for it (above ~19 °C it suffers, near 24 °C it dies).
export function thermal(t) {
  return {
    pace: clamp(0.38 + 0.62 * smooth(1, 11, t), 0.38, 1),
    heat: clamp((t - 19) / 5, 0, 1),
  };
}
