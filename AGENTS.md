# Brick Inventory Tracker: project rules

A small local web app on Node.js 22. The user enters a LEGO set number, the app fetches the
set's parts list from the Rebrickable API, saves it, and shows the combined inventory of
every brick the user owns, including a three.js 3D view with one plastic storage container
per part category.

Two coding tools build it: Claude Code (which reads this file through CLAUDE.md) and Codex
(which reads this file directly), on different machines. The rules below apply to both.

## Before you start

- Read [docs/plan.md](docs/plan.md). It is the source of truth for the requirements
  (section 2), decisions (section 3), the HTTP API (section 7), module interfaces (section 8)
  and who builds what (section 9).
- For the 3D containers, also read [docs/container-spec.md](docs/container-spec.md), the
  user's description of the container. Only the user changes it.
- Build only the modules assigned to you in section 9. If you are Claude Code, that is the
  "Claude Code" column; if you are Codex, the "Codex" column.
- Pull the latest `main` before starting a module.

## Stack

- Node.js 22, ES modules (`"type": "module"`), plain JavaScript, no build step.
- No npm dependencies, runtime or dev. Use Node built-ins: `node:http`, `node:fs/promises`,
  `node:path`, `node:test`, `node:assert/strict` and the global `fetch`. Adding a dependency
  needs the user's approval and a decision recorded in docs/plan.md section 3.
- The one approved exception is three.js, vendored as files under `public/vendor/three/`
  (docs/plan.md D13), not installed from npm.
- Browser code in `public/` is plain ES modules loaded by the page. No bundler, no framework.
- Never load scripts, styles or fonts from a CDN or any other site. Everything the page loads
  comes from this server.

## Vendored code

- Vendored libraries live in `public/vendor/<library>/` with their licence file and a
  `README.md` recording the version, download source and SHA-256 of each file.
- Do not edit vendored files. The only allowed change is the one recorded in that README
  (for three.js: the `from 'three'` import in each add-on rewritten to a relative path).
- Upgrading a vendored library is its own branch, updating the files, the README and the
  hashes together.
- Downloading a release to vendor it is allowed only for libraries approved in docs/plan.md
  section 3.

## Commands

- `npm start`: start the server on http://127.0.0.1:3000 (`PORT` and `DATA_FILE` override).
- `npm test`: run all tests, offline.

## The Rebrickable API key: hard rules

- The key lives only in memory in `src/key-store.js`. Never write it to disk: not the data
  file, fixtures, logs, test output, temporary files, `localStorage`, `sessionStorage`,
  cookies or the URL.
- Only `src/rebrickable-client.js` reads the key from the key store, and it sends it only in
  the `Authorization: key <key>` header. Never put it in a URL or query string.
- Never send the key back to the browser. The status route returns only `hasKey`.
- Error messages are the fixed texts in docs/plan.md section 7, created with `createError`
  from `src/errors.js`. Never put an upstream response body, a URL, a request header or a
  caught exception's message into an error, an HTTP response or a log line. Do not attach
  `cause` to errors that leave the client.
- Never log request bodies or request headers.
- Log lines and error responses pass through `keyStore.redact()`. This is a safety net, not
  a substitute for the rules above.
- Any change on the key's path must keep `test/key-leak.test.js` passing. A new place where
  the key could surface gets a new assertion in that test.

## Network and tests

- Agents never call the real Rebrickable API, never ask the user for a key, and never put a
  key in a command, file or message.
- Tests never touch the network. `test/setup/no-network.js` makes every non-local `fetch`
  throw; do not bypass or disable it. Modules take `fetch` as a parameter; tests pass
  `createFakeFetch` from `test/helpers/fake-fetch.js`.
- Captured fixtures in `test/fixtures/rebrickable/` are made by the user with
  `scripts/capture-fixtures.js`. Do not edit them. A test that needs a response that cannot
  be captured (429, 500, malformed JSON) uses a hand-made fixture named `handmade-*.json`.
- Every module has a test file `test/<module>.test.js` covering the cases listed for it in
  docs/plan.md section 8.
- Run `npm test` before every commit. All tests must pass.

## Server and page

- Listen on `127.0.0.1` only. Never `0.0.0.0`, `::` or an unspecified host.
- Keep the request rules in docs/plan.md section 7: `Host` check, `Origin` and JSON
  content type for changes, 10 KB body limit, security headers, static files confined to
  `public/`.
- In the page, insert text from the API with `textContent` or DOM properties, never
  `innerHTML`.
- Animations respect `prefers-reduced-motion`, and the page works without WebGL.

## Data

- The data file is `data/inventory.json`. The `data/` folder is git-ignored. Never commit it
  or any real inventory data.
- A change to the data file format bumps `version` and updates docs/plan.md section 6.

## Public repository

- Commit nothing secret or personal: no keys, tokens, personal paths, user names or machine
  names.
- Wherever a file names an author (a byline, `package.json`, a license), the author is
  `Stoil_Dimitrov` (GitHub: `Slevin57141`). Never write an email address into any file.
- Use only what is in this repository. Never refer to, copy from or depend on other
  projects or folders outside this repository.

## Working as two tools

- Each module belongs to one tool (docs/plan.md section 9). Do not edit another tool's module
  files. If you need a change there, describe it in your pull request or tell the user.
- Shared files (`src/errors.js`, `test/helpers/`, `package.json`) are owned by the M0 builder.
  Propose changes to them in a pull request instead of editing them in passing.
- An interface change updates docs/plan.md section 8 in the same branch, and the pull request
  says so. The owner of each affected module updates their own code.
- Work on one branch per module, named `claude/<module>` or `codex/<module>` (for example
  `codex/inventory`). Never push to `main` directly. Merge through a pull request that the
  other tool has reviewed.
- When you settle something the plan leaves open, add it to docs/plan.md section 3.

## Code style

- Keep modules small and match the interfaces in docs/plan.md exactly.
- Use factory functions with injected dependencies (`fetch`, `sleep`, `now`, file paths), so
  tests need no globals and no real network, clock or data file.
- Throw `AppError`s from `createError(code)`; do not invent new error codes without adding
  them to docs/plan.md section 7.
- Comments explain why, not what.

## Writing style (every file)

- No em dashes. Use colons, commas, semicolons, parentheses or separate sentences.
- No emojis.
- Plain hyphens for ranges (1-7).

## Definition of done for a module

- The interface matches docs/plan.md section 8.
- The tests listed there exist and pass with `npm test`, offline.
- No new dependency, no key on disk, no network in tests.
- docs/plan.md is updated if anything about the module changed.
