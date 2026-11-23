/**
 * Loads GridGrab's page-reading code into a test page (without the extension),
 * so it can be tried from the browser console:
 *
 *   await gridGrabReady;
 *   GridGrab.findTables(document);
 *   await GridGrab.collectAllPages(document.querySelector('table'));
 *
 * Uses the same files, in the same order, as manifest.json, minus the parts
 * that need extension APIs (the highlighter and the messaging script).
 */
window.gridGrabReady = (async function loadGridGrab() {
  const manifest = await (await fetch('/manifest.json')).json();
  const libraryFiles = manifest.content_scripts[0].js.filter((file) => file.startsWith('src/lib/'));

  for (const file of libraryFiles) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `/${file}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Couldn't load ${file}`));
      document.head.appendChild(script);
    });
  }
  return window.GridGrab;
})();
