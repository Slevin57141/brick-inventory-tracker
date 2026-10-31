// The storage container from docs/container-spec.md as a three.js model (docs/plan.md M13).
// The body and the lid are each one geometry with one material, built once and shared by
// every container, so many containers cost little. Every surface is real geometry: a hollow
// tapered shell with a reinforced rim and small feet, and a lid with a raised, grooved
// perimeter, a recessed centre panel and diagonal ridges that frame a pocket for each foot.

import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from '../vendor/three/three.module.js';
import { CONTAINER } from './container-spec.js';

const { width, depth, height, taper, chamfer, wall, footHeight, lidHeight, lidOverhang } =
  CONTAINER;

// Insetting a chamfered rectangle by d moves each straight side in by d and the 45-degree
// corner cut in by d too, which shortens the cut, measured along a side, by d * (2 - sqrt 2).
const CUT_PER_INSET = 2 - Math.SQRT2;
const RIM = { x: 0, z: 0, halfWidth: width / 2, halfDepth: depth / 2, cut: chamfer };
const LID = {
  ...RIM,
  halfWidth: RIM.halfWidth + lidOverhang,
  halfDepth: RIM.halfDepth + lidOverhang,
  cut: chamfer + lidOverhang * CUT_PER_INSET,
};

// Body details, all at unit scale.
const BEVEL = 0.005;
const RIM_LIP = 0.01; // the rim is thickened inward, so the outer width stays `width`
const RIM_BAND = 0.05;

// Lid details. The lid's own origin is the centre of its underside, which rests on the rim.
/** How far the lid's skirt hangs below the lid's origin, just outside the rim (unit scale). */
export const LID_SKIRT = 0.012;
const SKIRT_CLEARANCE = 0.003;
const RING = 0.03; // width of the raised perimeter's flat top
const GROOVE_WIDTH = 0.008;
const GROOVE_DEPTH = 0.004;
const SLOPE = 0.012; // horizontal run from the perimeter down to the panel
const RECESS = 0.035; // how far the centre panel lies below the perimeter
const PANEL_Y = lidHeight - RECESS;
const RIDGE_HEIGHT = 0.012; // lower than the feet, so a stacked body clears the ridges
const RIDGE_HALF_WIDTH = 0.015;

// Feet near the corners of the bottom, and the matching pockets on the lid.
const FOOT_HALF = 0.04;
const FOOT_CUT = 0.012;
const FOOT_X = RIM.halfWidth - taper - 0.11;
const FOOT_Z = RIM.halfDepth - taper - 0.11;
const POCKET_MARGIN = 0.02;
// Each ridge runs diagonally across a corner of the panel, along |x| + |z| = RIDGE_LINE,
// just inside the pocket's inner corner.
const RIDGE_LINE = FOOT_X + FOOT_Z - FOOT_HALF * 2 - POCKET_MARGIN * 2 - 0.03;
const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

/**
 * The lid's foot pockets, in the lid's own coordinates (origin at the centre of its
 * underside). A foot of a container stacked on top stands on `floorY` inside each box.
 */
export const LID_POCKETS = Object.freeze(CORNERS.map(([sx, sz]) => {
  const xs = [sx * (FOOT_X - FOOT_HALF - POCKET_MARGIN), sx * (FOOT_X + FOOT_HALF + POCKET_MARGIN)];
  const zs = [sz * (FOOT_Z - FOOT_HALF - POCKET_MARGIN), sz * (FOOT_Z + FOOT_HALF + POCKET_MARGIN)];
  return Object.freeze({
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
    floorY: PANEL_Y,
  });
}));

let shared = null;

function sharedParts() {
  if (shared === null) {
    shared = {
      bodyGeometry: buildBody(),
      lidGeometry: buildLid(),
      // Frosted, slightly refracting polypropylene (container-spec.md sections 2 and 5, D20).
      // Both sides are drawn, because three.js shows the far walls through a transmissive
      // surface only when their back faces are rendered too.
      bodyMaterial: new MeshPhysicalMaterial({
        color: 0xeef1f3,
        metalness: 0,
        roughness: 0.15,
        transmission: 0.95,
        thickness: wall,
        ior: 1.49,
        side: DoubleSide,
      }),
      // Muted red, satin, not metallic (section 3).
      lidMaterial: new MeshStandardMaterial({ color: 0x8e2f2a, metalness: 0, roughness: 0.55 }),
    };
  }
  return shared;
}

