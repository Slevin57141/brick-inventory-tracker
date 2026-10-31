import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError, createError } from '../src/errors.js';
import { buildInventory } from '../src/inventory.js';
import { createCollection } from '../src/collection.js';
import { createSetImporter, normalizeSet } from '../src/set-importer.js';
import { createStorage } from '../src/storage.js';
import { loadFixture } from './helpers/fake-fetch.js';

const body = (name) => loadFixture(name).body;
const record = (setNum) =>
  normalizeSet(body(`set-${setNum}`), body(`set-${setNum}-parts-page1`).results);
const CATEGORIES = body('part-categories').results.map(({ id, name }) => ({ id, name }));

/** A test that gets a new temporary folder, removed afterwards. */
function folderTest(name, fn) {
  test(name, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'brick-collection-'));
    try {
      await fn(folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}

/** An importer that answers from the captured fixtures and records every call. */
function fakeImporter({ fail = null } = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    async importSet(setNum, { knownCategoryIds }) {
      calls.push({ setNum, knownCategoryIds: [...knownCategoryIds] });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (fail) throw fail;
        const imported = record(setNum);
        const known = new Set(knownCategoryIds.map(Number));
        const needed = imported.parts.some((line) => !known.has(line.categoryId));
        return { record: imported, categories: needed ? CATEGORIES : null };
      } finally {
        inFlight -= 1;
      }
    },
  };
}

async function open(folder, importer = fakeImporter()) {
  const storage = createStorage({ filePath: join(folder, 'inventory.json') });
  const collection = createCollection({ storage, importer });
  await collection.init();
  return { collection, importer, storage };
}

const isCode = (code) => (error) => error instanceof AppError && error.code === code;
const pieces = (rows) => rows.reduce((sum, row) => sum + row.quantity, 0);

folderTest('adding a new set imports it, saves it and returns its summary', async (folder) => {
  const { collection, importer, storage } = await open(folder);
  const added = await collection.addSet(' 31146 ');

  const { parts, ...rest } = { ...record('31146-1'), copies: 1 };
  // The summary counts the pieces in one copy, spares included (D1).
  const expected = { ...rest, pieces: 288 };
  assert.deepEqual(added, expected);
  assert.deepEqual(importer.calls, [{ setNum: '31146-1', knownCategoryIds: [] }]);
  assert.deepEqual(collection.listSets(), [expected]);
  assert.equal(pieces(collection.getInventory()), 288);
  assert.deepEqual(await storage.load(), {
    version: 2,
    categories: Object.fromEntries(CATEGORIES.map(({ id, name }) => [id, name])),
    themes: {},
    sets: { '31146-1': { ...record('31146-1'), copies: 1 } },
  });
  assert.ok(collection.getInventory().every((row) => row.categoryName !== 'Unknown category'));
});

folderTest('one saved set comes with the parts of one copy', async (folder) => {
  const { collection } = await open(folder);
  await collection.addSet('31146-1');
  await collection.addSet('31146-1');
  await collection.addSet('76906-1');
  const { set, rows } = collection.getSet('31146-1');
  assert.equal(set.setNum, '31146-1');
  assert.equal(set.copies, 2);
  assert.equal(set.pieces, 288);
  assert.equal(set.parts, undefined, 'the summary has no parts list');
  // One copy only, and only this set's parts.
  assert.equal(pieces(rows), 288);
  assert.ok(rows.every((row) => row.categoryName !== 'Unknown category'));
  const all = collection.getInventory();
  for (const row of rows) {
    assert.ok(all.some((other) => other.partNum === row.partNum && other.colorId === row.colorId
      && other.quantity >= row.quantity));
  }
  assert.deepEqual(collection.getSet('31146-1'), { set, rows });
  for (const missing of ['10270-1', '', 42, null, undefined]) {
    assert.throws(() => collection.getSet(missing), isCode('not_owned'), String(missing));
  }
});

folderTest('adding a saved set again adds a copy without calling the importer', async (folder) => {
  const { collection, importer } = await open(folder);
  await collection.addSet('31146-1');
  const second = await collection.addSet('31146');
  assert.equal(second.copies, 2);
  assert.equal(importer.calls.length, 1);
  assert.equal(pieces(collection.getInventory()), 2 * 288);
});

folderTest('the next import is told which categories are already saved', async (folder) => {
  const { collection, importer } = await open(folder);
  await collection.addSet('31146-1');
  await collection.addSet('76906-1');
  assert.deepEqual(importer.calls[1].knownCategoryIds.map(Number).sort((a, b) => a - b),
    CATEGORIES.map(({ id }) => id).sort((a, b) => a - b));
});

folderTest('removing takes away one copy, and the last copy removes the set', async (folder) => {
  const { collection, storage } = await open(folder);
  await collection.addSet('31146-1');
  await collection.addSet('31146-1');

  const left = await collection.removeSet('31146-1');
  assert.equal(left.copies, 1);
  assert.equal(left.parts, undefined);
  assert.equal(pieces(collection.getInventory()), 288);

  assert.equal(await collection.removeSet('31146-1'), null);
  assert.deepEqual(collection.listSets(), []);
  assert.deepEqual(collection.getInventory(), []);
  assert.deepEqual((await storage.load()).sets, {});

  for (const setNum of ['31146-1', '99-1', null, 42]) {
    await assert.rejects(collection.removeSet(setNum), isCode('not_owned'), String(setNum));
  }
});

