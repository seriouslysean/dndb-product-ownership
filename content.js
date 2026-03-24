// constants.js and shared.js are loaded before this file

let pipelineRunning = false;

// --- Auth ---

const getAuthToken = () => {
  const match = document.cookie.match(/token_DDBUS=([^;]+)/);
  return match ? decodeURIComponent(match[1]).trim() : null;
};

const apiFetch = async (url) => {
  const token = getAuthToken();
  if (!token) throw new Error("No auth token found");

  const response = await fetch(url, { headers: { Authorization: token } });
  if (!response.ok) throw new Error(`API ${response.status}`);

  return response.json();
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

    // Extract format from search hit variationAttributes (masters)
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

    // Format (skip if already set from search hit variationAttributes)
    if (!entry.format) {
      entry.format =
        product.c_productStyle === "Physical"
          ? FORMAT.PHYSICAL
          : product.c_isDigitalProduct === false
            ? FORMAT.PHYSICAL
            : FORMAT.DIGITAL;
    }

    // Category
    entry.category = resolveCategory(entry, product);

    // Variants (masters)
    if (entry.type === "master") {
      entry.variants = (product.variants || []).map((v) => ({
        id: v.productId,
        values: v.variationValues,
      }));
    }

    // Bundle children (sets)
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

  await chrome.storage.local.set({
    [STORAGE.CATALOG]: catalog,
    [STORAGE.LAST_CATALOG_FETCH]: Date.now(),
  });

  Logger.log("Catalog cached", { count: catalog.length });
  return catalog;
};

// --- Ownership Matching ---

const normalizeName = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const isProductOwned = (productId, licensedIds, productName, licenseNames) => {
  if (licensedIds.has(productId) || licensedIds.has("DB" + productId)) return true;
  // Name fallback: license names are often shorter than catalog names
  // e.g. "Elder Heart" (license) vs "Elder Heart Digital Dice Set" (catalog)
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
  const owned = (id, name) => isProductOwned(id, licensedIds, name, licenseNames);
  const notOwned = [];

  for (const product of catalog) {
    let isOwned = false;

    if (product.type === "item") {
      isOwned = owned(product.id, product.name);
    } else if (product.type === "master") {
      isOwned =
        owned(product.id, product.name) || (product.variants || []).some((v) => owned(v.id, null));
    } else if (product.type === "set") {
      isOwned = owned(product.id, product.name);

      if (!isOwned && product.children?.length > 0) {
        const taggedChildren = product.children.map((child) => ({
          ...child,
          isOwned: owned(child.id, child.name),
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

const getCustomerIdFromToken = () => {
  const token = getAuthToken();
  if (!token) return null;

  try {
    const jwt = token.replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.isb?.match(/rcid:([^:]+)::/)?.[1] ?? null;
  } catch {
    return null;
  }
};

const fetchOwnershipFromApi = async () => {
  const customerId = getCustomerIdFromToken();
  if (!customerId) return [];
  const data = await apiFetch(endpoints.customerProfile(customerId));
  return data.c_productsLicensed || [];
};

const fetchOwnershipFromLicensesPage = async () => {
  const response = await fetch(LICENSES_PAGE_URL, { credentials: "include" });
  if (!response.ok) throw new Error(`Licenses page ${response.status}`);

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const ids = [];
  const names = [];
  for (const row of doc.querySelectorAll("table tbody tr")) {
    const cells = row.querySelectorAll("td");
    const id = cells[0]?.textContent?.trim();
    const name = cells[1]?.textContent?.trim();
    if (id) ids.push(id);
    if (name) names.push(name);
  }

  return { ids, names };
};

const fetchOwnershipFromOrders = async () => {
  const token = getAuthToken();
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
      acc[source.name] = source.name === "licenses" ? { ids: [], names: [] } : [];
    }
    return acc;
  }, {});

  const mergedIds = [...new Set([...resolved.api, ...resolved.licenses.ids, ...resolved.orders])];
  const licenseNames = new Set(resolved.licenses.names.map(normalizeName));

  if (mergedIds.length === 0 && licenseNames.size === 0) return null;

  Logger.log("Ownership data merged", {
    api: resolved.api.length,
    licenses: resolved.licenses.ids.length,
    orders: resolved.orders.length,
    total: mergedIds.length,
    names: licenseNames.size,
  });

  await chrome.storage.local.set({
    [STORAGE.OWNERSHIP]: mergedIds,
    [STORAGE.LICENSES_PAGE]: { ids: resolved.licenses.ids, names: [...licenseNames] },
  });

  return { ids: mergedIds, names: licenseNames };
};

// --- Pipeline ---

const loadStoredOwnership = async () => {
  const stored = await chrome.storage.local.get([STORAGE.OWNERSHIP, STORAGE.LICENSES_PAGE]);
  const ids = stored[STORAGE.OWNERSHIP];
  if (!ids || !Array.isArray(ids)) return null;
  return { ids, names: new Set(stored[STORAGE.LICENSES_PAGE]?.names || []) };
};

const runPipeline = async (forceRefresh = false) => {
  if (pipelineRunning) {
    Logger.log("Pipeline already running, skipping");
    return;
  }
  pipelineRunning = true;

  try {
    Logger.log("Pipeline started", { forceRefresh });
    await chrome.storage.local.set({ [STORAGE.NOT_OWNED]: { syncing: true } });

    const ownershipData = forceRefresh
      ? await fetchOwnershipData()
      : ((await loadStoredOwnership()) ?? (await fetchOwnershipData()));

    if (!ownershipData?.ids?.length) {
      await chrome.storage.local.set({
        [STORAGE.NOT_OWNED]: { errorCode: ERROR.NOT_AUTHENTICATED },
      });
      return;
    }

    const catalog = await fetchCatalog(forceRefresh);
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
    await chrome.storage.local.set({
      [STORAGE.NOT_OWNED]: { errorCode: ERROR.FETCH_FAILED, errorMessage: error.message },
    });
  } finally {
    pipelineRunning = false;
  }
};

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

runPipeline();
