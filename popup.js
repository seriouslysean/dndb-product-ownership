const summaryEl = document.getElementById('summary');
const listEl = document.getElementById('product-list');
const filtersEl = document.getElementById('filters');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const loginGate = document.getElementById('login-gate');
const syncingGate = document.getElementById('syncing-gate');
const mainContent = document.getElementById('main-content');
const openMarketplace = document.getElementById('open-marketplace');

let currentData = null;
let activeFilters = new Set(); // Empty = show all

// --- Categorization ---

function categorizeProduct(product) {
    const id = product.id || '';
    const name = (product.name || '').toLowerCase();

    if (product.type === 'set') return 'Bundles';
    if (id.startsWith('DCE-') || id.startsWith('DD0') || name.includes('dice')) return 'Dice';
    if (id.startsWith('DM') && name.includes('map')) return 'Maps';
    if (id.startsWith('SC')) return 'Creature Packs';
    if (id.startsWith('SRC-') || name.includes('guide') || name.includes('handbook') || name.includes('manual')) return 'Sourcebooks';
    if (name.includes('adventure') || name.includes('campaign') || name.includes('module')) return 'Adventures';
    return 'Other';
}

const CATEGORY_ORDER = ['Sourcebooks', 'Adventures', 'Dice', 'Creature Packs', 'Maps', 'Other', 'Bundles'];

function categoryBadgeClass(category) {
    const map = {
        'Sourcebooks': 'sourcebook',
        'Adventures': 'adventure',
        'Dice': 'dice',
        'Maps': 'map',
        'Bundles': 'bundle',
        'Creature Packs': 'other',
        'Other': 'other',
    };
    return map[category] || 'other';
}

// --- View State ---

function showView(view) {
    loginGate.style.display = view === 'login' ? '' : 'none';
    syncingGate.style.display = view === 'syncing' ? '' : 'none';
    mainContent.style.display = view === 'main' ? '' : 'none';
}

// --- Filters ---

function renderFilters(groups) {
    filtersEl.innerHTML = '';

    for (const category of CATEGORY_ORDER) {
        const count = groups[category]?.length || 0;
        if (count === 0) continue;

        const chip = document.createElement('button');
        chip.className = 'filter-chip';
        if (activeFilters.size > 0 && !activeFilters.has(category)) {
            chip.classList.add('inactive');
        }
        chip.textContent = `${category} (${count})`;
        chip.addEventListener('click', () => {
            if (activeFilters.has(category)) {
                activeFilters.delete(category);
            } else {
                activeFilters.add(category);
            }
            // If all are now selected, clear to mean "show all"
            if (activeFilters.size === Object.keys(groups).filter(k => groups[k]?.length > 0).length) {
                activeFilters.clear();
            }
            render(currentData);
        });
        filtersEl.appendChild(chip);
    }
}

// --- Rendering ---

function render(data) {
    listEl.innerHTML = '';
    summaryEl.textContent = '';
    lastUpdatedEl.textContent = '';

    if (!data) {
        showView('login');
        return;
    }

    if (data.error) {
        if (data.error.includes('logged in') || data.error.includes('auth')) {
            showView('login');
        } else {
            showView('main');
            summaryEl.textContent = data.error;
            summaryEl.style.color = '#e74c3c';
        }
        return;
    }

    if (data.syncing) {
        showView('syncing');
        return;
    }

    showView('main');
    summaryEl.style.color = '';

    const allProducts = data.products || [];
    const totalNotOwned = allProducts.length;

    if (totalNotOwned === 0) {
        summaryEl.textContent = `You own everything! (${data.ownedCount} of ${data.totalCatalog})`;
        return;
    }

    // Group all products
    const groups = {};
    for (const product of allProducts) {
        const cat = categorizeProduct(product);
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(product);
    }

    renderFilters(groups);

    // Filter by active filters
    const visibleCategories = activeFilters.size > 0
        ? CATEGORY_ORDER.filter(c => activeFilters.has(c))
        : CATEGORY_ORDER;

    let visibleCount = 0;

    for (const category of visibleCategories) {
        const group = groups[category];
        if (!group || group.length === 0) continue;
        visibleCount += group.length;

        const section = document.createElement('div');
        section.className = 'group-section';

        const header = document.createElement('div');
        header.className = 'group-header';
        header.textContent = `${category} (${group.length})`;
        section.appendChild(header);

        for (const product of group) {
            const entry = document.createElement('a');
            entry.className = 'product-entry';
            entry.href = product.url || `https://marketplace.dndbeyond.com/category/${product.id}`;
            entry.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.tabs.create({ url: entry.href });
            });

            const nameEl = document.createElement('span');
            nameEl.className = 'product-name';
            nameEl.textContent = product.name;

            if (product.ownedChildCount != null) {
                const note = document.createElement('span');
                note.className = 'product-note';
                note.textContent = ` (${product.ownedChildCount}/${product.totalChildCount} owned)`;
                nameEl.appendChild(note);
            }

            if (product.missingChildren && product.missingChildren.length > 0) {
                for (const child of product.missingChildren) {
                    const childEl = document.createElement('div');
                    childEl.className = 'product-child-missing';
                    childEl.textContent = child.name;
                    nameEl.appendChild(childEl);
                }
            }

            const badge = document.createElement('span');
            badge.className = `type-badge ${categoryBadgeClass(category)}`;
            badge.textContent = category;

            entry.appendChild(nameEl);
            entry.appendChild(badge);
            section.appendChild(entry);
        }

        listEl.appendChild(section);
    }

    const filterNote = activeFilters.size > 0 ? ` (showing ${visibleCount})` : '';
    summaryEl.textContent = `${totalNotOwned} not owned, ${data.ownedCount} owned of ${data.totalCatalog}${filterNote}`;

    if (data.lastUpdated) {
        const date = new Date(data.lastUpdated);
        lastUpdatedEl.textContent = `Updated ${date.toLocaleString()}`;
    }
}

// --- Load Data ---

function loadData() {
    chrome.storage.local.get(STORAGE_KEY_NOT_OWNED, (result) => {
        currentData = result[STORAGE_KEY_NOT_OWNED] || null;
        render(currentData);
    });
}

// --- Open Marketplace ---

openMarketplace.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://marketplace.dndbeyond.com/' });
});

// --- Refresh ---

refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';
    showView('syncing');

    try {
        const tabs = await chrome.tabs.query({ url: 'https://marketplace.dndbeyond.com/*' });

        if (tabs.length === 0) {
            showView('login');
            loginGate.querySelector('p').textContent = 'Open marketplace.dndbeyond.com in a tab to refresh.';
            return;
        }

        chrome.tabs.sendMessage(tabs[0].id, { action: 'refresh' }, (response) => {
            if (chrome.runtime.lastError) {
                showView('login');
                loginGate.querySelector('p').textContent = 'Could not reach marketplace tab. Try reloading it.';
            }
        });
    } finally {
        setTimeout(() => {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
        }, 2000);
    }
});

// Listen for storage changes to re-render
chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY_NOT_OWNED]) {
        currentData = changes[STORAGE_KEY_NOT_OWNED].newValue || null;
        render(currentData);
    }
});

// Initial load
loadData();
