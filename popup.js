// constants.js and shared.js are loaded before this file

const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("product-list");
const filtersEl = document.getElementById("filters");
const formatToggleEl = document.getElementById("format-toggle");
const publisherToggleEl = document.getElementById("publisher-toggle");
const lastUpdatedEl = document.getElementById("last-updated");
const refreshBtn = document.getElementById("refresh-btn");
const loginGate = document.getElementById("login-gate");
const loginMessage = document.getElementById("login-message");
const syncingGate = document.getElementById("syncing-gate");
const syncingMessage = document.getElementById("syncing-message");
const mainContent = document.getElementById("main-content");

let currentData = null;
let hiddenCategories = new Set();
let dismissedProducts = new Set();
let formatFilter = FORMAT.DIGITAL;
let publisherFilter = PUBLISHER.ALL;

const FORMAT_OPTIONS = [
  { key: FORMAT.DIGITAL, label: "Digital" },
  { key: FORMAT.PHYSICAL, label: "Physical" },
  { key: FORMAT.ALL, label: "All" },
];

const PUBLISHER_OPTIONS = [
  { key: PUBLISHER.ALL, label: "All" },
  { key: PUBLISHER.FIRST_PARTY, label: "Official" },
  { key: PUBLISHER.THIRD_PARTY, label: "Third-Party" },
];

const STAGE_LABELS = {
  [SYNC_STAGE.STARTING]: "Starting sync...",
  [SYNC_STAGE.OWNERSHIP]: "Checking ownership...",
  [SYNC_STAGE.CATALOG]: "Fetching catalog...",
  [SYNC_STAGE.MATCHING]: "Matching products...",
};

// --- Categorization (data-driven) ---

const categorizeProduct = (product) => product.category || "Other";

const badgeClassFor = (category) =>
  DISPLAY_CATEGORIES.find((c) => c.key === category)?.badge || "other";

// --- Filters ---

const matchesFormat = (product) => {
  if (formatFilter === FORMAT.ALL) return true;
  const f = product.format || FORMAT.DIGITAL;
  return f === formatFilter || f === FORMAT.BOTH;
};

const matchesPublisher = (product) => {
  if (publisherFilter === PUBLISHER.ALL) return true;
  if (publisherFilter === PUBLISHER.FIRST_PARTY) return product.isFirstParty === true;
  return product.isFirstParty !== true;
};

const matchesFilters = (product) =>
  matchesFormat(product) && matchesPublisher(product) && !dismissedProducts.has(product.id);

// --- Saved Preferences ---

const loadPrefs = async () => {
  const result = await chrome.storage.local.get([STORAGE.FILTER_PREFS, STORAGE.DISMISSED]);
  const prefs = result[STORAGE.FILTER_PREFS];
  if (prefs) {
    hiddenCategories = new Set(prefs.hiddenCategories || []);
    formatFilter = prefs.format || FORMAT.DIGITAL;
    publisherFilter = prefs.publisher || PUBLISHER.ALL;
  }
  dismissedProducts = new Set(result[STORAGE.DISMISSED] || []);
};

const saveFilterPrefs = () => {
  chrome.storage.local.set({
    [STORAGE.FILTER_PREFS]: {
      hiddenCategories: [...hiddenCategories],
      format: formatFilter,
      publisher: publisherFilter,
    },
  });
};

const dismissProduct = (productId) => {
  dismissedProducts.add(productId);
  chrome.storage.local.set({ [STORAGE.DISMISSED]: [...dismissedProducts] });
  render(currentData);
};

const undismissAll = () => {
  dismissedProducts.clear();
  chrome.storage.local.set({ [STORAGE.DISMISSED]: [] });
  render(currentData);
};

// --- View State ---

const showView = (view) => {
  loginGate.style.display = view === "login" ? "" : "none";
  syncingGate.style.display = view === "syncing" ? "" : "none";
  mainContent.style.display = view === "main" ? "" : "none";
};

// --- Rendering ---

