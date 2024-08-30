const ACTIONS = {
    CHECK_OWNERSHIP: 'checkOwnership',
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === ACTIONS.CHECK_OWNERSHIP) {
        chrome.tabs.create({ url: request.url, active: false }, async (tab) => {
            const tabId = tab.id;

            const listener = async (tabIdUpdated, info) => {
                if (tabIdUpdated === tabId && info.status === 'complete') {
                    try {
                        console.log('Tab finished loading:', tabId);

                        const [result] = await chrome.scripting.executeScript({
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
                        });

                        console.log('Ownership status:', result.result.owned ? 'Owned' : 'Not Owned');
                        sendResponse({ status: 'success', owned: result.result.owned, tabId });
                    } catch (error) {
                        console.error('Error during script execution:', error);
                        sendResponse({ status: 'error', error });
                    } finally {
                        chrome.tabs.remove(tabId);
                    }

                    chrome.tabs.onUpdated.removeListener(listener);
                }
            };

            chrome.tabs.onUpdated.addListener(listener);
        });

        return true;  // Keep the message channel open for async response
    }
});

console.log("Background script is running");
