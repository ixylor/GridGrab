/**
 * Pager controls
 * ==============
 * Finds a table's pagination controls and works out which one leads to the
 * next (or previous, or first) page. Understands:
 *
 *   - Next / Previous buttons:   "Next", "›", "»", class="next", rel="next"
 *   - Numbered page links:       "1 2 3 4 …"  -> the link for current page + 1
 *   - "…" links:                 jump to the next block of page numbers
 *   - Pagers inside the table:   a row of page links (ASP.NET GridView and others)
 *
 * Works on the live page and on copies of pages loaded in the background
 * (see page-loader.js). Background copies aren't rendered, so visibility
 * checks only apply to the live page.
 *
 * Depends on table-parser.js being loaded first.
 */
(function () {
  'use strict';

  const { ARIA_TABLE, CLICKABLE_SELECTOR, isPagerRow } = globalThis.GridGrab;

  // Containers that sites use for pagination outside the table.
  const PAGER_CONTAINER_SELECTOR =
    '.pagination, .pager, .paging, [class*="pagination"], [class*="pager"], [class*="paging"], nav[aria-label*="pag" i]';

  const DIRECTIONS = {
    next: {
      words: ['next', 'next page'],
      symbols: ['›', '»', '>', '>>', '→'],
      className: /\bnext\b/i,
      rel: 'next',
    },
    previous: {
      words: ['previous', 'prev', 'previous page'],
      symbols: ['‹', '«', '<', '<<', '←'],
      className: /\b(previous|prev)\b/i,
      rel: 'prev',
    },
    first: {
      words: ['first', 'first page'],
      symbols: ['|<', '|«', '⏮'],
      className: /\bfirst\b/i,
      rel: 'first',
    },
  };

  const ELLIPSIS = new Set(['...', '…']);
  const ACTIVE_CLASS = /\b(active|current|selected)\b/i;
  const DISABLED_CLASS = /\bdisabled\b/i;

  // How far up from the table we look for its pagination.
  const MAX_ANCESTOR_LEVELS = 5;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function getControlText(element) {
    const text = element.tagName === 'INPUT' ? element.value : element.textContent;
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getPageNumber(element) {
    const text = getControlText(element);
    return /^\d+$/.test(text) ? Number(text) : null;
  }

  function getClassName(element) {
    return element && typeof element.className === 'string' ? element.className : '';
  }

  function isOnLivePage(element) {
    return element.ownerDocument === document;
  }

  /** Enabled, visible (on the live page), and not marked as disabled. */
  function isUsable(element) {
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;

    // Bootstrap and DataTables mark the button or its <li> with a "disabled" class.
    if (DISABLED_CLASS.test(getClassName(element)) || DISABLED_CLASS.test(getClassName(element.parentElement))) {
      return false;
    }

    return !isOnLivePage(element) || element.getClientRects().length > 0;
  }

  function matchesDirection(element, direction) {
    const { words, symbols, className, rel } = DIRECTIONS[direction];

    if (element.getAttribute('rel') === rel) return true;

    const label = (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().toLowerCase();
    if (words.some((word) => label === word || label.startsWith(word + ' '))) return true;

    const text = getControlText(element);
    if (words.includes(text) || symbols.includes(text)) return true;

    return className.test(getClassName(element));
  }

  function comesAfter(element, other) {
    return Boolean(other.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  // ---------------------------------------------------------------------------
  // Where a table's controls live
  // ---------------------------------------------------------------------------

  /**
   * Containers around the table, from closest to furthest. We stop before a
   * container that holds another data table, so we never press another
   * table's buttons.
   */
  function getSurroundingContainers(table) {
    const containers = [];
    let container = table.parentElement;
    const body = table.ownerDocument.body;

    for (let level = 0; level < MAX_ANCESTOR_LEVELS && container; level++) {
      if (containsOtherTables(container, table)) break;
      containers.push(container);
      if (container === body) break; // never look beyond the page body
      container = container.parentElement;
    }
    return containers;
  }

  function containsOtherTables(container, table) {
    // Header-only tables (like the sticky-header copy DataTables makes) don't count,
    // and neither do the small layout tables that pagers are sometimes built from.
    const isDataTable = (other) => {
      const rowCount = other.tagName === 'TABLE' ? other.rows.length : other.querySelectorAll('[role="row"]').length;
      return rowCount >= 2 && other.querySelector('td, [role="cell"], [role="gridcell"]') !== null;
    };

    return Array.from(container.querySelectorAll(`table, ${ARIA_TABLE}`)).some(
      (other) => other !== table && !other.contains(table) && !table.contains(other) && isDataTable(other)
    );
  }

  /**
   * Areas that hold page numbers: pager rows inside the table, and pagination
   * blocks next to it. Numbered links are only trusted inside these, so a
   * stray "2" somewhere on the page is never mistaken for page 2.
   */
  function getPagerAreas(table) {
    const areas = [];

    if (table.tagName === 'TABLE') {
      areas.push(...Array.from(table.rows).filter(isPagerRow));
    }

    for (const container of getSurroundingContainers(table)) {
      for (const candidate of container.querySelectorAll(PAGER_CONTAINER_SELECTOR)) {
        if (!table.contains(candidate) && !areas.includes(candidate)) areas.push(candidate);
      }
    }

    return areas;
  }

  /** Clickable elements around the table, excluding the table's own data cells. */
  function getNearbyControls(table) {
    const pagerRows = table.tagName === 'TABLE' ? Array.from(table.rows).filter(isPagerRow) : [];
    const controls = [];

    for (const row of pagerRows) {
      controls.push(...row.querySelectorAll(CLICKABLE_SELECTOR));
    }
    for (const container of getSurroundingContainers(table)) {
      for (const control of container.querySelectorAll(CLICKABLE_SELECTOR)) {
        if (!table.contains(control) && !controls.includes(control)) controls.push(control);
      }
    }
    return controls;
  }

  // ---------------------------------------------------------------------------
  // Page numbers
  // ---------------------------------------------------------------------------

  /**
   * The page currently shown, read from a pager area. Sites show it as:
   *   - an element marked active/current (or aria-current="page"), or
   *   - a plain number that isn't a link, e.g. <span>1</span> 2 3 4.
   */
  function findCurrentPage(area) {
    for (const element of area.querySelectorAll('[aria-current="page"], [class]')) {
      const isMarkedCurrent =
        element.getAttribute('aria-current') === 'page' || ACTIVE_CLASS.test(getClassName(element));
      const number = isMarkedCurrent ? getPageNumber(element) : null;
      if (number !== null) return { number, element };
    }

    const walker = area.ownerDocument.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = textNode.textContent.trim();
      const isInsideControl = textNode.parentElement.closest(CLICKABLE_SELECTOR) !== null;
      if (/^\d+$/.test(text) && !isInsideControl) {
        return { number: Number(text), element: textNode.parentElement };
      }
    }

    return null;
  }

  function findNumberedControl(area, current, wantedNumber) {
    const controls = Array.from(area.querySelectorAll(CLICKABLE_SELECTOR)).filter(isUsable);

    const exact = controls.find((control) => getPageNumber(control) === wantedNumber);
    if (exact) return exact;

    // Long pagers show "… 4 5 6 …": the "…" after the current page opens the
    // next block of numbers, and the "…" before it opens the previous block.
    if (!current) return null;
    const ellipses = controls.filter((control) => ELLIPSIS.has(getControlText(control)));
    const goingForward = wantedNumber > current.number;
    return ellipses.find((control) => comesAfter(control, current.element) === goingForward) || null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** The control that shows the next page, or null on the last page. */
  function findNextControl(table) {
    const explicit = getNearbyControls(table).find((c) => matchesDirection(c, 'next') && isUsable(c));
    if (explicit) return explicit;

    for (const area of getPagerAreas(table)) {
      const current = findCurrentPage(area);
      if (!current) continue;
      const next = findNumberedControl(area, current, current.number + 1);
      if (next) return next;
    }
    return null;
  }

  /** The control that shows the previous page, or null on the first page. */
  function findPreviousControl(table) {
    const explicit = getNearbyControls(table).find((c) => matchesDirection(c, 'previous') && isUsable(c));
    if (explicit) return explicit;

    for (const area of getPagerAreas(table)) {
      const current = findCurrentPage(area);
      if (!current || current.number <= 1) continue;
      const previous = findNumberedControl(area, current, current.number - 1);
      if (previous) return previous;
    }
    return null;
  }

  /** A control that jumps straight to page 1, or null if we're already there. */
  function findFirstPageControl(table) {
    const areas = getPagerAreas(table);
    const currentPages = areas.map(findCurrentPage).filter(Boolean);
    if (currentPages.some((current) => current.number === 1)) return null;

    const explicit = getNearbyControls(table).find((c) => matchesDirection(c, 'first') && isUsable(c));
    if (explicit) return explicit;

    for (const area of areas) {
      const pageOne = findNumberedControl(area, null, 1);
      if (pageOne) return pageOne;
    }
    return null;
  }

  /** What the pager says about the page count: { currentPage, highestPage, hasMore } or null. */
  function readPagerNumbers(table) {
    for (const area of getPagerAreas(table)) {
      const current = findCurrentPage(area);
      const numbers = Array.from(area.querySelectorAll(CLICKABLE_SELECTOR))
        .map(getPageNumber)
        .filter((n) => n !== null);
      if (current) numbers.push(current.number);
      if (numbers.length < 2) continue;

      const hasMore = Array.from(area.querySelectorAll(CLICKABLE_SELECTOR)).some(
        (control) => ELLIPSIS.has(getControlText(control)) && current && comesAfter(control, current.element)
      );
      return { currentPage: current ? current.number : null, highestPage: Math.max(...numbers), hasMore };
    }
    return null;
  }

  globalThis.GridGrab = Object.assign(globalThis.GridGrab, {
    findNextControl,
    findPreviousControl,
    findFirstPageControl,
    readPagerNumbers,
  });
})();
