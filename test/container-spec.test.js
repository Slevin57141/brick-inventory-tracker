import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTAINER, interiorBox } from '../public/js/container-spec.js';

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} is not ${expected}`);

test('the proportions follow container-spec.md section 1', () => {
  assert.ok(CONTAINER.depth > CONTAINER.width, 'longer front-to-back than wide');
  assert.ok(CONTAINER.height > CONTAINER.width, 'taller than wide');
  assert.ok(CONTAINER.taper > 0, 'the walls taper');
  assert.ok(CONTAINER.taper < CONTAINER.width * 0.05, 'the taper is subtle');
  assert.ok(CONTAINER.chamfer > 0, 'the corners are chamfered');
  assert.ok(CONTAINER.lidHeight < CONTAINER.height * 0.1, 'the lid is a thin, shallow cap');
  assert.ok(CONTAINER.lidOverhang > 0, 'the lid reaches slightly past the walls');
});

test('the interior is a real space inside the walls, above the bottom, below the rim', () => {
  const inside = interiorBox(1);
  for (const side of ['width', 'depth', 'height']) {
    assert.ok(inside[side] > 0, `${side} is positive`);
  }
  const bottomWidth = CONTAINER.width - 2 * CONTAINER.taper;
  const bottomDepth = CONTAINER.depth - 2 * CONTAINER.taper;
  assert.ok(inside.width < bottomWidth - 2 * CONTAINER.wall);
  assert.ok(inside.depth < bottomDepth - 2 * CONTAINER.wall);
  assert.ok(inside.floorY >= CONTAINER.footHeight + CONTAINER.wall);
  assert.ok(inside.floorY + inside.height <= CONTAINER.height);
});

test('the interior keeps the container elongated: deeper than wide', () => {
  const inside = interiorBox(1);
  assert.ok(inside.depth > inside.width);
});

test('the interior grows in proportion to the scale', () => {
  const one = interiorBox(1);
  const three = interiorBox(3);
  for (const side of ['width', 'depth', 'height', 'floorY']) {
    close(three[side], one[side] * 3, side);
  }
  assert.deepEqual(interiorBox(), one);
});

test('the dimensions cannot be changed at run time', () => {
  assert.ok(Object.isFrozen(CONTAINER));
});
