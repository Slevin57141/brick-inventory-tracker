// Loaded before every test file by `npm test`. Tests must never reach a real service, so a
// fetch to anything other than this machine fails loudly instead of quietly going out.

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const GUARD = Symbol.for('brick-inventory-tracker.no-network');

// A test file may import this module as well; the marker keeps fetch from being wrapped twice.
if (!globalThis.fetch[GUARD]) {
  const realFetch = globalThis.fetch;

  const guardedFetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!LOCAL_HOSTS.has(url.hostname)) {
      throw new Error(`Network access is blocked in tests (${url.origin}).`);
    }
    return realFetch(input, init);
  };

  guardedFetch[GUARD] = true;
  globalThis.fetch = guardedFetch;
}
