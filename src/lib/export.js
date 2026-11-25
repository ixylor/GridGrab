/**
 * Export formats
 * ==============
 * Converts table data ({ headers, rows, columnCount }) into CSV or JSON text.
 *
 * Used by the popup (loaded with a <script> tag) and by the Node unit tests
 * (loaded with require), so it supports both.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Column names
  // ---------------------------------------------------------------------------

  /**
   * Makes sure every column has a usable, unique name:
   *   ['Name', '', 'Name']  ->  ['Name', 'Column 2', 'Name (2)']
   */
  function makeColumnNames(headers, columnCount) {
    const total = Math.max(columnCount || 0, headers.length);
    const timesSeen = new Map();
    const names = [];

    for (let i = 0; i < total; i++) {
      const baseName = (headers[i] || '').trim() || `Column ${i + 1}`;
      const count = (timesSeen.get(baseName) || 0) + 1;
      timesSeen.set(baseName, count);
      names.push(count === 1 ? baseName : `${baseName} (${count})`);
    }

    return names;
  }

  /**
   * For tables whose column names sit in an ordinary first row:
   *   { headers: [], rows: [['Name', 'Age'], ['Ada', '36']] }
   *     -> { headers: ['Name', 'Age'], rows: [['Ada', '36']] }
   */
  function useFirstRowAsHeaders(table) {
    if (table.rows.length === 0) return table;
    const [firstRow, ...otherRows] = table.rows;
    return { ...table, headers: firstRow, rows: otherRows };
  }

  // ---------------------------------------------------------------------------
  // Choosing columns
  // ---------------------------------------------------------------------------

  /**
   * Keeps only the chosen columns, in their original order.
   *
   *   selectColumns({ headers: ['A', 'B', 'C'], rows: [['1', '2', '3']] }, [0, 2])
   *     -> { headers: ['A', 'C'], rows: [['1', '3']], columnCount: 2 }
   */
  function selectColumns(table, columnIndexes) {
    const keep = [...columnIndexes].sort((a, b) => a - b);
    const pick = (values) => keep.map((index) => values[index] ?? '');

    return {
      ...table,
      headers: table.headers.length > 0 ? pick(table.headers) : [],
      rows: table.rows.map(pick),
      columnCount: keep.length,
    };
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  /**
   * Quotes a value when it contains a comma, quote or line break, or starts or
   * ends with a space (spreadsheet apps would otherwise trim it).
   */
  function escapeCsvValue(value) {
    const text = value == null ? '' : String(value);
    const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim();
    return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsvLine(values) {
    return values.map(escapeCsvValue).join(',');
  }

  /**
   * Standard CSV (RFC 4180) with Windows line endings, which every spreadsheet
   * app accepts. The header line is only included if the table has headers.
   */
  function toCSV({ headers, rows, columnCount }) {
    const lines = [];
    if (headers && headers.length > 0) {
      lines.push(toCsvLine(makeColumnNames(headers, columnCount)));
    }
    for (const row of rows) {
      lines.push(toCsvLine(row));
    }
    return lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // JSON
  // ---------------------------------------------------------------------------

  /**
   * One object per row, keyed by column name:
   *   [{ "Name": "Ada", "Role": "Engineer" }, ...]
   */
  function toRecords({ headers, rows, columnCount }) {
    const width = columnCount || (rows[0] ? rows[0].length : 0);
    const columnNames = makeColumnNames(headers || [], width);

    return rows.map((row) => {
      const record = {};
      columnNames.forEach((name, i) => {
        record[name] = row[i] ?? '';
      });
      return record;
    });
  }

  function toJSON(table) {
    return JSON.stringify(toRecords(table), null, 2);
  }

  // ---------------------------------------------------------------------------
  // File names
  // ---------------------------------------------------------------------------

  const MAX_FILE_NAME_LENGTH = 100;
  const CHARACTERS_NOT_ALLOWED_IN_FILE_NAMES = /[\\/:*?"<>|\u0000-\u001f]+/g;

  /** Builds a safe file name like "Page title - Employees" from the given parts. */
  function makeFileName(...parts) {
    const name = parts
      .filter(Boolean)
      .join(' - ')
      .replace(CHARACTERS_NOT_ALLOWED_IN_FILE_NAMES, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_FILE_NAME_LENGTH)
      .replace(/[. ]+$/, ''); // Windows doesn't allow names ending in a dot or space

    return name || 'table';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const exportFormats = { makeColumnNames, useFirstRowAsHeaders, selectColumns, toCSV, toRecords, toJSON, makeFileName };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportFormats;
  }
  globalThis.GridGrabExport = exportFormats;
})();
