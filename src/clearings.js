// Where the forest leaves room: round the mill house, the ends of the bridge, the counting
// hut. The places register their clearings when the game loads (features.js), so a block
// of forest built before the place itself still grows none of its trees there.
export const CLEARINGS = [];

export function addClearing(x, z, radius) {
  CLEARINGS.push({ x, z, r2: radius * radius });
}

export function inClearing(x, z) {
  for (const c of CLEARINGS) {
    const dx = x - c.x,
      dz = z - c.z;
    if (dx * dx + dz * dz < c.r2) return true;
  }
  return false;
}
