/**
 * Content script
 * ==============
 * Runs on every page. It:
 *   1. finds the tables on the page,
 *   2. keeps watching for new ones (single-page apps, data loaded later),
 *   3. tells the background script how many there are (for the toolbar badge),
 *   4. answers the popup's requests to list, export and highlight tables.
 *
 * Depends on table-parser.js, table-finder.js and highlighter.js being loaded first.
 */
(function () {
  'use strict';

  // The popup may inject this script again into a tab that already has it.
  if (globalThis.__tableGrabContentLoaded) return;
  globalThis.__tableGrabContentLoaded = true;

  const browserApi = globalThis.browser ?? globalThis.chrome;
  const { findTables, collectAllPages, highlighter } = globalThis.GridGrab;

  const RESCAN_DELAY_MS = 750;
  const PREVIEW_ROW_COUNT = 3;

  // Each table gets this attribute so code running in the page itself
  // (the DataTables reader in popup.js) can find the same element.
  const ID_ATTRIBUTE = 'data-gridgrab-id';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Tables found by the latest scan: [{ id, element, data, label, pagination }] */
  let tables = [];

  // Each table element keeps the same id across scans, so the popup can refer
  // to "table 3" even if the page re-renders around it.
  const idsByElement = new WeakMap();
  let nextId = 1;

  let lastReportedCount = null;

  // ---------------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------------

  function scanPage() {
    tables = findTables(document).map((table) => ({ ...table, id: getStableId(table.element) }));
    reportCountToBadge(tables.length);
    return tables;
  }

  function getStableId(element) {
    if (!idsByElement.has(element)) {
      const id = nextId++;
      idsByElement.set(element, id);
      element.setAttribute(ID_ATTRIBUTE, String(id));
    }
    return idsByElement.get(element);
  }

  function reportCountToBadge(count) {
    if (count === lastReportedCount) return;
    lastReportedCount = count;

    browserApi.runtime.sendMessage({ type: 'tableCount', count }).catch(() => {
      // The background script may be restarting; the next scan will report again.
    });
  }

  // ---------------------------------------------------------------------------
  // Watching the page for changes
  // ---------------------------------------------------------------------------

  let rescanTimer = null;

  function scheduleRescan() {
    // Pages often change many times in a burst, so wait until things settle.
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scanPage, RESCAN_DELAY_MS);
  }

  function isOnlyOurOverlay(mutation) {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return changedNodes.length > 0 && changedNodes.every(highlighter.isOverlay);
  }

  const pageWatcher = new MutationObserver((mutations) => {
    if (mutations.every(isOnlyOurOverlay)) return;
    scheduleRescan();
  });

  // ---------------------------------------------------------------------------
  // Messages from the popup
  // ---------------------------------------------------------------------------

  function summarize(table) {
    return {
      id: table.id,
      label: table.label,
      rowCount: table.data.rows.length,
      columnCount: table.data.columnCount,
      headers: table.data.headers,
      previewRows: table.data.rows.slice(0, PREVIEW_ROW_COUNT),
      pagination: table.pagination,
    };
  }

  function handleListTables() {
    return {
      pageTitle: document.title,
      pageUrl: location.href,
      tables: scanPage().map(summarize),
    };
  }

  function handleGetTables({ ids }) {
    scanPage();
    const wanted = ids ? tables.filter((table) => ids.includes(table.id)) : tables;
    return {
      tables: wanted.map((table) => ({ id: table.id, label: table.label, ...table.data })),
    };
  }

  function handleHighlight({ id }) {
    const table = tables.find((t) => t.id === id);
    if (table) highlighter.show(table.element);
    else highlighter.clear();
    return { ok: true };
  }

  /** Clicks through every page of a paginated table and returns all rows. */
  async function handleCollectAllPages({ id }) {
    const table = tables.find((t) => t.id === id);
    if (!table) throw new Error('That table is no longer on the page.');

    highlighter.clear();
    const reportProgress = ({ page, rowCount }) => {
      browserApi.runtime.sendMessage({ type: 'collectProgress', id, page, rowCount }).catch(() => {
        // The popup may have been closed; collecting continues anyway.
      });
    };

    const data = await collectAllPages(table.element, reportProgress);
    return { id, label: table.label, ...data };
  }

  const messageHandlers = {
    listTables: handleListTables,
    getTables: handleGetTables,
    highlight: handleHighlight,
    collectAllPages: handleCollectAllPages,
  };

  browserApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = message && messageHandlers[message.type];
    if (!handler) return false;

    // Handlers may be sync or async; either way, reply when the result is ready.
    Promise.resolve()
      .then(() => handler(message))
      .then(sendResponse, (error) => sendResponse({ error: error.message || String(error) }));
    return true; // keeps the message channel open for the async reply
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  scanPage();
  pageWatcher.observe(document.documentElement, { childList: true, subtree: true });
})();
