// Captures real Rebrickable responses as test fixtures (docs/plan.md, M0 and section 10).
// Run by the user only, never by an agent or a test:
//
//   npm run capture-fixtures -- [--page-size N] <setNum> [<setNum> ...]
//   npm run capture-fixtures -- --themes
//
// The second form captures only the list of themes, leaving every other fixture as it is.
// Set numbers include the variant, for example 10270-1. The script asks for the API key
// without showing it, sends the key only in the Authorization header, waits more than a
// second between requests (the API allows about one per second), and writes one file per
// response to test/fixtures/rebrickable/. If the key appears anywhere in what would be
// written, nothing is written.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const BASE_URL = 'https://rebrickable.com/api/v3';
const FIXTURES_DIR = new URL('../test/fixtures/rebrickable/', import.meta.url);
const REQUEST_GAP_MS = 1100;
const DEFAULT_PAGE_SIZE = 1000;
// Only these response headers are saved. Anything else, cookies above all, stays out of a
// public repository.
const KEPT_HEADERS = ['content-type', 'retry-after'];
// Sent once to capture the response to a wrong key (status 401).
const MADE_UP_KEY = 'not-a-real-key-000000000000000000';
const SET_NUMBER = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d+$/;

/** Names of the outputs whose text contains the key. An empty key matches nothing. */
export function findKeyLeaks(outputs, key) {
  if (!key) {
    return [];
  }
  return outputs.filter((output) => output.text.includes(key)).map((output) => output.name);
}

export class CaptureError extends Error {}

const USAGE = 'Usage: npm run capture-fixtures -- [--page-size N] <setNum> [<setNum> ...]\n'
  + '   or: npm run capture-fixtures -- --themes';