folderTest('invalid input never reaches the importer or the data file', async (folder) => {
  const { collection, importer } = await open(folder);
  for (const input of ['', '   ', '10270/1', '../x', '10270--1', 'a'.repeat(41), null, 42]) {
    await assert.rejects(collection.addSet(input), isCode('invalid_set_number'), String(input));
  }
  assert.equal(importer.calls.length, 0);
  assert.deepEqual(await readdir(folder), []);
});

folderTest('a failed save leaves the collection as it was', async (folder) => {
  const storage = createStorage({ filePath: join(folder, 'inventory.json') });
  let failNext = false;
  const flaky = {
    load: () => storage.load(),
    save: async (state) => {
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      return storage.save(state);
    },
  };
  const collection = createCollection({ storage: flaky, importer: fakeImporter() });
  await collection.init();
  await collection.addSet('31146-1');
  const sets = collection.listSets();
  const rows = collection.getInventory();
  const saved = await storage.load();

  for (const attempt of [() => collection.addSet('76906-1'), () => collection.addSet('31146-1'),
    () => collection.removeSet('31146-1')]) {
    failNext = true;
    await assert.rejects(attempt(), { code: 'ENOSPC' });
    assert.deepEqual(collection.listSets(), sets);
    assert.deepEqual(collection.getInventory(), rows);
    assert.deepEqual(await storage.load(), saved);
  }
  assert.equal((await collection.addSet('76906-1')).copies, 1);
});

folderTest('an import that fails passes its error on and changes nothing', async (folder) => {
  const keyRequired = createError('key_required');
  const { collection } = await open(folder, fakeImporter({ fail: keyRequired }));
  await assert.rejects(collection.addSet('31146-1'), (error) => error === keyRequired);
  assert.deepEqual(collection.listSets(), []);
  assert.deepEqual(await readdir(folder), []);
});

folderTest('a new collection on the same file shows the same state (R12)', async (folder) => {
  const first = await open(folder);
  await first.collection.addSet('31146-1');
  await first.collection.addSet('76906-1');
  await first.collection.addSet('76906-1');

  const second = await open(folder);
  assert.deepEqual(second.collection.listSets(), first.collection.listSets());
  assert.deepEqual(second.collection.getInventory(), first.collection.getInventory());
  assert.equal(second.importer.calls.length, 0);
});

folderTest('overlapping adds run one after the other', async (folder) => {
  const { collection, importer } = await open(folder);
  const results = await Promise.all([
    collection.addSet('31146-1'),
    collection.addSet('76906-1'),
    collection.addSet('31146'),
  ]);
  assert.equal(importer.maxInFlight, 1);
  assert.deepEqual(importer.calls.map((call) => call.setNum), ['31146-1', '76906-1']);
  assert.deepEqual(results.map((set) => [set.setNum, set.copies]),
    [['31146-1', 1], ['76906-1', 1], ['31146-1', 2]]);
});

folderTest('a set number Rebrickable writes differently is saved once', async (folder) => {
  const importer = {
    calls: 0,
    async importSet() {
      importer.calls += 1;
      return { record: record('31146-1'), categories: null };
    },
  };
  const { collection } = await open(folder, importer);
  assert.equal((await collection.addSet('31146-01')).setNum, '31146-1');
  assert.equal((await collection.addSet('31146-001')).copies, 2);
  assert.deepEqual(collection.listSets().map((set) => set.setNum), ['31146-1']);
});

test('the collection cannot be used before init', () => {
  const collection = createCollection({ storage: {}, importer: {} });
  assert.throws(() => collection.listSets());
  assert.throws(() => collection.getInventory());
});

folderTest('a pack imported by the real importer saves and loads again', async (folder) => {
  const client = {
    getSet: async (setNum) => body(`set-${setNum}`),
    getSetParts: async (setNum) => body(`set-${setNum}-parts-page1`).results,
    getContainedSets: async (setNum) => body(`set-${setNum}-sets`).results,
    getPartCategories: async () => body('part-categories').results,
  };
  const { collection } = await open(folder, createSetImporter({ client }));
  const pack = await collection.addSet('66495');
  assert.equal(pack.containedSets.length, 3);

  const reopened = await open(folder, fakeImporter());
  assert.deepEqual(reopened.collection.listSets(), collection.listSets());
  assert.equal(pieces(reopened.collection.getInventory()), 874);
  assert.deepEqual(reopened.collection.getInventory(), buildInventory({
    version: 1,
    categories: Object.fromEntries(CATEGORIES.map(({ id, name }) => [id, name])),
    sets: { '66495-1': { ...(await createSetImporter({ client }).importSet('66495-1', {
      knownCategoryIds: [],
    })).record, copies: 1 } },
  }));
});
