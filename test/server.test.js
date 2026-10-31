import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createError } from '../src/errors.js';
import { createKeyStore } from '../src/key-store.js';
import { createLogger } from '../src/logger.js';
import { createServer, listen } from '../src/server.js';
import { send } from './helpers/http-client.js';

const CSP = "default-src 'self'; img-src 'self' https://cdn.rebrickable.com; object-src 'none'; "
  + "base-uri 'none'; frame-ancestors 'none'";
const SET = { setNum: '10270-1', name: 'Bookshop', year: 2020, imgUrl: null, numParts: 2504,
  copies: 1, containedSets: [] };
const ROW = { partNum: '3001', name: 'Brick 2 x 4', categoryId: 11, categoryName: 'Bricks',
  colorId: 4, colorName: 'Red', colorRgb: 'C91A09', colorIsTrans: false, imgUrl: null,
  quantity: 6 };

/** A collection and client that record calls; each method can be replaced per test. */
function fakes() {
  const calls = [];
  const collection = {
    listSets: () => [SET],
    getInventory: () => [ROW],
    addSet: async (input) => {
      calls.push(['addSet', input]);
      return SET;
    },
    removeSet: async (setNum) => {
      calls.push(['removeSet', setNum]);
      return null;
    },
  };
  const client = {
    checkKey: async (key) => {
      calls.push(['checkKey', key]);
    },
  };
  return { calls, collection, client };
}

