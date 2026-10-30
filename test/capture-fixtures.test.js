import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findKeyLeaks } from '../scripts/capture-fixtures.js';

const KEY = 'sentinel-key-1234567890abcdef';

test('names every output that contains the key', () => {
  const outputs = [
    { name: 'clean', text: '{"status": 200}' },
    { name: 'in-url', text: `{"next": "https://rebrickable.com/api/v3/?key=${KEY}"}` },
    { name: 'in-body', text: `{"detail": "${KEY}"}` },
  ];
  assert.deepEqual(findKeyLeaks(outputs, KEY), ['in-url', 'in-body']);
});

test('finds nothing when no output contains the key', () => {
  assert.deepEqual(findKeyLeaks([{ name: 'clean', text: '{"status": 200}' }], KEY), []);
});

test('an empty key matches nothing', () => {
  assert.deepEqual(findKeyLeaks([{ name: 'clean', text: '{}' }], ''), []);
});