/** The options on the command line, or throws a CaptureError that explains the usage. */
export function parseCommandLine(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { 'page-size': { type: 'string' }, themes: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (values.themes) {
    if (positionals.length > 0 || values['page-size'] !== undefined) {
      throw new CaptureError(`--themes captures the themes only and takes nothing else.\n${USAGE}`);
    }
    return { themesOnly: true, pageSize: DEFAULT_PAGE_SIZE, setNums: [] };
  }
  const pageSize = Number(values['page-size'] ?? DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new CaptureError('--page-size must be a whole number from 1 to 1000.');
  }
  if (positionals.length === 0) {
    throw new CaptureError(USAGE);
  }
  for (const setNum of positionals) {
    if (setNum.length > 40 || !SET_NUMBER.test(setNum)) {
      throw new CaptureError(`Not a full set number (expected something like 10270-1): ${setNum}`);
    }
  }
  return { themesOnly: false, pageSize, setNums: positionals };
}

async function readHiddenLine(prompt) {
  process.stdout.write(prompt);
  const { stdin } = process;
  stdin.setEncoding('utf8');

  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) {
      data += chunk;
      if (data.includes('\n')) break;
    }
    return data.split(/\r?\n/)[0];
  }

  return new Promise((resolveLine, reject) => {
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolveLine(value);
          return;
        }
        if (char === '\u0003') {
          finish();
          reject(new CaptureError('Cancelled.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.resume();
  });
}

function routeOf(url) {
  const params = new URLSearchParams(url.search);
  params.sort();
  const query = params.toString();
  const path = url.pathname.slice(new URL(BASE_URL).pathname.length);
  return `${path}${query ? `?${query}` : ''}`;
}

function createCapturer(key) {
  const base = new URL(BASE_URL);
  let lastRequestAt = 0;

  return async function capture(url, { useKey = key } = {}) {
    const target = new URL(url);
    if (target.origin !== base.origin) {
      throw new CaptureError(`Refusing to follow a link to another site: ${target.origin}`);
    }
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) {
      await new Promise((done) => setTimeout(done, wait));
    }
    lastRequestAt = Date.now();

    const response = await fetch(target, {
      headers: { Authorization: `key ${useKey}`, Accept: 'application/json' },
    });
    if (response.status === 429) {
      throw new CaptureError(
        'Rebrickable is throttling requests. Wait a minute and run the script again.',
      );
    }

    const text = await response.text();
    const headers = {};
    for (const name of KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    const fixture = { request: `GET ${routeOf(target)}`, status: response.status, headers };
    try {
      fixture.body = JSON.parse(text);
    } catch {
      fixture.rawBody = text;
    }
    return fixture;
  };
}

async function captureAll({ key, setNums, pageSize, themesOnly }) {
  const capture = createCapturer(key);
  const outputs = [];
  const save = (name, fixture) => {
    outputs.push({ name, fixture });
    console.log(`  ${fixture.status}  ${fixture.request}`);
  };

  console.log('Capturing (about one request per second):');
  const keyCheck = await capture(`${BASE_URL}/lego/colors/?page_size=1`);
  if (keyCheck.status === 401 || keyCheck.status === 403) {
    throw new CaptureError('Rebrickable rejected that key.');
  }
  const themes = () => capture(`${BASE_URL}/lego/themes/?page_size=${DEFAULT_PAGE_SIZE}`);
  if (themesOnly) {
    save('themes', await themes());
    return outputs;
  }
  save('key-check-valid', keyCheck);
  save(
    'key-check-invalid',
    await capture(`${BASE_URL}/lego/colors/?page_size=1`, { useKey: MADE_UP_KEY }),
  );
  save(
    'part-categories',
    await capture(`${BASE_URL}/lego/part_categories/?page_size=${DEFAULT_PAGE_SIZE}`),
  );
  save('themes', await themes());

  const sizeSuffix = pageSize === DEFAULT_PAGE_SIZE ? '' : `-size${pageSize}`;
  for (const setNum of setNums) {
    const setPath = `${BASE_URL}/lego/sets/${encodeURIComponent(setNum)}`;
    const details = await capture(`${setPath}/`);
    save(`set-${setNum}`, details);
    if (details.status !== 200) {
      continue;
    }

    let next = `${setPath}/parts/?inc_minifig_parts=1&page_size=${pageSize}`;
    for (let page = 1; next; page += 1) {
      const parts = await capture(next);
      save(`set-${setNum}-parts${sizeSuffix}-page${page}`, parts);
      next = parts.status === 200 ? parts.body?.next : null;
    }
    save(`set-${setNum}-sets`, await capture(`${setPath}/sets/?page_size=${DEFAULT_PAGE_SIZE}`));
    save(
      `set-${setNum}-minifigs`,
      await capture(`${setPath}/minifigs/?page_size=${DEFAULT_PAGE_SIZE}`),
    );
  }
  return outputs;
}

async function main(argv) {
  const options = parseCommandLine(argv);
  const key = (await readHiddenLine('Rebrickable API key (not shown): ')).trim();
  if (!key) {
    throw new CaptureError('No key entered.');
  }

  const outputs = (await captureAll({ key, ...options })).map(({ name, fixture }) => ({
    name,
    text: `${JSON.stringify(fixture, null, 2)}\n`,
  }));
  const leaks = findKeyLeaks(outputs, key);
  if (leaks.length > 0) {
    throw new CaptureError(`The key appears in ${leaks.join(', ')}. Nothing was written.`);
  }

  await mkdir(FIXTURES_DIR, { recursive: true });
  for (const { name, text } of outputs) {
    await writeFile(new URL(`${name}.json`, FIXTURES_DIR), text);
  }
  console.log(`Wrote ${outputs.length} fixtures to test/fixtures/rebrickable/.`);
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();

if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    // Our own messages never contain the key, and fetch's network errors do not carry headers.
    console.error(error instanceof CaptureError ? error.message : `Failed: ${error.message}`);
    console.error('Nothing was written.');
    process.exitCode = 1;
  });
}
