// Reads the LDraw parts library (ldraw.org) that the user downloads (docs/plan.md M14, D31) and
// turns its parts and models into triangles for the 3D view. Nothing here is fetched: the
// library is a folder of text files, looked up the way LDraw files refer to each other,
// without regard to case and with backslashes or slashes. Only faces are read (line types 3
// and 4); edge lines are left out, and so is face winding, because the view draws both faces.

import { readFile as fsReadFile, readdir as fsReaddir } from 'node:fs/promises';
import { join } from 'node:path';

// Where the library keeps its files, searched in this order (the LDraw file format spec).
const SEARCH = [
  { folder: 'parts', prefix: '' },
  { folder: join('parts', 's'), prefix: 's/' },
  { folder: 'p', prefix: '' },
  { folder: join('p', '48'), prefix: '48/' },
  { folder: join('p', '8'), prefix: '8/' },
  { folder: 'models', prefix: '' },
];
// Set models the user downloads, from the LDraw Official Model Repository (OMR).
const MODELS = 'omr';
// A part is only ever a few levels deep; a file that refers to itself stops here.
const MAX_DEPTH = 32;
// What a caller may ask for: a library file name, with at most one folder in front.
const NAME = /^(?:[a-z0-9]+\/)?[a-z0-9][a-z0-9._-]{0,80}$/;
const MAIN_COLOR = 16;
const EDGE_COLOR = 24;
// A part placed with the main colour at the top of a model has no colour to inherit.
const FALLBACK = { rgb: '9BA19D', alpha: 255 };

/**
 * `root` is the library folder (the one holding `parts`, `p` and `LDConfig.ldr`). Missing or
 * incomplete, the library is simply not available; nothing throws.
 */
