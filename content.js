class Logger {
    static #logWithLevel(level, ...messages) {
        console[level](`[DNDB]:`, ...messages);
    }

    static log(...messages) { this.#logWithLevel('log', ...messages); }
    static warn(...messages) { this.#logWithLevel('warn', ...messages); }
    static error(...messages) { this.#logWithLevel('error', ...messages); }
}

const DEBOUNCE_DELAY = 500;

// Track processed URLs to avoid duplicate checks
const processedUrls = new Set();

const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};

// Selector array for different parts of the site
const productSelectors = [
    // Carousels
    'a[data-testid^="sf-product-tile-"]',
    // Product Tiles
    'a[data-testid^="product-detail-link-"]',
];

// Combine selectors into a single query string
const productSelectorsString = productSelectors.join(', ');

const getProductURLs = debounce(() => {
    const productNodes = document.querySelectorAll(productSelectorsString);
    const productUrls = [...new Set([...productNodes].map(tile => tile.href))];

    // Filter out already processed URLs
    const newUrls = productUrls.filter(url => !processedUrls.has(url));

    // Exit early if no new URLs are found
    if (newUrls.length === 0) {
        Logger.log('No new products found');
        return;
    }

    // Mark products as processed so we don't check them again
    Logger.log('Checking for ownership on products', newUrls);
    newUrls.forEach(url => processedUrls.add(url));
}, DEBOUNCE_DELAY);

const initObserver = () => {
    const observer = new MutationObserver((mutationsList) => {
        mutationsList.forEach(mutation => {
            const hasRelevantChild = mutation.type === 'childList' && mutation.target.querySelector('[data-testid]');

            // If we don't find any products, get outta here
            if (!hasRelevantChild) {
                return;
            }

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

// Reinitialize observer on DOMContentLoaded or when the DOM is already loaded
document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
