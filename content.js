(() => {
  // Pipeline runs in the background service worker.
  // Content script reads auth token from page cookies and passes it to background.

  const isExpiredJwt = (token) => {
    try {
      const payloadPart = token.replace(/^Bearer\s+/i, "").split(".")[1];
      if (!payloadPart) return false;

      const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      const expirySeconds = Number(JSON.parse(atob(padded)).exp);
      return Number.isFinite(expirySeconds) && expirySeconds * 1000 <= Date.now() + 30_000;
    } catch {
      return false;
    }
  };

  const readAuthToken = () => {
    const token = document.cookie.match(/token_DDBUS=([^;]+)/)?.[1];
    const decoded = token ? decodeURIComponent(token).trim() : null;
    return decoded && !isExpiredJwt(decoded) ? decoded : null;
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
