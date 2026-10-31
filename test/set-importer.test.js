import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, createError } from '../src/errors.js';
import { createSetImporter, mergePartLines, normalizeSet } from '../src/set-importer.js';
import { loadFixture } from './helpers/fake-fetch.js';

const body = (name) => loadFixture(name).body;
const details = (setNum) => body(`set-${setNum}`);
const lines = (setNum) => body(`set-${setNum}-parts-page1`).results;
const contained = (setNum) => body(`set-${setNum}-sets`).results;
const ALL_CATEGORY_IDS = body('part-categories').results.map((category) => category.id);
const FIXTURE_SETS = [
  '31146-1', '42161-1', '76906-1', '76991-1', '75037-1', '75038-1', '75045-1', '75449-1',
];

/** A client that answers from the captured fixtures and records every call. */
function fixtureClient(overrides = {}) {
  const calls = [];
  const record = (name, fn) => async (...args) => {
    calls.push([name, ...args]);
    return fn(...args);
  };
  const client = {
    getSet: record('getSet', details),
    getSetParts: record('getSetParts', lines),
    getContainedSets: record('getContainedSets', contained),
    getPartCategories: record('getPartCategories', () => body('part-categories').results),
  };
  for (const [name, fn] of Object.entries(overrides)) client[name] = record(name, fn);
  return { client, calls };
}

/** A client over made-up sets: { 'A-1': { contains: [['B-1', 1]], lines: [rawLine(...)] } }. */
function syntheticClient(sets) {
  const calls = [];
  const find = (setNum) => sets[setNum] ?? assert.fail(`unexpected set ${setNum}`);
  const client = {
    async getSet(setNum) {
      calls.push(['getSet', setNum]);
      find(setNum);
      return {
        set_num: setNum, name: `Set ${setNum}`, year: 2020, set_img_url: null, num_parts: 0,
      };
    },
    async getSetParts(setNum) {
      calls.push(['getSetParts', setNum]);
      return find(setNum).lines;
    },
    async getContainedSets(setNum) {
      calls.push(['getContainedSets', setNum]);
      return (find(setNum).contains ?? []).map(([num, quantity]) => ({
        id: 1, set_num: num, set_name: `Set ${num}`, quantity, set_img_url: null,
      }));
    },
    async getPartCategories() {
      calls.push(['getPartCategories']);
      return [{ id: 1, name: 'Bricks' }];
    },
  };
  return { client, calls };
}

/** Imports from a synthetic client, whose one category (ID 1) is already known. */
function importWithKnownCategory(client, setNum) {
  return createSetImporter({ client }).importSet(setNum, { knownCategoryIds: [1] });
}

function rawLine(setNum, partNum, quantity = 1, { colorId = 4, isSpare = false } = {}) {
  return {
    set_num: setNum,
    quantity,
    is_spare: isSpare,
    part: { part_num: partNum, name: `Part ${partNum}`, part_cat_id: 1, part_img_url: null },
    color: { id: colorId, name: `Colour ${colorId}`, rgb: 'C91A09', is_trans: false },
  };
}

const pieces = (parts) => parts.reduce((sum, line) => sum + line.quantity, 0);
const lineFor = (parts, partNum, colorId, isSpare = false) =>
  parts.filter((line) => line.partNum === partNum && line.colorId === colorId
    && line.isSpare === isSpare);

test('normalizeSet maps the set details and every field of a part line', () => {
  const record = normalizeSet(details('76991-1'), lines('76991-1'));
  assert.deepEqual(
    { ...record, parts: undefined },
    {
      setNum: '76991-1',
      name: "Tails' Workshop and Tornado Plane",
      year: 2023,
      imgUrl: 'https://cdn.rebrickable.com/media/sets/76991-1/120819.jpg',
      numParts: 376,
      themeId: 747,
      containedSets: [],
      parts: undefined,
    },
  );
  const raw = lines('76991-1').find((line) => line.part.part_num === '27456pr0003');
  assert.deepEqual(lineFor(record.parts, '27456pr0003', raw.color.id), [{
    partNum: '27456pr0003',
    name: raw.part.name,
    categoryId: raw.part.part_cat_id,
    colorId: raw.color.id,
    colorName: 'Blue',
    colorRgb: raw.color.rgb,
    colorIsTrans: false,
    imgUrl: null,
    quantity: raw.quantity,
    isSpare: false,
    ldrawIds: [],
  }]);
});

