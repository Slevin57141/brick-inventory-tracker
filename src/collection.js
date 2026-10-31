// The app's operations (docs/plan.md M7): the collection in memory, changed one step at a
// time and saved after every change. A change is saved before it replaces the state in
// memory, so what the page sees is always what the data file holds.

import { createError } from './errors.js';
import {
  addCategories, addCopy, buildInventory, findSet, removeCopy,
} from './inventory.js';
import { normalizeSetNumber } from './set-number.js';

export function createCollection({ storage, importer }) {
  let state = null;
  let queue = Promise.resolve();

  function current() {
    if (state === null) {
      throw new Error('The collection is used before init().');
    }
    return state;
  }

  // Runs changes one after another. Adding a new set waits for its import, so a second add
  // of the same set finds the first one saved and makes no API call. A failed change
  // rejects only its own caller.
  function change(compute) {
    const done = queue.then(async () => {
      const next = await compute(current());
      await storage.save(next.state);
      state = next.state;
      return next.result;
    });
    queue = done.catch(() => {});
    return done;
  }

  return Object.freeze({
    async init() {
      state = await storage.load();
    },

    addSet(input) {
      return change(async (before) => {
        const setNum = normalizeSetNumber(input);
        const saved = findSet(before, setNum);
        if (saved) {
          // D7: another copy from the saved parts list, with no API call.
          const after = addCopy(before, saved);
          return { state: after, result: summary(findSet(after, saved.setNum)) };
        }
        const { record, categories } = await importer.importSet(setNum, {
          knownCategoryIds: Object.keys(before.categories),
        });
        // Rebrickable's set_num can differ from what was typed (10270-01 gives 10270-1),
        // and may match a set already saved; addCopy then adds a copy of that one.
        let after = addCopy(before, record);
        if (categories) {
          after = addCategories(after, categories);
        }
        return { state: after, result: summary(findSet(after, record.setNum)) };
      });
    },

    removeSet(setNum) {
      return change(async (before) => {
        if (typeof setNum !== 'string') {
          throw createError('not_owned');
        }
        const after = removeCopy(before, setNum);
        const left = findSet(after, setNum);
        return { state: after, result: left ? summary(left) : null };
      });
    },

    listSets() {
      return Object.values(current().sets).map(summary);
    },

    // One saved set and the parts of one copy of it, as inventory rows.
    getSet(setNum) {
      const before = current();
      const saved = typeof setNum === 'string' ? findSet(before, setNum) : null;
      if (!saved) {
        throw createError('not_owned');
      }
      const one = { ...before, sets: { [saved.setNum]: { ...saved, copies: 1 } } };
      return { set: summary(saved), rows: buildInventory(one) };
    },

    getInventory() {
      return buildInventory(current());
    },
  });
}

// A SetEntry without its parts, plus the number of pieces in one copy (spares counted, D1).
function summary({ parts, ...rest }) {
  return { ...rest, pieces: parts.reduce((sum, part) => sum + part.quantity, 0) };
}
