/**
 * Table parser
 * ============
 * Turns one table element on the page into plain data:
 *
 *   {
 *     headers: ['Name', 'Age'],
 *     rows: [['Ada', '36'], ['Alan', '41']],
 *     columnCount: 2,
 *   }
 *
 * Works with real <table> elements and with "ARIA grids" (tables built from
 * <div>s with role="grid", common in React/Angular data-grid components).
 *
 * Content scripts can't use ES modules, so this file is a plain script that
 * adds its functions to the shared `globalThis.GridGrab` namespace.
 */
(function () {
  'use strict';

  const ARIA_TABLE = '[role="table"], [role="grid"], [role="treegrid"]';
  const ARIA_ROW = '[role="row"]';
  const ARIA_CELL = '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]';

  // A colspan bigger than this is a page bug. Capping it stops one broken
  // cell from producing thousands of empty columns.
  const MAX_COLUMN_SPAN = 1000;

  // ---------------------------------------------------------------------------
  // Reading cell text
  // ---------------------------------------------------------------------------

  function getCellText(cell) {
    // innerText matches what the user sees (it keeps <br> line breaks and drops
    // hidden text), but it only works for elements that are actually rendered.
    const isRendered = cell.getClientRects().length > 0;
    const text = isRendered ? cell.innerText : cell.textContent;
    return normalizeWhitespace(text);
  }

  function normalizeWhitespace(text) {
    return (text || '')
      .replace(/ /g, ' ') // non-breaking spaces become normal spaces
      .replace(/[ \t\r\f\v]+/g, ' ') // collapse runs of spaces and tabs
      .replace(/ *\n */g, '\n') // trim spaces around line breaks
      .replace(/\n{2,}/g, '\n') // collapse blank lines
      .trim();
  }

  // ---------------------------------------------------------------------------
  // Building a rectangular grid (handles rowspan / colspan)
  // ---------------------------------------------------------------------------

  /**
   * Places every cell on a grid, expanding rowspan and colspan.
   * A cell that covers several slots has its text repeated in each one,
   * so every row ends up with the same number of columns.
   *
   * @param {Array<Array<{text: string, rowSpan: number, colSpan: number}>>} rows
   * @returns {string[][]}
   */
  function buildGrid(rows) {
    const grid = rows.map(() => []);

    rows.forEach((cells, rowIndex) => {
      let columnIndex = 0;

      for (const cell of cells) {
        // Skip slots that a rowspan from an earlier row has already filled.
        while (grid[rowIndex][columnIndex] !== undefined) {
          columnIndex++;
        }

        const rowSpan = resolveRowSpan(cell.rowSpan, rows.length - rowIndex);
        const colSpan = clamp(cell.colSpan || 1, 1, MAX_COLUMN_SPAN);

        for (let r = 0; r < rowSpan; r++) {
          for (let c = 0; c < colSpan; c++) {
            const targetRow = grid[rowIndex + r];
            const targetColumn = columnIndex + c;
            if (targetRow[targetColumn] === undefined) {
              targetRow[targetColumn] = cell.text;
            }
          }
        }

        columnIndex += colSpan;
      }
    });

    return padRowsToSameLength(grid);
  }

  function resolveRowSpan(rowSpan, rowsRemaining) {
    // rowspan="0" is valid HTML and means "until the end of the table".
    if (rowSpan === 0) return rowsRemaining;
    return clamp(rowSpan || 1, 1, rowsRemaining);
  }

  function padRowsToSameLength(grid) {
    const columnCount = grid.reduce((widest, row) => Math.max(widest, row.length), 0);
    return grid.map((row) => {
      const padded = [];
      for (let i = 0; i < columnCount; i++) {
        padded.push(row[i] === undefined ? '' : row[i]);
      }
      return padded;
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // ---------------------------------------------------------------------------
  // Headers
  // ---------------------------------------------------------------------------

  /**
   * Combines several header rows into one label per column.
   * For example "Sales" above "Q1" becomes "Sales / Q1".
   */
  function mergeHeaderRows(headerRows, columnCount) {
    const headers = [];

    for (let column = 0; column < columnCount; column++) {
      const parts = [];
      for (const row of headerRows) {
        const label = row[column];
        const repeatsPrevious = parts[parts.length - 1] === label;
        if (label && !repeatsPrevious) parts.push(label);
      }
      headers.push(parts.join(' / '));
    }

    return headers;
  }

  /**
   * Splits the grid into header and body, and drops empty body rows.
   */
  function toTableData(grid, headerRowCount) {
    // A table made only of header cells is really just data.
    if (headerRowCount >= grid.length) headerRowCount = 0;

    const columnCount = grid.length > 0 ? grid[0].length : 0;
    const headerRows = grid.slice(0, headerRowCount);
    const bodyRows = grid.slice(headerRowCount).filter((row) => row.some((value) => value !== ''));

    return {
      headers: headerRows.length > 0 ? mergeHeaderRows(headerRows, columnCount) : [],
      rows: bodyRows,
      columnCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Pager rows
  // ---------------------------------------------------------------------------
  // Some tables keep their page links inside the table itself, as a row like
  // "1 2 3 4 … Next" (ASP.NET GridView and many server-rendered admin tables).

  const PAGER_CLASS_PATTERN = /\b(pager|pagination|paging|pagenav)\b/i;
  const PAGE_WORDS = new Set(['first', 'last', 'next', 'previous', 'prev', 'page', 'of', 'go', '...', '…', '«', '»', '‹', '›', '<', '>', '<<', '>>', '←', '→']);
  const CLICKABLE_SELECTOR = 'a, button, [role="button"], input[type="submit"], input[type="button"]';

  /**
   * A pager row is either marked as one by its class, or is a single cell
   * spanning the table that contains nothing but page numbers and
   * Next/Previous-style words, with at least one of them clickable.
   */
  function isPagerRow(row) {
    const classes = typeof row.className === 'string' ? row.className : '';
    if (PAGER_CLASS_PATTERN.test(classes)) return true;

    const isSingleSpanningCell = row.cells.length === 1 && row.cells[0].colSpan > 1;
    if (!isSingleSpanningCell || !row.querySelector(CLICKABLE_SELECTOR)) return false;

    const words = row.textContent.split(/\s+/).filter(Boolean);
    const isPageWord = (word) => /^\d+$/.test(word) || PAGE_WORDS.has(word.toLowerCase());
    if (!words.every(isPageWord)) return false;

    // Page numbers always go up: "1 2 3 4", never "12 3".
    const numbers = words.filter((word) => /^\d+$/.test(word)).map(Number);
    const goesUp = numbers.every((number, i) => i === 0 || number > numbers[i - 1]);
    return numbers.length >= 2 && goesUp;
  }

  // ---------------------------------------------------------------------------
  // <table> elements
  // ---------------------------------------------------------------------------

  function parseHtmlTable(table) {
    // table.rows only includes this table's own rows, never a nested table's.
    // Pager rows ("1 2 3 4 Next") are navigation, not data, so they're left out.
    const rowElements = Array.from(table.rows).filter((row) => !isPagerRow(row));

    const rows = rowElements.map((row) =>
      Array.from(row.cells).map((cell) => ({
        text: getCellText(cell),
        rowSpan: cell.rowSpan,
        colSpan: cell.colSpan,
      }))
    );

    return toTableData(buildGrid(rows), countHtmlHeaderRows(table, rowElements));
  }

  /**
   * Header rows are everything inside <thead>. Tables without a <thead> often
   * still start with a row of <th> cells, so we count those instead.
   */
  function countHtmlHeaderRows(table, rowElements) {
    const rowsInHead = rowElements.filter((row) => table.tHead && row.parentElement === table.tHead).length;
    if (rowsInHead > 0) {
      return rowsInHead;
    }

    let count = 0;
    for (const row of rowElements) {
      const cells = Array.from(row.cells);
      const isAllHeaderCells = cells.length > 0 && cells.every((cell) => cell.tagName === 'TH');
      if (!isAllHeaderCells) break;
      count++;
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // ARIA grids (<div role="grid"> and friends)
  // ---------------------------------------------------------------------------

  function parseAriaTable(container) {
    // Only take rows and cells that belong to this grid, not to a grid nested inside it.
    const rowElements = Array.from(container.querySelectorAll(ARIA_ROW)).filter(
      (row) => row.closest(ARIA_TABLE) === container
    );
    const cellsPerRow = rowElements.map((row) =>
      Array.from(row.querySelectorAll(ARIA_CELL)).filter((cell) => cell.closest(ARIA_ROW) === row)
    );

    const rows = cellsPerRow.map((cells) =>
      cells.map((cell) => ({
        text: getCellText(cell),
        rowSpan: parseInt(cell.getAttribute('aria-rowspan'), 10) || 1,
        colSpan: parseInt(cell.getAttribute('aria-colspan'), 10) || 1,
      }))
    );

    return toTableData(buildGrid(rows), countAriaHeaderRows(cellsPerRow));
  }

  function countAriaHeaderRows(cellsPerRow) {
    let count = 0;
    for (const cells of cellsPerRow) {
      const isAllHeaderCells = cells.length > 0 && cells.every((cell) => cell.getAttribute('role') === 'columnheader');
      if (!isAllHeaderCells) break;
      count++;
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function parseTable(element) {
    return element.tagName === 'TABLE' ? parseHtmlTable(element) : parseAriaTable(element);
  }

  globalThis.GridGrab = Object.assign(globalThis.GridGrab || {}, {
    ARIA_TABLE,
    CLICKABLE_SELECTOR,
    isPagerRow,
    normalizeWhitespace,
    buildGrid,
    mergeHeaderRows,
    parseTable,
  });
})();
