import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Group, MeshPhysicalMaterial, Raycaster, Vector3,
} from '../public/vendor/three/three.module.js';
import { CONTAINER, interiorBox } from '../public/js/container-spec.js';
import {
  LID_POCKETS, LID_SKIRT, createContainer, disposeSharedResources, stackHeight,
} from '../public/js/container-model.js';

const EPS = 1e-6;

/** Every vertex of a mesh, in world coordinates (the container group's when not moved). */
function vertices(mesh) {
  mesh.updateWorldMatrix(true, false);
  const array = mesh.geometry.attributes.position.array;
  const points = [];
  for (let i = 0; i < array.length; i += 3) {
    points.push(new Vector3(array[i], array[i + 1], array[i + 2]).applyMatrix4(mesh.matrixWorld));
  }
  return points;
}

function bounds(points) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    min.min(point);
    max.max(point);
  }
  return { min, max };
}

const lidMesh = (lid) => lid.children[0];

// Feet are the parts of the body below its flat bottom; their footprints, one per corner.
function feet(body) {
  const local = vertices(body).map((point) => point.clone().sub(body.parent.position));
  const groups = new Map();
  for (const point of local.filter((p) => p.y < CONTAINER.footHeight - EPS)) {
    const corner = `${Math.sign(point.x)}${Math.sign(point.z)}`;
    groups.set(corner, [...(groups.get(corner) ?? []), point]);
  }
  return [...groups.values()].map((points) => bounds(points));
}

// The height of the lid's top surface at (x, z), from a ray cast straight down, or null.
function lidTopAt(lid, x, z) {
  lid.updateWorldMatrix(true, true);
  const ray = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0));
  const [hit] = ray.intersectObject(lidMesh(lid));
  return hit ? hit.point.y : null;
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const point of list) {
      while (out.length >= 2 && turn(out.at(-2), out.at(-1), point) <= 1e-12) out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

test('the body is longer front-to-back and taller than it is wide (spec section 1)', () => {
  const { body } = createContainer();
  const { min, max } = bounds(vertices(body));
  const size = max.clone().sub(min);
  assert.ok(size.z > size.x, 'deeper than wide');
  assert.ok(size.y > size.x, 'taller than wide');
  assert.ok(Math.abs(size.y - CONTAINER.height) < EPS, 'height from the spec');
  assert.ok(Math.abs(min.y) < EPS, 'the origin is at the bottom of the feet');
  assert.ok(Math.abs(min.x + max.x) < EPS && Math.abs(min.z + max.z) < EPS, 'centred');
});

test('the walls taper: the top is wider and longer than the bottom (section 1)', () => {
  const { body } = createContainer();
  const points = vertices(body);
  const extent = (selected) => ({
    x: Math.max(...selected.map((p) => Math.abs(p.x))),
    z: Math.max(...selected.map((p) => Math.abs(p.z))),
  });
  const top = extent(points.filter((p) => p.y > CONTAINER.height - 0.01));
  const bottom = extent(points.filter((p) => Math.abs(p.y - CONTAINER.footHeight) < 0.01));
  // Small bevels round off both edges, so the full taper is not quite reached.
  assert.ok(top.x - bottom.x > CONTAINER.taper / 2, `wider at the top: ${top.x} vs ${bottom.x}`);
  assert.ok(top.z - bottom.z > CONTAINER.taper / 2, `longer at the top: ${top.z} vs ${bottom.z}`);
});

test('the footprint has eight chamfered corners and no right-angled ones (section 1)', () => {
  const { body } = createContainer();
  const hull = convexHull(vertices(body).map((p) => [p.x, p.z]));
  assert.equal(hull.length, 8);
  for (let i = 0; i < hull.length; i += 1) {
    const [prev, point, next] = [hull.at(i - 1), hull[i], hull[(i + 1) % hull.length]];
    const a = [prev[0] - point[0], prev[1] - point[1]];
    const b = [next[0] - point[0], next[1] - point[1]];
    const angle = (Math.acos((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)))
      * 180) / Math.PI;
    assert.ok(Math.abs(angle - 135) < 0.5, `corner ${i} is ${angle} degrees, not 135`);
  }
});

test('the body is hollow: nothing of it lies inside the interior, at any scale', () => {
  for (const scale of [1, 0.25, 2]) {
    const { group, body } = createContainer();
    group.scale.setScalar(scale);
    const box = interiorBox(scale);
    const inside = vertices(body).filter((p) => Math.abs(p.x) < box.width / 2 - EPS
      && Math.abs(p.z) < box.depth / 2 - EPS
      && p.y > box.floorY + EPS && p.y < box.floorY + box.height - EPS);
    assert.deepEqual(inside, [], `scale ${scale}`);
  }
});

