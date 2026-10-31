// M12 draws with WebGL, which Node does not have, so the drawing is checked by hand (plan
// section 10). These tests cover what M12 adds to the layout maths of M11: the brick shape,
// the path of a lid, the box the camera frames and the fallback without WebGL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from '../public/vendor/three/three.module.js';
import { CONTAINER } from '../public/js/container-spec.js';
import { LID_SKIRT } from '../public/js/container-model.js';
import { BLOCK_SIZE, computeLayout } from '../public/js/scene-layout.js';
import {
  boxCorners, containerBoxes, createBrickGeometry, createBrickScene, fitCamera, lidOffset,
  sceneBounds,
} from '../public/js/brick-scene.js';

const EPS = 1e-9;
const { width, depth, height, lidHeight, lidOverhang } = CONTAINER;

function row(categoryId, colorId, quantity, categoryName = `Category ${categoryId}`) {
  return { partNum: `p${categoryId}-${colorId}`, name: 'Part', categoryId, categoryName, colorId,
    colorName: `Colour ${colorId}`, colorRgb: 'C91A09', colorIsTrans: false, imgUrl: null,
    quantity };
}

// Five categories of different sizes: two rows of containers, as M11 lays them out.
const ROWS = [row(1, 4, 250), row(1, 1, 40), row(2, 4, 1200), row(3, 15, 90), row(4, 0, 3000),
  row(5, 4, 600), row(5, 72, 450)];

// A lid's outer box, from its underside origin at `offset` from the container's origin.
function lidBox(container, offset) {
  const { position: p, scale: s } = container;
  return {
    minX: p.x - (width / 2 + lidOverhang) * s, maxX: p.x + (width / 2 + lidOverhang) * s,
    minY: p.y + offset.y - LID_SKIRT * s, maxY: p.y + offset.y + lidHeight * s,
    minZ: p.z + offset.z - (depth / 2 + lidOverhang) * s,
    maxZ: p.z + offset.z + (depth / 2 + lidOverhang) * s,
  };
}

function bodyBox({ position: p, scale: s }) {
  return {
    minX: p.x - (width / 2) * s, maxX: p.x + (width / 2) * s, minY: p.y, maxY: p.y + height * s,
    minZ: p.z - (depth / 2) * s, maxZ: p.z + (depth / 2) * s,
  };
}

const overlaps = (a, b) => a.minX < b.maxX - EPS && b.minX < a.maxX - EPS
  && a.minY < b.maxY - EPS && b.minY < a.maxY - EPS
  && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;

test('a brick fills BLOCK_SIZE exactly, centred on its position, with a stud on top', () => {
  const geometry = createBrickGeometry();
  const { min, max } = geometry.boundingBox;
  for (const [axis, size] of [['x', BLOCK_SIZE.width], ['y', BLOCK_SIZE.height],
    ['z', BLOCK_SIZE.depth]]) {
    assert.ok(Math.abs(min[axis] + size / 2) < 1e-6, `min ${axis}`);
    assert.ok(Math.abs(max[axis] - size / 2) < 1e-6, `max ${axis}`);
  }
  // Near the top, only the stud: narrower than the body.
  const positions = geometry.getAttribute('position');
  const top = [];
  for (let i = 0; i < positions.count; i += 1) {
    if (positions.getY(i) > BLOCK_SIZE.height / 2 - 0.01) {
      top.push(Math.hypot(positions.getX(i), positions.getZ(i)));
    }
  }
  assert.ok(top.length > 0);
  assert.ok(Math.max(...top) < BLOCK_SIZE.width / 2 - 0.02);
  assert.ok(geometry.getAttribute('normal'));
  geometry.dispose();
});

test('a lid is on the rim when closed and on the floor behind its container when open (D26)',
  () => {
    for (const scale of [0.4, 1, 2.5]) {
      assert.deepEqual(lidOffset(scale, 0), { x: 0, y: height * scale, z: 0 });
      const open = lidOffset(scale, 1);
      assert.equal(open.x, 0);
      assert.ok(Math.abs(open.y - LID_SKIRT * scale) < EPS);
      assert.ok(Math.abs(open.z - ((depth + 2 * lidOverhang) * scale + 0.3)) < EPS);
      // Out of range progress stays at the ends.
      assert.deepEqual(lidOffset(scale, -1), lidOffset(scale, 0));
      assert.deepEqual(lidOffset(scale, 2), open);
    }
  });