/**
 * One container at unit scale. `group` has its origin at the centre of the base (the
 * bottom of the feet); `lid` is its own group, origin at the centre of its underside,
 * placed on the rim. Geometry and materials are shared by all containers.
 */
export function createContainer() {
  const parts = sharedParts();
  const group = new Group();
  group.name = 'container';

  const body = new Mesh(parts.bodyGeometry, parts.bodyMaterial);
  body.name = 'container-body';

  const lid = new Group();
  lid.name = 'container-lid';
  lid.position.y = height;
  const lidMesh = new Mesh(parts.lidGeometry, parts.lidMaterial);
  lidMesh.name = 'container-lid-shell';
  lid.add(lidMesh);

  group.add(body, lid);
  return { group, body, lid };
}

/** Base-to-base distance when one container stands on another's closed lid. */
export function stackHeight() {
  return height + PANEL_Y;
}

/** Frees the shared geometry and materials; the next createContainer builds them again. */
export function disposeSharedResources() {
  if (shared !== null) {
    shared.bodyGeometry.dispose();
    shared.lidGeometry.dispose();
    shared.bodyMaterial.dispose();
    shared.lidMaterial.dispose();
    shared = null;
  }
}

function buildBody() {
  const builder = createBuilder();
  // The outer wall leans out from the bottom to the rim; the inner wall follows it.
  const lean = (y) => (taper * (height - y)) / (height - footHeight);
  const floorY = footHeight + wall;
  const lipBottom = height - RIM_BAND;
  const rings = sweep(builder, RIM, [
    [taper + BEVEL, footHeight],
    [lean(footHeight + BEVEL), footHeight + BEVEL],
    [lean(height - BEVEL), height - BEVEL],
    [BEVEL, height],
    [wall + RIM_LIP, height],
    [wall + RIM_LIP, lipBottom],
    [wall + lean(lipBottom - RIM_LIP), lipBottom - RIM_LIP],
    [wall + lean(floorY), floorY],
  ]);
  cap(builder, rings[0], { facingUp: false });
  cap(builder, rings.at(-1), { facingUp: true });

  for (const [sx, sz] of CORNERS) {
    const foot = { x: sx * FOOT_X, z: sz * FOOT_Z, halfWidth: FOOT_HALF, halfDepth: FOOT_HALF,
      cut: FOOT_CUT };
    const footRings = sweep(builder, foot, [[0, 0], [0, footHeight]]);
    cap(builder, footRings[0], { facingUp: false });
    cap(builder, footRings[1], { facingUp: true });
  }
  return builder.geometry();
}

function buildLid() {
  const builder = createBuilder();
  const top = lidHeight;
  const grooveStart = RING / 2 - GROOVE_WIDTH / 2;
  const rings = sweep(builder, LID, [
    [lidOverhang - SKIRT_CLEARANCE, 0],
    [lidOverhang - SKIRT_CLEARANCE, -LID_SKIRT],
    [0, -LID_SKIRT],
    [0, top - BEVEL],
    [BEVEL, top],
    [grooveStart, top],
    [RING / 2, top - GROOVE_DEPTH],
    [grooveStart + GROOVE_WIDTH, top],
    [RING, top],
    [RING + SLOPE, PANEL_Y],
  ]);
  cap(builder, rings[0], { facingUp: false });
  cap(builder, rings.at(-1), { facingUp: true });

  // One diagonal ridge across each corner of the panel, ending just inside the slope.
  const panel = outline(RING + SLOPE, LID);
  const panelHalfWidth = panel[0][0];
  const panelHalfDepth = panel[2][1];
  for (const [sx, sz] of CORNERS) {
    const endX = panelHalfWidth - 0.012;
    const endZ = panelHalfDepth - 0.012;
    ridge(builder, [sx * endX, sz * (RIDGE_LINE - endX)], [sx * (RIDGE_LINE - endZ), sz * endZ]);
  }
  return builder.geometry();
}

