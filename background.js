importScripts("constants.js", "shared.js");

let pipelineRunning = false;

// --- Side Panel ---

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => Logger.error("Failed to configure side panel", e));

// --- Auth ---

const getAuthToken = async () => {
  const cookie = await chrome.cookies.get({
    url: MARKETPLACE_BASE,
    name: "token_DDBUS",
  });
  return cookie?.value ? decodeURIComponent(cookie.value).trim() : null;
};

const apiFetch = async (url) => {
  const token = await getAuthToken();
  if (!token) throw Object.assign(new Error("No auth token"), { isAuthError: true });

  const response = await fetch(url, { headers: { Authorization: token } });

  if (response.status === 401) {
    throw Object.assign(new Error("Token expired"), { isAuthError: true });
  }
  if (!response.ok) throw new Error(`API ${response.status}`);

  return response.json();
};

// --- ID Aliases ---

let idAliases = {};

const loadIdAliases = async () => {
  try {
    const url = chrome.runtime.getURL("id-aliases.json");
    const resp = await fetch(url);
    const data = await resp.json();
    const { $schema, ...aliases } = data;
    idAliases = aliases;
    Logger.log("ID aliases loaded", { count: Object.keys(idAliases).length });
  } catch (e) {
    Logger.warn("Failed to load ID aliases", { error: e.message });
  }
};

// --- Category Resolution ---

const resolveCategory = (entry, product) => {
  if (entry.type === "set") return "Bundles";

  const apiCat = CATEGORY_BY_API_ID[product.primaryCategoryId];
  if (apiCat) return apiCat;

  if (product.primaryCategoryId === "everything-else") {
    return product.c_isDigitalProduct ? "Creature Packs" : "Accessories";
  }

  const fallback = CATEGORY_FALLBACKS.find((f) => f.test(entry));
  if (fallback) return fallback.category;

  if (
    product.primaryCategoryId &&
    product.primaryCategoryId !== "root" &&
    product.primaryCategoryId !== "none"
  ) {
    Logger.warn("Unmapped category", { id: entry.id, category: product.primaryCategoryId });
  }

  return "Other";
};

// --- Catalog Fetch ---

const fetchCatalog = async (forceRefresh = false) => {
  if (!forceRefresh) {
    const cached = await chrome.storage.local.get([STORAGE.CATALOG, STORAGE.LAST_CATALOG_FETCH]);
    if (
      Date.now() - (cached[STORAGE.LAST_CATALOG_FETCH] || 0) < ONE_DAY_MS &&
      cached[STORAGE.CATALOG]
    ) {
      Logger.log("Using cached catalog");
      return cached[STORAGE.CATALOG];
    }
  }

  Logger.log("Fetching product catalog");
  const { hits = [] } = await apiFetch(endpoints.productSearch(200));

  const masters = [];
  const sets = [];
  const items = [];

  for (const hit of hits) {
    const { productType: type, productId: id, productName: name } = hit;
    const entry = {
      id,
      name,
      type: type.master ? "master" : type.set ? "set" : type.variant ? "variant" : "item",
      url: endpoints.productPage(id),
    };

    if (type.master && hit.variationAttributes) {
      const formats =
        hit.variationAttributes
          .find((va) => va.id === "Digital/Physical")
          ?.values?.map((v) => v.value) || [];
      const hasDigital = formats.includes("Digital");
      const hasPhysical = formats.includes("Physical");
      entry.format =
        hasDigital && hasPhysical
          ? FORMAT.BOTH
          : hasDigital
            ? FORMAT.DIGITAL
            : hasPhysical
              ? FORMAT.PHYSICAL
              : FORMAT.DIGITAL;
    }

    if (type.master) masters.push(entry);
    else if (type.set) sets.push(entry);
    else if (!type.variant) items.push(entry);
  }

  const enrichProduct = (entry, product) => {
    entry.publisher = product.c_publisher || null;
    entry.isFirstParty = FIRST_PARTY_PUBLISHERS.includes(entry.publisher);
    entry.primaryCategoryId = product.primaryCategoryId || null;
    entry.price = product.c_salePrice ?? product.price ?? null;

    if (!entry.format) {
      entry.format =
        product.c_productStyle === "Physical"
          ? FORMAT.PHYSICAL
          : product.c_isDigitalProduct === false
            ? FORMAT.PHYSICAL
            : FORMAT.DIGITAL;
    }

    entry.category = resolveCategory(entry, product);

    if (entry.type === "master") {
      entry.variants = (product.variants || []).map((v) => ({
        id: v.productId,
        values: v.variationValues,
      }));
    }

    if (product.setProducts) {
      entry.children = product.setProducts.map((sp) => ({
        id: sp.id,
        name: sp.name,
        format: sp.c_isDigitalProduct === false ? FORMAT.PHYSICAL : FORMAT.DIGITAL,
      }));
      const hasDigitalChild = entry.children.some((c) => c.format === FORMAT.DIGITAL);
      const hasPhysicalChild = entry.children.some((c) => c.format === FORMAT.PHYSICAL);
      entry.format =
        hasDigitalChild && hasPhysicalChild
          ? FORMAT.BOTH
          : hasDigitalChild
            ? FORMAT.DIGITAL
            : FORMAT.PHYSICAL;
    }
  };

  for (const { batch, data } of await batchProcess([...masters, ...items], 20, (b) =>
    apiFetch(endpoints.productDetails(b.map((p) => p.id))).then((r) => r.data || []),
  )) {
    for (const product of data) {
      const entry = batch.find((p) => p.id === product.id);
      if (entry) enrichProduct(entry, product);
    }
  }

  for (const { batch, data } of await batchProcess(sets, 10, (b) =>
    apiFetch(
      endpoints.productDetails(
        b.map((s) => s.id),
        "set_products",
      ),
    ).then((r) => r.data || []),
  )) {
    for (const product of data) {
      const set = batch.find((s) => s.id === product.id);
      if (set) enrichProduct(set, product);
    }
  }

  const catalog = [...masters, ...sets, ...items];

  // Tag new products
  const stored = await chrome.storage.local.get(STORAGE.KNOWN_IDS);
  const knownIds = stored[STORAGE.KNOWN_IDS] || {};
  const now = Date.now();

  for (const product of catalog) {
    if (!knownIds[product.id]) {
      knownIds[product.id] = now;
      product.isNew = true;
    } else {
      product.isNew = now - knownIds[product.id] < NEW_PRODUCT_TTL_MS;
    }
  }

  await chrome.storage.local.set({
    [STORAGE.CATALOG]: catalog,
    [STORAGE.LAST_CATALOG_FETCH]: Date.now(),
    [STORAGE.KNOWN_IDS]: knownIds,
  });

  Logger.log("Catalog cached", { count: catalog.length });
  return catalog;
};