async function start(t, overrides = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'brick-server-'));
  const publicDir = join(folder, 'public');
  await mkdir(join(publicDir, 'js'), { recursive: true });
  await mkdir(join(publicDir, 'sub'), { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Home</title>');
  await writeFile(join(publicDir, 'styles.css'), 'body { margin: 0; }');
  await writeFile(join(publicDir, 'js', 'app.js'), 'export const app = 1;');
  await writeFile(join(publicDir, 'data.bin'), 'binary');
  await writeFile(join(folder, 'secret.txt'), 'SECRET-OUTSIDE-PUBLIC');

  const lines = [];
  const keyStore = overrides.keyStore ?? createKeyStore();
  const logger = createLogger({ write: (line) => lines.push(line), redact: keyStore.redact });
  const { calls, collection, client } = fakes();
  Object.assign(collection, overrides.collection);
  Object.assign(client, overrides.client);
  const server = createServer({ collection, keyStore, client, logger, publicDir, port: 0 });
  const address = await listen(server, 0);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const { port } = address;
  const origin = `http://127.0.0.1:${port}`;
  const json = (method, path, value, headers = {}) => send(port, method, path, {
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  return { address, port, origin, folder, publicDir, keyStore, calls, lines, server,
    get: (path, options) => send(port, 'GET', path, options), json };
}

const errorBody = (code, message) => ({ error: { code, message } });

/** A checkKey that waits until the test settles each call. */
function heldChecks() {
  const pending = [];
  const checkKey = (key) => new Promise((resolve, reject) => {
    pending.push({ key, resolve, reject });
  });
  return { pending, checkKey };
}

async function until(condition) {
  for (let i = 0; i < 500 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.ok(condition(), 'timed out waiting');
}

test('the server listens on 127.0.0.1 only', async (t) => {
  const { address } = await start(t);
  assert.equal(address.address, '127.0.0.1');
  assert.equal(address.family, 'IPv4');
});

test('status reports whether a key is set, and nothing more', async (t) => {
  const { get, keyStore } = await start(t);
  assert.deepEqual((await get('/api/status')).json, { hasKey: false });
  keyStore.set('stored-key-123456');
  const response = await get('/api/status');
  assert.deepEqual(response.json, { hasKey: true });
  assert.ok(!response.text.includes('stored-key-123456'));
});

test('PUT /api/key checks the format, then the key with Rebrickable, then stores it', async (t) => {
  const { json, calls, keyStore } = await start(t);
  const response = await json('PUT', '/api/key', { key: '  good-key-123456 ' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { hasKey: true });
  assert.deepEqual(calls, [['checkKey', 'good-key-123456']]);
  assert.equal(keyStore.get(), 'good-key-123456');

  for (const body of [{ key: 'short' }, { key: 'has space 12345' }, {}, { key: 12345678 }]) {
    const rejected = await json('PUT', '/api/key', body);
    assert.equal(rejected.status, 400, JSON.stringify(body));
    assert.equal(rejected.json.error.code, 'invalid_key_format');
  }
  assert.equal(calls.length, 1, 'a key of the wrong format never reaches Rebrickable');
});

test('a key Rebrickable rejects or cannot check is not stored', async (t) => {
  for (const [code, status] of [['key_invalid', 400], ['rate_limited', 429],
    ['api_unavailable', 502]]) {
    const { json, keyStore } = await start(t, {
      client: { checkKey: async () => { throw createError(code); } },
    });
    const response = await json('PUT', '/api/key', { key: 'candidate-key-1234' });
    assert.equal(response.status, status);
    assert.equal(response.json.error.code, code);
    assert.ok(!response.text.includes('candidate-key-1234'));
    assert.equal(keyStore.has(), false);
  }
});

test('DELETE /api/key forgets the key', async (t) => {
  const { json, keyStore } = await start(t);
  keyStore.set('stored-key-123456');
  const response = await json('DELETE', '/api/key');
  assert.deepEqual(response.json, { hasKey: false });
  assert.equal(keyStore.has(), false);
});

test('a Forget key sent while a key is being checked is not undone (R17)', async (t) => {
  const held = heldChecks();
  const { json, get, keyStore } = await start(t, { client: { checkKey: held.checkKey } });
  const put = json('PUT', '/api/key', { key: 'pending-key-12345' });
  await until(() => held.pending.length === 1);
  assert.deepEqual((await json('DELETE', '/api/key')).json, { hasKey: false });
  held.pending[0].resolve();
  const response = await put;
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { hasKey: false }, 'the dropped key is not reported as set');
  assert.deepEqual((await get('/api/status')).json, { hasKey: false });
  assert.equal(keyStore.has(), false);
});

test('overlapping key changes take effect in the order they arrived', async (t) => {
  // Each case starts PUT a, then PUT b, and settles their checks in the given order. The end
  // state is the one the two requests would give one after the other.
  const cases = [
    ['b finishes first', ['b', 'a'], { a: 'ok', b: 'ok' }, 'key-b-1234567'],
    ['a finishes first', ['a', 'b'], { a: 'ok', b: 'ok' }, 'key-b-1234567'],
    ['b is rejected', ['b', 'a'], { a: 'ok', b: 'key_invalid' }, 'key-a-1234567'],
  ];
  for (const [name, order, outcome, stored] of cases) {
    const held = heldChecks();
    const { json, keyStore } = await start(t, { client: { checkKey: held.checkKey } });
    const responses = {
      a: json('PUT', '/api/key', { key: 'key-a-1234567' }),
    };
    await until(() => held.pending.length === 1);
    responses.b = json('PUT', '/api/key', { key: 'key-b-1234567' });
    await until(() => held.pending.length === 2);
    const checks = { a: held.pending[0], b: held.pending[1] };
    for (const which of order) {
      if (outcome[which] === 'ok') {
        checks[which].resolve();
      } else {
        checks[which].reject(createError(outcome[which]));
      }
      await responses[which];
    }
    assert.equal(keyStore.get(), stored, name);
    for (const which of ['a', 'b']) {
      const response = await responses[which];
      if (outcome[which] === 'ok') {
        assert.deepEqual(response.json, { hasKey: true }, `${name}: ${which}`);
      } else {
        assert.equal(response.json.error.code, outcome[which], `${name}: ${which}`);
      }
    }
  }
});

test('the set and inventory routes pass through to the collection', async (t) => {
  const { get, json, calls } = await start(t);
  assert.deepEqual((await get('/api/sets')).json, { sets: [SET] });
  assert.deepEqual((await get('/api/inventory')).json, { rows: [ROW] });

  const added = await json('POST', '/api/sets', { setNumber: '10270' });
  assert.equal(added.status, 200);
  assert.deepEqual(added.json, { set: SET });

  const removed = await json('DELETE', '/api/sets/10270-1');
  assert.deepEqual(removed.json, { set: null });
  await json('DELETE', '/api/sets/AbC%2D1');
  assert.deepEqual(calls, [['addSet', '10270'], ['removeSet', '10270-1'], ['removeSet', 'AbC-1']]);
});

test('collection errors become their fixed error responses', async (t) => {
  const cases = [
    ['invalid_set_number', 400], ['key_required', 409], ['set_not_found', 404],
    ['rate_limited', 429], ['api_unavailable', 502],
  ];
  for (const [code, status] of cases) {
    const error = createError(code);
    const { json } = await start(t, { collection: { addSet: async () => { throw error; } } });
    const response = await json('POST', '/api/sets', { setNumber: '10270' });
    assert.equal(response.status, status);
    assert.deepEqual(response.json, errorBody(code, error.message));
  }
  const { json } = await start(t, {
    collection: { removeSet: async () => { throw createError('not_owned'); } },
  });
  assert.equal((await json('DELETE', '/api/sets/10270-1')).json.error.code, 'not_owned');
});

test('a key Rebrickable rejects while adding a set is forgotten (R18)', async (t) => {
  const { json, keyStore } = await start(t, {
    collection: { addSet: async () => { throw createError('key_invalid'); } },
  });
  keyStore.set('stored-key-123456');
  const response = await json('POST', '/api/sets', { setNumber: '10270' });
  assert.equal(response.json.error.code, 'key_invalid');
  assert.equal(keyStore.has(), false);
});

test('a rejection that ends after the key was replaced keeps the new key', async (t) => {
  let rejectAdd;
  const { json, keyStore } = await start(t, {
    collection: { addSet: () => new Promise((resolve, reject) => { rejectAdd = reject; }) },
  });
  keyStore.set('old-key-1234567');
  const add = json('POST', '/api/sets', { setNumber: '10270' });
  await until(() => rejectAdd !== undefined);
  assert.deepEqual((await json('PUT', '/api/key', { key: 'new-key-1234567' })).json,
    { hasKey: true });
  rejectAdd(createError('key_invalid'));
  assert.equal((await add).json.error.code, 'key_invalid');
  assert.equal(keyStore.get(), 'new-key-1234567');
});

test('bodies that are not a JSON object, or malformed paths, are bad requests', async (t) => {
  const { port, origin, json } = await start(t);
  for (const body of ['not json', '[1, 2]', 'null', '"text"']) {
    const response = await send(port, 'POST', '/api/sets', {
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.json.error.code, 'bad_request', body);
  }
  const missing = await json('PUT', '/api/key');
  assert.equal(missing.json.error.code, 'bad_request');
  assert.equal((await json('DELETE', '/api/sets/%E0%A4%A')).json.error.code, 'bad_request');
});

test('unknown API routes and methods are not found', async (t) => {
  const { get, json } = await start(t);
  for (const response of [await get('/api/nothing'), await get('/api'), await get('/api/key'),
    await json('PATCH', '/api/sets', {}), await json('POST', '/api/inventory', {}),
    await json('DELETE', '/api/sets'), await json('DELETE', '/api/sets/a/b')]) {
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, 'not_found');
  }
});

test('an unexpected error is internal_error; its details go to the log only', async (t) => {
  const { get, lines } = await start(t, {
    collection: { listSets: () => { throw new TypeError('database exploded at line 7'); } },
  });
  const response = await get('/api/sets');
  assert.equal(response.status, 500);
  assert.deepEqual(response.json,
    errorBody('internal_error', 'Something went wrong. See the server log.'));
  assert.ok(!response.text.includes('exploded'));
  const logged = lines.find((line) => line.includes(' ERROR internal error'));
  assert.ok(logged && logged.includes('TypeError') && logged.includes('database exploded'));
});

test('a request for another host is refused (DNS rebinding)', async (t) => {
  const { port, get } = await start(t);
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`,
    '127.0.0.1', `0.0.0.0:${port}`, `[::1]:${port}`]) {
    const response = await get('/api/status', { headers: { Host: host } });
    assert.equal(response.status, 403, host);
    assert.equal(response.json.error.code, 'forbidden');
  }
  // Node's client always adds a Host header, so a request without one goes over a socket.
  const raw = await new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.end('GET /api/status HTTP/1.0\r\n\r\n'));
    let text = '';
    socket.on('data', (chunk) => { text += chunk; });
    socket.on('end', () => resolve(text));
    socket.on('error', reject);
  });
  assert.match(raw, /^HTTP\/1\.[01] 403 /);
  assert.ok(!raw.includes('hasKey'));
  for (const host of [`localhost:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port}`]) {
    assert.equal((await get('/api/status', { headers: { Host: host } })).status, 200, host);
  }
});

test('changes need this server as Origin and a JSON body', async (t) => {
  const { port, origin, json, calls } = await start(t);
  const body = JSON.stringify({ setNumber: '10270' });
  const refused = [
    { 'Content-Type': 'application/json' },
    { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
    { Origin: 'null', 'Content-Type': 'application/json' },
    { Origin: `https://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    { Origin: `http://127.0.0.1:${port + 1}`, 'Content-Type': 'application/json' },
    { Origin: origin, 'Content-Type': 'text/plain' },
    { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    { Origin: origin },
  ];
  for (const headers of refused) {
    const response = await send(port, 'POST', '/api/sets', { headers, body });
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.json.error.code, 'forbidden');
  }
  assert.deepEqual(calls, []);
  assert.equal((await send(port, 'DELETE', '/api/key', { headers: {} })).status, 403);

  assert.equal((await json('POST', '/api/sets', { setNumber: '10270' },
    { 'Content-Type': 'application/json; charset=utf-8' })).status, 200);
  assert.equal((await json('POST', '/api/sets', { setNumber: '10270' },
    { Origin: `http://localhost:${port}` })).status, 200);
  const forget = await send(port, 'DELETE', '/api/key', { headers: { Origin: origin } });
  assert.equal(forget.status, 200);
});

test('bodies over 10 KB are refused', async (t) => {
  const { port, origin, json } = await start(t);
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const sized = (bytes) => {
    const base = JSON.stringify({ setNumber: '10270', pad: '' });
    return JSON.stringify({ setNumber: '10270', pad: 'x'.repeat(bytes - base.length) });
  };
  assert.equal(Buffer.byteLength(sized(10 * 1024)), 10 * 1024);
  assert.equal((await send(port, 'POST', '/api/sets', { headers, body: sized(10 * 1024) })).status,
    200);

  const declared = await send(port, 'POST', '/api/sets', { headers, body: sized(10 * 1024 + 1) });
  assert.equal(declared.status, 413);
  assert.equal(declared.json.error.code, 'payload_too_large');

  const chunked = await send(port, 'POST', '/api/sets', {
    headers, chunks: Array.from({ length: 12 }, () => 'x'.repeat(1024)),
  });
  assert.equal(chunked.status, 413);
  assert.equal((await json('POST', '/api/sets', { setNumber: '10270' })).status, 200,
    'the server still answers afterwards');
});

test('static files are served from public/ only', async (t) => {
  const { get, publicDir, folder } = await start(t);
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.equal(home.text, '<!doctype html><title>Home</title>');
  assert.equal((await get('/index.html')).text, home.text);

  const traversals = [
    '/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt',
    '/..%5csecret.txt', '/js/..%2f..%2fsecret.txt', '/js/%2e%2e/%2e%2e/secret.txt',
    '/%00index.html', '/index.html%00', `/${encodeURIComponent(join(folder, 'secret.txt'))}`,
    '/sub', '/sub/', '/js', '/missing.html', '/%E0%A4%A',
  ];
  for (const path of traversals) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.ok(!response.text.includes('SECRET-OUTSIDE-PUBLIC'), path);
  }

  try {
    await symlink(join(folder, 'secret.txt'), join(publicDir, 'link.txt'));
  } catch {
    return; // creating links needs extra rights on Windows; the check above still applies
  }
  const linked = await get('/link.txt');
  assert.equal(linked.status, 404);
  assert.ok(!linked.text.includes('SECRET-OUTSIDE-PUBLIC'));
});

test('files get a content type from their extension; .js is text/javascript', async (t) => {
  const { port, get } = await start(t);
  const types = {
    '/js/app.js': 'text/javascript; charset=utf-8',
    '/index.html': 'text/html; charset=utf-8',
    '/styles.css': 'text/css; charset=utf-8',
    '/data.bin': 'application/octet-stream',
  };
  for (const [path, type] of Object.entries(types)) {
    assert.equal((await get(path)).headers['content-type'], type, path);
  }
  const head = await send(port, 'HEAD', '/index.html');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
});

test('every response carries the security headers; API responses are not cached', async (t) => {
  const { port, get, json } = await start(t);
  const responses = {
    file: await get('/index.html'),
    missing: await get('/missing'),
    api: await get('/api/status'),
    apiError: await get('/api/nothing'),
    forbidden: await get('/api/status', { headers: { Host: 'evil.example' } }),
    change: await json('DELETE', '/api/key'),
    tooLarge: await send(port, 'POST', '/api/sets', {
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      body: 'x'.repeat(20 * 1024),
    }),
  };
  for (const [name, response] of Object.entries(responses)) {
    assert.equal(response.headers['x-content-type-options'], 'nosniff', name);
    assert.equal(response.headers['content-security-policy'], CSP, name);
  }
  for (const name of ['api', 'apiError', 'forbidden', 'change', 'tooLarge']) {
    assert.equal(responses[name].headers['cache-control'], 'no-store', name);
  }
  assert.equal(responses.file.headers['cache-control'], undefined);
});

test('one log line per request: method, path, status and time, never headers or bodies',
  async (t) => {
    const { json, lines } = await start(t);
    await json('POST', '/api/sets?token=QUERY-MARKER', { setNumber: 'BODY-MARKER' },
      { 'X-Custom': 'HEADER-MARKER' });
    assert.equal(lines.length, 1);
    const [, fields] = /^\S+ INFO request (.*)$/.exec(lines[0]);
    assert.deepEqual(Object.keys(JSON.parse(fields)), ['method', 'path', 'status', 'ms']);
    assert.deepEqual({ ...JSON.parse(fields), ms: 0 },
      { method: 'POST', path: '/api/sets', status: 200, ms: 0 });
    for (const marker of ['QUERY-MARKER', 'BODY-MARKER', 'HEADER-MARKER']) {
      assert.ok(!lines[0].includes(marker), marker);
    }
  });

test('the logger writes one redacted line per call', () => {
  const lines = [];
  const logger = createLogger({
    write: (line) => lines.push(line),
    redact: (text) => text.replaceAll('hidden-value', '[redacted]'),
    now: () => new Date('2026-10-31T12:00:00Z'),
  });
  logger.info('started', { port: 3000 });
  logger.error('failed hidden-value', { detail: 'also hidden-value' });
  logger.info('plain');
  assert.deepEqual(lines, [
    '2026-10-31T12:00:00.000Z INFO started {"port":3000}',
    '2026-10-31T12:00:00.000Z ERROR failed [redacted] {"detail":"also [redacted]"}',
    '2026-10-31T12:00:00.000Z INFO plain',
  ]);
});
