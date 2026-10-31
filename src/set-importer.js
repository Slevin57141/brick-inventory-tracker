// Fetches everything for one set and turns Rebrickable's JSON into a SetRecord (docs/plan.md
// M4). This is the only code that reads the client's raw shapes, so it checks every field it
// keeps: an answer of the wrong shape becomes api_unavailable instead of bad saved data.

import { createError } from './errors.js';

const MAX_DEPTH = 3;
const RGB = /^[0-9A-Fa-f]{6}$/;
const LDRAW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function createSetImporter({ client }) {
  // Imports one set with everything inside it, at depth 1 for the set the user asked for.
  // Returns the record and `counted`: every set number other than its own whose parts this
  // record already holds, through an import or through lines kept from a response (a set the
  // depth limit or a cycle stopped, and anything below it). Every set further up drops those
  // sets' lines from its own response, so each is counted once (D24).
  async function importOne(setNum, depth, ancestors) {
    const details = normalizeSet(await client.getSet(setNum), []);
    const rawLines = await client.getSetParts(setNum);
    const containedSets = (await client.getContainedSets(setNum)).map(toContainedSet);

    const self = key(details.setNum);
    const path = new Set(ancestors).add(self);
    const inside = new Set();
    const childLines = [];
    for (const contained of containedSets) {
      const id = key(contained.setNum);
      if (depth >= MAX_DEPTH || path.has(id)) {
        continue; // its parts stay counted through this set's own response
      }
      const child = await importOne(contained.setNum, depth + 1, path);
      inside.add(id);
      for (const below of child.counted) {
        inside.add(below);
      }
      for (const line of child.record.parts) {
        childLines.push({ ...line, quantity: line.quantity * contained.quantity });
      }
    }
    // A set never drops its own lines, even when bad data lists it inside itself.
    inside.delete(self);

    const ownLines = rawLines.filter((line) => !inside.has(key(line?.set_num)));
    const ownParts = ownLines.map(toPartLine); // checks every line before it is read below
    const counted = new Set(inside);
    for (const line of ownLines) {
      // A response never holds the minifigure parts of the sets inside it (F2), so the sets
      // above have no such lines to drop, and dropping would remove their own minifigures.
      if (key(line.set_num) !== self && !isMinifigure(line.set_num)) {
        counted.add(key(line.set_num));
      }
    }
    const record = {
      ...details,
      containedSets,
      parts: mergePartLines([...ownParts, ...childLines]),
    };
    return { record, counted };
  }

  return Object.freeze({
    async importSet(setNum, { knownCategoryIds = [] } = {}) {
      const { record } = await importOne(setNum, 1, new Set());
      // The data file's category keys are strings, so IDs may come in either form.
      const known = new Set([...knownCategoryIds].map(Number));
      if (record.parts.every((line) => known.has(line.categoryId))) {
        return { record, categories: null };
      }
      const categories = (await client.getPartCategories()).map(toCategory);
      return { record, categories };
    },
  });
}

/** Maps a set and its part lines to a SetRecord. containedSets is left empty for importSet. */
export function normalizeSet(rawSet, rawPartLines) {
  expect(isObject(rawSet) && Array.isArray(rawPartLines));
  const {
    set_num: setNum, name, year, set_img_url: imgUrl, num_parts: numParts, theme_id: themeId,
  } = rawSet;
  expect(isText(setNum) && typeof name === 'string' && Number.isInteger(year));
  expect(imgUrl === null || imgUrl === undefined || typeof imgUrl === 'string');
  expect(Number.isInteger(numParts) && numParts >= 0);
  expect(themeId === null || themeId === undefined || Number.isInteger(themeId));
  return {
    setNum,
    name,
    year,
    imgUrl: imgUrl ?? null,
    numParts,
    themeId: themeId ?? null,
    containedSets: [],
    parts: mergePartLines(rawPartLines.map(toPartLine)),
  };
}

/** Merges lines with the same part, colour and spare flag; the first line gives the rest. */
export function mergePartLines(lines) {
  const merged = new Map();
  for (const line of lines) {
    const id = JSON.stringify([line.partNum, line.colorId, line.isSpare]);
    const existing = merged.get(id);
    if (existing) {
      existing.quantity += line.quantity;
      existing.imgUrl ??= line.imgUrl;
    } else {
      merged.set(id, { ...line });
    }
  }
  return [...merged.values()];
}

function toPartLine(raw) {
  expect(isObject(raw) && isObject(raw.part) && isObject(raw.color));
  const { part, color } = raw;
  expect(isText(part.part_num) && typeof part.name === 'string');
  expect(Number.isInteger(part.part_cat_id));
  expect(part.part_img_url === null || part.part_img_url === undefined
    || typeof part.part_img_url === 'string');
  expect(Number.isInteger(color.id) && typeof color.name === 'string');
  expect(typeof color.rgb === 'string' && RGB.test(color.rgb));
  expect(typeof color.is_trans === 'boolean' && typeof raw.is_spare === 'boolean');
  expect(Number.isInteger(raw.quantity) && raw.quantity > 0);
  return {
    partNum: part.part_num,
    name: part.name,
    categoryId: part.part_cat_id,
    colorId: color.id,
    colorName: color.name,
    colorRgb: color.rgb.toUpperCase(),
    colorIsTrans: color.is_trans,
    imgUrl: part.part_img_url ?? null,
    quantity: raw.quantity,
    isSpare: raw.is_spare,
    ldrawIds: ldrawIdsOf(part),
  };
}

// The part's LDraw file names (D31), best first as Rebrickable lists them. Only plain names
// are kept, since the server looks them up as files; a part without any gets an empty list.
function ldrawIdsOf(part) {
  const ids = isObject(part.external_ids) ? part.external_ids.LDraw : undefined;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && LDRAW_ID.test(id)) : [];
}

function toContainedSet(raw) {
  expect(isObject(raw) && isText(raw.set_num) && typeof raw.set_name === 'string');
  expect(Number.isInteger(raw.quantity) && raw.quantity > 0);
  return { setNum: raw.set_num, name: raw.set_name, quantity: raw.quantity };
}

function toCategory(raw) {
  expect(isObject(raw) && Number.isInteger(raw.id) && typeof raw.name === 'string');
  return { id: raw.id, name: raw.name };
}

function key(setNum) {
  return typeof setNum === 'string' ? setNum.toLowerCase() : setNum;
}

// Rebrickable numbers every minifigure fig-NNNNNN, and its part lines carry that number.
function isMinifigure(setNum) {
  return typeof setNum === 'string' && setNum.toLowerCase().startsWith('fig-');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value !== '';
}

function expect(condition) {
  if (!condition) {
    throw createError('api_unavailable');
  }
}