// --- Ownership Matching ---

const isProductOwned = (productId, licensedIds) => {
  if (licensedIds.has(productId)) return true;
  if (licensedIds.has("DB" + productId)) return true;
  const alias = idAliases[productId];
  if (alias && licensedIds.has(alias)) return true;
  return false;
};

const computeNotOwned = (catalog, { ids }) => {
  const licensedIds = new Set(ids);
  const owned = (id) => isProductOwned(id, licensedIds);
  const notOwned = [];

  for (const product of catalog) {
    let isOwned = false;

    if (product.type === "item") {
      isOwned = owned(product.id);
    } else if (product.type === "master") {
      isOwned = owned(product.id) || (product.variants || []).some((v) => owned(v.id));
    } else if (product.type === "set") {
      isOwned = owned(product.id);

      if (!isOwned && product.children?.length > 0) {
        const taggedChildren = product.children.map((child) => ({
          ...child,
          isOwned: owned(child.id),
        }));
        const allOwned = taggedChildren.every((c) => c.isOwned);
        const someOwned = taggedChildren.some((c) => c.isOwned);

        if (allOwned) {
          isOwned = true;
        } else if (someOwned) {
          notOwned.push({ ...product, children: taggedChildren });
          continue;
        }
      }
    }

    if (!isOwned) notOwned.push(product);
  }

  return notOwned;
};

// --- Ownership Data Sources ---

const getCustomerIdFromToken = async () => {
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const jwt = token.replace(/^Bearer\s+/i, "");
    const base64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return payload.isb?.match(/rcid:([^:]+)::/)?.[1] ?? null;
  } catch {
    return null;
  }
};

const fetchOwnershipFromApi = async () => {
  const customerId = await getCustomerIdFromToken();
  if (!customerId) return [];
  const data = await apiFetch(endpoints.customerProfile(customerId));
  return data.c_productsLicensed || [];
};

const fetchOwnershipFromLicensesPage = async () => {
  const response = await fetch(LICENSES_PAGE_URL, { credentials: "include" });
  if (!response.ok) throw new Error(`Licenses page ${response.status}`);

  const html = await response.text();
  if (!html.includes("<table")) {
    throw new Error("Licenses page returned no table (likely login redirect)");
  }

  // Service worker has no DOMParser — extract first <td> from each <tr>
  const ids = [];
  const rowPattern = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>/g;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const id = match[1].trim();
    if (id) ids.push(id);
  }

  return ids;
};

const fetchOwnershipFromOrders = async () => {
  const token = await getAuthToken();
  if (!token) return [];

  return paginateFetch(async (offset, limit) => {
    const response = await fetch(endpoints.orderHistory(offset, limit), {
      headers: { Authorization: token, "Content-Type": "application/json" },
    });
    if (!response.ok) return [];

    const { c_result } = await response.json();
    const ids = [];
    for (const order of c_result?.orders || []) {
      for (const key of Object.keys(order)) {
        if (!key.includes("GroupItems")) continue;
        if (!Array.isArray(order[key])) continue;
        for (const group of order[key]) {
          for (const item of group?.orderItems?.orderItems || []) {
            if (item.sfccProductId) ids.push(item.sfccProductId);
          }
        }
      }
    }
    return ids;
  });
};

const OWNERSHIP_SOURCES = [
  { name: "api", fn: fetchOwnershipFromApi },
  { name: "licenses", fn: fetchOwnershipFromLicensesPage },
  { name: "orders", fn: fetchOwnershipFromOrders },
];

