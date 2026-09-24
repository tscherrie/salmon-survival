import * as THREE from "three";
import { waterLitShader } from "../../riverscape/src/water.js";
import { SolidBatch } from "./flora.js";

// The hunters that come from above: the kingfisher that drops beak-first into the brook,
// the heron standing on its stilts in the shallows, and the bear at the salmon fall. From
// under the water mostly what shows is what they put into it -- a bird's plunge, a pair of
// grey legs, a paw -- and that is all they need to be.

const vec = (x, y, z) => new THREE.Vector3(x, y, z);

export function creatureMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  material.onBeforeCompile = (shader) => waterLitShader(shader);
  material.customProgramCacheKey = () => "salmon-creature-v1";
  return material;
}

const part = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  cone: new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0),
};
function add(batch, geometry, position, scale, color, rotation = null) {
  const m = new THREE.Matrix4();
  const q = rotation ? new THREE.Quaternion().setFromEuler(rotation) : new THREE.Quaternion();
  m.compose(position, q, scale);
  batch.add(geometry, m, new THREE.Color(...color));
}

// The kingfisher, in its dive: beak first along +x, wings folded. About 17 cm (1.7 units).
export function kingfisherGeometry() {
  const b = new SolidBatch();
  add(b, part.sphere, vec(0, 0, 0), vec(0.42, 0.16, 0.16), [0.05, 0.35, 0.55]);
  // Orange underparts.
  add(b, part.sphere, vec(0.02, -0.05, 0), vec(0.36, 0.12, 0.14), [0.85, 0.38, 0.1]);
  add(b, part.sphere, vec(0.36, 0.02, 0), vec(0.14, 0.13, 0.13), [0.06, 0.4, 0.6]);
  // The beak: long, black, dagger-straight.
  add(b, part.cone, vec(0.46, 0.01, 0), vec(0.035, 0.36, 0.035), [0.05, 0.05, 0.05], new THREE.Euler(0, 0, -Math.PI / 2));
  // A white throat patch, an orange cheek.
  add(b, part.sphere, vec(0.42, -0.04, 0.06), vec(0.05, 0.04, 0.04), [0.9, 0.9, 0.85]);
  add(b, part.sphere, vec(0.36, 0.0, 0.1), vec(0.06, 0.04, 0.04), [0.85, 0.4, 0.12]);
  add(b, part.sphere, vec(0.36, 0.0, -0.1), vec(0.06, 0.04, 0.04), [0.85, 0.4, 0.12]);
  // Folded wings, electric blue on the back.
  add(b, part.sphere, vec(-0.08, 0.06, 0.1), vec(0.34, 0.06, 0.08), [0.1, 0.55, 0.75]);
  add(b, part.sphere, vec(-0.08, 0.06, -0.1), vec(0.34, 0.06, 0.08), [0.1, 0.55, 0.75]);
  add(b, part.sphere, vec(-0.45, 0.02, 0), vec(0.14, 0.03, 0.06), [0.05, 0.3, 0.5]);
  return b.geometry();
}

