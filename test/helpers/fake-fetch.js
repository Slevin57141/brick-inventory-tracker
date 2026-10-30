// A stand-in for fetch that answers Rebrickable requests from fixtures, so tests never touch
// the network. Routes are keyed by method and path relative to the API base URL, plus the
// query: 'GET /lego/sets/10270-1/parts/?inc_minifig_parts=1&page_size=1000'. Query
// parameters are sorted on both sides, so their order in a route key does not matter.
//
// A fixture is { status, headers, body } (body is sent as JSON), { status, headers, rawBody }
// (sent as is, for malformed responses), { networkError: true } (fails like an unreachable
// host) or { hang: true } (never answers until the request's signal aborts).

import { readFileSync } from 'node:fs';

const DEFAULT_BASE_URL = 'https://rebrickable.com/api/v3';
const FIXTURES_DIR = new URL('../fixtures/rebrickable/', import.meta.url);
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * @param {Record<string, string | object | Array<string | object>>} routes Each value is a
 *   fixture name (a file in test/fixtures/rebrickable/ without `.json`), an inline fixture,
 *   or an array of those, served one per request in order.
 * @returns {typeof fetch & { requests: Array<{ method: string, url: string, headers: object }> }}
 */
export function createFakeFetch(routes, { baseUrl = DEFAULT_BASE_URL } = {}) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const answers = new Map();
  for (const [key, value] of Object.entries(routes)) {
    answers.set(normalizeRouteKey(key), Array.isArray(value) ? [...value] : value);
  }
  const requests = [];

  async function fakeFetch(input, init) {
    const request = new Request(input, init);
    requests.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
    });

    const key = routeKeyFor(request.method, new URL(request.url), base);
    if (key === null || !answers.has(key)) {
      throw new Error(`No fake route for ${request.method} ${request.url}`);
    }

    let answer = answers.get(key);
    if (Array.isArray(answer)) {
      if (answer.length === 0) {
        throw new Error(`Fake route used more often than it has answers: ${key}`);
      }
      answer = answer.shift();
    }
    const fixture = typeof answer === 'string' ? loadFixture(answer) : answer;
    return respond(fixture, request.signal);
  }

  fakeFetch.requests = requests;
  return fakeFetch;
}

export function loadFixture(name) {
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error(`Not a fixture name: ${name}`);
  }
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES_DIR), 'utf8'));
}

function normalizeRouteKey(key) {
  const space = key.indexOf(' ');
  const method = key.slice(0, space).toUpperCase();
  const url = new URL(key.slice(space + 1), 'http://route.invalid');
  return `${method} ${url.pathname}${sortedQuery(url)}`;
}

function routeKeyFor(method, url, base) {
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    return null;
  }
  const path = `/${url.pathname.slice(base.pathname.length)}`;
  return `${method} ${path}${sortedQuery(url)}`;
}

function sortedQuery(url) {
  const params = new URLSearchParams(url.search);
  params.sort();
  const query = params.toString();
  return query ? `?${query}` : '';
}

function respond(fixture, signal) {
  if (fixture.networkError) {
    // What Node's fetch throws when a host cannot be reached.
    return Promise.reject(new TypeError('fetch failed'));
  }
  if (fixture.hang) {
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }

  const status = fixture.status ?? 200;
  const headers = new Headers(fixture.headers ?? {});
  let body = null;
  if (fixture.rawBody !== undefined) {
    body = fixture.rawBody;
  } else if (fixture.body !== undefined) {
    body = JSON.stringify(fixture.body);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  return Promise.resolve(
    new Response(NO_BODY_STATUSES.has(status) ? null : body, { status, headers }),
  );
}
