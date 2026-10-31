// One function per route in docs/plan.md section 7 (M10). Each returns the response's data or
// throws an ApiError carrying the server's fixed `{ code, message }`. When there is no such
// body to read, the error is one of two page-only codes, also listed in section 7.

const UNREACHABLE = {
  code: 'server_unreachable',
  message: 'The app could not reach its server. Check that it is still running.',
};
const UNEXPECTED = { code: 'internal_error', message: 'Something went wrong. See the server log.' };

// Float32 numbers sent as base64 (little-endian, as every browser stores them).
function floats(text) {
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  if (bytes.length % 4 !== 0) {
    throw new ApiError(UNEXPECTED);
  }
  return new Float32Array(bytes.buffer);
}

export class ApiError extends Error {
  constructor({ code, message }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** `fetch` is injected for tests; the page uses the browser's. */
export function createApi({ fetch = (...args) => globalThis.fetch(...args) } = {}) {
  async function request(method, path, body) {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch {
      throw new ApiError(UNREACHABLE);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      // Not JSON: handled below like any other unexpected answer.
    }
    if (!response.ok) {
      const error = data?.error;
      throw new ApiError(typeof error?.code === 'string' && typeof error.message === 'string'
        ? error : UNEXPECTED);
    }
    if (data === null || typeof data !== 'object') {
      throw new ApiError(UNEXPECTED);
    }
    return data;
  }

  // The field a route's answer carries, or an unexpected-answer error when it is missing.
  async function field(promise, name, check) {
    const data = await promise;
    if (!check(data[name])) {
      throw new ApiError(UNEXPECTED);
    }
    return data[name];
  }
  const isObject = (value) => value !== null && typeof value === 'object';
  const isText = (value) => typeof value === 'string';
  // What a route has nothing for (not_found) is null; any other error is thrown as usual.
  const orNull = async (read) => {
    try {
      return await read();
    } catch (error) {
      if (error.code === 'not_found') {
        return null;
      }
      throw error;
    }
  };
  const keyState = async (promise) => ({
    hasKey: await field(promise, 'hasKey', (value) => typeof value === 'boolean'),
  });

  return Object.freeze({
    /** Whether the server holds a key: `{ hasKey }`. */
    getStatus: () => keyState(request('GET', '/api/status')),
    /** Sends a key to be checked and kept: `{ hasKey }`, false if it was forgotten meanwhile. */
    setKey: (key) => keyState(request('PUT', '/api/key', { key })),
    forgetKey: () => keyState(request('DELETE', '/api/key')),
    /** SetSummary[] */
    listSets: () => field(request('GET', '/api/sets'), 'sets', Array.isArray),
    /** One saved set and the parts of one copy: `{ set: SetSummary, rows: InventoryRow[] }`. */
    getSet: async (setNum) => {
      const data = await request('GET', `/api/sets/${encodeURIComponent(setNum)}`);
      if (!isObject(data.set) || !Array.isArray(data.rows)) {
        throw new ApiError(UNEXPECTED);
      }
      return { set: data.set, rows: data.rows };
    },
    /** The added set's SetSummary. */
    addSet: (setNumber) => field(request('POST', '/api/sets', { setNumber }), 'set', isObject),
    /** The SetSummary with one copy fewer, or null when the last copy went. */
    removeSet: (setNum) => field(request('DELETE', `/api/sets/${encodeURIComponent(setNum)}`),
      'set', (set) => set === null || isObject(set)),
    /** InventoryRow[] */
    getInventory: () => field(request('GET', '/api/inventory'), 'rows', Array.isArray),
    /** Whether the server has the LDraw parts library: `{ available }` (D31). */
    getLdraw: async () => ({
      available: await field(request('GET', '/api/ldraw'), 'available',
        (value) => typeof value === 'boolean'),
    }),
    /**
     * The triangles of the first of these LDraw files the library has, as a Float32Array in
     * LDraw units and axes, or null when it has none of them.
     */
    getLdrawPart: (names) => orNull(async () => floats(await field(request('GET',
      `/api/ldraw/part?names=${encodeURIComponent(names.join(','))}`), 'positions', isText))),
    /** The LDraw model of a built set (M14), or null when there is none. */
    getSetModel: (setNum) => orNull(async () => {
      const data = await request('GET', `/api/sets/${encodeURIComponent(setNum)}/model`);
      if (!Array.isArray(data.colors) || !Array.isArray(data.instances)
        || !Array.isArray(data.loose) || !data.loose.every((item) => isText(item.positions))) {
        throw new ApiError(UNEXPECTED);
      }
      const loose = data.loose.map((item) => ({ color: item.color,
        positions: floats(item.positions) }));
      return { colors: data.colors, instances: data.instances, loose };
    }),
  });
}
