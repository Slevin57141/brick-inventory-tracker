import { createError } from './errors.js';

export function normalizeSetNumber(input) {
  if (typeof input !== 'string') {
    throw createError('invalid_set_number');
  }

  const setNumber = input.trim();
  if (setNumber.length > 40 || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(setNumber)) {
    throw createError('invalid_set_number');
  }

  return /-\d+$/.test(setNumber) ? setNumber : `${setNumber}-1`;
}
