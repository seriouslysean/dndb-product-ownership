const summaryEl = document.getElementById('summary');
const listEl = document.getElementById('product-list');
const filtersEl = document.getElementById('filters');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const loginGate = document.getElementById('login-gate');
const loginMessage = document.getElementById('login-message');
const syncingGate = document.getElementById('syncing-gate');
const mainContent = document.getElementById('main-content');

let currentData = null;
let hiddenCategories = new Set(); // Categories the user has opted to hide

// --- Category Config (single source of truth) ---

const CATEGORIES = [
    { key: 'Sourcebooks', badge: 'sourcebook', match: (id, name) => id.startsWith('SRC-') || /guide|handbook|manual/i.test(name) },
    { key: 'Adventures', badge: 'adventure', match: (id, name) => /adventure|campaign|module/i.test(name) },
    { key: 'Dice', badge: 'dice', match: (id) => id.startsWith('DCE-') || id.startsWith('DD0') },
    { key: 'Creature Packs', badge: 'other', match: (id) => id.startsWith('SC') },
    { key: 'Maps', badge: 'map', match: (id, name) => id.startsWith('DM') && /map/i.test(name) },
    { key: 'Other', badge: 'other', match: () => false },
    { key: 'Bundles', badge: 'bundle', match: () => false },
];

const categorizeProduct = (product) => {
    if (product.type === 'set') return 'Bundles';
    const { id = '', name = '' } = product;
    return CATEGORIES.find(c => c.match(id, name))?.key || 'Other';
};

const badgeClassFor = (category) =>
    CATEGORIES.find(c => c.key === category)?.badge || 'other';

// --- Saved Filter Preferences ---

const loadFilterPrefs = async () => {
    const result = await chrome.storage.local.get(STORAGE_KEY_FILTER_PREFS);
    const prefs = result[STORAGE_KEY_FILTER_PREFS];
    if (Array.isArray(prefs)) hiddenCategories = new Set(prefs);
};

const saveFilterPrefs = () => {
    chrome.storage.local.set({ [STORAGE_KEY_FILTER_PREFS]: [...hiddenCategories] });
};

// --- View State ---

const showView = (view) => {
    loginGate.style.display = view === 'login' ? '' : 'none';
    syncingGate.style.display = view === 'syncing' ? '' : 'none';
    mainContent.style.display = view === 'main' ? '' : 'none';
};

// --- Rendering ---

const renderFilters = (groups) => {
    filtersEl.innerHTML = '';

    for (const { key } of CATEGORIES) {
        const count = groups[key]?.length || 0;
        if (count === 0) continue;

        const chip = document.createElement('button');
        const isHidden = hiddenCategories.has(key);
        chip.className = `filter-chip${isHidden ? ' inactive' : ''}`;
        chip.textContent = `${key} (${count})`;
        chip.title = isHidden ? `Show ${key}` : `Hide ${key}`;
        chip.addEventListener('click', () => {
            if (hiddenCategories.has(key)) {
                hiddenCategories.delete(key);
            } else {
                hiddenCategories.add(key);
            }
            saveFilterPrefs();
            render(currentData);
        });
        filtersEl.appendChild(chip);
    }
};

const render = (data) => {
    listEl.innerHTML = '';
    summaryEl.textContent = '';
    lastUpdatedEl.textContent = '';

    if (!data) { showView('login'); return; }
    if (data.syncing) { showView('syncing'); return; }
    if (data.errorCode === ERROR_NOT_AUTHENTICATED) { showView('login'); return; }
    if (data.errorCode) {
        showView('main');
        summaryEl.textContent = data.errorMessage || 'Something went wrong.';
        summaryEl.style.color = '#e74c3c';
        return;
    }

    showView('main');
    summaryEl.style.color = '';

    const products = data.products || [];

    if (products.length === 0) {
        summaryEl.textContent = `You own everything! (${data.ownedCount} of ${data.totalCatalog})`;
        return;
    }

    const groups = {};
    for (const product of products) {
        const cat = categorizeProduct(product);
        (groups[cat] ??= []).push(product);
    }

    renderFilters(groups);

    let visibleCount = 0;
    let hiddenCount = 0;

    for (const { key } of CATEGORIES) {
        const group = groups[key];
        if (!group?.length) continue;

        if (hiddenCategories.has(key)) {
            hiddenCount += group.length;
            continue;
        }

        visibleCount += group.length;

        const header = document.createElement('div');
        header.className = 'group-header';
        header.textContent = `${key} (${group.length})`;
        listEl.appendChild(header);

        for (const product of group) {
            const url = product.url || `https://marketplace.dndbeyond.com/category/${product.id}`;
            const entry = document.createElement('a');
            entry.className = 'product-entry';
            entry.href = url;
            entry.addEventListener('click', (e) => {
                e.preventDefault();
                if (url.startsWith('https://marketplace.dndbeyond.com/')) {
                    chrome.tabs.create({ url });
                }
            });

            const nameEl = document.createElement('span');
            nameEl.className = 'product-name';
            nameEl.textContent = product.name || '(unnamed)';

            if (product.ownedChildCount != null) {
                const note = document.createElement('span');
                note.className = 'product-note';
                note.textContent = ` (${product.ownedChildCount}/${product.totalChildCount} owned)`;
                nameEl.appendChild(note);
            }

            if (product.missingChildren?.length > 0) {
                for (const child of product.missingChildren) {
                    const childEl = document.createElement('div');
                    childEl.className = 'product-child-missing';
                    childEl.textContent = child.name || '(unnamed)';
                    nameEl.appendChild(childEl);
                }
            }

            const badge = document.createElement('span');
            badge.className = `type-badge ${badgeClassFor(key)}`;
            badge.textContent = key;

            entry.appendChild(nameEl);
            entry.appendChild(badge);
            listEl.appendChild(entry);
        }
    }

    const parts = [`${products.length} not owned, ${data.ownedCount} owned of ${data.totalCatalog}`];
    if (hiddenCount > 0) parts.push(`${hiddenCount} hidden`);
    if (visibleCount !== products.length && visibleCount > 0) parts.push(`showing ${visibleCount}`);
    summaryEl.textContent = parts.join(' · ');

    if (data.lastUpdated) {
        lastUpdatedEl.textContent = `Updated ${new Date(data.lastUpdated).toLocaleString()}`;
    }
};

// --- Actions ---

document.getElementById('open-marketplace').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://marketplace.dndbeyond.com/' });
});

refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';
    showView('syncing');

    const tabs = await chrome.tabs.query({ url: 'https://marketplace.dndbeyond.com/*' });

    if (tabs.length === 0) {
        showView('login');
        loginMessage.textContent = 'Open marketplace.dndbeyond.com in a tab to refresh.';
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
        return;
    }

    chrome.tabs.sendMessage(tabs[0].id, { action: 'refresh' }, () => {
        if (chrome.runtime.lastError) {
            showView('login');
            loginMessage.textContent = 'Could not reach marketplace tab. Try reloading it.';
        }
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
    });
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY_NOT_OWNED]) {
        currentData = changes[STORAGE_KEY_NOT_OWNED].newValue || null;
        render(currentData);
    }
});

// --- Init ---

(async () => {
    await loadFilterPrefs();
    const result = await chrome.storage.local.get(STORAGE_KEY_NOT_OWNED);
    currentData = result[STORAGE_KEY_NOT_OWNED] || null;
    render(currentData);
})();
