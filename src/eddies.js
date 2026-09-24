// A small solver for the water round the fish: two-dimensional, incompressible flow on an
// N × N grid of square cells (the layer of the river where the stones are), the way
// "stable fluids" solvers do it -- the velocity carried along by itself (MacCormack
// advection), forces, then a pressure projection that keeps the water from piling up or
// thinning out. It knows nothing of the river: it is given
//
//   BU, BV    the river's own steady current in every cell (what the water would do with
//             no stones in it), which the flow is drawn back to a little everywhere and
//             firmly near the edges of the grid -- so what it adds is only what the stones
//             do: water piling up in front of them and parting round them, the slack water
//             and the back eddy behind, whirls shed from their sides and drifting away
//   SOLID     how much each cell is blocked (0 open water, 1 stone), with TU, TV the
//             velocity inside it (0 for a stone)
//   WALL      cells nothing flows through: the banks, and stones up to the surface
//   TOPSRC    how high above the bed an obstacle reaches in a cell; carried downstream
//             with the water as TOP, so a wake knows how high it reaches
//
// Cells are indexed j * N + i, i along x and j along z. All plain typed arrays, so it runs
// the same anywhere (and can be tested without a browser).

export function createSolver(N) {
  const n = N * N;
  const f32 = () => new Float32Array(n);
  const s = {
    N,
    U: f32(),
    V: f32(),
    P: f32(),
    D: f32(),
    W: f32(),
    BU: f32(),
    BV: f32(),
    BD: f32(),
    SOLID: f32(),
    TU: f32(),
    TV: f32(),
    TOP: f32(),
    TOPSRC: f32(),
    WALL: new Uint8Array(n),
    LAND: new Uint8Array(n),
    FRESH: new Uint8Array(n),
    SPONGE: f32(),
  };
  const { U, V, P, D, W, BU, BV, BD, SOLID, TU, TV, TOP, TOPSRC, WALL, LAND, FRESH, SPONGE } = s;
  const U2 = f32(),
    V2 = f32(),
    U3 = f32(),
    V3 = f32(),
    Umin = f32(),
    Umax = f32(),
    Vmin = f32(),
    Vmax = f32(),
    T2 = f32(),
    OPEN = f32(),
    SHARE = f32();

  // The sponge: the outermost cells are held to the river's own current, so what leaves
  // the grid leaves quietly and what comes in is the river as it is.
  const RIM = Math.max(4, Math.round(N * 0.07));
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const d = Math.min(i, j, N - 1 - i, N - 1 - j);
      const t = Math.max(0, 1 - d / RIM);
      SPONGE[j * N + i] = t * t;
    }

  // Bilinear sample of field F at cell coordinates (x, y), clamped to the grid.
  function bilinear(F, x, y) {
    if (x < 0) x = 0;
    else if (x > N - 1.001) x = N - 1.001;
    if (y < 0) y = 0;
    else if (y > N - 1.001) y = N - 1.001;
    const i = x | 0,
      j = y | 0;
    const fx = x - i,
      fy = y - j;
    const k = j * N + i;
    const a = F[k],
      b = F[k + 1],
      c = F[k + N],
      d = F[k + N + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  s.bilinear = bilinear;

  // The divergence of the river's own current, as the projection counts it -- so that
  // the river's own current, stones or none, is left as it is.
  s.baseChanged = function () {
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (LAND[k] || i === 0 || j === 0 || i === N - 1 || j === N - 1) {
          BD[k] = 0;
          continue;
        }
        const uR = LAND[k + 1] ? -BU[k] : BU[k + 1],
          uL = LAND[k - 1] ? -BU[k] : BU[k - 1],
          vT = LAND[k + N] ? -BV[k] : BV[k + N],
          vB = LAND[k - N] ? -BV[k] : BV[k - N];
        BD[k] = (uR - uL + vT - vB) * 0.5;
      }
  };

  // Move the grid by whole cells (the fish swam on): what stays keeps its water, the
  // cells coming in are marked FRESH, to be filled with the river's current by seed().
  function shiftField(F, di, dj, fill) {
    if (Math.abs(di) >= N || Math.abs(dj) >= N) {
      F.fill(fill);
      return;
    }
    const tmp = T2;
    tmp.set(F);
    for (let j = 0; j < N; j++) {
      const sj = j + dj;
      for (let i = 0; i < N; i++) {
        const si = i + di;
        F[j * N + i] = si >= 0 && si < N && sj >= 0 && sj < N ? tmp[sj * N + si] : fill;
      }
    }
  }
  s.shift = function (di, dj) {
    for (const F of [U, V, P, TOP]) shiftField(F, di, dj, 0);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const si = i + di,
          sj = j + dj;
        FRESH[j * N + i] = si >= 0 && si < N && sj >= 0 && sj < N ? 0 : 1;
      }
  };
  s.seed = function (gust, all = false) {
    for (let k = 0; k < n; k++)
      if (all || FRESH[k]) {
        U[k] = BU[k] * gust;
        V[k] = BV[k] * gust;
        P[k] = 0;
        TOP[k] = 0;
        FRESH[k] = 0;
      }
  };

  // One step of dt seconds; h is the cell's size. `gust` scales the river's current (its
  // unsteadiness and the season); `relax` is how fast (per second) the water forgets a
  // stone; `confine` how strongly the whirls are kept from smearing out; `iterations`
  // how many sweeps the pressure gets.
  s.step = function (dt, h, { gust = 1, relax = 0.35, confine = 0.6, iterations = 14, penalty = 40 } = {}) {
    const q = dt / h; // cells per unit of speed

    // ---- 1. The water carries itself along (MacCormack: a step forward and a step back,
    // the difference corrected, kept within what the neighbours hold) -- and the height of
    // the wakes along with it.
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        let x = i - U[k] * q,
          y = j - V[k] * q;
        if (x < 0) x = 0;
        else if (x > N - 1.001) x = N - 1.001;
        if (y < 0) y = 0;
        else if (y > N - 1.001) y = N - 1.001;
        const ii = x | 0,
          jj = y | 0;
        const fx = x - ii,
          fy = y - jj;
        const m = jj * N + ii;
        const w11 = fx * fy,
          w10 = fx - w11,
          w01 = fy - w11,
          w00 = 1 - fx - fy + w11;
        let a = U[m],
          b = U[m + 1],
          c = U[m + N],
          d = U[m + N + 1];
        U2[k] = a * w00 + b * w10 + c * w01 + d * w11;
        let lo = a < b ? a : b,
          hi = a < b ? b : a;
        if (c < lo) lo = c;
        else if (c > hi) hi = c;
        if (d < lo) lo = d;
        else if (d > hi) hi = d;
        Umin[k] = lo;
        Umax[k] = hi;
        a = V[m];
        b = V[m + 1];
        c = V[m + N];
        d = V[m + N + 1];
        V2[k] = a * w00 + b * w10 + c * w01 + d * w11;
        lo = a < b ? a : b;
        hi = a < b ? b : a;
        if (c < lo) lo = c;
        else if (c > hi) hi = c;
        if (d < lo) lo = d;
        else if (d > hi) hi = d;
        Vmin[k] = lo;
        Vmax[k] = hi;
      }
    // The height of the wakes goes down the river with the river's own current (in the
    // slack water right behind a stone the water itself hardly moves on).
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        let x = i - BU[k] * gust * q,
          y = j - BV[k] * gust * q;
        if (x < 0) x = 0;
        else if (x > N - 1.001) x = N - 1.001;
        if (y < 0) y = 0;
        else if (y > N - 1.001) y = N - 1.001;
        const ii = x | 0,
          jj = y | 0;
        const fx = x - ii,
          fy = y - jj;
        const m = jj * N + ii;
        const w11 = fx * fy;
        T2[k] = TOP[m] * (1 - fx - fy + w11) + TOP[m + 1] * (fx - w11) + TOP[m + N] * (fy - w11) + TOP[m + N + 1] * w11;
      }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        let x = i + U[k] * q,
          y = j + V[k] * q;
        if (x < 0) x = 0;
        else if (x > N - 1.001) x = N - 1.001;
        if (y < 0) y = 0;
        else if (y > N - 1.001) y = N - 1.001;
        const ii = x | 0,
          jj = y | 0;
        const fx = x - ii,
          fy = y - jj;
        const m = jj * N + ii;
        const w11 = fx * fy,
          w10 = fx - w11,
          w01 = fy - w11,
          w00 = 1 - fx - fy + w11;
        U3[k] = U2[m] * w00 + U2[m + 1] * w10 + U2[m + N] * w01 + U2[m + N + 1] * w11;
        V3[k] = V2[m] * w00 + V2[m + 1] * w10 + V2[m + N] * w01 + V2[m + N + 1] * w11;
      }
    for (let k = 0; k < n; k++) {
      let u = U2[k] + 0.5 * (U[k] - U3[k]),
        v = V2[k] + 0.5 * (V[k] - V3[k]);
      U[k] = u < Umin[k] ? Umin[k] : u > Umax[k] ? Umax[k] : u;
      V[k] = v < Vmin[k] ? Vmin[k] : v > Vmax[k] ? Vmax[k] : v;
    }
    const fade = Math.exp(-relax * dt);
    for (let k = 0; k < n; k++) {
      const t = T2[k] * fade;
      TOP[k] = t > TOPSRC[k] ? t : TOPSRC[k];
    }

    // ---- 2. Forces: drawn back toward the river's own current (softly everywhere, firmly
    // in the sponge), held still inside the stones.
    for (let k = 0; k < n; k++) {
      const bu = BU[k] * gust,
        bv = BV[k] * gust;
      const back = 1 - Math.exp(-(relax + SPONGE[k] * 12) * dt);
      let u = U[k] + (bu - U[k]) * back,
        v = V[k] + (bv - V[k]) * back;
      const blocked = SOLID[k];
      if (blocked > 0) {
        const hold = 1 - Math.exp(-penalty * blocked * blocked * dt);
        u += (TU[k] - u) * hold;
        v += (TV[k] - v) * hold;
      }
      U[k] = u;
      V[k] = v;
    }

    // ---- 3. Vorticity confinement: the numerical smearing of every such solver would
    // soon wipe out the whirls; this puts back a little spin where there is spin.
    if (confine > 0) {
      for (let j = 1; j < N - 1; j++)
        for (let i = 1; i < N - 1; i++) {
          const k = j * N + i;
          // Spin of what the stones add, not of the river's own shear along its banks.
          W[k] = (V[k + 1] - BV[k + 1] * gust - (V[k - 1] - BV[k - 1] * gust) - (U[k + N] - BU[k + N] * gust) + (U[k - N] - BU[k - N] * gust)) / (2 * h);
        }
      for (let j = 2; j < N - 2; j++)
        for (let i = 2; i < N - 2; i++) {
          const k = j * N + i;
          if (WALL[k]) continue;
          const nx = Math.abs(W[k + 1]) - Math.abs(W[k - 1]),
            ny = Math.abs(W[k + N]) - Math.abs(W[k - N]);
          const len = Math.hypot(nx, ny) + 1e-6;
          const kk = (confine * h * W[k] * dt * (1 - SPONGE[k])) / len;
          U[k] += ny * kk;
          V[k] -= nx * kk;
        }
    }

    // ---- 4. The projection: what flows into a cell must flow out of it (less the river's
    // own spreading and narrowing), nothing through the banks and the big stones.
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (WALL[k] || i === 0 || j === 0 || i === N - 1 || j === N - 1) {
          D[k] = 0;
          continue;
        }
        const uR = WALL[k + 1] ? -U[k] : U[k + 1],
          uL = WALL[k - 1] ? -U[k] : U[k - 1],
          vT = WALL[k + N] ? -V[k] : V[k + N],
          vB = WALL[k - N] ? -V[k] : V[k - N];
        D[k] = ((uR - uL + vT - vB) * 0.5 - BD[k] * gust) * h;
      }
    // Red-black Gauss-Seidel with over-relaxation, starting from last step's pressure. A
    // wall counts as no neighbour at all (no flow through it), so each cell's share is
    // worked out once, without branches in the sweeps.
    for (let k = 0; k < n; k++) OPEN[k] = WALL[k] ? 0 : 1;
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        const count = OPEN[k + 1] + OPEN[k - 1] + OPEN[k + N] + OPEN[k - N];
        SHARE[k] = OPEN[k] && count ? 1 / count : 0;
      }
    const omega = 1.72;
    for (let it = 0; it < iterations; it++)
      for (let colour = 0; colour < 2; colour++)
        for (let j = 1; j < N - 1; j++)
          for (let i = 1 + ((j + colour) & 1); i < N - 1; i += 2) {
            const k = j * N + i;
            // (In a wall the share is nought: its pressure drifts to nought, and nothing
            // reads it.)
            const target = (P[k + 1] * OPEN[k + 1] + P[k - 1] * OPEN[k - 1] + P[k + N] * OPEN[k + N] + P[k - N] * OPEN[k - N] - D[k]) * SHARE[k];
            P[k] += omega * (target - P[k]);
          }
    // The edge of the grid is open water: no pressure beyond it.
    for (let i = 0; i < N; i++) P[i] = P[(N - 1) * N + i] = P[i * N] = P[i * N + N - 1] = 0;
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        if (WALL[k]) {
          U[k] = TU[k];
          V[k] = TV[k];
          continue;
        }
        const p = P[k];
        const pR = WALL[k + 1] ? p : P[k + 1],
          pL = WALL[k - 1] ? p : P[k - 1],
          pT = WALL[k + N] ? p : P[k + N],
          pB = WALL[k - N] ? p : P[k - N];
        U[k] -= ((pR - pL) * 0.5) / h;
        V[k] -= ((pT - pB) * 0.5) / h;
      }
  };

  return s;
}
