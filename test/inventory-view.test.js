import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, computeTotals, filterOptions } from '../public/js/inventory-view.js';

const rows = Object.freeze([
  { partNum: '3001', name: 'Brick 2 x 4', categoryId: 11, categoryName: 'Bricks',
    colorId: 4, colorName: 'Red', colorRgb: 'C91A09', quantity: 8 },
  { partNum: '3001', name: 'Brick 2 x 4', categoryId: 11, categoryName: 'Bricks',
    colorId: 0, colorName: 'Black', colorRgb: '05131D', quantity: 3 },
  { partNum: '3020', name: 'Plate 2 x 4', categoryId: 14, categoryName: 'Plates',
    colorId: 4, colorName: 'Red', colorRgb: 'C91A09', quantity: 5 },
  { partNum: 'AbC1', name: 'Arch', categoryId: 0, categoryName: 'Arches',
    colorId: 1, colorName: 'Blue', colorRgb: '0055BF', quantity: 1 },
].map(row => Object.freeze({ ...row, colorIsTrans: false, imgUrl: null })));

test('filters by colour and category individually or together, including zero IDs', () => {
  const cases = [
    [{}, [0, 1, 2, 3]],
    [{ colorId: 4 }, [0, 2]],
    [{ colorId: 0 }, [1]],
    [{ categoryId: 11 }, [0, 1]],
    [{ categoryId: 0 }, [3]],
    [{ colorId: 4, categoryId: 11 }, [0]],
    [{ colorId: 1, categoryId: 14 }, []],
    [{ colorId: 999 }, []],
    [{ categoryId: 999 }, []],
  ];
  for (const [filters, indices] of cases) {
    assert.deepEqual(filterRows(rows, filters), indices.map(index => rows[index]));
  }
  assert.deepEqual(filterRows(rows), rows);
  assert.notEqual(filterRows(rows), rows);
});

test('search matches part number or name without case or outer whitespace', () => {
  const cases = [
    ['  3001  ', [0, 1]], [' BRICK ', [0, 1]], ['2 X 4', [0, 1, 2]],
    [' aBc1 ', [3]], [' arch ', [3]], ['  ', [0, 1, 2, 3]], ['missing', []],
    ['Red', []],
  ];
  for (const [search, indices] of cases) {
    assert.deepEqual(filterRows(rows, { search }), indices.map(index => rows[index]));
  }
});

test('search combines with either filter and with both filters', () => {
  assert.deepEqual(filterRows(rows, { colorId: 4, search: 'brick' }), [rows[0]]);
  assert.deepEqual(filterRows(rows, { categoryId: 11, search: '3001' }), [rows[0], rows[1]]);
  assert.deepEqual(filterRows(rows, { colorId: 4, categoryId: 14, search: 'plate' }), [rows[2]]);
  assert.deepEqual(filterRows(rows, { colorId: 4, categoryId: 14, search: 'brick' }), []);
});

test('totals count part-and-colour rows and sum only the supplied rows', () => {
  assert.deepEqual(computeTotals(rows), { distinctParts: 4, totalPieces: 17 });
  assert.deepEqual(computeTotals(filterRows(rows, { categoryId: 11 })),
    { distinctParts: 2, totalPieces: 11 });
  assert.deepEqual(computeTotals(filterRows(rows, { colorId: 4, search: 'plate' })),
    { distinctParts: 1, totalPieces: 5 });
  assert.deepEqual(computeTotals([]), { distinctParts: 0, totalPieces: 0 });
});

test('options are unique by ID, sorted by name and contain only present values', () => {
  assert.deepEqual(filterOptions(rows), {
    colors: [
      { id: 0, name: 'Black', rgb: '05131D' },
      { id: 1, name: 'Blue', rgb: '0055BF' },
      { id: 4, name: 'Red', rgb: 'C91A09' },
    ],
    categories: [{ id: 0, name: 'Arches' }, { id: 11, name: 'Bricks' }, { id: 14, name: 'Plates' }],
  });
  assert.deepEqual(filterOptions(filterRows(rows, { categoryId: 14 })), {
    colors: [{ id: 4, name: 'Red', rgb: 'C91A09' }],
    categories: [{ id: 14, name: 'Plates' }],
  });
  assert.deepEqual(filterOptions([]), { colors: [], categories: [] });
});

test('options use English numeric ordering like the inventory list', () => {
  const options = filterOptions([
    { ...rows[0], colorId: 10, colorName: 'Color 10', categoryId: 10, categoryName: 'Category 10' },
    { ...rows[0], colorId: 2, colorName: 'Color 2', categoryId: 2, categoryName: 'Category 2' },
  ]);
  assert.deepEqual(options.colors.map(color => color.id), [2, 10]);
  assert.deepEqual(options.categories.map(category => category.id), [2, 10]);
});

test('option objects can be changed without changing the input rows', () => {
  const options = filterOptions(rows);
  options.colors[0].name = 'Changed';
  options.categories[0].name = 'Changed';
  assert.equal(rows[1].colorName, 'Black');
  assert.equal(rows[3].categoryName, 'Arches');
});
