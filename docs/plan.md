# Brick Inventory Tracker: plan

Author: Stoil_Dimitrov (GitHub: Slevin57141). Status: accepted by the user, 2026-10-30.

This file is the source of truth for the requirements, the module interfaces and which tool
builds what. Project rules for both coding tools are in [AGENTS.md](../AGENTS.md).

## 1. Goal

A small local web app that tracks every LEGO brick the user owns. The user enters a set
number; the app fetches the set's parts list from the Rebrickable API, saves it, and adds the
parts to one combined inventory.

## 2. Requirements

Modules and tests refer to these IDs.

### Sets

- **R1.** Add a set by its number. Accept `10270` and `10270-1`; a number without a variant
  suffix gets `-1`.
- **R2.** Adding a set that is already saved adds another copy. It uses the saved parts list
  and makes no API call (D7).
- **R3.** Removing a set removes one copy and subtracts that copy's parts from the inventory.
  When the last copy is removed, the set and its saved parts list are deleted (D5).
- **R4.** A pack (a set that Rebrickable lists as containing other sets) counts as one set.
  Its parts include the parts of every contained set, times the number of times that set is
  contained.

### Inventory

- **R5.** The inventory adds up parts by part number and colour across all sets and copies,
  including minifigure parts.
- **R6.** Spare parts count as normal parts: they are added to the same quantity. The saved
  parts list keeps the spare flag, so this can change later without fetching sets again.

### Page

- **R7.** Show the owned sets with image, number, name, year and number of copies, each with a
  button that removes one copy.
- **R8.** Show the combined parts list with part image, part number, name, colour, category
  and quantity.
- **R9.** Filter the parts list by colour and by category, and search it by part number or
  name. Filters and search combine.
- **R10.** Show totals for the listed parts: distinct parts (the number of part-and-colour
  rows) and total pieces (the sum of quantities).
- **R11.** Images are linked from Rebrickable, not stored. When an image cannot load (offline,
  or Rebrickable has none), a placeholder shows.

### Storage

- **R12.** All data is saved in one local data file and survives restarts.
- **R13.** Each fetched set is saved with its full parts list, so everything except fetching a
  new set works without the API.

### API key

- **R14.** When adding a set needs the API and no key is set, the page asks for the user's
  Rebrickable API key.
- **R15.** The server checks a new key with one small API call before accepting it, and keeps
  it only in memory. It is lost when the server stops.
- **R16.** The key never appears in the data file, the logs or any error message. It also
  never appears in any HTTP response to the browser or in any request URL (D8).
- **R17.** The page shows whether a key is set and has a button to forget it.
- **R18.** If Rebrickable rejects the stored key later, the server forgets it and the page asks
  again (D12).

### Platform and constraints

- **R19.** Local web app on Node.js 22, listening on 127.0.0.1 only.
- **R20.** The repository is public. The data file is git-ignored.
- **R21.** Tests use saved example responses and never call the real API.
- **R22.** Two tools build this: Claude Code on one machine, Codex on another. Project rules
  are in AGENTS.md; CLAUDE.md contains only `@AGENTS.md`.
- **R23.** The project uses only what is in this repository and never refers to other
  projects.

### 3D view

- **R24.** Removed (D32).
- **R25.** Removed (D32).
- **R26.** Removed (D32).
- **R27.** Removed (D32).
- **R28.** Removed (D32).
- **R29.** Removed (D32).

## 3. Decisions

| #   | Decision | Reason |
| --- | -------- | ------ |
| D1  | Spare parts count as normal parts (R6). | User's choice, 2026-10-30. |
| D2  | Images are linked, not downloaded (R11). | User's choice, 2026-10-30. Keeps the data file small and adding fast. |
| D3  | No npm dependencies. Plain JavaScript ES modules, `node:test`, no build step, no frontend framework. The one exception, vendored three.js (D13), was removed with the 3D view (D32). | User's choice, 2026-10-30. Nothing to install, and both tools run the same commands. |
| D4  | Packs include their contained sets (R4). | User's choice, 2026-10-30. |
| D5  | Remove takes away one copy at a time; removing the last copy deletes the set record. | Mirrors "adding again counts a second copy". |
| D6  | The inventory is computed from the saved sets on every request and never stored. | Add and remove cannot drift apart. A few thousand part lines take milliseconds. |
| D7  | Adding a copy of a saved set makes no API call and needs no key. | The saved parts list is complete (R13), so a repeat add also works offline. |
| D8  | The key is sent only in the `Authorization: key <key>` header, never as a query parameter. | A key in a URL would appear in pagination `next` links and anywhere a URL is logged or put into an error. |
| D9  | Totals describe the rows currently listed, after filters and search. | With no filter, that is the whole inventory. |
| D10 | Colour and category filters are single-select, each with an "All" option. | Smallest UI that meets R9; easy to widen later. |
| D11 | Default port 3000 (override with `PORT`). Data file `data/inventory.json` (override with `DATA_FILE`). | Predictable defaults; tests use temporary paths. |
| D12 | When Rebrickable rejects the stored key, the server forgets it (R18). | Otherwise every add would fail until the user pressed "Forget key". |
| D13 | Removed (D32). | |
| D14 | Removed (D32). | |
| D15 | Removed (D32). | |
| D16 | Removed (D32). | |
| D17 | Removed (D32). | |
| D18 | Removed (D32). | |
| D19 | Removed (D32). | |
| D20 | Removed (D32). | |
| D21 | Set numbers go to Rebrickable with the case the user typed (M1). The saved `setNum` is Rebrickable's `set_num`, and `findSet` matches case-insensitively (M5). F5 stays unverified. | The captured set numbers are all digits, so they cannot show whether the API ignores case. The design works either way: if the API is case-sensitive, a set number with letters typed in the wrong case gets `set_not_found`, and the user can try again. |
| D22 | No real 429 is captured. M3 waits for `Retry-After` when it is present and for the seconds in `detail` otherwise, and its tests cover both with hand-made fixtures. F6 stays unverified. | Forcing a 429 risks a temporary IP ban (section 4), and the client behaves correctly with either answer. |
| D23 | The Content-Security-Policy allows images only from `https://cdn.rebrickable.com` (F3). An image on any other host is blocked and shows the placeholder (R11). | Every image URL in the captured responses is on that host. A wider policy would let the page load images from sites it has no reason to contact. |
| D24 | For a set that contains other sets, M4 drops every line of the set's own parts response whose `set_num` is the number of a set inside it, at any depth, and adds each contained set's own import (minifigure parts included) times its quantity. Lines with any other `set_num` (the pack's own parts and its own minifigures' parts) are kept. | F2: a pack's response repeats its contained sets' ordinary parts but leaves out their minifigure parts. The contained sets' own responses count every part once, include the minifigure parts, and do not depend on how Rebrickable multiplies a contained quantity. No request is added: M4 already imports each contained set. |
| D25 | M5 inventory rows and M9 filter options compare names with `Intl.Collator('en', { numeric: true })`. | One explicit locale keeps the list and filter ordering independent of the machine's default language, and numeric ordering puts sizes such as 1 x 2 before 1 x 10. |
| D26 | Removed (D32). | |
| D27 | Every column of the parts list can be filtered and sorted (M9, M10). A filter row under the headings holds a text filter for part number and for name, the colour and category choices (D10), and smallest and largest quantity; the search box stays and combines with them. Clicking a heading sorts by that column, and clicking it again reverses the order; the list starts sorted by name. | User's request, 2026-10-31. |
| D28 | Removed (D32). | |
| D29 | Removed (D32). | |
| D30 | The add form takes one or more set numbers, separated by spaces, commas or semicolons, and adds them one after another (M10); the API still adds one set per request. The key is asked for when first needed and the batch goes on with it. A set Rebrickable has no record of, or that is not a valid number, is reported and the batch goes on; `rate_limited`, `api_unavailable`, `server_unreachable` or a cancelled key dialog stop the batch, since the sets still to come would fail the same way. What was not added stays in the field. "Your sets" folds away, and each set shows its number, year, Rebrickable's part count, the pieces saved for one copy (`pieces`, spares and minifigure parts included, D1), its copies and a link to its Rebrickable page. A double click on a set, or its "Details" button, opens a dialog with the set's facts and the parts of one copy, sortable like the parts list, from the new `GET /api/sets/{setNum}`. | User's request, 2026-10-31. |
| D31 | Partly removed (D32): the LDraw part shapes in the 3D view, the built set in set details, the library reader (M14), the model view (M15) and `LDRAW_DIR` are gone. What stays is data format version 2. Rebrickable lists each part's LDraw file names (`external_ids.LDraw`), and the data file saves each part line's `ldrawIds` and each set's `themeId` (Rebrickable's theme, not shown yet; section 9) as data format version 2; a version 1 file is upgraded in memory when loaded (empty `ldrawIds`, null `themeId`, no themes) and written as version 2 on the next save. Only plain file names (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) are kept. Since D32 nothing reads `ldrawIds`. | User's choice, 2026-10-31, over shapes made up from part names. The data format stays so that existing data files load unchanged (D32). |
| D32 | The 3D view is removed, with everything only it used: the storage view (R24-R29; D13-D20, D26, D28, D29; M11, M12, M13, the preview page `container.html` and docs/container-spec.md), the vendored three.js, and the LDraw support (M14, M15, `GET /api/ldraw`, `GET /api/ldraw/part`, `GET /api/sets/{setNum}/model`, `LDRAW_DIR` and the built set in set details). Data format version 2 is unchanged: `ldrawIds` and `themeId` are still saved, M5 still copies `ldrawIds` into InventoryRow, and existing data files load as before, but nothing reads `ldrawIds` now. The Content-Security-Policy is unchanged, since it allowed nothing that only the 3D view needed. | User's decision, 2026-11-02: after using the app, the 3D storage view added nothing to the functionality or the experience over the filtered parts list. |

