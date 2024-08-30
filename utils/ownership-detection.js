const PRODUCT_MESSAGE_TEXT = "You own this digital product";

// Check if the ownership message is present
const ownershipMessage = document.querySelector(`div:contains("${PRODUCT_MESSAGE_TEXT}")`);

const ACTIONS = {
    MARK_OWNED: 'markOwned',
    NOT_OWNED: 'notOwned',
};

// Send message to the background script based on the presence of the ownership message
chrome.runtime.sendMessage({
    action: ownershipMessage ? ACTIONS.MARK_OWNED : ACTIONS.NOT_OWNED,
    url: window.location.href,
});
