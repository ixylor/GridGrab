/**
 * Popup
 * =====
 * Lists the tables found on the current tab. For each table the user can:
 *   - choose which columns to keep,
 *   - include every page of a paginated table,
 *   - download it as CSV or JSON, or copy it to the clipboard.
 */
const browserApi = globalThis.browser ?? globalThis.chrome;
const { makeColumnNames, selectColumns, toCSV, toJSON, toRecords, makeFileName } = globalThis.GridGrabExport;

// Same files and order as "content_scripts" in manifest.json.
const CONTENT_SCRIPT_FILES = [
  'src/lib/table-parser.js',
  'src/lib/pager-controls.js',
  'src/lib/page-loader.js',
  'src/lib/pagination.js',
  'src/lib/table-finder.js',
  'src/content/highlighter.js',
  'src/content/content.js',
];

const SUPPORTED_PAGE = /^(https?|file):/;
const BUTTON_FEEDBACK_MS = 1400;
const BLOB_URL_LIFETIME_MS = 60_000;

let activeTab = null;
let pageTitle = '';

/** What the user chose for each table, by table id: { selectedColumns: Set<number>, includeAllPages: boolean } */
const choices = new Map();

/** Rows from every page, by table id, so we only walk the pages once per popup. */
const allPagesCache = new Map();

/** The card element for each table id, so progress messages can find it. */
const cards = new Map();

// =============================================================================
// Talking to the page
// =============================================================================

async function sendToPage(message) {
  const response = await browserApi.tabs.sendMessage(activeTab.id, message, { frameId: 0 });
  if (response && response.error) throw new Error(response.error);
  return response;
}

/**
 * Tabs that were already open when the extension was installed don't have the
 * content script yet. If the page doesn't answer, inject it and try again.
 */
async function listTablesOnPage() {
  try {
    return await sendToPage({ type: 'listTables' });
  } catch {
    await browserApi.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: CONTENT_SCRIPT_FILES,
    });
    return sendToPage({ type: 'listTables' });
  }
}

async function getVisibleTableData(tableId) {
  const { tables } = await sendToPage({ type: 'getTables', ids: [tableId] });
  if (tables.length === 0) throw new Error('That table is no longer on the page.');
  return tables[0];
}

function highlightOnPage(tableId) {
  sendToPage({ type: 'highlight', id: tableId }).catch(() => {});
}

/** Runs readAllDataTablesRows (datatables-reader.js) inside the web page. */
async function readRowsFromDataTables(tableId) {
  try {
    const [injection] = await browserApi.scripting.executeScript({
      target: { tabId: activeTab.id, frameIds: [0] },
      world: 'MAIN',
      func: readAllDataTablesRows,
      args: [tableId],
    });
    return injection ? injection.result : null;
  } catch {
    return null; // e.g. the page's security policy blocked it; fall back to clicking
  }
}

// =============================================================================
// Getting the data to export
// =============================================================================

/**
 * Returns the table data the user asked for: all pages (if chosen) and only
 * the selected columns.
 */
async function getExportData(table) {
  const choice = choices.get(table.id);
  const wantsAllPages = table.pagination && choice.includeAllPages;

  const data = wantsAllPages ? await getAllPagesData(table) : await getVisibleTableData(table.id);
  return selectColumns(data, choice.selectedColumns);
}

/**
 * First asks DataTables for every row (instant, nothing changes on screen).
 * If the table isn't DataTables, the content script clicks through the pages.
 */
async function getAllPagesData(table) {
  if (allPagesCache.has(table.id)) return allPagesCache.get(table.id);

  const visible = await getVisibleTableData(table.id);
  let data;

  const dataTablesRows = await readRowsFromDataTables(table.id);
  if (dataTablesRows && dataTablesRows.length > 0) {
    data = { ...visible, rows: dataTablesRows };
  } else {
    showProgress(table.id, 'Reading page 1…');
    data = await sendToPage({ type: 'collectAllPages', id: table.id });
  }

  allPagesCache.set(table.id, data);
  updateRowCount(table.id, data.rows.length);
  return data;
}

// =============================================================================
// Downloads and clipboard
// =============================================================================

async function saveFile(content, mimeType, fileName) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  try {
    await browserApi.downloads.download({ url, filename: fileName, saveAs: false });
  } finally {
    // Give the download time to start before freeing the memory.
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
  }
}

