// The page (docs/plan.md M10): the key status, the add form and its key dialog, the sets list,
// the 3D view (M12) and the parts list with filters, search and totals (M9). Text from the API
// goes in only through textContent and DOM properties, and the key is never kept anywhere: it
// leaves the dialog's field as soon as it is sent.

import { createApi } from './api.js';
import { createBrickScene } from './brick-scene.js';
import { computeTotals, filterOptions, filterRows } from './inventory-view.js';

const PLACEHOLDER = 'placeholder.svg';
const SEARCH_DELAY = 150; // milliseconds of quiet typing before the list and view follow

const api = createApi();
const byId = (id) => document.getElementById(id);
const page = {
  keyStatus: byId('key-status'),
  forgetKey: byId('forget-key'),
  addForm: byId('add-form'),
  setNumber: byId('set-number'),
  addButton: byId('add-button'),
  message: byId('message'),
  sets: byId('sets'),
  setsEmpty: byId('sets-empty'),
  scene: byId('scene'),
  noWebgl: byId('no-webgl'),
  toggleLids: byId('toggle-lids'),
  colorFilter: byId('color-filter'),
  categoryFilter: byId('category-filter'),
  search: byId('search'),
  totals: byId('totals'),
  parts: byId('parts'),
  partsEmpty: byId('parts-empty'),
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

const scene = createBrickScene(page.scene);
if (scene === null) {
  page.scene.hidden = true;
  page.noWebgl.hidden = false;
  page.toggleLids.hidden = true;
}

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
  page.setsEmpty.hidden = sets.length > 0;
  page.sets.replaceChildren(...sets.map(setItem));
}

function setItem(set) {
  const item = element('li', 'set');
  const info = element('div', 'set-info');
  // Rebrickable reports 0 parts for a pack, whose parts are in the sets inside it.
  const meta = [set.setNum, set.year];
  if (set.numParts > 0) {
    meta.push(count(set.numParts, 'part', 'parts'));
  }
  info.append(
    element('p', 'set-name', set.name),
    element('p', 'set-meta', meta.join(', ')),
    element('p', 'set-copies', count(set.copies, 'copy', 'copies')),
  );
  // A pack lists the sets inside it (R4).
  if (set.containedSets.length > 0) {
    const contained = element('ul', 'contained');
    for (const inner of set.containedSets) {
      contained.append(element('li', null, `${inner.quantity} x ${inner.setNum} ${inner.name}`));
    }
    info.append(element('p', 'contained-title', 'Contains'), contained);
  }
  const remove = element('button', 'remove', 'Remove one');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove one copy of ${set.setNum} ${set.name}`);
  remove.addEventListener('click', () => removeOne(set, remove));
  item.append(image(set.imgUrl, 'set-image', 96, 72), info, remove);
  return item;
}

// Filters and search (R9, D10): single choice, options from the whole inventory.

function renderFilters() {
  const { colors, categories } = filterOptions(rows);
  fillSelect(page.colorFilter, colors, 'All colours');
  fillSelect(page.categoryFilter, categories, 'All categories');
}

function fillSelect(select, options, allLabel) {
  const chosen = select.value;
  select.replaceChildren(new Option(allLabel, ''),
    ...options.map((option) => new Option(option.name, String(option.id))));
  // A choice whose last part went (a set was removed) falls back to all.
  select.value = options.some((option) => String(option.id) === chosen) ? chosen : '';
}

const chosenId = (select) => (select.value === '' ? null : Number(select.value));

function renderParts() {
  const shown = filterRows(rows, {
    colorId: chosenId(page.colorFilter),
    categoryId: chosenId(page.categoryFilter),
    search: page.search.value,
  });
  const { distinctParts, totalPieces } = computeTotals(shown);
  page.totals.textContent = `${count(distinctParts, 'distinct part', 'distinct parts')}, `
    + count(totalPieces, 'piece', 'pieces');
  const body = document.createDocumentFragment();
  for (const row of shown) {
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

// Adding a set. A new set needs the key: when the server has none, or Rebrickable rejected
// it, the dialog asks for one and the add is tried again (R14, R18).

async function addSet(event) {
  event.preventDefault();
  const setNumber = page.setNumber.value.trim();
  if (setNumber === '') {
    return;
  }
  page.addButton.disabled = true;
  page.setNumber.readOnly = true;
  try {
    for (;;) {
      say(`Adding ${setNumber}. Fetching a new set from Rebrickable can take several seconds.`,
        { busy: true });
      try {
        const set = await api.addSet(setNumber);
        page.setNumber.value = '';
        await refresh();
        say(`Added ${set.setNum} ${set.name}. You have ${count(set.copies, 'copy', 'copies')}.`);
        return;
      } catch (error) {
        if (error.code !== 'key_required' && error.code !== 'key_invalid') {
          say(error.message, { error: true });
          return;
        }
        showKeyStatus(false);
        say('Waiting for the API key.', { busy: true });
        const saved = await askForKey(error.code === 'key_invalid' ? error.message : '');
        if (!saved) {
          say(`${setNumber} was not added, because no API key was given.`);
          return;
        }
      }
    }
  } finally {
    page.addButton.disabled = false;
    page.setNumber.readOnly = false;
  }
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

function toggleLids() {
  lidsOpen = !lidsOpen;
  scene?.setLidsOpen(lidsOpen);
  page.toggleLids.textContent = lidsOpen ? 'Close lids' : 'Open lids';
  page.toggleLids.setAttribute('aria-pressed', String(lidsOpen));
}

page.addForm.addEventListener('submit', addSet);
page.forgetKey.addEventListener('click', forgetKey);
page.keyCancel.addEventListener('click', () => page.keyDialog.close());
page.toggleLids.addEventListener('click', toggleLids);
page.colorFilter.addEventListener('change', renderParts);
page.categoryFilter.addEventListener('change', renderParts);
page.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderParts, SEARCH_DELAY);
});

refresh().catch((error) => {
  say(error.message, { error: true });
});
