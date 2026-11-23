/**
 * Pagination
 * ==========
 * Many tables only show one page of rows at a time ("Showing 1 to 50 of 61").
 * This file:
 *   - detects when a table is paginated,
 *   - finds the table's "Next" / "Previous" buttons,
 *   - walks through every page and collects the rows from each one.
 *
 * Reading DataTables tables directly (without clicking) happens in the popup,
 * because it needs the page's own JavaScript (see readAllDataTablesRows in popup.js).
 *
 * Depends on table-parser.js being loaded first.
 */
(function () {
  'use strict';

  const { ARIA_TABLE, parseTable } = globalThis.GridGrab;

  // "Showing 1 to 50 of 61 entries", "Showing 51 - 61 of 61"
  const PAGE_SUMMARY_PATTERN = /showing\s+([\d,]+)\s*(?:to|-|–)\s*([\d,]+)\s+of\s+([\d,]+)/i;
  const PAGE_SUMMARY_SELECTOR = '.dataTables_info, .dt-info';

  const CLICKABLE_SELECTOR = 'a, button, [role="button"]';
  const BUTTON_WORDS = {
    next: { words: ['next', 'next page'], symbols: ['›', '»', '>', '>>', '→'], className: /\bnext\b/i },
    previous: { words: ['previous', 'prev', 'previous page'], symbols: ['‹', '«', '<', '<<', '←'], className: /\b(previous|prev)\b/i },
  };

  // How far up from the table we look for its pagination controls.
  const MAX_ANCESTOR_LEVELS = 5;

  // Safety limits, so a broken page can never trap us in an endless loop.
  const MAX_PAGES = 500;
  const PAGE_CHANGE_TIMEOUT_MS = 15000;
  const POLL_INTERVAL_MS = 150;
  const SETTLE_TIME_MS = 400;

  // ---------------------------------------------------------------------------
  // Detecting pagination
  // ---------------------------------------------------------------------------

  /**
   * Returns null when the table isn't paginated, otherwise:
   *   { shown: 50, total: 61 }     when the page tells us the total
   *   { shown: 50, total: null }   when there's a Next button but no total
   */
  function detectPagination(table, visibleRowCount) {
    const summary = readPageSummary(table);
    if (summary) {
      const shown = summary.last - summary.first + 1;
      return summary.total > shown ? { shown, total: summary.total } : null;
    }

    return findPageButton(table, 'next') ? { shown: visibleRowCount, total: null } : null;
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
  // Finding the Next / Previous buttons
  // ---------------------------------------------------------------------------

  /**
   * Looks for an enabled Next (or Previous) button that belongs to this table.
   * We search outward from the table, but stop before reaching a container that
   * also holds other tables, so we never press another table's buttons.
   */
  function findPageButton(table, direction) {
    let container = table.parentElement;

    for (let level = 0; level < MAX_ANCESTOR_LEVELS && container && container !== document.body; level++) {
      if (containsOtherTables(container, table)) return null;

      const button = Array.from(container.querySelectorAll(CLICKABLE_SELECTOR)).find(
        (element) => !table.contains(element) && isPageButton(element, direction) && isUsable(element)
      );
      if (button) return button;

      container = container.parentElement;
    }
    return null;
  }

  function containsOtherTables(container, table) {
    // Header-only tables (e.g. the sticky-header copy DataTables makes) don't count.
    const hasDataCells = (other) => other.querySelector('td, [role="cell"], [role="gridcell"]') !== null;

    return Array.from(container.querySelectorAll(`table, ${ARIA_TABLE}`)).some(
      (other) => other !== table && !other.contains(table) && !table.contains(other) && hasDataCells(other)
    );
  }

  function isPageButton(element, direction) {
    const { words, symbols, className } = BUTTON_WORDS[direction];

    if (direction === 'next' && element.getAttribute('rel') === 'next') return true;
    if (direction === 'previous' && element.getAttribute('rel') === 'prev') return true;

    const label = (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().toLowerCase();
    if (words.some((word) => label === word || label.startsWith(word + ' '))) return true;

    const text = element.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
    if (words.includes(text) || symbols.includes(text)) return true;

    const classes = typeof element.className === 'string' ? element.className : '';
    return className.test(classes);
  }

  /** A button is usable if it's visible, enabled, and won't load a different web page. */
  function isUsable(element) {
    if (element.getClientRects().length === 0) return false;
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;

    // Bootstrap and DataTables mark the button or its <li> with a "disabled" class.
    const isMarkedDisabled = (el) => el && typeof el.className === 'string' && /\bdisabled\b/.test(el.className);
    if (isMarkedDisabled(element) || isMarkedDisabled(element.parentElement)) return false;

    return !loadsAnotherPage(element);
  }

  /**
   * A plain link like <a href="?page=2"> reloads the whole web page, which would
   * stop this script. We only press buttons that update the table in place.
   */
  function loadsAnotherPage(element) {
    if (element.tagName !== 'A') return false;
    const href = element.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;

    const target = new URL(href, location.href);
    const samePageIgnoringHash = target.href.split('#')[0] === location.href.split('#')[0];
    return !samePageIgnoringHash;
  }

  // ---------------------------------------------------------------------------
  // Walking through the pages
  // ---------------------------------------------------------------------------

  /**
   * Presses Next until the last page, collecting every row along the way.
   * Starts by going back to the first page so nothing is missed.
   *
   * @param {Element} table
   * @param {(progress: {page: number, rowCount: number}) => void} onProgress
   * @returns {Promise<{headers, rows, columnCount, pageCount}>}
   */
  async function collectAllPages(table, onProgress = () => {}) {
    const headers = parseTable(table).headers;
    let current = await goToFirstPage(table, headers);

    const pages = [];
    let previousRowsKey = null;

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const data = parseTable(current);
      const rowsKey = JSON.stringify(data.rows);
      if (rowsKey === previousRowsKey) break; // the page didn't actually change

      pages.push(data);
      previousRowsKey = rowsKey;
      onProgress({ page: pageNumber, rowCount: countRows(pages) });

      const nextButton = findPageButton(current, 'next');
      if (!nextButton) break; // last page

      const nextTable = await pressAndWaitForNewRows(nextButton, current, headers, rowsKey);
      if (!nextTable) break;
      current = nextTable;
    }

    return {
      headers: pages[0].headers,
      rows: pages.flatMap((page) => page.rows),
      columnCount: Math.max(...pages.map((page) => page.columnCount)),
      pageCount: pages.length,
    };
  }

  async function goToFirstPage(table, headers) {
    let current = table;

    for (let step = 0; step < MAX_PAGES; step++) {
      const previousButton = findPageButton(current, 'previous');
      if (!previousButton) break;

      const rowsKey = JSON.stringify(parseTable(current).rows);
      const previousTable = await pressAndWaitForNewRows(previousButton, current, headers, rowsKey);
      if (!previousTable) break;
      current = previousTable;
    }
    return current;
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

      const current = relocateTable(table, headers);
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

  /** Frameworks like React sometimes replace the whole table; find the new one by its headers. */
  function relocateTable(table, headers) {
    if (table.isConnected) return table;

    const sameHeaders = (candidate) => JSON.stringify(parseTable(candidate).headers) === JSON.stringify(headers);
    return Array.from(document.querySelectorAll(`table, ${ARIA_TABLE}`)).find(sameHeaders) || null;
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
