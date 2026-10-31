// The page (docs/plan.md M10): the key status, the add form and its key dialog, the sets list
// and each set's details, the 3D view (M12) and the parts list with a filter and a sort on
// every column, search and totals (M9). Text from the API goes in only through textContent
// and DOM properties, and the key is never kept anywhere: it leaves the dialog's field as
// soon as it is sent.

import { createApi } from './api.js';
import { createBrickScene } from './brick-scene.js';
import { computeTotals, filterOptions, filterRows, sortRows } from './inventory-view.js';

const PLACEHOLDER = 'placeholder.svg';
const SEARCH_DELAY = 150; // milliseconds of quiet typing before the list and view follow
// Errors that would stop every set still to come in the same way, so a batch stops there.
const BATCH_STOPPERS = new Set(['rate_limited', 'api_unavailable', 'server_unreachable']);

const api = createApi();
const byId = (id) => document.getElementById(id);
const page = {
  keyStatus: byId('key-status'),
  forgetKey: byId('forget-key'),
  addForm: byId('add-form'),
  setNumber: byId('set-number'),
  addButton: byId('add-button'),
  message: byId('message'),
  setsCount: byId('sets-count'),
  sets: byId('sets'),
  setsEmpty: byId('sets-empty'),
  scene: byId('scene'),
  noWebgl: byId('no-webgl'),
  toggleLids: byId('toggle-lids'),
  sceneHint: byId('scene-hint'),
  selection: byId('selection'),
  selectionText: byId('selection-text'),
  focusSelected: byId('focus-selected'),
  showAll: byId('show-all'),
  listSelected: byId('list-selected'),
  clearSelection: byId('clear-selection'),
  colorFilter: byId('color-filter'),
  categoryFilter: byId('category-filter'),
  search: byId('search'),
  filterPart: byId('filter-part'),
  filterName: byId('filter-name'),
  filterMin: byId('filter-min'),
  filterMax: byId('filter-max'),
  clearFilters: byId('clear-filters'),
  totals: byId('totals'),
  parts: byId('parts'),
  partsEmpty: byId('parts-empty'),
  setDialog: byId('set-dialog'),
  setDialogTitle: byId('set-dialog-title'),
  setDialogClose: byId('set-dialog-close'),
  setDialogMessage: byId('set-dialog-message'),
  setDialogBody: byId('set-dialog-body'),
  setDialogPicture: byId('set-dialog-picture'),
  setDialogFacts: byId('set-dialog-facts'),
  setDialogTotals: byId('set-dialog-totals'),
  setDialogParts: byId('set-dialog-parts'),
  keyDialog: byId('key-dialog'),
  keyForm: byId('key-form'),
  keyInput: byId('key-input'),
  keyMessage: byId('key-message'),
  keySave: byId('key-save'),
  keyCancel: byId('key-cancel'),
};

let rows = [];
let lidsOpen = false;
let refreshes = 0;
let searchTimer = 0;
let setRows = []; // the parts of the set shown in the details dialog
let setOpening = 0;

let selection = { selected: null, focused: null };
const scene = createBrickScene(page.scene, { onSelectionChange: showSelection });
if (scene === null) {
  page.scene.hidden = true;
  page.noWebgl.hidden = false;
  page.toggleLids.hidden = true;
  page.sceneHint.hidden = true;
}
const partsSort = sortable(page.parts.closest('table'), renderParts);
const setSort = sortable(page.setDialogParts.closest('table'), renderSetParts);

// Helpers that build elements with text, never markup.

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(text, label, onClick) {
  const node = element('button', null, text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.addEventListener('click', onClick);
  return node;
}

function count(number, one, many) {
  return `${number.toLocaleString('en')} ${number === 1 ? one : many}`;
}

// A Rebrickable image, or the placeholder when there is none or it cannot load (R11). Only
// https addresses are tried; the Content-Security-Policy narrows them to Rebrickable's.
function image(url, className, width, height) {
  const img = element('img', className);
  img.alt = '';
  img.width = width;
  img.height = height;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    img.src = PLACEHOLDER;
  }, { once: true });
  img.src = typeof url === 'string' && url.startsWith('https://') ? url : PLACEHOLDER;
  return img;
}

