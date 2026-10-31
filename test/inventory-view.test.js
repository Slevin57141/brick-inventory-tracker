import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SORT_COLUMNS, computeTotals, filterOptions, filterRows, sortRows,
} from '../public/js/inventory-view.js';

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

test('part number and name filters each match their own column only', () => {
  const cases = [
    [{ partNum: ' 30 ' }, [0, 1, 2]], [{ partNum: 'abc' }, [3]], [{ partNum: 'Brick' }, []],
    [{ name: ' PLATE ' }, [2]], [{ name: '2 x 4' }, [0, 1, 2]], [{ name: '3001' }, []],
    [{ partNum: '3001', name: 'brick' }, [0, 1]], [{ partNum: '', name: '  ' }, [0, 1, 2, 3]],
  ];
  for (const [filters, indices] of cases) {
    assert.deepEqual(filterRows(rows, filters), indices.map(index => rows[index]),
      JSON.stringify(filters));
  }
});

test('quantity filters are inclusive bounds and combine with the others', () => {
  const cases = [
    [{ minQuantity: 5 }, [0, 2]], [{ maxQuantity: 3 }, [1, 3]],
    [{ minQuantity: 3, maxQuantity: 5 }, [1, 2]], [{ minQuantity: 9 }, []],
    [{ minQuantity: 1, maxQuantity: 1 }, [3]], [{ minQuantity: 4, colorId: 4 }, [0, 2]],
    [{ maxQuantity: 5, categoryId: 11, search: 'brick' }, [1]],
  ];
  for (const [filters, indices] of cases) {
    assert.deepEqual(filterRows(rows, filters), indices.map(index => rows[index]),
      JSON.stringify(filters));
  }
});

test('rows sort on every column, both ways, without changing the input', () => {
  const order = (column, direction) => sortRows(rows, { column, direction })
    .map(row => rows.indexOf(row));
  assert.deepEqual(SORT_COLUMNS, ['partNum', 'name', 'colorName', 'categoryName', 'quantity']);
  // Ties on the column fall back to name, part number and colour, ascending either way.
  assert.deepEqual(order('partNum', 'asc'), [1, 0, 2, 3]);
  assert.deepEqual(order('partNum', 'desc'), [3, 2, 1, 0]);
  assert.deepEqual(order('name', 'asc'), [3, 1, 0, 2]);
  assert.deepEqual(order('name', 'desc'), [2, 1, 0, 3]);
  assert.deepEqual(order('colorName', 'asc'), [1, 3, 0, 2]);
  assert.deepEqual(order('colorName', 'desc'), [0, 2, 3, 1]);
  assert.deepEqual(order('categoryName', 'asc'), [3, 1, 0, 2]);
  assert.deepEqual(order('categoryName', 'desc'), [2, 1, 0, 3]);
  assert.deepEqual(order('quantity', 'asc'), [3, 1, 2, 0]);
  assert.deepEqual(order('quantity', 'desc'), [0, 2, 1, 3]);
  assert.deepEqual(sortRows(rows).map(row => rows.indexOf(row)), [3, 1, 0, 2]);
  assert.notEqual(sortRows(rows), rows);
  assert.throws(() => sortRows(rows, { column: 'imgUrl' }), TypeError);
});

test('sorting text uses English numeric order', () => {
  const sized = ['Plate 1 x 10', 'Plate 1 x 2', 'plate 1 x 1'].map((name, index) =>
    ({ ...rows[0], name, partNum: `p${10 - index}` }));
  assert.deepEqual(sortRows(sized, { column: 'name' }).map(row => row.name),
    ['plate 1 x 1', 'Plate 1 x 2', 'Plate 1 x 10']);
  assert.deepEqual(sortRows(sized, { column: 'partNum' }).map(row => row.partNum),
    ['p8', 'p9', 'p10']);
});
