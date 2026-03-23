importScripts('shared.js');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(e => Logger.error('Failed to configure side panel:', e));

Logger.log('Background script loaded');