function say(text, { error = false, busy = false } = {}) {
  page.message.textContent = text;
  page.message.classList.toggle('error', error);
  page.message.classList.toggle('busy', busy);
}

function showKeyStatus(hasKey) {
  page.keyStatus.textContent = hasKey ? 'API key set' : 'No API key';
  page.keyStatus.classList.toggle('has-key', hasKey);
  page.forgetKey.disabled = !hasKey;
}

// Makes a table's headings sort it (D27): a heading sorts by its column, and the same heading
// again turns the order around. Returns the table's sort, which `render` reads.
function sortable(table, render) {
  const heads = [...table.querySelectorAll('th[data-sort]')];
  const sort = { column: 'name', direction: 'asc' };
  const show = () => {
    for (const head of heads) {
      if (head.dataset.sort === sort.column) {
        head.setAttribute('aria-sort', sort.direction === 'asc' ? 'ascending' : 'descending');
      } else {
        head.removeAttribute('aria-sort');
      }
    }
  };
  for (const head of heads) {
    head.querySelector('button').addEventListener('click', () => {
      const { sort: column } = head.dataset;
      sort.direction = sort.column === column && sort.direction === 'asc' ? 'desc' : 'asc';
      sort.column = column;
      show();
      render();
    });
  }
  show();
  return sort;
}

// Loading: the sets, the inventory and the key status, all at once.

async function refresh() {
  const mine = ++refreshes;
  const [status, sets, inventory] = await Promise.all([
    api.getStatus(), api.listSets(), api.getInventory(),
  ]);
  // A later refresh has started; its answers are newer than these.
  if (mine !== refreshes) {
    return;
  }
  showKeyStatus(status.hasKey);
  renderSets(sets);
  rows = inventory;
  renderFilters();
  renderParts();
}

function renderSets(sets) {
  const copies = sets.reduce((sum, set) => sum + set.copies, 0);
  page.setsCount.textContent = sets.length === 0 ? ''
    : `${count(sets.length, 'set', 'sets')}, ${count(copies, 'copy', 'copies')}`;
  page.setsEmpty.hidden = sets.length > 0;
  page.sets.replaceChildren(...sets.map(setItem));
}

function setItem(set) {
  const item = element('li', 'set');
  const info = element('div', 'set-info');
  info.append(element('p', 'set-name', set.name), setFacts(set));
  // A pack lists the sets inside it (R4).
  if (set.containedSets.length > 0) {
    info.append(element('p', 'contained-title', 'Contains'), containedList(set));
  }
  const actions = element('div', 'set-actions');
  const remove = button('Remove one', `Remove one copy of ${set.setNum} ${set.name}`,
    () => removeOne(set, remove));
  actions.append(button('Details', `Details of ${set.setNum} ${set.name}`, () => openSet(set)),
    remove);
  // A double click anywhere but on a button or link opens the details too.
  item.addEventListener('dblclick', (event) => {
    if (!event.target.closest('button, a')) {
      openSet(set);
    }
  });
  item.append(image(set.imgUrl, 'set-image', 96, 72), info, actions);
  return item;
}

// The facts about a set, as a list of terms and values.
function setFacts(set) {
  const facts = element('dl', 'set-facts');
  const fact = (term, value, title) => {
    const pair = element('div');
    const name = element('dt', null, term);
    if (title) {
      name.title = title;
    }
    pair.append(name, element('dd', null, value));
    facts.append(pair);
  };
  fact('Number', set.setNum);
  fact('Year', String(set.year));
  // Rebrickable reports 0 parts for a pack, whose parts are in the sets inside it.
  if (set.numParts > 0) {
    fact('Parts', set.numParts.toLocaleString('en'), 'As Rebrickable counts them');
  }
  fact('Pieces', set.pieces.toLocaleString('en'),
    'Every piece in one copy, spare and minifigure parts included');
  fact('Copies', String(set.copies));
  const link = element('a', null, 'Rebrickable page');
  link.href = `https://rebrickable.com/sets/${encodeURIComponent(set.setNum)}/`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const pair = element('div', 'set-link');
  pair.append(link);
  facts.append(pair);
  return facts;
}

