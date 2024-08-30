const ACTIONS = {
    CHECK_OWNERSHIP: 'checkOwnership',
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === ACTIONS.CHECK_OWNERSHIP) {
        chrome.tabs.create({ url: request.url, active: false }, (tab) => {
            const tabId = tab.id;

            chrome.tabs.onUpdated.addListener(function listener(tabIdUpdated, info) {
                if (tabIdUpdated === tabId && info.status === 'complete') {
                    console.log('Tab finished loading:', tabId);

                    chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            const targetText = "You own this digital product";
                            return new Promise((resolve) => {
                                const observer = new MutationObserver((mutations, obs) => {
                                    if (document.body.innerText.includes(targetText)) {
                                        obs.disconnect(); // Stop observing once the text is found
                                        resolve({ owned: true });
                                    }
                                });

                                observer.observe(document.body, { childList: true, subtree: true });

                                setTimeout(() => {
                                    observer.disconnect(); // Stop observing after 10 seconds
                                    resolve({ owned: false });
                                }, 10000);
                            });
                        },
                    })
                    .then(([result]) => {
                        console.log('Ownership status:', result.result.owned ? 'Owned' : 'Not Owned');
                        chrome.tabs.remove(tabId);
                        sendResponse({ status: 'success', owned: result.result.owned, tabId });
                    })
                    .catch((error) => {
                        console.error('Error during script execution:', error);
                        chrome.tabs.remove(tabId);
                        sendResponse({ status: 'error', error });
                    });

                    chrome.tabs.onUpdated.removeListener(listener);
                }
            });
        });

        return true;  // Keep the message channel open for async response
    }
});

console.log("Background script is running");
