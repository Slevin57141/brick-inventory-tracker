import { test } from 'node:test';
import assert from 'node:assert/strict';
import util from 'node:util';
import { AppError, ERRORS } from '../src/errors.js';
import { createRebrickableClient } from '../src/rebrickable-client.js';
import { createFakeFetch, loadFixture } from './helpers/fake-fetch.js';

const API = 'https://rebrickable.com/api/v3';
const SENTINEL = 'SENTINEL-key-0123456789abcdef';
const SET_ROUTE = 'GET /lego/sets/31146-1/';
const PARTS_ROUTE = 'GET /lego/sets/76991-1/parts/?inc_minifig_parts=1&page_size=1000';

/** A clock that only moves when the client sleeps, so pacing and retries take no real time. */
function fakeClock(start = 1_000_000) {
  let time = start;
  const sleeps = [];
  return {
    sleeps,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
  };
}

function makeClient(routes, { key = SENTINEL, ...options } = {}) {
  const clock = fakeClock();
  const fetch = createFakeFetch(routes);
  const keyStore = { get: () => key };
  const client = createRebrickableClient({
    keyStore, fetch, sleep: clock.sleep, now: clock.now, ...options,
  });
  return { client, fetch, clock };
}

function isAppError(code) {
  return (error) => {
    assert.ok(error instanceof AppError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.message, ERRORS[code].message);
    assert.equal(error.cause, undefined);
    const shown = util.inspect(error, { showHidden: true, depth: null });
    assert.ok(!shown.includes(SENTINEL), 'the error shows the key');
    assert.ok(!shown.includes('rebrickable.com'), 'the error shows a URL');
    return true;
  };
}

test('requests go to the documented URLs, with the key only in Authorization', async () => {
  const { client, fetch } = makeClient({
    'GET /lego/colors/?page_size=1': 'key-check-valid',
    [SET_ROUTE]: 'set-31146-1',
    'GET /lego/sets/31146-1/parts/?inc_minifig_parts=1&page_size=1000': 'set-31146-1-parts-page1',
    'GET /lego/sets/31146-1/sets/?page_size=1000': 'set-31146-1-sets',
    'GET /lego/part_categories/?page_size=1000': 'part-categories',
  });

  await client.checkKey(SENTINEL);
  assert.deepEqual(await client.getSet('31146-1'), loadFixture('set-31146-1').body);
  assert.deepEqual(
    await client.getSetParts('31146-1'),
    loadFixture('set-31146-1-parts-page1').body.results,
  );
  assert.deepEqual(await client.getContainedSets('31146-1'), []);
  assert.equal((await client.getPartCategories()).length, 76);

  assert.deepEqual(
    fetch.requests.map((request) => request.url),
    [
      `${API}/lego/colors/?page_size=1`,
      `${API}/lego/sets/31146-1/`,
      `${API}/lego/sets/31146-1/parts/?inc_minifig_parts=1&page_size=1000`,
      `${API}/lego/sets/31146-1/sets/?page_size=1000`,
      `${API}/lego/part_categories/?page_size=1000`,
    ],
  );
  for (const request of fetch.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, `key ${SENTINEL}`);
    assert.ok(!request.url.includes(SENTINEL));
    for (const [name, value] of Object.entries(request.headers)) {
      if (name !== 'authorization') assert.ok(!value.includes(SENTINEL), name);
    }
  }
});

test('checkKey sends the candidate key, not the stored one, and follows no next link', async () => {
  const { client, fetch } = makeClient(
    { 'GET /lego/colors/?page_size=1': 'key-check-valid' },
    { key: null },
  );
  await client.checkKey('candidate-key-1234');
  assert.equal(fetch.requests.length, 1);
  assert.equal(fetch.requests[0].headers.authorization, 'key candidate-key-1234');
});

test('set numbers are encoded as one path segment, and dot segments are refused', async () => {
  const { client, fetch } = makeClient({
    'GET /lego/sets/a%20b%2Fc%3Fd/': { status: 200, body: { set_num: 'x' } },
  });
  await client.getSet('a b/c?d');
  assert.equal(fetch.requests[0].url, `${API}/lego/sets/a%20b%2Fc%3Fd/`);

  for (const setNum of ['.', '..', '', null]) {
    await assert.rejects(client.getSet(setNum), isAppError('invalid_set_number'));
  }
  assert.equal(fetch.requests.length, 1);
});

