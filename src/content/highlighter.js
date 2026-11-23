/**
 * Highlighter
 * ===========
 * Draws a blue box over a table on the page while the user hovers it in the popup,
 * so they can tell which table is which.
 */
(function () {
  'use strict';

  const OVERLAY_ATTRIBUTE = 'data-gridgrab-overlay';
  const OUTLINE_PADDING = 3;

  let overlay = null;

  function show(element) {
    clear();
    if (!element || !element.isConnected) return;

    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const box = element.getBoundingClientRect();
    overlay = document.createElement('div');
    overlay.setAttribute(OVERLAY_ATTRIBUTE, '');
    Object.assign(overlay.style, {
      position: 'absolute',
      left: `${box.left + window.scrollX - OUTLINE_PADDING}px`,
      top: `${box.top + window.scrollY - OUTLINE_PADDING}px`,
      width: `${box.width + OUTLINE_PADDING * 2}px`,
      height: `${box.height + OUTLINE_PADDING * 2}px`,
      outline: '3px solid #2563eb',
      background: 'rgba(37, 99, 235, 0.08)',
      borderRadius: '4px',
      pointerEvents: 'none', // never block clicks on the page
      zIndex: '2147483647',
    });
    document.body.appendChild(overlay);
  }

  function clear() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  /** Lets the page watcher ignore changes caused by our own overlay. */
  function isOverlay(node) {
    return node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(OVERLAY_ATTRIBUTE);
  }

  globalThis.GridGrab = Object.assign(globalThis.GridGrab || {}, {
    highlighter: { show, clear, isOverlay },
  });
})();