test('body and lid are closed surfaces facing outward', () => {
  const { body, lid } = createContainer();
  for (const mesh of [body, lidMesh(lid)]) {
    const array = mesh.geometry.attributes.position.array;
    const edges = new Map();
    let volume = 0;
    for (let i = 0; i < array.length; i += 9) {
      const corners = [0, 3, 6].map((o) => [array[i + o], array[i + o + 1], array[i + o + 2]]);
      const [a, b, c] = corners;
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      const id = (p) => p.map((n) => n.toFixed(5)).join(',');
      for (let k = 0; k < 3; k += 1) {
        const edge = `${id(corners[k])}>${id(corners[(k + 1) % 3])}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    for (const [edge, count] of edges) {
      const [from, to] = edge.split('>');
      assert.equal(count, 1, `${mesh.name}: edge used twice in one direction`);
      assert.equal(edges.get(`${to}>${from}`), 1, `${mesh.name}: open edge ${edge}`);
    }
    assert.ok(volume > 0, `${mesh.name}: faces point inward`);
  }
});

test('the lid is a separate group that overhangs the rim and is thin (section 3)', () => {
  const { group, body, lid } = createContainer();
  assert.ok(lid instanceof Group);
  assert.equal(lid.parent, group);
  assert.equal(body.parent, group);
  assert.ok(!lid.getObjectById(body.id), 'the body is not part of the lid');
  assert.equal(lid.position.y, CONTAINER.height, 'the lid rests on the rim');

  const bodyBounds = bounds(vertices(body));
  const lidBounds = bounds(vertices(lidMesh(lid)));
  assert.ok(lidBounds.max.x > bodyBounds.max.x && lidBounds.min.x < bodyBounds.min.x);
  assert.ok(lidBounds.max.z > bodyBounds.max.z && lidBounds.min.z < bodyBounds.min.z);
  const lidThickness = lidBounds.max.y - lidBounds.min.y;
  assert.ok(lidThickness < 0.1 * CONTAINER.height, 'thin compared with the body');
  assert.ok(Math.abs(lidBounds.max.y - (CONTAINER.height + CONTAINER.lidHeight)) < EPS);
  assert.ok(Math.abs(lidBounds.min.y - (CONTAINER.height - LID_SKIRT)) < EPS, 'LID_SKIRT');
});

test('a stacked container stands with its feet in the lid pockets, clear of the lid', () => {
  const lower = createContainer();
  const upper = createContainer();
  upper.group.position.y = stackHeight();
  const lidY = lower.lid.position.y;

  const upperFeet = feet(upper.body);
  assert.equal(upperFeet.length, 4);
  for (const foot of upperFeet) {
    const pocket = LID_POCKETS.find((p) => foot.min.x >= p.minX && foot.max.x <= p.maxX
      && foot.min.z >= p.minZ && foot.max.z <= p.maxZ);
    assert.ok(pocket, `a foot at ${foot.min.x}, ${foot.min.z} has no pocket`);
    const gap = stackHeight() + foot.min.y - (lidY + pocket.floorY);
    assert.ok(gap >= -EPS && gap < 0.002, `foot gap ${gap}`);
    // The lid really is flat at the pocket floor under the whole foot.
    for (const [x, z] of [[foot.min.x, foot.min.z], [foot.max.x, foot.max.z],
      [(foot.min.x + foot.max.x) / 2, (foot.min.z + foot.max.z) / 2]]) {
      assert.ok(Math.abs(lidTopAt(lower.lid, x, z) - (lidY + pocket.floorY)) < EPS);
    }
  }

  // Everywhere under the upper container, except at its feet, the lid stays below it.
  const undersideY = stackHeight() + CONTAINER.footHeight;
  const inFoot = (x, z) => upperFeet.some((f) => x >= f.min.x - 0.005 && x <= f.max.x + 0.005
    && z >= f.min.z - 0.005 && z <= f.max.z + 0.005);
  // The bottom outline: the rim's chamfered rectangle moved in by the taper.
  const halfWidth = CONTAINER.width / 2 - CONTAINER.taper;
  const halfDepth = CONTAINER.depth / 2 - CONTAINER.taper;
  const cut = CONTAINER.chamfer - CONTAINER.taper * (2 - Math.SQRT2);
  const underBody = (x, z) => Math.abs(x) + Math.abs(z) <= halfWidth + halfDepth - cut;
  let checked = 0;
  for (let x = -halfWidth; x <= halfWidth; x += 0.01) {
    for (let z = -halfDepth; z <= halfDepth; z += 0.01) {
      if (inFoot(x, z) || !underBody(x, z)) continue;
      const top = lidTopAt(lower.lid, x, z);
      if (top !== null) {
        assert.ok(top < undersideY, `the lid at ${x}, ${z} reaches ${top}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 10000);

  // The walls of the upper container clear the lid's raised perimeter as well.
  for (const point of vertices(upper.body)) {
    const top = lidTopAt(lower.lid, point.x, point.z);
    if (top !== null && point.y > stackHeight() + CONTAINER.footHeight - EPS) {
      assert.ok(point.y > top, `body point ${point.x}, ${point.y}, ${point.z} is in the lid`);
    }
  }
});

test('materials: frosted transmissive body, satin red lid without metalness', () => {
  const { body, lid } = createContainer();
  assert.ok(body.material instanceof MeshPhysicalMaterial);
  assert.ok(body.material.transmission > 0);
  assert.ok(body.material.roughness > 0, 'frosted');
  assert.equal(lidMesh(lid).material.type, 'MeshStandardMaterial');
  assert.equal(lidMesh(lid).material.metalness, 0);
});

test('containers share geometry and materials until the shared resources are freed', () => {
  const a = createContainer();
  const b = createContainer();
  assert.equal(a.body.geometry, b.body.geometry);
  assert.equal(a.body.material, b.body.material);
  assert.equal(lidMesh(a.lid).geometry, lidMesh(b.lid).geometry);
  assert.equal(lidMesh(a.lid).material, lidMesh(b.lid).material);
  assert.notEqual(a.lid, b.lid);

  disposeSharedResources();
  const c = createContainer();
  assert.notEqual(c.body.geometry, a.body.geometry);
  assert.notEqual(c.body.material, a.body.material);
});