test('without a key, nothing is requested and key_required is thrown', async () => {
  const { client, fetch, clock } = makeClient({}, { key: null });
  for (const call of [
    () => client.getSet('31146-1'),
    () => client.getSetParts('31146-1'),
    () => client.getContainedSets('31146-1'),
    () => client.getPartCategories(),
    () => client.checkKey(''),
    () => client.checkKey(undefined),
  ]) {
    await assert.rejects(call(), isAppError('key_required'));
  }
  assert.equal(fetch.requests.length, 0);
  assert.deepEqual(clock.sleeps, []);
});

test('a key forgotten while a request waits its turn gives key_required', async () => {
  // Codex's review of PR 8: the key read after the wait used to be inside the fetch catch.
  let key = SENTINEL;
  const clock = fakeClock();
  const fetch = createFakeFetch({ [SET_ROUTE]: 'set-31146-1' });
  const sleep = async (ms) => {
    key = null;
    await clock.sleep(ms);
  };
  const client = createRebrickableClient({
    keyStore: { get: () => key }, fetch, sleep, now: clock.now,
  });

  await client.getSet('31146-1');
  await assert.rejects(client.getSet('31146-1'), isAppError('key_required'));
  assert.equal(fetch.requests.length, 1);
});

test('pages are joined in order by following next', async () => {
  const { client, fetch } = makeClient({
    [PARTS_ROUTE]: 'set-76991-1-parts-size100-page1',
    'GET /lego/sets/76991-1/parts/?inc_minifig_parts=1&page=2&page_size=100':
      'set-76991-1-parts-size100-page2',
  });
  const lines = await client.getSetParts('76991-1');
  assert.equal(fetch.requests.length, 2);
  assert.deepEqual(lines, loadFixture('set-76991-1-parts-page1').body.results);
  assert.equal(fetch.requests[1].headers.authorization, `key ${SENTINEL}`);
});

test('a next link to another origin is refused before it is requested', async () => {
  for (const next of [
    'https://evil.example/api/v3/lego/sets/1-1/parts/?page=2',
    'http://rebrickable.com/api/v3/lego/sets/1-1/parts/?page=2',
    'https://rebrickable.com.evil.example/api/v3/?page=2',
    'not a url',
    42,
  ]) {
    const { client, fetch } = makeClient({
      [PARTS_ROUTE]: { status: 200, body: { count: 2, next, results: [{ id: 1 }] } },
    });
    await assert.rejects(client.getSetParts('76991-1'), isAppError('api_unavailable'));
    assert.equal(fetch.requests.length, 1, String(next));
  }
});

test('a next link that never ends stops after 50 pages', async () => {
  const loop = `${API}/lego/sets/76991-1/parts/?inc_minifig_parts=1&page=2&page_size=1000`;
  const page = { status: 200, body: { count: 1, next: loop, results: [{ id: 1 }] } };
  const { client, fetch } = makeClient({
    [PARTS_ROUTE]: page,
    'GET /lego/sets/76991-1/parts/?inc_minifig_parts=1&page=2&page_size=1000': page,
  });
  await assert.rejects(client.getSetParts('76991-1'), isAppError('api_unavailable'));
  assert.equal(fetch.requests.length, 50);
});

test('each failure maps to its error code', async () => {
  const unauthorized = { status: 401, body: { detail: 'Invalid token.' } };
  const forbidden = { status: 403, body: { detail: 'Forbidden.' } };
  const notFound = 'set-99999999-1';
  const cases = [
    ['checkKey', 'GET /lego/colors/?page_size=1', 'key-check-invalid', 'key_invalid'],
    ['getSet', SET_ROUTE, unauthorized, 'key_invalid'],
    ['getSet', SET_ROUTE, forbidden, 'key_invalid'],
    ['getSet', SET_ROUTE, notFound, 'set_not_found'],
    ['getSetParts', PARTS_ROUTE, notFound, 'set_not_found'],
    ['getContainedSets', 'GET /lego/sets/76991-1/sets/?page_size=1000', notFound, 'set_not_found'],
    ['getPartCategories', 'GET /lego/part_categories/?page_size=1000', notFound, 'api_unavailable'],
    ['checkKey', 'GET /lego/colors/?page_size=1', notFound, 'api_unavailable'],
    ['getSet', SET_ROUTE, 'handmade-server-error', 'api_unavailable'],
    ['getSet', SET_ROUTE, { status: 503, body: {} }, 'api_unavailable'],
    ['getSet', SET_ROUTE, 'handmade-malformed-json', 'api_unavailable'],
    ['getSet', SET_ROUTE, 'handmade-network-error', 'api_unavailable'],
    ['getSet', SET_ROUTE, { status: 200, body: [1, 2] }, 'api_unavailable'],
    ['getSet', SET_ROUTE, { status: 200, body: null }, 'api_unavailable'],
    ['getSetParts', PARTS_ROUTE, { status: 200, body: { next: null } }, 'api_unavailable'],
    ['getSetParts', PARTS_ROUTE, 'handmade-malformed-json', 'api_unavailable'],
  ];
  for (const [method, route, answer, code] of cases) {
    const { client } = makeClient({ [route]: answer });
    const argument = method === 'checkKey' ? SENTINEL : route.split('/')[3];
    await assert.rejects(client[method](argument), isAppError(code), `${method} ${code}`);
  }
});