## 4. Rebrickable API

Base URL: `https://rebrickable.com/api/v3`. From the API documentation (checked 2026-10-30):

- Authentication: header `Authorization: key <key>`. A `key` query parameter also works; this
  app never uses it (D8).
- Rate limit: on average one request per second, with a small allowance for bursts.
  Throttled requests get status 429 and a body like
  `{"detail": "Request was throttled. Expected available in 2 seconds."}`. Repeated 429s can
  get the IP address temporarily banned, so the client paces its requests.
- Page size: default 100, maximum 1000.
- An invalid key gets status 401.

Requests this app makes:

| Purpose | Request |
| ------- | ------- |
| Check a new key (R15) | `GET /lego/colors/?page_size=1` |
| Set details | `GET /lego/sets/{set_num}/` |
| Set parts, with minifigure parts | `GET /lego/sets/{set_num}/parts/?inc_minifig_parts=1&page_size=1000`, following `next` |
| Contained sets (packs, R4) | `GET /lego/sets/{set_num}/sets/?page_size=1000` |
| Category names | `GET /lego/part_categories/?page_size=1000`, only when a part has a category ID not yet saved |

Adding an ordinary set takes 3 requests (4 the first time, for categories), so about 3-4
seconds at one request per second. A pack adds 3 requests per contained set.

### Facts checked against captured responses

The documentation does not settle these. They were checked on 2026-10-31 against two captures
the user made that day, each with the details, parts, contained sets and minifigures of every
set. The first has sets 31146-1, 42161-1, 76906-1 and 76991-1, the unknown set 99999999-1, the
key check with a valid and a wrong key, and the part categories. The second has the pack
66495-1 with the three sets it contains (75037-1, 75038-1, 75045-1), 75449-1 (two identical
minifigures), and 76991-1 again at page size 100.

- **F1. Answered: yes.** Minifigure part quantities from `inc_minifig_parts=1` are already
  multiplied by the number of that minifigure in the set, so the importer uses them as they
  are and never calls `/minifigs/`. In 75449-1 the clone trooper `fig-014194` has quantity 2,
  and each of its four parts (head, legs, helmet, torso) has quantity 2. 75045-1 (two clone
  troopers) and 75037-1 (two super battle droids: 2 torsos, 2 legs, 4 arms) agree. A
  minifigure's part lines carry the minifigure's number in `set_num` (for example
  `fig-014194`) instead of the set's.
- **F2. Answered: partly, so the importer filters (D24).** The pack 66495-1 has
  `num_parts: 0`, but its own `/parts/` response has 304 lines: exactly the ordinary part lines
  of its three contained sets (same inventory IDs and quantities), each with the contained
  set's number in `set_num`. It has none of their minifigure parts (47 lines, 69 pieces), even
  with `inc_minifig_parts=1`. The pack has no minifigures or parts of its own. Each contained
  set appears once, so whether the response multiplies by a contained quantity is unknown;
  D24 does not depend on it.
- **F3. Answered.** Every image URL is on `https://cdn.rebrickable.com`: all 4 `set_img_url`,
  605 of 606 `part_img_url`, and the minifigure images. `part_img_url` can be null (one line in
  76991-1: part 27456pr0003 in Blue). No `set_img_url` was null, but SetRecord keeps `imgUrl`
  nullable. The Content-Security-Policy in section 7 allows only this host (D23).
- **F4. Answered.** `GET /lego/sets/99999999-1/` returns 404 with the JSON body
  `{"detail": "No Set matches the given query."}`. M3 maps it to `set_not_found` and never
  passes on the `detail` text. A wrong key returns 401 with `{"detail": "Invalid token."}`.
- **F5. Not verified, not needed (D21).** Every captured set number is digits only, so the
  captures cannot show whether the API ignores case.
- **F6. Not verified, not needed (D22).** The capture script stops at a 429 instead of saving
  it, on purpose. M3 handles a 429 with or without `Retry-After`.
- **F7. Answered: yes.** Every colour object in every part line has `is_trans` as a boolean
  (35 transparent lines across the four sets). Colour objects also carry `id`, `name`, `rgb`
  (6 upper-case hex digits) and `external_ids`.

Other facts from the same captures, for M3 and M4:

- A part line has `id`, `inv_part_id`, `part` (`part_num`, `name`, `part_cat_id`, `part_url`,
  `part_img_url`, `external_ids`), `color`, `set_num`, `quantity`, `is_spare`, `element_id`
  and `num_sets`.
