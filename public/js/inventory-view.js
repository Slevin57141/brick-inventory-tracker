const compareNames = new Intl.Collator('en', { numeric: true }).compare;

// A filter per column of the parts list (D27); text matches ignore case and outer spaces.
export function filterRows(rows, {
  colorId = null, categoryId = null, search = '', partNum = '', name = '',
  minQuantity = null, maxQuantity = null,
} = {}) {
  const query = search.trim().toLowerCase();
  const number = partNum.trim().toLowerCase();
  const words = name.trim().toLowerCase();
  return rows.filter(row =>
    (colorId === null || row.colorId === colorId)
    && (categoryId === null || row.categoryId === categoryId)
    && (query === '' || row.partNum.toLowerCase().includes(query)
      || row.name.toLowerCase().includes(query))
    && (number === '' || row.partNum.toLowerCase().includes(number))
    && (words === '' || row.name.toLowerCase().includes(words))
    && (minQuantity === null || row.quantity >= minQuantity)
    && (maxQuantity === null || row.quantity <= maxQuantity));
}

const SORT_KEYS = {
  partNum: (a, b) => compareNames(a.partNum, b.partNum),
  name: (a, b) => compareNames(a.name, b.name),
  colorName: (a, b) => compareNames(a.colorName, b.colorName),
  categoryName: (a, b) => compareNames(a.categoryName, b.categoryName),
  quantity: (a, b) => a.quantity - b.quantity,
};
export const SORT_COLUMNS = Object.freeze(Object.keys(SORT_KEYS));

// A sorted copy. Ties fall back to name, part number and colour, always ascending, so the
// order is the same every time.
export function sortRows(rows, { column = 'name', direction = 'asc' } = {}) {
  const primary = SORT_KEYS[column];
  if (primary === undefined) {
    throw new TypeError(`Unknown sort column: ${column}`);
  }
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * primary(a, b)
    || SORT_KEYS.name(a, b) || SORT_KEYS.partNum(a, b) || SORT_KEYS.colorName(a, b));
}

export function computeTotals(rows) {
  return {
    distinctParts: rows.length,
    totalPieces: rows.reduce((sum, row) => sum + row.quantity, 0),
  };
}

export function filterOptions(rows) {
  const colors = new Map();
  const categories = new Map();
  for (const row of rows) {
    if (!colors.has(row.colorId)) {
      colors.set(row.colorId, { id: row.colorId, name: row.colorName, rgb: row.colorRgb });
    }
    if (!categories.has(row.categoryId)) {
      categories.set(row.categoryId, { id: row.categoryId, name: row.categoryName });
    }
  }
  const byName = (a, b) => compareNames(a.name, b.name);
  return {
    colors: [...colors.values()].sort(byName),
    categories: [...categories.values()].sort(byName),
  };
}
