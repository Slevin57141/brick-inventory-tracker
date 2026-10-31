import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../src/errors.js';
import { emptyState } from '../src/inventory.js';
import { createStorage } from '../src/storage.js';

const part = {
  partNum: '3001', name: 'Brick 2 x 4', categoryId: 11, colorId: 4, colorName: 'Red',
  colorRgb: 'C91A09', colorIsTrans: false, imgUrl: null, quantity: 6, isSpare: false,
};
const entry = (setNum, copies = 1) => ({
  setNum, name: 'Example set', year: 2020, imgUrl: null, numParts: 6, copies,
  containedSets: [],
  parts: [part, { ...part, colorId: 1, imgUrl: 'https://cdn.rebrickable.com/x.jpg' }],
});
const state = (...setNums) => ({
  version: 1,
  categories: { 11: 'Bricks' },
  sets: Object.fromEntries(setNums.map((setNum, i) => [setNum, entry(setNum, i + 1)])),
});

/** A test that gets a new temporary folder, removed afterwards. */
function folderTest(name, fn) {
  test(name, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'brick-storage-'));
    try {
      await fn(folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
}

const isDataFileInvalid = (error) =>
  error instanceof AppError && error.code === 'data_file_invalid';
const instant = async () => {};

folderTest('a saved state loads back unchanged', async (folder) => {
  const storage = createStorage({ filePath: join(folder, 'inventory.json') });
  const saved = state('10270-1', 'AbC-2');
  await storage.save(saved);
  assert.deepEqual(await storage.load(), saved);
  assert.deepEqual(await createStorage({ filePath: join(folder, 'inventory.json') }).load(), saved);
});

folderTest('a missing file loads as the empty state and is not created', async (folder) => {
  const filePath = join(folder, 'missing', 'inventory.json');
  assert.deepEqual(await createStorage({ filePath }).load(), emptyState());
  assert.deepEqual(await readdir(folder), []);
});

folderTest('a corrupt file throws data_file_invalid and is left byte for byte', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  const storage = createStorage({ filePath });
  const contents = [
    '{"version": 1, "categories": {}, "sets": ',
    '',
    'not json at all',
    JSON.stringify({ ...state('10270-1'), version: 2 }),
    JSON.stringify([]),
    'null',
  ];
  for (const content of contents) {
    const bytes = Buffer.from(content, 'utf8');
    await writeFile(filePath, bytes);
    await assert.rejects(storage.load(), isDataFileInvalid, content);
    assert.deepEqual(await readFile(filePath), bytes);
    assert.deepEqual(await readdir(folder), ['inventory.json']);
  }
});

folderTest('a file of the wrong shape throws data_file_invalid', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  const valid = state('10270-1');
  const broken = [
    { ...valid, version: undefined },
    { ...valid, categories: [] },
    { ...valid, categories: { 11: 7 } },
    { ...valid, sets: null },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), setNum: '99-1' } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), copies: 0 } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), parts: {} } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), containedSets: null } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), parts: [{ ...part, quantity: '6' }] } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), parts: [{ ...part, colorId: null }] } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), parts: [{ ...part, isSpare: 1 }] } } },
    { ...valid, sets: { '10270-1': { ...entry('10270-1'), parts: [null] } } },
  ];
  for (const content of broken) {
    await writeFile(filePath, JSON.stringify(content));
    await assert.rejects(createStorage({ filePath }).load(), isDataFileInvalid);
  }
});

folderTest('a data file path that cannot be read throws data_file_invalid', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  await mkdir(filePath);
  await assert.rejects(createStorage({ filePath }).load(), isDataFileInvalid);
});

folderTest('a file with a byte order mark loads', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  await writeFile(filePath, `﻿${JSON.stringify(state('10270-1'))}`);
  assert.deepEqual(await createStorage({ filePath }).load(), state('10270-1'));
});

folderTest('saving creates the folder and leaves no temporary files', async (folder) => {
  const filePath = join(folder, 'a', 'b', 'inventory.json');
  const storage = createStorage({ filePath });
  await storage.save(state('10270-1'));
  await storage.save(state('10270-1', '10271-1'));
  assert.deepEqual(await readdir(join(folder, 'a', 'b')), ['inventory.json']);
  assert.deepEqual(await storage.load(), state('10270-1', '10271-1'));
});

folderTest('overlapping saves run in turn and end with the last state', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  const storage = createStorage({ filePath });
  const states = Array.from({ length: 20 }, (_, i) => state(...Array.from({ length: i + 1 },
    (__, j) => `${10000 + j}-1`)));
  await Promise.all(states.map((s) => storage.save(s)));
  assert.deepEqual(await storage.load(), states.at(-1));
  assert.deepEqual(await readdir(folder), ['inventory.json']);
});

folderTest('a rename refused with EPERM, EBUSY or EACCES is retried', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    let failures = 2;
    const sleeps = [];
    const storage = createStorage({
      filePath,
      rename: async (from, to) => {
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error('held by another program'), { code });
        }
        return rename(from, to);
      },
      sleep: async (ms) => sleeps.push(ms),
    });
    await storage.save(state(`${code.length}-1`));
    assert.deepEqual(sleeps, [50, 100], code);
    assert.deepEqual(await storage.load(), state(`${code.length}-1`));
  }
});

folderTest('a save that keeps failing keeps the old file and no temporary file', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  await createStorage({ filePath }).save(state('10270-1'));
  const before = await readFile(filePath);

  let attempts = 0;
  const held = createStorage({
    filePath,
    rename: async () => {
      attempts += 1;
      throw Object.assign(new Error('held'), { code: 'EPERM' });
    },
    sleep: instant,
  });
  await assert.rejects(held.save(state('10271-1')), { code: 'EPERM' });
  assert.equal(attempts, 6);
  assert.deepEqual(await readFile(filePath), before);
  assert.deepEqual(await readdir(folder), ['inventory.json']);

  let other = 0;
  const full = createStorage({
    filePath,
    rename: async () => {
      other += 1;
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    },
    sleep: instant,
  });
  await assert.rejects(full.save(state('10271-1')), { code: 'ENOSPC' });
  assert.equal(other, 1, 'other errors are not retried');
  assert.deepEqual(await readdir(folder), ['inventory.json']);
});

folderTest('a failed save does not stop the saves after it', async (folder) => {
  const filePath = join(folder, 'inventory.json');
  let fail = true;
  const storage = createStorage({
    filePath,
    rename: async (from, to) => {
      if (fail) {
        fail = false;
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      return rename(from, to);
    },
  });
  const first = storage.save(state('10270-1'));
  const second = storage.save(state('10271-1'));
  await assert.rejects(first, { code: 'ENOSPC' });
  await second;
  assert.deepEqual(await storage.load(), state('10271-1'));
});
