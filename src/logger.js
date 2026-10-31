// One line per event on standard output (docs/plan.md M8). Every line passes through
// `redact` before it is written: a safety net in case the key ever reaches a message, on
// top of the rule that request bodies and headers are never logged at all (R16).

export function createLogger({
  write = (line) => process.stdout.write(`${line}\n`),
  redact = (text) => text,
  now = () => new Date(),
} = {}) {
  function log(level, message, fields) {
    const details = fields === undefined ? '' : ` ${JSON.stringify(fields)}`;
    write(redact(`${now().toISOString()} ${level} ${message}${details}`));
  }

  return Object.freeze({
    info(message, fields) {
      log('INFO', message, fields);
    },
    error(message, fields) {
      log('ERROR', message, fields);
    },
  });
}
