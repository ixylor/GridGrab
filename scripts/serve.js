/**
 * Local test server (no dependencies). Usage: npm run serve
 *
 *   /test/fixtures.html   tricky tables of every kind
 *   /test/webforms        imitates an ASP.NET WebForms GridView: page links are
 *                         __doPostBack() calls that reload the whole page
 *   /test/linked?page=2   pagination made of plain links to ?page=N
 *   anything else         served as a file from the project folder
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5179;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// 23 sample records shared by the pagination test pages.
const RECORDS = Array.from({ length: 23 }, (_, i) => ({
  part: String(i + 1),
  station: `मतदान केंद्र ${i + 1}`, // Hindi text checks that character sets survive
  voters: String(800 + i * 7),
}));

// -----------------------------------------------------------------------------
// Shared page pieces
// -----------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 24px auto; padding: 0 16px; }
    table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; }
    .pagination { display: flex; gap: 6px; list-style: none; padding: 0; }
    .pagination .active span { font-weight: bold; }
  </style>
</head>
<body>
${body}
<script src="/test/load-gridgrab.js"></script>
</body>
</html>`;
}

function recordRows(records) {
  return records
    .map((r) => `<tr><td>${r.part}</td><td>${escapeHtml(r.station)}</td><td>${r.voters}</td></tr>`)
    .join('\n');
}

// -----------------------------------------------------------------------------
// /test/webforms — ASP.NET GridView imitation
// -----------------------------------------------------------------------------
// 3 rows per page (8 pages), and like GridView the pager shows 3 page numbers
// at a time with "..." links to the previous/next block. The District dropdown
// must be sent back with every postback, or the server returns no rows.

const WEBFORMS_PAGE_SIZE = 3;
const WEBFORMS_BUTTONS_PER_BLOCK = 3;

function renderWebForms(fields) {
  const district = fields.District || '';
  const pageCount = Math.ceil(RECORDS.length / WEBFORMS_PAGE_SIZE);

  // The page number comes from the postback argument ("Page$4"), else from the view state.
  let page = Number(fields.__VIEWSTATE || 1);
  const argument = fields.__EVENTARGUMENT || '';
  if (fields.__EVENTTARGET === 'Grid' && argument.startsWith('Page$')) page = Number(argument.slice(5));
  page = Math.min(Math.max(page, 1), pageCount);

  const postbackLink = (targetPage, text) =>
    `<a href="javascript:__doPostBack('Grid','Page$${targetPage}')">${text}</a>`;

  const blockStart = Math.floor((page - 1) / WEBFORMS_BUTTONS_PER_BLOCK) * WEBFORMS_BUTTONS_PER_BLOCK + 1;
  const blockEnd = Math.min(blockStart + WEBFORMS_BUTTONS_PER_BLOCK - 1, pageCount);
  const pagerCells = [];
  if (blockStart > 1) pagerCells.push(postbackLink(blockStart - 1, '...'));
  for (let n = blockStart; n <= blockEnd; n++) {
    pagerCells.push(n === page ? `<span>${n}</span>` : postbackLink(n, n));
  }
  if (blockEnd < pageCount) pagerCells.push(postbackLink(blockEnd + 1, '...'));

  const rows = district ? RECORDS.slice((page - 1) * WEBFORMS_PAGE_SIZE, page * WEBFORMS_PAGE_SIZE) : [];

  return pageShell(
    'WebForms pagination test',
    `<h1>ASP.NET WebForms-style pagination</h1>
<p>Each page link posts the whole form back to the server. Expected export: <strong>23 rows</strong> and no "1 2 3" row.</p>
<form method="post" action="/test/webforms" id="aspnetForm">
  <input type="hidden" name="__EVENTTARGET" value="" />
  <input type="hidden" name="__EVENTARGUMENT" value="" />
  <input type="hidden" name="__VIEWSTATE" value="${page}" />
  <label>District
    <select name="District" onchange="this.form.submit()">
      <option value="">Select District</option>
      <option value="agra" ${district === 'agra' ? 'selected' : ''}>Agra</option>
    </select>
  </label>
  <table id="Grid" rules="all" border="1">
    <tr><th scope="col">Part</th><th scope="col">Polling Station</th><th scope="col">Voters</th></tr>
    ${recordRows(rows)}
    <tr class="grid-pager"><td colspan="3"><table><tr>${pagerCells.map((c) => `<td>${c}</td>`).join('')}</tr></table></td></tr>
  </table>
</form>
<script>
  function __doPostBack(target, argument) {
    const form = document.getElementById('aspnetForm');
    form.__EVENTTARGET.value = target;
    form.__EVENTARGUMENT.value = argument;
    form.submit();
  }
</script>`
  );
}

// -----------------------------------------------------------------------------
// /test/linked — plain ?page=N links
// -----------------------------------------------------------------------------

const LINKED_PAGE_SIZE = 10;

function renderLinked(query) {
  const pageCount = Math.ceil(RECORDS.length / LINKED_PAGE_SIZE);
  const page = Math.min(Math.max(Number(query.get('page')) || 1, 1), pageCount);
  const rows = RECORDS.slice((page - 1) * LINKED_PAGE_SIZE, page * LINKED_PAGE_SIZE);

  const items = [];
  items.push(page > 1 ? `<li><a href="?page=${page - 1}">Previous</a></li>` : '<li class="disabled"><span>Previous</span></li>');
  for (let n = 1; n <= pageCount; n++) {
    items.push(n === page ? `<li class="active"><span>${n}</span></li>` : `<li><a href="?page=${n}">${n}</a></li>`);
  }
  items.push(page < pageCount ? `<li><a href="?page=${page + 1}">Next</a></li>` : '<li class="disabled"><span>Next</span></li>');

  return pageShell(
    'Link pagination test',
    `<h1>Link pagination</h1>
<p>Each page is a separate address (?page=N). Open page 2 and export: expected <strong>23 rows</strong>, starting from page 1.</p>
<table>
  <thead><tr><th>Part</th><th>Polling Station</th><th>Voters</th></tr></thead>
  <tbody>${recordRows(rows)}</tbody>
</table>
<ul class="pagination">${items.join('')}</ul>`
  );
}

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------

function readFormBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(Object.fromEntries(new URLSearchParams(body))));
  });
}

function sendHtml(response, html) {
  response.writeHead(200, { 'Content-Type': CONTENT_TYPES['.html'] });
  response.end(html);
}

function sendFile(response, urlPath) {
  const file = path.join(ROOT, urlPath === '/' ? 'test/fixtures.html' : urlPath);
  if (!file.startsWith(ROOT)) return response.writeHead(403).end();

  fs.readFile(file, (error, data) => {
    if (error) return response.writeHead(404).end('Not found');
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' });
    response.end(data);
  });
}

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    // Let other sites' pages load these files during manual testing
    // (e.g. trying the parser on a real website from the browser console).
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') return response.writeHead(204).end();

    if (url.pathname === '/test/webforms') {
      const fields = request.method === 'POST' ? await readFormBody(request) : {};
      return sendHtml(response, renderWebForms(fields));
    }
    if (url.pathname === '/test/linked') {
      return sendHtml(response, renderLinked(url.searchParams));
    }
    sendFile(response, decodeURIComponent(url.pathname));
  })
  .listen(PORT, () => console.log(`Test pages at http://localhost:${PORT}/test/fixtures.html`));