function containedList(set) {
  const contained = element('ul', 'contained');
  for (const inner of set.containedSets) {
    contained.append(element('li', null, `${inner.quantity} x ${inner.setNum} ${inner.name}`));
  }
  return contained;
}

// The details dialog: a set's facts and the parts of one copy, sortable like the parts list.
async function openSet(set) {
  const mine = ++setOpening;
  page.setDialogTitle.textContent = `${set.setNum} ${set.name}`;
  page.setDialogBody.hidden = true;
  page.setDialogMessage.textContent = 'Loading the set.';
  if (!page.setDialog.open) {
    page.setDialog.showModal();
  }
  try {
    const details = await api.getSet(set.setNum);
    if (mine !== setOpening) {
      return;
    }
    page.setDialogPicture.replaceChildren(image(details.set.imgUrl, 'set-dialog-image', 240, 180));
    page.setDialogFacts.replaceChildren(element('p', 'set-name', details.set.name),
      setFacts(details.set));
    if (details.set.containedSets.length > 0) {
      page.setDialogFacts.append(element('p', 'contained-title', 'Contains'),
        containedList(details.set));
    }
    setRows = details.rows;
    renderSetParts();
    page.setDialogMessage.textContent = '';
    page.setDialogBody.hidden = false;
  } catch (error) {
    if (mine === setOpening) {
      page.setDialogMessage.textContent = error.message;
    }
  }
}

function renderSetParts() {
  const { distinctParts, totalPieces } = computeTotals(setRows);
  page.setDialogTotals.textContent = `${count(distinctParts, 'distinct part', 'distinct parts')}, `
    + count(totalPieces, 'piece', 'pieces');
  const body = document.createDocumentFragment();
  for (const row of sortRows(setRows, setSort)) {
    body.append(partRow(row));
  }
  page.setDialogParts.replaceChildren(body);
}

// Filters, search and sorting (R9, D10, D27). Colour and category are single choices from
// the whole inventory; every column can be filtered and sorted.

function renderFilters() {
  const { colors, categories } = filterOptions(rows);
  fillSelect(page.colorFilter, colors, 'All');
  fillSelect(page.categoryFilter, categories, 'All');
}

function fillSelect(select, options, allLabel) {
  const chosen = select.value;
  select.replaceChildren(new Option(allLabel, ''),
    ...options.map((option) => new Option(option.name, String(option.id))));
  // A choice whose last part went (a set was removed) falls back to all.
  select.value = options.some((option) => String(option.id) === chosen) ? chosen : '';
}

const chosenId = (select) => (select.value === '' ? null : Number(select.value));

// A quantity bound, or null when the field is empty or not a number of pieces.
function bound(input) {
  const value = Number(input.value);
  return input.value.trim() === '' || !Number.isFinite(value) || value < 0 ? null : value;
}

function renderParts() {
  const shown = filterRows(rows, {
    colorId: chosenId(page.colorFilter),
    categoryId: chosenId(page.categoryFilter),
    search: page.search.value,
    partNum: page.filterPart.value,
    name: page.filterName.value,
    minQuantity: bound(page.filterMin),
    maxQuantity: bound(page.filterMax),
  });
  const { distinctParts, totalPieces } = computeTotals(shown);
  page.totals.textContent = `${count(distinctParts, 'distinct part', 'distinct parts')}, `
    + count(totalPieces, 'piece', 'pieces');
  const body = document.createDocumentFragment();
  for (const row of sortRows(shown, partsSort)) {
    body.append(partRow(row));
  }
  page.parts.replaceChildren(body);
  page.partsEmpty.hidden = shown.length > 0;
  page.partsEmpty.textContent = rows.length === 0 ? 'No parts yet.' : 'No parts match.';
  // The view always shows the same rows as the list (R25).
  scene?.update(shown);
}

