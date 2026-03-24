// constants.js and shared.js are loaded before this file

const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("product-list");
const filtersEl = document.getElementById("filters");
const formatToggleEl = document.getElementById("format-toggle");
const publisherToggleEl = document.getElementById("publisher-toggle");
const statsEl = document.getElementById("stats");
const lastUpdatedEl = document.getElementById("last-updated");
const refreshBtn = document.getElementById("refresh-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const loginGate = document.getElementById("login-gate");
const loginMessage = document.getElementById("login-message");
const syncingGate = document.getElementById("syncing-gate");
const syncingMessage = document.getElementById("syncing-message");
const mainContent = document.getElementById("main-content");
const searchInput = document.getElementById("search-input");

let currentData = null;
let hiddenCategories = new Set();
let dismissedProducts = new Set();
let formatFilter = FORMAT.DIGITAL;
let publisherFilter = PUBLISHER.ALL;
let settingsOpen = false;
let searchQuery = "";

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

const matchesSearch = (product) => {
  if (!searchQuery) return true;
  return (product.name || "").toLowerCase().includes(searchQuery);
};

const matchesFilters = (product) =>
  matchesFormat(product) &&
  matchesPublisher(product) &&
  matchesSearch(product) &&
  !dismissedProducts.has(product.id);

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
  loginGate.hidden = view !== "login";
  syncingGate.hidden = view !== "syncing";
  mainContent.hidden = view !== "main";
};

// --- Settings Panel ---

const renderSettings = (groups, data) => {
  renderToggle(formatToggleEl, FORMAT_OPTIONS, formatFilter, (key) => {
    formatFilter = key;
  });

  renderToggle(publisherToggleEl, PUBLISHER_OPTIONS, publisherFilter, (key) => {
    publisherFilter = key;
  });

  filtersEl.innerHTML = "";
  for (const { key } of DISPLAY_CATEGORIES) {
    const count = groups[key]?.length || 0;
    if (count === 0) continue;

    const isHidden = hiddenCategories.has(key);
    const chip = document.createElement("button");
    chip.className = `filter__chip${isHidden ? " filter__chip--inactive" : ""}`;
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

  if (data) {
    const allProducts = data.products || [];
    const lines = [
      `${data.ownedCount} owned of ${data.totalCatalog} total`,
      `${allProducts.length} not owned`,
      `${dismissedProducts.size} dismissed`,
      `${hiddenCategories.size} categories hidden`,
    ];
    statsEl.textContent = lines.join(" \u00b7 ");
  }
};

// --- Rendering ---

const renderToggle = (container, options, activeKey, onChange) => {
  container.innerHTML = "";
  for (const { key, label } of options) {
    const btn = document.createElement("button");
    btn.className = `toggle__btn${activeKey === key ? " toggle__btn--active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      onChange(key);
      saveFilterPrefs();
      render(currentData);
    });
    container.appendChild(btn);
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
    summaryEl.style.color = "var(--color-text-error)";
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

  if (allProducts.length === 0) {
    summaryEl.textContent = `You own everything! (${data.ownedCount} of ${data.totalCatalog})`;
    return;
  }

  const groups = {};
  for (const product of products) {
    const cat = categorizeProduct(product);
    (groups[cat] ??= []).push(product);
  }

  renderSettings(groups, data);

  if (products.length === 0) {
    summaryEl.textContent = `No matching products (${allProducts.length} total not owned)`;
    return;
  }

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
    header.className = "product-list__header";
    header.textContent = `${key} (${group.length})`;
    listEl.appendChild(header);

    for (const product of group) {
      const url = product.url || endpoints.productPage(product.id);
      const entry = document.createElement("div");
      entry.className = "product";

      const link = document.createElement("a");
      link.className = "product__link";
      link.href = url;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (url.startsWith(MARKETPLACE_BASE)) chrome.tabs.create({ url });
      });

      const nameEl = document.createElement("span");
      nameEl.className = "product__name";
      nameEl.textContent = product.name || "(unnamed)";

      if (product.isNew) {
        const newBadge = document.createElement("span");
        newBadge.className = "product__new";
        newBadge.textContent = "New";
        nameEl.appendChild(newBadge);
      }

      const priceText = formatPrice(product.price);
      if (priceText) {
        const priceSpan = document.createElement("span");
        priceSpan.className = "product__price";
        priceSpan.textContent = priceText;
        nameEl.appendChild(priceSpan);
      }

      const relevantChildren = (product.children || []).filter(matchesFormat);
      const missingChildren = relevantChildren.filter((c) => !c.isOwned);
      const ownedCount = relevantChildren.length - missingChildren.length;

      if (relevantChildren.length > 0 && ownedCount > 0) {
        const note = document.createElement("span");
        note.className = "product__note";
        note.textContent = ` (${ownedCount}/${relevantChildren.length} owned)`;
        nameEl.appendChild(note);
      }

      if (missingChildren.length > 0) {
        for (const child of missingChildren) {
          const childEl = document.createElement("div");
          childEl.className = "product__child-missing";
          childEl.textContent = child.name || "(unnamed)";
          nameEl.appendChild(childEl);
        }
      }

      link.appendChild(nameEl);

      const badge = document.createElement("span");
      badge.className = `badge badge--${badgeClassFor(key)}`;
      badge.textContent = key;

      const dismissBtn = document.createElement("button");
      dismissBtn.className = "product__dismiss";
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

  const parts = [`${products.length} not owned`];
  if (hiddenCount > 0) parts.push(`${hiddenCount} hidden`);
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

document.getElementById("undismiss-btn").addEventListener("click", undismissAll);

settingsBtn.addEventListener("click", () => {
  settingsOpen = !settingsOpen;
  settingsPanel.hidden = !settingsOpen;
  settingsBtn.classList.toggle("footer__btn--active", settingsOpen);
});

if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render(currentData);
  });
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";
  showView("syncing");
  syncingMessage.textContent = "Starting sync...";

  chrome.runtime.sendMessage({ action: "refresh" }, () => {
    if (chrome.runtime.lastError) {
      showView("login");
      loginMessage.textContent = "Could not connect to background. Try reloading the extension.";
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

  // Don't show stale errors on open — show syncing and let the background update
  if (currentData?.errorCode) {
    currentData = { syncing: true, stage: SYNC_STAGE.STARTING };
    chrome.runtime.sendMessage({ action: "refresh" }, () => {
      if (chrome.runtime.lastError) {
        // Background not available, show the actual error
        currentData = result[STORAGE.NOT_OWNED] || null;
        render(currentData);
      }
    });
  }

  render(currentData);
})();
