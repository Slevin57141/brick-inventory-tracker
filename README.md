# Brick Inventory Tracker

A small web app that runs on your own computer and keeps track of every LEGO brick you own.
Type in a set number: the app fetches the set's parts list from
[Rebrickable](https://rebrickable.com), saves it, and adds the parts to one combined
inventory. You can filter and search the parts, and a 3D view shows them as coloured blocks
in one see-through storage container per part category.

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

- **Add a set:** enter its number, like `10270` or `10270-1` (a number without a suffix gets
  `-1`). Adding a set you already have adds another copy, without contacting Rebrickable. A
  pack that contains other sets counts as one set, with all of their parts.
- **Remove a set:** "Remove one" takes away one copy and its parts.
- **Parts:** filter and sort on every column, search by part number or name, and read the
  totals for what is listed. The 3D view always shows the same parts as the list, one block
  for up to 100 pieces of one part, and "Open lids" lifts every lid off to show the blocks
  from above. Drag to turn the view and scroll to zoom; click a container to select it and
  double-click to zoom in on it.
- **The container on its own:** <http://127.0.0.1:3000/container.html> shows one empty
  storage container, with buttons to take its lid off and to stack three.

Everything except fetching a new set works offline. Part and set images come from
Rebrickable and show a placeholder when they cannot load.

### Real part shapes and built sets (optional)

Rebrickable has no 3D models, so out of the box every block is a plain brick. With the free
[LDraw](https://www.ldraw.org) parts library, each block takes the real shape of its part:

1. Download the complete library,
   <https://library.ldraw.org/library/updates/complete.zip> (about 150 MB).
2. Unzip it into this folder, so that `ldraw/parts`, `ldraw/p` and `ldraw/LDConfig.ldr`
   exist. The `ldraw/` folder is ignored by git. To keep the library elsewhere, set
   `LDRAW_DIR` to its folder.
3. Restart the app.

Parts the library does not have stay plain bricks. For a 3D model of a built set, download
its model file from the LDraw Official Model Repository (<https://library.ldraw.org/omr>)
and put it in `ldraw/omr/`, keeping its name, which is the set number (for example
`10002-1.mpd`; a name such as `10002-1 - Railroad Club Car.mpd` works too). The set's
details then show it built. Models exist for some sets only. The library comes with its own
licence files.

### Settings

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `PORT` | `3000` | The port to listen on (`0` picks a free one). |
| `DATA_FILE` | `data/inventory.json` in this folder | Where your sets are saved. A relative path starts from the folder you run the command in. |
| `LDRAW_DIR` | `ldraw/` in this folder | Where the LDraw parts library is, if you use one. |

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
framework. The 3D view uses [three.js](https://threejs.org), included as files under
`public/vendor/three/` (see the README there) rather than loaded from the internet.

- [docs/plan.md](docs/plan.md): requirements, decisions, the HTTP API and every module.
- [docs/container-spec.md](docs/container-spec.md): the storage container the 3D view draws.
- [AGENTS.md](AGENTS.md): the rules for working on the code.

Author: Stoil_Dimitrov ([Slevin57141](https://github.com/Slevin57141)).
