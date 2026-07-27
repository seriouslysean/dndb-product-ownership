(() => {
  // Pipeline runs in the background service worker.
  // Content script reads auth token from page cookies and passes it to background.

  const readAuthToken = () => {
    const token = document.cookie.match(/token_DDBUS=([^;]+)/)?.[1];
    return token ? decodeURIComponent(token).trim() : null;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== "get-auth-token") return false;
    sendResponse({ authToken: readAuthToken() });
    return false;
  });

  chrome.runtime.sendMessage({ action: "sync", authToken: readAuthToken() }, () => {
    if (chrome.runtime.lastError) {
      console.warn("[DNDBPO]: Failed to trigger background sync", {
        error: chrome.runtime.lastError.message,
      });
    }
  });
})();
