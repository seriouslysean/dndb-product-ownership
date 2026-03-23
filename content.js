// shared.js is loaded before this file by the manifest

// --- Auth ---

function getAuthToken() {
    const match = document.cookie.match(/token_DDBUS=([^;]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1]).trim();
}

async function apiFetch(url) {
    const token = getAuthToken();
    if (!token) throw new Error('No auth token found. Are you logged in?');

    const response = await fetch(url, {
        headers: { 'Authorization': token }
    });

    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${url}`);
    }

    return response.json();
}

// --- Catalog Fetch ---

async function fetchCatalog(forceRefresh = false) {
    if (!forceRefresh) {
        const cached = await chrome.storage.local.get([STORAGE_KEY_CATALOG, STORAGE_KEY_LAST_CATALOG_FETCH]);
        const lastFetch = cached[STORAGE_KEY_LAST_CATALOG_FETCH] || 0;

        if (Date.now() - lastFetch < ONE_DAY_MS && cached[STORAGE_KEY_CATALOG]) {
            Logger.log('Using cached catalog');
            return cached[STORAGE_KEY_CATALOG];
        }
    }

    Logger.log('Fetching product catalog...');

    // 1. Get all products from search
    const searchData = await apiFetch(endpoints.productSearch(200));
    const hits = searchData.hits || [];
    Logger.log(`Found ${hits.length} products in catalog`);

    // Separate by type
    const masters = [];
    const sets = [];
    const items = [];

    for (const hit of hits) {
        const type = hit.productType;
        const entry = {
            id: hit.productId,
            name: hit.productName,
            type: type.master ? 'master' : type.set ? 'set' : type.variant ? 'variant' : 'item',
            image: hit.image?.link || null,
            url: `https://marketplace.dndbeyond.com/category/${hit.productId}`,
        };

        if (type.master) masters.push(entry);
        else if (type.set) sets.push(entry);
        else if (type.variant) continue; // Skip top-level variants, they belong to masters
        else items.push(entry);
    }

    // 2. Fetch details for all non-set products in batches of 20
    //    (masters need variants, items need isDigitalProduct)
    const allNonSets = [...masters, ...items];
    Logger.log(`Fetching details for ${allNonSets.length} products in batches of 20...`);
    for (let i = 0; i < allNonSets.length; i += 20) {
        if (i > 0) await delay(BATCH_DELAY_MS);
        const batch = allNonSets.slice(i, i + 20);
        const ids = batch.map(p => p.id);
        const data = await apiFetch(endpoints.productDetails(ids));

        for (const product of (data.data || [])) {
            const entry = batch.find(p => p.id === product.id);
            if (!entry) continue;

            entry.isDigitalProduct = product.c_isDigitalProduct ?? null;

            if (entry.type === 'master') {
                entry.variants = (product.variants || []).map(v => ({
                    id: v.productId,
                    values: v.variationValues,
                }));
                entry.hasDigitalVariant = entry.variants.some(v =>
                    v.values?.['Digital/Physical'] === 'Digital'
                );
            }
        }
    }

    // 3. Fetch bundle children for set products in batches of 10
    //    (uses expand=set_products on the batch endpoint)
    Logger.log(`Fetching bundle children for ${sets.length} set products...`);
    for (let i = 0; i < sets.length; i += 10) {
        if (i > 0) await delay(BATCH_DELAY_MS);
        const batch = sets.slice(i, i + 10);
        const ids = batch.map(s => s.id);
        const data = await apiFetch(endpoints.productDetails(ids, 'set_products'));

        for (const product of (data.data || [])) {
            const set = batch.find(s => s.id === product.id);
            if (!set) continue;
            set.children = (product.setProducts || []).map(sp => ({
                id: sp.id,
                name: sp.name,
            }));
            set.isDigitalProduct = product.c_isDigitalProduct ?? null;
        }
    }

    const catalog = [...masters, ...sets, ...items];

    // Cache
    await chrome.storage.local.set({
        [STORAGE_KEY_CATALOG]: catalog,
        [STORAGE_KEY_LAST_CATALOG_FETCH]: Date.now(),
    });

    Logger.log(`Catalog cached: ${catalog.length} products`);
    return catalog;
}