- `num_parts` from the set details is not a reliable count. It never includes spares, but it
  includes the minifigure parts in most sets and leaves them out in 75037-1 (156, against 178
  with its 22 minifigure pieces), and a pack has 0. It stays display only (section 6).
- A contained-sets entry has `id`, `set_num`, `set_name`, `quantity` and `set_img_url`, which
  map to `containedSets` in section 6.
- Within one `set_num`, a response never repeats a part, colour and spare flag combination,
  but across `set_num` values it does: between a set and its minifigures (75045-1: part 30377
  in colour 71 once for the set and twice for `fig-004039`, 3 in all), between two
  minifigures (75037-1, 75449-1), and between a pack's contained sets (66495-1, 26
  combinations). So M4 merges matching lines for every set, not only for packs.
- Every `part_cat_id` appears in the part categories response (76 categories, one page).
- At `page_size=1000` every parts response fits on one page (the largest, the pack, has 304
  lines). At page size 100, 76991-1 gives two pages of 100 and 98 lines. Page 1's `next` is
  `https://rebrickable.com/api/v3/lego/sets/76991-1/parts/?inc_minifig_parts=1&page=2&page_size=100`
  (same origin, no key), page 2's `next` is null, and the two pages joined equal the
  single-page response line for line.
- The key check's `next` link is `https://rebrickable.com/api/v3/lego/colors/?page=2&page_size=1`:
  same origin as the base URL and no key in it, as expected with header authentication (D8).

## 5. Architecture

```
 public/ (browser)                 src/ (Node.js, 127.0.0.1 only)

 M10 web UI ---- HTTP JSON ----> M8 server -------------------------+
                                   |        |                       |
                                   v        v                       v
                            M7 collection  M2 key-store <---- M3 rebrickable-client
                               |  |  |  |                           ^   (only code that
                               |  |  |  +--> M4 set-importer -------+    reaches the API)
                               |  |  +-----> M1 set-number
                               |  +--------> M5 inventory
                               +-----------> M6 storage --> data/inventory.json
```

Inside the page:

```
 M10 web UI
   +-- M9 inventory-view          filters, search, totals
```

M8 calls M3 directly only to check a new key. M0 provides `src/errors.js`, which every module
uses.

Directory layout:

```
README.md                      what the app does and how to run it
AGENTS.md                      project rules for both tools
CLAUDE.md                      the single line @AGENTS.md
package.json, .gitignore, .gitattributes   M0
docs/plan.md                   this file
src/
  errors.js                    M0  shared error class and codes (section 7)
  set-number.js                M1
  key-store.js                 M2
  rebrickable-client.js        M3
  set-importer.js              M4
  inventory.js                 M5
  storage.js                   M6
  collection.js                M7
  server.js, logger.js         M8
  main.js                      M8  entry point
public/
  index.html, styles.css, placeholder.svg      M10
  js/api.js, js/app.js                         M10
  js/inventory-view.js                         M9
scripts/capture-fixtures.js    M0  run by the user only
test/
  setup/no-network.js          M0
  helpers/fake-fetch.js        M0
  helpers/http-client.js       M8  requests that send any Host header (M8 tests)
  fixtures/rebrickable/        captured by the user, plus handmade-*.json
  <module>.test.js             one file per module, plus key-leak.test.js
data/inventory.json            git-ignored, created at runtime
```

## 6. Data model

Data file (values are illustrative):

```json
{
  "version": 2,
  "categories": { "11": "Bricks", "14": "Plates" },
  "themes": { "22": { "name": "Creator", "parentId": null } },
  "sets": {
    "10270-1": {
      "setNum": "10270-1",
      "name": "Example set",
      "year": 2020,
      "imgUrl": "https://example.invalid/set.jpg",
      "numParts": 100,
      "themeId": 22,
      "copies": 2,
      "containedSets": [],
      "parts": [
        {
          "partNum": "3001",
          "name": "Brick 2 x 4",
          "categoryId": 11,
          "colorId": 4,
          "colorName": "Red",
          "colorRgb": "C91A09",
          "colorIsTrans": false,
          "imgUrl": null,
          "quantity": 6,
          "isSpare": false,
          "ldrawIds": ["3001"]
        }
      ]
    }
  }
}
```

Types used in the interfaces below:

- **PartLine**: `partNum` (string), `name`, `categoryId` (number), `colorId` (number),
  `colorName`, `colorRgb` (6 hex digits), `colorIsTrans` (boolean), `imgUrl` (string or
  null), `quantity` (positive integer, already multiplied for contained sets), `isSpare`
  (boolean), `ldrawIds` (the part's LDraw file names, best first, possibly none; D31; still
  saved, but read by nothing since D32).
- **SetRecord**: `setNum` (as returned by Rebrickable), `name`, `year`, `imgUrl` (string or
  null), `numParts` (as reported by Rebrickable; display only, never used for totals),
  `themeId` (Rebrickable's theme ID, or null), `containedSets` (`[{ setNum, name, quantity }]`), `parts` (PartLine[]; no two lines share
  `partNum`, `colorId` and `isSpare`).
- **SetEntry**: a SetRecord plus `copies` (integer, 1 or more). This is what the data file
  stores under `sets`.
- **State**: `{ version: 2, categories: { [id]: name }, themes: { [id]: { name, parentId } },
  sets: { [setNum]: SetEntry } }`. Nothing fills `themes` yet (section 9), so it stays `{}`.
- **SetSummary** (sent to the browser): SetEntry without `parts`, plus `pieces`: the sum of
  the quantities in one copy's parts list, spares and minifigure parts included (D1, D30).
- **InventoryRow**: `partNum`, `name`, `categoryId`, `categoryName`, `colorId`, `colorName`,
  `colorRgb`, `colorIsTrans`, `imgUrl`, `quantity`, `ldrawIds` (copied from the part lines;
  the page does not read it since D32).

Any change to the data file format bumps `version` and is recorded here.

- **Version 2** (2026-10-31, D31): `themes`, `themeId` on each set and `ldrawIds` on each part
  line. A version 1 file is upgraded in memory when loaded and saved as version 2 by the
  next change.

## 7. HTTP API

All requests and responses are JSON. An error response has an HTTP status from the table
below and the body `{ "error": { "code": "...", "message": "..." } }`. The message is the fixed
text for that code; it is never built from an upstream response, a URL or a caught exception.
The page acts on `code`, not on the status.

| Method and path | Body | Success | Possible error codes |
| --------------- | ---- | ------- | -------------------- |
| `GET /api/status` | | `200 { hasKey }` | |
| `PUT /api/key` | `{ key }` | `200 { hasKey }` (false when the key was forgotten during the check, see M8) | `invalid_key_format`, `key_invalid`, `rate_limited`, `api_unavailable` |
| `DELETE /api/key` | | `200 { hasKey: false }` | |
| `GET /api/sets` | | `200 { sets: SetSummary[] }` | |
| `POST /api/sets` | `{ setNumber }` | `200 { set: SetSummary }` | `invalid_set_number`, `key_required`, `key_invalid`, `set_not_found`, `rate_limited`, `api_unavailable` |
| `GET /api/sets/{setNum}` | | `200 { set: SetSummary, rows: InventoryRow[] }`: the parts of one copy (D30) | `not_owned` |
| `DELETE /api/sets/{setNum}` | | `200 { set: SetSummary or null }` (null when the last copy went) | `not_owned` |
| `GET /api/inventory` | | `200 { rows: InventoryRow[] }` | |
| `GET /` and files under `public/` | | the file | `not_found` |