// A goosander (Gänsesäger) hen, diving: a sleek grey body, the rusty head with its ragged
// crest thrust forward on the neck, a thin red saw-toothed bill; wings folded. About 60 cm
// (6 units) along +x. The feet are separate, to paddle.
export function merganserGeometry() {
  const b = new SolidBatch();
  const grey = [0.36, 0.38, 0.4];
  const dark = [0.2, 0.21, 0.23];
  const rust = [0.42, 0.16, 0.07];
  add(b, part.sphere, vec(0, 0, 0), vec(2.2, 0.85, 0.95), grey);
  add(b, part.sphere, vec(0.1, 0.35, 0), vec(1.9, 0.5, 0.8), dark);
  // White breast and belly.
  add(b, part.sphere, vec(0.6, -0.28, 0), vec(1.4, 0.55, 0.75), [0.8, 0.8, 0.78]);
  // Folded wings, a white patch on each.
  for (const z of [-0.62, 0.62]) {
    add(b, part.sphere, vec(-0.3, 0.2, z), vec(1.6, 0.45, 0.28), dark);
    add(b, part.sphere, vec(0.1, 0.18, z * 1.08), vec(0.45, 0.2, 0.1), [0.85, 0.85, 0.82]);
  }
  // Tail.
  add(b, part.sphere, vec(-2.2, 0.15, 0), vec(0.7, 0.14, 0.4), dark);
  // Neck and head.
  add(b, part.cylinder, vec(1.7, 0.2, 0), vec(0.34, 1.1, 0.32), rust, new THREE.Euler(0, 0, -Math.PI / 2 + 0.15));
  add(b, part.sphere, vec(2.85, 0.32, 0), vec(0.55, 0.42, 0.4), rust);
  add(b, part.cone, vec(2.55, 0.5, 0), vec(0.22, 0.7, 0.16), rust, new THREE.Euler(0, 0, Math.PI / 2 + 0.3));
  add(b, part.sphere, vec(2.85, 0.02, 0), vec(0.3, 0.14, 0.26), [0.85, 0.84, 0.8]);
  for (const z of [-0.3, 0.3]) add(b, part.sphere, vec(3.05, 0.42, z), vec(0.07, 0.07, 0.05), [0.35, 0.05, 0.03]);
  // The bill: long, thin, red.
  add(b, part.cone, vec(3.3, 0.26, 0), vec(0.1, 0.9, 0.08), [0.62, 0.12, 0.06], new THREE.Euler(0, 0, -Math.PI / 2));
  return b.geometry();
}
// Its feet, set far back, webbed and orange; the origin is the hip, the feet trail along -x.
export function merganserFeetGeometry() {
  const b = new SolidBatch();
  for (const z of [-0.45, 0.45]) {
    add(b, part.cylinder, vec(0, 0, z), vec(0.08, 0.6, 0.08), [0.8, 0.35, 0.1], new THREE.Euler(0, 0, Math.PI / 2 + 0.3));
    add(b, part.sphere, vec(-0.75, -0.2, z), vec(0.4, 0.05, 0.28), [0.85, 0.4, 0.12]);
  }
  return b.geometry();
}

// The heron's legs from the knee down (the rest is above the water), and its neck, head and
// beak for the strike. Units: the legs are 3 m of bird, so about 40 units from the water up.
export function heronLegsGeometry() {
  const b = new SolidBatch();
  for (const z of [-0.9, 0.9]) {
    add(b, part.cylinder, vec(0, 0, z), vec(0.28, 26, 0.28), [0.45, 0.42, 0.3]);
    add(b, part.sphere, vec(0, 13, z), vec(0.45, 0.6, 0.45), [0.42, 0.4, 0.3]);
    // Toes spread on the bed.
    for (const a of [-0.7, 0, 0.7, Math.PI]) add(b, part.cylinder, vec(0, 0.1, z), vec(0.12, 2.2, 0.12), [0.4, 0.37, 0.27], new THREE.Euler(0, a, Math.PI / 2));
  }
  // The body high above, grey, for the leap's glimpse.
  add(b, part.sphere, vec(0, 34, 0), vec(7, 5, 4), [0.55, 0.57, 0.58]);
  add(b, part.sphere, vec(-6, 33, 0), vec(4, 2.2, 3.5), [0.3, 0.32, 0.34]);
  return b.geometry();
}
export function heronHeadGeometry() {
  const b = new SolidBatch();
  // Neck along -y from the body down to the head at the origin; beak pointing along -y.
  // A slender white neck, streaked grey down the front.
  add(b, part.cylinder, vec(0, 1.6, 0), vec(0.34, 13, 0.3), [0.78, 0.78, 0.76]);
  add(b, part.cylinder, vec(0.12, 1.6, 0), vec(0.12, 10, 0.2), [0.35, 0.36, 0.38]);
  // The head: long and narrow, white with the black stripe back from the eye.
  add(b, part.sphere, vec(0, 0.9, 0), vec(0.5, 1.4, 0.46), [0.88, 0.88, 0.85]);
  for (const z of [-0.4, 0.4]) add(b, part.sphere, vec(0.05, 1.3, z), vec(0.12, 0.8, 0.1), [0.06, 0.06, 0.06]);
  add(b, part.sphere, vec(0.18, 0.6, 0.38), vec(0.09, 0.09, 0.06), [0.9, 0.75, 0.1]);
  add(b, part.sphere, vec(0.18, 0.6, -0.38), vec(0.09, 0.09, 0.06), [0.9, 0.75, 0.1]);
  // The dagger of a bill.
  add(b, part.cone, vec(0, -0.3, 0), vec(0.26, 4.8, 0.22), [0.82, 0.66, 0.18], new THREE.Euler(Math.PI, 0, 0));
  return b.geometry();
}

