// M10's api.js with an injected fetch: the path, method and body of every route in section 7,
// what each function returns, and how errors are read (docs/plan.md M10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../public/js/api.js';

const SET = { setNum: '10270-1', name: 'Bookshop', year: 2020, imgUrl: null, numParts: 2504,
  copies: 1, containedSets: [] };
const ROW = { partNum: '3001', name: 'Brick 2 x 4', categoryId: 11, categoryName: 'Bricks',
  colorId: 4, colorName: 'Red', colorRgb: 'C91A09', colorIsTrans: false, imgUrl: null,
  quantity: 6 };

/** A fetch that records each call and answers with the next of `answers`. */
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (path, init = {}) => {
    calls.push({ path, method: init.method, headers: init.headers ?? {}, body: init.body });
    const answer = answers.shift();
    if (answer instanceof Error) {
      throw answer;
    }
    const { status = 200, body } = answer;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

test('each function calls its route and returns the data it carries', async () => {
  const cases = [
    ['getStatus', [], { hasKey: false }, 'GET', '/api/status', undefined, { hasKey: false }],
    ['setKey', ['the-key-123'], { hasKey: true }, 'PUT', '/api/key', { key: 'the-key-123' },
      { hasKey: true }],
    ['forgetKey', [], { hasKey: false }, 'DELETE', '/api/key', undefined, { hasKey: false }],
    ['listSets', [], { sets: [SET] }, 'GET', '/api/sets', undefined, [SET]],
    ['addSet', ['10270'], { set: SET }, 'POST', '/api/sets', { setNumber: '10270' }, SET],
    ['removeSet', ['10270-1'], { set: SET }, 'DELETE', '/api/sets/10270-1', undefined, SET],
    ['removeSet', ['10270-1'], { set: null }, 'DELETE', '/api/sets/10270-1', undefined, null],
    ['getInventory', [], { rows: [ROW] }, 'GET', '/api/inventory', undefined, [ROW]],
    ['getSet', ['10270-1'], { set: SET, rows: [ROW] }, 'GET', '/api/sets/10270-1', undefined,
      { set: SET, rows: [ROW] }],
  ];
  for (const [name, args, answer, method, path, body, result] of cases) {
    const { fetch, calls } = fakeFetch({ body: answer });
    assert.deepEqual(await createApi({ fetch })[name](...args), result, name);
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.method, method, name);
    assert.equal(call.path, path, name);
    if (body === undefined) {
      assert.equal(call.body, undefined, `${name} sends no body`);
      assert.equal(call.headers['Content-Type'], undefined, `${name} sends no content type`);
    } else {
      assert.deepEqual(JSON.parse(call.body), body, name);
      assert.equal(call.headers['Content-Type'], 'application/json', name);
    }
  }
});

test('a set number is percent-encoded into the path', async () => {
  const { fetch, calls } = fakeFetch({ body: { set: null } });
  await createApi({ fetch }).removeSet('Ab C/1?x#');
  assert.equal(calls[0].path, '/api/sets/Ab%20C%2F1%3Fx%23');
});

test('the key goes only into the body of PUT /api/key', async () => {
  const key = 'Key"With\\Odd+/%=chars';
  const { fetch, calls } = fakeFetch({ body: { hasKey: true } });
  await createApi({ fetch }).setKey(key);
  for (const spelling of [key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)]) {
    assert.ok(!calls[0].path.includes(spelling), 'the key is in the path');
    assert.ok(!JSON.stringify(calls[0].headers).includes(spelling), 'the key is in a header');
  }
  assert.equal(JSON.parse(calls[0].body).key, key);
});

test('an error response is thrown as its code and fixed message', async () => {
  const message = 'Rebrickable has no set with that number.';
  const { fetch } = fakeFetch({ status: 404, body: { error: { code: 'set_not_found', message } } });
  await assert.rejects(createApi({ fetch }).addSet('99999999'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.ok(error instanceof Error);
    assert.equal(error.code, 'set_not_found');
    assert.equal(error.message, message);
    return true;
  });
});

test('an answer that is not the expected JSON is internal_error', async () => {
  const unexpected = { code: 'internal_error',
    message: 'Something went wrong. See the server log.' };
  const answers = [
    { status: 500, body: '<html>not json</html>' },
    { status: 502, body: { error: 'no code' } },
    { status: 200, body: 'not json' },
    { status: 200, body: { sets: 'not a list' } },
    { status: 200, body: { hasKey: 'yes' } },
    { status: 200, body: { set: SET } },
  ];
  const calls = [(api) => api.listSets(), (api) => api.listSets(), (api) => api.listSets(),
    (api) => api.listSets(), (api) => api.getStatus(), (api) => api.getSet('10270-1')];
  for (const [index, answer] of answers.entries()) {
    const { fetch } = fakeFetch(answer);
    await assert.rejects(calls[index](createApi({ fetch })), (error) => {
      assert.deepEqual({ code: error.code, message: error.message }, unexpected, `case ${index}`);
      return true;
    });
  }
});

test('a server that cannot be reached is server_unreachable', async () => {
  const { fetch } = fakeFetch(new TypeError('Failed to fetch'));
  await assert.rejects(createApi({ fetch }).getStatus(), (error) => {
    assert.equal(error.code, 'server_unreachable');
    assert.equal(error.message,
      'The app could not reach its server. Check that it is still running.');
    assert.ok(!error.message.includes('Failed to fetch'), 'the browser error is not shown');
    return true;
  });
});
