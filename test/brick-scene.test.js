// M12 draws with WebGL, which Node does not have, so the drawing is checked by hand (plan
// section 10). These tests cover what M12 adds to the layout maths of M11: the brick shape,
// the path of a lid, the floor labels, the box the camera frames, the selection ring and the
// fallback without WebGL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from '../public/vendor/three/three.module.js';
import { CONTAINER } from '../public/js/container-spec.js';
import { LID_SKIRT } from '../public/js/container-model.js';
import { BLOCK_SIZE, computeLayout } from '../public/js/scene-layout.js';
import {
  boxCorners, containerBoxes, createBrickGeometry, createBrickScene, createPartGeometry,
  createSelectionRingGeometry, drawLabel, fitCamera, framingBoxes, labelBox, lidOffset,
  sceneBounds, stackBlocks,
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

// A box of LDraw triangles (LDraw units and axes), from (x0, y0, z0) to (x1, y1, z1).
function ldrawBox([x0, y0, z0], [x1, y1, z1]) {
  const c = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  const quads = [
    [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)],
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)],
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
    [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)],
  ];
  return Float32Array.from(quads.flatMap(([a, b, d, e]) => [a, b, d, a, d, e].flat()));
}

test('a part shape is turned upright, centred, and shrunk to fit a block, never enlarged (D31)',
  () => {
    // A 2 x 4 brick's bounds, its studs up (LDraw's y points down): too big for a block.
    const big = createPartGeometry(ldrawBox([-40, -4, -20], [40, 24, 20]));
    const { min, max } = big.boundingBox;
    for (const [axis, size] of [['x', BLOCK_SIZE.width], ['y', BLOCK_SIZE.height],
      ['z', BLOCK_SIZE.depth]]) {
      assert.ok(max[axis] - min[axis] <= size + 1e-6, `fits in ${axis}`);
      assert.ok(Math.abs(min[axis] + max[axis]) < 1e-6, `centred in ${axis}`);
    }
    // The long side fills the block; the proportions stay (80 by 28 by 40).
    assert.ok(Math.abs(max.x - min.x - BLOCK_SIZE.width) < 1e-6);
    assert.ok(Math.abs((max.z - min.z) / (max.x - min.x) - 0.5) < 1e-6);
    assert.ok(big.getAttribute('normal'));

    // A small part keeps its real size: 4 LDraw units are 4 / 20 of a brick's width.
    const small = createPartGeometry(ldrawBox([0, 0, 0], [4, 4, 4]));
    const smallSize = small.boundingBox.max.x - small.boundingBox.min.x;
    assert.ok(Math.abs(smallSize - (4 / 20) * BLOCK_SIZE.width) < 1e-6);

    // Up is up: a point at LDraw y -10 (above) ends above one at y 0.
    const tall = createPartGeometry(Float32Array.from([0, 0, 0, 1, 0, 0, 0, -10, 0]));
    const ys = [0, 1, 2].map((i) => tall.getAttribute('position').getY(i));
    assert.ok(ys[2] > ys[0]);
  });

