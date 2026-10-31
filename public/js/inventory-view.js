const compareNames = new Intl.Collator('en', { numeric: true }).compare;

export function filterRows(rows, { colorId = null, categoryId = null, search = '' } = {}) {
  const query = search.trim().toLowerCase();
  return rows.filter(row =>
    (colorId === null || row.colorId === colorId)
    && (categoryId === null || row.categoryId === categoryId)
    && (query === '' || row.partNum.toLowerCase().includes(query)
      || row.name.toLowerCase().includes(query)));
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