test('a request that does not answer in time fails with api_unavailable', async () => {
  const { client } = makeClient({ [SET_ROUTE]: { hang: true } }, { timeoutMs: 20 });
  // AbortSignal.timeout does not keep Node running, and a fake request that never answers
  // holds nothing open, so without this timer the test process would end before the abort.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(client.getSet('31146-1'), isAppError('api_unavailable'));
  } finally {
    clearTimeout(keepAlive);
  }
});

test('a 429 waits as Rebrickable asks, then retries', async () => {
  const success = { status: 200, body: { set_num: '31146-1' } };
  const throttled = (headers, detail) => ({ status: 429, headers, body: detail ? { detail } : {} });
  const cases = [
    // Without Retry-After, the seconds in detail (the documented body, D22).
    ['handmade-throttled', 2000],
    [throttled({ 'retry-after': '7' }, 'Expected available in 2 seconds.'), 7000],
    [throttled({ 'retry-after': '120' }), 30_000],
    [throttled({ 'retry-after': new Date(1_000_000 + 10_000).toUTCString() }), 10_000],
    [throttled({}, 'Expected available in 1 second.'), 1000],
    [throttled({}, 'Slow down.'), 5000],
    [throttled({ 'retry-after': 'soon' }), 5000],
    [{ status: 429, rawBody: 'not json' }, 5000],
  ];
  for (const [first, expectedWait] of cases) {
    const { client, fetch, clock } = makeClient(
      { [SET_ROUTE]: [first, success] },
      { minIntervalMs: 0 },
    );
    assert.deepEqual(await client.getSet('31146-1'), success.body);
    assert.equal(fetch.requests.length, 2);
    assert.deepEqual(clock.sleeps, [expectedWait], JSON.stringify(first));
  }
});

test('three 429s in a row give rate_limited after two retries', async () => {
  const { client, fetch } = makeClient({
    [SET_ROUTE]: ['handmade-throttled', 'handmade-throttled', 'handmade-throttled'],
  });
  await assert.rejects(client.getSet('31146-1'), isAppError('rate_limited'));
  assert.equal(fetch.requests.length, 3);
});

test('requests start at least minIntervalMs apart, across all callers', async () => {
  const clock = fakeClock();
  const fake = createFakeFetch({
    [SET_ROUTE]: 'set-31146-1',
    'GET /lego/sets/42161-1/': 'set-42161-1',
    'GET /lego/part_categories/?page_size=1000': 'part-categories',
  });
  const starts = [];
  const fetch = (input, init) => {
    starts.push(clock.now());
    return fake(input, init);
  };
  const client = createRebrickableClient({
    keyStore: { get: () => SENTINEL }, fetch, sleep: clock.sleep, now: clock.now,
  });

  await Promise.all([
    client.getSet('31146-1'),
    client.getSet('42161-1'),
    client.getPartCategories(),
  ]);
  await client.getSet('31146-1');
  assert.deepEqual(starts.map((start) => start - starts[0]), [0, 1100, 2200, 3300]);
});

test('a network error never carries the key, its URL or the caught message', async () => {
  const { client } = makeClient({ [SET_ROUTE]: 'handmade-network-error' });
  try {
    await client.getSet('31146-1');
    assert.fail('expected a rejection');
  } catch (error) {
    isAppError('api_unavailable')(error);
    assert.ok(!JSON.stringify(error).includes(SENTINEL));
    assert.ok(!String(error.stack).includes('fetch failed'));
  }
});
