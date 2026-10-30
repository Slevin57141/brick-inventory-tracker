import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
// `npm test` loads the guard already; importing it here keeps this file safe on its own.
import './setup/no-network.js';

test('a fetch to another host is refused', async () => {
  // .invalid never resolves, so even a broken guard could not reach a real server.
  await assert.rejects(fetch('https://example.invalid/'), /Network access is blocked in tests/);
  await assert.rejects(
    fetch(new Request('https://example.invalid/api')),
    /Network access is blocked in tests/,
  );
});

test('a fetch to 127.0.0.1 still works', async (t) => {
  const server = createServer((request, response) => response.end('ok'));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await response.text(), 'ok');
});
