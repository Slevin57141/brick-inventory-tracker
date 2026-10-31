import { CONTAINER, interiorBox } from './container-spec.js';

// Bounds include the stud. M12 centres its brick geometry on this box.
export const BLOCK_SIZE = Object.freeze({ width: 0.18, depth: 0.18, height: 0.22 });
const STEP = { width: 0.2, depth: 0.2, height: 0.24 };
const GAP = 0.3;
const compareNames = new Intl.Collator('en', { numeric: true }).compare;

export function computeLayout(rows, { piecesPerBlock = 100 } = {}) {
  const categories = new Map();
  for (const row of rows) {
    if (row.quantity <= 0) continue;
    let category = categories.get(row.categoryId);
    if (!category) {
      category = { categoryId: row.categoryId, categoryName: row.categoryName, pieces: 0,
        colors: new Map() };
      categories.set(row.categoryId, category);
    }
    category.pieces += row.quantity;
    const color = category.colors.get(row.colorId);
    if (color) color.pieces += row.quantity;
    else category.colors.set(row.colorId, { id: row.colorId, pieces: row.quantity,
      colorRgb: row.colorRgb, colorIsTrans: row.colorIsTrans });
  }

  const containers = [];
  const blocks = [];
  const ordered = [...categories.values()].sort((a, b) =>
    compareNames(a.categoryName, b.categoryName) || a.categoryId - b.categoryId);
  for (const category of ordered) {
    const colors = [...category.colors.values()].sort((a, b) => a.id - b.id);
    const count = colors.reduce((sum, color) => sum + Math.ceil(color.pieces / piecesPerBlock), 0);
    const grid = smallestGrid(count);
    const { categoryId, categoryName, pieces } = category;
    const container = { categoryId, categoryName, pieces,
      position: { x: 0, y: 0, z: 0 }, scale: grid.scale };
    containers.push(container);
    const box = interiorBox(grid.scale);
    let index = 0;
    for (const color of colors) {
      for (let i = 0; i < Math.ceil(color.pieces / piecesPerBlock); i += 1) {
        const col = index % grid.cols;
        const row = Math.floor(index / grid.cols) % grid.rows;
        const layer = Math.floor(index / (grid.cols * grid.rows));
        blocks.push({ key: `${categoryId}|${color.id}|${i}`, categoryId,
          colorRgb: color.colorRgb, colorIsTrans: color.colorIsTrans,
          position: {
            x: (col - (grid.cols - 1) / 2) * STEP.width,
            y: box.floorY + BLOCK_SIZE.height / 2 + layer * STEP.height,
            z: (row - (grid.rows - 1) / 2) * STEP.depth,
          } });
        index += 1;
      }
    }
  }

  placeContainers(containers);
  const byCategory = new Map(containers.map(container => [container.categoryId, container]));
  for (const block of blocks) {
    const offset = byCategory.get(block.categoryId).position;
    block.position = { x: block.position.x + offset.x, y: block.position.y,
      z: block.position.z + offset.z };
  }
  return { piecesPerBlock, containers, blocks };
}

function extent(count, dimension) {
  return BLOCK_SIZE[dimension] + (count - 1) * STEP[dimension];
}

function smallestGrid(count) {
  const box = interiorBox(1);
  let best = null;
  // For any width and depth count, the minimum layer count is determined. Comparing all
  // such grids minimizes uniform container scale without assuming a fixed aspect ratio.
  for (let cols = 1; cols <= count; cols += 1) {
    if (best && extent(cols, 'width') / box.width > best.scale) break;
    for (let rows = 1; rows <= Math.ceil(count / cols); rows += 1) {
      if (best && extent(rows, 'depth') / box.depth > best.scale) break;
      const layers = Math.ceil(count / (cols * rows));
      const scale = Math.max(extent(cols, 'width') / box.width,
        extent(rows, 'depth') / box.depth, extent(layers, 'height') / box.height);
      const capacity = cols * rows * layers;
      if (!best || scale < best.scale || (scale === best.scale && capacity < best.capacity)) {
        best = { cols, rows, layers, scale, capacity };
      }
    }
  }
  return best;
}

function placeContainers(containers) {
  const perRow = Math.ceil(Math.sqrt(containers.length));
  let z = 0;
  for (let start = 0; start < containers.length; start += perRow) {
    const row = containers.slice(start, start + perRow);
    const depth = Math.max(...row.map(container =>
      (CONTAINER.depth + 2 * CONTAINER.lidOverhang) * container.scale));
    const widths = row.map(container =>
      (CONTAINER.width + 2 * CONTAINER.lidOverhang) * container.scale);
    const total = widths.reduce((sum, width) => sum + width, 0) + GAP * (row.length - 1);
    let x = -total / 2;
    for (let i = 0; i < row.length; i += 1) {
      row[i].position = { x: x + widths[i] / 2, y: 0, z: z + depth / 2 };
      x += widths[i] + GAP;
    }
    z += depth + GAP;
  }
  for (const container of containers) container.position.z -= (z - GAP) / 2;
}

export function planTransition(fromLayout, toLayout) {
  const targets = new Map(toLayout.containers.map(container => [container.categoryId, container]));
  return {
    piecesPerBlock: toLayout.piecesPerBlock,
    containers: matchItems(fromLayout.containers, toLayout.containers, 'categoryId',
      item => ({ ...item, scale: 0 }), item => ({ ...item, scale: 0 })),
    blocks: matchItems(fromLayout.blocks, toLayout.blocks, 'key', item => {
      const container = targets.get(item.categoryId);
      const top = container.position.y + (CONTAINER.height + CONTAINER.lidHeight) * container.scale;
      return { ...item, scale: 0, position: { ...item.position,
        y: Math.max(top, item.position.y) + BLOCK_SIZE.height + GAP } };
    }, item => ({ ...item, scale: 0 })),
  };
}

function matchItems(before, after, key, enter, leave) {
  const oldItems = new Map(before.map(item => [item[key], item]));
  const newItems = new Map(after.map(item => [item[key], item]));
  const pairs = [];
  for (const item of after) {
    pairs.push({ from: copyItem(oldItems.get(item[key]) ?? enter(item)), to: copyItem(item) });
  }
  for (const item of before) {
    if (!newItems.has(item[key])) pairs.push({ from: copyItem(item), to: copyItem(leave(item)) });
  }
  return pairs;
}

function copyItem(item) {
  return { ...item, position: { ...item.position }, scale: item.scale ?? 1 };
}

export function easeInOutCubic(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

export function frameAt(transition, t) {
  const progress = easeInOutCubic(t);
  const interpolate = ({ from, to }) => ({
    ...(progress === 0 ? from : to),
    position: {
      x: mix(from.position.x, to.position.x, progress),
      y: mix(from.position.y, to.position.y, progress),
      z: mix(from.position.z, to.position.z, progress),
    },
    scale: mix(from.scale, to.scale, progress),
  });
  return { piecesPerBlock: transition.piecesPerBlock,
    containers: transition.containers.map(interpolate), blocks: transition.blocks.map(interpolate) };
}

function mix(from, to, t) {
  if (t === 0) return from;
  if (t === 1) return to;
  return from + (to - from) * t;
}
