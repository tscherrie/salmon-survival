// Where a frame's time goes, section by section (?profile, or salmon.profile.on = true):
// begin() at the top of a frame, mark(name) after each part; report() gives the average
// milliseconds of each over the frames since reset(). Costs nothing while off.
export const profile = {
  on: false,
  t: 0,
  frames: 0,
  sums: {},
  begin() {
    if (!this.on) return;
    this.t = performance.now();
    this.frames++;
  },
  mark(name) {
    if (!this.on) return;
    const now = performance.now();
    this.sums[name] = (this.sums[name] ?? 0) + (now - this.t);
    this.t = now;
  },
  reset() {
    this.frames = 0;
    this.sums = {};
  },
  report() {
    const out = {};
    let total = 0;
    for (const [k, v] of Object.entries(this.sums)) {
      out[k] = +(v / Math.max(1, this.frames)).toFixed(2);
      total += v;
    }
    out.total = +(total / Math.max(1, this.frames)).toFixed(2);
    return out;
  },
};
