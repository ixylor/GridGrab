/**
 * DataTables reader
 * =================
 * DataTables (https://datatables.net) is the most common way sites paginate
 * tables. It keeps every row in memory and only draws one page at a time,
 * so instead of clicking through pages we can ask it for all rows at once.
 *
 * IMPORTANT: readAllDataTablesRows is not called here. The popup sends it into
 * the web page with chrome.scripting.executeScript({ world: 'MAIN' }), because
 * only the page's own JavaScript can reach its DataTables instance. That means
 * the function must be completely self-contained: no outside variables or helpers.
 *
 * Returns an array of rows (arrays of cell text), or null when the table isn't
 * a DataTables table that has all its rows in memory.
 */
function readAllDataTablesRows(tableId) {
  const table = document.querySelector(`[data-gridgrab-id="${tableId}"]`);

  // DataTables 2 exposes window.DataTable; older versions live on jQuery.
  const DataTables = window.DataTable || (window.jQuery && window.jQuery.fn && window.jQuery.fn.dataTable);
  if (!table || !DataTables || typeof DataTables.isDataTable !== 'function' || !DataTables.isDataTable(table)) {
    return null;
  }

  const api = new DataTables.Api(table);

  // "Server-side" tables only ever have the current page in memory.
  // For those, the content script clicks through the pages instead.
  const settings = api.settings()[0];
  if (settings && settings.oFeatures && settings.oFeatures.bServerSide) {
    return null;
  }

  const cleanText = (text) =>
    String(text == null ? '' : text)
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // DOMParser turns HTML into text without running any scripts in it.
  const htmlToText = (html) => new DOMParser().parseFromString(String(html), 'text/html').body.textContent;

  const rows = [];

  // "applied" = respect the user's current search filter and sort order.
  api.rows({ search: 'applied', order: 'applied' }).every(function () {
    const rowElement = this.node();

    if (rowElement) {
      rows.push(Array.from(rowElement.cells).map((cell) => cleanText(cell.textContent)));
    } else {
      // With "deferRender", rows that were never shown have no HTML yet,
      // so we ask DataTables what it would display in each visible column.
      const displayValues = api.cells(this.index(), ':visible').render('display').toArray();
      rows.push(displayValues.map((value) => cleanText(htmlToText(value))));
    }
  });

  return rows;
}
