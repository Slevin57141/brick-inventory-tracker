import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFetch } from './helpers/fake-fetch.js';

const API = 'https://rebrickable.com/api/v3';

test('serves a fixture file with its status, headers and JSON body', async () => {
  const fetch = createFakeFetch({ 'GET /lego/colors/?page_size=1': 'handmade-throttled' });
  const response = await fetch(`${API}/lego/colors/?page_size=1`);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), {
    detail: 'Request was throttled. Expected available in 2 seconds.',
  });
});

test('serves an inline fixture, adding a JSON content type', async () => {
  const fetch = createFakeFetch({ 'GET /lego/sets/1-1/': { status: 200, body: { set_num: '1-1' } } });
  const response = await fetch(`${API}/lego/sets/1-1/`);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { set_num: '1-1' });
});

test('sends a raw body unchanged', async () => {
  const fetch = createFakeFetch({ 'GET /lego/sets/1-1/': 'handmade-malformed-json' });
  const response = await fetch(`${API}/lego/sets/1-1/`);
  assert.equal(response.status, 200);
  await assert.rejects(response.json(), SyntaxError);
});

test('a network error rejects like Node fetch does', async () => {
  const fetch = createFakeFetch({ 'GET /lego/sets/1-1/': 'handmade-network-error' });
  await assert.rejects(fetch(`${API}/lego/sets/1-1/`), { name: 'TypeError', message: 'fetch failed' });
});

test('a hanging request rejects when its signal aborts', async () => {
  const fetch = createFakeFetch({ 'GET /lego/sets/1-1/': { hang: true } });
  const controller = new AbortController();
  const pending = fetch(`${API}/lego/sets/1-1/`, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('query parameter order does not matter', async () => {
  const fetch = createFakeFetch({
    'GET /lego/sets/1-1/parts/?page_size=1000&inc_minifig_parts=1': { body: { results: [] } },
  });
  const response = await fetch(`${API}/lego/sets/1-1/parts/?inc_minifig_parts=1&page_size=1000`);
  assert.equal(response.status, 200);
});

test('an array of answers is served in order, then the route is exhausted', async () => {
  const fetch = createFakeFetch({
    'GET /lego/colors/?page_size=1': ['handmade-throttled', { status: 200, body: { count: 1 } }],
  });
  assert.equal((await fetch(`${API}/lego/colors/?page_size=1`)).status, 429);
  assert.equal((await fetch(`${API}/lego/colors/?page_size=1`)).status, 200);
  await assert.rejects(fetch(`${API}/lego/colors/?page_size=1`), /used more often/);
});

test('unknown routes and other sites are refused', async () => {
  const fetch = createFakeFetch({ 'GET /lego/colors/': { body: {} } });
  await assert.rejects(fetch(`${API}/lego/themes/`), /No fake route/);
  await assert.rejects(fetch(`${API}/lego/colors/`, { method: 'POST', body: '{}' }), /No fake route/);
  await assert.rejects(fetch('https://elsewhere.invalid/api/v3/lego/colors/'), /No fake route/);
});

test('records every request, including ones it refuses', async () => {
  const fetch = createFakeFetch({ 'GET /lego/colors/': { body: {} } });
  await fetch(`${API}/lego/colors/`, { headers: { Authorization: 'key sentinel' } });
  await assert.rejects(fetch(`${API}/lego/themes/`));
  assert.deepEqual(
    fetch.requests.map(({ method, url }) => [method, url]),
    [
      ['GET', `${API}/lego/colors/`],
      ['GET', `${API}/lego/themes/`],
    ],
  );
  assert.equal(fetch.requests[0].headers.authorization, 'key sentinel');
});

test('a fixture name cannot point outside the fixtures folder', async () => {
  const fetch = createFakeFetch({ 'GET /lego/colors/': '../../package' });
  await assert.rejects(fetch(`${API}/lego/colors/`), /Not a fixture name/);
});
