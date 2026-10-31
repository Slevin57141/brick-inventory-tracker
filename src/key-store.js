// Holds the Rebrickable API key in memory only (docs/plan.md M2, R15, R16). The key lives in a
// closure, never in a property, so serializing or inspecting the store cannot show it.

import { createError } from './errors.js';

const MIN_LENGTH = 8;
const MAX_LENGTH = 200;
const FORBIDDEN = /[\s\p{Cc}]/u;
const REDACTED = '[redacted]';

/** The trimmed key, or throws invalid_key_format. Never stores anything or calls the API. */
export function normalizeKey(input) {
  if (typeof input !== 'string') {
    throw createError('invalid_key_format');
  }
  const key = input.trim();
  if (key.length < MIN_LENGTH || key.length > MAX_LENGTH || FORBIDDEN.test(key)) {
    throw createError('invalid_key_format');
  }
  return key;
}

export function createKeyStore() {
  let key = null;

  return Object.freeze({
    set(input) {
      // Checked before assigning, so a rejected key leaves the current one in place.
      key = normalizeKey(input);
    },
    get() {
      return key;
    },
    has() {
      return key !== null;
    },
    clear() {
      key = null;
    },
    redact(text) {
      const result = String(text);
      if (key === null) {
        return result;
      }
      // A key with quotes, backslashes or URL-special characters looks different once it is
      // inside a JSON string or a URL, so those spellings are replaced too.
      const spellings = new Set([key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)]);
      let redacted = result;
      for (const spelling of spellings) {
        redacted = redacted.split(spelling).join(REDACTED);
      }
      return redacted;
    },
  });
}