`GET /api/ldraw`, `GET /api/ldraw/part` and `GET /api/sets/{setNum}/model` were removed with the
3D view (D32) and now answer `not_found` like any unknown route.

Every route can also return `forbidden`, `bad_request`, `payload_too_large` and
`internal_error`.

Error codes (defined once in `src/errors.js`):

| Code | Status | Message |
| ---- | ------ | ------- |
| `invalid_set_number` | 400 | That is not a valid set number. Use a number like 10270 or 10270-1. |
| `invalid_key_format` | 400 | That does not look like a Rebrickable API key. |
| `key_invalid` | 400 | Rebrickable rejected the API key. |
| `key_required` | 409 | A Rebrickable API key is needed to fetch a new set. |
| `set_not_found` | 404 | Rebrickable has no set with that number. |
| `not_owned` | 404 | That set is not in your collection. |
| `rate_limited` | 429 | Rebrickable is limiting requests. Try again in a minute. |
| `api_unavailable` | 502 | Rebrickable could not be reached or gave an unexpected answer. |
| `bad_request` | 400 | The request was not valid. |
| `forbidden` | 403 | Request refused. |
| `payload_too_large` | 413 | The request is too large. |
| `not_found` | 404 | Not found. |
| `data_file_invalid` | 500 | The data file could not be read. It has not been changed. |
| `internal_error` | 500 | Something went wrong. See the server log. |

The page's `api.js` (M10) adds one code the server never sends: `server_unreachable`, "The
app could not reach its server. Check that it is still running.", when a request gets no
answer at all. An answer that is not the expected JSON becomes `internal_error` with the
fixed message above.

Request rules for every route:

- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, otherwise `forbidden`.
  This stops DNS rebinding.
- Requests other than GET and HEAD must carry an `Origin` header equal to
  `http://127.0.0.1:<port>` or `http://localhost:<port>`, and a body (if any) must be
  `Content-Type: application/json`; otherwise `forbidden`. This stops other websites from
  sending requests to the app through the browser.