test('normalizeSet keeps the LDraw ids Rebrickable lists, in its order (D31)', () => {
  const record = normalizeSet(details('76991-1'), lines('76991-1'));
  const ids = (partNum) => record.parts.find((line) => line.partNum === partNum).ldrawIds;
  assert.deepEqual(ids('3023'), ['28653', '3023b']);
  assert.deepEqual(ids('3005'), ['3005', '30071']);
  assert.deepEqual(ids('1927'), [], 'a part without LDraw ids');
  assert.ok(record.parts.every((line) => Array.isArray(line.ldrawIds)));

  // Only plain file names are kept; anything else is left out.
  const [line] = lines('76991-1');
  const odd = { ...line, part: { ...line.part, external_ids: {
    LDraw: ['3001', '../3001', 's\\3001s01', '', 7, 'x'.repeat(65), '3001-b.c_d'] } } };
  assert.deepEqual(normalizeSet(details('76991-1'), [odd]).parts[0].ldrawIds,
    ['3001', '3001-b.c_d']);
  const missing = { ...line, part: { ...line.part, external_ids: undefined } };
  assert.deepEqual(normalizeSet(details('76991-1'), [missing]).parts[0].ldrawIds, []);
  // A set without a theme keeps null; a theme that is not a number is not accepted.
  assert.equal(normalizeSet({ ...details('76991-1'), theme_id: null }, []).themeId, null);
  assert.throws(() => normalizeSet({ ...details('76991-1'), theme_id: '747' }, []));
});

test('normalizeSet keeps transparent colours, spare flags and minifigure parts', () => {
  const record = normalizeSet(details('76906-1'), lines('76906-1'));
  assert.equal(record.parts.filter((line) => line.colorIsTrans).length, 11);
  assert.equal(pieces(record.parts.filter((line) => line.isSpare)), 14);
  const figPartNums = lines('76906-1')
    .filter((line) => line.set_num === 'fig-012344')
    .map((line) => line.part.part_num);
  assert.equal(figPartNums.length, 5);
  for (const partNum of figPartNums) {
    assert.ok(record.parts.some((line) => line.partNum === partNum), partNum);
  }
});

test('minifigure quantities are used as they come (F1)', () => {
  const record = normalizeSet(details('75449-1'), lines('75449-1'));
  // fig-014194 appears twice in 75449-1; each of its parts already has quantity 2.
  for (const partNum of ['3626cpr3262', '970c27pr1928', '2019pr0424', '973c27h03pr5237']) {
    assert.equal(record.parts.find((line) => line.partNum === partNum).quantity, 2, partNum);
  }
  assert.equal(pieces(record.parts.filter((line) => !line.isSpare)), 116);
});

test('lines with the same part, colour and spare flag are merged in every set', () => {
  const record = normalizeSet(details('75045-1'), lines('75045-1'));
  assert.deepEqual(lineFor(record.parts, '30377', 71).map((line) => line.quantity), [3]);

  for (const setNum of FIXTURE_SETS) {
    const parts = normalizeSet(details(setNum), lines(setNum)).parts;
    const keys = parts.map((line) => `${line.partNum}|${line.colorId}|${line.isSpare}`);
    assert.equal(new Set(keys).size, keys.length, setNum);
    assert.equal(pieces(parts), lines(setNum).reduce((sum, line) => sum + line.quantity, 0));
  }
});

test('mergePartLines adds quantities, keeps spares apart and does not change its input', () => {
  const base = { partNum: '3001', name: 'Brick', categoryId: 11, colorId: 4, colorName: 'Red',
    colorRgb: 'C91A09', colorIsTrans: false, imgUrl: null, quantity: 1, isSpare: false };
  const input = Object.freeze([
    Object.freeze({ ...base }),
    Object.freeze({ ...base, quantity: 2, imgUrl: 'https://cdn.rebrickable.com/a.jpg' }),
    Object.freeze({ ...base, isSpare: true }),
    Object.freeze({ ...base, colorId: 1, imgUrl: 'https://cdn.rebrickable.com/b.jpg' }),
  ]);
  assert.deepEqual(mergePartLines(input), [
    { ...base, quantity: 3, imgUrl: 'https://cdn.rebrickable.com/a.jpg' },
    { ...base, isSpare: true },
    { ...base, colorId: 1, imgUrl: 'https://cdn.rebrickable.com/b.jpg' },
  ]);
});

test('an ordinary set takes three requests and is returned as normalizeSet maps it', async () => {
  const { client, calls } = fixtureClient();
  const { record, categories } = await createSetImporter({ client })
    .importSet('31146-1', { knownCategoryIds: ALL_CATEGORY_IDS });
  assert.deepEqual(record, normalizeSet(details('31146-1'), lines('31146-1')));
  assert.equal(categories, null);
  assert.deepEqual(calls, [
    ['getSet', '31146-1'], ['getSetParts', '31146-1'], ['getContainedSets', '31146-1'],
  ]);
});