function partRow(row) {
  const cell = (text, className) => element('td', className, text);
  const color = element('td', 'color');
  const swatch = element('span', 'swatch');
  if (/^[0-9A-Fa-f]{6}$/.test(row.colorRgb)) {
    swatch.style.backgroundColor = `#${row.colorRgb}`;
  }
  swatch.classList.toggle('trans', row.colorIsTrans);
  color.append(swatch, document.createTextNode(row.colorName));
  const picture = element('td', 'picture');
  picture.append(image(row.imgUrl, 'part-image', 48, 48));
  const tr = element('tr');
  tr.append(picture, cell(row.partNum, 'part-num'), cell(row.name), color,
    cell(row.categoryName), cell(row.quantity.toLocaleString('en'), 'number'));
  return tr;
}

// Adding sets: one or several numbers, separated by spaces, commas or semicolons, added one
// after another. A new set needs the key: when the server has none, or Rebrickable rejected
// it, the dialog asks for one and the add is tried again (R14, R18).

async function addSets(event) {
  event.preventDefault();
  const wanted = page.setNumber.value.split(/[\s,;]+/).filter((text) => text !== '');
  if (wanted.length === 0) {
    return;
  }
  page.addButton.disabled = true;
  page.setNumber.readOnly = true;
  const added = [];
  const failed = [];
  let untried = [];
  try {
    for (const [index, setNumber] of wanted.entries()) {
      const step = wanted.length > 1 ? `${index + 1} of ${wanted.length}, ` : '';
      const outcome = await addOne(setNumber, step);
      if (outcome.set) {
        added.push(outcome.set);
        await refresh();
      } else {
        failed.push({ setNumber, message: outcome.message });
        if (outcome.stop) {
          untried = wanted.slice(index + 1);
          break;
        }
      }
    }
  } catch (error) {
    // A refresh that failed after an add: the set is saved, but the page could not show it.
    say(error.message, { error: true });
    return;
  } finally {
    page.addButton.disabled = false;
    page.setNumber.readOnly = false;
  }
  // What was not added stays in the field, ready to try again.
  page.setNumber.value = [...failed.map((item) => item.setNumber), ...untried].join(' ');
  say(addReport(added, failed, untried), { error: failed.length > 0 });
}

// Adds one set, asking for the key when needed. Resolves with { set } or with
// { message, stop }, where stop means the sets still to come should wait.
async function addOne(setNumber, step) {
  for (;;) {
    say(`Adding ${step}${setNumber}. Fetching a new set from Rebrickable can take several `
      + 'seconds.', { busy: true });
    try {
      return { set: await api.addSet(setNumber) };
    } catch (error) {
      if (error.code !== 'key_required' && error.code !== 'key_invalid') {
        return { message: error.message, stop: BATCH_STOPPERS.has(error.code) };
      }
      showKeyStatus(false);
      say('Waiting for the API key.', { busy: true });
      const saved = await askForKey(error.code === 'key_invalid' ? error.message : '');
      if (!saved) {
        return { message: 'No API key was given.', stop: true };
      }
    }
  }
}

function addReport(added, failed, untried) {
  const parts = [];
  if (added.length === 1 && failed.length === 0) {
    const [set] = added;
    return `Added ${set.setNum} ${set.name}. You have ${count(set.copies, 'copy', 'copies')}.`;
  }
  if (added.length > 0) {
    parts.push(`Added ${count(added.length, 'set', 'sets')}: `
      + `${added.map((set) => set.setNum).join(', ')}.`);
  }
  for (const { setNumber, message } of failed) {
    parts.push(`${setNumber} was not added: ${message}`);
  }
  if (untried.length > 0) {
    parts.push(`Not tried yet: ${untried.join(', ')}.`);
  }
  return parts.join(' ');
}

