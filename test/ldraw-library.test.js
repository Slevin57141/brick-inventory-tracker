// M14 against a small hand-made LDraw library in test/fixtures/ldraw/ (docs/plan.md D31).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  createLdrawLibrary, normalizeName, parseColors, parseLdraw,
} from '../src/ldraw-library.js';

const ROOT = fileURLToPath(new URL('./fixtures/ldraw/', import.meta.url));
const library = () => createLdrawLibrary({ root: ROOT });

// Triangles as lists of [x, y, z] corners, for comparing.
function triangles(positions) {
  const out = [];
  for (let i = 0; i < positions.length; i += 9) {
    out.push([0, 3, 6].map((k) => [...positions.slice(i + k, i + k + 3)]));
  }
  return out;
}

// The square in p/square.dat, as the two triangles of its quad, moved by (dx, dy) and with x
// multiplied by sx.
const square = (sx, dy) => [
  [[0, dy, 0], [10 * sx, dy, 0], [10 * sx, dy, 10]],
  [[0, dy, 0], [10 * sx, dy, 10], [0, dy, 10]],
];

test('a part comes with the faces of its subparts and primitives, moved into place', async () => {
  const part = await library().part(['test01']);
  assert.equal(part.name, 'test01.dat');
  assert.deepEqual(triangles(part.positions), [
    // S\TEST01S01.DAT, placed 8 above: the square, and the square mirrored in x.
    ...square(1, -8), ...square(-1, -8),
    // Its own triangle. Its edge and optional lines are left out.
    [[0, 0, 0], [0, 4, 0], [4, 0, 0]],
  ]);
  assert.ok(part.positions instanceof Float32Array);
});

test('names are found without regard to case, slashes or the .dat ending', async () => {
  const lib = library();
  const reference = (await lib.part(['test01'])).positions;
  for (const name of ['TEST01.DAT', 'test01.dat', ' Test01 ']) {
    assert.deepEqual((await lib.part([name])).positions, reference, name);
  }
  assert.equal((await lib.part(['s\\TEST01S01'])).name, 's/test01s01.dat');
  assert.deepEqual(triangles((await lib.part(['s/test01s01.dat'])).positions),
    [...square(1, 0), ...square(-1, 0)]);
  assert.equal((await lib.part(['48\\hires'])).name, '48/hires.dat');
});

test('the first name the library has is used; with none, there is no part', async () => {
  const lib = library();
  assert.equal((await lib.part(['missing', '', 'test01', 'test02'])).name, 'test01.dat');
  assert.equal(await lib.part(['missing', 'nothere']), null);
  assert.equal(await lib.part([]), null);
});

test('only library names are looked up, never a path out of the library', async () => {
  const lib = library();
  for (const name of ['../LDConfig.ldr', '..\\LDConfig', 'LDConfig', '/etc/passwd',
    'C:\\Windows\\win.ini', 'parts/test01.dat', 'omr/1234-1 - Test Model.mpd']) {
    assert.equal(await lib.part([name]), null, name);
  }
});

test('a missing file is skipped and a file that refers to itself stops', async () => {
  const part = await library().part(['test02']);
  // Only 48\hires.dat: nothere.dat is missing, and test02.dat itself is not followed.
  assert.deepEqual(triangles(part.positions), [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
});

test('the library is available only when it has parts', async () => {
  assert.equal(await library().available(), true);
  const missing = createLdrawLibrary({
    root: fileURLToPath(new URL('./missing/', import.meta.url)),
  });
  assert.equal(await missing.available(), false);
  assert.equal(await missing.part(['test01']), null);
  assert.equal(await missing.model('1234-1'), null);
});

test('a set model is unwrapped into placed parts with their colours', async () => {
  const model = await library().model('1234-1');
  const placed = model.instances.map(({ part, color, matrix }) => ({ part,
    color: model.colors[color], matrix }));
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.deepEqual(placed, [
    { part: 'test01.dat', color: { rgb: 'C91A09', alpha: 255 }, matrix: [0, 0, 0, ...identity] },
    // Inside Sub.ldr, placed at x 100 in the main colour: its main colour has nothing to
    // inherit, so it is the fallback grey.
    { part: 'test01.dat', color: { rgb: '9BA19D', alpha: 255 },
      matrix: [100, -24, 0, ...identity] },
    { part: 'test01.dat', color: { rgb: '6C6E68', alpha: 255 },
      matrix: [100, 0, 10, 0, 0, 1, 0, 1, 0, -1, 0, 0] },
    // A direct colour, 0x2RRGGBB.
    { part: 'test01.dat', color: { rgb: 'FF8800', alpha: 255 }, matrix: [0, 0, 50, ...identity] },
  ]);
  // notinlibrary.dat is skipped. Faces in the model itself come per colour, moved into place.
  const loose = model.loose.map(({ color, positions }) => ({ color: model.colors[color],
    triangles: triangles(positions) }));
  assert.deepEqual(loose, [
    { color: { rgb: '05131D', alpha: 255 }, triangles: [
      [[100, 0, 0], [101, 0, 0], [101, 0, 1]], [[100, 0, 0], [101, 0, 1], [100, 0, 1]]] },
    { color: { rgb: 'FCFCFC', alpha: 128 }, triangles: [[[0, 0, 0], [1, 0, 0], [0, 0, 1]]] },
  ]);
});

test('a model is found by its set number, and only by the whole number', async () => {
  const lib = library();
  assert.deepEqual((await lib.model('1234-10')).instances.map((item) => item.part),
    ['test01.dat']);
  assert.notEqual(await lib.model('1234-1'), null, 'not confused with 1234-10');
  for (const setNum of ['1234', '234-1', '9999-1', '', undefined, 42]) {
    assert.equal(await lib.model(setNum), null, String(setNum));
  }
});

test('LDraw text is read into sections, with quads split into triangles', () => {
  const sections = parseLdraw('0 FILE Main.ldr\r\n1 4 1 2 3 1 0 0 0 1 0 0 0 1 S\\Sub Part.dat\r\n'
    + '0 FILE Other.ldr\r\n4 16 0 0 0 1 0 0 1 1 0 0 1 0\r\n2 24 0 0 0 1 1 1\r\nnonsense\r\n'
    + '3 16 1 2\r\n');
  assert.deepEqual([...sections.keys()], ['main.ldr', 'other.ldr']);
  assert.deepEqual(sections.get('main.ldr'), [{ type: 1, color: 4,
    matrix: [1, 2, 3, 1, 0, 0, 0, 1, 0, 0, 0, 1], file: 'S\\Sub Part.dat' }]);
  assert.deepEqual(sections.get('other.ldr'), [{ type: 3, color: 16,
    points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0] }]);
  assert.deepEqual([...parseLdraw('0 just a comment').keys()], ['']);
  assert.equal(normalizeName(' S\\Sub.DAT '), 's/sub.dat');
});

test('LDConfig colours are read with their alpha', () => {
  const colors = parseColors('0 !COLOUR Red CODE 4 VALUE #c91a09 EDGE #333333\n'
    + '0 !COLOUR Trans CODE 47 VALUE #FCFCFC EDGE #C3C3C3 ALPHA 128\n0 // a comment CODE 9');
  assert.deepEqual([...colors], [[4, { rgb: 'C91A09', alpha: 255 }],
    [47, { rgb: 'FCFCFC', alpha: 128 }]]);
});
