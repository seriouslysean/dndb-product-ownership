class Logger {
    static #logWithLevel(level, ...messages) {
        console[level]('[DNDBPO]:', ...messages);
    }

    static log(...messages) { this.#logWithLevel('log', ...messages); }
    static warn(...messages) { this.#logWithLevel('warn', ...messages); }
    static error(...messages) { this.#logWithLevel('error', ...messages); }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000; // One day in milliseconds
const DNDBPO_HEADER_NAME = 'X-Dndb-Product-Ownership-Request';
const STORAGE_KEY = 'dndbpo-product-ownership';

const isTargetUrl = (url) => /https:\/\/marketplace\.dndbeyond\.com\/mobify\/proxy\/api\/customer\/shopper-customers\/v1\/organizations\/f_ecom_bfst_prd\/customers\/[^/]+\?siteId=DDBUS$/.test(url);

const fetchAndStoreData = async (url, method, headers, body) => {
    try {
        // Add custom header to identify the request
        headers[DNDBPO_HEADER_NAME] = 'true';

        const response = await fetch(url, { method, headers, body });
        const data = await response.json();

        if (data.c_productsLicensed) {
            Logger.log('Captured c_productsLicensed:', data.c_productsLicensed);
            const now = Date.now();
            await chrome.storage.local.set({
                [STORAGE_KEY]: data.c_productsLicensed,
                lastCaptureTime: now // Update the last capture time
            });
        }
    } catch (error) {
        Logger.error('Error fetching response:', error);
    }
};

chrome.webRequest.onBeforeSendHeaders.addListener(
    async (details) => {
        const { url, method, requestHeaders, requestBody } = details;

        if (!isTargetUrl(url)) return;

        const hasCustomHeader = requestHeaders.some(header => header.name === DNDBPO_HEADER_NAME);

        if (hasCustomHeader) {
            Logger.log('Skipping request with custom header:', url);
            return;
        }

        const { lastCaptureTime = 0 } = await chrome.storage.local.get('lastCaptureTime');
        const now = Date.now();

        if (now - lastCaptureTime < ONE_DAY_MS) {
            Logger.log('Daily capture already complete.');
            return;
        }

        Logger.log('Intercepting request for daily capture:', url);

        // Add the custom header to the request
        requestHeaders.push({ name: DNDBPO_HEADER_NAME, value: 'true' });

        // Proceed with the request
        const body = requestBody ? new TextDecoder().decode(requestBody.raw[0].bytes) : undefined;
        await fetchAndStoreData(url, method, Object.fromEntries(requestHeaders.map(h => [h.name, h.value])), body);

        return { requestHeaders };
    },
    {
        urls: ["*://marketplace.dndbeyond.com/mobify/proxy/api/customer/shopper-customers/v1/organizations/f_ecom_bfst_prd/customers/*?siteId=DDBUS"]
    },
    ["requestHeaders"]
);

chrome.webRequest.onCompleted.addListener(
    async (details) => {
        const { url } = details;

        if (!isTargetUrl(url)) return;

        const { lastCaptureTime = 0 } = await chrome.storage.local.get('lastCaptureTime');
        const now = Date.now();

        if (now - lastCaptureTime < ONE_DAY_MS) {
            Logger.log('Daily capture already done, skipping interception.');
            return;
        }

        Logger.log('Capturing daily customer request:', url);

        // Since the request completed, fetch the response and store it
        const requestDetails = await chrome.storage.local.get('savedRequestDetails');

        if (!requestDetails || !requestDetails.savedRequestDetails) {
            Logger.error('No saved request details found.');
            return;
        }

        const { method, requestHeaders, requestBody } = requestDetails.savedRequestDetails;
        const body = requestBody ? new TextDecoder().decode(requestBody.raw[0].bytes) : undefined;

        await fetchAndStoreData(url, method, Object.fromEntries(requestHeaders.map(h => [h.name, h.value])), body);

    },
    {
        urls: ["*://marketplace.dndbeyond.com/mobify/proxy/api/customer/shopper-customers/v1/organizations/f_ecom_bfst_prd/customers/*?siteId=DDBUS"]
    }
);

// Debugging helper: Log when the background script is loaded
Logger.log('Background script loaded');
