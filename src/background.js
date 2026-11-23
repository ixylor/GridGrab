/**
 * Background script
 * =================
 * Shows how many tables the current tab has as a number on the toolbar icon.
 */
const browserApi = globalThis.browser ?? globalThis.chrome;

const BADGE_COLOR = '#2563eb';

function updateBadge(tabId, tableCount) {
  const hasTables = tableCount > 0;
  const plural = tableCount === 1 ? 'table' : 'tables';

  browserApi.action.setBadgeText({ tabId, text: hasTables ? String(tableCount) : '' });
  browserApi.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  browserApi.action.setTitle({
    tabId,
    title: hasTables ? `GridGrab: ${tableCount} ${plural} found` : 'GridGrab: no tables found',
  });
}

browserApi.runtime.onMessage.addListener((message, sender) => {
  const isFromTopFrameOfATab = sender.tab && sender.frameId === 0;

  if (message && message.type === 'tableCount' && isFromTopFrameOfATab) {
    updateBadge(sender.tab.id, message.count);
  }

  return false;
});
