import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERRORS } from '../src/errors.js';
import { send } from './helpers/http-client.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));

/**
 * Runs src/main.js with the given environment. `exited` resolves with the exit code and all
 * output; `waitFor(pattern)` resolves with the first match in the output so far, or rejects
 * if the process exits first.
 */
function run(env) {
  const child = spawn(process.execPath, [MAIN], { env: { ...process.env, ...env } });
  let output = '';
  const waiting = [];
  const collect = (chunk) => {
    output += chunk;
    for (const waiter of waiting) {
      const match = waiter.pattern.exec(output);
      if (match) waiter.resolve(match);
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, output })));
  const waitFor = (pattern) => new Promise((resolve, reject) => {
    waiting.push({ pattern, resolve });
    exited.then(() => reject(new Error(`exited before ${pattern}: ${output}`)));
  });
  return { child, exited, waitFor };
}

async function withFolder(t) {
  const folder = await mkdtemp(join(tmpdir(), 'brick-main-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('npm start serves on 127.0.0.1 and logs the address', async (t) => {
  const folder = await withFolder(t);
  const { child, exited, waitFor } = run({ PORT: '0', DATA_FILE: join(folder, 'inventory.json') });
  t.after(() => child.kill());

  const [, portText] = await waitFor(/running at http:\/\/127\.0\.0\.1:(\d+)/);
  const port = Number(portText);
  const status = await send(port, 'GET', '/api/status');
  assert.deepEqual(status.json, { hasKey: false });
  assert.equal((await send(port, 'GET', '/container.html')).status, 200);
  child.kill();
  await exited;
});

test('a damaged data file stops the start with the fixed message, unchanged', async (t) => {
  const folder = await withFolder(t);
  const dataFile = join(folder, 'inventory.json');
  await writeFile(dataFile, '{"version": 1, "sets": ');
  const { code, output } = await run({ PORT: '0', DATA_FILE: dataFile }).exited;
  assert.equal(code, 1);
  assert.equal(output.trim(), ERRORS.data_file_invalid.message);
  assert.equal(await readFile(dataFile, 'utf8'), '{"version": 1, "sets": ');
});

test('a PORT that is not a port number stops the start', async (t) => {
  const folder = await withFolder(t);
  for (const port of ['abc', '-1', '70000', '3000.5']) {
    const { code, output } = await run({ PORT: port, DATA_FILE: join(folder, 'x.json') }).exited;
    assert.equal(code, 1, port);
    assert.match(output, /PORT must be a whole number/);
  }
});

test('a port already in use stops the start with a clear message', async (t) => {
  const folder = await withFolder(t);
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const { port } = blocker.address();
  const { code, output } = await run({
    PORT: String(port), DATA_FILE: join(folder, 'inventory.json'),
  }).exited;
  assert.equal(code, 1);
  assert.match(output, new RegExp(`Port ${port} is already in use`));
});
