// shared.js is loaded before this file by the manifest

let pipelineRunning = false;

// --- Auth ---

const getAuthToken = () => {
    const match = document.cookie.match(/token_DDBUS=([^;]+)/);
    return match ? decodeURIComponent(match[1]).trim() : null;
};

const apiFetch = async (url) => {
    const token = getAuthToken();
    if (!token) throw new Error('No auth token found');

    const response = await fetch(url, { headers: { Authorization: token } });
    if (!response.ok) throw new Error(`API ${response.status}`);

    return response.json();
};

// --- Catalog Fetch ---

const fetchCatalog = async (forceRefresh = false) => {
    if (!forceRefresh) {
        const cached = await chrome.storage.local.get([STORAGE_KEY_CATALOG, STORAGE_KEY_LAST_CATALOG_FETCH]);
        if (Date.now() - (cached[STORAGE_KEY_LAST_CATALOG_FETCH] || 0) < ONE_DAY_MS && cached[STORAGE_KEY_CATALOG]) {
            Logger.log('Using cached catalog');
            return cached[STORAGE_KEY_CATALOG];
        }
    }

    Logger.log('Fetching product catalog...');
    const { hits = [] } = await apiFetch(endpoints.productSearch(200));
    Logger.log(`Found ${hits.length} products`);

    const masters = [];
    const sets = [];
    const items = [];

    for (const hit of hits) {
        const { productType: type, productId: id, productName: name } = hit;
        const entry = {
            id,
            name,
            type: type.master ? 'master' : type.set ? 'set' : type.variant ? 'variant' : 'item',
            url: `https://marketplace.dndbeyond.com/category/${id}`,
        };

        if (type.master) masters.push(entry);
        else if (type.set) sets.push(entry);
        else if (!type.variant) items.push(entry);
    }

    const allNonSets = [...masters, ...items];
    for (let i = 0; i < allNonSets.length; i += 20) {
        if (i > 0) await delay(BATCH_DELAY_MS);
        const batch = allNonSets.slice(i, i + 20);
        const { data = [] } = await apiFetch(endpoints.productDetails(batch.map(p => p.id)));

        for (const product of data) {
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

    for (let i = 0; i < sets.length; i += 10) {
        if (i > 0) await delay(BATCH_DELAY_MS);
        const batch = sets.slice(i, i + 10);
        const { data = [] } = await apiFetch(endpoints.productDetails(batch.map(s => s.id), 'set_products'));

        for (const product of data) {
            const set = batch.find(s => s.id === product.id);
            if (!set) continue;
            set.children = (product.setProducts || []).map(sp => ({ id: sp.id, name: sp.name }));
            set.isDigitalProduct = product.c_isDigitalProduct ?? null;
        }
    }

    const catalog = [...masters, ...sets, ...items];

    await chrome.storage.local.set({
        [STORAGE_KEY_CATALOG]: catalog,
        [STORAGE_KEY_LAST_CATALOG_FETCH]: Date.now(),
    });

    Logger.log(`Catalog cached: ${catalog.length} products`);
    return catalog;
};

// --- Ownership Matching ---

const normalizeName = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isProductOwned = (productId, licensedIds, productName, licenseNames) => {
    if (licensedIds.has(productId) || licensedIds.has('DB' + productId)) return true;
    // Name fallback: license names are often shorter than catalog names
    // e.g. "Elder Heart" (license) vs "Elder Heart Digital Dice Set" (catalog)
    // Only match if catalog name contains the license name (one direction only)
    if (productName && licenseNames?.size > 0) {
        const normalized = normalizeName(productName);
        if (normalized.length < 8) return false;
        for (const licenseName of licenseNames) {
            if (licenseName.length < 8) continue;
            if (normalized.includes(licenseName)) return true;
        }
    }
    return false;
};

const computeNotOwned = (catalog, { ids, names: licenseNames }) => {
    const licensedIds = new Set(ids);
    const notOwned = [];

    for (const product of catalog) {
        if (product.isDigitalProduct === false && !product.hasDigitalVariant) continue;

        let owned = false;

        if (product.type === 'item') {
            owned = isProductOwned(product.id, licensedIds, product.name, licenseNames);
        } else if (product.type === 'master') {
            owned = isProductOwned(product.id, licensedIds, product.name, licenseNames)
                || (product.variants || []).some(v => isProductOwned(v.id, licensedIds, null, null));
        } else if (product.type === 'set') {
            owned = isProductOwned(product.id, licensedIds, product.name, licenseNames);

            if (!owned && product.children?.length > 0) {
                const ownedChildren = [];
                const missingChildren = [];
                for (const child of product.children) {
                    (isProductOwned(child.id, licensedIds, child.name, licenseNames)
                        ? ownedChildren : missingChildren).push(child);
                }

                if (missingChildren.length === 0) {
                    owned = true;
                } else if (ownedChildren.length > 0) {
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

        if (!owned) notOwned.push(product);
    }

    return notOwned;
};

// --- Ownership Data Fetch ---

const getCustomerIdFromToken = () => {
    const token = getAuthToken();
    if (!token) return null;

    try {
        const jwt = token.replace(/^Bearer\s+/i, '');
        const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.isb?.match(/rcid:([^:]+)::/)?.[1] ?? null;
    } catch {
        return null;
    }
};

const fetchOwnershipFromApi = async () => {
    const customerId = getCustomerIdFromToken();
    if (!customerId) return [];

    try {
        const data = await apiFetch(
            `${API_BASE}/customer/shopper-customers/v1/organizations/${API_ORG}/customers/${customerId}?siteId=${API_SITE}`
        );
        return data.c_productsLicensed || [];
    } catch (e) {
        Logger.warn('API ownership fetch failed:', e.message);
        return [];
    }
};

const fetchOwnershipFromLicensesPage = async () => {
    try {
        const response = await fetch('https://www.dndbeyond.com/account/licenses', {
            credentials: 'include',
        });
        if (!response.ok) return { ids: [], names: [] };

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
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

        Logger.log('Licenses page:', ids.length, 'licenses');
        return { ids, names };
    } catch (e) {
        Logger.warn('Licenses page fetch failed:', e.message);
        return { ids: [], names: [] };
    }
};

const fetchOwnershipData = async () => {
    const results = await Promise.allSettled([
        fetchOwnershipFromApi(),
        fetchOwnershipFromLicensesPage(),
    ]);

    const apiIds = results[0].status === 'fulfilled' ? results[0].value : [];
    const licensesPage = results[1].status === 'fulfilled' ? results[1].value : { ids: [], names: [] };

    const mergedIds = [...new Set([...apiIds, ...licensesPage.ids])];
    const licenseNames = new Set(licensesPage.names.map(normalizeName));

    if (mergedIds.length === 0 && licenseNames.size === 0) return null;

    Logger.log(`Ownership: ${apiIds.length} API + ${licensesPage.ids.length} licenses page = ${mergedIds.length} unique IDs, ${licenseNames.size} names`);

    await chrome.storage.local.set({
        [STORAGE_KEY]: mergedIds,
        [STORAGE_KEY_LICENSES_PAGE]: { ids: licensesPage.ids, names: [...licenseNames] },
    });

    return { ids: mergedIds, names: licenseNames };
};

// --- Pipeline ---

const loadStoredOwnership = async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY_LICENSES_PAGE]);
    const ids = stored[STORAGE_KEY];
    if (!ids || !Array.isArray(ids)) return null;
    return { ids, names: new Set(stored[STORAGE_KEY_LICENSES_PAGE]?.names || []) };
};

const runPipeline = async (forceRefresh = false) => {
    if (pipelineRunning) {
        Logger.log('Pipeline already running, skipping');
        return;
    }
    pipelineRunning = true;

    try {
        Logger.log('Running ownership pipeline...');
        await chrome.storage.local.set({ [STORAGE_KEY_NOT_OWNED]: { syncing: true } });

        const ownershipData = forceRefresh
            ? await fetchOwnershipData()
            : (await loadStoredOwnership()) ?? (await fetchOwnershipData());

        if (!ownershipData?.ids?.length) {
            await chrome.storage.local.set({
                [STORAGE_KEY_NOT_OWNED]: { errorCode: ERROR_NOT_AUTHENTICATED },
            });
            return;
        }

        const catalog = await fetchCatalog(forceRefresh);
        const notOwned = computeNotOwned(catalog, ownershipData);

        Logger.log(`Pipeline complete: ${notOwned.length} not owned`);
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
            [STORAGE_KEY_NOT_OWNED]: { errorCode: ERROR_FETCH_FAILED, errorMessage: error.message },
        });
    } finally {
        pipelineRunning = false;
    }
};

// --- Message Handling (only first tab responds) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'refresh') {
        if (pipelineRunning) {
            sendResponse({ ok: false, reason: 'already running' });
            return false;
        }
        runPipeline(true)
            .then(() => sendResponse({ ok: true }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    }
});

runPipeline();
