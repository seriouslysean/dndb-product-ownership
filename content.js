class Logger {
    static #logWithLevel(level, ...messages) {
        console[level]('[DNDBPO]:', ...messages);
    }

    static log(...messages) { this.#logWithLevel('log', ...messages); }
    static warn(...messages) { this.#logWithLevel('warn', ...messages); }
    static error(...messages) { this.#logWithLevel('error', ...messages); }
}

const STORAGE_KEY = 'dndbpo-product-ownership';

chrome.storage.local.get(STORAGE_KEY, (data) => {
    Logger.log('Captured product ownership data:', data[STORAGE_KEY]);
});