// A triangular ridge standing on the panel, from point a to point b ([x, z] each).
function ridge(builder, [ax, az], [bx, bz]) {
  const length = Math.hypot(bx - ax, bz - az);
  const nx = (-(bz - az) / length) * RIDGE_HALF_WIDTH;
  const nz = ((bx - ax) / length) * RIDGE_HALF_WIDTH;
  const base = PANEL_Y;
  const peak = PANEL_Y + RIDGE_HEIGHT;
  const leftA = [ax + nx, base, az + nz];
  const rightA = [ax - nx, base, az - nz];
  const leftB = [bx + nx, base, bz + nz];
  const rightB = [bx - nx, base, bz - nz];
  const peakA = [ax, peak, az];
  const peakB = [bx, peak, bz];
  const inside = [(ax + bx) / 2, base + RIDGE_HEIGHT / 3, (az + bz) / 2];
  for (const face of [
    [leftA, leftB, peakB, peakA],
    [rightA, peakA, peakB, rightB],
    [leftA, peakA, rightA],
    [leftB, rightB, peakB],
    [leftA, rightA, rightB, leftB],
  ]) {
    builder.face(face, inside);
  }
}

/**
 * The eight corners ([x, z]) of a chamfered rectangle inset by `inset` (negative grows it).
 * They run so that the quads in sweep() face away from the material.
 */
function outline(inset, shape) {
  const a = shape.halfWidth - inset;
  const b = shape.halfDepth - inset;
  const c = shape.cut - inset * CUT_PER_INSET;
  return [
    [a, -b + c], [a, b - c], [a - c, b], [-a + c, b],
    [-a, b - c], [-a, -b + c], [-a + c, -b], [a - c, -b],
  ].map(([x, z]) => [shape.x + x, shape.z + z]);
}

/**
 * Builds the surface traced by a cross-section swept around a chamfered rectangle. Each
 * section point is [inset, y]. Walking the section from the outside of the bottom, up the
 * outer face, over the top and down the inside keeps every face pointing out of the
 * material. Returns the rings, so the caller can close the ends.
 */
function sweep(builder, shape, section) {
  const rings = section.map(([inset, y]) => outline(inset, shape).map(([x, z]) => [x, y, z]));
  for (let k = 0; k + 1 < rings.length; k += 1) {
    const lower = rings[k];
    const upper = rings[k + 1];
    for (let i = 0; i < lower.length; i += 1) {
      const j = (i + 1) % lower.length;
      builder.quad(lower[i], upper[i], upper[j], lower[j]);
    }
  }
  return rings;
}

// Closes a ring with a fan; the ring is convex, so the fan is a valid triangulation.
function cap(builder, ring, { facingUp }) {
  for (let i = 1; i + 1 < ring.length; i += 1) {
    if (facingUp) {
      builder.triangle(ring[0], ring[i + 1], ring[i]);
    } else {
      builder.triangle(ring[0], ring[i], ring[i + 1]);
    }
  }
}

// Collects triangles without shared vertices, so every face gets a flat normal: the
// container is all flat moulded faces with crisp edges.
function createBuilder() {
  const positions = [];
  const builder = {
    triangle(a, b, c) {
      positions.push(...a, ...b, ...c);
    },
    quad(a, b, c, d) {
      builder.triangle(a, b, c);
      builder.triangle(a, c, d);
    },
    // A convex face, turned to point away from `inside`.
    face(points, inside) {
      const [a, b, c] = points;
      const normal = cross(subtract(b, a), subtract(c, a));
      const ordered = dot(normal, subtract(a, inside)) < 0 ? [...points].reverse() : points;
      for (let i = 1; i + 1 < ordered.length; i += 1) {
        builder.triangle(ordered[0], ordered[i], ordered[i + 1]);
      }
    },
    geometry() {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
  return builder;
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