// A brown bear standing in the water at the lip of the fall, fishing. Built from rounded
// masses the way a bear is: the shoulder hump, the long head with its lighter muzzle and
// small round ears, heavy legs with broad paws. Two metres long, so about twenty units.
// Along +x; the origin is on the ground between its forefeet and hind feet.
function furryBlob(b, position, scale, color, rotation = null) {
  add(b, part.sphere, position, scale, color, rotation);
}
export function bearLegsGeometry() {
  const b = new SolidBatch();
  const brown = [0.16, 0.1, 0.06];
  const dark = [0.1, 0.065, 0.04];
  // Legs: thick and tapering to the paws, forelegs straighter.
  for (const [x, z, lean] of [
    [6.5, -3.2, 0.05],
    [6.5, 3.2, -0.05],
    [-6.5, -3.4, 0.12],
    [-6.5, 3.4, -0.12],
  ]) {
    const legGeometry = new THREE.CylinderGeometry(1.5, 2.2, 1, 10).translate(0, 0.5, 0);
    const m = new THREE.Matrix4().compose(vec(x, -1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, x > 0 ? 0.04 : -0.1)), vec(1, 15, 1));
    b.add(legGeometry, m, new THREE.Color(...dark));
    furryBlob(b, vec(x + 0.6, -0.6, z), vec(2.2, 1.1, 1.9), dark);
  }
  // Body: haunches, belly and the shoulder hump.
  furryBlob(b, vec(-4.5, 17, 0), vec(6.5, 6.2, 5.6), brown);
  furryBlob(b, vec(1.5, 16.5, 0), vec(8, 6, 5.8), brown);
  furryBlob(b, vec(6, 19.5, 0), vec(5, 6, 5.2), [0.18, 0.115, 0.07]);
  // Neck and head, held low toward the water, a lighter muzzle.
  furryBlob(b, vec(10, 18, 0), vec(3.8, 3.8, 3.6), brown);
  furryBlob(b, vec(13, 16.5, 0), vec(3.2, 2.8, 2.8), [0.17, 0.11, 0.065]);
  furryBlob(b, vec(15.6, 15.6, 0), vec(2.0, 1.5, 1.5), [0.3, 0.22, 0.14]);
  furryBlob(b, vec(17.3, 15.6, 0), vec(0.55, 0.45, 0.6), [0.02, 0.02, 0.02]);
  for (const z of [-1.7, 1.7]) {
    furryBlob(b, vec(12.3, 19.3, z), vec(0.8, 0.9, 0.5), dark);
    furryBlob(b, vec(14.4, 17.4, z * 0.7), vec(0.28, 0.28, 0.2), [0.01, 0.01, 0.01]);
  }
  return b.geometry();
}
export function bearPawGeometry() {
  const b = new SolidBatch();
  const dark = [0.12, 0.075, 0.045];
  const leg = new THREE.CylinderGeometry(1.4, 1.9, 1, 10).translate(0, 0.5, 0);
  b.add(leg, new THREE.Matrix4().compose(vec(0, 0, 0), new THREE.Quaternion(), vec(1, 14, 1)), new THREE.Color(...dark));
  furryBlob(b, vec(0.4, 0, 0), vec(2.3, 1.4, 2.4), dark);
  for (const z of [-1.4, -0.5, 0.5, 1.4]) add(b, part.cone, vec(2.2, -0.4, z), vec(0.2, 1.3, 0.2), [0.85, 0.82, 0.72], new THREE.Euler(0, 0, -Math.PI / 2 - 0.5));
  return b.geometry();
}
