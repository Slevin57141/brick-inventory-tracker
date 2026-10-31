// The only code that talks to Rebrickable (docs/plan.md M3 and section 4). The key goes only
// into the Authorization header (D8), and every failure becomes a fixed AppError: no URL,
// header, response body or caught exception is passed on, since any of them could carry the
// key or text an outside server chose.

import { createError } from './errors.js';

const DEFAULT_BASE_URL = 'https://rebrickable.com/api/v3';
const PAGE_SIZE = 1000;
// A next link that never ends would otherwise loop forever. The largest captured parts list
// fits on one page of 1000.
const MAX_PAGES = 50;
// The first try plus two retries after a 429.
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_SECONDS = 5;
const MAX_RETRY_SECONDS = 30;

export function createRebrickableClient({
  keyStore,
  fetch = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
  minIntervalMs = 1100,
  timeoutMs = 15_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  let nextStart = -Infinity;
  let queue = Promise.resolve();

  // Every request takes a turn here, so starts stay minIntervalMs apart across all callers.
  function waitForTurn() {
    const turn = queue.then(async () => {
      const wait = nextStart - now();
      if (wait > 0) {
        await sleep(wait);
      }
      nextStart = now() + minIntervalMs;
    });
    queue = turn.catch(() => {});
    return turn;
  }

  async function request(target, { key, notFound = 'api_unavailable' }) {
    for (let attempt = 1; ; attempt += 1) {
      key(); // throws key_required before taking a turn, so no request is made
      await waitForTurn();

      let response;
      try {
        response = await fetch(target, {
          headers: { Authorization: `key ${key()}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw createError('api_unavailable');
      }

      if (response.status === 429) {
        if (attempt === MAX_ATTEMPTS) {
          discard(response);
          throw createError('rate_limited');
        }
        await sleep(await retryDelayMs(response));
        continue;
      }
      if (!response.ok) {
        discard(response);
        if (response.status === 401 || response.status === 403) {
          throw createError('key_invalid');
        }
        throw createError(response.status === 404 ? notFound : 'api_unavailable');
      }
      try {
        return await response.json();
      } catch {
        throw createError('api_unavailable');
      }
    }
  }

  async function retryDelayMs(response) {
    const header = response.headers.get('retry-after');
    let seconds = header === null ? NaN : retryAfterSeconds(header);
    if (Number.isNaN(seconds)) {
      const body = await response.json().catch(() => null);
      const match = /(\d+)\s*second/.exec(typeof body?.detail === 'string' ? body.detail : '');
      seconds = match ? Number(match[1]) : DEFAULT_RETRY_SECONDS;
    } else {
      discard(response);
    }
    return Math.min(Math.max(seconds, 0), MAX_RETRY_SECONDS) * 1000;
  }

  function retryAfterSeconds(value) {
    if (/^\s*\d+\s*$/.test(value)) {
      return Number(value);
    }
    const date = Date.parse(value);
    return Number.isNaN(date) ? NaN : (date - now()) / 1000;
  }

  async function requestAll(first, options) {
    const results = [];
    let next = first.href;
    for (let page = 0; next !== null; page += 1) {
      if (page === MAX_PAGES || typeof next !== 'string' || !URL.canParse(next)) {
        throw createError('api_unavailable');
      }
      const target = new URL(next);
      // The key travels with every page, so a link to any other site is refused.
      if (target.origin !== base.origin) {
        throw createError('api_unavailable');
      }
      const body = await request(target, options);
      if (!Array.isArray(body?.results)) {
        throw createError('api_unavailable');
      }
      for (const item of body.results) {
        results.push(item);
      }
      next = body.next ?? null;
    }
    return results;
  }

  function storedKey() {
    const key = keyStore.get();
    if (key === null || key === undefined) {
      throw createError('key_required');
    }
    return key;
  }

  function setUrl(setNum, rest) {
    // A '.' or '..' segment would be resolved away and change the path, even when encoded.
    if (typeof setNum !== 'string' || setNum === '' || setNum === '.' || setNum === '..') {
      throw createError('invalid_set_number');
    }
    return new URL(`lego/sets/${encodeURIComponent(setNum)}/${rest}`, base);
  }

  const forSet = { key: storedKey, notFound: 'set_not_found' };

  return Object.freeze({
    async checkKey(candidateKey) {
      const key = () => {
        if (typeof candidateKey !== 'string' || candidateKey === '') {
          throw createError('key_required');
        }
        return candidateKey;
      };
      await request(new URL('lego/colors/?page_size=1', base), { key });
    },

    async getSet(setNum) {
      const body = await request(setUrl(setNum, ''), forSet);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw createError('api_unavailable');
      }
      return body;
    },

    getSetParts(setNum) {
      const first = setUrl(setNum, `parts/?inc_minifig_parts=1&page_size=${PAGE_SIZE}`);
      return requestAll(first, forSet);
    },

    getContainedSets(setNum) {
      return requestAll(setUrl(setNum, `sets/?page_size=${PAGE_SIZE}`), forSet);
    },

    getPartCategories() {
      return requestAll(new URL(`lego/part_categories/?page_size=${PAGE_SIZE}`, base), {
        key: storedKey,
      });
    },
  });
}

// Frees the connection without reading a body nobody needs.
function discard(response) {
  response.body?.cancel().catch(() => {});
}