- Request bodies are limited to 10 KB.
- Static files are served only from `public/`; a path that resolves outside it is `not_found`.
- Response headers: `Cache-Control: no-store` on `/api/*`; on every response
  `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'self'; img-src 'self' https://cdn.rebrickable.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
  (image host from F3, D23).
- Scripts come only from this server. The page has no inline scripts, so the policy needs no
  exceptions.

## 8. Modules

Each module lists its responsibility, its interface, its tests and its builder, with the
reason. Section 9 gives the build order.

### M0. Scaffolding and test harness

- **Responsibility:** `package.json` (`"type": "module"`, `engines.node` `>=22`,
  `"author": "Stoil_Dimitrov"`, scripts `start` and `test`, no dependencies); `.gitignore` (`data/`, `node_modules/`, `*.log`);
  `src/errors.js`; the no-network guard; the fake fetch; the fixture capture script.
- **Interface:**
  - `npm start` runs `node src/main.js`. `npm test` runs
    `node --test --import ./test/setup/no-network.js "test/**/*.test.js"`.
  - `src/errors.js`: `class AppError extends Error` with `code` and `status`;
    `createError(code)` returns an AppError with the fixed message and status from section 7.
  - `test/helpers/fake-fetch.js`: `createFakeFetch(routes)`, where `routes` maps a request
    string such as `GET /lego/sets/10270-1/` (path plus sorted query, relative to the base
    URL) to a fixture name. It returns a fetch-compatible function that records every request
    (method, URL, headers) and throws on an unknown route.
  - Fixture file format: `{ "request": "GET /lego/...", "status": 200, "headers": {}, "body": ... }`.
  - `scripts/capture-fixtures.js <setNum>...`: run by the user only. Prompts for the key
    without echoing it, makes the section 4 requests for each set one second apart, and writes
    one fixture file per response. It refuses to write anything if any output contains the
    key. It also captures the list of themes (`themes.json`). With `--themes` instead of set
    numbers it captures only that list, so the other fixtures, and the counts the tests
    check against them, stay as they are.
- **Tests:** the guard rejects a non-local fetch and allows 127.0.0.1; fake fetch serves,
  records and rejects unknown routes; `createError` covers every code in section 7; the
  capture script's "contains the key" check (a pure function) and its command line.
- **Builder: Claude Code.** It must exist before either tool starts, and it fixes the
  conventions both tools then follow (error codes, test harness, fixture format). Building it
  here, right after the plan, means no waiting on the other machine.

After M0, the user captures fixtures for: one small set with minifigures and spare parts; one
set with two identical minifigures (F1); one pack (F2); one unknown set number (F4); and the
key check with a deliberately wrong key (401). Claude Code answers F1-F7 from them and
updates sections 4, 6 and 7. Responses that cannot be captured on demand (429, 500, malformed
JSON, a cycle of contained sets, a contained set with a quantity above 1) are hand-made and
named `handmade-*.json`. The first capture (2026-10-31) had neither a pack nor a set with two
identical minifigures; a second capture the same day added both, and a two-page parts list
(section 4).

### M1. set-number

- **Responsibility:** turn what the user typed into a set number for the API, or reject it.
- **Interface:** `normalizeSetNumber(input) -> string`; throws `invalid_set_number`.
  Rules: trim; then 1-40 characters of letters, digits and single hyphens, starting and
  ending with a letter or digit; if it does not end in `-<digits>`, append `-1`. Case is kept.
- **Tests:** a table of examples. Accepted: `10270` to `10270-1`; `10270-1` unchanged;
  ` 10270-1 ` to `10270-1`; `10270-2` unchanged. Rejected: empty, spaces only, `10270-`,
  `-1`, `102 70`, `10270/1`, `../x`, `10270--1`, 41 characters, a non-string.
- **Builder: Codex.** A pure function fully specified by the table above, with no
  dependencies besides `errors.js`. It is a small first task that confirms the setup on the
  other machine (AGENTS.md is read, `npm test` passes there).

### M2. key-store

- **Responsibility:** hold the API key in memory only.
- **Interface:** `createKeyStore() -> { set(key), get(), has(), clear(), redact(text) }` and
  `normalizeKey(input) -> string`.
  - `normalizeKey` trims and checks the format (8-200 visible ASCII characters, `!` to `~`:
    no spaces, control characters or anything a request header cannot carry, which also
    keeps `redact` from throwing) and returns the trimmed key, otherwise throws
    `invalid_key_format`. It stores nothing, so the server can check the format before it
    sends a candidate key to Rebrickable (M8).
  - `set` applies `normalizeKey`, then stores the key; a rejected key leaves the current one
    in place. It does not call the API; the server checks the key with M3 first.
  - `get()` returns the key or null. Only M3 calls it.
  - `redact(text)` replaces every occurrence of the current key with `[redacted]`, including
    its spellings inside a JSON string and a URL, and returns a string.
  - The key lives in a closure, so `JSON.stringify`, `String()`, `util.inspect` and
    `console.log` of the store never show it.
- **Tests:** set, has, get, clear; rejected formats, through both `normalizeKey` and `set`;
  a rejected key keeps the current one; redact with and without a key, and the JSON and URL
  spellings; a sentinel key is absent from `JSON.stringify`, `String()`, `util.inspect` and
  `console.log` output.
- **Builder: Claude Code.** M2, M3 and M8 are the path the key travels. Having one builder
  for the whole path applies the R16 rules the same way at every step, and Codex then reviews
  the whole path as a reader who did not write it.

### M3. rebrickable-client

- **Responsibility:** the only code that talks to Rebrickable: authentication header,
  pacing, pagination, retry on 429, mapping failures to error codes.
- **Interface:**
  ```
  createRebrickableClient({ keyStore, fetch = globalThis.fetch,
      baseUrl = 'https://rebrickable.com/api/v3', minIntervalMs = 1100, timeoutMs = 15000,
      sleep, now })
    .checkKey(candidateKey) -> Promise<void>      // GET /lego/colors/?page_size=1
    .getSet(setNum) -> Promise<object>            // raw Rebrickable JSON
    .getSetParts(setNum) -> Promise<object[]>     // all pages joined
    .getContainedSets(setNum) -> Promise<object[]>
    .getPartCategories() -> Promise<object[]>
  ```
- **Behaviour:**
  - No key set: throws `key_required` without making a request. The key is read again for
    every request, so a key forgotten during an import stops the remaining requests.
    `checkKey` with an empty candidate also throws `key_required`.
  - The key goes only into the `Authorization` header. Path segments are encoded with
    `encodeURIComponent`. A set number that is empty, `.` or `..` throws
    `invalid_set_number`, because a dot segment would change the path even when encoded
    (M1 already rejects these).
  - Requests start at least `minIntervalMs` apart, across all callers.
  - 429: waits (`Retry-After` if present, else the seconds in `detail`, else 5 seconds,
    capped at 30), retries at most twice, then throws `rate_limited`.
  - 401 or 403: `key_invalid`. 404 on a set request: `set_not_found`. Any other non-2xx,
    network error, timeout (`AbortSignal.timeout(timeoutMs)`), invalid JSON or a body of
    the wrong shape (no `results` array in a list, no object for a set): `api_unavailable`.
    For requests using the stored key, a 401 or 403 also clears it if it still equals the
    credential sent on that request. A different replacement is preserved; a rejected
    candidate in `checkKey` leaves the stored key alone. This comparison happens in M3,
    so it also works when an add waited in M7's queue before using a replacement key.
  - Follows `next` only when its origin equals the base URL's origin, and for at most 50
    pages; otherwise `api_unavailable` before anything is requested from that link.
  - Errors come from `createError` only and never carry a URL, header, response body or
    caught error (no `cause`).
- **Tests** (fake fetch and fixtures): request URLs and headers are correct and no URL
  contains the key; pagination over two pages; a `next` on another origin is refused; an
  endless `next` stops at 50 pages; each status and malformed body maps to its code; a
  timeout; 429 then success, with and without `Retry-After` (D22); 429 three times; pacing
  with a fake clock, across concurrent callers; no key means no request; a network error's
  message does not contain the sentinel key.
- **Builder: Claude Code.** Part of the key path (see M2), and it carries the API facts in
  section 4, which Claude Code checks in phase 0.

### M4. set-importer

- **Responsibility:** fetch everything for one set, including the contained sets of a pack,
  and turn Rebrickable's JSON into a SetRecord.
- **Interface:**
  ```
  createSetImporter({ client })
    .importSet(setNum, { knownCategoryIds })
        -> Promise<{ record: SetRecord, categories: [{ id, name }] | null }>
  normalizeSet(rawSet, rawPartLines) -> SetRecord   // pure, exported for tests; merges lines
  mergePartLines(lines) -> PartLine[]               // merges equal partNum + colorId + isSpare,
                                                    // adding their quantities
  ```
- **Behaviour:** fetches details, parts (with minifigure parts) and contained sets; uses
  minifigure part quantities as they come (F1); imports each contained set the same way and
  adds its parts times its quantity, after dropping the lines of the set's own parts response
  that belong to a set inside it (D24); stops at depth 3 and on cycles; fetches categories
  only when a part has a category ID not in `knownCategoryIds`; uses Rebrickable's `set_num`
  as `setNum`. Client errors pass through unchanged.
  - Depth: the set asked for is depth 1, so the sets inside it at depth 3 are imported but
    not the sets inside those. A set that is not imported (depth limit, or a cycle, compared
    case-insensitively) is counted through the lines its parent keeps from its own
    response, together with any deeper set whose lines are there. Each import passes up
    every set number it already counts, imported or kept, and every set further up drops
    those lines, so "a set inside it" means any set counted below it, however deep. A set
    never drops lines with its own number. Minifigure numbers (`fig-...`) are never passed
    up: a response holds no minifigure parts of the sets inside it (F2), so there is
    nothing to drop above, and dropping would remove the upper set's own minifigures.
  - `knownCategoryIds` is any iterable of IDs as numbers or numeric strings (the data file's
    category keys are strings). `categories` is the whole fetched list, or null when nothing
    was fetched.
  - `normalizeSet` leaves `containedSets` empty; `importSet` fills it in. Colours are stored
    in upper case.
  - Every field M4 keeps is checked: a set, part line, contained set or category of the
    wrong shape (for example a quantity that is not a positive integer, or an `rgb` that is
    not 6 hex digits) gives `api_unavailable`, so nothing malformed is saved.
- **Tests:** `normalizeSet` on captured fixtures (field mapping with `themeId` and `ldrawIds`,
  LDraw ids kept in Rebrickable's order and only as plain names, null images, `colorIsTrans`,
  spare flag kept, minifigure parts present, a quantity-2 minifigure in 75449-1 not multiplied
  again, and 75045-1 giving one line for part 30377 in colour 71, not spare, with quantity
  3); no repeated combination in any fixture set; the pack 66495-1 gives exactly the parts of
  its three contained sets, minifigure parts included, each counted once (D24); a contained
  set with a quantity of 2 doubles that set's parts; a pack keeps its own and minifigure
  lines; a cycle, and four- and five-level chains, each part counted once; a minifigure in a
  set and deep inside it counted for both; categories fetched only when
  needed, with IDs as numbers, strings or a Set; client errors pass through as the same
  object; malformed answers give `api_unavailable`.
- **Builder: Claude Code.** It depends on F1 and F2, which Claude Code settles in phase 0, and
  it is the only consumer of M3's raw shapes, so one builder owns both sides of that boundary.

### M5. inventory

- **Responsibility:** pure state changes and the inventory computation.
- **Interface** (pure; inputs are never mutated):
  ```
  emptyState() -> State
  findSet(state, setNum) -> SetEntry | null          // case-insensitive match
  addCopy(state, record) -> State                    // copies + 1, or add with copies 1
  addCategories(state, categories) -> State
  addThemes(state, [{ id, name, parentId }]) -> State   // D30, D31
  removeCopy(state, setNum) -> State                 // copies - 1, delete at 0; throws not_owned
  listSets(state) -> SetSummary[]                    // in the order added
  buildInventory(state) -> InventoryRow[]
  ```
  `buildInventory` sums `quantity * copies` over all sets, keyed by `partNum` and `colorId`,
  spares included (R6). `categoryName` comes from `state.categories`, or "Unknown category".
  `imgUrl` is the first non-null one. Rows are sorted by category name, part name, colour
  name, using the English numeric collator (D25).
- **Tests:** table-driven: one set; two sets sharing a part and colour; the same part in two
  colours stays two rows; a second copy doubles quantities; removing one of two copies halves
  them; removing the last copy deletes the set; removing an unknown set throws; adding then
  removing every fixture set returns to the empty inventory; spares are counted; deep-frozen
  inputs are not mutated; themes are added by ID; a part line's `ldrawIds` reach its row.
- **Builder: Codex.** Pure arithmetic with no I/O, network or key, and the most test-heavy
  logic. It needs only the data model in section 6, so it runs in parallel with M2-M4. From
  2026-10-31 Claude Code changes it at the user's request (data format version 2, D31),
  while Codex reviews and tests.

### M6. storage

- **Responsibility:** read and write the data file safely.
- **Interface:**
  ```
  createStorage({ filePath, rename = fs.rename, sleep })
    .load() -> Promise<State>   // missing file: emptyState()
    .save(state) -> Promise<void>
  ```
  `rename` and `sleep` are injected so tests can simulate a file held by another program.
- **Behaviour:** `load` throws `data_file_invalid` for unreadable JSON or an unknown
  `version`, and never changes or deletes the file. `save` creates the folder, writes a
  temporary file in the same folder and renames it over the data file, so a crash never leaves
  half a file. Saves run one after another. A rename that fails with `EPERM` or `EBUSY` (on
  Windows, another program briefly holding the file) is retried a few times.
  - `load` also throws `data_file_invalid` when the path cannot be read (for example, it is
    a folder) or when the file does not have the section 6 shape: `version` 2, string
    category names, themes of `{ name, parentId }` (a string and an integer or null), and
    for every set an entry whose `setNum` matches its key, with a string `name`, an
    integer `year`, `imgUrl` a string or null, `numParts` 0 or more, `themeId` an
    integer or null, `copies` 1 or more, `containedSets` entries of
    `{ setNum, name, quantity }` with a positive quantity, and PartLines with the right
    types, `colorRgb` of 6 hex digits (either case), a positive integer quantity and
    `ldrawIds` a list of strings. A leading byte order mark (from a text editor) is ignored.
  - A version 1 file with the version 1 shape (no themes, theme IDs or LDraw ids) is
    upgraded in memory (D31) and left as it is on disk until the next save.
  - Every save writes a temporary file of its own, named with a random UUID, so two
    storages on one file cannot collide; a save that cannot create its temporary file
    removes nothing. The temporary file is flushed to disk before the rename. `EACCES` is
    retried too, since Windows reports a held file with any of the three codes. Retries
    wait 50, 100, 200, 400 and 800 ms (about 1.6 s in all); then the error is thrown. A
    failed save removes its temporary file, leaves the data file as it was, and rejects
    only its own caller; later saves still run.
- **Tests** (in a temporary folder): round trip; missing file, not created by `load`;
  corrupt file left byte-for-byte unchanged and an error thrown; unknown version; files of
  the wrong shape, each left unchanged; a path that cannot be read; a byte order mark;
  overlapping saves end with the last state; two storages on one file, one save held at
  its rename while the other completes; folder created; no temporary files left behind; a
  rename refused with each retried code succeeds on retry; a save that keeps failing keeps
  the old file, and other errors are not retried; a failed save does not stop later saves;
  a version 1 file loads as version 2, is left unchanged until saved, and a damaged version 1
  file is still refused.
- **Builder: Claude Code.** Its main risk is replacing a file by rename, which behaves
  differently on Windows (a file briefly held by another program blocks it). This machine runs
  Windows, so the builder can test that case where it matters. M7, its only user, is also
  Claude Code's.

### M7. collection

- **Responsibility:** the app's operations. Holds the current state in memory and saves after
  every change.
- **Interface:**
  ```
  createCollection({ storage, importer })
    .init() -> Promise<void>
    .addSet(input) -> Promise<SetSummary>
    .removeSet(setNum) -> Promise<SetSummary | null>   // null when the last copy went
    .listSets() -> SetSummary[]
    .getSet(setNum) -> { set: SetSummary, rows: InventoryRow[] }   // one copy's parts (D30)
    .getInventory() -> InventoryRow[]
  ```
- **Behaviour:** `addSet` normalizes the input (M1). If a saved set matches (M5 `findSet`), it
  adds a copy with no API call (D7). Otherwise it imports the set (M4, which throws
  `key_required` when there is no key) and saves new categories. Changes run one at a time.
  Each change computes the new state, saves it, and only then replaces the in-memory state;
  if saving fails, the in-memory state is unchanged and the error propagates.
  - `getSet` finds the set like `addSet` does (M5 `findSet`) and builds the rows of one copy
    with M5 `buildInventory`; a set that is not saved, or a set number that is not a string,
    is `not_owned`.
  - The import runs inside the change, so a second add of the same new set waits, then
    finds it saved and makes no API call. A failed change rejects only its own caller.
  - The importer gets the saved category IDs (the data file's keys, as strings).
  - The summary after an import is found by Rebrickable's `set_num`, which can differ from
    what was typed (`31146-01` gives `31146-1`); when it matches a saved set, a copy of
    that set is added instead of a second entry.
  - `removeSet` with anything but a string throws `not_owned`. Using the collection before
    `init()` is a programming error and throws a plain `Error`.
- **Tests** (fake importer, temporary storage): add a new set; add it again without calling
  the importer; remove; remove the last copy; invalid input never reaches the importer; a
  failed save leaves the state unchanged; a new collection on the same file shows the same
  sets and inventory (R12); two overlapping adds run one after the other. Also: saved
  categories reach the next import; a failed import changes nothing; a set number
  Rebrickable writes differently is saved once; use before `init()`; the pack 66495-1
  imported by the real M4 importer is saved, passes M6's shape check on reload and gives
  874 pieces; a summary counts the pieces in one copy; `getSet` returns one copy's parts and
  `not_owned` for a set that is not saved.
- **Builder: Claude Code.** It is built after phase 1 is merged and wires M1, M4, M5 and M6
  together. Claude Code owns M4 and the server that calls the collection.

### M8. server

- **Responsibility:** the HTTP routes and request rules in section 7, static files, logging
  and startup.
- **Interface:**
  ```
  createServer({ collection, keyStore, client, logger, publicDir, port }) -> http.Server
  listen(server, port) -> Promise<{ address, port }>   // always on 127.0.0.1
  createLogger({ write = line => process.stdout.write(line + '\n'), redact, now })
    -> { info(message, fields), error(message, fields) }
  src/main.js: reads PORT and DATA_FILE, builds every module, calls collection.init(),
               listens on 127.0.0.1 and logs the URL; exits with the data_file_invalid
               message if the data file is bad.
  ```
  `listen` is the only way the server is started, so nothing can bind it to another
  address. The Host and Origin checks use the port actually in use, so tests can listen on
  port 0. A log line is `<ISO time> INFO|ERROR <message> <fields as JSON>`.
- **Behaviour:** `PUT /api/key` checks the format (M2 `normalizeKey`), checks the key with
  Rebrickable (`client.checkKey`), then stores it. M3 clears a rejected stored credential
  when it still matches the one sent (R18). Errors that are not AppErrors become `internal_error`, and the
  real error is logged (name and stack, passed through `redact`). One log line per request:
  method, path, status, duration. Request bodies and headers are never logged. Static files
  get a `Content-Type` from their extension; `.js` must be `text/javascript`, or the browser
  refuses module scripts under `nosniff`.
  - Key changes take effect in the order they arrived. A `PUT /api/key` whose check ends
    after a later PUT or DELETE has taken effect stores nothing, so "Forget key" during a
    check is not undone; a later PUT that fails changes nothing. The PUT answers `200` with
    the actual `hasKey`. Rejection handling belongs to M3, which knows the credential used
    on each upstream request. M8 does not infer it from when an add reached the HTTP route:
    that add may wait in M7's queue and then use a replacement key.
  - Checks run in order: security headers on every response, then `Host`, then (for any
    method but GET and HEAD) `Origin`, then the body: present only with a JSON content type,
    at most 10 KB (`payload_too_large`, by declared length or as it streams). A body that
    is not a JSON object is `bad_request`, as is a set number in the path that is not
    valid percent-encoding. An unknown `/api/` path or method is `not_found`, and so is any
    method but GET and HEAD outside `/api/`. When a refused request's body was not read,
    the connection is closed after the error, so the rest is not read as a new request.
  - Static files: `/` is `index.html`; the path is decoded and resolved inside `public/`,
    and its real path (links followed) must also be inside, and a file; anything else,
    including a null byte or bad percent-encoding, is `not_found`. HEAD gets the headers.
  - Error responses are the fixed `{ error: { code, message } }` only, passed through
    `redact`. The log line per request has the path without the query string.
  - `main.js`: `PORT` must be a whole number from 0 to 65535 (0 picks a free port);
    `DATA_FILE` is resolved from the working folder, and the default is
    `data/inventory.json` in the repository. A bad `PORT` or a port in use stops the start
    with a message and exit code 1.
- **Tests:** the server listens on 127.0.0.1 (checked from `server.address()`); every route,
  with fakes; wrong `Host` and missing or foreign `Origin` are refused; oversized body; path
  traversal attempts (plain and percent-encoded) get `not_found`; security headers present;
  `.js` files are served as `text/javascript`. Also: a request with no `Host` (over a raw
  socket); a body of exactly 10 KB passes; a link out of `public/` (where the system allows
  creating one); unknown routes; an unexpected error logged but not shown; the log line's
  fields; the logger. `test/main.test.js` starts `src/main.js` as a child process: it serves
  on 127.0.0.1, and a damaged data file (left unchanged), a bad `PORT` or a port in use
  stop it. Requests go through `test/helpers/http-client.js`, which, unlike `fetch`, sends
  the `Host` it is given.
- **Key-leak test** (`test/key-leak.test.js`): uses a sentinel key and the real M2, M3, M4,
  M7 and M8, with the fake fetch answering 200, 401, 404, 429, 500, malformed JSON and a
  network error. It captures all log output, every HTTP response (status, headers, body), the
  data file and all fixture files, and asserts the sentinel is in none of them and in no
  request URL. It appears only in `Authorization` headers sent to the fake fetch.
  - The sentinel contains `"`, `\`, `+`, `/`, `%` and `=`, and each search looks for it as
    is, JSON-escaped and URL-encoded. Every error response must be exactly the fixed body
    for its code. One route fails with an unexpected error whose message holds the key, to
    check the logged stack is redacted and the response is the fixed `internal_error`.