test('the pack counts its three sets\' parts once, minifigure parts included (D24)', async () => {
  const { client, calls } = fixtureClient();
  const { record } = await createSetImporter({ client })
    .importSet('66495-1', { knownCategoryIds: ALL_CATEGORY_IDS });

  const children = ['75037-1', '75038-1', '75045-1'];
  const expected = mergePartLines(
    children.flatMap((setNum) => normalizeSet(details(setNum), lines(setNum)).parts),
  );
  assert.deepEqual(record.parts, expected);
  assert.equal(pieces(record.parts), 874);
  // A battle droid part only the contained sets' minifigures have; the pack's own response
  // leaves it out (F2).
  assert.equal(lineFor(record.parts, '30378', 19)[0].quantity, 2);
  assert.deepEqual(record.containedSets, [
    { setNum: '75037-1', name: 'Battle on Saleucami', quantity: 1 },
    { setNum: '75038-1', name: 'Jedi Interceptor', quantity: 1 },
    { setNum: '75045-1', name: 'Republic AV-7 Anti-Vehicle Cannon', quantity: 1 },
  ]);
  assert.equal(record.setNum, '66495-1');
  assert.equal(calls.length, 12);
});

test('a contained set with a quantity of 2 counts its parts twice', async () => {
  const { client } = fixtureClient({
    getContainedSets: (setNum) => contained(setNum)
      .map((entry) => (entry.set_num === '75038-1' ? { ...entry, quantity: 2 } : entry)),
  });
  const { record } = await createSetImporter({ client })
    .importSet('66495-1', { knownCategoryIds: ALL_CATEGORY_IDS });
  assert.equal(pieces(record.parts), 188 + 2 * 234 + 452);
  assert.equal(record.containedSets[1].quantity, 2);
});

test('a pack keeps its own parts and drops only the lines of sets inside it', async () => {
  const { client } = syntheticClient({
    'P-1': {
      contains: [['A-1', 1]],
      lines: [rawLine('P-1', 'own'), rawLine('A-1', 'a'), rawLine('fig-000001', 'fig')],
    },
    'A-1': { lines: [rawLine('A-1', 'a', 3)] },
  });
  const { record } = await importWithKnownCategory(client, 'P-1');
  assert.deepEqual(record.parts.map((line) => [line.partNum, line.quantity]),
    [['own', 1], ['fig', 1], ['a', 3]]);
});

test('imports stop on cycles', async () => {
  const { client, calls } = syntheticClient({
    'A-1': { contains: [['B-1', 1]], lines: [rawLine('A-1', 'a'), rawLine('B-1', 'b')] },
    'B-1': { contains: [['a-1', 1]], lines: [rawLine('B-1', 'b'), rawLine('A-1', 'a')] },
  });
  const { record } = await importWithKnownCategory(client, 'A-1');
  assert.deepEqual(calls.filter(([name]) => name === 'getSet').map(([, setNum]) => setNum),
    ['A-1', 'B-1']);
  // A keeps its own line; B's line for A stays in B, since B could not import A.
  assert.deepEqual(record.parts.map((line) => [line.partNum, line.quantity]), [['a', 2], ['b', 1]]);
});

test('imports stop at depth 3, and the deepest set is counted once', async () => {
  // Each response also lists the ordinary parts of every set below it, as a pack's does.
  const { client, calls } = syntheticClient({
    'A-1': { contains: [['B-1', 1]], lines: ['A', 'B', 'C', 'D'].map((s) => rawLine(`${s}-1`, s)) },
    'B-1': { contains: [['C-1', 1]], lines: ['B', 'C', 'D'].map((s) => rawLine(`${s}-1`, s)) },
    'C-1': { contains: [['D-1', 1]], lines: ['C', 'D'].map((s) => rawLine(`${s}-1`, s)) },
    'D-1': { lines: [rawLine('D-1', 'D')] },
  });
  const { record } = await importWithKnownCategory(client, 'A-1');
  assert.deepEqual(calls.filter(([name]) => name === 'getSet').map(([, setNum]) => setNum),
    ['A-1', 'B-1', 'C-1']);
  assert.deepEqual(record.parts.map((line) => [line.partNum, line.quantity]),
    [['A', 1], ['B', 1], ['C', 1], ['D', 1]]);
});

