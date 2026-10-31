// Reads and writes the data file (docs/plan.md M6, R12, section 6). A save never leaves half
// a file: it writes a temporary file in the same folder, flushes it to disk, and renames it
// over the data file, which replaces the old file in one step. A data file that cannot be
// read is reported and left exactly as it is, so nothing the user saved is lost.

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename as fsRename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createError } from './errors.js';
import { emptyState } from './inventory.js';

const VERSION = 1;
const RGB = /^[0-9A-Fa-f]{6}$/;
// On Windows, a virus scanner or backup tool briefly holding the data file makes the rename
// fail with one of these; waiting a moment and trying again is enough.
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

export function createStorage({
  filePath,
  rename = fsRename,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let queue = Promise.resolve();

  async function write(state) {
    const folder = dirname(filePath);
    await mkdir(folder, { recursive: true });
    // A name of its own for every save, so two storages on one file cannot collide, and
    // only a file this save created is ever removed (Codex's review of PR 12).
    const temporary = join(folder, `.${basename(filePath)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try {
      try {
        await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithRetry(temporary, filePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(from, to);
        return;
      } catch (error) {
        if (!RETRY_CODES.has(error?.code) || attempt === RETRY_DELAYS_MS.length) {
          throw error;
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  return Object.freeze({
    async load() {
      let text;
      try {
        text = await readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return emptyState();
        }
        throw createError('data_file_invalid');
      }
      let state;
      try {
        // A file saved by a text editor may start with a byte order mark.
        state = JSON.parse(text.replace(/^﻿/, ''));
      } catch {
        throw createError('data_file_invalid');
      }
      if (!isValidState(state)) {
        throw createError('data_file_invalid');
      }
      return state;
    },

    // Saves run one after another, so the file always ends with the last state saved. A
    // failed save rejects only its own caller.
    save(state) {
      const done = queue.then(() => write(state));
      queue = done.catch(() => {});
      return done;
    },
  });
}

// Checks the shape the rest of the app relies on (section 6), so a hand-edited or damaged
// file is reported at start instead of producing wrong totals later.
function isValidState(state) {
  return isObject(state)
    && state.version === VERSION
    && isObject(state.categories)
    && Object.values(state.categories).every((name) => typeof name === 'string')
    && isObject(state.sets)
    && Object.entries(state.sets).every(([key, entry]) => isValidEntry(key, entry));
}

function isValidEntry(key, entry) {
  return isObject(entry)
    && entry.setNum === key
    && typeof entry.name === 'string'
    && Number.isInteger(entry.year)
    && isImage(entry.imgUrl)
    && Number.isInteger(entry.numParts) && entry.numParts >= 0
    && isPositiveInteger(entry.copies)
    && Array.isArray(entry.containedSets)
    && entry.containedSets.every(isValidContainedSet)
    && Array.isArray(entry.parts)
    && entry.parts.every(isValidPart);
}

function isValidContainedSet(contained) {
  return isObject(contained)
    && typeof contained.setNum === 'string'
    && typeof contained.name === 'string'
    && isPositiveInteger(contained.quantity);
}

function isValidPart(part) {
  return isObject(part)
    && typeof part.partNum === 'string'
    && typeof part.name === 'string'
    && Number.isInteger(part.categoryId)
    && Number.isInteger(part.colorId)
    && typeof part.colorName === 'string'
    && typeof part.colorRgb === 'string' && RGB.test(part.colorRgb)
    && typeof part.colorIsTrans === 'boolean'
    && isImage(part.imgUrl)
    && isPositiveInteger(part.quantity)
    && typeof part.isSpare === 'boolean';
}

function isImage(value) {
  return value === null || typeof value === 'string';
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