async function downloadTable(table, format) {
  const data = await getExportData(table);
  const fileName = makeFileName(pageTitle, table.label);

  if (format === 'csv') {
    // The byte-order mark tells Excel the file is UTF-8 (otherwise ₹, é, etc. are garbled).
    const byteOrderMark = '﻿';
    await saveFile(byteOrderMark + toCSV(data), 'text/csv;charset=utf-8', `${fileName}.csv`);
  } else {
    await saveFile(toJSON(data), 'application/json', `${fileName}.json`);
  }
}

/** Tab-separated text pastes straight into Excel or Google Sheets as cells. */
async function copyTable(table) {
  const data = await getExportData(table);
  const toCell = (value) => String(value).replace(/[\t\r\n]+/g, ' ');
  const toLine = (values) => values.map(toCell).join('\t');

  const lines = [];
  if (data.headers.length > 0) lines.push(toLine(data.headers));
  for (const row of data.rows) lines.push(toLine(row));

  await navigator.clipboard.writeText(lines.join('\n'));
}

async function downloadAllTablesAsJson(tables) {
  const exported = [];
  for (const table of tables) {
    const data = await getExportData(table);
    exported.push({ label: table.label, rows: toRecords(data) });
  }

  const content = {
    source: { title: pageTitle, url: activeTab.url, exportedAt: new Date().toISOString() },
    tables: exported,
  };
  await saveFile(JSON.stringify(content, null, 2), 'application/json', `${makeFileName(pageTitle, 'all tables')}.json`);
}

// =============================================================================
// Status, progress and button feedback
// =============================================================================

function showStatus(text, { isError = false, isLoading = false } = {}) {
  const status = document.querySelector('#status');
  status.hidden = !text;
  status.querySelector('.status-text').textContent = text || '';
  status.classList.toggle('error', isError);
  status.classList.toggle('loading', isLoading);
}

function showProgress(tableId, text) {
  const card = cards.get(tableId);
  if (!card) return;
  card.querySelector('.progress').hidden = false;
  card.querySelector('.progress-text').textContent = text;
}

function hideProgress(tableId) {
  const card = cards.get(tableId);
  if (card) card.querySelector('.progress').hidden = true;
}

function updateRowCount(tableId, rowCount) {
  const card = cards.get(tableId);
  if (!card) return;
  const detail = card.querySelector('.all-pages-detail');
  detail.textContent = `${rowCount} rows across all pages`;
}

function setCardBusy(card, isBusy) {
  for (const button of card.querySelectorAll('.actions button')) {
    button.disabled = isBusy || (button.dataset.needsColumns === 'true');
  }
}

function flashButton(button, text) {
  const label = button.querySelector('.button-text') || button.lastChild;
  const originalText = label.textContent;
  label.textContent = ` ${text}`;
  button.classList.add('done');
  setTimeout(() => {
    label.textContent = originalText;
    button.classList.remove('done');
  }, BUTTON_FEEDBACK_MS);
}

// Progress messages from the content script while it clicks through pages.
browserApi.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'collectProgress') {
    showProgress(message.id, `Reading page ${message.page}… ${message.rowCount} rows so far`);
  }
  return false;
});

// =============================================================================
// Building a table card
// =============================================================================

function createCard(table) {
  const template = document.querySelector('#table-card-template');
  const card = template.content.firstElementChild.cloneNode(true);
  cards.set(table.id, card);

  choices.set(table.id, {
    selectedColumns: new Set(Array.from({ length: table.columnCount }, (_, index) => index)),
    includeAllPages: true,
  });

  fillHeading(card, table);
  setUpAllPagesSwitch(card, table);
  setUpColumnPicker(card, table);
  setUpActions(card, table);

  card.addEventListener('mouseenter', () => highlightOnPage(table.id));
  card.addEventListener('mouseleave', () => highlightOnPage(null));

  return card;
}

function fillHeading(card, table) {
  const title = card.querySelector('.card-title');
  title.textContent = table.label;
  title.title = table.label;

  const rows = table.pagination && table.pagination.total ? `${table.pagination.total} rows` : `${table.rowCount} rows`;
  card.querySelector('.card-size').textContent = `${rows} · ${table.columnCount} columns`;
}