- **Builder: Claude Code.** The last link of the key path (redaction, error responses,
  logging) plus the local server hardening; same reason as M2.

### M9. inventory-view

- **Responsibility:** pure functions behind the parts list: filters, search, sorting, totals,
  filter options. A plain ES module that runs both in the browser and under `node:test`.
- **Interface:**
  ```
  filterRows(rows, { colorId = null, categoryId = null, search = '', partNum = '',
                     name = '', minQuantity = null, maxQuantity = null }) -> InventoryRow[]
  sortRows(rows, { column = 'name', direction = 'asc' }) -> InventoryRow[]   // a copy
  SORT_COLUMNS -> ['partNum', 'name', 'colorName', 'categoryName', 'quantity']
  computeTotals(rows) -> { distinctParts, totalPieces }
  filterOptions(rows) -> { colors: [{ id, name, rgb }], categories: [{ id, name }] }
  ```
  Search is trimmed and case-insensitive, and matches part number or name; `partNum` and
  `name` do the same for one column each; the quantity bounds are inclusive (D27). Text
  sorts use the English numeric collator (D25), and ties fall back to name, part number and
  colour, ascending. An unknown sort column is a `TypeError`. Options list only values
  present in the rows, sorted by name using the same collator.
- **Tests:** each filter alone and combined with search; search by number and by name,
  ignoring case and outer spaces; the part number and name filters each match only their
  column; quantity bounds; no matches; totals on filtered rows (D9); options unique and
  sorted; every sort column both ways, with ties, numeric order and an unknown column.
