class Logger {
    static #logWithLevel(level, ...messages) {
        console[level](`[DNDB]:`, ...messages);
    }

    static log(...messages) { this.#logWithLevel('log', ...messages); }
    static warn(...messages) { this.#logWithLevel('warn', ...messages); }
    static error(...messages) { this.#logWithLevel('error', ...messages); }
}

const DEBOUNCE_DELAY = 500;
const PROCESS_INTERVAL = 1000;

const processedUrls = new Set();
let productQueue = [];

// Debounce function to avoid calling too frequently
const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};

const productSelectors = [
    // Carousels
    'a[data-testid^="sf-product-tile-"]',
    // Product Tiles
    'a[data-testid^="product-detail-link-"]',
];

const productSelectorsString = productSelectors.join(', ');

const processNextProduct = async () => {
    if (productQueue.length === 0) {
        Logger.log('No more products to process.');
        return;
    }

    const url = productQueue.shift();
    Logger.log('Processing product URL', { url });

    try {
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'checkOwnership', url }, (response) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(response);
            });
        });

        if (response.status !== 'success') {
            Logger.error('Failed to process product', { url });
            return;
        }

        const logMsg = response.owned ? 'owned' : 'not owned';
        Logger.log(logMsg, { url });

        // Process the next product after a delay
        setTimeout(processNextProduct, PROCESS_INTERVAL);
    } catch (error) {
        Logger.error('Error processing product', { url, error });
    }
};


const getProductURLs = debounce(() => {
    const productNodes = document.querySelectorAll(productSelectorsString);
    const productUrls = [...new Set([...productNodes].map(tile => tile.href))];

    const newUrls = productUrls.filter(url => !processedUrls.has(url));

    if (newUrls.length === 0) {
        Logger.log('No new products found');
        return;
    }

    newUrls.forEach(url => {
        processedUrls.add(url);
        productQueue.push(url);
    });

    if (productQueue.length > 0 && productQueue.length === newUrls.length) {
        processNextProduct();
    }
}, DEBOUNCE_DELAY);

const initObserver = () => {
    const observer = new MutationObserver((mutationsList) => {
        mutationsList.forEach(mutation => {
            const hasRelevantChild = mutation.type === 'childList' && mutation.target.querySelector('[data-testid]');

            if (!hasRelevantChild) return;

            getProductURLs();
        });
    });

    const appContainer = document.querySelector('#app');
    observer.observe(appContainer, {
        childList: true,
        subtree: true
    });
};

const init = () => {
    getProductURLs();
    initObserver();
};

document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