/** "61 rows in total · 50 shown on this page", "50 rows on this page · 4 pages", ... */
function describePagination({ shown, total, pages, more }) {
  if (total) return `${total} rows in total · ${shown} shown on this page`;
  if (pages) return `${shown} rows on this page · ${pages}${more ? '+' : ''} pages`;
  return `${shown} rows on this page · more on other pages`;
}

function setUpAllPagesSwitch(card, table) {
  if (!table.pagination) return;

  const container = card.querySelector('.all-pages');
  container.hidden = false;
  container.querySelector('.all-pages-detail').textContent = describePagination(table.pagination);

  container.querySelector('.all-pages-toggle').addEventListener('change', (event) => {
    choices.get(table.id).includeAllPages = event.target.checked;
  });
}

function setUpColumnPicker(card, table) {
  const selected = choices.get(table.id).selectedColumns;
  const list = card.querySelector('.column-list');
  const names = makeColumnNames(table.headers, table.columnCount);

  names.forEach((name, index) => {
    const option = document.createElement('label');
    option.className = 'column-option';
    option.title = name;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.column = String(index);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(index);
      else selected.delete(index);
      updateColumnSummary(card, table);
    });

    const text = document.createElement('span');
    text.textContent = name;

    option.append(checkbox, text);
    list.appendChild(option);
  });

  for (const button of card.querySelectorAll('[data-select]')) {
    button.addEventListener('click', () => {
      const selectAll = button.dataset.select === 'all';
      for (const checkbox of list.querySelectorAll('input')) {
        checkbox.checked = selectAll;
        const index = Number(checkbox.dataset.column);
        if (selectAll) selected.add(index);
        else selected.delete(index);
      }
      updateColumnSummary(card, table);
    });
  }

  updateColumnSummary(card, table);
}

function updateColumnSummary(card, table) {
  const selectedCount = choices.get(table.id).selectedColumns.size;
  const summary = card.querySelector('.column-summary');
  const noneSelected = selectedCount === 0;

  summary.textContent = noneSelected
    ? 'Pick at least one'
    : selectedCount === table.columnCount
      ? `All ${table.columnCount}`
      : `${selectedCount} of ${table.columnCount}`;
  summary.classList.toggle('warning', noneSelected);

  // Exporting zero columns makes no sense, so disable the buttons.
  for (const button of card.querySelectorAll('.actions button')) {
    button.dataset.needsColumns = String(noneSelected);
    button.disabled = noneSelected;
  }
}

function setUpActions(card, table) {
  card.querySelector('.actions').addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;

    setCardBusy(card, true);
    try {
      if (button.dataset.action === 'copy') {
        await copyTable(table);
        flashButton(button, 'Copied');
      } else {
        await downloadTable(table, button.dataset.format);
        flashButton(button, 'Saved');
      }
      showStatus('');
    } catch (error) {
      showStatus(error.message || String(error), { isError: true });
    } finally {
      hideProgress(table.id);
      setCardBusy(card, false);
    }
  });
}

// =============================================================================
// Start
// =============================================================================

function renderTables(tables) {
  const list = document.querySelector('#table-list');
  list.replaceChildren(...tables.map(createCard));
  list.hidden = tables.length === 0;

  const countPill = document.querySelector('#table-count');
  countPill.hidden = tables.length === 0;
  countPill.textContent = `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`;

  const bulkActions = document.querySelector('#bulk-actions');
  bulkActions.hidden = tables.length < 2;
  document.querySelector('#download-all').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await downloadAllTablesAsJson(tables);
      flashButton(button, 'Saved');
    } catch (error) {
      showStatus(error.message || String(error), { isError: true });
    } finally {
      button.disabled = false;
    }
  };
}

async function init() {
  [activeTab] = await browserApi.tabs.query({ active: true, currentWindow: true });

  if (!activeTab || !SUPPORTED_PAGE.test(activeTab.url || '')) {
    showStatus("GridGrab can't read this page. Browser pages and the extension store are off limits.", {
      isError: true,
    });
    return;
  }

  document.querySelector('#page-host').textContent = new URL(activeTab.url).hostname || activeTab.url;
  showStatus('Looking for tables…', { isLoading: true });

  try {
    const page = await listTablesOnPage();
    pageTitle = page.pageTitle;
    renderTables(page.tables);
    showStatus(page.tables.length > 0 ? '' : 'No tables found on this page.');
  } catch (error) {
    showStatus(`Couldn't scan this page: ${error.message || error}`, { isError: true });
  }
}

init();