- **Builder: Codex**, and from 2026-10-31 Claude Code at the user's request (column filters
  and sorting, D27), while Codex reviews and tests. Pure, and M10 is its only user.

### M10. web UI

- **Responsibility:** the page: `public/index.html`, `styles.css`, `placeholder.svg`,
  `js/api.js` (one function per route in section 7; returns data or throws
  `{ code, message }`) and `js/app.js` (the DOM).
- **Interface** (`js/api.js`):
  ```
  createApi({ fetch = globalThis.fetch }) -> {
    getStatus() -> { hasKey }              GET /api/status
    setKey(key) -> { hasKey }              PUT /api/key
    forgetKey() -> { hasKey }              DELETE /api/key
    listSets() -> SetSummary[]             GET /api/sets
    addSet(setNumber) -> SetSummary        POST /api/sets
    getSet(setNum) -> { set, rows }        GET /api/sets/{setNum, percent-encoded}
    removeSet(setNum) -> SetSummary|null   DELETE /api/sets/{setNum, percent-encoded}
    getInventory() -> InventoryRow[]       GET /api/inventory
  }
  ApiError: an Error with `code` and `message`
  ```
  An error response throws its own `{ code, message }`. No answer throws
  `server_unreachable`, and an answer without the expected field throws `internal_error`
  (section 7). Only requests with a body send `Content-Type: application/json`.
