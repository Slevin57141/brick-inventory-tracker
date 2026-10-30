import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ERRORS, createError } from '../src/errors.js';

// The table in docs/plan.md section 7.
const EXPECTED = {
  invalid_set_number: 400,
  invalid_key_format: 400,
  key_invalid: 400,
  key_required: 409,
  set_not_found: 404,
  not_owned: 404,
  rate_limited: 429,
  api_unavailable: 502,
  bad_request: 400,
  forbidden: 403,
  payload_too_large: 413,
  not_found: 404,
  data_file_invalid: 500,
  internal_error: 500,
};

test('the codes are exactly those in the plan, with their statuses', () => {
  assert.deepEqual(Object.keys(ERRORS).sort(), Object.keys(EXPECTED).sort());
  for (const [code, status] of Object.entries(EXPECTED)) {
    assert.equal(ERRORS[code].status, status, code);
  }
});

test('createError gives an AppError with the fixed message and status', () => {
  for (const code of Object.keys(EXPECTED)) {
    const error = createError(code);
    assert.ok(error instanceof AppError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'AppError');
    assert.equal(error.code, code);
    assert.equal(error.status, ERRORS[code].status);
    assert.equal(error.message, ERRORS[code].message);
    assert.equal(error.cause, undefined);
  }
});

test('an unknown code is a programming error', () => {
  assert.throws(() => createError('no_such_code'), TypeError);
  assert.throws(() => createError('toString'), TypeError);
  assert.throws(() => createError(undefined), TypeError);
});

test('the table cannot be changed at run time', () => {
  assert.ok(Object.isFrozen(ERRORS));
  assert.ok(Object.isFrozen(ERRORS.key_invalid));
});
