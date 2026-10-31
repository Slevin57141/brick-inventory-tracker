import { createError } from './errors.js';

const compareNames = new Intl.Collator('en', { numeric: true }).compare;

export function emptyState() {
  return { version: 2, categories: {}, themes: {}, sets: {} };
}

export function findSet(state, setNum) {
  const target = setNum.toLowerCase();
  return Object.values(state.sets).find(set => set.setNum.toLowerCase() === target) ?? null;
}

export function addCopy(state, record) {
  const existing = findSet(state, record.setNum);
  const entry = existing
    ? { ...existing, copies: existing.copies + 1 }
    : { ...record, copies: 1 };
  return { ...state, sets: { ...state.sets, [entry.setNum]: entry } };
}

export function addCategories(state, categories) {
  return {
    ...state,
    categories: {
      ...state.categories,
      ...Object.fromEntries(categories.map(({ id, name }) => [id, name])),
    },
  };
}

export function addThemes(state, themes) {
  return {
    ...state,
    themes: {
      ...state.themes,
      ...Object.fromEntries(themes.map(({ id, name, parentId }) => [id, { name, parentId }])),
    },
  };
}

export function removeCopy(state, setNum) {
  const entry = findSet(state, setNum);
  if (!entry) throw createError('not_owned');
  const sets = { ...state.sets };
  if (entry.copies === 1) delete sets[entry.setNum];
  else sets[entry.setNum] = { ...entry, copies: entry.copies - 1 };
  return { ...state, sets };
}

export function listSets(state) {
  return Object.values(state.sets).map(({ parts, ...summary }) => summary);
}

export function buildInventory(state) {
  const rows = new Map();
  for (const set of Object.values(state.sets)) {
    for (const part of set.parts) {
      const key = JSON.stringify([part.partNum, part.colorId]);
      const existing = rows.get(key);
      if (existing) {
        existing.quantity += part.quantity * set.copies;
        existing.imgUrl ??= part.imgUrl;
      } else {
        const { isSpare, ...row } = part;
        rows.set(key, {
          ...row,
          categoryName: Object.hasOwn(state.categories, part.categoryId)
            ? state.categories[part.categoryId] : 'Unknown category',
          quantity: part.quantity * set.copies,
        });
      }
    }
  }
  return [...rows.values()].sort((a, b) =>
    compareNames(a.categoryName, b.categoryName)
    || compareNames(a.name, b.name)
    || compareNames(a.colorName, b.colorName));
}