- **Behaviour:**
  - Header shows "API key set" or "No API key" and a "Forget key" button (R17), disabled
    while there is no key.
  - Add form for one or more set numbers, added one after another (D30). On `key_required`
    or `key_invalid` it opens a key dialog (password field,
    `autocomplete="off"`), sends `PUT /api/key`, clears the field, then retries the add. A
    key Rebrickable rejects keeps the dialog open with the error; Cancel or Escape stops the
    add. A PUT answering `hasKey: false` (the key was forgotten during the check, M8) asks
    again. It shows progress while adding, since an add takes several seconds.
  - Sets list (R7) in a panel that folds away, its summary counting sets and copies. Each
    set shows its facts (D30) and "Details" and "Remove one" buttons; a pack lists its
    contained sets. The part count is left out when Rebrickable reports 0, as it does for
    packs. A double click on a set, outside its buttons and link, opens its details.
  - The set details dialog: the set's image, facts and contained sets, and the parts of one
    copy with totals, sortable on every column independently of the parts list.
  - Parts list (R8-R10) with search, a filter and a sort on every column (D27), totals,
    and a "Clear filters" button. Headings are buttons and carry `aria-sort`; the headings
    and filter row stay in view while the list scrolls. Colour and category options come
    from the whole inventory; a chosen option that no longer exists falls back to "All".
    Text and quantity filters follow typing after 150 ms of quiet; a quantity bound that is
    negative or not a number is ignored.
  - After every change the page reloads the key status, sets and inventory together; when
    two reloads overlap, only the later one is shown.
    A successful add removes its number from the retry field before reloading, so a failed
    reload cannot add an extra copy on retry. A closed key dialog ignores its pending
    check's response, including when a later attempt has opened the same dialog again.
  - Images use `loading="lazy"` and `referrerpolicy="no-referrer"`, are tried only for
    https addresses, and fall back to the placeholder (R11).
  - Text from the API is inserted with `textContent` or DOM properties, never `innerHTML`.
  - The key is never kept in `localStorage`, `sessionStorage`, cookies or the URL.
- **Tests:** `test/app.test.js` executes the page with a small DOM stand-in: a failed refresh
  after an add leaves only outstanding numbers to retry; cancelled key checks that later
  succeed or fail cannot close, overwrite or enable a newer dialog's controls.
  `test/api.test.js`, with an injected fetch: every route's method, path, body
  and content type, and what each function returns; a set number percent-encoded into the
  path; the key only in the PUT body, never in the path or a header; an error response
  thrown as its code and message; answers that are not the expected JSON; an unreachable
  server. The DOM is checked by hand with the checklist in section 10, because a browser
  test runner would need a dependency (D3).
- **Builder: Claude Code** (moved from Codex at the user's request on 2026-10-31, together
  with M12). It depends only on section 7 and M9.

### M11. scene-layout

Removed (D32).

### M12. brick-scene

Removed (D32).

### M13. container-model

Removed (D32).

### M14. ldraw-library

Removed (D32).

### M15. model-view

Removed (D32).

## 9. Ownership and build order

| Phase | Claude Code (this machine) | Codex (other machine) | User |
| ----- | -------------------------- | --------------------- | ---- |
| 0 | M0 (including vendored three.js) and `container-spec.js` from M13; then answer F1-F7 and update this plan | | Capture fixtures |
| 1 | M2, M3, M4, M6, M13 | M1, M5, M9, M11 | Merge reviewed pull requests |
| 2 | M7, M8 (after phase 1 is merged); M12, M10 (moved from Codex) | | Merge reviewed pull requests |
| 3 | Review Codex's modules | Review Claude Code's modules, key path first | Manual checklist (section 10) |
| 4 | The user's requests of 2026-10-31 (D27-D31), M14, M15, and changes to M5, M9 and M11 | Review and test them | Capture the themes fixture; download the LDraw library |
| 5 | Remove the 3D view and the LDraw support (D32) | Review the removal | Merge the reviewed pull request |
| 6 | Prepare the final review: tests, open pull requests, documentation | Final review of the whole repository | Manual checklist (section 10); merge the reviewed pull request |

Phases 0-4 are the record of what was built. Phase 5 removed M11-M15, the vendored three.js
from M0 and the LDraw library step (D32), so those entries no longer describe the app. The
remaining modules, M0-M10, keep the builders given in section 8.

Not built yet: showing each set's theme, planned as the step after D30. Data format version 2
(D31) holds its data side: each set's `themeId` is saved, `themes` is part of the format, M5
has `addThemes`, and `scripts/capture-fixtures.js --themes` captures the list of themes. But
nothing calls `addThemes` outside its tests, so `themes` stays empty; the page shows no
theme; and no themes fixture is committed.

Each module gets its own branch and pull request, reviewed by the other tool before merging.
AGENTS.md has the details.

## 10. Testing

- **Runner:** `node:test` with `node:assert/strict`. `npm test` runs every test, offline.
- **No-network guard:** `test/setup/no-network.js` loads before every test file and replaces
  the global `fetch` with one that allows only `127.0.0.1` and `localhost` and throws for
  anything else. Modules take `fetch` as a parameter, and tests pass the fake fetch.
- **Fixtures:** captured by the user, never by an agent, with `scripts/capture-fixtures.js`.
  Hand-made fixtures are named `handmade-*.json`. The capture script refuses to write a file
  that contains the key, and the key-leak test scans every fixture.
- **Key-leak test:** see M8.
- **Manual checklist** (phases 3 and 6, by the user, with a real key):
  1. `npm start`, open `http://127.0.0.1:3000`. The page shows "No API key".
  2. Add `10270`. The key dialog opens. A wrong key is refused with a message; the right key
     is accepted. The set appears with its image and the parts list fills.
  3. Add `10270-1`. Copies become 2 and quantities double, with no key prompt.
  4. Remove one copy. Copies become 1 and quantities halve. Remove the last copy; the set and
     its parts disappear.
  5. Colour filter, category filter and search narrow the list, alone and together; totals
     follow.
  6. Restart the server. Sets and parts are unchanged; the page shows "No API key".
  7. Go offline. The page, filters, search, set details, removing a set and adding another
     copy of a saved set all work; images show the placeholder; adding a new set shows a
     clear error.
  8. "Forget key" updates the status; adding a new set asks for the key again.
  9. Search the data file and the server output for the key: no match.
  10. From another device on the same network, `http://<this machine's IP>:3000` does not
      connect.
  11. The part number and name filters, smallest and largest quantity, and the colour and
      category choices narrow the list, together and with the search; totals follow, and
      "Clear filters" brings every row back. Clicking a heading sorts by that column, and
      clicking it again reverses the order (D27).
  12. Add `31146 99999999; 42161`. The first and last are added one after the other, the
      middle one is reported as not added, and only `99999999` stays in the field (D30).
  13. "Your sets" folds and unfolds. "Details", and a double click on a set, open its facts
      and the parts of one copy, sortable like the parts list; for a pack the dialog lists
      the sets it contains. "Close" shuts it (D30).

## 11. Security summary

- **Key path:** browser, `PUT /api/key`, M8, `checkKey` in M3, memory in M2, then only the
  `Authorization` header in M3. Defences: header only (D8); fixed error messages; no logging
  of bodies or headers; `redact` on logs and error responses as a safety net; the status route
  returns only `hasKey`; the key-leak test.
- **Local server:** bound to 127.0.0.1; `Host` check against DNS rebinding; `Origin` and JSON
  content type for changes, against other websites; Content-Security-Policy and `textContent`
  only, because part and set names come from an external API; body size limit; static files
  confined to `public/`.
- **Third-party code:** none. The app has no dependencies (D3), and the page loads nothing
  from other sites except part and set images from `https://cdn.rebrickable.com` (D23). The
  vendored three.js was removed with the 3D view (D32).