test('plain bricks stack where M11 puts them; flat parts lie on each other (D31)', () => {
  const layout = Object.freeze(computeLayout([row(1, 4, 2500), row(2, 1, 900)]));
  const plain = stackBlocks(layout, () => BLOCK_SIZE.height);
  plain.blocks.forEach((block, index) => {
    assert.ok(Math.abs(block.position.y - layout.blocks[index].position.y) < 1e-9, block.key);
    assert.deepEqual({ ...block, position: undefined },
      { ...layout.blocks[index], position: undefined });
  });

  const flat = 0.05;
  const stacked = stackBlocks(layout, () => flat);
  const columns = new Map();
  for (const block of stacked.blocks) {
    const key = `${block.categoryId}|${block.position.x}|${block.position.z}`;
    columns.set(key, [...(columns.get(key) ?? []), block.position.y]);
  }
  assert.ok([...columns.values()].some((ys) => ys.length > 1), 'some columns hold several');
  for (const [key, ys] of columns) {
    const categoryId = Number(key.split('|')[0]);
    const floor = Math.min(...layout.blocks.filter((block) => block.categoryId === categoryId)
      .map((block) => block.position.y - BLOCK_SIZE.height / 2));
    ys.sort((a, b) => a - b).forEach((y, index) => {
      assert.ok(Math.abs(y - (floor + flat / 2 + index * (flat + 0.02))) < 1e-9, key);
    });
  }
  // Everything only went down, and the input is unchanged.
  stacked.blocks.forEach((block, index) => {
    assert.ok(block.position.y <= layout.blocks[index].position.y + 1e-9);
  });
  assert.equal(Object.isFrozen(layout), true);
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

// A floor label as a flat box just above the floor.
const floorLabel = (container) => ({ ...labelBox(container), minY: 0, maxY: 0.002 });

test('each label lies in front of its container, clear of every container, lid and label', () => {
  const layout = computeLayout(ROWS);
  const labels = layout.containers.map(floorLabel);
  layout.containers.forEach((container, index) => {
    const label = labels[index];
    const body = bodyBox(container);
    // In front (toward -z), close to it, and at least as wide.
    assert.ok(label.maxZ <= body.minZ && body.minZ - label.maxZ < 0.1, `${container.categoryId}`);
    assert.ok(label.minX <= body.minX && label.maxX >= body.maxX);
    for (const [otherIndex, other] of layout.containers.entries()) {
      const where = `the label of ${container.categoryId} and ${other.categoryId}`;
      assert.ok(!overlaps(label, bodyBox(other)), `${where}'s body`);
      assert.ok(!overlaps(label, lidBox(other, lidOffset(other.scale, 1))), `${where}'s open lid`);
      assert.ok(otherIndex === index || !overlaps(label, labels[otherIndex]), `${where}'s label`);
    }
    // The camera frames it.
    const [box] = framingBoxes(layout, { focus: container.categoryId });
    assert.ok(box.min.x <= label.minX + EPS && box.max.x >= label.maxX - EPS
      && box.min.z <= label.minZ + EPS && box.max.z >= label.maxZ - EPS);
  });
});

/** A stand-in for a canvas 2D context: records the text and fills, measures text roughly. */
function fakeContext(width, height) {
  const calls = { texts: [], fills: [] };
  const context = {
    canvas: { width, height },
    font: '',
    fillStyle: '',
    clearRect() {},
    beginPath() {},
    roundRect() {},
    stroke() {},
    fill() {
      calls.fills.push(context.fillStyle);
    },
    measureText(text) {
      const px = Number.parseFloat(/(\d+(\.\d+)?)px/.exec(context.font)[1]);
      return { width: text.length * px * 0.55 };
    },
    fillText(text, x) {
      calls.texts.push({ text, x, font: context.font, color: context.fillStyle });
    },
  };
  return { context, calls };
}

test('a label shows the name and count, shrinks or shortens long names, and turns red', () => {
  const plain = fakeContext(420, 110);
  drawLabel(plain.context, { name: 'Bricks', count: '67 pieces', selected: false });
  assert.deepEqual(plain.calls.texts.map((call) => call.text), ['Bricks', '67 pieces']);
  assert.equal(plain.calls.fills[0], '#ffffff');
  for (const call of plain.calls.texts) {
    assert.equal(call.x, 210, 'centred');
  }

  const long = 'Technic Steering, Suspension and Engine with Many Other Words';
  const narrow = fakeContext(200, 110);
  drawLabel(narrow.context, { name: long, count: '1 piece', selected: true });
  const [name] = narrow.calls.texts;
  assert.ok(name.text.endsWith('...') && name.text.length < long.length);
  narrow.context.font = name.font;
  assert.ok(narrow.context.measureText(name.text).width <= 200 * 0.9, 'it fits');
  // It shrank before it was cut: smaller than the starting size, a third of the height.
  assert.ok(Number.parseFloat(/(\d+(\.\d+)?)px/.exec(name.font)[1]) < 110 * 0.34);
  assert.equal(narrow.calls.fills[0], '#a63a32');
  assert.equal(name.color, '#ffffff');
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

test('a focused container is framed alone; otherwise, or when it is gone, all are', () => {
  const layout = computeLayout(ROWS);
  const all = containerBoxes(layout);
  assert.deepEqual(framingBoxes(layout), all);
  assert.deepEqual(framingBoxes(layout, { focus: null }), all);
  assert.deepEqual(framingBoxes(layout, { focus: 999 }), all);
  layout.containers.forEach((container, index) => {
    assert.deepEqual(framingBoxes(layout, { focus: container.categoryId }), [all[index]]);
  });
  // With lids open, the focused container's box reaches its lid on the floor.
  const [open] = framingBoxes(layout, { focus: 2, lidsOpen: true });
  const container = layout.containers.find((item) => item.categoryId === 2);
  assert.ok(open.max.z >= container.position.z + lidOffset(container.scale, 1).z);
  assert.equal(framingBoxes(computeLayout([]), { focus: 2 }).length, 0);
});

test('the selection ring lies flat on the floor, all around and clear of the lid', () => {
  const geometry = createSelectionRingGeometry();
  const positions = geometry.getAttribute('position');
  assert.ok(positions.count > 0);
  const lid = { x: width / 2 + lidOverhang, z: depth / 2 + lidOverhang };
  const quadrants = new Set();
  for (let i = 0; i < positions.count; i += 1) {
    const [x, y, z] = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    assert.ok(Math.abs(y) < 1e-9, 'flat on the floor');
    // Every point is outside the lid's outline, with a gap.
    assert.ok(Math.abs(x) >= lid.x + 0.02 || Math.abs(z) >= lid.z + 0.02, `${x}, ${z}`);
    quadrants.add(`${Math.sign(x)}${Math.sign(z)}`);
  }
  assert.equal(quadrants.size, 4, 'it goes all the way around');
  // Its faces point up, so it is seen from above.
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i += 1) {
    assert.ok(normals.getY(i) > 0.99);
  }
  geometry.dispose();
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
