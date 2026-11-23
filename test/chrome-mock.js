/**
 * A fake "chrome" API so the real popup can run in a normal browser tab for
 * design work (see popup-preview.html). Downloads are recorded in
 * window.__downloads instead of being saved.
 */
(function () {
  'use strict';

  const donorHeaders = ['SNo.', 'KHD ID', 'Donor Name', 'Amount', "Father's Name", 'District', 'Submission Date', 'Donation Type'];
  const donorRow = (n) => [String(n), `KHD0${1000 + n}`, `Donor ${n}`, '₹100', `Father ${n}`, 'Hisar', '17/11/2026', 'BETI VIVAH HELP'];

  const tables = [
    {
      id: 1,
      label: 'Table 1: SNo., KHD ID, Donor Name',
      headers: donorHeaders,
      columnCount: 8,
      visibleRows: Array.from({ length: 50 }, (_, i) => donorRow(i + 1)),
      allRows: Array.from({ length: 61 }, (_, i) => donorRow(i + 1)),
      pagination: { shown: 50, total: 61 },
    },
    {
      // Long names, like the electoral-roll site, to check the layout doesn't overflow.
      id: 3,
      label: 'Table 2: AC Number, Part Number, Polling Station Name',
      headers: ['AC Number', 'Part Number', 'Polling Station Name (मतदान केंद्र का नाम और पता)', 'Link'],
      columnCount: 4,
      visibleRows: Array.from({ length: 50 }, (_, i) => ['341', String(i + 1), `मतदान केंद्र ${i + 1}`, 'Download']),
      allRows: Array.from({ length: 195 }, (_, i) => ['341', String(i + 1), `मतदान केंद्र ${i + 1}`, 'Download']),
      pagination: { shown: 50, total: null, pages: 4, more: false },
    },
    {
      id: 2,
      label: 'Employees',
      headers: ['Name', 'Role', 'Salary'],
      columnCount: 3,
      visibleRows: [
        ['Ada', 'Engineer', '120,000'],
        ['Grace', 'Admiral', '99,000'],
      ],
      pagination: null,
    },
  ];

  const messageListeners = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__downloads = [];

  async function handleMessage(message) {
    switch (message.type) {
      case 'listTables':
        return {
          pageTitle: 'B.V. HELP 01 | KHD INDIA',
          pageUrl: 'https://www.khdindia.com/details/37',
          tables: tables.map((t) => ({
            id: t.id,
            label: t.label,
            rowCount: t.visibleRows.length,
            columnCount: t.columnCount,
            headers: t.headers,
            previewRows: t.visibleRows.slice(0, 3),
            pagination: t.pagination,
          })),
        };
      case 'getTables':
        return {
          tables: tables
            .filter((t) => !message.ids || message.ids.includes(t.id))
            .map((t) => ({ id: t.id, label: t.label, headers: t.headers, rows: t.visibleRows, columnCount: t.columnCount })),
        };
      case 'collectAllPages': {
        const table = tables.find((t) => t.id === message.id);
        for (let page = 1; page <= 2; page++) {
          messageListeners.forEach((listener) => listener({ type: 'collectProgress', id: table.id, page, rowCount: page * 50 }));
          await sleep(700);
        }
        return { headers: table.headers, rows: table.allRows, columnCount: table.columnCount, pageCount: 2 };
      }
      default:
        return { ok: true };
    }
  }

  window.chrome = {
    tabs: {
      query: async () => [{ id: 1, url: 'https://www.khdindia.com/details/37' }],
      sendMessage: async (_tabId, message) => handleMessage(message),
    },
    scripting: {
      // Pretend the page isn't DataTables, so the click-through progress UI is shown.
      executeScript: async () => [{ result: null }],
    },
    downloads: {
      download: async ({ url, filename }) => {
        const content = await (await fetch(url)).text();
        window.__downloads.push({ filename, content });
      },
    },
    runtime: {
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      sendMessage: async () => {},
    },
  };
})();
