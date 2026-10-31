import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureError, findKeyLeaks, parseCommandLine } from '../scripts/capture-fixtures.js';

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

test('the command line takes set numbers, or --themes alone', () => {
  assert.deepEqual(parseCommandLine(['10270-1', '31146-1']),
    { themesOnly: false, pageSize: 1000, setNums: ['10270-1', '31146-1'] });
  assert.equal(parseCommandLine(['--page-size', '100', '76991-1']).pageSize, 100);
  assert.deepEqual(parseCommandLine(['--themes']),
    { themesOnly: true, pageSize: 1000, setNums: [] });
  for (const argv of [[], ['--themes', '10270-1'], ['--themes', '--page-size', '100'],
    ['10270'], ['--page-size', '0', '10270-1']]) {
    assert.throws(() => parseCommandLine(argv), CaptureError, argv.join(' '));
  }
});