export function createLdrawLibrary({ root, readFile = fsReadFile, readdir = fsReaddir }) {
  let index = null; // name -> path, built on first use
  const files = new Map(); // path -> Promise<sections of commands>
  const meshes = new Map(); // path -> Promise<Float32Array>
  let colors = null;

  function load() {
    index ??= (async () => {
      const found = new Map();
      for (const { folder, prefix } of SEARCH) {
        let names = [];
        try {
          names = await readdir(join(root, folder));
        } catch {
          continue;
        }
        for (const name of names) {
          const key = prefix + name.toLowerCase();
          if (!found.has(key)) {
            found.set(key, join(root, folder, name));
          }
        }
      }
      return found;
    })();
    return index;
  }

  // The parsed file at `path`: its sections by name, the first one being the file itself.
  function parsed(path) {
    if (!files.has(path)) {
      files.set(path, readFile(path, 'utf8').then(parseLdraw));
    }
    return files.get(path);
  }

  async function resolve(name) {
    return (await load()).get(normalizeName(name)) ?? null;
  }

  // The triangles of a library file in its own coordinates, its subfiles included. `chain`
  // holds the files being unwrapped above this one: a file that refers back to one of them
  // (a broken library) is skipped instead of waiting for itself.
  function trianglesOf(path, chain = new Set()) {
    if (!meshes.has(path)) {
      const inside = new Set(chain).add(path);
      meshes.set(path, (async () => {
        const [main] = (await parsed(path)).values();
        const out = [];
        for (const command of main) {
          if (command.type === 1) {
            const child = await resolve(command.file);
            if (child !== null && !inside.has(child) && inside.size < MAX_DEPTH) {
              appendTransformed(out, await trianglesOf(child, inside), command.matrix);
            }
          } else {
            out.push(...command.points);
          }
        }
        return Float32Array.from(out);
      })());
    }
    return meshes.get(path);
  }

  async function colorTable() {
    colors ??= readFile(join(root, 'LDConfig.ldr'), 'utf8').then(parseColors, () => new Map());
    return colors;
  }

  return Object.freeze({
    /** Whether the library is there: a parts folder with at least one part. */
    async available() {
      const found = await load();
      return [...found.values()].some((path) => path.startsWith(join(root, 'parts')));
    },

    /**
     * The triangles of the first of `names` the library has, as `{ name, positions }`:
     * positions in LDraw units and axes, nine numbers per triangle. Null when it has none.
     * A name may leave out `.dat`; a name that is not a plain library name is skipped.
     */
    async part(names) {
      for (const raw of names) {
        const name = normalizeName(raw);
        const candidates = name.endsWith('.dat') || name.endsWith('.ldr') ? [name]
          : [name, `${name}.dat`];
        for (const candidate of candidates) {
          if (!NAME.test(candidate)) {
            continue;
          }
          const path = (await load()).get(candidate);
          if (path !== undefined) {
            return { name: candidate, positions: await trianglesOf(path) };
          }
        }
      }
      return null;
    },

    /**
     * The model of a built set from the OMR folder, or null when there is none:
     * `{ colors: [{ rgb, alpha }], instances: [{ part, color, matrix }], loose: [{ color,
     * positions }] }`. Each instance places a library file (ask `part([name])` for its
     * triangles) with a 12-number LDraw matrix (x y z a b c d e f g h i) in a colour from
     * `colors`. Submodels are unwrapped into their parts; faces written in the model itself
     * come as `loose` triangles per colour.
     */
    async model(setNum) {
      if (typeof setNum !== 'string' || setNum === '') {
        return null;
      }
      let names;
      try {
        names = await readdir(join(root, MODELS));
      } catch {
        return null;
      }
      const wanted = setNum.toLowerCase();
      const file = names.find((name) => {
        const lower = name.toLowerCase();
        return lower.startsWith(wanted) && [' ', '.'].includes(lower[wanted.length])
          && /\.(mpd|ldr)$/.test(lower);
      });
      if (file === undefined) {
        return null;
      }
      const sections = await parsed(join(root, MODELS, file));
      const table = await colorTable();
      const palette = [];
      const paletteIndex = new Map();
      const colorIndex = (code, inherited) => {
        const value = code === MAIN_COLOR ? inherited : colorValue(table, code);
        const key = `${value.rgb}|${value.alpha}`;
        if (!paletteIndex.has(key)) {
          paletteIndex.set(key, palette.length);
          palette.push(value);
        }
        return paletteIndex.get(key);
      };
      const instances = [];
      const loose = new Map(); // color index -> numbers
      const walk = async (commands, matrix, inherited, depth) => {
        for (const command of commands) {
          if (command.type !== 1) {
            const color = colorIndex(command.color, inherited);
            const list = loose.get(color) ?? [];
            appendTransformed(list, command.points, matrix);
            loose.set(color, list);
            continue;
          }
          const color = command.color === MAIN_COLOR ? inherited : colorValue(table, command.color);
          const placed = multiply(matrix, command.matrix);
          const inside = sections.get(normalizeName(command.file));
          if (inside !== undefined) {
            if (depth < MAX_DEPTH) {
              await walk(inside, placed, color, depth + 1);
            }
            continue;
          }
          const path = await resolve(command.file);
          if (path !== null) {
            instances.push({ part: normalizeName(command.file), color: colorIndex(command.color,
              inherited), matrix: placed });
          }
        }
      };
      const [main] = sections.values();
      await walk(main, IDENTITY, FALLBACK, 0);
      return {
        colors: palette,
        instances,
        loose: [...loose].map(([color, numbers]) => ({ color,
          positions: Float32Array.from(numbers) })),
      };
    },
  });
}

/** A file name as LDraw files write it, the way the library looks it up. */
export function normalizeName(name) {
  return String(name).trim().replaceAll('\\', '/').toLowerCase();
}

/**
 * The commands of an LDraw file by section: a plain file has one, named '', and a multi-part
 * file (MPD) one per `0 FILE` line. Line type 1 is `{ type, color, matrix, file }`; types 3
 * and 4 are `{ type: 3, color, points }` with a quad split into two triangles.
 */