// --- Ownership Matching ---

function normalizeName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isProductOwned(productId, licensedIds, productName, licenseNames) {
    if (licensedIds.has(productId) || licensedIds.has('DB' + productId)) return true;
    // Name-based fallback: license names are often shorter versions of catalog names
    // e.g. "Elder Heart" (license) vs "Elder Heart Digital Dice Set" (catalog)
    // Only match if the license name is at least 8 chars to avoid false positives
    if (productName && licenseNames && licenseNames.size > 0) {
        const normalized = normalizeName(productName);
        for (const licenseName of licenseNames) {
            if (licenseName.length < 8) continue;
            if (normalized.includes(licenseName) || licenseName.includes(normalized)) return true;
        }
    }
    return false;
}

function computeNotOwned(catalog, ownershipData) {
    const licensedIds = new Set(ownershipData.ids);
    const licenseNames = ownershipData.names;
    const notOwned = [];

    for (const product of catalog) {
        // Skip physical-only products
        if (product.isDigitalProduct === false && !product.hasDigitalVariant) {
            continue;
        }

        let owned = false;

        if (product.type === 'item') {
            owned = isProductOwned(product.id, licensedIds, product.name, licenseNames);
        } else if (product.type === 'master') {
            // Check master ID and name directly
            owned = isProductOwned(product.id, licensedIds, product.name, licenseNames);

            // Check variant IDs
            if (!owned && product.variants) {
                owned = product.variants.some(v => isProductOwned(v.id, licensedIds, null, null));
            }
        } else if (product.type === 'set') {
            // Check set ID directly
            owned = isProductOwned(product.id, licensedIds, product.name, licenseNames);

            // If not directly owned, check if ALL children are owned
            if (!owned && product.children && product.children.length > 0) {
                const ownedChildren = product.children.filter(c => isProductOwned(c.id, licensedIds, c.name, licenseNames));
                if (ownedChildren.length === product.children.length) {
                    owned = true; // All children owned, skip this bundle
                } else if (ownedChildren.length > 0) {
                    // Partial ownership — include with note and missing children
                    const missingChildren = product.children.filter(c => !isProductOwned(c.id, licensedIds, c.name, licenseNames));
                    notOwned.push({
                        ...product,
                        ownedChildCount: ownedChildren.length,
                        totalChildCount: product.children.length,
                        missingChildren,
                    });
                    continue;
                }
            }
        }

        if (!owned) {
            notOwned.push(product);
        }
    }

    return notOwned;
}

// --- Ownership Data Fetch ---

function getCustomerIdFromToken() {
    const token = getAuthToken();
    if (!token) return null;

    try {
        // JWT is "Bearer <header>.<payload>.<sig>" — decode the payload
        const jwt = token.replace(/^Bearer\s+/i, '');
        const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        // isb field contains "...rcid:<customerId>::..."
        const match = payload.isb?.match(/rcid:([^:]+)::/);
        return match ? match[1] : null;
    } catch (e) {
        Logger.warn('Failed to parse customer ID from token:', e.message);
        return null;
    }
}

async function fetchOwnershipFromApi() {
    const customerId = getCustomerIdFromToken();
    if (!customerId) {
        Logger.warn('Could not determine customer ID. Are you logged in?');
        return [];
    }

    Logger.log('Fetching ownership data...');
    const url = `${API_BASE}/customer/shopper-customers/v1/organizations/${API_ORG}/customers/${customerId}?siteId=${API_SITE}`;
    const data = await apiFetch(url);

    return data.c_productsLicensed || [];
}