const fetchOwnershipData = async () => {
  const results = await Promise.allSettled(OWNERSHIP_SOURCES.map((s) => s.fn()));

  const resolved = OWNERSHIP_SOURCES.reduce((acc, source, i) => {
    const result = results[i];
    if (result.status === "fulfilled") {
      acc[source.name] = result.value;
    } else {
      Logger.warn("Ownership source failed", {
        source: source.name,
        error: result.reason?.message,
      });
      acc[source.name] = [];
    }
    return acc;
  }, {});

  const mergedIds = [...new Set([...resolved.api, ...resolved.licenses, ...resolved.orders])];

  if (mergedIds.length === 0) return null;

  Logger.log("Ownership data merged", {
    api: resolved.api.length,
    licenses: resolved.licenses.length,
    orders: resolved.orders.length,
    total: mergedIds.length,
  });

  await chrome.storage.local.set({ [STORAGE.OWNERSHIP]: mergedIds });

  return { ids: mergedIds };
};

// --- Cache Versioning ---

const checkVersionChange = async () => {
  const currentVersion = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get(STORAGE.VERSION);
  if (stored[STORAGE.VERSION] !== currentVersion) {
    Logger.log("Version changed, clearing cache", {
      from: stored[STORAGE.VERSION],
      to: currentVersion,
    });
    await chrome.storage.local.remove([
      STORAGE.CATALOG,
      STORAGE.LAST_CATALOG_FETCH,
      STORAGE.OWNERSHIP,
      STORAGE.NOT_OWNED,
    ]);
    await chrome.storage.local.set({ [STORAGE.VERSION]: currentVersion });
    return true;
  }
  return false;
};

// --- Storage Quota ---

const checkStorageQuota = async () => {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const usage = bytes / STORAGE_QUOTA_BYTES;
  if (usage > STORAGE_QUOTA_WARN) {
    Logger.warn("Storage quota warning", {
      used: `${(bytes / 1024).toFixed(0)}KB`,
      percent: `${(usage * 100).toFixed(1)}%`,
    });
  }
  return { bytes, usage };
};

// --- Sync Stage Reporting ---

const setSyncStage = (stage) =>
  chrome.storage.local.set({ [STORAGE.NOT_OWNED]: { syncing: true, stage } });

// --- Pipeline ---

const loadStoredOwnership = async () => {
  const stored = await chrome.storage.local.get(STORAGE.OWNERSHIP);
  const ids = stored[STORAGE.OWNERSHIP];
  if (!ids || !Array.isArray(ids)) return null;
  return { ids };
};

const runPipeline = async (forceRefresh = false) => {
  if (pipelineRunning) {
    Logger.log("Pipeline already running, skipping");
    return;
  }
  pipelineRunning = true;

  try {
    const versionChanged = await checkVersionChange();
    const shouldRefresh = forceRefresh || versionChanged;

    Logger.log("Pipeline started", { forceRefresh: shouldRefresh });
    await setSyncStage(SYNC_STAGE.STARTING);

    await setSyncStage(SYNC_STAGE.OWNERSHIP);
    const ownershipData = shouldRefresh
      ? await fetchOwnershipData()
      : ((await loadStoredOwnership()) ?? (await fetchOwnershipData()));

    if (!ownershipData?.ids?.length) {
      await chrome.storage.local.set({
        [STORAGE.NOT_OWNED]: { errorCode: ERROR.NOT_AUTHENTICATED },
      });
      return;
    }

    await setSyncStage(SYNC_STAGE.CATALOG);
    const catalog = await fetchCatalog(shouldRefresh);

    await setSyncStage(SYNC_STAGE.MATCHING);
    const notOwned = computeNotOwned(catalog, ownershipData);

    Logger.log("Pipeline complete", { notOwned: notOwned.length, total: catalog.length });
    await chrome.storage.local.set({
      [STORAGE.NOT_OWNED]: {
        products: notOwned,
        totalCatalog: catalog.length,
        ownedCount: catalog.length - notOwned.length,
        lastUpdated: Date.now(),
      },
    });
  } catch (error) {
    Logger.error("Pipeline failed", error);
    const errorCode = error.isAuthError ? ERROR.TOKEN_EXPIRED : ERROR.FETCH_FAILED;
    await chrome.storage.local.set({
      [STORAGE.NOT_OWNED]: { errorCode, errorMessage: error.message },
    });
  } finally {
    pipelineRunning = false;
    await checkStorageQuota();
  }
};

// --- Message Handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "refresh") {
    if (pipelineRunning) {
      sendResponse({ ok: false, reason: "already running" });
      return false;
    }
    runPipeline(true)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// --- Re-inject content scripts on install/update ---

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: `${MARKETPLACE_BASE}/*` });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({
        target: { tabId: tab.id },
        files: ["constants.js", "shared.js", "content.js"],
      })
      .catch(() => {});
  }
});

// --- Startup ---

loadIdAliases().then(() => runPipeline());

Logger.log("Background script loaded");
