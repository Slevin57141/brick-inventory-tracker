import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AppError, ERRORS } from '../src/errors.js';
import {
  emptyState, findSet, addCopy, addCategories, removeCopy, listSets, buildInventory,
} from '../src/inventory.js';

const part = (changes = {}) => ({
  partNum: '3001', name: 'Brick 2 x 4', categoryId: 11, colorId: 4,
  colorName: 'Red', colorRgb: 'C91A09', colorIsTrans: false, imgUrl: null,
  quantity: 6, isSpare: false, ...changes,
});
const record = (setNum = '10270-1', parts = [part()]) => ({
  setNum, name: 'Example set', year: 2020, imgUrl: null, numParts: 6,
  containedSets: [], parts,
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('empty states have independent collections and no inventory', () => {
  assert.deepEqual(emptyState(), { version: 1, categories: {}, sets: {} });
  assert.notEqual(emptyState().sets, emptyState().sets);
  assert.notEqual(emptyState().categories, emptyState().categories);
  assert.deepEqual(buildInventory(emptyState()), []);
  assert.deepEqual(listSets(emptyState()), []);
});

test('inventory combines sets, copies and spares, keeping colours separate', () => {
  const examples = [
    { records: [record()], expected: [[4, 6]] },
    { records: [record(), record('10271-1', [part({ quantity: 2 })])], expected: [[4, 8]] },
    { records: [record(), record('10271-1', [part({ colorId: 1, colorName: 'Blue' })])],
      expected: [[1, 6], [4, 6]] },
    { records: [record(), record()], expected: [[4, 12]] },
    { records: [record('10270-1', [part(), part({ quantity: 1, isSpare: true })])],
      expected: [[4, 7]] },
  ];
  for (const example of examples) {
    const state = example.records.reduce(addCopy, emptyState());
    const rows = buildInventory(freeze(state));
    assert.deepEqual(rows.map(row => [row.colorId, row.quantity]), example.expected);
    for (const row of rows) assert.equal(Object.hasOwn(row, 'isSpare'), false);
  }
});

test('inventory maps every row field and uses category names or the fallback', () => {
  const state = addCategories(addCopy(emptyState(), record()), [{ id: 11, name: 'Bricks' }]);
  const { isSpare, ...expected } = part();
  assert.deepEqual(buildInventory(freeze(state)), [{ ...expected, categoryName: 'Bricks' }]);
  assert.equal(buildInventory(addCopy(emptyState(), record()))[0].categoryName, 'Unknown category');
});

test('inventory keeps the first non-null image across lines and copies', () => {
  let state = addCopy(emptyState(), record());
  state = addCopy(state, record('10271-1', [part({ imgUrl: '/first.png' })]));
  state = addCopy(state, record('10272-1', [part({ imgUrl: '/second.png' })]));
  assert.equal(buildInventory(freeze(state))[0].imgUrl, '/first.png');
});

test('inventory sorts by category, then part name, then colour name', () => {
  const parts = [
    part({ partNum: '4', categoryId: 14, name: 'A' }),
    part({ partNum: '3', name: 'Z' }),
    part({ partNum: '1', name: 'A' }),
    part({ partNum: '2', name: 'A', colorId: 1, colorName: 'Blue' }),
  ];
  const state = addCategories(addCopy(emptyState(), record('10270-1', parts)), [
    { id: 14, name: 'Plates' }, { id: 11, name: 'Bricks' },
  ]);
  assert.deepEqual(buildInventory(freeze(state)).map(row => row.partNum), ['2', '1', '3', '4']);
});

test('lookup, repeat adds and removal match case-insensitively and keep saved parts', () => {
  const original = freeze(record('AbC-1'));
  const once = freeze(addCopy(freeze(emptyState()), original));
  assert.equal(findSet(once, 'aBc-1'), once.sets['AbC-1']);
  assert.equal(findSet(once, 'missing-1'), null);
  const twice = freeze(addCopy(once, freeze(record('abc-1', [part({ quantity: 999 })]))));
  assert.deepEqual(Object.keys(twice.sets), ['AbC-1']);
  assert.equal(buildInventory(twice)[0].quantity, 12);
  assert.equal(once.sets['AbC-1'].copies, 1);
  const removed = freeze(removeCopy(twice, 'ABC-1'));
  assert.equal(buildInventory(removed)[0].quantity, 6);
  assert.deepEqual(removeCopy(removed, 'abc-1'), emptyState());
});

test('removing an unknown set throws the fixed not_owned AppError', () => {
  assert.throws(() => removeCopy(freeze(emptyState()), '10270-1'), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'not_owned');
    assert.equal(error.message, ERRORS.not_owned.message);
    return true;
  });
});

test('category updates preserve other categories without mutating frozen inputs', () => {
  const original = freeze(addCategories(freeze(emptyState()), freeze([{ id: 11, name: 'Old' }])));
  const updated = addCategories(original, freeze([{ id: 11, name: 'Bricks' }, { id: 14, name: 'Plates' }]));
  assert.deepEqual(updated.categories, { 11: 'Bricks', 14: 'Plates' });
  assert.deepEqual(original.categories, { 11: 'Old' });
});

test('set summaries omit parts and stay in addition order, including re-adds', () => {
  let state = addCopy(emptyState(), record('200-1'));
  state = addCopy(state, record('100-1'));
  state = addCopy(freeze(state), record('200-1'));
  const summaries = listSets(freeze(state));
  assert.deepEqual(summaries.map(set => [set.setNum, set.copies]), [['200-1', 2], ['100-1', 1]]);
  const { parts, ...expected } = record('200-1');
  assert.deepEqual(summaries[0], { ...expected, copies: 2 });
  state = removeCopy(removeCopy(state, '200-1'), '200-1');
  state = addCopy(state, record('200-1'));
  assert.deepEqual(listSets(state).map(set => set.setNum), ['100-1', '200-1']);
});

test('adding and removing every captured fixture set returns to empty inventory', () => {
  const directory = new URL('./fixtures/rebrickable/', import.meta.url);
  const names = readdirSync(directory).filter(name => /^set-\d+-\d+\.json$/.test(name));
  let state = emptyState();
  const setNums = [];
  for (const name of names) {
    const fixture = JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
    if (fixture.status !== 200) continue;
    const raw = fixture.body;
    const lines = JSON.parse(readFileSync(new URL(`set-${raw.set_num}-parts-page1.json`, directory), 'utf8')).body.results;
    const parts = lines.map(line => part({
      partNum: line.part.part_num, name: line.part.name, categoryId: line.part.part_cat_id,
      colorId: line.color.id, colorName: line.color.name, colorRgb: line.color.rgb,
      colorIsTrans: line.color.is_trans, imgUrl: line.part.part_img_url,
      quantity: line.quantity, isSpare: line.is_spare,
    }));
    const set = freeze({ ...record(raw.set_num, parts), name: raw.name, year: raw.year,
      imgUrl: raw.set_img_url, numParts: raw.num_parts });
    state = freeze(addCopy(freeze(state), set));
    setNums.push(raw.set_num);
  }
  assert.ok(setNums.length > 0);
  assert.ok(buildInventory(state).length > 0);
  assert.equal(buildInventory(state).reduce((sum, row) => sum + row.quantity, 0),
    Object.values(state.sets).flatMap(set => set.parts).reduce((sum, line) => sum + line.quantity, 0));
  for (const setNum of setNums) state = freeze(removeCopy(state, setNum));
  assert.deepEqual(buildInventory(state), []);
  assert.deepEqual(state, emptyState());
});
