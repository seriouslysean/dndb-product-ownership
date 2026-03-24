// constants.js and shared.js are loaded before this file
// Pipeline runs in the background service worker.
// Content script triggers a refresh on marketplace page load.

chrome.runtime.sendMessage({ action: "refresh" }, () => {
  if (chrome.runtime.lastError) {
    Logger.warn("Failed to trigger background refresh", {
      error: chrome.runtime.lastError.message,
    });
  }
});
