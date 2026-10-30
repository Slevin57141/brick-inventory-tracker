// Every error the app reports, with its HTTP status and fixed message (docs/plan.md section 7).
// The messages are fixed on purpose: nothing from an upstream response, a URL or a caught
// exception can reach the browser or a log line through an AppError.

const entries = {
  invalid_set_number: [400, 'That is not a valid set number. Use a number like 10270 or 10270-1.'],
  invalid_key_format: [400, 'That does not look like a Rebrickable API key.'],
  key_invalid: [400, 'Rebrickable rejected the API key.'],
  key_required: [409, 'A Rebrickable API key is needed to fetch a new set.'],
  set_not_found: [404, 'Rebrickable has no set with that number.'],
  not_owned: [404, 'That set is not in your collection.'],
  rate_limited: [429, 'Rebrickable is limiting requests. Try again in a minute.'],
  api_unavailable: [502, 'Rebrickable could not be reached or gave an unexpected answer.'],
  bad_request: [400, 'The request was not valid.'],
  forbidden: [403, 'Request refused.'],
  payload_too_large: [413, 'The request is too large.'],
  not_found: [404, 'Not found.'],
  data_file_invalid: [500, 'The data file could not be read. It has not been changed.'],
  internal_error: [500, 'Something went wrong. See the server log.'],
};

export const ERRORS = Object.freeze(
  Object.fromEntries(
    Object.entries(entries).map(([code, [status, message]]) => [
      code,
      Object.freeze({ status, message }),
    ]),
  ),
);

export class AppError extends Error {
  constructor(code) {
    if (!Object.hasOwn(ERRORS, code)) {
      throw new TypeError(`Unknown error code: ${code}`);
    }
    const { status, message } = ERRORS[code];
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function createError(code) {
  return new AppError(code);
}
