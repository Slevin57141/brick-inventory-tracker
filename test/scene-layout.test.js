import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTAINER, interiorBox } from '../public/js/container-spec.js';
import {
  BLOCK_SIZE, computeLayout, planTransition, frameAt, easeInOutCubic,
} from '../public/js/scene-layout.js';

const row = (quantity, changes = {}) => ({ categoryId: 11, categoryName: 'Bricks',
  colorId: 4, colorRgb: 'C91A09', colorIsTrans: false, quantity, ...changes });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('block counts round up per colour after summing rows in a category', () => {
  for (const [quantity, count] of [[1, 1], [100, 1], [101, 2], [250, 3]]) {
    const layout = computeLayout([row(quantity)]);
    assert.equal(layout.blocks.length, count);
    assert.equal(layout.containers[0].pieces, quantity);
  }
  assert.equal(computeLayout([row(50), row(50)]).blocks.length, 1);
  assert.equal(computeLayout([row(1), row(1, { colorId: 1 })]).blocks.length, 2);
  assert.equal(computeLayout([row(101)], { piecesPerBlock: 50 }).blocks.length, 3);
  assert.deepEqual(computeLayout([]), { piecesPerBlock: 100, containers: [], blocks: [] });
  assert.deepEqual(computeLayout([row(0)]), computeLayout([]));
});

test('container scale grows with blocks and bounds contain every whole brick', () => {
  let previousScale = 0;
  for (const count of [1, 2, 3, 10, 100, 300]) {
    const layout = computeLayout([row(count * 100)]);
    const container = layout.containers[0];
    assert.ok(container.scale >= previousScale);
    previousScale = container.scale;
    const box = interiorBox(container.scale);
    for (const block of layout.blocks) {
      const x = block.position.x - container.position.x;
      const z = block.position.z - container.position.z;
      assert.ok(Math.abs(x) + BLOCK_SIZE.width / 2 <= box.width / 2 + 1e-10);
      assert.ok(Math.abs(z) + BLOCK_SIZE.depth / 2 <= box.depth / 2 + 1e-10);
      assert.ok(block.position.y - BLOCK_SIZE.height / 2 >= box.floorY - 1e-10);
      assert.ok(block.position.y + BLOCK_SIZE.height / 2 <= box.floorY + box.height + 1e-10);
    }
  }
  assert.ok(computeLayout([row(10000)]).containers[0].scale
    > computeLayout([row(100)]).containers[0].scale);
});

test('grid uses the smallest uniform scale for its block count', () => {
  const box = interiorBox(1);
  for (let count = 1; count <= 40; count += 1) {
    let best = Infinity;
    for (let cols = 1; cols <= count; cols += 1) {
      for (let rows = 1; rows <= count; rows += 1) {
        const layers = Math.ceil(count / (cols * rows));
        best = Math.min(best, Math.max((0.18 + (cols - 1) * 0.2) / box.width,
          (0.18 + (rows - 1) * 0.2) / box.depth, (0.22 + (layers - 1) * 0.24) / box.height));
      }
    }
    close(computeLayout([row(count * 100)]).containers[0].scale, best);
  }
});

test('bricks do not overlap and are packed from the bottom up', () => {
  const blocks = computeLayout([row(12000)]).blocks;
  for (let i = 0; i < blocks.length; i += 1) {
    if (i > 0) assert.ok(blocks[i].position.y >= blocks[i - 1].position.y);
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i].position;
      const b = blocks[j].position;
      assert.ok(Math.abs(a.x - b.x) >= BLOCK_SIZE.width - 1e-10
        || Math.abs(a.y - b.y) >= BLOCK_SIZE.height - 1e-10
        || Math.abs(a.z - b.z) >= BLOCK_SIZE.depth - 1e-10);
    }
  }
});

test('containers sort by category name and never overlap, including their lids', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(100 * (i + 1) ** 2,
    { categoryId: i, categoryName: `Category ${10 - i}` }));
  const { containers } = computeLayout(rows);
  assert.deepEqual(containers.map(container => container.categoryName),
    Array.from({ length: 10 }, (_, i) => `Category ${i + 1}`));
  const perRow = Math.ceil(Math.sqrt(containers.length));
  for (let i = 0; i < containers.length; i += 1) {
    assert.equal(containers[i].position.y, 0);
    if (i % perRow !== 0) assert.equal(containers[i].position.z, containers[i - 1].position.z);
    for (let j = i + 1; j < containers.length; j += 1) {
      const a = containers[i];
      const b = containers[j];
      const width = (CONTAINER.width + 2 * CONTAINER.lidOverhang) * (a.scale + b.scale) / 2;
      const depth = (CONTAINER.depth + 2 * CONTAINER.lidOverhang) * (a.scale + b.scale) / 2;
      assert.ok(Math.abs(a.position.x - b.position.x) >= width + 0.3 - 1e-10
        || Math.abs(a.position.z - b.position.z) >= depth + 0.3 - 1e-10);
    }
  }
});

