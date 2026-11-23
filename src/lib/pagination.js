/**
 * Pagination
 * ==========
 * Many tables only show one page of rows at a time. This file:
 *   - detects when a table is paginated (for the popup's "Include all pages"),
 *   - walks through every page and collects all the rows.
 *
 * Moving between pages works two ways (see page-loader.js):
 *   - Controls that update the table in place are pressed on the live page.
 *   - Controls that would load a new web page (links, ASP.NET postbacks, form
 *     buttons) are loaded in the background, so the user's page doesn't change.
 *
 * Reading DataTables tables directly (without changing pages) happens in the
 * popup, because it needs the page's own JavaScript (see datatables-reader.js).
 *
 * Depends on table-parser.js, pager-controls.js and page-loader.js.
 */
(function () {
  'use strict';

  const {
    ARIA_TABLE,
    parseTable,
    findNextControl,
    findPreviousControl,
    findFirstPageControl,
    readPagerNumbers,
    describeControl,
    loadPage,
  } = globalThis.GridGrab;

  // "Showing 1 to 50 of 61 entries", "Showing 51 - 61 of 61"
  const PAGE_SUMMARY_PATTERN = /showing\s+([\d,]+)\s*(?:to|-|–)\s*([\d,]+)\s+of\s+([\d,]+)/i;
  const PAGE_SUMMARY_SELECTOR = '.dataTables_info, .dt-info';

  // Safety limits, so a broken page can never trap us in an endless loop.
  const MAX_PAGES = 500;
  const PAGE_CHANGE_TIMEOUT_MS = 15000;
  const POLL_INTERVAL_MS = 150;
  const SETTLE_TIME_MS = 400;

  // A short pause between background page loads, to go easy on the website.
  const DELAY_BETWEEN_LOADS_MS = 200;

  // ---------------------------------------------------------------------------
  // Detecting pagination
  // ---------------------------------------------------------------------------

  /**
   * Returns null when the table isn't paginated, otherwise:
   *   { shown: 50, total: 61 }                       the page states the total
   *   { shown: 50, total: null, pages: 4, more }     the pager shows page numbers
   *   { shown: 50, total: null, pages: null }        there's just a Next button
   */
  function detectPagination(table, visibleRowCount) {
    const summary = readPageSummary(table);
    if (summary) {
      const shown = summary.last - summary.first + 1;
      return summary.total > shown ? { shown, total: summary.total } : null;
    }

    const hasOtherPages = findNextControl(table) || findPreviousControl(table);
    if (!hasOtherPages) return null;

    const pager = readPagerNumbers(table);
    return {
      shown: visibleRowCount,
      total: null,
      pages: pager ? pager.highestPage : null,
      more: pager ? pager.hasMore : false,
    };
  }

  function readPageSummary(table) {
    for (const text of getNearbyTexts(table)) {
      const match = text.match(PAGE_SUMMARY_PATTERN);
      if (!match) continue;

      const toNumber = (value) => parseInt(value.replace(/,/g, ''), 10);
      return { first: toNumber(match[1]), last: toNumber(match[2]), total: toNumber(match[3]) };
    }
    return null;
  }

  function getNearbyTexts(table) {
    const texts = [];

    // DataTables puts the summary in a known element inside its wrapper.
    const wrapper = table.closest('.dataTables_wrapper, .dt-container');
    if (wrapper) {
      for (const info of wrapper.querySelectorAll(PAGE_SUMMARY_SELECTOR)) {
        texts.push(info.textContent);
      }
    }

    // Other libraries usually put it right before or after the table.
    for (const sibling of [table.previousElementSibling, table.nextElementSibling]) {
      if (sibling) texts.push(sibling.textContent.slice(0, 300));
    }

    return texts;
  }

  // ---------------------------------------------------------------------------
  // Walking through the pages
  // ---------------------------------------------------------------------------
  // While walking we keep track of "where we are": the table element (on the
  // live page, or in a background copy of a later page) and that page's address.

  /**
   * Collects the rows from every page, starting from page 1.
   *
   * @param {Element} table
   * @param {(progress: {page: number, rowCount: number}) => void} onProgress
   * @returns {Promise<{headers, rows, columnCount, pageCount}>}
   */
  async function collectAllPages(table, onProgress = () => {}) {
    const headers = parseTable(table).headers;
    let position = await goToFirstPage({ table, url: location.href }, headers);

    const pages = [];
    let previousRowsKey = null;

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const data = parseTable(position.table);
      const rowsKey = JSON.stringify(data.rows);
      if (rowsKey === previousRowsKey) break; // the page didn't actually change

      pages.push(data);
      previousRowsKey = rowsKey;
      onProgress({ page: pageNumber, rowCount: countRows(pages) });

      const nextControl = findNextControl(position.table);
      if (!nextControl) break; // last page

      const nextPosition = await turnPage(position, nextControl, headers);
      if (!nextPosition) break;
      position = nextPosition;
    }

    return {
      headers: pages[0].headers,
      rows: pages.flatMap((page) => page.rows),
      columnCount: Math.max(...pages.map((page) => page.columnCount)),
      pageCount: pages.length,
    };
  }

  /** Jumps to page 1 (or steps back with Previous) so no rows are missed. */
  async function goToFirstPage(position, headers) {
    const firstPageControl = findFirstPageControl(position.table);
    if (firstPageControl) {
      const moved = await turnPage(position, firstPageControl, headers);
      if (moved) return moved;
    }

    for (let step = 0; step < MAX_PAGES; step++) {
      const previousControl = findPreviousControl(position.table);
      if (!previousControl) break;

      const moved = await turnPage(position, previousControl, headers);
      if (!moved) break;
      position = moved;
    }
    return position;
  }

  /**
   * Uses a pagination control and returns the new position, or null if the
   * page couldn't be changed.
   */
  async function turnPage(position, control, headers) {
    const action = describeControl(control, position.url);

    if (action.kind === 'unsupported') return null;

    if (action.kind === 'click') {
      // Buttons can only be pressed on the live page, not on a background copy.
      if (position.table.ownerDocument !== document) return null;

      const rowsKey = JSON.stringify(parseTable(position.table).rows);
      const table = await pressAndWaitForNewRows(control, position.table, headers, rowsKey);
      return table ? { table, url: position.url } : null;
    }

    await sleep(DELAY_BETWEEN_LOADS_MS);
    const loaded = await loadPage(action);
    const table = findSameTable(loaded.document, position.table, headers);
    return table ? { table, url: loaded.url } : null;
  }

  /**
   * Clicks the button, then waits until the table shows different rows and has
   * stopped changing (so we don't capture a half-loaded "Loading…" state).
   * Returns the table element (it may have been replaced), or null on timeout.
   */
  async function pressAndWaitForNewRows(button, table, headers, oldRowsKey) {
    button.click();

    const deadline = Date.now() + PAGE_CHANGE_TIMEOUT_MS;
    let lastKey = oldRowsKey;
    let stableSince = null;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const current = table.isConnected ? table : findSameTable(document, table, headers);
      if (!current) continue;

      const key = JSON.stringify(parseTable(current).rows);
      if (key === oldRowsKey) continue;

      if (key !== lastKey) {
        lastKey = key;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= SETTLE_TIME_MS) {
        return current;
      }
    }
    return null;
  }

  /**
   * Finds our table in another copy of the page (or after a framework
   * re-rendered it): by its id if it has one, otherwise by its headers.
   */
  function findSameTable(doc, originalTable, headers) {
    if (originalTable.id) {
      const byId = doc.getElementById(originalTable.id);
      if (byId) return byId;
    }

    const sameHeaders = (candidate) => JSON.stringify(parseTable(candidate).headers) === JSON.stringify(headers);
    return Array.from(doc.querySelectorAll(`table, ${ARIA_TABLE}`)).find(sameHeaders) || null;
  }

  function countRows(pages) {
    return pages.reduce((total, page) => total + page.rows.length, 0);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  globalThis.GridGrab = Object.assign(globalThis.GridGrab, {
    detectPagination,
    collectAllPages,
  });
})();
