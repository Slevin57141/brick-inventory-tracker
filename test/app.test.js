import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as inventoryView from '../public/js/inventory-view.js';

// Only the DOM surface used by these workflows. Execute the page itself so the tests
// cover its event handlers and async lifetimes without adding a browser dependency.
class Element {
  value = '';
  disabled = false;
  open = false;
  listeners = new Map();
  classList = { toggle() {} };

  addEventListener(name, callback, options) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push({ callback, once: options?.once });
    this.listeners.set(name, listeners);
  }

  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) ?? [])
      .filter((item) => item.callback !== callback));
  }

  async dispatch(name) {
    for (const item of [...(this.listeners.get(name) ?? [])]) {
      if (item.once) this.removeEventListener(name, item.callback);
      await item.callback({ preventDefault() {} });
    }
  }

  closest() { return new Element(); }
  querySelectorAll() { return []; }
  replaceChildren() {}
  append() {}
  setAttribute() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; return this.dispatch('close'); }
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function page(overrides = {}) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const api = {
    getStatus: async () => ({ hasKey: false }),
    listSets: async () => [],
    getInventory: async () => [],
    ...overrides,
  };
  const context = createContext({
    ...inventoryView, createApi: () => api, setTimeout, clearTimeout, Option: Element,
    document: {
      getElementById: get,
      createElement: () => new Element(),
      createDocumentFragment: () => new Element(),
    },
  });
  const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  runInContext(`${source}\nglobalThis.workflows = { askForKey };`, context);
  await nextTurn(); // the initial refresh
  return { get, ...context.workflows };
}

test('retrying after a refresh failure adds only the sets still outstanding', async () => {
  const saved = [];
  let refreshes = 0;
  const { get } = await page({
    getStatus: async () => {
      if (++refreshes === 2) throw new Error('Refresh failed');
      return { hasKey: false };
    },
    addSet: async (setNum) => {
      saved.push(setNum);
      return { setNum, name: 'Example', copies: 1 };
    },
  });
  get('set-number').value = '10270 31146';
  await get('add-form').dispatch('submit');
  assert.deepEqual(saved, ['10270']);
  assert.equal(get('set-number').value, '31146');
  assert.equal(get('add-button').disabled, false);
  assert.equal(get('set-number').readOnly, false);
  await get('add-form').dispatch('submit');
  assert.deepEqual(saved, ['10270', '31146']);
  assert.equal(get('set-number').value, '');
});

for (const outcome of ['success', 'failure']) {
  test(`a cancelled key check's late ${outcome} cannot affect the new dialog`, async () => {
    const oldCheck = deferred();
    const newCheck = deferred();
    let checks = 0;
    const { get, askForKey } = await page({
      setKey: () => (++checks === 1 ? oldCheck.promise : newCheck.promise),
    });
    const cancelled = askForKey('First attempt');
    const oldSubmit = get('key-form').dispatch('submit');
    assert.equal(get('key-save').disabled, true);
    await get('key-dialog').close();
    assert.equal(await cancelled, false);

    const current = askForKey('New attempt');
    assert.equal(get('key-save').disabled, false);
    const newSubmit = get('key-form').dispatch('submit');
    const message = get('key-message').textContent;
    if (outcome === 'success') oldCheck.resolve({ hasKey: true });
    else oldCheck.reject(new Error('Old failure'));
    await oldSubmit;
    assert.equal(get('key-dialog').open, true);
    assert.equal(get('key-message').textContent, message);
    assert.equal(get('key-save').disabled, true);
    assert.equal(get('key-status').textContent, 'No API key');

    newCheck.resolve({ hasKey: true });
    await newSubmit;
    assert.equal(await current, true);
    assert.equal(get('key-dialog').open, false);
    assert.equal(get('key-status').textContent, 'API key set');
  });
}
