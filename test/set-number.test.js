import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ERRORS } from '../src/errors.js';
import { normalizeSetNumber } from '../src/set-number.js';

test('normalizes valid set numbers, preserving case and explicit variants', () => {
  const examples = [
    ['10270', '10270-1'],
    ['10270-1', '10270-1'],
    [' 10270-1 ', '10270-1'],
    ['10270-2', '10270-2'],
    ['\t10270\n', '10270-1'],
    ['A', 'A-1'],
    ['0', '0-1'],
    ['AbC', 'AbC-1'],
    ['AbC-def', 'AbC-def-1'],
    ['AbC-def-02', 'AbC-def-02'],
    ['a'.repeat(40), `${'a'.repeat(40)}-1`],
    [`${'a'.repeat(38)}-2`, `${'a'.repeat(38)}-2`],
    [` ${'a'.repeat(40)} `, `${'a'.repeat(40)}-1`],
  ];

  for (const [input, expected] of examples) {
    assert.equal(normalizeSetNumber(input), expected, input);
  }
});

test('rejects invalid strings with the fixed invalid_set_number error', () => {
  const examples = [
    '', '   ', '10270-', '-1', '102 70', '10270/1', '../x', '10270--1',
    'a'.repeat(41), `${'a'.repeat(39)}-2`, 'a_b', 'a.b', 'a\nb', 'a\u0000b',
    'a?b', 'a#b', 'a%b', '\u00e9', '10270\u20101',
  ];

  for (const input of examples) {
    assert.throws(() => normalizeSetNumber(input), isInvalidSetNumber);
  }
});

test('rejects non-strings without coercing them', () => {
  const examples = [
    undefined, null, 10270, NaN, true, 10270n, Symbol('set'), [], ['10270'],
    new String('10270'), { toString() { throw new Error('Must not coerce input'); } },
  ];

  for (const input of examples) {
    assert.throws(() => normalizeSetNumber(input), isInvalidSetNumber);
  }
});

function isInvalidSetNumber(error) {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'invalid_set_number');
  assert.equal(error.status, ERRORS.invalid_set_number.status);
  assert.equal(error.message, ERRORS.invalid_set_number.message);
  assert.equal(error.cause, undefined);
  return true;
}
