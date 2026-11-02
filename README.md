# Brick Inventory Tracker

A small web app that runs on your own computer and keeps track of every LEGO brick you own.
Type in a set number: the app fetches the set's parts list from
[Rebrickable](https://rebrickable.com), saves it, and adds the parts to one combined
inventory. You can filter and search the parts.

## What you need

- [Node.js](https://nodejs.org) 22 or later. Nothing else: the app has no npm dependencies,
  so there is nothing to install.
- A free Rebrickable account and its API key. Create the account, then generate a key in
  your account settings, in the API section. The app asks for the key the first time it
  needs to fetch a set.

## Running it

```
npm start
```

Then open <http://127.0.0.1:3000> in your browser.

- **Add sets:** enter one or more set numbers, like `10270` or `10270-1`, separated by spaces,
  commas or semicolons (a number without a suffix gets `-1`). They are added one after
  another; a set that cannot be added is reported, and what was not added stays in the field.
  Adding a set you already have adds another copy, without contacting Rebrickable. A pack
  that contains other sets counts as one set, with all of their parts.
- **Your sets:** each set shows its year, Rebrickable's part count, the pieces in one copy,
  its copies and a link to its Rebrickable page, and the list folds away. "Details", or a
  double click on the set, shows the parts of one copy.
- **Remove a set:** "Remove one" takes away one copy and its parts.
- **Parts:** filter and sort on every column, search by part number or name, and read the
  totals for what is listed.

Everything except fetching a new set works offline. Part and set images come from
Rebrickable and show a placeholder when they cannot load.

### Settings

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `PORT` | `3000` | The port to listen on (`0` picks a free one). |
| `DATA_FILE` | `data/inventory.json` in this folder | Where your sets are saved. A relative path starts from the folder you run the command in. |

For example, `PORT=3001 npm start` in a Unix shell, or `$env:PORT = '3001'; npm start` in
PowerShell.

## Your API key and your data

- The key is kept in memory only. It is never written to disk, logged, put in a URL or sent
  back to the browser, and it is gone when the server stops, so the app asks for it again
  after a restart. "Forget key" drops it at once.
- The key is sent only to Rebrickable, and only in a request header.
- Your sets are saved in the data file (`data/` is ignored by git). The app saves each change
  to a temporary file first and then replaces the data file, so an interrupted save cannot
  damage it. If the file cannot be read, the app stops with a message and leaves the file
  as it is.
- The server listens on `127.0.0.1` only, so other devices on your network cannot reach it,
  and it refuses changes sent from other websites open in your browser.

## Tests

```
npm test
```

The tests run offline. They use saved Rebrickable responses in `test/fixtures/` and make
any real network request fail.

## How it is built

Plain JavaScript modules on Node.js 22 and in the browser, with no build step and no
framework.

- [docs/plan.md](docs/plan.md): requirements, decisions, the HTTP API and every module.
- [AGENTS.md](AGENTS.md): the rules for working on the code.

Author: Stoil_Dimitrov ([Slevin57141](https://github.com/Slevin57141)).
