import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { Writable } from 'node:stream';
import util from 'node:util';
import { AppError, ERRORS } from '../src/errors.js';
import { createKeyStore, normalizeKey } from '../src/key-store.js';

const SENTINEL = 'SENTINEL-key-0123456789abcdef';

function isInvalidKeyFormat(error) {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'invalid_key_format');
  assert.equal(error.message, ERRORS.invalid_key_format.message);
  assert.equal(error.cause, undefined);
  return true;
}

test('set, has, get and clear', () => {
  const store = createKeyStore();
  assert.equal(store.has(), false);
  assert.equal(store.get(), null);

  store.set(`  ${SENTINEL}\n`);
  assert.equal(store.has(), true);
  assert.equal(store.get(), SENTINEL);

  store.set('another-key-1234');
  assert.equal(store.get(), 'another-key-1234');

  store.clear();
  assert.equal(store.has(), false);
  assert.equal(store.get(), null);
});

test('accepts keys of 8 and 200 characters', () => {
  for (const key of ['k'.repeat(8), 'k'.repeat(200), 'a!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~']) {
    assert.equal(normalizeKey(key), key);
  }
});

test('rejects keys of the wrong format with invalid_key_format', () => {
  const rejected = [
    undefined, null, 12345678, ['12345678'], new String('12345678'), {},
    '', '        ', 'k'.repeat(7), 'k'.repeat(201), ` ${'k'.repeat(7)} `,
    'key with space', 'key\twith-tab', 'key\nwith-newline', 'key\u0000nul00', 'key\u007fdel00',
    'key\u0085next0', 'key nbsp00', 'key line00',
  ];
  for (const input of rejected) {
    assert.throws(() => normalizeKey(input), isInvalidKeyFormat, JSON.stringify(String(input)));
    assert.throws(() => createKeyStore().set(input), isInvalidKeyFormat);
  }
});

test('a rejected key leaves the current key in place', () => {
  const store = createKeyStore();
  store.set(SENTINEL);
  assert.throws(() => store.set('bad key'), isInvalidKeyFormat);
  assert.equal(store.get(), SENTINEL);
});

test('the error for a rejected key does not contain it', () => {
  const candidate = `${SENTINEL} with a space`;
  try {
    normalizeKey(candidate);
    assert.fail('expected a throw');
  } catch (error) {
    assert.ok(!util.inspect(error, { showHidden: true }).includes(SENTINEL));
    assert.ok(!JSON.stringify(error).includes(SENTINEL));
  }
});

test('redact without a key returns the text unchanged', () => {
  const store = createKeyStore();
  assert.equal(store.redact(`text with ${SENTINEL}`), `text with ${SENTINEL}`);
  assert.equal(store.redact(42), '42');
});

test('redact replaces every occurrence of the current key', () => {
  const store = createKeyStore();
  store.set(SENTINEL);
  assert.equal(
    store.redact(`${SENTINEL} and ${SENTINEL}${SENTINEL}.`),
    '[redacted] and [redacted][redacted].',
  );
  assert.equal(store.redact('nothing to hide'), 'nothing to hide');

  store.clear();
  assert.equal(store.redact(SENTINEL), SENTINEL);
});

test('redact treats the key literally and also replaces its JSON and URL spellings', () => {
  const key = 'k.*+?^${}()|[]"\\/%&=';
  const store = createKeyStore();
  store.set(key);
  const json = JSON.stringify({ key });
  const url = `https://example.invalid/?key=${encodeURIComponent(key)}`;

  for (const text of [`raw ${key} raw`, json, url]) {
    assert.ok(!store.redact(text).includes(key), text);
  }
  assert.equal(store.redact(json), '{"key":"[redacted]"}');
  assert.equal(store.redact(url), 'https://example.invalid/?key=[redacted]');
  assert.equal(store.redact('k.anything'), 'k.anything');
});

test('serializing, printing or inspecting the store never shows the key', () => {
  const store = createKeyStore();
  store.set(SENTINEL);

  let logged = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logged += chunk;
      done();
    },
  });
  new Console(sink).log(store);
  new Console(sink).log('%o %O %j', store, store, store);

  const outputs = [
    JSON.stringify(store),
    String(store),
    `${store}`,
    util.inspect(store, { showHidden: true, depth: null, getters: true }),
    util.format('%s %o %O %j', store, store, store, store),
    logged,
    JSON.stringify(Object.getOwnPropertyNames(store).map((name) => String(store[name]))),
  ];
  for (const output of outputs) {
    assert.ok(!output.includes(SENTINEL), output);
  }
});