test('a lid never passes through its container on the way', () => {
  for (const scale of [0.4, 1, 2.5]) {
    const container = { position: { x: 0, y: 0, z: 0 }, scale };
    const body = bodyBox(container);
    let previous = lidOffset(scale, 0);
    for (let i = 1; i <= 400; i += 1) {
      const offset = lidOffset(scale, i / 400);
      const where = `scale ${scale}, step ${i}`;
      if (offset.z === 0) {
        // On the rim the skirt hangs outside the body, so the lid may only move straight up.
        assert.ok(offset.y >= previous.y, where);
      } else {
        // Once it moves back, all of it, skirt included, is clear of the body.
        assert.ok(!overlaps(lidBox(container, offset), body), where);
      }
      // The path is continuous.
      assert.ok(Math.hypot(offset.y - previous.y, offset.z - previous.z) < 0.05 * scale + 0.01,
        where);
      previous = offset;
    }
  }
});

test('open lids lie in the room M11 keeps behind each row, clear of every container', () => {
  const layout = computeLayout(ROWS);
  const rows = new Set(layout.containers.map((container) => container.position.z));
  assert.ok(rows.size >= 2, 'the layout has more than one row');
  const lids = layout.containers.map((container) =>
    lidBox(container, lidOffset(container.scale, 1)));
  layout.containers.forEach((container, index) => {
    for (const other of layout.containers) {
      assert.ok(!overlaps(lids[index], bodyBox(other)),
        `the lid of ${container.categoryId} on container ${other.categoryId}`);
      assert.ok(!overlaps(lids[index], lidBox(other, lidOffset(other.scale, 0))),
        `the lid of ${container.categoryId} on the closed lid of ${other.categoryId}`);
    }
    lids.forEach((lid, other) => {
      assert.ok(other === index || !overlaps(lids[index], lid), 'two open lids overlap');
    });
  });
});

test('the scene bounds hold every container, and its lid on the way when lids open', () => {
  assert.equal(sceneBounds(computeLayout([])), null);
  const layout = computeLayout(ROWS);
  const closed = sceneBounds(layout);
  const open = sceneBounds(layout, { lidsOpen: true });
  // The skirt of a lid on the floor hangs into it by LID_SKIRT at most.
  const inside = (box, { min, max }) => box.minX >= min.x - EPS && box.maxX <= max.x + EPS
    && box.minY >= min.y - LID_SKIRT * 3 && box.maxY <= max.y + EPS
    && box.minZ >= min.z - EPS && box.maxZ <= max.z + EPS;
  for (const container of layout.containers) {
    assert.ok(inside(bodyBox(container), closed));
    assert.ok(inside(lidBox(container, lidOffset(container.scale, 0)), closed));
    for (let i = 0; i <= 50; i += 1) {
      assert.ok(inside(lidBox(container, lidOffset(container.scale, i / 50)), open),
        `lid of ${container.categoryId} at ${i / 50}`);
    }
  }
  // Closed lids need no room behind the last row.
  assert.ok(closed.max.z < open.max.z - 1);
});

test('the framed camera sees every container, from any side and at any aspect ratio', () => {
  const points = containerBoxes(computeLayout(ROWS), { lidsOpen: true }).flatMap(boxCorners);
  assert.equal(points.length, 5 * 8);
  for (const aspect of [0.5, 1, 2.4]) {
    for (const direction of [new Vector3(0.6, 0.62, -1.2), new Vector3(0, 1, 0.01),
      new Vector3(-1, 0.2, 0.3)]) {
      const camera = new PerspectiveCamera(32, aspect, 0.05, 500);
      const { target, distance } = fitCamera(points, camera, direction.normalize());
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const seen = points.map((point) => point.clone().project(camera));
      for (const [index, where] of seen.entries()) {
        assert.ok(Math.abs(where.x) <= 1 && Math.abs(where.y) <= 1 && where.z < 1,
          `aspect ${aspect}: point ${points[index].toArray()} at ${where.toArray()}`);
      }
      // And they fill the view, centred, rather than leaving a wide margin.
      const reach = Math.max(...seen.map((where) =>
        Math.max(Math.abs(where.x), Math.abs(where.y))));
      assert.ok(reach > 0.85, `aspect ${aspect}: the points reach only ${reach} of the view`);
      for (const axis of ['x', 'y']) {
        const values = seen.map((where) => where[axis]);
        const middle = (Math.min(...values) + Math.max(...values)) / 2;
        assert.ok(Math.abs(middle) < 0.08, `aspect ${aspect}: off centre in ${axis} by ${middle}`);
      }
    }
  }
});

test('without WebGL there is no scene and the element is left untouched (R29)', () => {
  // Node has no WebGL, so creating the renderer fails here as it does in such a browser.
  const element = new Proxy({}, {
    get() {
      throw new Error('the element was used');
    },
  });
  assert.equal(createBrickScene(element, { reducedMotion: true }), null);
  assert.equal(createBrickScene(element), null);
});
