// M15's pure parts: LDraw matrices and triangles as three.js objects. The drawing itself needs
// WebGL and is checked by hand (plan section 10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../public/vendor/three/three.module.js';
import { createModelView, ldrawGeometry, ldrawMatrix } from '../public/js/model-view.js';

test('an LDraw matrix places a point as LDraw does: rotation, then the offset', () => {
  // x y z a b c d e f g h i: a quarter turn about y, moved to (10, -24, 5).
  const matrix = ldrawMatrix([10, -24, 5, 0, 0, 1, 0, 1, 0, -1, 0, 0]);
  const point = new Vector3(20, 4, 0).applyMatrix4(matrix);
  // LDraw: x' = a x + b y + c z + x0 = 10; y' = d x + e y + f z + y0 = -20; z' = g x + ... = -15.
  assert.deepEqual(point.toArray().map((value) => Math.round(value * 1e9) / 1e9), [10, -20, -15]);
});

test('LDraw triangles become a geometry with a normal per face', () => {
  const geometry = ldrawGeometry(Float32Array.from([0, 0, 0, 10, 0, 0, 0, 0, 10]));
  assert.equal(geometry.getAttribute('position').count, 3);
  const normal = geometry.getAttribute('normal');
  assert.ok(Math.abs(Math.abs(normal.getY(0)) - 1) < 1e-6, 'the face lies flat, its normal on y');
});

test('without WebGL there is no model view and the element is left untouched', () => {
  const element = new Proxy({}, {
    get() {
      throw new Error('the element was used');
    },
  });
  assert.equal(createModelView(element, { loadShape: async () => null }), null);
});
