/**
 * Table finder
 * ============
 * Looks through a page and decides which tables are worth exporting.
 *
 * For each one it returns:
 *   - element:    the table element on the page
 *   - data:       { headers, rows, columnCount } from the table parser
 *   - label:      a human-friendly name for the popup ("Employees", "Table 2: City, Country")
 *   - pagination: { shown, total } if the table is split into pages, otherwise null
 *
 * Depends on table-parser.js and pagination.js being loaded first.
 */
(function () {
  'use strict';

  const { ARIA_TABLE, normalizeWhitespace, parseTable, detectPagination } = globalThis.GridGrab;

  const MAX_LABEL_LENGTH = 120;

  // ---------------------------------------------------------------------------
  // Which tables count
  // ---------------------------------------------------------------------------

  function isVisible(element) {
    if (element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  /**
   * Many sites (especially older ones) use tables for page layout, not data.
   * These rules filter those out while keeping real data tables.
   */
  function isDataTable(element, data) {
    const role = (element.getAttribute('role') || '').toLowerCase();
    if (role === 'presentation' || role === 'none') return false;

    const hasHeaders = data.headers.length > 0;
    const totalRows = data.rows.length + (hasHeaders ? 1 : 0);
    if (totalRows < 2) return false;

    // A single column with no headers is usually a layout list, not data.
    if (data.columnCount < 2 && !hasHeaders) return false;

    // Layout tables tend to wrap other tables and have no header row.
    if (element.tagName === 'TABLE') {
      const wrapsAnotherTable = element.querySelector('td table, th table') !== null;
      if (wrapsAnotherTable && !hasHeaders) return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Naming tables
  // ---------------------------------------------------------------------------

  function describeTable(element, data, position) {
    const explicitName = getExplicitName(element);
    if (explicitName) return explicitName.slice(0, MAX_LABEL_LENGTH);

    const firstHeaders = data.headers.filter(Boolean).slice(0, 3).join(', ');
    return firstHeaders ? `Table ${position}: ${firstHeaders}` : `Table ${position}`;
  }

  /** The name the page itself gives the table: <caption>, aria-label or aria-labelledby. */
  function getExplicitName(element) {
    if (element.tagName === 'TABLE' && element.caption) {
      const caption = normalizeWhitespace(element.caption.textContent);
      if (caption) return caption;
    }

    const ariaLabel = normalizeWhitespace(element.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;

    const labelledById = element.getAttribute('aria-labelledby');
    const labelElement = labelledById && document.getElementById(labelledById);
    return labelElement ? normalizeWhitespace(labelElement.textContent) : '';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function findTables(root = document) {
    const candidates = root.querySelectorAll(`table, ${ARIA_TABLE}`);
    const found = [];

    for (const element of candidates) {
      // Some components put role="grid" on a wrapper around a real <table>;
      // we'll pick up the <table> itself instead.
      const isAriaWrapperAroundTable = element.tagName !== 'TABLE' && element.querySelector('table');
      if (isAriaWrapperAroundTable) continue;
      if (!isVisible(element)) continue;

      const data = parseTable(element);
      if (!isDataTable(element, data)) continue;

      found.push({
        element,
        data,
        label: describeTable(element, data, found.length + 1),
        pagination: detectPagination(element, data.rows.length),
      });
    }

    return found;
  }

  globalThis.GridGrab = Object.assign(globalThis.GridGrab, { findTables });
})();