export function parseLdraw(text) {
  const sections = new Map();
  let current = [];
  let named = false;
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    const type = fields[0];
    if (type === '0') {
      if (fields[1] === 'FILE') {
        current = [];
        sections.set(normalizeName(fields.slice(2).join(' ')), current);
        named = true;
      }
      continue;
    }
    if (!named && !sections.has('')) {
      sections.set('', current);
    }
    const numbers = fields.slice(1).map(Number);
    if (type === '1' && fields.length >= 15 && numbers.slice(0, 13).every(Number.isFinite)) {
      const [color, x, y, z, a, b, c, d, e, f, g, h, i] = numbers;
      current.push({ type: 1, color, matrix: [x, y, z, a, b, c, d, e, f, g, h, i],
        file: fields.slice(14).join(' ') });
    } else if (type === '3' && fields.length >= 11 && numbers.slice(0, 10).every(Number.isFinite)) {
      current.push({ type: 3, color: numbers[0], points: numbers.slice(1, 10) });
    } else if (type === '4' && fields.length >= 14 && numbers.slice(0, 13).every(Number.isFinite)) {
      const [color, ...q] = numbers.slice(0, 13);
      // A quad a b c d is the triangles a b c and a c d.
      current.push({ type: 3, color,
        points: [...q.slice(0, 9), ...q.slice(0, 3), ...q.slice(6, 12)] });
    }
  }
  if (sections.size === 0) {
    sections.set('', current);
  }
  return sections;
}

/** The colours of LDConfig.ldr: code -> { rgb, alpha }. */
export function parseColors(text) {
  const table = new Map();
  for (const line of text.split(/\r?\n/)) {
    const code = /\bCODE\s+(\d+)/.exec(line);
    const value = /\bVALUE\s+#([0-9A-Fa-f]{6})/.exec(line);
    if (line.includes('!COLOUR') && code && value) {
      const alpha = /\bALPHA\s+(\d+)/.exec(line);
      table.set(Number(code[1]), { rgb: value[1].toUpperCase(),
        alpha: alpha ? Math.min(255, Number(alpha[1])) : 255 });
    }
  }
  return table;
}

// A colour code from the table, or a direct colour (0x2RRGGBB), or the fallback grey.
function colorValue(table, code) {
  if (table.has(code)) {
    return table.get(code);
  }
  if (code >= 0x2000000 && code <= 0x2FFFFFF) {
    return { rgb: (code - 0x2000000).toString(16).toUpperCase().padStart(6, '0'), alpha: 255 };
  }
  return code === EDGE_COLOR ? { rgb: '333333', alpha: 255 } : FALLBACK;
}

const IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

// The transform `inner` then `outer`, both as LDraw's x y z a b c d e f g h i.
function multiply(outer, inner) {
  const [ox, oy, oz, a, b, c, d, e, f, g, h, i] = outer;
  const [ix, iy, iz, ...m] = inner;
  const rows = [[a, b, c], [d, e, f], [g, h, i]];
  const out = [
    ox + a * ix + b * iy + c * iz,
    oy + d * ix + e * iy + f * iz,
    oz + g * ix + h * iy + i * iz,
  ];
  for (const row of rows) {
    for (let column = 0; column < 3; column += 1) {
      out.push(row[0] * m[column] + row[1] * m[3 + column] + row[2] * m[6 + column]);
    }
  }
  return out;
}

// Appends points (x y z ...) moved by an LDraw matrix.
function appendTransformed(out, points, [x, y, z, a, b, c, d, e, f, g, h, i]) {
  for (let k = 0; k < points.length; k += 3) {
    const px = points[k];
    const py = points[k + 1];
    const pz = points[k + 2];
    out.push(a * px + b * py + c * pz + x, d * px + e * py + f * pz + y,
      g * px + h * py + i * pz + z);
  }
}