const renderToggle = (container, options, activeKey, onChange) => {
  container.innerHTML = "";
  for (const { key, label } of options) {
    const btn = document.createElement("button");
    btn.className = `format-btn${activeKey === key ? " active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      onChange(key);
      saveFilterPrefs();
      render(currentData);
    });
    container.appendChild(btn);
  }
};

const renderCategoryChips = (groups) => {
  filtersEl.innerHTML = "";

  for (const { key } of DISPLAY_CATEGORIES) {
    const count = groups[key]?.length || 0;
    if (count === 0) continue;

    const isHidden = hiddenCategories.has(key);
    const chip = document.createElement("button");
    chip.className = `filter-chip${isHidden ? " inactive" : ""}`;
    chip.textContent = `${key} (${count})`;
    chip.title = isHidden ? `Show ${key}` : `Hide ${key}`;
    chip.addEventListener("click", () => {
      if (isHidden) {
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

const formatPrice = (price) => {
  if (price == null) return null;
  return `$${Number(price).toFixed(2)}`;
};

const render = (data) => {
  listEl.innerHTML = "";
  summaryEl.textContent = "";
  lastUpdatedEl.textContent = "";

  if (!data) {
    showView("login");
    return;
  }
  if (data.syncing) {
    showView("syncing");
    syncingMessage.textContent = STAGE_LABELS[data.stage] || "Syncing...";
    return;
  }
  if (data.errorCode === ERROR.NOT_AUTHENTICATED || data.errorCode === ERROR.TOKEN_EXPIRED) {
    showView("login");
    if (data.errorCode === ERROR.TOKEN_EXPIRED) {
      loginMessage.textContent = "Session expired. Open the marketplace and sign in again.";
    }
    return;
  }
  if (data.errorCode) {
    showView("main");
    summaryEl.textContent = data.errorMessage || "Something went wrong.";
    summaryEl.style.color = "#e74c3c";
    return;
  }

  showView("main");
  summaryEl.style.color = "";

  const allProducts = data.products || [];
  const products = allProducts.filter((product) => {
    if (!matchesFilters(product)) return false;
    if (product.children?.length > 0) {
      const relevant = product.children.filter(matchesFormat);
      if (relevant.length > 0 && relevant.every((c) => c.isOwned)) return false;
    }
    return true;
  });

  renderToggle(formatToggleEl, FORMAT_OPTIONS, formatFilter, (key) => {
    formatFilter = key;
  });
  renderToggle(publisherToggleEl, PUBLISHER_OPTIONS, publisherFilter, (key) => {
    publisherFilter = key;
  });

  if (allProducts.length === 0) {
    summaryEl.textContent = `You own everything! (${data.ownedCount} of ${data.totalCatalog})`;
    return;
  }

  if (products.length === 0) {
    summaryEl.textContent = `No matching products (${allProducts.length} total not owned)`;
    return;
  }

  const groups = {};
  for (const product of products) {
    const cat = categorizeProduct(product);
    (groups[cat] ??= []).push(product);
  }

  renderCategoryChips(groups);

  let visibleCount = 0;
  let hiddenCount = 0;

  for (const { key } of DISPLAY_CATEGORIES) {
    const group = groups[key];
    if (!group?.length) continue;

    if (hiddenCategories.has(key)) {
      hiddenCount += group.length;
      continue;
    }

    visibleCount += group.length;

    const header = document.createElement("div");
    header.className = "group-header";
    header.textContent = `${key} (${group.length})`;
    listEl.appendChild(header);

    for (const product of group) {
      const url = product.url || endpoints.productPage(product.id);
      const entry = document.createElement("div");
      entry.className = "product-entry";

      const link = document.createElement("a");
      link.className = "product-link";
      link.href = url;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (url.startsWith(MARKETPLACE_BASE)) chrome.tabs.create({ url });
      });

      const nameEl = document.createElement("span");
      nameEl.className = "product-name";
      nameEl.textContent = product.name || "(unnamed)";

      const priceEl = formatPrice(product.price);
      if (priceEl) {
        const priceSpan = document.createElement("span");
        priceSpan.className = "product-price";
        priceSpan.textContent = priceEl;
        nameEl.appendChild(priceSpan);
      }

      const relevantChildren = (product.children || []).filter(matchesFormat);
      const missingChildren = relevantChildren.filter((c) => !c.isOwned);
      const ownedCount = relevantChildren.length - missingChildren.length;

      if (relevantChildren.length > 0 && ownedCount > 0) {
        const note = document.createElement("span");
        note.className = "product-note";
        note.textContent = ` (${ownedCount}/${relevantChildren.length} owned)`;
        nameEl.appendChild(note);
      }

      if (missingChildren.length > 0) {
        for (const child of missingChildren) {
          const childEl = document.createElement("div");
          childEl.className = "product-child-missing";
          childEl.textContent = child.name || "(unnamed)";
          nameEl.appendChild(childEl);
        }
      }

      link.appendChild(nameEl);

      const badge = document.createElement("span");
      badge.className = `type-badge ${badgeClassFor(key)}`;
      badge.textContent = key;

      const dismissBtn = document.createElement("button");
      dismissBtn.className = "dismiss-btn";
      dismissBtn.textContent = "\u00d7";
      dismissBtn.title = "Not interested";
      dismissBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissProduct(product.id);
      });

      entry.appendChild(link);
      entry.appendChild(badge);
      entry.appendChild(dismissBtn);
      listEl.appendChild(entry);
    }
  }

  const parts = [`${products.length} not owned, ${data.ownedCount} owned of ${data.totalCatalog}`];
  if (hiddenCount > 0) parts.push(`${hiddenCount} hidden`);
  if (dismissedProducts.size > 0) parts.push(`${dismissedProducts.size} dismissed`);
  if (visibleCount !== products.length && visibleCount > 0) parts.push(`showing ${visibleCount}`);
  summaryEl.textContent = parts.join(" \u00b7 ");

  if (data.lastUpdated) {
    lastUpdatedEl.textContent = `Updated ${new Date(data.lastUpdated).toLocaleString()}`;
  }
};

// --- Actions ---

document.getElementById("open-marketplace").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: `${MARKETPLACE_BASE}/` });
});

document.getElementById("undismiss-btn")?.addEventListener("click", undismissAll);

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";

  const tabs = await chrome.tabs.query({ url: `${MARKETPLACE_BASE}/*` });

  if (tabs.length === 0) {
    // Open a marketplace tab and wait for it to load
    showView("syncing");
    syncingMessage.textContent = "Opening marketplace...";
    chrome.tabs.create({ url: `${MARKETPLACE_BASE}/`, active: false });
    // The content script will auto-run the pipeline on the new tab
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
    return;
  }

  showView("syncing");
  syncingMessage.textContent = "Starting sync...";

  chrome.tabs.sendMessage(tabs[0].id, { action: "refresh" }, () => {
    if (chrome.runtime.lastError) {
      showView("login");
      loginMessage.textContent = "Could not reach marketplace tab. Try reloading it.";
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE.NOT_OWNED]) {
    currentData = changes[STORAGE.NOT_OWNED].newValue || null;
    render(currentData);
  }
});

// --- Init ---

(async () => {
  await loadPrefs();
  const result = await chrome.storage.local.get(STORAGE.NOT_OWNED);
  currentData = result[STORAGE.NOT_OWNED] || null;
  render(currentData);
})();
