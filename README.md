# GridGrab

<img src="icons/icon-128.png" alt="GridGrab icon" width="64" align="right" />

Browser extension that finds the tables on any web page and exports them as **CSV** or **JSON**, including every page of paginated tables.
Chrome first (Manifest V3); written against the cross-browser WebExtensions API so Firefox and Safari ports stay small.

## Features

- **Finds tables automatically.** Real `<table>` elements and ARIA grids (`role="table" | "grid" | "treegrid"`, common in React/Angular data grids). The toolbar badge shows how many tables the page has and updates as the page changes.
- **Exports every page.** For paginated tables ("Showing 1 to 50 of 61"), switch on *Include all pages*:
  - DataTables tables are read directly from the page's memory: instant, and nothing on screen changes.
  - Other paginated tables are collected by pressing the table's *Next* button page by page, with progress shown in the popup.
- **Choose your columns.** Tick the columns to keep and untick the ones to drop before exporting.
- **CSV, JSON or Copy.** Copy puts tab-separated text on the clipboard that pastes into Excel or Google Sheets as cells. *Download all tables as JSON* exports every table on the page in one file.
- **Handles messy tables.** Skips layout, presentation and hidden tables; expands `colspan` / `rowspan`; merges multi-row headers (`Sales / Q1`).
- **Clean output.** CSV follows RFC 4180 and includes a UTF-8 byte-order mark so Excel shows ₹, é, 中文 correctly. JSON is an array of objects keyed by column name; blank headers become `Column 1`, duplicates become `Name (2)`.
- Hovering a table in the popup outlines it on the page.

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open any page with a table and click the GridGrab icon.

After changing the code, click the reload icon on the GridGrab card and refresh the web page.
For `file://` pages, also enable **Allow access to file URLs** on the extension's details page.

## Project layout

```
manifest.json                 MV3 manifest
icons/icon.svg                icon source (PNG sizes are rendered from it)
src/background.js             shows the table count on the toolbar badge
src/lib/table-parser.js       turns one table element into { headers, rows, columnCount }
src/lib/pagination.js         detects pagination and clicks through pages
src/lib/table-finder.js       finds data tables on a page and names them
src/lib/export.js             column selection, CSV / JSON conversion, file names
src/content/highlighter.js    outlines a table on the page while hovering it in the popup
src/content/content.js        ties it together: scans, watches for changes, answers the popup
src/popup/popup.*             popup UI
src/popup/datatables-reader.js  reads all rows of a DataTables table (runs inside the page)
test/export.test.js           unit tests for export.js
test/fixtures.html            test page covering the tricky cases, including a paginated table
test/popup-preview.html       the real popup with fake data, for design work
```

## Development

```powershell
npm test          # unit tests (Node 22+)
npm run serve     # serves test pages at http://localhost:5179
npm run icons     # re-renders icons/*.png from icons/icon.svg (uses your installed Chrome)
```

- `http://localhost:5179/test/fixtures.html` — open with the extension loaded to try every case.
- `http://localhost:5179/test/fixtures.html?selftest` — runs the parser without the extension and prints what it finds.
- `http://localhost:5179/test/popup-preview.html` — the popup in a normal tab with fake data.

## Porting notes

- **Firefox**: MV3 is supported, but Firefox uses `background.scripts` instead of `background.service_worker` and needs `browser_specific_settings.gecko.id`. Blob URLs created in the popup can be revoked when the popup closes, so downloads may need to move to the background script.
- **Safari**: wrap with `xcrun safari-web-extension-converter`; the code already uses `browser ?? chrome`.
- A small build step (per-browser manifests) becomes worthwhile once a second browser is added.

## Not yet handled

- Tables inside iframes (`all_frames` is off).
- Pagination made of plain links that load a new web page (`<a href="?page=2">`): only the current page is exported.
- Virtualized grids that only render the rows on screen: export covers just what's in the page.
- Number/date type detection: all values are exported as strings.
