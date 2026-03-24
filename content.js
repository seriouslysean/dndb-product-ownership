// constants.js and shared.js are loaded before this file
// Pipeline runs in the background service worker.
// Content script reads auth token from page cookies and passes it to background.

const token = document.cookie.match(/token_DDBUS=([^;]+)/)?.[1];
const authToken = token ? decodeURIComponent(token).trim() : null;

chrome.runtime.sendMessage({ action: "refresh", authToken }, () => {
  if (chrome.runtime.lastError) {
    Logger.warn("Failed to trigger background refresh", {
      error: chrome.runtime.lastError.message,
    });
  }
});
