class Logger {
    static #logWithLevel(level, ...messages) {
        console[level]('[DNDBPO]:', ...messages);
    }

    static log(...messages) { this.#logWithLevel('log', ...messages); }
    static warn(...messages) { this.#logWithLevel('warn', ...messages); }
    static error(...messages) { this.#logWithLevel('error', ...messages); }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Storage keys
const STORAGE_KEY = 'dndbpo-product-ownership';
const STORAGE_KEY_CATALOG = 'dndbpo-product-catalog';
const STORAGE_KEY_NOT_OWNED = 'dndbpo-not-owned';
const STORAGE_KEY_LAST_CATALOG_FETCH = 'dndbpo-last-catalog-fetch';
const STORAGE_KEY_LICENSES_PAGE = 'dndbpo-licenses-page';

// API constants
const DNDBPO_HEADER_NAME = 'X-Dndb-Product-Ownership-Request';
const API_ORG = 'f_ecom_bfst_prd';
const API_SITE = 'DDBUS';
const API_BASE = '/mobify/proxy/api';

// Endpoint builders
const endpoints = {
    productSearch: (limit = 200) =>
        `${API_BASE}/search/shopper-search/v1/organizations/${API_ORG}/product-search?refine=cgid%3Droot&limit=${limit}&siteId=${API_SITE}`,
    productDetails: (ids, expand = '') =>
        `${API_BASE}/product/shopper-products/v1/organizations/${API_ORG}/products?ids=${encodeURIComponent(ids.join(','))}&allImages=false&siteId=${API_SITE}${expand ? '&expand=' + expand : ''}`,
};

// Rate-limiting helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const BATCH_DELAY_MS = 300;
