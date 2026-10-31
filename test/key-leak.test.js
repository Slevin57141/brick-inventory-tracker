// The key-leak test (docs/plan.md M8, R16): the real key store, client, importer, collection
// and server, with a fake Rebrickable that answers 200, 401, 404, 429, 500, malformed JSON
// and a network error. The sentinel key may appear only in Authorization headers sent to
// Rebrickable: never in a log line, an HTTP response, the data file, a fixture or a URL.
// A new place where the key could surface gets a new assertion here (AGENTS.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCollection } from '../src/collection.js';
import { ERRORS } from '../src/errors.js';
import { createKeyStore } from '../src/key-store.js';
import { createLogger } from '../src/logger.js';
import { createRebrickableClient } from '../src/rebrickable-client.js';
import { createServer, listen } from '../src/server.js';
import { createSetImporter } from '../src/set-importer.js';
import { createStorage } from '../src/storage.js';
import { createFakeFetch } from './helpers/fake-fetch.js';
import { send } from './helpers/http-client.js';

// Characters that look different inside JSON (" and \) and in a URL (+ / % =), so every
// spelling of the key is searched for.
const SENTINEL = 'Sentinel"Key\\+/%=leak-0123456789';
const SPELLINGS = [SENTINEL, JSON.stringify(SENTINEL).slice(1, -1), encodeURIComponent(SENTINEL)];
const FIXTURES = new URL('./fixtures/rebrickable/', import.meta.url);

const contains = (text) => SPELLINGS.some((spelling) => String(text).includes(spelling));
const set = (setNum, answer) => ({ [`GET /lego/sets/${setNum}/`]: answer });

test('the API key never leaves the Authorization header', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'brick-key-leak-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const dataFile = join(folder, 'inventory.json');

  const fetch = createFakeFetch({
    'GET /lego/colors/?page_size=1': ['key-check-valid', 'key-check-invalid', 'key-check-valid'],
    ...set('31146-1', 'set-31146-1'),
    'GET /lego/sets/31146-1/parts/?inc_minifig_parts=1&page_size=1000': 'set-31146-1-parts-page1',
    'GET /lego/sets/31146-1/sets/?page_size=1000': 'set-31146-1-sets',
    'GET /lego/part_categories/?page_size=1000': 'part-categories',
    ...set('42161-1', { status: 401, body: { detail: 'Invalid token.' } }),
    ...set('99999999-1', 'set-99999999-1'),
    ...set('76906-1', ['handmade-throttled', 'handmade-throttled', 'handmade-throttled']),
    ...set('76991-1', 'handmade-server-error'),
    ...set('75037-1', 'handmade-malformed-json'),
    ...set('75038-1', 'handmade-network-error'),
  });

  const keyStore = createKeyStore();
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line), redact: keyStore.redact });
  const client = createRebrickableClient({
    keyStore, fetch, minIntervalMs: 0, sleep: async () => {}, timeoutMs: 2000,
  });
  const collection = createCollection({
    storage: createStorage({ filePath: dataFile }),
    importer: createSetImporter({ client }),
  });
  await collection.init();
  // The real collection, except that the inventory route fails with the key in its message,
  // to check that an unexpected error is redacted in the log and absent from the response.
  const failing = {
    addSet: (input) => collection.addSet(input),
    removeSet: (setNum) => collection.removeSet(setNum),
    listSets: () => collection.listSets(),
    getInventory: () => {
      throw new Error(`unexpected failure with ${SENTINEL} in it`);
    },
  };
  const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
  const server = createServer({
    collection: failing, keyStore, client, logger, publicDir, port: 0,
  });
  const { port } = await listen(server, 0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const responses = [];
  const call = async (method, path, value) => {
    const response = await send(port, method, path, {
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    responses.push({ method, path, ...response });
    return response;
  };
  const code = (response) => response.json?.error?.code;

  // A good key, then sets that answer 200, 404, 429, 500, malformed JSON and no connection.
  assert.equal((await call('PUT', '/api/key', { key: SENTINEL })).status, 200);
  assert.equal((await call('GET', '/api/status')).json.hasKey, true);
  assert.equal((await call('POST', '/api/sets', { setNumber: '31146' })).status, 200);
  assert.equal(code(await call('POST', '/api/sets', { setNumber: '99999999' })), 'set_not_found');
  assert.equal(code(await call('POST', '/api/sets', { setNumber: '76906' })), 'rate_limited');
  assert.equal(code(await call('POST', '/api/sets', { setNumber: '76991' })), 'api_unavailable');
  assert.equal(code(await call('POST', '/api/sets', { setNumber: '75037' })), 'api_unavailable');
  assert.equal(code(await call('POST', '/api/sets', { setNumber: '75038' })), 'api_unavailable');
  assert.equal(code(await call('GET', '/api/inventory')), 'internal_error');
  await call('GET', '/api/sets');
  await call('DELETE', '/api/sets/31146-1');
  await call('POST', '/api/sets', { setNumber: '31146' });

  // A 401 while adding: the key is forgotten (R18). Then a key Rebrickable rejects at once.
  assert.equal(code(await call('POST', '/api/sets', { setNumber: '42161' })), 'key_invalid');
  assert.equal((await call('GET', '/api/status')).json.hasKey, false);
  assert.equal(code(await call('PUT', '/api/key', { key: SENTINEL })), 'key_invalid');
  assert.equal((await call('PUT', '/api/key', { key: SENTINEL })).status, 200);
  assert.equal(code(await call('PUT', '/api/key', { key: `${SENTINEL} space` })),
    'invalid_key_format');
  await call('DELETE', '/api/key');
  await call('GET', '/api/status');
  await call('GET', '/container.html');

  // Responses: status, every header, body. An error carries exactly its fixed message, so
  // nothing from a caught exception reaches the browser, redacted or not.
  for (const response of responses) {
    const text = `${response.status} ${JSON.stringify(response.headers)} ${response.text}`;
    assert.ok(!contains(text), `${response.method} ${response.path} shows the key`);
    if (response.json?.error) {
      const { code: errorCode, message } = response.json.error;
      const fixed = { error: { code: errorCode, message: ERRORS[errorCode].message } };
      assert.deepEqual(response.json, fixed,
        `${response.method} ${response.path} has more than the fixed error`);
    }
  }
  // Log lines, including the unexpected error, whose stack had the key.
  assert.ok(lines.some((line) => line.includes(' ERROR internal error')));
  assert.ok(lines.some((line) => line.includes('[redacted]')), 'the error was redacted');
  for (const line of lines) {
    assert.ok(!contains(line), `log line shows the key: ${line.slice(0, 120)}`);
  }
  // The data file and every fixture.
  assert.ok(!contains(await readFile(dataFile, 'utf8')), 'the data file holds the key');
  for (const name of await readdir(FIXTURES)) {
    assert.ok(!contains(await readFile(new URL(name, FIXTURES), 'utf8')), name);
  }
  // Requests to Rebrickable: the key only in Authorization, never in a URL.
  assert.ok(fetch.requests.length > 10);
  for (const request of fetch.requests) {
    assert.ok(!contains(request.url), `a request URL holds the key: ${request.url}`);
    for (const [name, value] of Object.entries(request.headers)) {
      if (name === 'authorization') {
        assert.equal(value, `key ${SENTINEL}`);
      } else {
        assert.ok(!contains(value), `request header ${name} holds the key`);
      }
    }
  }
});
