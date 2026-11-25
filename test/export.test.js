const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toCSV,
  toJSON,
  toRecords,
  makeColumnNames,
  makeFileName,
  selectColumns,
  useFirstRowAsHeaders,
} = require('../src/lib/export.js');

test('useFirstRowAsHeaders: first row becomes the column names', () => {
  const table = { headers: [], rows: [['Name', 'Age'], ['Ada', '36']], columnCount: 2 };
  assert.deepEqual(useFirstRowAsHeaders(table), { headers: ['Name', 'Age'], rows: [['Ada', '36']], columnCount: 2 });
});

test('useFirstRowAsHeaders: empty table is left alone', () => {
  const table = { headers: [], rows: [], columnCount: 0 };
  assert.deepEqual(useFirstRowAsHeaders(table), table);
});

test('selectColumns: keeps chosen columns in original order', () => {
  const table = { headers: ['A', 'B', 'C'], rows: [['1', '2', '3'], ['4', '5', '6']], columnCount: 3 };
  assert.deepEqual(selectColumns(table, [2, 0]), {
    headers: ['A', 'C'],
    rows: [
      ['1', '3'],
      ['4', '6'],
    ],
    columnCount: 2,
  });
});

test('selectColumns: works on tables without headers', () => {
  const table = { headers: [], rows: [['x', 'y']], columnCount: 2 };
  assert.deepEqual(selectColumns(table, [1]), { headers: [], rows: [['y']], columnCount: 1 });
});

test('column names: blanks get "Column N" and duplicates get a number', () => {
  assert.deepEqual(makeColumnNames(['Name', '', 'Name', 'Name'], 5), [
    'Name',
    'Column 2',
    'Name (2)',
    'Name (3)',
    'Column 5',
  ]);
});

test('CSV: quotes values with commas, quotes, line breaks or edge spaces', () => {
  const table = {
    headers: ['a', 'b'],
    rows: [
      ['1,2', 'say "hi"'],
      ['line\nbreak', ' pad'],
    ],
    columnCount: 2,
  };
  assert.equal(toCSV(table), 'a,b\r\n"1,2","say ""hi"""\r\n"line\nbreak"," pad"\r\n');
});

test('CSV: no header line when the table has no headers', () => {
  assert.equal(toCSV({ headers: [], rows: [['x', 'y']], columnCount: 2 }), 'x,y\r\n');
});

test('JSON records: keyed by header, with generated names when missing', () => {
  assert.deepEqual(toRecords({ headers: [], rows: [['x', 'y']], columnCount: 2 }), [
    { 'Column 1': 'x', 'Column 2': 'y' },
  ]);
  assert.deepEqual(toRecords({ headers: ['k', 'k'], rows: [['1', '2']], columnCount: 2 }), [{ k: '1', 'k (2)': '2' }]);
});

test('JSON: output parses back to the same records', () => {
  const json = toJSON({ headers: ['n'], rows: [['1'], ['2']], columnCount: 1 });
  assert.deepEqual(JSON.parse(json), [{ n: '1' }, { n: '2' }]);
});

test('file names: illegal characters removed, fallback when empty', () => {
  assert.equal(makeFileName('My: Page / "Data"', 'Table 1'), 'My Page Data - Table 1');
  assert.equal(makeFileName('', ''), 'table');
});