async function fetchOwnershipFromLicensesPage() {
    try {
        Logger.log('Fetching licenses page from www.dndbeyond.com...');
        const response = await fetch('https://www.dndbeyond.com/account/licenses', {
            credentials: 'include',
        });

        if (!response.ok) {
            Logger.warn('Licenses page fetch failed:', response.status);
            return { ids: [], names: [] };
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');

        const ids = [];
        const names = [];
        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            const id = cells[0]?.textContent?.trim();
            const name = cells[1]?.textContent?.trim();
            if (id) ids.push(id);
            if (name) names.push(name);
        }

        Logger.log('Licenses page captured:', ids.length, 'licenses');
        return { ids, names };
    } catch (e) {
        Logger.warn('Failed to fetch licenses page:', e.message);
        return { ids: [], names: [] };
    }
}

async function fetchOwnershipData() {
    // Fetch from both sources and merge
    const [apiIds, licensesPage] = await Promise.all([
        fetchOwnershipFromApi(),
        fetchOwnershipFromLicensesPage(),
    ]);

    // Merge IDs and deduplicate
    const mergedIds = [...new Set([...apiIds, ...licensesPage.ids])];

    // Normalize license names for name-based matching
    const licenseNames = new Set(licensesPage.names.map(normalizeName));

    if (mergedIds.length === 0 && licenseNames.size === 0) {
        Logger.warn('No ownership data from any source.');
        return null;
    }

    Logger.log(`Ownership data: ${apiIds.length} from API, ${licensesPage.ids.length} IDs + ${licenseNames.size} names from licenses page, ${mergedIds.length} unique IDs`);

    await chrome.storage.local.set({
        [STORAGE_KEY]: mergedIds,
        [STORAGE_KEY_LICENSES_PAGE]: { ids: licensesPage.ids, names: [...licenseNames] },
        lastCaptureTime: Date.now(),
    });

    return { ids: mergedIds, names: licenseNames };
}

// --- Main Pipeline ---

async function runPipeline(forceRefresh = false) {
    try {
        Logger.log('Running ownership pipeline...');

        // Signal syncing state to the UI
        await chrome.storage.local.set({
            [STORAGE_KEY_NOT_OWNED]: { syncing: true },
        });

        // Get ownership data from storage, or fetch it fresh
        let ownershipData = null;

        if (!forceRefresh) {
            const stored = await chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY_LICENSES_PAGE]);
            const ids = stored[STORAGE_KEY];
            const licensesPage = stored[STORAGE_KEY_LICENSES_PAGE];

            if (ids && Array.isArray(ids)) {
                const names = new Set(licensesPage?.names || []);
                ownershipData = { ids, names };
            }
        }

        if (!ownershipData) {
            ownershipData = await fetchOwnershipData();
        }

        if (!ownershipData || ownershipData.ids.length === 0) {
            Logger.warn('No ownership data found. Are you logged in?');
            await chrome.storage.local.set({
                [STORAGE_KEY_NOT_OWNED]: { error: 'No ownership data. Are you logged in to D&D Beyond?' },
            });
            return;
        }

        // Fetch catalog
        const catalog = await fetchCatalog(forceRefresh);

        // Compute not-owned
        const notOwned = computeNotOwned(catalog, ownershipData);

        Logger.log(`Pipeline complete: ${notOwned.length} products not owned`);

        await chrome.storage.local.set({
            [STORAGE_KEY_NOT_OWNED]: {
                products: notOwned,
                totalCatalog: catalog.length,
                ownedCount: catalog.length - notOwned.length,
                lastUpdated: Date.now(),
            },
        });
    } catch (error) {
        Logger.error('Pipeline failed:', error);
        await chrome.storage.local.set({
            [STORAGE_KEY_NOT_OWNED]: { error: error.message },
        });
    }
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'refresh') {
        runPipeline(true).then(() => sendResponse({ ok: true }));
        return true; // Keep message channel open for async response
    }
    if (message.action === 'getStatus') {
        chrome.storage.local.get(STORAGE_KEY_NOT_OWNED, (data) => {
            sendResponse(data[STORAGE_KEY_NOT_OWNED] || null);
        });
        return true;
    }
});

// --- Auto-run on page load ---

runPipeline();