// Opens the key dialog and resolves with whether a key was saved. The field is cleared as
// soon as the key is sent, so it does not stay in the page.
function askForKey(notice) {
  return new Promise((resolve) => {
    let saved = false;
    page.keyMessage.textContent = notice;
    page.keyInput.value = '';
    page.keyDialog.showModal();
    page.keyInput.focus();

    async function submit(event) {
      event.preventDefault();
      const key = page.keyInput.value;
      page.keyInput.value = '';
      page.keySave.disabled = true;
      page.keyMessage.textContent = 'Checking the key with Rebrickable.';
      try {
        const { hasKey } = await api.setKey(key);
        showKeyStatus(hasKey);
        if (hasKey) {
          saved = true;
          page.keyDialog.close();
        } else {
          page.keyMessage.textContent = 'The key was forgotten while it was being checked. '
            + 'Enter it again.';
        }
      } catch (error) {
        page.keyMessage.textContent = error.message;
      } finally {
        page.keySave.disabled = false;
        page.keyInput.focus();
      }
    }
    page.keyForm.addEventListener('submit', submit);
    page.keyDialog.addEventListener('close', () => {
      page.keyForm.removeEventListener('submit', submit);
      page.keyInput.value = '';
      resolve(saved);
    }, { once: true });
  });
}

async function removeOne(set, button) {
  button.disabled = true;
  try {
    const left = await api.removeSet(set.setNum);
    await refresh();
    const name = `${set.setNum} ${set.name}`;
    say(left === null
      ? `Removed ${name}.`
      : `Removed one copy of ${name}. ${count(left.copies, 'copy', 'copies')} left.`);
  } catch (error) {
    say(error.message, { error: true });
    button.disabled = false;
  }
}

async function forgetKey() {
  page.forgetKey.disabled = true;
  try {
    showKeyStatus((await api.forgetKey()).hasKey);
    say('The API key is forgotten.');
  } catch (error) {
    page.forgetKey.disabled = false;
    say(error.message, { error: true });
  }
}

function clearFilters() {
  for (const input of [page.search, page.filterPart, page.filterName, page.filterMin,
    page.filterMax, page.colorFilter, page.categoryFilter]) {
    input.value = '';
  }
  clearTimeout(searchTimer);
  renderParts();
}

// The bar over the 3D view names the selected container and offers what to do with it
// (D28). It shows while a container is selected or the camera is on one.
function showSelection(state) {
  selection = state;
  const { selected, focused } = state;
  page.selection.hidden = selected === null && focused === null;
  page.selectionText.textContent = selected === null
    ? 'No container selected.'
    : `${selected.categoryName}: ${count(selected.pieces, 'piece', 'pieces')}`;
  page.focusSelected.hidden = selected === null || focused === selected.categoryId;
  page.showAll.hidden = focused === null;
  page.listSelected.hidden = selected === null;
  page.clearSelection.hidden = selected === null;
}

// Lists the selected container's parts: the category filter, which the 3D view follows too.
function listSelected() {
  if (selection.selected === null) {
    return;
  }
  page.categoryFilter.value = String(selection.selected.categoryId);
  renderParts();
  page.parts.closest('.table-wrap').scrollIntoView({ block: 'start' });
}

function toggleLids() {
  lidsOpen = !lidsOpen;
  scene?.setLidsOpen(lidsOpen);
  page.toggleLids.textContent = lidsOpen ? 'Close lids' : 'Open lids';
  page.toggleLids.setAttribute('aria-pressed', String(lidsOpen));
}

page.addForm.addEventListener('submit', addSets);
page.forgetKey.addEventListener('click', forgetKey);
page.keyCancel.addEventListener('click', () => page.keyDialog.close());
page.setDialogClose.addEventListener('click', () => page.setDialog.close());
page.toggleLids.addEventListener('click', toggleLids);
page.focusSelected.addEventListener('click', () => scene?.focus(selection.selected?.categoryId));
page.showAll.addEventListener('click', () => scene?.focus(null));
page.listSelected.addEventListener('click', listSelected);
page.clearSelection.addEventListener('click', () => scene?.select(null));
page.colorFilter.addEventListener('change', renderParts);
page.categoryFilter.addEventListener('change', renderParts);
for (const input of [page.search, page.filterPart, page.filterName, page.filterMin,
  page.filterMax]) {
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderParts, SEARCH_DELAY);
  });
}
page.clearFilters.addEventListener('click', clearFilters);

refresh().catch((error) => {
  say(error.message, { error: true });
});
