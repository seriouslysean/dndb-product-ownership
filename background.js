importScripts('shared.js');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(e => Logger.error('Failed to configure side panel:', e));

// Re-inject content scripts into existing marketplace tabs on install/update
chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://marketplace.dndbeyond.com/*' });
    for (const tab of tabs) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['shared.js', 'content.js'],
        }).catch(() => {}); // Tab may not be ready
    }
});

Logger.log('Background script loaded');