test('sets below the depth limit are counted once, however deep (Codex, PR 9)', async () => {
  const chain = ['A', 'B', 'C', 'D', 'E'];
  const sets = {};
  chain.forEach((name, index) => {
    sets[`${name}-1`] = {
      contains: index + 1 < chain.length ? [[`${chain[index + 1]}-1`, 1]] : [],
      lines: chain.slice(index).map((below) => rawLine(`${below}-1`, below)),
    };
  });
  const { client, calls } = syntheticClient(sets);
  const { record } = await importWithKnownCategory(client, 'A-1');
  assert.deepEqual(calls.filter(([name]) => name === 'getSet').map(([, setNum]) => setNum),
    ['A-1', 'B-1', 'C-1']);
  assert.deepEqual(record.parts.map((line) => [line.partNum, line.quantity]),
    [['A', 1], ['B', 1], ['C', 1], ['D', 1], ['E', 1]]);
});

test('a minifigure in a set and in a set deep inside it is counted for both', async () => {
  const { client } = syntheticClient({
    'A-1': {
      contains: [['B-1', 1]],
      lines: [rawLine('A-1', 'a'), rawLine('fig-000001', 'head'), rawLine('B-1', 'b'),
        rawLine('C-1', 'c'), rawLine('D-1', 'd')],
    },
    'B-1': {
      contains: [['C-1', 1]],
      lines: [rawLine('B-1', 'b'), rawLine('C-1', 'c'), rawLine('D-1', 'd')],
    },
    'C-1': {
      contains: [['D-1', 1]],
      lines: [rawLine('C-1', 'c'), rawLine('fig-000001', 'head'), rawLine('D-1', 'd')],
    },
    'D-1': { lines: [rawLine('D-1', 'd')] },
  });
  const { record } = await importWithKnownCategory(client, 'A-1');
  assert.deepEqual(record.parts.map((line) => [line.partNum, line.quantity]),
    [['a', 1], ['head', 2], ['b', 1], ['c', 1], ['d', 1]]);
});

test('categories are fetched only when a part has an unknown category ID', async () => {
  const usedIds = [...new Set(lines('31146-1').map((line) => line.part.part_cat_id))];

  for (const known of [usedIds, usedIds.map(String), new Set(usedIds)]) {
    const { client, calls } = fixtureClient();
    const result = await createSetImporter({ client })
      .importSet('31146-1', { knownCategoryIds: known });
    assert.equal(result.categories, null);
    assert.ok(!calls.some(([name]) => name === 'getPartCategories'));
  }

  const { client, calls } = fixtureClient();
  const { categories } = await createSetImporter({ client })
    .importSet('31146-1', { knownCategoryIds: usedIds.slice(1) });
  assert.equal(calls.filter(([name]) => name === 'getPartCategories').length, 1);
  assert.equal(categories.length, 76);
  assert.deepEqual(Object.keys(categories[0]).sort(), ['id', 'name']);
});

test('client errors pass through unchanged', async () => {
  for (const method of ['getSet', 'getSetParts', 'getContainedSets', 'getPartCategories']) {
    const error = createError('set_not_found');
    const { client } = fixtureClient({ [method]: () => { throw error; } });
    await assert.rejects(
      createSetImporter({ client }).importSet('31146-1', { knownCategoryIds: [] }),
      (thrown) => thrown === error,
      method,
    );
  }
});

test('an answer of the wrong shape gives api_unavailable', async () => {
  const good = lines('31146-1')[0];
  const broken = [
    { ...good, quantity: 0 },
    { ...good, quantity: 1.5 },
    { ...good, is_spare: 'no' },
    { ...good, color: { ...good.color, rgb: 'red' } },
    { ...good, color: { ...good.color, is_trans: undefined } },
    { ...good, part: { ...good.part, part_cat_id: null } },
    { ...good, part: { ...good.part, part_num: '' } },
    { ...good, part: null },
    null,
  ];
  for (const line of broken) {
    const { client } = fixtureClient({ getSetParts: () => [line] });
    await assert.rejects(
      createSetImporter({ client }).importSet('31146-1', { knownCategoryIds: ALL_CATEGORY_IDS }),
      (error) => error instanceof AppError && error.code === 'api_unavailable',
      JSON.stringify(line),
    );
  }
  for (const overrides of [
    { getSet: () => ({ ...details('31146-1'), year: '2024' }) },
    { getSet: () => null },
    { getContainedSets: () => [{ set_num: '1-1', set_name: 'x', quantity: 0 }] },
    { getPartCategories: () => [{ id: '1', name: 'x' }] },
  ]) {
    const { client } = fixtureClient(overrides);
    await assert.rejects(
      createSetImporter({ client }).importSet('31146-1', { knownCategoryIds: [] }),
      (error) => error instanceof AppError && error.code === 'api_unavailable',
    );
  }
});