test('open lids fit flat behind their containers without covering other containers or lids', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(100 * (i + 1) ** 3,
    { categoryId: i, categoryName: `Category ${i}` }));
  const { containers } = computeLayout(rows);
  const footprints = containers.flatMap(container => {
    const width = (CONTAINER.width + 2 * CONTAINER.lidOverhang) * container.scale;
    const depth = (CONTAINER.depth + 2 * CONTAINER.lidOverhang) * container.scale;
    return [
      { x: container.position.x, z: container.position.z, width, depth },
      { x: container.position.x, z: container.position.z + depth + 0.3, width, depth },
    ];
  });
  for (let i = 0; i < footprints.length; i += 1) {
    for (let j = i + 1; j < footprints.length; j += 1) {
      const a = footprints[i];
      const b = footprints[j];
      assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 0.3 - 1e-10
        || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2 + 0.3 - 1e-10);
    }
  }
});

test('layout is deterministic across reordered, frozen rows and preserves colour metadata', () => {
  const rows = freeze([row(250), row(100, { colorId: 1, colorRgb: 'AABBCC', colorIsTrans: true }),
    row(10, { categoryId: 14, categoryName: 'Plates' })]);
  const layout = computeLayout(rows);
  assert.deepEqual(computeLayout([...rows].reverse()), layout);
  assert.deepEqual(computeLayout(rows), layout);
  assert.equal(layout.blocks[0].key, '11|1|0');
  assert.equal(layout.blocks[0].colorRgb, 'AABBCC');
  assert.equal(layout.blocks[0].colorIsTrans, true);
});

test('removing a colour shrinks the container and preserves the remaining keys', () => {
  const from = computeLayout([row(100), row(10000, { colorId: 1 })]);
  const to = computeLayout([row(100)]);
  assert.ok(to.containers[0].scale < from.containers[0].scale);
  assert.ok(from.blocks.some(block => block.key === to.blocks[0].key));
});

function visible(frame) {
  return {
    containers: frame.containers.filter(item => item.scale > 0).map(item => ({ ...item }))
      .sort((a, b) => a.categoryId - b.categoryId),
    blocks: frame.blocks.filter(item => item.scale > 0).map(item => ({ ...item }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function renderedLayout(layout) {
  return visible({ containers: layout.containers,
    blocks: layout.blocks.map(block => ({ ...block, scale: 1 })) });
}

test('transition endpoints reproduce both layouts, with invisible entering/leaving items', () => {
  const from = freeze(computeLayout([
    row(250), row(100, { categoryId: 14, categoryName: 'Plates' }),
  ]));
  const to = freeze(computeLayout([row(100), row(101, { categoryId: 1, categoryName: 'Arches' })]));
  const transition = freeze(planTransition(from, to));
  assert.deepEqual(visible(frameAt(transition, 0)), renderedLayout(from));
  assert.deepEqual(visible(frameAt(transition, 1)), renderedLayout(to));
  assert.deepEqual(visible(frameAt(transition, -1)), renderedLayout(from));
  assert.deepEqual(visible(frameAt(transition, 2)), renderedLayout(to));
  const middle = frameAt(transition, 0.5);
  const kept = transition.blocks.find(pair => pair.from.key === '11|4|0');
  const moved = middle.blocks.find(block => block.key === '11|4|0');
  close(moved.position.x, (kept.from.position.x + kept.to.position.x) / 2);
  for (const pair of transition.blocks.filter(pair => pair.from.categoryId === 1)) {
    const container = to.containers.find(container => container.categoryId === 1);
    assert.ok(pair.from.position.y > (CONTAINER.height + CONTAINER.lidHeight) * container.scale);
    assert.equal(pair.from.scale, 0);
    assert.equal(pair.to.scale, 1);
  }
  const leaving = transition.blocks.find(pair => pair.from.key === '11|4|2');
  assert.deepEqual(leaving.from.position, leaving.to.position);
  assert.equal(leaving.to.scale, 0);
});

test('empty, identical and interrupted transitions are usable without mutating inputs', () => {
  const empty = freeze(computeLayout([]));
  const full = freeze(computeLayout([row(100)]));
  assert.deepEqual(frameAt(planTransition(empty, empty), 0.5), empty);
  assert.deepEqual(visible(frameAt(planTransition(full, full), 0.5)), renderedLayout(full));
  assert.deepEqual(visible(frameAt(planTransition(full, empty), 1)), renderedLayout(empty));
  const mid = freeze(frameAt(planTransition(empty, full), 0.4));
  assert.deepEqual(visible(frameAt(planTransition(mid, empty), 0)), visible(mid));
  const transition = planTransition(full, empty);
  const output = frameAt(transition, 0);
  output.blocks[0].position.x = 999;
  assert.notEqual(transition.blocks[0].from.position.x, 999);
  assert.notEqual(full.blocks[0].position.x, 999);
});

test('cubic easing is monotonic and clamps to its exact endpoints', () => {
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(2), 1);
  let previous = 0;
  for (let i = 0; i <= 1000; i += 1) {
    const value = easeInOutCubic(i / 1000);
    assert.ok(value >= previous);
    previous = value;
  }
});
